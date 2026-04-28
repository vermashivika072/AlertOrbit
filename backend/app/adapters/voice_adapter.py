from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


def send_voice_alert(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "channel": "voice",
        "provider": "voice-announcement-placeholder",
        "status": "mocked",
        "message": payload.get("message", ""),
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }

