from __future__ import annotations

import asyncio
import os
import time
import uuid
from pathlib import Path
from typing import Any

import firebase_admin
from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from firebase_admin import credentials
from pydantic import BaseModel

from alerts import create_alert, get_alerts_by_role, mark_alert_read
from app.auth_service import ALLOWED_TRIGGER_ROLES, authenticate_staff, seed_demo_users, verify_staff_token
from app.config import settings
from app.database import init_db
from app.db_seed import seed_database
from app.emergency_service import (
    ACTIVE_STATUSES,
    AUTHORIZED_TERMINATION_ROLES,
    EmergencySocketManager,
    SUPPORTED_EMERGENCY_TYPES,
    broadcast_updated_alert,
    build_structured_payload,
    can_manage_alert,
    create_and_broadcast_alert,
    get_emergency_alert,
    get_live_emergency_alert,
    list_emergency_alerts,
    normalize_emergency_type,
    normalize_severity,
    normalize_status,
    start_firestore_emergency_listener,
    update_emergency_alert,
    validate_alert_termination,
)
from app.map_service import fetch_safe_route, list_maps, seed_demo_maps
from app.routers.auth import router as auth_router
from app.routers.emergency import router as emergency_router
from app.routers.emergency_records import router as emergency_records_router
from app.routers.maps import router as maps_router
from app.routers.users import router as users_router
from app.schemas import EmergencyAlertRequest, EmergencyAlertUpdateRequest, LoginRequest, TranslationRequest
from app.security import extract_bearer_token
from app.translation_service import LANGUAGE_NAME_MAP, SUPPORTED_TRANSLATION_CODES, build_preview_response, translate_text
from gemini import generate_911_brief, triage_incident
from incidents import create_incident, get_active_incidents, update_incident_status


ENV_PATH = Path(__file__).resolve().parent / ".env"
load_dotenv(ENV_PATH)


def _init_firebase() -> None:
    if firebase_admin._apps:
        return

    try:
        if os.path.exists(settings.service_account_key_path):
            cred = credentials.Certificate(settings.service_account_key_path)
            options = {"databaseURL": settings.firebase_url} if settings.firebase_url else None
            firebase_admin.initialize_app(cred, options)
            print(
                "Firebase initialized:",
                {
                    "projectId": settings.firebase_project_id or "service-account-default",
                    "alertsCollection": settings.firestore_alerts_collection,
                    "staffCollection": settings.firestore_staff_collection,
                    "logsCollection": settings.firestore_logs_collection,
                },
            )
        else:
            print(f"Firebase initialization skipped: service account file not found at {settings.service_account_key_path}")
    except Exception as exc:
        print(f"Firebase initialization skipped: {exc}")


_init_firebase()

app = FastAPI(title=settings.app_name)
socket_manager = EmergencySocketManager()
app.state.socket_manager = socket_manager
app.state.firestore_listener = None

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(emergency_router)
app.include_router(maps_router)
app.include_router(users_router)
app.include_router(emergency_records_router)


@app.on_event("startup")
def bootstrap_database() -> None:
    init_db()
    from app.database import SessionLocal

    with SessionLocal() as db:
        seed_database(db)
    seed_demo_users()
    seed_demo_maps()
    try:
        loop = asyncio.get_event_loop()
        app.state.firestore_listener = start_firestore_emergency_listener(loop, socket_manager)
    except Exception as exc:
        print(f"Firestore snapshot listener startup skipped: {exc}")


class SOSRequest(BaseModel):
    room_number: str
    description: str
    reported_by: str
    text_history: list[str] | None = None
    voice_base64: str | None = None


class UpdateStatusRequest(BaseModel):
    status: str


class AlertRequest(BaseModel):
    incident_id: str
    message: str
    target_role: str


class IncidentRequest(BaseModel):
    description: str
    room_number: int


