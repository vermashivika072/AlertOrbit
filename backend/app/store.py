"""
Storage abstraction for AlertOrbit backend services.

Uses Cloud Firestore when Firebase is initialized.
Falls back to SQLite-backed records and finally in-memory storage for local demos.
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any
from uuid import uuid4

import firebase_admin
from firebase_admin import firestore
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.db_models import StoreRecord


_MEMORY_DB: dict[str, Any] = {}


def _split_path(path: str) -> list[str]:
    return [segment for segment in str(path or "").strip("/").split("/") if segment]


def _parse_collection_path(path: str) -> tuple[str | None, str | None]:
    parts = _split_path(path)
    if not parts:
        return None, None
    collection = parts[0]
    record_key = "/".join(parts[1:]) if len(parts) > 1 else None
    return collection, record_key


def _get_memory_container(path: str, create: bool = False) -> tuple[dict[str, Any] | None, str | None]:
    parts = _split_path(path)
    if not parts:
        return _MEMORY_DB, None

    node: dict[str, Any] = _MEMORY_DB
    for segment in parts[:-1]:
        child = node.get(segment)
        if child is None:
            if not create:
                return None, None
            child = {}
            node[segment] = child
        if not isinstance(child, dict):
            if not create:
                return None, None
            child = {}
            node[segment] = child
        node = child
    return node, parts[-1]


class DataStore:
    def uses_firestore(self) -> bool:
        return bool(firebase_admin._apps)

    def _firestore(self):
        return firestore.client()

    def _get_record(self, db_session: Session, collection: str, record_key: str) -> StoreRecord | None:
        return (
            db_session.query(StoreRecord)
            .filter(StoreRecord.collection == collection, StoreRecord.record_key == record_key)
            .first()
        )

    def _serialize_collection(self, db_session: Session, collection: str) -> dict[str, Any]:
        records = (
            db_session.query(StoreRecord)
            .filter(StoreRecord.collection == collection)
            .order_by(StoreRecord.created_at.asc(), StoreRecord.id.asc())
            .all()
        )
        return {record.record_key: deepcopy(record.payload) for record in records}

    def get(self, path: str, default: Any = None) -> Any:
        collection, record_key = _parse_collection_path(path)

        if self.uses_firestore() and collection:
            client = self._firestore()
            if record_key:
                snapshot = client.collection(collection).document(record_key).get()
                if not snapshot.exists:
                    return deepcopy(default)
                return snapshot.to_dict()

            docs = client.collection(collection).stream()
            result: dict[str, Any] = {}
            for doc in docs:
                result[doc.id] = doc.to_dict()
            return result

        if collection:
            with SessionLocal() as db_session:
                if record_key:
                    record = self._get_record(db_session, collection, record_key)
                    if record is None:
                        return deepcopy(default)
                    return deepcopy(record.payload)
                return self._serialize_collection(db_session, collection)

        if not _split_path(path):
            return deepcopy(_MEMORY_DB)
        container, key = _get_memory_container(path)
        if container is None or key is None or key not in container:
            return deepcopy(default)
        return deepcopy(container[key])

    def set(self, path: str, value: Any) -> Any:
        collection, record_key = _parse_collection_path(path)

        if self.uses_firestore() and collection:
            client = self._firestore()
            if record_key:
                client.collection(collection).document(record_key).set(deepcopy(value))
                return value

            if isinstance(value, dict):
                for item_key, item_value in value.items():
                    client.collection(collection).document(str(item_key)).set(deepcopy(item_value))
            return value

        if collection:
            with SessionLocal() as db_session:
                if record_key:
                    record = self._get_record(db_session, collection, record_key)
                    if record is None:
                        record = StoreRecord(collection=collection, record_key=record_key, payload=deepcopy(value))
                        db_session.add(record)
                    else:
                        record.payload = deepcopy(value)
                    db_session.commit()
                    return value

                if isinstance(value, dict):
                    db_session.query(StoreRecord).filter(StoreRecord.collection == collection).delete()
                    for item_key, item_value in value.items():
                        db_session.add(
                            StoreRecord(
                                collection=collection,
                                record_key=str(item_key),
                                payload=deepcopy(item_value),
                            )
                        )
                    db_session.commit()
                return value

        container, key = _get_memory_container(path, create=True)
        if key is None:
            if isinstance(value, dict):
                _MEMORY_DB.clear()
                _MEMORY_DB.update(deepcopy(value))
            return value
        container[key] = deepcopy(value)
        return value

    def update(self, path: str, patch: dict[str, Any]) -> dict[str, Any]:
        patch = deepcopy(patch)
        collection, record_key = _parse_collection_path(path)

        if self.uses_firestore() and collection and record_key:
            self._firestore().collection(collection).document(record_key).set(patch, merge=True)
            return patch

        if collection and record_key:
            with SessionLocal() as db_session:
                record = self._get_record(db_session, collection, record_key)
                current = deepcopy(record.payload) if record else {}
                if not isinstance(current, dict):
                    current = {}
                current.update(patch)
                if record is None:
                    db_session.add(StoreRecord(collection=collection, record_key=record_key, payload=current))
                else:
                    record.payload = current
                db_session.commit()
            return patch

        current = self.get(path, default={}) or {}
        if not isinstance(current, dict):
            current = {}
        current.update(patch)
        self.set(path, current)
        return patch

    def push(self, path: str, value: Any) -> str:
        collection, record_key = _parse_collection_path(path)

        if self.uses_firestore() and collection:
            assigned_key = record_key or str(uuid4())
            self._firestore().collection(collection).document(assigned_key).set(deepcopy(value))
            return assigned_key

        if collection:
            assigned_key = record_key or str(uuid4())
            with SessionLocal() as db_session:
                record = self._get_record(db_session, collection, assigned_key)
                if record is None:
                    db_session.add(
                        StoreRecord(
                            collection=collection,
                            record_key=assigned_key,
                            payload=deepcopy(value),
                        )
                    )
                else:
                    record.payload = deepcopy(value)
                db_session.commit()
            return assigned_key

        current = self.get(path, default={}) or {}
        if not isinstance(current, dict):
            current = {}
        record_id = str(uuid4())
        current[record_id] = deepcopy(value)
        self.set(path, current)
        return record_id

    def delete(self, path: str) -> None:
        collection, record_key = _parse_collection_path(path)

        if self.uses_firestore() and collection:
            client = self._firestore()
            if record_key:
                client.collection(collection).document(record_key).delete()
                return
            for doc in client.collection(collection).stream():
                doc.reference.delete()
            return

        if collection:
            with SessionLocal() as db_session:
                query = db_session.query(StoreRecord).filter(StoreRecord.collection == collection)
                if record_key:
                    query = query.filter(StoreRecord.record_key == record_key)
                query.delete()
                db_session.commit()
            return

        container, key = _get_memory_container(path)
        if container is not None and key in container:
            container.pop(key, None)


store = DataStore()
