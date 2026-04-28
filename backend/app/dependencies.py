"""
Reusable FastAPI dependencies for auth and role checks.
"""

from __future__ import annotations

from fastapi import Depends, HTTPException

from app.auth_service import get_current_user


def require_roles(*roles: str):
    allowed = set(roles)

    async def _dependency(current_user: dict = Depends(get_current_user)) -> dict:
        if current_user.get("role") not in allowed:
            raise HTTPException(status_code=403, detail="Insufficient role privileges.")
        return current_user

    return _dependency

