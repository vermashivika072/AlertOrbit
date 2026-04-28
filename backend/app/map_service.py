"""
Indoor map metadata management and safe-route hooks.
"""

from __future__ import annotations

import heapq
from math import fabs
from typing import Any
from uuid import uuid4

from fastapi import HTTPException

from app.audit_service import log_audit_event
from app.demo_data import DEMO_HOTEL_MAP
from app.store import store


INDOOR_MAPS_PATH = "indoor_maps"


def _copy_map_record(record_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    return {"id": record_id, **payload}


def seed_demo_maps() -> None:
    existing = store.get(INDOOR_MAPS_PATH, default={}) or {}
    if existing:
        return

    payload = dict(DEMO_HOTEL_MAP)
    map_id = payload.pop("id")
    store.set(f"{INDOOR_MAPS_PATH}/{map_id}", payload)


def list_maps() -> list[dict[str, Any]]:
    seed_demo_maps()
    raw = store.get(INDOOR_MAPS_PATH, default={}) or {}
    items = [_copy_map_record(map_id, payload) for map_id, payload in raw.items()]
    items.sort(key=lambda item: item.get("name", ""))
    return items


def get_map(map_id: str) -> dict[str, Any] | None:
    seed_demo_maps()
    payload = store.get(f"{INDOOR_MAPS_PATH}/{map_id}")
    if not payload:
        return None
    return _copy_map_record(map_id, payload)


def upsert_map_metadata(payload: dict[str, Any], actor: dict[str, Any]) -> dict[str, Any]:
    seed_demo_maps()
    map_id = payload.get("map_id") or payload.get("mapId") or f"map-{uuid4()}"
    record = {
        "name": payload["name"],
        "venueType": payload.get("venue_type") or payload.get("venueType", "hotel"),
        "buildingId": payload.get("building_id") or payload.get("buildingId", "default-building"),
        "metadata": payload.get("metadata", {}),
        "floors": payload.get("floors", []),
        "nodes": payload.get("nodes", []),
        "edges": payload.get("edges", []),
        "unsafeZones": payload.get("unsafe_zones") or payload.get("unsafeZones", []),
        "blockedExitIds": payload.get("blocked_exit_ids") or payload.get("blockedExitIds", []),
        "geojson": payload.get("geojson"),
        "updatedBy": actor,
    }
    store.set(f"{INDOOR_MAPS_PATH}/{map_id}", record)
    log_audit_event(
        category="map",
        action="metadata_upserted",
        actor=actor,
        subject_id=map_id,
        metadata={"venueType": record["venueType"]},
    )
    return get_map(map_id) or {"id": map_id, **record}


def update_unsafe_zones(map_id: str, unsafe_zone_ids: list[str], actor: dict[str, Any]) -> dict[str, Any]:
    current = get_map(map_id)
    if not current:
        raise HTTPException(status_code=404, detail="Indoor map not found.")
    store.update(f"{INDOOR_MAPS_PATH}/{map_id}", {"activeUnsafeZoneIds": unsafe_zone_ids, "updatedBy": actor})
    log_audit_event(
        category="map",
        action="unsafe_zones_updated",
        actor=actor,
        subject_id=map_id,
        metadata={"unsafeZoneIds": unsafe_zone_ids},
    )
    return get_map(map_id) or current


def update_blocked_exits(map_id: str, blocked_exit_ids: list[str], actor: dict[str, Any]) -> dict[str, Any]:
    current = get_map(map_id)
    if not current:
        raise HTTPException(status_code=404, detail="Indoor map not found.")
    store.update(f"{INDOOR_MAPS_PATH}/{map_id}", {"blockedExitIds": blocked_exit_ids, "updatedBy": actor})
    log_audit_event(
        category="map",
        action="blocked_exits_updated",
        actor=actor,
        subject_id=map_id,
        metadata={"blockedExitIds": blocked_exit_ids},
    )
    return get_map(map_id) or current


def _node_lookup(map_record: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {node["id"]: node for node in map_record.get("nodes", [])}


def _edge_list(map_record: dict[str, Any]) -> list[dict[str, Any]]:
    return list(map_record.get("edges", []))


def _heuristic(node_a: dict[str, Any], node_b: dict[str, Any]) -> float:
    floor_cost = fabs(float(node_a.get("floor", 0)) - float(node_b.get("floor", 0))) * 2
    distance = fabs(float(node_a.get("x", 0)) - float(node_b.get("x", 0))) + fabs(float(node_a.get("y", 0)) - float(node_b.get("y", 0)))
    return floor_cost + distance


def _build_adjacency(map_record: dict[str, Any], blocked_edge_ids: set[str], blocked_node_ids: set[str], crowd_by_edge_id: dict[str, float]) -> dict[str, list[tuple[str, float, str]]]:
    adjacency: dict[str, list[tuple[str, float, str]]] = {}
    for edge in _edge_list(map_record):
        if edge["id"] in blocked_edge_ids:
            continue
        if edge["from"] in blocked_node_ids or edge["to"] in blocked_node_ids:
            continue
        weight = float(edge.get("weight", 1)) + float(crowd_by_edge_id.get(edge["id"], 0))
        adjacency.setdefault(edge["from"], []).append((edge["to"], weight, edge["id"]))
        adjacency.setdefault(edge["to"], []).append((edge["from"], weight, edge["id"]))
    return adjacency


def _active_unsafe_nodes(map_record: dict[str, Any], requested_unsafe_zone_ids: list[str]) -> set[str]:
    active_ids = set(requested_unsafe_zone_ids or map_record.get("activeUnsafeZoneIds", []) or [])
    node_ids: set[str] = set()
    for zone in map_record.get("unsafeZones", []):
        if zone.get("id") in active_ids:
            node_ids.update(zone.get("nodeIds", []))
    return node_ids


def _candidate_exits(map_record: dict[str, Any], requested_exit_ids: list[str] | None, blocked_exit_ids: list[str]) -> list[dict[str, Any]]:
    node_lookup = _node_lookup(map_record)
    requested = set(requested_exit_ids or [])
    blocked = set(blocked_exit_ids or map_record.get("blockedExitIds", []) or [])
    exits = []
    for node in node_lookup.values():
        if node.get("kind") != "exit":
            continue
        if requested and node["id"] not in requested:
            continue
        if node["id"] in blocked:
            continue
        exits.append(node)
    return exits


def _a_star(map_record: dict[str, Any], origin_id: str, destination_id: str, unsafe_zone_ids: list[str], blocked_exit_ids: list[str], crowd_by_edge_id: dict[str, float]) -> dict[str, Any] | None:
    nodes = _node_lookup(map_record)
    if origin_id not in nodes or destination_id not in nodes:
        return None

    blocked_nodes = _active_unsafe_nodes(map_record, unsafe_zone_ids)
    blocked_edges: set[str] = set()
    adjacency = _build_adjacency(map_record, blocked_edges, blocked_nodes, crowd_by_edge_id)

    open_heap: list[tuple[float, str]] = [(0.0, origin_id)]
    came_from: dict[str, str] = {}
    g_score = {origin_id: 0.0}
    edge_taken: dict[str, str] = {}

    while open_heap:
        _priority, current = heapq.heappop(open_heap)
        if current == destination_id:
            path_ids = [current]
            while current in came_from:
                current = came_from[current]
                path_ids.append(current)
            path_ids.reverse()
            total_cost = g_score[destination_id]
            return {
                "cost": total_cost,
                "path": [nodes[node_id] for node_id in path_ids],
                "edges": [edge_taken[node_id] for node_id in path_ids[1:] if node_id in edge_taken],
            }

        for neighbor, weight, edge_id in adjacency.get(current, []):
            tentative = g_score[current] + weight
            if tentative < g_score.get(neighbor, float("inf")):
                came_from[neighbor] = current
                edge_taken[neighbor] = edge_id
                g_score[neighbor] = tentative
                priority = tentative + _heuristic(nodes[neighbor], nodes[destination_id])
                heapq.heappush(open_heap, (priority, neighbor))
    return None


def fetch_safe_route(
    map_id: str,
    origin_node_id: str,
    exit_ids: list[str] | None = None,
    unsafe_zone_ids: list[str] | None = None,
    blocked_exit_ids: list[str] | None = None,
    crowd_by_edge_id: dict[str, float] | None = None,
) -> dict[str, Any]:
    map_record = get_map(map_id)
    if not map_record:
        raise HTTPException(status_code=404, detail="Indoor map not found.")

    crowd = crowd_by_edge_id or {}
    exits = _candidate_exits(map_record, exit_ids, blocked_exit_ids or [])
    if not exits:
        raise HTTPException(status_code=400, detail="No safe exits are currently available.")

    ranked_routes = []
    for exit_node in exits:
        route = _a_star(
            map_record,
            origin_id=origin_node_id,
            destination_id=exit_node["id"],
            unsafe_zone_ids=unsafe_zone_ids or [],
            blocked_exit_ids=blocked_exit_ids or [],
            crowd_by_edge_id=crowd,
        )
        if route:
            ranked_routes.append({"exit": exit_node, "route": route})

    if not ranked_routes:
        raise HTTPException(status_code=400, detail="No safe route could be generated with the current conditions.")

    ranked_routes.sort(key=lambda item: item["route"]["cost"])
    primary = ranked_routes[0]
    alternates = ranked_routes[1:3]
    guidance = {
        "shortText": f"Proceed to {primary['exit']['label']} via {primary['route']['path'][1]['label'] if len(primary['route']['path']) > 1 else primary['exit']['label']}.",
        "alternateExits": [item["exit"]["label"] for item in alternates],
    }
    if primary["exit"]["id"] in set(map_record.get("blockedExitIds", [])):
        guidance["shortText"] = "Primary exit is blocked. Follow staff guidance to the alternate stairwell."
    if crowd:
        guidance["shortText"] = f"{primary['exit']['label']} has dynamic conditions. Proceed using the least crowded safe route."

    return {
        "mapId": map_id,
        "originNodeId": origin_node_id,
        "primary": primary,
        "alternates": alternates,
        "guidance": guidance,
        "conditions": {
            "unsafeZoneIds": unsafe_zone_ids or map_record.get("activeUnsafeZoneIds", []) or [],
            "blockedExitIds": blocked_exit_ids or map_record.get("blockedExitIds", []) or [],
            "crowdByEdgeId": crowd,
        },
    }
