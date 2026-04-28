"""
Centralized backend configuration for AlertOrbit.

Environment variables stay server-side only. Frontend code should never read
or embed these values directly.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote_plus

from dotenv import load_dotenv


ENV_PATH = Path(__file__).resolve().parents[1] / ".env"
load_dotenv(ENV_PATH)


@dataclass(frozen=True)
class Settings:
    app_name: str = "AlertOrbit Backend"
    app_env: str = os.getenv("BACKEND_ENV", "development")
    jwt_secret: str = os.getenv("JWT_SECRET", "alertorbit-dev-secret-change-me")
    jwt_issuer: str = os.getenv("JWT_ISSUER", "alertorbit-backend")
    jwt_audience: str = os.getenv("JWT_AUDIENCE", "alertorbit-staff")
    access_token_expires_minutes: int = int(os.getenv("ACCESS_TOKEN_EXPIRES_MINUTES", "480"))
    google_translate_api_key: str = (
        os.getenv("GOOGLE_TRANSLATE_API_KEY")
        or os.getenv("GOOGLE_CLOUD_TRANSLATION_API_KEY")
        or ""
    )
    map_api_key: str = os.getenv("MAP_API_KEY", "")
    twilio_api_key: str = os.getenv("TWILIO_API_KEY", "")
    database_url: str = os.getenv("DATABASE_URL", "")
    firebase_database_url: str = os.getenv("FIREBASE_DATABASE_URL", "")
    firebase_api_key: str = os.getenv("FIREBASE_API_KEY", "")
    firebase_project_id: str = os.getenv("FIREBASE_PROJECT_ID", "")
    firebase_app_id: str = os.getenv("FIREBASE_APP_ID", "")
    firebase_auth_domain: str = os.getenv("FIREBASE_AUTH_DOMAIN", "")
    db_host: str = os.getenv("DB_HOST", "")
    db_port: str = os.getenv("DB_PORT", "5432")
    db_user: str = os.getenv("DB_USER", "")
    db_password: str = os.getenv("DB_PASSWORD", "")
    db_name: str = os.getenv("DB_NAME", "")
    socket_port: int = int(os.getenv("SOCKET_PORT", "8000"))
    service_account_key_path: str = os.getenv("SERVICE_ACCOUNT_KEY_PATH", "serviceAccountKey.json")
    firestore_alerts_collection: str = os.getenv("FIRESTORE_ALERTS_COLLECTION", "emergencies")
    firestore_staff_collection: str = os.getenv("FIRESTORE_STAFF_COLLECTION", "staff")
    firestore_logs_collection: str = os.getenv("FIRESTORE_LOGS_COLLECTION", "logs")
    allow_demo_auth: bool = os.getenv("DEMO_AUTH_ENABLED", "true").lower() in {"1", "true", "yes"}

    @property
    def sqlalchemy_database_uri(self) -> str:
        if self.database_url:
            return self.database_url
        if self.db_host and self.db_user and self.db_name:
            password = quote_plus(self.db_password)
            return f"postgresql+psycopg2://{self.db_user}:{password}@{self.db_host}:{self.db_port}/{self.db_name}"
        return "sqlite:///./alertorbit_demo.db"

    @property
    def firebase_url(self) -> str:
        return self.firebase_database_url

    @property
    def using_postgres(self) -> bool:
        return self.sqlalchemy_database_uri.startswith("postgresql")


settings = Settings()
