from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


def send_sms(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "channel": "sms",
        "provider": "twilio-placeholder",
        "status": "mocked",
        "message": payload.get("message", ""),
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }

