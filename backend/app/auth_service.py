"""
JWT-backed staff authentication service with seeded demo users.
"""

from __future__ import annotations

from typing import Any

from fastapi import Header, HTTPException

from app.audit_service import log_audit_event
from app.config import settings
from app.demo_data import DEMO_STAFF_USERS
from app.security import create_access_token, decode_access_token, extract_bearer_token, hash_password, verify_password
from app.store import store


STAFF_USERS_PATH = "staff"
ALLOWED_TRIGGER_ROLES = {"Staff", "Manager", "Admin", "Administrator"}
ALLOWED_MAP_MANAGER_ROLES = {"Manager", "Admin", "Administrator"}
ALLOWED_TERMINATION_ROLES = {"Manager", "Admin", "Administrator"}


def _normalize_user(record_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": record_id,
        "name": payload.get("name", "Unknown Staff"),
        "email": payload.get("email", ""),
        "role": payload.get("role", "Staff"),
        "passwordHash": payload.get("passwordHash", ""),
        "active": bool(payload.get("active", True)),
        "venueScope": payload.get("venueScope", ["hotel"]),
    }


def seed_demo_users() -> None:
    existing = store.get(STAFF_USERS_PATH, default={}) or {}
    if existing or not settings.allow_demo_auth:
        return

    seeded: dict[str, Any] = {}
    for user in DEMO_STAFF_USERS:
        seeded[user["id"]] = {
            "name": user["name"],
            "email": user["email"].lower(),
            "role": user["role"],
            "passwordHash": hash_password(user["password"]),
            "active": user["active"],
            "venueScope": user["venueScope"],
            "permissions": user.get("venueScope", ["hotel"]),
        }
    print(f"Seeding staff users into Firestore collection '{STAFF_USERS_PATH}': {list(seeded)}")
    store.set(STAFF_USERS_PATH, seeded)


def list_staff_users() -> list[dict[str, Any]]:
    seed_demo_users()
    raw = store.get(STAFF_USERS_PATH, default={}) or {}
    return [_normalize_user(user_id, payload) for user_id, payload in raw.items()]


def find_user_by_email(email: str) -> dict[str, Any] | None:
    email = str(email or "").strip().lower()
    for user in list_staff_users():
        if user["email"] == email:
            return user
    return None


def sanitize_user(user: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": user["id"],
        "name": user["name"],
        "email": user["email"],
        "role": user["role"],
        "active": user["active"],
        "venueScope": user.get("venueScope", ["hotel"]),
    }


def authenticate_staff(email: str, password: str) -> dict[str, Any]:
    print(f"Authenticating staff user: {str(email or '').strip().lower()}")
    user = find_user_by_email(email)
    if not user or not user.get("active") or not verify_password(password, user["passwordHash"]):
        log_audit_event(
            category="auth",
            action="login_failed",
            metadata={"email": str(email or "").strip().lower()},
        )
        raise HTTPException(status_code=401, detail="Invalid staff credentials.")

    token = create_access_token(user)
    safe_user = sanitize_user(user)
    log_audit_event(
        category="auth",
        action="login_success",
        actor=safe_user,
        subject_id=user["id"],
        metadata={"role": user["role"]},
    )
    return {"accessToken": token, "tokenType": "bearer", "user": safe_user}


def verify_staff_token(token: str) -> dict[str, Any]:
    try:
        payload = decode_access_token(token)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc

    print(f"Verifying staff token for email: {payload.get('email', '')}")
    user = find_user_by_email(payload.get("email", ""))
    if not user or not user.get("active"):
        raise HTTPException(status_code=401, detail="Staff account is not active.")
    return sanitize_user(user)


def get_current_user(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    token = extract_bearer_token(authorization)
    if not token:
        raise HTTPException(status_code=401, detail="Missing bearer token.")
    return verify_staff_token(token)

