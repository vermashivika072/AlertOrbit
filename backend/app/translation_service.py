"""
Server-side translation service for multilingual emergency messaging.
"""

from __future__ import annotations

from html import unescape
from typing import Any

import httpx

from app.audit_service import log_audit_event
from app.config import settings


GOOGLE_TRANSLATE_URL = "https://translation.googleapis.com/language/translate/v2"
SUPPORTED_TRANSLATION_CODES = ("en", "hi", "ar", "zh-CN", "fr")
LANGUAGE_NAME_MAP = {
    "en": "english",
    "hi": "hindi",
    "ar": "arabic",
    "zh-CN": "chinese",
    "fr": "french",
}


def normalize_languages(target_languages: list[str] | None) -> list[str]:
    languages = target_languages or list(SUPPORTED_TRANSLATION_CODES)
    normalized = []
    for code in languages:
        if code in SUPPORTED_TRANSLATION_CODES and code not in normalized:
            normalized.append(code)
    return normalized or list(SUPPORTED_TRANSLATION_CODES)


async def translate_text(
    text: str,
    target_languages: list[str] | None = None,
    source_language: str = "en",
) -> dict[str, dict[str, Any]]:
    languages = normalize_languages(target_languages)
    log_audit_event(
        category="translation",
        action="preview_requested",
        metadata={"languages": languages, "sourceLanguage": source_language},
    )

    if not settings.google_translate_api_key:
        return {
            language: {
                "text": text,
                "status": "fallback",
                "reason": "GOOGLE_TRANSLATE_API_KEY is not configured on the server.",
            }
            for language in languages
        }

    translations: dict[str, dict[str, Any]] = {}
    async with httpx.AsyncClient(timeout=10.0) as client:
        for language in languages:
            if language == source_language:
                translations[language] = {"text": text, "status": "source"}
                continue

            response = await client.post(
                GOOGLE_TRANSLATE_URL,
                params={"key": settings.google_translate_api_key},
                json={
                    "q": text,
                    "target": language,
                    "source": source_language,
                    "format": "text",
                },
            )
            response.raise_for_status()
            payload = response.json()
            translated = payload.get("data", {}).get("translations", [{}])[0].get("translatedText", text)
            translations[language] = {
                "text": unescape(translated),
                "status": "translated",
            }

    return translations


async def build_preview_response(
    message: str,
    target_languages: list[str] | None = None,
    source_language: str = "en",
) -> dict[str, Any]:
    translations = await translate_text(message, target_languages, source_language)
    named_translations = {
        LANGUAGE_NAME_MAP.get(code, code): payload.get("text", "")
        for code, payload in translations.items()
    }
    return {
        "sourceLanguage": source_language,
        "message": message,
        "translations": translations,
        **named_translations,
    }

