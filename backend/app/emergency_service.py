"""
Emergency lifecycle management, standardized payload formatting, and
real-time websocket broadcasting.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException, WebSocket
import firebase_admin
from firebase_admin import firestore

from app.audit_service import log_audit_event
from app.auth_service import ALLOWED_TERMINATION_ROLES
from app.channel_service import dispatch_channel_notifications
from app.store import store


EMERGENCY_ALERTS_PATH = "emergencies"
SUPPORTED_EMERGENCY_TYPES = (
    "Fire",
    "Medical Emergency",
    "Medical",
    "Security Threat",
    "Evacuation",
    "Evacuation Notice",
    "Natural Disaster",
    "Suspicious Activity",
    "System Alert",
)
SUPPORTED_SEVERITIES = ("low", "medium", "high", "critical")
ACTIVE_STATUSES = {"BROADCASTING", "ACTIVE"}
TERMINAL_STATUSES = {"RESOLVED", "CANCELLED"}
AUTHORIZED_TERMINATION_ROLES = set(ALLOWED_TERMINATION_ROLES)


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_emergency_type(value: str) -> str:
    normalized = (value or "").strip()
    return normalized if normalized in SUPPORTED_EMERGENCY_TYPES else (normalized or "System Alert")


def normalize_severity(value: str) -> str:
    severity = (value or "medium").strip().lower()
    return severity if severity in SUPPORTED_SEVERITIES else "medium"


def normalize_status(value: str) -> str:
    status = (value or "ACTIVE").strip().upper()
    if status in ACTIVE_STATUSES or status in TERMINAL_STATUSES:
        return status
    return "ACTIVE"


def alert_priority_rank(severity: str) -> int:
    order = {"critical": 4, "high": 3, "medium": 2, "low": 1}
    return order.get(normalize_severity(severity), 2)


def _serialize_alert(alert_id: str, payload: dict[str, Any] | None) -> dict[str, Any] | None:
    if not payload:
        return None
    return {"id": alert_id, **payload}


def list_emergency_alerts(statuses: set[str] | None = None) -> list[dict[str, Any]]:
    raw = store.get(EMERGENCY_ALERTS_PATH, default={}) or {}
    print(f"Firestore emergency read count: {len(raw)} from collection '{EMERGENCY_ALERTS_PATH}'")
    alerts = [_serialize_alert(alert_id, payload) for alert_id, payload in raw.items()]
    alerts = [alert for alert in alerts if alert]
    if statuses:
        alerts = [alert for alert in alerts if alert.get("status") in statuses]
    alerts.sort(
        key=lambda alert: (
            alert_priority_rank(alert.get("severity", "medium")),
            alert.get("createdAt", ""),
        ),
        reverse=True,
    )
    return alerts


def get_emergency_alert(alert_id: str) -> dict[str, Any] | None:
    return _serialize_alert(alert_id, store.get(f"{EMERGENCY_ALERTS_PATH}/{alert_id}"))


def get_live_emergency_alert() -> dict[str, Any] | None:
    alerts = list_emergency_alerts(ACTIVE_STATUSES)
    return alerts[0] if alerts else None


def can_manage_alert(actor: dict[str, Any], alert: dict[str, Any]) -> bool:
    if not actor:
        return False
    actor_id = str(actor.get("userId") or actor.get("id") or "").strip()
    actor_role = str(actor.get("role") or "").strip()
    trigger_actor = alert.get("triggeredBy", {}) or {}
    trigger_actor_id = str(trigger_actor.get("userId") or trigger_actor.get("id") or "").strip()
    if actor_id and actor_id == trigger_actor_id:
        return True
    return actor_role in AUTHORIZED_TERMINATION_ROLES


def build_structured_payload(alert: dict[str, Any]) -> dict[str, Any]:
    return {
        "emergencyId": alert["id"],
        "type": alert.get("emergencyType", "System Alert"),
        "severity": alert.get("severity", "medium"),
        "location": alert.get("location", "Unknown location"),
        "room": alert.get("room", ""),
        "instructions": alert.get("instructions", ""),
        "nearestExit": alert.get("nearestSafeExit", ""),
        "safeRoute": alert.get("routeGuidance", ""),
        "routeSteps": alert.get("routeSteps", []),
        "translatedMessages": alert.get("translations", {}),
        "affectedZones": alert.get("affectedZones", []),
        "createdAt": alert.get("createdAt"),
        "updatedAt": alert.get("updatedAt"),
        "status": alert.get("status"),
        "triggeredBy": alert.get("triggeredBy", {}),
        "venueType": alert.get("venueType", "hotel"),
    }


def create_emergency_alert(payload: dict[str, Any]) -> dict[str, Any]:
    timestamp = utc_now_iso()
    room = str(payload.get("room", "")).strip()
    location = str(payload.get("location", "")).strip()
    emergency_type = normalize_emergency_type(payload.get("emergencyType"))
    if not emergency_type:
        raise HTTPException(status_code=400, detail="Emergency type is required.")
    if not room and not location:
        raise HTTPException(status_code=400, detail="Either room or location is required.")
    record = {
        "venueType": payload.get("venueType", "hotel"),
        "emergencyType": emergency_type,
        "severity": normalize_severity(payload.get("severity")),
        "location": location or (f"Room {room}" if room else "Unknown location"),
        "room": room,
        "affectedZones": payload.get("affectedZones", []),
        "instructions": payload.get("instructions", ""),
        "nearestSafeExit": payload.get("nearestSafeExit", ""),
        "routeGuidance": payload.get("routeGuidance", ""),
        "routeSteps": payload.get("routeSteps", []),
        "status": normalize_status(payload.get("status", "BROADCASTING")),
        "translations": payload.get("translations", {}),
        "sourceText": payload.get("sourceText", ""),
        "navigationState": payload.get("navigationState", {}),
        "metadata": payload.get("metadata", {}),
        "triggeredBy": payload.get("triggeredBy", {}),
        "createdAt": timestamp,
        "updatedAt": timestamp,
        "resolvedAt": None,
    }
    print(f"Emergency payload: {record}")
    alert_id = store.push(EMERGENCY_ALERTS_PATH, record)
    created = get_emergency_alert(alert_id)
    print(f"Firestore emergency write status: created alert {alert_id}")
    log_audit_event(
        category="emergency",
        action="activated",
        actor=created.get("triggeredBy"),
        subject_id=alert_id,
        metadata={"severity": created.get("severity"), "location": created.get("location"), "room": created.get("room")},
    )
    return created or {"id": alert_id, **record}


def update_emergency_alert(alert_id: str, updates: dict[str, Any]) -> dict[str, Any] | None:
    current = get_emergency_alert(alert_id)
    if not current:
        return None

    patch = dict(updates)
    if "severity" in patch:
        patch["severity"] = normalize_severity(patch["severity"])
    if "emergencyType" in patch:
        patch["emergencyType"] = normalize_emergency_type(patch["emergencyType"])
    if "room" in patch:
        patch["room"] = str(patch["room"] or "").strip()
    if "location" in patch:
        patch["location"] = str(patch["location"] or "").strip()
    if "status" in patch:
        patch["status"] = normalize_status(patch["status"])
        if patch["status"] in TERMINAL_STATUSES:
            patch["resolvedAt"] = utc_now_iso()
    patch["updatedAt"] = utc_now_iso()

    print(f"Emergency update payload for {alert_id}: {patch}")
    store.update(f"{EMERGENCY_ALERTS_PATH}/{alert_id}", patch)
    updated = get_emergency_alert(alert_id)
    if updated:
        print(f"Firestore emergency update status: updated alert {alert_id}")
        action = {
            "ACTIVE": "updated",
            "BROADCASTING": "broadcasting",
            "RESOLVED": "resolved",
            "CANCELLED": "cancelled",
        }.get(updated["status"], "updated")
        log_audit_event(
            category="emergency",
            action=action,
            actor=updated.get("lastUpdatedBy") or updated.get("triggeredBy"),
            subject_id=alert_id,
            metadata={"status": updated["status"]},
        )
    return updated


@dataclass
class EmergencySocketManager:
    active_connections: set[WebSocket]

    def __init__(self) -> None:
        self.active_connections = set()

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self.active_connections.add(websocket)
        await websocket.send_json(
            {
                "event": "snapshot",
                "alert": get_live_emergency_alert(),
                "activeAlerts": list_emergency_alerts(ACTIVE_STATUSES),
            }
        )

    def disconnect(self, websocket: WebSocket) -> None:
        self.active_connections.discard(websocket)

    async def broadcast(self, payload: dict[str, Any]) -> None:
        stale_connections = []
        for connection in self.active_connections:
            try:
                await connection.send_json(payload)
            except Exception:
                stale_connections.append(connection)
        for connection in stale_connections:
            self.disconnect(connection)


async def _broadcast_alert_event(socket_manager: EmergencySocketManager, event: str, alert: dict[str, Any]) -> None:
    await socket_manager.broadcast(
        {
            "event": event,
            "alert": alert,
            "structuredPayload": build_structured_payload(alert),
            "activeAlerts": list_emergency_alerts(ACTIVE_STATUSES),
        }
    )


async def mark_alert_active(alert_id: str, socket_manager: EmergencySocketManager) -> dict[str, Any] | None:
    activated = update_emergency_alert(alert_id, {"status": "ACTIVE"})
    if activated:
        await _broadcast_alert_event(socket_manager, "emergency:activated", activated)
    return activated


async def create_and_broadcast_alert(payload: dict[str, Any], socket_manager: EmergencySocketManager) -> dict[str, Any]:
    alert = create_emergency_alert(payload)
    await _broadcast_alert_event(socket_manager, "emergency:broadcasting", alert)
    await asyncio.sleep(0)
    activated = await mark_alert_active(alert["id"], socket_manager)
    final_alert = activated or alert
    dispatch_channel_notifications(
        {
            "emergencyId": final_alert["id"],
            "message": final_alert.get("sourceText") or final_alert.get("instructions", ""),
            "actor": final_alert.get("triggeredBy"),
            "payload": build_structured_payload(final_alert),
        }
    )
    return final_alert


async def broadcast_updated_alert(socket_manager: EmergencySocketManager, alert: dict[str, Any]) -> None:
    event_name = {
        "ACTIVE": "emergency:updated",
        "BROADCASTING": "emergency:broadcasting",
        "RESOLVED": "emergency:resolved",
        "CANCELLED": "emergency:cancelled",
    }.get(alert.get("status"), "emergency:updated")
    await _broadcast_alert_event(socket_manager, event_name, alert)


def start_firestore_emergency_listener(loop: asyncio.AbstractEventLoop, socket_manager: EmergencySocketManager):
    if not firebase_admin._apps:
        print("Firestore snapshot listener skipped: Firebase is not initialized.")
        return None

    print(f"Starting Firestore snapshot listener for collection '{EMERGENCY_ALERTS_PATH}'")

    def _handle_snapshot(_collection_snapshot, changes, _read_time) -> None:
        change_types = [getattr(change, "type", "unknown") for change in changes]
        print(f"Snapshot listener event: collection={EMERGENCY_ALERTS_PATH}, changes={change_types}")

        async def _broadcast_snapshot() -> None:
            await socket_manager.broadcast(
                {
                    "event": "snapshot",
                    "alert": get_live_emergency_alert(),
                    "activeAlerts": list_emergency_alerts(ACTIVE_STATUSES),
                }
            )

        loop.call_soon_threadsafe(lambda: asyncio.create_task(_broadcast_snapshot()))

    try:
        return firestore.client().collection(EMERGENCY_ALERTS_PATH).on_snapshot(_handle_snapshot)
    except Exception as exc:
        print(f"Failed to start Firestore snapshot listener: {exc}")
        return None


def validate_alert_termination(actor: dict[str, Any], current: dict[str, Any]) -> None:
    if not can_manage_alert(actor, current):
        raise HTTPException(
            status_code=403,
            detail="Only the creator or an authorized manager/admin can end this emergency.",
        )
