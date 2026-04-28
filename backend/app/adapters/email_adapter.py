from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


def send_email_alert(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "channel": "email",
        "provider": "smtp-placeholder",
        "status": "mocked",
        "message": payload.get("message", ""),
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }

