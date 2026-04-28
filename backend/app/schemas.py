"""
Shared request/response schemas for AlertOrbit backend APIs.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class StaffActor(BaseModel):
    user_id: str
    name: str
    role: str


class TranslationRequest(BaseModel):
    text: str
    target_languages: list[str] = Field(default_factory=lambda: ["en", "hi", "ar", "zh-CN", "fr"])
    source_language: str = "en"


class EmergencyAlertRequest(BaseModel):
    emergency_type: str
    severity: str
    location: str
    room: str = ""
    instructions: str
    nearest_safe_exit: str = ""
    route_guidance: str = ""
    route_steps: list[str] = Field(default_factory=list)
    affected_zones: list[str] = Field(default_factory=list)
    translations: dict[str, Any] | None = None
    source_text: str = ""
    navigation_state: dict[str, Any] | None = None
    metadata: dict[str, Any] | None = None
    venue_type: str = "hotel"
    actor: StaffActor


class EmergencyAlertUpdateRequest(BaseModel):
    actor: StaffActor
    emergency_type: str | None = None
    status: str | None = None
    severity: str | None = None
    location: str | None = None
    room: str | None = None
    instructions: str | None = None
    nearest_safe_exit: str | None = None
    route_guidance: str | None = None
    route_steps: list[str] | None = None
    affected_zones: list[str] | None = None
    translations: dict[str, Any] | None = None
    source_text: str | None = None
    navigation_state: dict[str, Any] | None = None
    metadata: dict[str, Any] | None = None


class AuthenticatedEmergencyCreateRequest(BaseModel):
    emergency_type: str
    severity: str
    location: str
    room: str = ""
    instructions: str
    nearest_safe_exit: str = ""
    route_guidance: str = ""
    route_steps: list[str] = Field(default_factory=list)
    affected_zones: list[str] = Field(default_factory=list)
    translations: dict[str, Any] | None = None
    source_text: str = ""
    navigation_state: dict[str, Any] | None = None
    metadata: dict[str, Any] | None = None
    venue_type: str = "hotel"


class AuthenticatedEmergencyUpdateRequest(BaseModel):
    emergency_type: str | None = None
    status: str | None = None
    severity: str | None = None
    location: str | None = None
    room: str | None = None
    instructions: str | None = None
    nearest_safe_exit: str | None = None
    route_guidance: str | None = None
    route_steps: list[str] | None = None
    affected_zones: list[str] | None = None
    translations: dict[str, Any] | None = None
    source_text: str | None = None
    navigation_state: dict[str, Any] | None = None
    metadata: dict[str, Any] | None = None


class LoginRequest(BaseModel):
    email: str
    password: str


class VerifyTokenRequest(BaseModel):
    token: str


class EmergencyMessagePreviewRequest(BaseModel):
    message: str
    target_languages: list[str] = Field(default_factory=lambda: ["en", "hi", "ar", "zh-CN", "fr"])


class MapUploadRequest(BaseModel):
    map_id: str | None = None
    name: str
    venue_type: str = "hotel"
    building_id: str = "default-building"
    metadata: dict[str, Any] = Field(default_factory=dict)
    floors: list[dict[str, Any]] = Field(default_factory=list)
    nodes: list[dict[str, Any]] = Field(default_factory=list)
    edges: list[dict[str, Any]] = Field(default_factory=list)
    unsafe_zones: list[dict[str, Any]] = Field(default_factory=list)
    blocked_exit_ids: list[str] = Field(default_factory=list)
    geojson: dict[str, Any] | None = None


class UnsafeZoneUpdateRequest(BaseModel):
    unsafe_zone_ids: list[str] = Field(default_factory=list)


class BlockedExitUpdateRequest(BaseModel):
    blocked_exit_ids: list[str] = Field(default_factory=list)


class SafeRouteRequest(BaseModel):
    origin_node_id: str
    exit_ids: list[str] | None = None
    unsafe_zone_ids: list[str] = Field(default_factory=list)
    blocked_exit_ids: list[str] = Field(default_factory=list)
    crowd_by_edge_id: dict[str, float] = Field(default_factory=dict)


class UserCreateRequest(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: str = Field(min_length=5, max_length=180)


class UserUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    email: str | None = Field(default=None, min_length=5, max_length=180)


class AlertCreateRequest(BaseModel):
    crisis_type: str = Field(min_length=2, max_length=80)
    severity: str = Field(min_length=2, max_length=30)
    room_number: str = Field(min_length=1, max_length=30)
    floor_number: int = Field(ge=0, le=100)
    reported_by: str = Field(min_length=2, max_length=140)
    status: str = Field(default="Active", min_length=2, max_length=40)
    assigned_response_team: str = Field(min_length=2, max_length=140)
    evacuation_status: str = Field(min_length=2, max_length=80)
    route_status: str = Field(default="safe", min_length=2, max_length=30)
    nearest_safe_exit: str = Field(min_length=2, max_length=120)
    details: str = Field(min_length=4)
    metadata: dict[str, Any] = Field(default_factory=dict)


class AlertStatusUpdateRequest(BaseModel):
    status: str = Field(min_length=2, max_length=40)


class TriggerEmergencyRequest(BaseModel):
    alert_id: str
    blocked_paths: list[str] = Field(default_factory=list)
    safe_zones: list[str] = Field(default_factory=list)
    route_steps: list[str] = Field(default_factory=list)
    simulation_state: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)


class EvacuationRouteQuery(BaseModel):
    room_number: str = Field(min_length=1, max_length=30)
    floor_number: int = Field(ge=0, le=100)
    blocked_room_numbers: list[str] = Field(default_factory=list)
