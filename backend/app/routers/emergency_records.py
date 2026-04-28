from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.db_models import Alert, EmergencyEvent, Room
from app.firestore_sync import sync_alert_to_firestore
from app.response_utils import success_response
from app.schemas import AlertCreateRequest, AlertStatusUpdateRequest, EvacuationRouteQuery, TriggerEmergencyRequest


router = APIRouter(prefix="/api/emergency", tags=["emergency-data"])


OPEN_STATUSES = {"Active", "Investigating", "Escalated", "Evacuating"}
STATUS_ALIASES = {
    "active": "Active",
    "investigating": "Investigating",
    "resolved": "Resolved",
    "escalated": "Escalated",
    "evacuating": "Evacuating",
    "aborted": "False Alarm",
    "cancelled": "False Alarm",
    "false alarm": "False Alarm",
}
SEVERITY_RANK = {"Low": 1, "Medium": 2, "High": 3, "Critical": 4}


def _utc_now_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _isoformat_utc(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")


def _normalize_status(value: str) -> str:
    raw = value.strip()
    return STATUS_ALIASES.get(raw.lower(), raw.title())


def _serialize_room(room: Room | None) -> dict | None:
    if not room:
        return None
    return {
        "id": room.id,
        "roomNumber": room.room_number,
        "name": room.name,
        "roomType": room.room_type,
        "floorNumber": room.floor.floor_number if room.floor else None,
        "x": room.x_coord,
        "y": room.y_coord,
        "isExit": room.is_exit,
        "isStaircase": room.is_staircase,
        "isElevator": room.is_elevator,
        "metadata": room.metadata_json,
    }


def _serialize_alert(alert: Alert) -> dict:
    return {
        "id": alert.id,
        "alertId": alert.alert_id,
        "crisisType": alert.crisis_type,
        "severity": alert.severity,
        "date": alert.occurred_at.date().isoformat(),
        "time": alert.occurred_at.time().isoformat(timespec="minutes"),
        "roomNumber": alert.room_number,
        "floorNumber": alert.floor_number,
        "reportedBy": alert.reported_by,
        "status": alert.status,
        "assignedResponseTeam": alert.assigned_response_team,
        "evacuationStatus": alert.evacuation_status,
        "routeStatus": alert.route_status,
        "nearestSafeExit": alert.nearest_safe_exit,
        "details": alert.details,
        "timeline": alert.timeline,
        "responderStatus": alert.responder_status,
        "routePreview": alert.route_preview,
        "metadata": alert.metadata_json,
        "createdAt": _isoformat_utc(alert.created_at),
        "updatedAt": _isoformat_utc(alert.updated_at),
        "room": _serialize_room(alert.room),
    }


def _serialize_event(event: EmergencyEvent | None) -> dict | None:
    if not event:
        return None
    return {
        "id": event.id,
        "eventCode": event.event_code,
        "eventType": event.event_type,
        "startedAt": event.started_at.isoformat(),
        "endedAt": event.ended_at.isoformat() if event.ended_at else None,
        "nearestSafeExit": event.nearest_safe_exit,
        "routeSteps": event.route_steps,
        "blockedPaths": event.blocked_paths,
        "safeZones": event.safe_zones,
        "simulationState": event.simulation_state,
        "metadata": event.metadata_json,
    }


def _append_timeline(alert: Alert, label: str, detail: str) -> None:
    timeline = list(alert.timeline or [])
    timeline.append(
        {
            "label": label,
            "detail": detail,
            "at": _isoformat_utc(_utc_now_naive()),
        }
    )
    alert.timeline = timeline


def _get_room(db: Session, room_number: str, floor_number: int) -> Room | None:
    return (
        db.query(Room)
        .options(joinedload(Room.floor))
        .filter(Room.room_number == room_number, Room.floor.has(floor_number=floor_number))
        .first()
    )


def _select_route(room: Room, blocked_room_numbers: list[str], db: Session) -> dict:
    exits = (
        db.query(Room)
        .options(joinedload(Room.floor))
        .filter(Room.is_exit.is_(True))
        .all()
    )
    valid_exits = [exit_room for exit_room in exits if exit_room.room_number not in set(blocked_room_numbers)]
    if not valid_exits:
        raise HTTPException(status_code=404, detail={"message": "No safe exit is available for the requested route."})

    def score(exit_room: Room) -> int:
        floor_penalty = abs((room.floor.floor_number if room.floor else 0) - (exit_room.floor.floor_number if exit_room.floor else 0)) * 120
        return floor_penalty + abs(room.x_coord - exit_room.x_coord) + abs(room.y_coord - exit_room.y_coord)

    selected_exit = min(valid_exits, key=score)
    route_status = "blocked" if blocked_room_numbers else ("caution" if selected_exit.floor.floor_number != room.floor.floor_number else "safe")
    corridor_y = 112
    points = [
        {"x": room.x_coord, "y": room.y_coord},
        {"x": room.x_coord, "y": corridor_y},
        {"x": selected_exit.x_coord, "y": corridor_y},
        {"x": selected_exit.x_coord, "y": selected_exit.y_coord},
    ]
    if route_status == "blocked":
        points.insert(2, {"x": 140, "y": 168})

    return {
        "floorNumber": room.floor.floor_number if room.floor else None,
        "roomNumber": room.room_number,
        "routeStatus": route_status,
        "distanceMeters": 32 + score(selected_exit) // 4,
        "etaMinutes": max(1, score(selected_exit) // 90),
        "nearestSafeExit": selected_exit.name,
        "points": points,
        "blockedSegments": [{"x1": 164, "y1": corridor_y, "x2": 210, "y2": corridor_y}] if route_status == "blocked" else [],
        "steps": [
            f"Exit {room.name} and join the protected corridor spine.",
            "Follow the illuminated route arrows to the assigned safe exit.",
            f"Stage occupants at {selected_exit.name}.",
        ],
        "selectedExit": _serialize_room(selected_exit),
    }


@router.post("/alerts", status_code=status.HTTP_201_CREATED)
def create_alert(payload: AlertCreateRequest, db: Session = Depends(get_db)):
    room = _get_room(db, payload.room_number, payload.floor_number)
    if not room:
        raise HTTPException(status_code=404, detail={"message": "Room was not found for the provided floor and room number."})

    duplicate = (
        db.query(Alert)
        .filter(
            Alert.room_number == payload.room_number,
            Alert.floor_number == payload.floor_number,
            Alert.crisis_type == payload.crisis_type,
            Alert.status.in_(OPEN_STATUSES),
        )
        .first()
    )

    route = _select_route(room, [], db)
    alert_code = f"ALR-{payload.floor_number}{payload.room_number}-{_utc_now_naive():%H%M%S}".replace(" ", "").upper()
    alert = Alert(
        alert_id=alert_code,
        crisis_type=payload.crisis_type.strip(),
        severity=payload.severity.strip().title(),
        occurred_at=_utc_now_naive(),
        room_id=room.id,
        room_number=payload.room_number.strip(),
        floor_number=payload.floor_number,
        reported_by=payload.reported_by.strip(),
        status=_normalize_status(payload.status),
        assigned_response_team=payload.assigned_response_team.strip(),
        evacuation_status=payload.evacuation_status.strip(),
        route_status=payload.route_status.strip().lower(),
        nearest_safe_exit=payload.nearest_safe_exit.strip() or route["nearestSafeExit"],
        details=payload.details.strip(),
        route_preview=route,
        responder_status=[
            {"name": "Command AI", "role": "Route Intelligence", "state": "Monitoring route"},
            {"name": payload.assigned_response_team.strip(), "role": "Primary Team", "state": "Queued"},
        ],
        timeline=[],
        metadata_json=payload.metadata,
    )
    _append_timeline(alert, "Alert Created", payload.details.strip())
    _append_timeline(alert, "Route Generated", f"Primary exit guidance prepared for {route['nearestSafeExit']}.")

    db.add(alert)
    try:
        db.commit()
        db.refresh(alert)
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail={"message": "Unable to create alert right now."}) from exc

    serialized_alert = _serialize_alert(alert)
    firestore_sync = sync_alert_to_firestore(serialized_alert)
    if not firestore_sync.get("ok"):
        print(f"Firestore alert sync skipped: {firestore_sync}")

    return success_response("Alert created successfully.", serialized_alert, firestoreSync=firestore_sync)


@router.get("/alerts/history")
def get_alert_history(
    status_filter: str | None = Query(default=None, alias="status"),
    severity: str | None = None,
    crisis_type: str | None = Query(default=None, alias="crisisType"),
    db: Session = Depends(get_db),
):
    query = (
        db.query(Alert)
        .options(joinedload(Alert.room).joinedload(Room.floor), joinedload(Alert.emergency_event))
        .order_by(Alert.occurred_at.desc())
    )
    if status_filter:
        query = query.filter(Alert.status == _normalize_status(status_filter))
    if severity:
        query = query.filter(Alert.severity == severity.title())
    if crisis_type:
        query = query.filter(Alert.crisis_type == crisis_type)

    alerts = query.all()
    impacted_floors = sorted({alert.floor_number for alert in alerts})
    return success_response(
        "Alert history fetched successfully.",
        {
            "items": [_serialize_alert(alert) for alert in alerts],
            "summary": {
                "count": len(alerts),
                "active": sum(1 for alert in alerts if alert.status in OPEN_STATUSES),
                "critical": sum(1 for alert in alerts if alert.severity == "Critical"),
                "impactedFloors": impacted_floors,
            },
        },
    )


@router.patch("/alerts/{alert_id}/status")
def update_alert_status(alert_id: str, payload: AlertStatusUpdateRequest, db: Session = Depends(get_db)):
    alert = db.query(Alert).filter(Alert.alert_id == alert_id).first()
    if not alert:
        raise HTTPException(status_code=404, detail={"message": "Alert not found."})

    next_status = _normalize_status(payload.status)
    alert.status = next_status
    alert.evacuation_status = {
        "Resolved": "Complete",
        "False Alarm": "Stand Down",
        "Investigating": "Assessment In Progress",
        "Escalated": "Priority Sweep",
        "Evacuating": "Primary Evacuation",
    }.get(next_status, "Guidance Active")
    if next_status in {"Resolved", "False Alarm"}:
        alert.route_status = "safe"
    elif next_status == "Escalated":
        alert.route_status = "caution"
    elif next_status == "Evacuating":
        alert.route_status = "blocked"

    alert.route_preview = {
        **(alert.route_preview or {}),
        "routeStatus": alert.route_status,
    }
    _append_timeline(alert, "Status Updated", f"Alert transitioned to {next_status}.")

    if alert.emergency_event and next_status in {"Resolved", "False Alarm"}:
        alert.emergency_event.ended_at = _utc_now_naive()
        alert.emergency_event.simulation_state = {
            **(alert.emergency_event.simulation_state or {}),
            "closed": True,
        }

    try:
        db.commit()
        db.refresh(alert)
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail={"message": "Unable to update alert status right now."}) from exc

    serialized_alert = _serialize_alert(alert)
    firestore_sync = sync_alert_to_firestore(serialized_alert)
    if not firestore_sync.get("ok"):
        print(f"Firestore alert sync skipped: {firestore_sync}")

    return success_response("Alert status updated successfully.", serialized_alert, firestoreSync=firestore_sync)


