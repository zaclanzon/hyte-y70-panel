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
class ThemeConfig:
    """Where the two accent colors come from. See collectors/theme.py."""
    source: str = "auto"        # auto | file | openrgb | static
    # file: a JSON file written by a lighting tool; two keys hold RGB triples.
    file: str = ""
    file_keys: list[str] = field(default_factory=lambda: ["primary", "secondary"])
    # openrgb: the OpenRGB SDK server. Read only.
    openrgb_host: str = "127.0.0.1"
    openrgb_port: int = 6742
    # static: a preset name (ember, aurora, sunset, ice, mono) or two colors.
    preset: str = ""
    primary: list[int] = field(default_factory=lambda: [255, 0, 0])
    secondary: list[int] = field(default_factory=lambda: [0, 0, 255])


def _theme_compat(raw: dict[str, Any] | None) -> dict[str, Any]:
    """Map the pre-0.2 keys (follow_runway, runway_config) onto the new ones."""
    raw = dict(raw or {})
    if "follow_runway" in raw or "runway_config" in raw:
        follow = raw.pop("follow_runway", True)
        path = raw.pop("runway_config", "") or "~/.config/rgb-runway.json"
        raw.setdefault("source", "file" if follow else "static")
        raw.setdefault("file", path)
        raw.setdefault("file_keys", ["base_color", "stripe_color"])
    return raw


@dataclass
class AutomataConfig:
    """Cellular automata card (static/ca). Replaces the app buttons card."""
    enabled: bool = True
    rule: str = "life"          # starting rule id, see static/ca/core.js RULES
    cell: int = 2               # device pixels per cell
    attract_idle_seconds: int = 45     # idle time before the card starts rotating rules; 0 = never
    attract_rotate_seconds: int = 120  # how long each rule runs in attract mode
    reactive: bool = True       # CPU, network and agent activity feed the world


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
    theme: ThemeConfig = field(default_factory=ThemeConfig)
    automata: AutomataConfig = field(default_factory=AutomataConfig)
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
        theme=_fill(ThemeConfig, _theme_compat(raw.get("theme"))),
        automata=_fill(AutomataConfig, raw.get("automata")),
        apps=apps,
        source=source,
    )
    cfg.server.refresh_seconds = max(0.25, float(cfg.server.refresh_seconds))
    if cfg.weather.units not in ("metric", "imperial"):
        cfg.weather.units = "metric"
    cfg.automata.cell = max(1, min(8, int(cfg.automata.cell)))
    if cfg.theme.source not in ("auto", "file", "openrgb", "static"):
        cfg.theme.source = "auto"
    if not (isinstance(cfg.theme.file_keys, list) and len(cfg.theme.file_keys) == 2):
        cfg.theme.file_keys = ["primary", "secondary"]
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
