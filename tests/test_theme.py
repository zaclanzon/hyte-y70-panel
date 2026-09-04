import json
import os
import socket
import struct
import threading

import pytest

from hyte_panel.collectors.theme import (
    PRESETS,
    OpenRGBClient,
    ThemeCollector,
    blend,
    build_theme,
    dominant_pair,
    parse_controller_colors,
    screen_tone,
    to_hex,
)
from hyte_panel.config import ThemeConfig, parse_config


def test_screen_tone_lifts_dark_colors_only():
    assert screen_tone((0, 177, 255)) == (0, 177, 255)  # already bright enough
    lifted = screen_tone((0, 0, 255))
    assert lifted[0] == lifted[1] > 0 and lifted[2] == 255
    assert screen_tone((255, 255, 255)) == (255, 255, 255)


def test_blend_takes_the_short_hue_arc_leaning_to_primary():
    r, g, b = blend((255, 0, 0), (0, 0, 255))
    assert r == 255 and g == 0 and 0 < b < 255  # magenta-red, not the grey-purple RGB average
    r, g, b = blend((0, 0, 255), (255, 0, 0))
    assert b == 255 and g == 0 and 0 < r < 255  # leans to whichever is primary
    assert blend((255, 0, 0), (0, 0, 255), 0.5) == (255, 0, 255)
    assert blend((128, 128, 128), (0, 0, 0), 0.5) == (64, 64, 64)  # greys fall back to mixing
    assert max(blend((255, 0, 132), (0, 90, 128))) == 255  # brightness from the brighter input


def test_build_theme_shape():
    t = build_theme((255, 0, 0), (0, 0, 255), "test")
    assert set(t) == {"source", "primary", "secondary", "blend", "raw"}
    assert t["raw"] == {"primary": [255, 0, 0], "secondary": [0, 0, 255]}
    assert all(len(t[k]) == 7 and t[k].startswith("#") for k in ("primary", "secondary", "blend"))
    assert to_hex((255, 0, 132)) == "#ff0084"


# ---- static ---------------------------------------------------------------------

def test_static_source_uses_colors_or_preset():
    col = ThemeCollector(ThemeConfig(source="static", primary=[10, 20, 30], secondary=[40, 50, 60]))
    t = col.snapshot()
    assert t["source"] == "static" and t["raw"] == {"primary": [10, 20, 30], "secondary": [40, 50, 60]}
    col = ThemeCollector(ThemeConfig(source="static", preset="Aurora", primary=[1, 1, 1]))
    assert tuple(col.snapshot()["raw"]["primary"]) == PRESETS["aurora"][0]
    col = ThemeCollector(ThemeConfig(source="static", preset="no-such-preset"))
    assert tuple(col.snapshot()["raw"]["primary"]) == PRESETS["ember"][0]


# ---- file --------------------------------------------------------------------------

def test_file_source_follows_the_file(tmp_path):
    path = tmp_path / "lights.json"
    cfg = ThemeConfig(source="file", file=str(path), file_keys=["base_color", "stripe_color"])
    col = ThemeCollector(cfg)
    assert col.snapshot()["source"] == "static"  # missing file falls back

    path.write_text(json.dumps({"base_color": [255, 0, 132], "stripe_color": [0, 177, 255]}))
    live = col.snapshot()
    assert live["source"] == "file"
    assert live["raw"] == {"primary": [255, 0, 132], "secondary": [0, 177, 255]}
    assert live["secondary"] == "#00b1ff"
    assert col.snapshot() is live  # cached until the file changes

    path.write_text(json.dumps({"base_color": [0, 255, 0], "stripe_color": "junk"}))
    os.utime(path, (1, 2))
    changed = col.snapshot()
    assert changed["raw"]["primary"] == [0, 255, 0]
    assert changed["raw"]["secondary"] == [0, 0, 255]  # bad value keeps the static fallback

    path.write_text("not json")
    os.utime(path, (3, 4))
    assert col.snapshot()["source"] == "static"


def test_legacy_runway_keys_map_to_the_file_source(tmp_path):
    cfg = parse_config({"theme": {"follow_runway": True, "runway_config": str(tmp_path / "r.json")}}).theme
    assert cfg.source == "file" and cfg.file == str(tmp_path / "r.json")
    assert cfg.file_keys == ["base_color", "stripe_color"]
    cfg = parse_config({"theme": {"follow_runway": False, "primary": [1, 2, 3]}}).theme
    assert cfg.source == "static" and cfg.primary == [1, 2, 3]
    cfg = parse_config({"theme": {"source": "bogus", "file_keys": ["only-one"]}}).theme
    assert cfg.source == "auto" and cfg.file_keys == ["primary", "secondary"]


# ---- openrgb -----------------------------------------------------------------------

def _s(text: str) -> bytes:
    raw = text.encode() + b"\0"
    return struct.pack("<H", len(raw)) + raw


