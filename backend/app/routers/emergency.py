from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request

from app.auth_service import ALLOWED_TERMINATION_ROLES, ALLOWED_TRIGGER_ROLES
from app.channel_service import list_notification_history
from app.dependencies import require_roles
from app.emergency_service import (
    ACTIVE_STATUSES,
    AUTHORIZED_TERMINATION_ROLES,
    SUPPORTED_EMERGENCY_TYPES,
    build_structured_payload,
    can_manage_alert,
    create_and_broadcast_alert,
    get_emergency_alert,
    get_live_emergency_alert,
    list_emergency_alerts,
    normalize_severity,
    update_emergency_alert,
    validate_alert_termination,
    broadcast_updated_alert,
)
from app.schemas import (
    AuthenticatedEmergencyCreateRequest,
    AuthenticatedEmergencyUpdateRequest,
    EmergencyMessagePreviewRequest,
)
from app.translation_service import LANGUAGE_NAME_MAP, SUPPORTED_TRANSLATION_CODES, build_preview_response


router = APIRouter(prefix="/api/emergency", tags=["emergency"])


def _actor_from_user(user: dict) -> dict:
    return {"userId": user["id"], "name": user["name"], "role": user["role"]}


@router.get("/config")
def emergency_config():
    return {
        "emergencyTypes": list(SUPPORTED_EMERGENCY_TYPES),
        "terminationRoles": list(AUTHORIZED_TERMINATION_ROLES),
        "supportedLanguages": list(SUPPORTED_TRANSLATION_CODES),
        "supportedStatuses": sorted(list(ACTIVE_STATUSES | {"RESOLVED", "CANCELLED"})),
    }


@router.get("")
def list_alerts(current_user: dict = Depends(require_roles(*ALLOWED_TRIGGER_ROLES))):
    _ = current_user
    alerts = list_emergency_alerts()
    return {
        "alerts": alerts,
        "activeAlert": get_live_emergency_alert(),
        "structuredPayloads": [build_structured_payload(alert) for alert in alerts],
    }


@router.post("/activate")
async def activate_emergency(
    payload: AuthenticatedEmergencyCreateRequest,
    request: Request,
    current_user: dict = Depends(require_roles(*ALLOWED_TRIGGER_ROLES)),
):
    created = await create_and_broadcast_alert(
        {
            "venueType": payload.venue_type,
            "emergencyType": payload.emergency_type,
            "severity": normalize_severity(payload.severity),
            "location": payload.location,
            "room": payload.room,
            "instructions": payload.instructions,
            "nearestSafeExit": payload.nearest_safe_exit,
            "routeGuidance": payload.route_guidance,
            "routeSteps": payload.route_steps,
            "affectedZones": payload.affected_zones,
            "translations": payload.translations or {},
            "sourceText": payload.source_text,
            "navigationState": payload.navigation_state or {},
            "metadata": payload.metadata or {},
            "triggeredBy": _actor_from_user(current_user),
        },
        request.app.state.socket_manager,
    )
    return {
        "success": True,
        "alert": created,
        "structuredPayload": build_structured_payload(created),
    }


@router.patch("/{alert_id}")
async def update_emergency(
    alert_id: str,
    payload: AuthenticatedEmergencyUpdateRequest,
    request: Request,
    current_user: dict = Depends(require_roles(*ALLOWED_TRIGGER_ROLES)),
):
    current = get_emergency_alert(alert_id)
    if not current:
        raise HTTPException(status_code=404, detail="Emergency alert not found.")

    actor = _actor_from_user(current_user)
    if payload.status and payload.status.upper() in {"RESOLVED", "CANCELLED"}:
        validate_alert_termination(actor, current)
    elif not can_manage_alert(actor, current) and current_user.get("role") not in ALLOWED_TERMINATION_ROLES:
        raise HTTPException(status_code=403, detail="Only the creator or a manager/admin can modify this alert.")

    updates = {
        "emergencyType": payload.emergency_type,
        "status": payload.status,
        "severity": payload.severity,
        "location": payload.location,
        "room": payload.room,
        "instructions": payload.instructions,
        "nearestSafeExit": payload.nearest_safe_exit,
        "routeGuidance": payload.route_guidance,
        "routeSteps": payload.route_steps,
        "affectedZones": payload.affected_zones,
        "translations": payload.translations,
        "sourceText": payload.source_text,
        "navigationState": payload.navigation_state,
        "metadata": payload.metadata,
        "lastUpdatedBy": actor,
    }
    updates = {key: value for key, value in updates.items() if value is not None}
    updated = update_emergency_alert(alert_id, updates)
    if not updated:
        raise HTTPException(status_code=404, detail="Emergency alert not found.")
    await broadcast_updated_alert(request.app.state.socket_manager, updated)
    return {
        "success": True,
        "alert": updated,
        "structuredPayload": build_structured_payload(updated),
    }


@router.post("/{alert_id}/resolve")
async def resolve_emergency(
    alert_id: str,
    request: Request,
    current_user: dict = Depends(require_roles(*ALLOWED_TRIGGER_ROLES)),
):
    current = get_emergency_alert(alert_id)
    if not current:
        raise HTTPException(status_code=404, detail="Emergency alert not found.")
    actor = _actor_from_user(current_user)
    validate_alert_termination(actor, current)
    updated = update_emergency_alert(alert_id, {"status": "RESOLVED", "lastUpdatedBy": actor})
    await broadcast_updated_alert(request.app.state.socket_manager, updated)
    return {"success": True, "alert": updated, "structuredPayload": build_structured_payload(updated)}


@router.post("/{alert_id}/cancel")
async def cancel_emergency(
    alert_id: str,
    request: Request,
    current_user: dict = Depends(require_roles(*ALLOWED_TRIGGER_ROLES)),
):
    current = get_emergency_alert(alert_id)
    if not current:
        raise HTTPException(status_code=404, detail="Emergency alert not found.")
    actor = _actor_from_user(current_user)
    validate_alert_termination(actor, current)
    updated = update_emergency_alert(alert_id, {"status": "CANCELLED", "lastUpdatedBy": actor})
    await broadcast_updated_alert(request.app.state.socket_manager, updated)
    return {"success": True, "alert": updated, "structuredPayload": build_structured_payload(updated)}


@router.post("/preview-translation")
async def preview_translation(
    payload: EmergencyMessagePreviewRequest,
    current_user: dict = Depends(require_roles(*ALLOWED_TRIGGER_ROLES)),
):
    _ = current_user
    response = await build_preview_response(payload.message, payload.target_languages)
    return {
        **response,
        "languageNames": LANGUAGE_NAME_MAP,
    }


@router.get("/notification-history")
def notification_history(current_user: dict = Depends(require_roles("Manager", "Admin", "Administrator"))):
    _ = current_user
    return {"items": list_notification_history()}
