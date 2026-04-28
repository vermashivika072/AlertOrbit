"""
Structured audit logging for emergency actions, translations, and map updates.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from app.store import store


AUDIT_LOGS_PATH = "logs"


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def log_audit_event(
    category: str,
    action: str,
    actor: dict[str, Any] | None = None,
    subject_id: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    entry = {
        "category": category,
        "action": action,
        "actor": actor or {},
        "user": (actor or {}).get("name") or (actor or {}).get("email") or "system",
        "subjectId": subject_id,
        "emergencyId": subject_id,
        "metadata": metadata or {},
        "createdAt": utc_now_iso(),
    }
    print(f"Audit log entry: {entry}")
    entry_id = store.push(AUDIT_LOGS_PATH, entry)
    return {"id": entry_id, **entry}


def list_audit_events(category: str | None = None, limit: int = 200) -> list[dict[str, Any]]:
    raw = store.get(AUDIT_LOGS_PATH, default={}) or {}
    items = [{"id": item_id, **payload} for item_id, payload in raw.items()]
    if category:
        items = [item for item in items if item.get("category") == category]
    items.sort(key=lambda item: item.get("createdAt", ""), reverse=True)
    return items[:limit]
