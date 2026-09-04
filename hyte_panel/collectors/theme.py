"""Panel colors: two accent colors and a blend, from the lighting or the config.

Sources, tried in this order when ``theme.source = "auto"``:

* ``file``     a JSON file written by some lighting tool, watched by mtime.
               Two keys hold RGB triples (``theme.file_keys``).
* ``openrgb``  the OpenRGB SDK server (default 127.0.0.1:6742). The two most
               common LED colors across all devices become the accents. Read
               only: the panel never writes to the lights.
* ``static``   ``theme.primary`` / ``theme.secondary`` or a named preset.

LED colors are toned for a dark screen and a third color is blended from the
two. The front end maps them to CSS variables.
"""

from __future__ import annotations

import colorsys
import json
import os
import socket
import struct
import time
from collections import Counter
from pathlib import Path
from typing import Any

from ..config import ThemeConfig

RGB = tuple[int, int, int]

# LED colors are fully saturated and often very dark on screen (pure blue has a
# relative luminance of 0.07). Mix toward white until they reach this luminance
# so text and glows stay legible on the dark glass background.
MIN_LUMINANCE = 0.30

PRESETS: dict[str, tuple[RGB, RGB]] = {
    "ember": ((255, 0, 0), (0, 0, 255)),        # red / blue, the original look
    "aurora": ((0, 200, 140), (110, 60, 255)),  # teal / violet
    "sunset": ((255, 90, 0), (255, 0, 140)),    # orange / pink
    "ice": ((90, 200, 255), (255, 255, 255)),   # sky / white
    "mono": ((230, 230, 240), (120, 120, 140)), # white / grey
}
DEFAULT_PRESET = "ember"


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


# How far the blend sits from the primary color along the hue arc toward the
# secondary. 0.5 is the midpoint; lower keeps it closer to the primary.
BLEND_TOWARD_SECONDARY = 0.2


