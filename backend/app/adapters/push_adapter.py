from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


def send_push_notification(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "channel": "push",
        "provider": "firebase-placeholder",
        "status": "mocked",
        "message": payload.get("message", ""),
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }

