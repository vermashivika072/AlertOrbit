"""
SQLAlchemy ORM models for the PostgreSQL-backed emergency data layer.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    email: Mapped[str] = mapped_column(String(180), nullable=False, unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class StoreRecord(Base):
    __tablename__ = "store_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    collection: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    record_key: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    payload: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )


class Floor(Base):
    __tablename__ = "floors"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    floor_number: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    building_name: Mapped[str] = mapped_column(String(140), default="AlertOrbit Grand", nullable=False)
    venue_type: Mapped[str] = mapped_column(String(80), default="hospitality", nullable=False)
    map_asset_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    metadata_json: Mapped[dict] = mapped_column("metadata", JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    rooms: Mapped[list["Room"]] = relationship("Room", back_populates="floor", cascade="all, delete-orphan")


class Room(Base):
    __tablename__ = "rooms"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    floor_id: Mapped[int] = mapped_column(ForeignKey("floors.id", ondelete="CASCADE"), nullable=False, index=True)
    room_number: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(140), nullable=False)
    room_type: Mapped[str] = mapped_column(String(50), default="room", nullable=False)
    x_coord: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    y_coord: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_exit: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_staircase: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_elevator: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    metadata_json: Mapped[dict] = mapped_column("metadata", JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    floor: Mapped["Floor"] = relationship("Floor", back_populates="rooms")
    alerts: Mapped[list["Alert"]] = relationship("Alert", back_populates="room")


class Alert(Base):
    __tablename__ = "alerts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    alert_id: Mapped[str] = mapped_column(String(40), nullable=False, unique=True, index=True)
    crisis_type: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    severity: Mapped[str] = mapped_column(String(30), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    room_id: Mapped[int | None] = mapped_column(ForeignKey("rooms.id", ondelete="SET NULL"), nullable=True, index=True)
    room_number: Mapped[str] = mapped_column(String(30), nullable=False)
    floor_number: Mapped[int] = mapped_column(Integer, nullable=False)
    reported_by: Mapped[str] = mapped_column(String(140), nullable=False)
    status: Mapped[str] = mapped_column(String(40), nullable=False, default="Active")
    assigned_response_team: Mapped[str] = mapped_column(String(140), nullable=False)
    evacuation_status: Mapped[str] = mapped_column(String(80), nullable=False)
    route_status: Mapped[str] = mapped_column(String(30), nullable=False, default="safe")
    nearest_safe_exit: Mapped[str] = mapped_column(String(120), nullable=False)
    details: Mapped[str] = mapped_column(Text, nullable=False)
    route_preview: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    responder_status: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    timeline: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    metadata_json: Mapped[dict] = mapped_column("metadata", JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    room: Mapped["Room | None"] = relationship("Room", back_populates="alerts")
    emergency_event: Mapped["EmergencyEvent | None"] = relationship(
        "EmergencyEvent",
        back_populates="alert",
        uselist=False,
        cascade="all, delete-orphan",
    )


class EmergencyEvent(Base):
    __tablename__ = "emergency_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    event_code: Mapped[str] = mapped_column(String(40), nullable=False, unique=True, index=True)
    alert_id: Mapped[int] = mapped_column(ForeignKey("alerts.id", ondelete="CASCADE"), nullable=False, unique=True)
    event_type: Mapped[str] = mapped_column(String(80), nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    nearest_safe_exit: Mapped[str] = mapped_column(String(120), nullable=False)
    route_steps: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    blocked_paths: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    safe_zones: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    simulation_state: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    metadata_json: Mapped[dict] = mapped_column("metadata", JSON, default=dict, nullable=False)

    alert: Mapped["Alert"] = relationship("Alert", back_populates="emergency_event")