def controller_block(name: str, colors, proto: int = 4, modes: int = 2, zones: int = 2) -> bytes:
    """Encode an OpenRGB controller-data block the way the server does."""
    body = struct.pack("<i", 1) + _s(name) + _s("Vendor") + _s("desc") + _s("1.0") + _s("serial") + _s("loc")
    body += struct.pack("<Hi", modes, 0)
    for m in range(modes):
        body += _s(f"Mode {m}") + struct.pack("<iIII", m, 0, 0, 100)
        if proto >= 3:
            body += struct.pack("<II", 0, 100)
        body += struct.pack("<III", 0, 2, 50)
        if proto >= 3:
            body += struct.pack("<I", 100)
        body += struct.pack("<II", 0, 0) + struct.pack("<H", 2) + struct.pack("<BBBB", 1, 2, 3, 0) * 2
    body += struct.pack("<H", zones)
    for z in range(zones):
        body += _s(f"Zone {z}") + struct.pack("<iIII", 1, 0, 100, len(colors))
        body += struct.pack("<H", 0)  # no matrix
        if proto >= 4:
            body += struct.pack("<H", 1) + _s("seg") + struct.pack("<iII", 0, 0, len(colors))
    body += struct.pack("<H", len(colors))
    for i in range(len(colors)):
        body += _s(f"LED {i}") + struct.pack("<I", 0)
    body += struct.pack("<H", len(colors)) + b"".join(struct.pack("<BBBB", *c, 0) for c in colors)
    return struct.pack("<I", len(body) + 4) + body


@pytest.mark.parametrize("proto", [1, 3, 4])
def test_parse_controller_colors_walks_every_layout(proto):
    colors = [(255, 0, 0), (0, 0, 255), (10, 20, 30)]
    assert parse_controller_colors(controller_block("dev", colors, proto=proto), proto) == colors


def test_dominant_pair_picks_two_distinct_hues():
    strip = [(255, 0, 0)] * 30 + [(0, 0, 255)] * 20 + [(250, 10, 5)] * 25 + [(0, 0, 0)] * 100
    p, s = dominant_pair(strip)
    assert p[0] > 200 and p[2] < 40, "red family dominates"
    assert s[2] > 200 and s[0] < 40, "blue is the second hue, not the near-red"
    assert dominant_pair([(0, 0, 0), (5, 5, 5)]) is None
    p, s = dominant_pair([(0, 255, 0)] * 5)
    assert p[1] > 200 and s != p, "a single color gets a companion"


class FakeOpenRGB(threading.Thread):
    """Just enough of the ORGB protocol to serve colors for two devices."""

    def __init__(self, devices):
        super().__init__(daemon=True)
        self.devices = devices
        self.sock = socket.socket()
        self.sock.bind(("127.0.0.1", 0))
        self.sock.listen(1)
        self.port = self.sock.getsockname()[1]
        self.requests = []

    def run(self):
        conn, _ = self.sock.accept()
        try:
            while True:
                head = b""
                while len(head) < 16:
                    chunk = conn.recv(16 - len(head))
                    if not chunk:
                        return
                    head += chunk
                _, dev, pid, size = struct.unpack("<4sIII", head)
                data = conn.recv(size) if size else b""
                self.requests.append(pid)
                reply = None
                if pid == 40:
                    reply = struct.pack("<I", 4)
                elif pid == 0:
                    reply = struct.pack("<I", len(self.devices))
                elif pid == 1:
                    reply = controller_block(*self.devices[dev])
                if reply is not None:
                    conn.sendall(b"ORGB" + struct.pack("<III", dev, pid, len(reply)) + reply)
        finally:
            conn.close()


def test_openrgb_source_reads_colors_and_never_writes():
    server = FakeOpenRGB([("ram", [(255, 0, 0)] * 8), ("gpu", [(0, 0, 255)] * 6 + [(0, 0, 0)] * 4)])
    server.start()
    now = [100.0]
    col = ThemeCollector(ThemeConfig(source="openrgb", openrgb_port=server.port), clock=lambda: now[0])
    t = col.snapshot()
    assert t["source"] == "openrgb"
    assert t["raw"]["primary"][0] > 200 and t["raw"]["secondary"][2] > 200
    assert set(server.requests) <= {50, 40, 0, 1}, "only name, version and read requests"
    n = len(server.requests)
    assert col.snapshot() is t and len(server.requests) == n, "cached between polls"
    now[0] += 5
    col.snapshot()
    assert len(server.requests) > n, "polled again after the interval"


def test_openrgb_source_falls_back_when_the_server_is_down():
    now = [0.0]
    col = ThemeCollector(ThemeConfig(source="openrgb", openrgb_port=1), clock=lambda: now[0])
    assert col.snapshot()["source"] == "static"
    # auto tries the file, then OpenRGB, then static
    col = ThemeCollector(ThemeConfig(source="auto", openrgb_port=1, preset="sunset"), clock=lambda: now[0])
    assert tuple(col.snapshot()["raw"]["primary"]) == PRESETS["sunset"][0]


def test_openrgb_client_rejects_bad_framing():
    server = socket.socket()
    server.bind(("127.0.0.1", 0))
    server.listen(1)

    def serve():
        conn, _ = server.accept()
        conn.recv(64)
        conn.sendall(b"JUNK" + b"\0" * 12)
        conn.close()

    threading.Thread(target=serve, daemon=True).start()
    client = OpenRGBClient("127.0.0.1", server.getsockname()[1], timeout=2)
    with pytest.raises(OSError):
        client.connect()
