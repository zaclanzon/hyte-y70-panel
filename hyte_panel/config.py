"""Configuration loading with defaults."""

from __future__ import annotations

import json
import os
import re
import tomllib
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

# Every card the page can show, in the default order. layout.widgets picks
# which ones appear and how they are ordered.
WIDGET_IDS = ["clock", "weather", "cpu", "gpu", "memory", "network", "agents", "automata", "apps"]
DEFAULT_WIDGETS = ["clock", "weather", "cpu", "gpu", "memory", "network", "agents", "automata"]
# Ambient backgrounds behind the glass, in the order the settings page lists
# them. The shaders live in static/ambient.js (DESIGNS).
BACKGROUNDS = ["liquid", "ribbons", "bokeh", "caustics", "ink", "satin", "coral", "lava", "shafts", "contours", "hex"]


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
    # The animated ground behind the cards; one of BACKGROUNDS.
    background: str = "liquid"


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
    # Cell colors as #rrggbb. Set from the wheel on the settings page.
    primary: str = "#ffe28a"    # long-lived cells
    secondary: str = "#7dffc5"  # newborn cells
    blend: str = "#f4f7ff"      # dying cells and trails


@dataclass
class LayoutConfig:
    """Which cards the page shows, top to bottom. Cards not listed are hidden."""
    widgets: list[str] = field(default_factory=lambda: list(DEFAULT_WIDGETS))


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
    layout: LayoutConfig = field(default_factory=LayoutConfig)
    apps: list[AppButton] = field(default_factory=list)
    source: str = "defaults"
    path: str = ""  # where saved settings go; empty = default_config_path()

    def shows(self, widget: str) -> bool:
        return widget in self.layout.widgets

    @property
    def url(self) -> str:
        return f"http://{self.server.host}:{self.server.port}/"


def _fill(cls, data: dict[str, Any] | None):
    """Build a dataclass from a dict, ignoring unknown keys."""
    data = data or {}
    known = {f for f in cls.__dataclass_fields__}
    return cls(**{k: v for k, v in data.items() if k in known})


def _is_hex_color(v: Any) -> bool:
    return isinstance(v, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", v) is not None


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
        layout=_fill(LayoutConfig, raw.get("layout")),
        apps=apps,
        source=source,
    )
    cfg.server.refresh_seconds = max(0.25, float(cfg.server.refresh_seconds))
    if cfg.weather.units not in ("metric", "imperial"):
        cfg.weather.units = "metric"
    cfg.automata.cell = max(1, min(8, int(cfg.automata.cell)))
    for key in ("primary", "secondary", "blend"):
        if not _is_hex_color(getattr(cfg.automata, key)):
            setattr(cfg.automata, key, getattr(AutomataConfig, key))
    if cfg.theme.source not in ("auto", "file", "openrgb", "static"):
        cfg.theme.source = "auto"
    if cfg.theme.background not in BACKGROUNDS:
        cfg.theme.background = "liquid"
    if not (isinstance(cfg.theme.file_keys, list) and len(cfg.theme.file_keys) == 2):
        cfg.theme.file_keys = ["primary", "secondary"]
    seen: list[str] = []
    for w in cfg.layout.widgets if isinstance(cfg.layout.widgets, list) else []:
        if isinstance(w, str) and w in WIDGET_IDS and w not in seen:
            seen.append(w)
    cfg.layout.widgets = seen
    return cfg


def config_to_dict(cfg: Config) -> dict[str, Any]:
    """The editable settings as plain data, in TOML section order."""
    out: dict[str, Any] = {}
    for name in ("server", "display", "weather", "hardware", "agents", "theme", "automata", "layout"):
        out[name] = asdict(getattr(cfg, name))
    out["apps"] = [asdict(a) for a in cfg.apps]
    return out


def _toml_value(v: Any) -> str:
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return repr(v)
    if isinstance(v, str):
        return json.dumps(v, ensure_ascii=False)  # a JSON string is a valid TOML basic string
    if isinstance(v, (list, tuple)):
        return "[" + ", ".join(_toml_value(x) for x in v) + "]"
    raise TypeError(f"cannot write {type(v).__name__} to TOML")


def dump_toml(data: dict[str, Any]) -> str:
    """Write the flat sections / arrays-of-tables shape the panel config uses."""
    lines = ["# hyte-panel configuration. Edit here or at http://127.0.0.1:8787/settings", ""]
    for section, body in data.items():
        if isinstance(body, list):
            for item in body:
                lines.append(f"[[{section}]]")
                lines.extend(f"{k} = {_toml_value(v)}" for k, v in item.items())
                lines.append("")
        else:
            lines.append(f"[{section}]")
            lines.extend(f"{k} = {_toml_value(v)}" for k, v in body.items())
            lines.append("")
    return "\n".join(lines)


def save_config(cfg: Config, path: str | os.PathLike | None = None) -> Path:
    """Write the config to disk atomically and return the path."""
    p = Path(path) if path else (Path(cfg.path) if cfg.path else default_config_path())
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(dump_toml(config_to_dict(cfg)), encoding="utf-8")
    os.replace(tmp, p)
    cfg.path = str(p)
    cfg.source = str(p)
    return p


def load_config(path: str | os.PathLike | None = None) -> Config:
    """Load the TOML config file. Missing file = defaults plus the example apps."""
    p = Path(path) if path else default_config_path()
    if p.is_file():
        with p.open("rb") as fh:
            cfg = parse_config(tomllib.load(fh), source=str(p))
            cfg.path = str(p)
            return cfg
    example = Path(__file__).resolve().parent / "data" / "config.example.toml"
    cfg = Config()
    if example.is_file():
        with example.open("rb") as fh:
            cfg = parse_config(tomllib.load(fh), source=f"{example} (example)")
    cfg.path = str(p)
    return cfg
