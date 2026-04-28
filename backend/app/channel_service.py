"""
Notification orchestration for provider-agnostic channel adapters.
"""

from __future__ import annotations

from typing import Any

from app.adapters.email_adapter import send_email_alert
from app.adapters.push_adapter import send_push_notification
from app.adapters.sms_adapter import send_sms
from app.adapters.voice_adapter import send_voice_alert
from app.adapters.whatsapp_adapter import send_whatsapp
from app.audit_service import log_audit_event
from app.store import store


NOTIFICATION_HISTORY_PATH = "notification_history"


def dispatch_channel_notifications(payload: dict[str, Any]) -> list[dict[str, Any]]:
    results = [
        send_sms(payload),
        send_whatsapp(payload),
        send_voice_alert(payload),
        send_push_notification(payload),
        send_email_alert(payload),
    ]
    for result in results:
        print(f"Notification channel result: {result}")
        store.push(NOTIFICATION_HISTORY_PATH, result)

    log_audit_event(
        category="notification",
        action="dispatched",
        actor=payload.get("actor"),
        subject_id=payload.get("emergencyId"),
        metadata={"channels": [item["channel"] for item in results]},
    )
    return results


def list_notification_history(limit: int = 200) -> list[dict[str, Any]]:
    raw = store.get(NOTIFICATION_HISTORY_PATH, default={}) or {}
    print(f"Notification history read count: {len(raw)}")
    items = [{"id": record_id, **payload} for record_id, payload in raw.items()]
    items.sort(key=lambda item: item.get("createdAt", ""), reverse=True)
    return items[:limit]