def blend(a: RGB, b: RGB, toward_b: float = BLEND_TOWARD_SECONDARY) -> RGB:
    """Blend two colors along the shorter hue arc so the result stays vivid.

    A plain RGB average of red and blue is a muddy grey-purple; a point on the
    hue arc (magenta) is what the two lights look like where they overlap. The
    result leans toward ``a`` (the primary) and keeps the brighter value so it
    reads as a highlight rather than a dark in-between.
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


def dominant_pair(colors: list[RGB]) -> tuple[RGB, RGB] | None:
    """The two most common lit colors, quantized so gradients collapse into
    their end points. Colors too close in hue to the first are skipped so a
    red/pink fade still yields a real second accent. One lit color yields a
    hue-shifted companion; no lit colors yields None."""
    lit = [c for c in colors if max(c) >= 24]
    if not lit:
        return None
    q = Counter((r >> 4, g >> 4, b >> 4) for r, g, b in lit)
    ranked = [(min(255, r << 4 | 8), min(255, g << 4 | 8), min(255, b << 4 | 8)) for (r, g, b), _ in q.most_common()]
    first = ranked[0]
    h1, s1, _ = colorsys.rgb_to_hsv(*(v / 255 for v in first))
    for cand in ranked[1:]:
        h2, s2, _ = colorsys.rgb_to_hsv(*(v / 255 for v in cand))
        dh = abs(h1 - h2)
        dh = min(dh, 1 - dh)
        if dh > 0.08 or abs(s1 - s2) > 0.5:
            return first, cand
    r, g, b = colorsys.hsv_to_rgb((h1 + 0.33) % 1, max(s1, 0.6), 1.0)
    return first, (int(r * 255), int(g * 255), int(b * 255))


# ---------------------------------------------------------------------------
# OpenRGB SDK client (read only)
# ---------------------------------------------------------------------------

PKT_REQUEST_CONTROLLER_COUNT = 0
PKT_REQUEST_CONTROLLER_DATA = 1
PKT_REQUEST_PROTOCOL_VERSION = 40
PKT_SET_CLIENT_NAME = 50
OPENRGB_PROTOCOL = 4        # highest controller-data layout parsed here
MAX_DEVICES = 32


class OpenRGBClient:
    """Minimal ORGB protocol client that reads the current LED colors."""

    def __init__(self, host: str, port: int, timeout: float = 2.0) -> None:
        self.addr = (host, port)
        self.timeout = timeout
        self.sock: socket.socket | None = None
        self.proto = 0

    def connect(self) -> None:
        self.close()
        s = socket.create_connection(self.addr, timeout=self.timeout)
        s.settimeout(self.timeout)
        self.sock = s
        self._send(0, PKT_SET_CLIENT_NAME, b"hyte-panel\x00")
        _, _, data = self._request(0, PKT_REQUEST_PROTOCOL_VERSION, struct.pack("<I", OPENRGB_PROTOCOL))
        self.proto = min(OPENRGB_PROTOCOL, struct.unpack("<I", data[:4])[0])

    def close(self) -> None:
        if self.sock is not None:
            try:
                self.sock.close()
            except OSError:
                pass
            self.sock = None

    def _send(self, device: int, packet_id: int, data: bytes = b"") -> None:
        assert self.sock is not None
        self.sock.sendall(b"ORGB" + struct.pack("<III", device, packet_id, len(data)) + data)

    def _recv_exact(self, n: int) -> bytes:
        assert self.sock is not None
        buf = b""
        while len(buf) < n:
            chunk = self.sock.recv(n - len(buf))
            if not chunk:
                raise ConnectionResetError("server closed")
            buf += chunk
        return buf

    def _request(self, device: int, packet_id: int, data: bytes = b"") -> tuple[int, int, bytes]:
        self._send(device, packet_id, data)
        for _ in range(64):  # skip unsolicited device-list updates
            magic, dev, pid, size = struct.unpack("<4sIII", self._recv_exact(16))
            if magic != b"ORGB":
                raise ConnectionResetError("lost packet framing")
            body = self._recv_exact(size)
            if pid == packet_id:
                return dev, pid, body
        raise ConnectionResetError(f"no reply to packet {packet_id}")

    def device_count(self) -> int:
        _, _, data = self._request(0, PKT_REQUEST_CONTROLLER_COUNT)
        return struct.unpack("<I", data[:4])[0]

    def led_colors(self, device: int) -> list[RGB]:
        """Current colors of every LED on a device."""
        _, _, data = self._request(device, PKT_REQUEST_CONTROLLER_DATA, struct.pack("<I", self.proto))
        return parse_controller_colors(data, self.proto)

    def all_colors(self) -> list[RGB]:
        out: list[RGB] = []
        for dev in range(min(self.device_count(), MAX_DEVICES)):
            out.extend(self.led_colors(dev))
        return out


def parse_controller_colors(data: bytes, proto: int) -> list[RGB]:
    """Walk an OpenRGB controller-data block and return its LED colors."""
    pos = 0

    def take(fmt: str):
        nonlocal pos
        vals = struct.unpack_from(fmt, data, pos)
        pos += struct.calcsize(fmt)
        return vals[0]

    def skip(n: int) -> None:
        nonlocal pos
        pos += n

    def take_str() -> None:
        skip(take("<H"))  # length first, then advance: `pos += take()` would read the stale pos

    take("<I")                   # block size
    take("<i")                   # device type
    take_str()                   # name
    if proto >= 1:
        take_str()               # vendor
    for _ in range(4):           # description, version, serial, location
        take_str()
    num_modes = take("<H")
    take("<i")                   # active mode
    for _ in range(num_modes):
        take_str()
        take("<i"); take("<I")   # value, flags
        take("<I"); take("<I")   # speed min/max
        if proto >= 3:
            take("<I"); take("<I")   # brightness min/max
        take("<I"); take("<I")   # colors min/max
        take("<I")               # speed
        if proto >= 3:
            take("<I")           # brightness
        take("<I"); take("<I")   # direction, color mode
        skip(4 * take("<H"))     # mode colors
    for _ in range(take("<H")):  # zones
        take_str()
        take("<i")               # zone type
        take("<I"); take("<I"); take("<I")   # leds min/max/count
        skip(take("<H"))         # matrix map
        if proto >= 4:
            for _ in range(take("<H")):      # segments
                take_str(); take("<i"); take("<I"); take("<I")
    for _ in range(take("<H")):  # leds
        take_str()
        take("<I")
    colors: list[RGB] = []
    for _ in range(take("<H")):
        r, g, b, _pad = struct.unpack_from("<BBBB", data, pos)
        pos += 4
        colors.append((r, g, b))
    return colors


# ---------------------------------------------------------------------------
# Collector
# ---------------------------------------------------------------------------

OPENRGB_POLL_SECONDS = 2.0       # how often to ask the server for colors
OPENRGB_RETRY_SECONDS = 30.0     # after a failed connection


class ThemeCollector:
    """Produces the theme from the configured source, with caching."""

    def __init__(self, cfg: ThemeConfig, clock=time.monotonic) -> None:
        self.cfg = cfg
        self.clock = clock
        self.path = Path(os.path.expanduser(cfg.file)) if cfg.file else None
        self._file_mtime: float | None = None
        self._file_pair: tuple[RGB, RGB] | None = None
        self._orgb = OpenRGBClient(cfg.openrgb_host, cfg.openrgb_port)
        self._orgb_pair: tuple[RGB, RGB] | None = None
        self._orgb_next = 0.0
        self._last: dict[str, Any] | None = None

    # -- static -------------------------------------------------------------
    @property
    def static(self) -> tuple[RGB, RGB]:
        if self.cfg.preset:
            preset = PRESETS.get(self.cfg.preset.lower())
            if preset:
                return preset
        fallback = PRESETS[DEFAULT_PRESET]
        return clamp_rgb(self.cfg.primary, fallback[0]), clamp_rgb(self.cfg.secondary, fallback[1])

    # -- file -----------------------------------------------------------------
    def from_file(self) -> tuple[RGB, RGB] | None:
        if self.path is None:
            return None
        try:
            mtime = self.path.stat().st_mtime
        except OSError:
            self._file_mtime = None
            self._file_pair = None
            return None
        if mtime == self._file_mtime:
            return self._file_pair
        self._file_mtime = mtime
        self._file_pair = None
        try:
            with self.path.open("rb") as fh:
                data = json.load(fh)
        except (OSError, ValueError):
            return None
        if not isinstance(data, dict):
            return None
        keys = list(self.cfg.file_keys)
        fb = self.static
        self._file_pair = (clamp_rgb(data.get(keys[0]), fb[0]), clamp_rgb(data.get(keys[1]), fb[1]))
        return self._file_pair

    # -- openrgb --------------------------------------------------------------
    def from_openrgb(self) -> tuple[RGB, RGB] | None:
        now = self.clock()
        if now < self._orgb_next:
            return self._orgb_pair
        try:
            if self._orgb.sock is None:
                self._orgb.connect()
            self._orgb_pair = dominant_pair(self._orgb.all_colors())
            self._orgb_next = now + OPENRGB_POLL_SECONDS
        except (OSError, struct.error, ValueError):
            self._orgb.close()
            self._orgb_pair = None
            self._orgb_next = now + OPENRGB_RETRY_SECONDS
        return self._orgb_pair

    # -- combined ---------------------------------------------------------------
    def snapshot(self) -> dict[str, Any]:
        source = (self.cfg.source or "auto").lower()
        order = ["file", "openrgb", "static"] if source == "auto" else [source, "static"]
        pair: tuple[RGB, RGB] | None = None
        used = "static"
        for name in order:
            if name == "file":
                pair = self.from_file()
            elif name == "openrgb":
                pair = self.from_openrgb()
            else:
                pair = self.static
            if pair is not None:
                used = name
                break
        if pair is None:
            pair = self.static
        theme = build_theme(pair[0], pair[1], used)
        if self._last is not None and self._last == theme:
            return self._last
        self._last = theme
        return theme
