from __future__ import annotations

import time
from uuid import uuid4

from app.store import store


ALERTS_COLLECTION = "logs"


def create_alert(incident_id, message, target_role):
    alert_id = str(uuid4())
    new_alert = {
        "incidentId": incident_id,
        "message": message,
        "targetRole": target_role,
        "read": False,
        "action": "alert_created",
        "createdAt": int(time.time() * 1000),
    }
    print(f"Firestore alert helper payload: {new_alert}")
    store.set(f"{ALERTS_COLLECTION}/{alert_id}", new_alert)
    return alert_id


def get_alerts_by_role(role):
    data = store.get(ALERTS_COLLECTION, default={}) or {}
    print(f"Firestore alert helper read count: {len(data)}")
    return [
        {"id": k, **v}
        for k, v in data.items()
        if v.get("targetRole") == role
    ]


def mark_alert_read(alert_id):
    print(f"Firestore alert helper mark read: {alert_id}")
    store.update(f"{ALERTS_COLLECTION}/{alert_id}", {"read": True, "updatedAt": int(time.time() * 1000)})
