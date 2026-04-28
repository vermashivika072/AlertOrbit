from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.database import get_db
from app.db_models import User
from app.response_utils import success_response
from app.schemas import UserCreateRequest, UserUpdateRequest


router = APIRouter(prefix="/api/users", tags=["users"])


def _serialize_user(user: User) -> dict:
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "createdAt": user.created_at.isoformat(),
    }


@router.post("", status_code=status.HTTP_201_CREATED)
def create_user(payload: UserCreateRequest, db: Session = Depends(get_db)):
    user = User(name=payload.name.strip(), email=payload.email.strip().lower())
    db.add(user)
    try:
        db.commit()
        db.refresh(user)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail={"message": "A user with this email already exists."}) from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail={"message": "Unable to create user right now."}) from exc
    return success_response("User created successfully.", _serialize_user(user))


@router.get("")
def get_users(db: Session = Depends(get_db)):
    users = db.query(User).order_by(User.created_at.desc()).all()
    return success_response("Users fetched successfully.", [_serialize_user(user) for user in users])


@router.get("/{user_id}")
def get_user(user_id: int, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail={"message": "User not found."})
    return success_response("User fetched successfully.", _serialize_user(user))


@router.put("/{user_id}")
def update_user(user_id: int, payload: UserUpdateRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail={"message": "User not found."})

    if payload.name is not None:
        user.name = payload.name.strip()
    if payload.email is not None:
        user.email = payload.email.strip().lower()

    try:
        db.commit()
        db.refresh(user)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail={"message": "A user with this email already exists."}) from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail={"message": "Unable to update user right now."}) from exc

    return success_response("User updated successfully.", _serialize_user(user))


@router.delete("/{user_id}")
def delete_user(user_id: int, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail={"message": "User not found."})

    try:
        db.delete(user)
        db.commit()
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail={"message": "Unable to delete user right now."}) from exc

    return success_response("User deleted successfully.", {"id": user_id})
