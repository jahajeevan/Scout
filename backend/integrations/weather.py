"""Weather integration (Phase 4) — Open-Meteo (free, no API key, no signup).

Fetches the current conditions for the configured location and maps the WMO
weather code to a short human label + emoji. Needs internet (Phase 4 features
are online by design).
"""

from __future__ import annotations

import httpx

from backend.config import WEATHER_CITY, WEATHER_LATITUDE, WEATHER_LONGITUDE

_URL = "https://api.open-meteo.com/v1/forecast"
_TIMEOUT = httpx.Timeout(8.0)

# WMO weather-code → (label, emoji). Grouped ranges collapsed to representatives.
_WMO: dict[int, tuple[str, str]] = {
    0: ("Clear", "☀️"),
    1: ("Mostly clear", "🌤️"),
    2: ("Partly cloudy", "⛅"),
    3: ("Overcast", "☁️"),
    45: ("Fog", "🌫️"),
    48: ("Rime fog", "🌫️"),
    51: ("Light drizzle", "🌦️"),
    53: ("Drizzle", "🌦️"),
    55: ("Heavy drizzle", "🌧️"),
    61: ("Light rain", "🌦️"),
    63: ("Rain", "🌧️"),
    65: ("Heavy rain", "🌧️"),
    71: ("Light snow", "🌨️"),
    73: ("Snow", "🌨️"),
    75: ("Heavy snow", "❄️"),
    80: ("Showers", "🌦️"),
    81: ("Showers", "🌧️"),
    82: ("Violent showers", "⛈️"),
    95: ("Thunderstorm", "⛈️"),
    96: ("Thunderstorm", "⛈️"),
    99: ("Severe storm", "⛈️"),
}


async def get_weather() -> dict[str, object]:
    """Return current weather for the configured city."""
    params = {
        "latitude": WEATHER_LATITUDE,
        "longitude": WEATHER_LONGITUDE,
        "current": "temperature_2m,weather_code,wind_speed_10m",
    }
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.get(_URL, params=params)
        resp.raise_for_status()
        current = resp.json().get("current", {})

    code = int(current.get("weather_code", 0))
    label, emoji = _WMO.get(code, ("Unknown", "🌡️"))
    return {
        "city": WEATHER_CITY,
        "temp_c": round(float(current.get("temperature_2m", 0.0))),
        "description": label,
        "emoji": emoji,
        "wind_kph": round(float(current.get("wind_speed_10m", 0.0))),
    }
