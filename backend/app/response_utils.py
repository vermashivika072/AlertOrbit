"""
Shared API response helpers for structured success payloads.
"""

from __future__ import annotations

from typing import Any


def success_response(message: str, data: Any = None, **extra: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "success": True,
        "message": message,
    }
    if data is not None:
        payload["data"] = data
    payload.update(extra)
    return payload
