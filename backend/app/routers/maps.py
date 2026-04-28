from __future__ import annotations

from fastapi import APIRouter, Depends

from app.dependencies import require_roles
from app.map_service import (
    fetch_safe_route,
    get_map,
    list_maps,
    upsert_map_metadata,
    update_blocked_exits,
    update_unsafe_zones,
)
from app.schemas import BlockedExitUpdateRequest, MapUploadRequest, SafeRouteRequest, UnsafeZoneUpdateRequest


router = APIRouter(prefix="/api/maps", tags=["maps"])


def _actor_from_user(user: dict) -> dict:
    return {"userId": user["id"], "name": user["name"], "role": user["role"]}


@router.get("")
def get_maps(current_user: dict = Depends(require_roles("Staff", "Manager", "Admin", "Administrator"))):
    _ = current_user
    return {"maps": list_maps()}


@router.get("/{map_id}")
def get_map_by_id(map_id: str, current_user: dict = Depends(require_roles("Staff", "Manager", "Admin", "Administrator"))):
    _ = current_user
    return {"map": get_map(map_id)}


@router.post("/upload-metadata")
def upload_map_metadata(
    payload: MapUploadRequest,
    current_user: dict = Depends(require_roles("Manager", "Admin", "Administrator")),
):
    body = payload.model_dump() if hasattr(payload, "model_dump") else payload.dict()
    return {"map": upsert_map_metadata(body, _actor_from_user(current_user))}


@router.patch("/{map_id}/unsafe-zones")
def patch_unsafe_zones(
    map_id: str,
    payload: UnsafeZoneUpdateRequest,
    current_user: dict = Depends(require_roles("Manager", "Admin", "Administrator")),
):
    return {"map": update_unsafe_zones(map_id, payload.unsafe_zone_ids, _actor_from_user(current_user))}


@router.patch("/{map_id}/blocked-exits")
def patch_blocked_exits(
    map_id: str,
    payload: BlockedExitUpdateRequest,
    current_user: dict = Depends(require_roles("Manager", "Admin", "Administrator")),
):
    return {"map": update_blocked_exits(map_id, payload.blocked_exit_ids, _actor_from_user(current_user))}


@router.post("/{map_id}/safe-route")
def get_safe_route(
    map_id: str,
    payload: SafeRouteRequest,
    current_user: dict = Depends(require_roles("Staff", "Manager", "Admin", "Administrator")),
):
    _ = current_user
    return {
        "route": fetch_safe_route(
            map_id=map_id,
            origin_node_id=payload.origin_node_id,
            exit_ids=payload.exit_ids,
            unsafe_zone_ids=payload.unsafe_zone_ids,
            blocked_exit_ids=payload.blocked_exit_ids,
            crowd_by_edge_id=payload.crowd_by_edge_id,
        )
    }
