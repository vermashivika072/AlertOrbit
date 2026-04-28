from __future__ import annotations

from fastapi import APIRouter, Depends

from app.auth_service import authenticate_staff, get_current_user
from app.schemas import LoginRequest, VerifyTokenRequest


router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login")
def login_staff(request: LoginRequest):
    return authenticate_staff(request.email, request.password)


@router.get("/me")
def get_profile(current_user: dict = Depends(get_current_user)):
    return {"user": current_user}


@router.post("/verify")
def verify_session(request: VerifyTokenRequest):
    from app.auth_service import verify_staff_token

    return {"valid": True, "user": verify_staff_token(request.token)}

