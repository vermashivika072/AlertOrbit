"""
Security helpers for demo-safe JWT auth and password hashing.

This module avoids introducing extra dependencies so the backend remains easy
to run in constrained environments.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
from typing import Any

from app.config import settings


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64url_decode(raw: str) -> bytes:
    padding = "=" * (-len(raw) % 4)
    return base64.urlsafe_b64decode((raw + padding).encode("ascii"))


def hash_password(password: str, salt: str | None = None) -> str:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.sha256(f"{salt}:{password}".encode("utf-8")).hexdigest()
    return f"{salt}${digest}"


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        salt, _digest = stored_hash.split("$", 1)
    except ValueError:
        return False
    return hmac.compare_digest(hash_password(password, salt), stored_hash)


def create_access_token(subject: dict[str, Any], expires_minutes: int | None = None) -> str:
    now = int(time.time())
    exp = now + int((expires_minutes or settings.access_token_expires_minutes) * 60)
    payload = {
        "sub": subject["id"],
        "email": subject["email"],
        "name": subject["name"],
        "role": subject["role"],
        "venueScope": subject.get("venueScope", ["hotel"]),
        "iat": now,
        "exp": exp,
        "iss": settings.jwt_issuer,
        "aud": settings.jwt_audience,
    }
    header = {"alg": "HS256", "typ": "JWT"}
    header_b64 = _b64url_encode(json.dumps(header, separators=(",", ":")).encode("utf-8"))
    payload_b64 = _b64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signing_input = f"{header_b64}.{payload_b64}".encode("ascii")
    signature = hmac.new(
        settings.jwt_secret.encode("utf-8"),
        signing_input,
        hashlib.sha256,
    ).digest()
    return f"{header_b64}.{payload_b64}.{_b64url_encode(signature)}"


def decode_access_token(token: str) -> dict[str, Any]:
    try:
        header_b64, payload_b64, signature_b64 = token.split(".")
    except ValueError as exc:
        raise ValueError("Malformed token.") from exc

    signing_input = f"{header_b64}.{payload_b64}".encode("ascii")
    expected_signature = hmac.new(
        settings.jwt_secret.encode("utf-8"),
        signing_input,
        hashlib.sha256,
    ).digest()
    received_signature = _b64url_decode(signature_b64)

    if not hmac.compare_digest(expected_signature, received_signature):
        raise ValueError("Invalid token signature.")

    payload = json.loads(_b64url_decode(payload_b64).decode("utf-8"))
    now = int(time.time())
    if payload.get("exp", 0) < now:
        raise ValueError("Token expired.")
    if payload.get("iss") != settings.jwt_issuer:
        raise ValueError("Invalid token issuer.")
    if payload.get("aud") != settings.jwt_audience:
        raise ValueError("Invalid token audience.")
    return payload


def extract_bearer_token(authorization: str | None) -> str | None:
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None
    return token.strip()