def _actor_from_token_or_payload(authorization: str | None, payload_actor: Any) -> dict[str, Any]:
    token = extract_bearer_token(authorization)
    if token:
        user = verify_staff_token(token)
        return {"userId": user["id"], "name": user["name"], "role": user["role"]}

    if payload_actor:
        return {
            "userId": payload_actor.user_id,
            "name": payload_actor.name,
            "role": payload_actor.role,
        }
    raise HTTPException(status_code=401, detail="A valid staff identity is required.")


@app.get("/")
def root():
    return {
        "status": "AlertOrbit Backend Running!",
        "api": {
            "auth": "/api/auth",
            "emergency": "/api/emergency",
            "maps": "/api/maps",
            "users": "/api/users",
        },
    }


@app.post("/api/auth/demo-login")
def demo_login(request: LoginRequest):
    return authenticate_staff(request.email, request.password)


@app.post("/sos")
async def sos(request: SOSRequest):
    try:
        triage = triage_incident(request.description, request.room_number)
        text_history = [request.description]
        if request.text_history:
            text_history += request.text_history

        voice_recordings = []
        if request.voice_base64:
            voice_recordings.append(
                {
                    "id": str(uuid.uuid4()),
                    "incidentId": "",
                    "base64": request.voice_base64,
                    "duration": 5,
                    "createdAt": int(time.time() * 1000),
                }
            )

        incident_id = create_incident(
            room_id=f"room{request.room_number}",
            room_number=request.room_number,
            incident_type=triage["type"],
            severity=triage["severity"],
            description=request.description,
            reported_by=request.reported_by,
            text_history=text_history,
            voice_recordings=voice_recordings,
        )

        for rec in voice_recordings:
            rec["incidentId"] = incident_id

        create_alert(
            incident_id=incident_id,
            message=f"ALERT! Room {request.room_number}: {triage['summary']} {'+ Voice' if request.voice_base64 else ''}",
            target_role="staff",
        )
        return {"success": True, "incident_id": incident_id, "triage": triage}
    except Exception as e:
        print(f"SOS error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/triage")
async def triage_endpoint(request: IncidentRequest):
    try:
        return triage_incident(request.description, request.room_number)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/incidents")
def incidents():
    return get_active_incidents()


@app.patch("/incidents/{incident_id}")
def update_status(incident_id: str, request: UpdateStatusRequest):
    update_incident_status(incident_id, request.status)
    return {"success": True}


@app.get("/alerts/{role}")
def alerts(role: str):
    return get_alerts_by_role(role)


@app.patch("/alerts/{alert_id}/read")
def read_alert(alert_id: str):
    mark_alert_read(alert_id)
    return {"success": True}


@app.get("/911-brief/{incident_id}")
def brief(incident_id: str, room_number: str, incident_type: str, severity: int):
    _ = incident_id
    text = generate_911_brief(incident_type, severity, room_number, 47)
    return {"brief": text}


@app.get("/emergency-alerts")
def emergency_alerts(status: str | None = None):
    statuses = None
    if status:
        statuses = {normalize_status(part) for part in status.split(",")}
    alerts = list_emergency_alerts(statuses)
    print(f"Emergency alerts read status: returning {len(alerts)} alert(s)")
    return {
        "alerts": alerts,
        "activeAlert": get_live_emergency_alert(),
        "structuredPayloads": [build_structured_payload(alert) for alert in alerts],
    }


@app.post("/emergency-alerts")
async def create_emergency(request: EmergencyAlertRequest, authorization: str | None = Header(default=None)):
    actor = _actor_from_token_or_payload(authorization, request.actor)
    if actor["role"] not in ALLOWED_TRIGGER_ROLES:
        raise HTTPException(status_code=403, detail="This user role cannot trigger emergencies.")
    if not str(request.emergency_type or "").strip():
        raise HTTPException(status_code=400, detail="Emergency type is required.")
    if not str(request.room or "").strip() and not str(request.location or "").strip():
        raise HTTPException(status_code=400, detail="Room or location is required.")

    payload = {
        "venueType": request.venue_type,
        "emergencyType": normalize_emergency_type(request.emergency_type),
        "severity": normalize_severity(request.severity),
        "location": request.location,
        "room": request.room,
        "instructions": request.instructions,
        "nearestSafeExit": request.nearest_safe_exit,
        "routeGuidance": request.route_guidance,
        "routeSteps": request.route_steps,
        "affectedZones": request.affected_zones,
        "translations": request.translations or {},
        "sourceText": request.source_text,
        "navigationState": request.navigation_state or {},
        "metadata": request.metadata or {},
        "triggeredBy": actor,
    }
    print(f"Emergency payload: {payload}")
    created = await create_and_broadcast_alert(payload, socket_manager)
    return {"success": True, "alert": created, "structuredPayload": build_structured_payload(created)}


