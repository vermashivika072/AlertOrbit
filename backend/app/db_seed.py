"""
Demo-friendly seed data for the SQL-backed emergency module.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.db_models import Alert, EmergencyEvent, Floor, Room, User


def seed_database(db: Session) -> None:
    _seed_users(db)
    _seed_floors_and_rooms(db)
    _seed_alerts(db)
    db.commit()


def _seed_users(db: Session) -> None:
    if db.query(User).first():
        return

    db.add_all(
        [
            User(name="Demo Staff", email="staff@alertorbit.demo"),
            User(name="Operations Lead", email="opslead@alertorbit.demo"),
            User(name="Security Chief", email="security@alertorbit.demo"),
        ]
    )


def _seed_floors_and_rooms(db: Session) -> None:
    if db.query(Floor).first():
        return

    floors = [
        Floor(
            name="Lobby Deck",
            floor_number=1,
            metadata_json={"theme": "arrival", "safe_zone": "Lobby Assembly Plaza"},
        ),
        Floor(
            name="Guest Suites",
            floor_number=2,
            metadata_json={"theme": "hospitality", "safe_zone": "East Courtyard"},
        ),
        Floor(
            name="Executive Wing",
            floor_number=3,
            metadata_json={"theme": "premium", "safe_zone": "Skyline Terrace"},
        ),
    ]
    db.add_all(floors)
    db.flush()

    room_specs = {
        1: [
            ("101", "Lobby", "lobby", 72, 88, False, False, False),
            ("102", "Restaurant", "restaurant", 134, 74, False, False, False),
            ("103", "Kitchen", "kitchen", 188, 74, False, False, False),
            ("104", "Lounge", "lounge", 92, 144, False, False, False),
            ("105", "Operations Room", "operations", 196, 144, False, False, False),
            ("106", "Conference Hall", "conference", 248, 126, False, False, False),
            ("1E-A", "North Safe Exit", "exit", 282, 108, True, False, False),
            ("1S-A", "Main Staircase", "staircase", 154, 188, False, True, False),
            ("1L-A", "Central Elevator", "elevator", 218, 188, False, False, True),
        ],
        2: [
            ("201", "Guest Room 201", "guest_room", 78, 82, False, False, False),
            ("202", "Guest Room 202", "guest_room", 138, 82, False, False, False),
            ("203", "Guest Room 203", "guest_room", 198, 82, False, False, False),
            ("214", "Operations Annex", "operations", 110, 148, False, False, False),
            ("232", "Conference Hall 2A", "conference", 226, 142, False, False, False),
            ("2E-A", "East Fire Exit", "exit", 286, 110, True, False, False),
            ("2S-A", "West Staircase", "staircase", 148, 190, False, True, False),
            ("2L-A", "Guest Elevator", "elevator", 214, 190, False, False, True),
        ],
        3: [
            ("301", "Executive Suite 301", "guest_room", 76, 82, False, False, False),
            ("302", "Executive Suite 302", "guest_room", 136, 82, False, False, False),
            ("308", "Executive Pantry", "operations", 198, 82, False, False, False),
            ("318", "Sky Lounge", "lounge", 110, 146, False, False, False),
            ("326", "Boardroom", "conference", 224, 144, False, False, False),
            ("3E-A", "Sky Exit", "exit", 286, 110, True, False, False),
            ("3S-A", "West Staircase", "staircase", 148, 192, False, True, False),
            ("3L-A", "Executive Elevator", "elevator", 216, 192, False, False, True),
        ],
    }

    for floor in floors:
        for room_number, name, room_type, x_coord, y_coord, is_exit, is_staircase, is_elevator in room_specs[floor.floor_number]:
            db.add(
                Room(
                    floor_id=floor.id,
                    room_number=room_number,
                    name=name,
                    room_type=room_type,
                    x_coord=x_coord,
                    y_coord=y_coord,
                    is_exit=is_exit,
                    is_staircase=is_staircase,
                    is_elevator=is_elevator,
                    metadata_json={"zone": floor.name},
                )
            )


def _seed_alerts(db: Session) -> None:
    if db.query(Alert).first():
        return

    rooms = {room.room_number: room for room in db.query(Room).all()}
    base_time = datetime.utcnow()
    seeds = [
        {
            "alert_id": "ALR-3008",
            "crisis_type": "Fire",
            "severity": "Critical",
            "room_number": "308",
            "floor_number": 3,
            "reported_by": "Night Manager",
            "status": "Evacuating",
            "assigned_response_team": "Fire & Rescue Unit",
            "evacuation_status": "Primary Evacuation",
            "route_status": "blocked",
            "nearest_safe_exit": "Sky Exit",
            "details": "Smoke migrated from the executive pantry into the central corridor.",
            "occurred_at": base_time - timedelta(minutes=14),
        },
        {
            "alert_id": "ALR-2214",
            "crisis_type": "Gas Leak",
            "severity": "High",
            "room_number": "214",
            "floor_number": 2,
            "reported_by": "Engineering Desk",
            "status": "Investigating",
            "assigned_response_team": "HazMat Response Team",
            "evacuation_status": "Assessment In Progress",
            "route_status": "caution",
            "nearest_safe_exit": "East Fire Exit",
            "details": "Pressure irregularity detected near the service branch line.",
            "occurred_at": base_time - timedelta(minutes=48),
        },
        {
            "alert_id": "ALR-1104",
            "crisis_type": "Smoke Detection",
            "severity": "High",
            "room_number": "104",
            "floor_number": 1,
            "reported_by": "Lobby Concierge",
            "status": "Escalated",
            "assigned_response_team": "Building Safety Unit",
            "evacuation_status": "Priority Sweep",
            "route_status": "caution",
            "nearest_safe_exit": "North Safe Exit",
            "details": "A haze event was reported inside the lounge soffit near the lobby.",
            "occurred_at": base_time - timedelta(minutes=84),
        },
    ]

    for seed in seeds:
        room = rooms.get(seed["room_number"])
        preview = _build_preview(seed["floor_number"], seed["room_number"], seed["route_status"])
        alert = Alert(
            room_id=room.id if room else None,
            route_preview=preview,
            responder_status=[
                {"name": "Command AI", "role": "Route Intelligence", "state": "Tracking occupant flow"},
                {"name": seed["assigned_response_team"], "role": "Primary Team", "state": "En route"},
            ],
            timeline=[
                {"label": "Alert Ingested", "detail": seed["details"], "at": seed["occurred_at"].isoformat()},
                {"label": "AI Route Generated", "detail": f"Exit guidance prepared for {seed['nearest_safe_exit']}.", "at": (seed["occurred_at"] + timedelta(minutes=2)).isoformat()},
            ],
            metadata_json={"zone": f"Floor {seed['floor_number']}"},
            created_at=seed["occurred_at"],
            updated_at=seed["occurred_at"],
            **seed,
        )
        db.add(alert)
        db.flush()
        db.add(
            EmergencyEvent(
                event_code=f"EVT-{seed['alert_id']}",
                alert_id=alert.id,
                event_type=seed["crisis_type"],
                started_at=seed["occurred_at"],
                nearest_safe_exit=seed["nearest_safe_exit"],
                route_steps=[
                    f"Exit room {seed['room_number']} through the guided corridor.",
                    "Follow illuminated arrows to the protected staging zone.",
                ],
                blocked_paths=["west-corridor"] if seed["route_status"] == "blocked" else [],
                safe_zones=[seed["nearest_safe_exit"]],
                simulation_state={"mode": "demo", "rerouting": seed["route_status"] != "safe"},
                metadata_json={"demo": True},
            )
        )


def _build_preview(floor_number: int, room_number: str, route_status: str) -> dict:
    return {
        "floorNumber": floor_number,
        "roomNumber": room_number,
        "routeStatus": route_status,
        "distanceMeters": 40 + floor_number * 9,
        "etaMinutes": floor_number,
        "points": [
            {"x": 88, "y": 94},
            {"x": 88, "y": 112},
            {"x": 184, "y": 112},
            {"x": 276, "y": 112},
        ],
        "blockedSegments": [{"x1": 168, "y1": 112, "x2": 216, "y2": 112}] if route_status == "blocked" else [],
    }
