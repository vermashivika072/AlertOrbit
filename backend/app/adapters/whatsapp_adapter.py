from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


def send_whatsapp(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "channel": "whatsapp",
        "provider": "whatsapp-business-placeholder",
        "status": "mocked",
        "message": payload.get("message", ""),
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }

