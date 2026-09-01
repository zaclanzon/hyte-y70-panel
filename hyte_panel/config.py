"""Configuration loading with defaults."""

from __future__ import annotations

import os
import tomllib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


def default_config_path() -> Path:
    base = os.environ.get("XDG_CONFIG_HOME") or str(Path.home() / ".config")
    return Path(base) / "hyte-panel" / "config.toml"


@dataclass
class ServerConfig:
    host: str = "127.0.0.1"
    port: int = 8787
    refresh_seconds: float = 1.0


@dataclass
class DisplayConfig:
    width: int = 720
    height: int = 2560
    connector: str = ""
    backend: str = "auto"
    chromium: str = ""
    dim_after_seconds: int = 0


@dataclass
class WeatherConfig:
    enabled: bool = True
    label: str = ""
    latitude: float = 0.0
    longitude: float = 0.0
    units: str = "metric"
    refresh_minutes: int = 15


@dataclass
class HardwareConfig:
    gpu: bool = True
    disks: list[str] = field(default_factory=lambda: ["/"])
    network_interface: str = ""


@dataclass
class AgentsConfig:
    enabled: bool = True
    scan_processes: bool = True
    process_patterns: list[str] = field(
        default_factory=lambda: ["claude", "codex", "aider", "gemini", "cursor-agent", "copilot", "goose"]
    )
    stale_seconds: int = 900


@dataclass
class AppButton:
    name: str
    icon: str = "app"
    desktop_id: str = ""
    command: str = ""

    def to_public(self, index: int) -> dict[str, Any]:
        return {"index": index, "name": self.name, "icon": self.icon}


@dataclass
class Config:
    server: ServerConfig = field(default_factory=ServerConfig)
    display: DisplayConfig = field(default_factory=DisplayConfig)
    weather: WeatherConfig = field(default_factory=WeatherConfig)
    hardware: HardwareConfig = field(default_factory=HardwareConfig)
    agents: AgentsConfig = field(default_factory=AgentsConfig)
    apps: list[AppButton] = field(default_factory=list)
    source: str = "defaults"

    @property
    def url(self) -> str:
        return f"http://{self.server.host}:{self.server.port}/"


def _fill(cls, data: dict[str, Any] | None):
    """Build a dataclass from a dict, ignoring unknown keys."""
    data = data or {}
    known = {f for f in cls.__dataclass_fields__}
    return cls(**{k: v for k, v in data.items() if k in known})


def parse_config(raw: dict[str, Any], source: str = "dict") -> Config:
    apps: list[AppButton] = []
    for entry in raw.get("apps", []) or []:
        if not isinstance(entry, dict) or not entry.get("name"):
            continue
        apps.append(_fill(AppButton, entry))
    cfg = Config(
        server=_fill(ServerConfig, raw.get("server")),
        display=_fill(DisplayConfig, raw.get("display")),
        weather=_fill(WeatherConfig, raw.get("weather")),
        hardware=_fill(HardwareConfig, raw.get("hardware")),
        agents=_fill(AgentsConfig, raw.get("agents")),
        apps=apps,
        source=source,
    )
    cfg.server.refresh_seconds = max(0.25, float(cfg.server.refresh_seconds))
    if cfg.weather.units not in ("metric", "imperial"):
        cfg.weather.units = "metric"
    return cfg


def load_config(path: str | os.PathLike | None = None) -> Config:
    """Load the TOML config file. Missing file = defaults plus the example apps."""
    p = Path(path) if path else default_config_path()
    if p.is_file():
        with p.open("rb") as fh:
            return parse_config(tomllib.load(fh), source=str(p))
    example = Path(__file__).resolve().parent.parent / "config.example.toml"
    if example.is_file():
        with example.open("rb") as fh:
            cfg = parse_config(tomllib.load(fh), source=f"{example} (example)")
            return cfg
    return Config()
