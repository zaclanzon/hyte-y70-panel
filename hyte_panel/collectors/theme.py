"""Panel colors, kept in sync with the rgb-runway lighting config.

The lighting stack writes its palette to ``~/.config/rgb-runway.json`` as
``base_color`` and ``stripe_color`` (0-255 RGB triples). This collector reads
that file, tones the LED colors for use on a dark screen, and derives a third
color by blending the two. The front end maps them to CSS variables.
"""

from __future__ import annotations

import colorsys
import json
import os
from pathlib import Path
from typing import Any

from ..config import ThemeConfig

RGB = tuple[int, int, int]

# LED colors are fully saturated and often very dark on screen (pure blue has a
# relative luminance of 0.07). Mix toward white until they reach this luminance
# so text and glows stay legible on the dark glass background.
MIN_LUMINANCE = 0.30


def default_runway_config() -> Path:
    base = os.environ.get("XDG_CONFIG_HOME") or str(Path.home() / ".config")
    return Path(base) / "rgb-runway.json"


def clamp_rgb(value: Any, fallback: RGB) -> RGB:
    """Coerce a 3-element sequence of numbers into an RGB triple, else fallback."""
    try:
        r, g, b = (max(0, min(255, int(round(float(v))))) for v in value)
    except (TypeError, ValueError):
        return fallback
    return (r, g, b)


def luminance(c: RGB) -> float:
    r, g, b = (v / 255 for v in c)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def mix(a: RGB, b: RGB, t: float) -> RGB:
    return tuple(int(round(x + (y - x) * t)) for x, y in zip(a, b))  # type: ignore[return-value]


def screen_tone(c: RGB, min_luminance: float = MIN_LUMINANCE) -> RGB:
    """Lift a dark LED color toward white so it reads on a dark UI."""
    lum = luminance(c)
    if lum >= min_luminance or lum >= 1:
        return c
    t = (min_luminance - lum) / (1 - lum)
    return mix(c, (255, 255, 255), t)


# How far the blend sits from the base color along the hue arc toward the
# stripe color. 0.5 is the midpoint; lower keeps it closer to the base color.
BLEND_TOWARD_STRIPE = 0.2


def blend(a: RGB, b: RGB, toward_b: float = BLEND_TOWARD_STRIPE) -> RGB:
    """Blend two colors along the shorter hue arc so the result stays vivid.

    A plain RGB average of red and blue is a muddy grey-purple; a point on the
    hue arc (magenta) is what the two lights look like where they overlap. The
    result leans toward ``a`` (the base color) and keeps the brighter value so
    it reads as a highlight rather than a dark in-between.
    """
    ha, sa, va = colorsys.rgb_to_hsv(*(v / 255 for v in a))
    hb, sb, vb = colorsys.rgb_to_hsv(*(v / 255 for v in b))
    if sa < 0.05 or sb < 0.05:
        return mix(a, b, toward_b)  # a grey has no hue to average
    diff = hb - ha
    if diff > 0.5:
        diff -= 1
    elif diff < -0.5:
        diff += 1
    h = (ha + diff * toward_b) % 1
    r, g, b_ = colorsys.hsv_to_rgb(h, sa + (sb - sa) * toward_b, max(va, vb))
    return (int(round(r * 255)), int(round(g * 255)), int(round(b_ * 255)))


def to_hex(c: RGB) -> str:
    return "#%02x%02x%02x" % c


def build_theme(primary: RGB, secondary: RGB, source: str) -> dict[str, Any]:
    p, s = screen_tone(primary), screen_tone(secondary)
    mixed = screen_tone(blend(p, s))
    return {
        "source": source,
        "primary": to_hex(p),
        "secondary": to_hex(s),
        "blend": to_hex(mixed),
        "raw": {"primary": list(primary), "secondary": list(secondary)},
    }


class ThemeCollector:
    """Re-reads the rgb-runway config whenever its mtime changes."""

    def __init__(self, cfg: ThemeConfig) -> None:
        self.cfg = cfg
        self.path = Path(os.path.expanduser(cfg.runway_config)) if cfg.runway_config else default_runway_config()
        self._mtime: float | None = None
        self._theme: dict[str, Any] | None = None

    @property
    def fallback(self) -> tuple[RGB, RGB]:
        return clamp_rgb(self.cfg.primary, (255, 0, 0)), clamp_rgb(self.cfg.secondary, (0, 0, 255))

    def snapshot(self) -> dict[str, Any]:
        primary, secondary = self.fallback
        if not self.cfg.follow_runway:
            return build_theme(primary, secondary, "config")
        try:
            mtime = self.path.stat().st_mtime
        except OSError:
            mtime = None
        if self._theme is not None and mtime == self._mtime:
            return self._theme
        self._mtime = mtime
        source = "config"
        if mtime is not None:
            try:
                with self.path.open("rb") as fh:
                    data = json.load(fh)
                if isinstance(data, dict):
                    primary = clamp_rgb(data.get("base_color"), primary)
                    secondary = clamp_rgb(data.get("stripe_color"), secondary)
                    source = "rgb-runway"
            except (OSError, ValueError):
                pass
        self._theme = build_theme(primary, secondary, source)
        return self._theme
