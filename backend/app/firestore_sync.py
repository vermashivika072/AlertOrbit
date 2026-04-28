from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import firebase_admin
from firebase_admin import firestore

from app.config import settings


def firestore_available() -> bool:
    return bool(firebase_admin._apps)


def sync_alert_to_firestore(alert_payload: dict[str, Any]) -> dict[str, Any]:
    if not firestore_available():
        print("Firestore sync skipped: Firebase is not initialized.")
        return {"ok": False, "reason": "firebase_not_initialized"}

    alert_id = str(alert_payload.get("alertId") or alert_payload.get("id") or "").strip()
    if not alert_id:
        return {"ok": False, "reason": "missing_alert_id"}

    payload = dict(alert_payload)
    payload["syncedFrom"] = "alertorbit-backend"
    payload["mirroredAt"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    try:
        client = firestore.client()
        print(f"Firestore sync payload for {alert_id}: {payload}")
        client.collection(settings.firestore_alerts_collection).document(alert_id).set(payload, merge=True)
        print(f"Firestore sync succeeded for collection={settings.firestore_alerts_collection}, documentId={alert_id}")
        return {
            "ok": True,
            "collection": settings.firestore_alerts_collection,
            "documentId": alert_id,
        }
    except Exception as exc:
        print(f"Firestore sync failed for {alert_id}: {exc}")
        return {
            "ok": False,
            "reason": "firestore_write_failed",
            "error": str(exc),
            "collection": settings.firestore_alerts_collection,
            "documentId": alert_id,
        }
