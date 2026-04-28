import os

from dotenv import load_dotenv
from google import genai

load_dotenv()

API_KEY = os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")
client = genai.Client(api_key=API_KEY) if API_KEY else None
MODEL_NAME = "gemini-2.0-flash"


def triage_incident(incident_details: str, room_number: str | int | None = None) -> dict:
    """Analyze an incident and return a normalized triage payload."""
    try:
        if not client:
            raise RuntimeError("Gemini API key is missing.")

        location_hint = f"Room number: {room_number}\n" if room_number is not None else ""
        prompt = f"""You are an emergency triage assistant for a hotel.
Analyze this incident and respond as compact JSON with keys:
type, severity, summary, action

Incident details:
{location_hint}{incident_details}
"""
        response = client.models.generate_content(
            model=MODEL_NAME,
            contents=prompt,
        )
        text = response.text or ""
        severity = "medium"
        incident_type = "Other"
        if "critical" in text.lower():
            severity = "critical"
        elif "high" in text.lower():
            severity = "high"
        elif "low" in text.lower():
            severity = "low"

        if "fire" in text.lower():
            incident_type = "Fire"
        elif "medical" in text.lower():
            incident_type = "Medical"
        elif "security" in text.lower():
            incident_type = "Security"
        elif "maintenance" in text.lower():
            incident_type = "Maintenance"

        return {
            "type": incident_type,
            "severity": severity,
            "summary": incident_details[:140],
            "action": text.strip() or "Manual review required.",
        }
    except Exception as e:
        print(f"Gemini triage error: {e}")
        return {
            "type": "Other",
            "severity": "medium",
            "summary": incident_details[:140],
            "action": "Manual review required.",
        }


def generate_911_brief(
    incident_summary: str,
    severity: str | int | None = None,
    room_number: str | int | None = None,
    people_involved: int | None = None,
) -> str:
    """Generate a concise 911 dispatch brief."""
    try:
        if not client:
            raise RuntimeError("Gemini API key is missing.")

        context_parts = []
        if severity is not None:
            context_parts.append(f"Severity: {severity}")
        if room_number is not None:
            context_parts.append(f"Location/Room: {room_number}")
        if people_involved is not None:
            context_parts.append(f"People involved: {people_involved}")

        prompt = f"""Generate a clear, concise 911 dispatch brief (max 4 sentences).
Include: location, nature of emergency, number of people involved, urgency.

Incident:
{incident_summary}
{" ".join(context_parts)}
"""
        response = client.models.generate_content(
            model=MODEL_NAME,
            contents=prompt,
        )
        return response.text or "Dispatch immediately based on raw incident report."
    except Exception as e:
        print(f"Gemini 911 brief error: {e}")
        return "Unable to generate brief. Please dispatch immediately based on raw incident report."