@router.post("/trigger")
def trigger_emergency(payload: TriggerEmergencyRequest, db: Session = Depends(get_db)):
    alert = (
        db.query(Alert)
        .options(joinedload(Alert.emergency_event))
        .filter(Alert.alert_id == payload.alert_id)
        .first()
    )
    if not alert:
        raise HTTPException(status_code=404, detail={"message": "Alert not found."})

    if alert.emergency_event:
        event = alert.emergency_event
        event.blocked_paths = payload.blocked_paths
        event.safe_zones = payload.safe_zones
        event.route_steps = payload.route_steps or event.route_steps
        event.simulation_state = payload.simulation_state
        event.metadata_json = {**(event.metadata_json or {}), **payload.metadata}
    else:
        event = EmergencyEvent(
            event_code=f"EVT-{alert.alert_id}",
            alert_id=alert.id,
            event_type=alert.crisis_type,
            started_at=_utc_now_naive(),
            nearest_safe_exit=alert.nearest_safe_exit,
            route_steps=payload.route_steps,
            blocked_paths=payload.blocked_paths,
            safe_zones=payload.safe_zones,
            simulation_state=payload.simulation_state,
            metadata_json=payload.metadata,
        )
        db.add(event)

    alert.status = "Evacuating"
    alert.evacuation_status = "Primary Evacuation"
    alert.route_status = "blocked" if payload.blocked_paths else alert.route_status
    alert.route_preview = {
        **(alert.route_preview or {}),
        "routeStatus": alert.route_status,
        "blockedSegments": alert.route_preview.get("blockedSegments", []) if payload.blocked_paths else [],
    }
    _append_timeline(alert, "Emergency Triggered", "Emergency simulation has been activated for the selected alert.")

    try:
        db.commit()
        db.refresh(alert)
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail={"message": "Unable to trigger emergency right now."}) from exc

    serialized_alert = _serialize_alert(alert)
    firestore_sync = sync_alert_to_firestore(serialized_alert)
    if not firestore_sync.get("ok"):
        print(f"Firestore alert sync skipped: {firestore_sync}")

    return success_response(
        "Emergency triggered successfully.",
        {
            "alert": serialized_alert,
            "event": _serialize_event(alert.emergency_event or event),
        },
        firestoreSync=firestore_sync,
    )


@router.post("/route")
def get_evacuation_route(payload: EvacuationRouteQuery, db: Session = Depends(get_db)):
    room = _get_room(db, payload.room_number, payload.floor_number)
    if not room:
        raise HTTPException(status_code=404, detail={"message": "Room was not found for the requested route."})

    route = _select_route(room, payload.blocked_room_numbers, db)
    return success_response("Evacuation route generated successfully.", route)
