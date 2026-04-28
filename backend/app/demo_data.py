"""
Mock/demo data used by the backend when persistent records are absent.
"""

from __future__ import annotations


DEMO_STAFF_USERS = [
    {
        "id": "staff-demo-1",
        "name": "Aarav Staff",
        "email": "staff@demo.com",
        "password": "demo1234",
        "role": "Staff",
        "venueScope": ["hotel"],
        "active": True,
    },
    {
        "id": "manager-demo-1",
        "name": "Mira Manager",
        "email": "manager@demo.com",
        "password": "demo1234",
        "role": "Manager",
        "venueScope": ["hotel", "resort"],
        "active": True,
    },
    {
        "id": "admin-demo-1",
        "name": "Asha Admin",
        "email": "admin@demo.com",
        "password": "demo1234",
        "role": "Admin",
        "venueScope": ["hotel", "airport", "hospital", "campus"],
        "active": True,
    },
]


DEMO_HOTEL_MAP = {
    "id": "demo-hotel-command-map",
    "name": "Grand Horizon Hotel Demo",
    "venueType": "hotel",
    "buildingId": "grand-horizon-main",
    "metadata": {
        "description": "Two-floor demo map for emergency routing and indoor navigation hooks.",
        "supportsFutureVenueTypes": ["airport", "hospital", "mall", "campus", "smart-city"],
        "format": "geojson-compatible",
    },
    "floors": [
        {"id": "floor-1", "level": 1, "name": "Floor 1"},
        {"id": "floor-2", "level": 2, "name": "Floor 2"},
    ],
    "nodes": [
        {"id": "f1-lobby", "label": "Lobby", "floor": 1, "kind": "hallway", "x": 0, "y": 0},
        {"id": "f1-hall-east", "label": "Hallway East", "floor": 1, "kind": "hallway", "x": 8, "y": 0},
        {"id": "stair-c-f1", "label": "Stairwell C", "floor": 1, "kind": "stairwell", "x": 4, "y": -4},
        {"id": "exit-a", "label": "Exit A", "floor": 1, "kind": "exit", "x": -6, "y": 0},
        {"id": "exit-b", "label": "Exit B", "floor": 1, "kind": "exit", "x": 12, "y": 0},
        {"id": "assembly-south", "label": "Assembly South", "floor": 0, "kind": "assembly_point", "x": 16, "y": 2},
        {"id": "f2-room-201", "label": "Room 201", "floor": 2, "kind": "room", "x": 0, "y": 6},
        {"id": "f2-room-202", "label": "Room 202", "floor": 2, "kind": "room", "x": 3, "y": 6},
        {"id": "f2-east-wing", "label": "East Wing Hallway", "floor": 2, "kind": "hallway", "x": 8, "y": 6},
        {"id": "f2-west-wing", "label": "West Wing Hallway", "floor": 2, "kind": "hallway", "x": -4, "y": 6},
        {"id": "stair-c-f2", "label": "Stairwell C", "floor": 2, "kind": "stairwell", "x": 4, "y": 2},
    ],
    "edges": [
        {"id": "edge-lobby-east", "from": "f1-lobby", "to": "f1-hall-east", "weight": 2},
        {"id": "edge-lobby-exit-a", "from": "f1-lobby", "to": "exit-a", "weight": 2},
        {"id": "edge-hall-to-exit-b", "from": "f1-hall-east", "to": "exit-b", "weight": 2},
        {"id": "edge-lobby-stair-c", "from": "f1-lobby", "to": "stair-c-f1", "weight": 2},
        {"id": "edge-stair-transition", "from": "stair-c-f1", "to": "stair-c-f2", "weight": 1},
        {"id": "edge-f2-stair-east", "from": "stair-c-f2", "to": "f2-east-wing", "weight": 2},
        {"id": "edge-f2-stair-west", "from": "stair-c-f2", "to": "f2-west-wing", "weight": 2},
        {"id": "edge-f2-east-201", "from": "f2-east-wing", "to": "f2-room-201", "weight": 1},
        {"id": "edge-f2-east-202", "from": "f2-east-wing", "to": "f2-room-202", "weight": 1},
        {"id": "edge-f1-exit-b-assembly", "from": "exit-b", "to": "assembly-south", "weight": 1},
    ],
    "unsafeZones": [
        {
            "id": "fire-zone-f2-west",
            "name": "Smoke Zone - Floor 2 West",
            "floor": 2,
            "nodeIds": ["f2-west-wing"],
            "severity": "high",
            "kind": "fire-smoke",
        }
    ],
    "blockedExitIds": ["exit-a"],
    "crowdModels": {
        "normal": {},
        "crowded-exit-b": {"edge-hall-to-exit-b": 6},
        "crowded-stair-c": {"edge-stair-transition": 7},
    },
    "geojson": {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"id": "room-201", "kind": "room", "floor": 2, "name": "Room 201"},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[77.5945, 12.9719], [77.5946, 12.9719], [77.5946, 12.9720], [77.5945, 12.9720], [77.5945, 12.9719]]],
                },
            },
            {
                "type": "Feature",
                "properties": {"id": "room-202", "kind": "room", "floor": 2, "name": "Room 202"},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[77.59461, 12.9719], [77.59471, 12.9719], [77.59471, 12.9720], [77.59461, 12.9720], [77.59461, 12.9719]]],
                },
            },
            {
                "type": "Feature",
                "properties": {"id": "stairwell-c", "kind": "stairwell", "floor": 2, "name": "Stairwell C"},
                "geometry": {"type": "Point", "coordinates": [77.5946, 12.97183]},
            },
            {
                "type": "Feature",
                "properties": {"id": "exit-b", "kind": "exit", "floor": 1, "name": "Exit B"},
                "geometry": {"type": "Point", "coordinates": [77.59475, 12.97175]},
            },
        ],
    },
}