@app.patch("/emergency-alerts/{alert_id}")
async def update_emergency(
    alert_id: str,
    request: EmergencyAlertUpdateRequest,
    authorization: str | None = Header(default=None),
):
    current = get_emergency_alert(alert_id)
    if not current:
        raise HTTPException(status_code=404, detail="Emergency alert not found.")

    actor = _actor_from_token_or_payload(authorization, request.actor)
    if request.status and normalize_status(request.status) in {"RESOLVED", "CANCELLED"}:
        validate_alert_termination(actor, current)
    elif not can_manage_alert(actor, current) and actor["role"] not in AUTHORIZED_TERMINATION_ROLES:
        raise HTTPException(
            status_code=403,
            detail="Only the initiating staff member or an authorized manager/admin can modify this emergency.",
        )

    updates = {
        "emergencyType": request.emergency_type,
        "severity": request.severity,
        "location": request.location,
        "room": request.room,
        "instructions": request.instructions,
        "nearestSafeExit": request.nearest_safe_exit,
        "routeGuidance": request.route_guidance,
        "routeSteps": request.route_steps,
        "affectedZones": request.affected_zones,
        "translations": request.translations,
        "sourceText": request.source_text,
        "navigationState": request.navigation_state,
        "metadata": request.metadata,
        "lastUpdatedBy": actor,
    }
    if request.status:
        updates["status"] = request.status
    updates = {key: value for key, value in updates.items() if value is not None}
    print(f"Emergency update payload for {alert_id}: {updates}")

    updated = update_emergency_alert(alert_id, updates)
    if not updated:
        raise HTTPException(status_code=404, detail="Emergency alert not found.")
    await broadcast_updated_alert(socket_manager, updated)
    return {"success": True, "alert": updated, "structuredPayload": build_structured_payload(updated)}


@app.post("/translate")
async def translate(request: TranslationRequest):
    translations = await translate_text(
        text=request.text,
        target_languages=request.target_languages,
        source_language=request.source_language,
    )
    return {"sourceLanguage": request.source_language, "translations": translations}


@app.post("/api/emergency/preview-translation-legacy")
async def preview_translation_legacy(request: TranslationRequest):
    return await build_preview_response(
        message=request.text,
        target_languages=request.target_languages,
        source_language=request.source_language,
    )


@app.get("/emergency-config")
def emergency_config():
    return {
        "emergencyTypes": list(SUPPORTED_EMERGENCY_TYPES),
        "terminationRoles": list(AUTHORIZED_TERMINATION_ROLES),
        "supportedLanguages": list(SUPPORTED_TRANSLATION_CODES),
        "supportedStatuses": sorted(list(ACTIVE_STATUSES | {"RESOLVED", "CANCELLED"})),
        "languageNames": LANGUAGE_NAME_MAP,
        "availableMaps": [item["id"] for item in list_maps()],
    }


@app.get("/api/maps/demo-route")
def demo_route():
    return {
        "route": fetch_safe_route(
            map_id="demo-hotel-command-map",
            origin_node_id="f2-room-201",
            unsafe_zone_ids=["fire-zone-f2-west"],
            blocked_exit_ids=["exit-a"],
            crowd_by_edge_id={"edge-hall-to-exit-b": 2},
        )
    }


@app.websocket("/ws/emergency-alerts")
async def emergency_alert_socket(websocket: WebSocket):
    await socket_manager.connect(websocket)
    try:
        while True:
            message = await websocket.receive_json()
            if message.get("type") == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        socket_manager.disconnect(websocket)
