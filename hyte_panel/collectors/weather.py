"""Weather from Open-Meteo (no API key)."""

from __future__ import annotations

import time
from typing import Any

import httpx

from ..config import WeatherConfig

# WMO weather interpretation codes -> (description, icon key)
WMO_CODES: dict[int, tuple[str, str]] = {
    0: ("Clear sky", "sun"),
    1: ("Mainly clear", "sun"),
    2: ("Partly cloudy", "cloud-sun"),
    3: ("Overcast", "cloud"),
    45: ("Fog", "fog"),
    48: ("Rime fog", "fog"),
    51: ("Light drizzle", "drizzle"),
    53: ("Drizzle", "drizzle"),
    55: ("Heavy drizzle", "drizzle"),
    56: ("Freezing drizzle", "sleet"),
    57: ("Freezing drizzle", "sleet"),
    61: ("Light rain", "rain"),
    63: ("Rain", "rain"),
    65: ("Heavy rain", "rain"),
    66: ("Freezing rain", "sleet"),
    67: ("Freezing rain", "sleet"),
    71: ("Light snow", "snow"),
    73: ("Snow", "snow"),
    75: ("Heavy snow", "snow"),
    77: ("Snow grains", "snow"),
    80: ("Rain showers", "rain"),
    81: ("Rain showers", "rain"),
    82: ("Violent showers", "rain"),
    85: ("Snow showers", "snow"),
    86: ("Snow showers", "snow"),
    95: ("Thunderstorm", "storm"),
    96: ("Thunderstorm, hail", "storm"),
    99: ("Thunderstorm, hail", "storm"),
}


def describe(code: int | None) -> tuple[str, str]:
    if code is None:
        return ("Unknown", "cloud")
    return WMO_CODES.get(int(code), ("Unknown", "cloud"))


def build_url(cfg: WeatherConfig) -> str:
    unit_q = ""
    if cfg.units == "imperial":
        unit_q = "&temperature_unit=fahrenheit&wind_speed_unit=mph"
    return (
        "https://api.open-meteo.com/v1/forecast"
        f"?latitude={cfg.latitude}&longitude={cfg.longitude}"
        "&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m"
        "&daily=weather_code,temperature_2m_max,temperature_2m_min"
        f"&timezone=auto&forecast_days=5{unit_q}"
    )


def parse_forecast(data: dict[str, Any], cfg: WeatherConfig) -> dict[str, Any]:
    cur = data.get("current", {}) or {}
    daily = data.get("daily", {}) or {}
    desc, icon = describe(cur.get("weather_code"))
    days = []
    dates = daily.get("time", []) or []
    for i, day in enumerate(dates):
        d_desc, d_icon = describe((daily.get("weather_code") or [None] * len(dates))[i])
        days.append(
            {
                "date": day,
                "icon": d_icon,
                "description": d_desc,
                "max": (daily.get("temperature_2m_max") or [None] * len(dates))[i],
                "min": (daily.get("temperature_2m_min") or [None] * len(dates))[i],
            }
        )
    return {
        "ok": True,
        "label": cfg.label,
        "units": cfg.units,
        "temp": cur.get("temperature_2m"),
        "feels_like": cur.get("apparent_temperature"),
        "humidity": cur.get("relative_humidity_2m"),
        "wind": cur.get("wind_speed_10m"),
        "code": cur.get("weather_code"),
        "description": desc,
        "icon": icon,
        "daily": days,
        "fetched_at": time.time(),
    }


class WeatherCollector:
    def __init__(self, cfg: WeatherConfig) -> None:
        self.cfg = cfg
        self.data: dict[str, Any] = {"ok": False, "error": "not fetched yet", "label": cfg.label}
        self._next_fetch = 0.0

    @property
    def due(self) -> bool:
        return self.cfg.enabled and time.monotonic() >= self._next_fetch

    async def refresh(self, client: httpx.AsyncClient | None = None) -> dict[str, Any]:
        if not self.cfg.enabled:
            self.data = {"ok": False, "error": "disabled", "label": self.cfg.label}
            return self.data
        own = client is None
        client = client or httpx.AsyncClient(timeout=10)
        try:
            r = await client.get(build_url(self.cfg))
            r.raise_for_status()
            self.data = parse_forecast(r.json(), self.cfg)
            self._next_fetch = time.monotonic() + max(1, self.cfg.refresh_minutes) * 60
        except Exception as exc:  # network errors, bad JSON
            self.data = {**self.data, "ok": self.data.get("ok", False), "error": str(exc), "label": self.cfg.label}
            self._next_fetch = time.monotonic() + 60
        finally:
            if own:
                await client.aclose()
        return self.data
