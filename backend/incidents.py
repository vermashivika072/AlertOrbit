from __future__ import annotations

import time
import uuid

from app.store import store


INCIDENTS_COLLECTION = "emergencies"


def create_incident(room_id, room_number, incident_type, severity, description, reported_by, text_history=None, voice_recordings=None):
    incident_id = str(uuid.uuid4())
    new_incident = {
        "roomId": room_id,
        "roomNumber": str(room_number),
        "room": str(room_number),
        "type": incident_type,
        "emergencyType": incident_type,
        "severity": severity,
        "status": "active",
        "description": description,
        "instructions": description,
        "reportedBy": reported_by,
        "triggeredBy": reported_by,
        "textHistory": text_history or [],
        "voiceRecordings": voice_recordings or [],
        "createdAt": int(time.time() * 1000),
        "updatedAt": int(time.time() * 1000),
    }
    print(f"Firestore incident payload: {new_incident}")
    store.set(f"{INCIDENTS_COLLECTION}/{incident_id}", new_incident)
    return incident_id


def get_active_incidents():
    data = store.get(INCIDENTS_COLLECTION, default={}) or {}
    print(f"Firestore incident read count: {len(data)}")
    return [
        {"id": k, **v}
        for k, v in data.items()
        if str(v.get("status", "")).lower() == "active"
    ]


def update_incident_status(incident_id, status):
    patch = {
        "status": status,
        "updatedAt": int(time.time() * 1000),
    }
    print(f"Firestore incident status update: id={incident_id}, patch={patch}")
    store.update(f"{INCIDENTS_COLLECTION}/{incident_id}", patch)
