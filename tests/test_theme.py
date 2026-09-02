import json

from hyte_panel.collectors.theme import ThemeCollector, blend, build_theme, screen_tone, to_hex
from hyte_panel.config import ThemeConfig


def test_screen_tone_lifts_dark_colors_only():
    assert screen_tone((0, 177, 255)) == (0, 177, 255)  # already bright enough
    lifted = screen_tone((0, 0, 255))
    assert lifted[0] == lifted[1] > 0 and lifted[2] == 255
    assert screen_tone((255, 255, 255)) == (255, 255, 255)


def test_blend_takes_the_short_hue_arc_leaning_to_base():
    r, g, b = blend((255, 0, 0), (0, 0, 255))
    assert r == 255 and g == 0 and 0 < b < 255  # magenta-red, not the grey-purple RGB average
    r, g, b = blend((0, 0, 255), (255, 0, 0))
    assert b == 255 and g == 0 and 0 < r < 255  # leans to whichever is the base
    assert blend((255, 0, 0), (0, 0, 255), 0.5) == (255, 0, 255)
    assert blend((128, 128, 128), (0, 0, 0), 0.5) == (64, 64, 64)  # greys fall back to mixing
    # Brightness comes from the brighter input, so a dim stripe does not dull the blend.
    assert max(blend((255, 0, 132), (0, 90, 128))) == 255


def test_build_theme_shape():
    t = build_theme((255, 0, 0), (0, 0, 255), "test")
    assert set(t) == {"source", "primary", "secondary", "blend", "raw"}
    assert t["raw"] == {"primary": [255, 0, 0], "secondary": [0, 0, 255]}
    assert all(len(t[k]) == 7 and t[k].startswith("#") for k in ("primary", "secondary", "blend"))
    assert to_hex((255, 0, 132)) == "#ff0084"


def test_collector_follows_runway_file(tmp_path):
    path = tmp_path / "rgb-runway.json"
    cfg = ThemeConfig(runway_config=str(path))
    col = ThemeCollector(cfg)
    fallback = col.snapshot()
    assert fallback["source"] == "config" and fallback["raw"]["primary"] == [255, 0, 0]

    path.write_text(json.dumps({"base_color": [255, 0, 132], "stripe_color": [0, 177, 255]}))
    live = col.snapshot()
    assert live["source"] == "rgb-runway"
    assert live["raw"] == {"primary": [255, 0, 132], "secondary": [0, 177, 255]}
    assert live["secondary"] == "#00b1ff"
    assert col.snapshot() is live  # cached until the file changes

    path.write_text(json.dumps({"base_color": [0, 255, 0], "stripe_color": "junk"}))
    import os
    os.utime(path, (1, 2))  # force a distinct mtime
    changed = col.snapshot()
    assert changed["raw"]["primary"] == [0, 255, 0]
    assert changed["raw"]["secondary"] == [0, 0, 255]  # bad value keeps the fallback

    path.write_text("not json")
    os.utime(path, (3, 4))
    assert col.snapshot()["source"] == "config"


def test_collector_can_ignore_runway(tmp_path):
    path = tmp_path / "rgb-runway.json"
    path.write_text(json.dumps({"base_color": [1, 2, 3], "stripe_color": [4, 5, 6]}))
    col = ThemeCollector(ThemeConfig(follow_runway=False, runway_config=str(path), primary=[10, 20, 30], secondary=[40, 50, 60]))
    t = col.snapshot()
    assert t["source"] == "config" and t["raw"]["primary"] == [10, 20, 30]
