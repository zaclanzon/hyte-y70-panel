from hyte_panel.config import Config
from hyte_panel.window import find_monitor_xrandr

XRANDR = """Screen 0: minimum 8 x 8, current 6400 x 2560, maximum 32767 x 32767
DP-1 connected primary 3840x2160+0+0 (normal left inverted right x axis y axis) 600mm x 340mm
   3840x2160     60.00*+
DP-3 connected 720x2560+3840+0 left (normal left inverted right x axis y axis) 310mm x 90mm
   2560x720      60.00*+
HDMI-0 disconnected (normal left inverted right x axis y axis)
"""


def test_find_by_size():
    assert find_monitor_xrandr(Config(), XRANDR) == (3840, 0, 720, 2560)


def test_find_by_connector():
    cfg = Config()
    cfg.display.connector = "DP-1"
    assert find_monitor_xrandr(cfg, XRANDR) == (0, 0, 3840, 2160)


def test_find_unrotated_by_size():
    cfg = Config()
    out = XRANDR.replace("720x2560+3840+0 left", "2560x720+3840+0")
    assert find_monitor_xrandr(cfg, out) == (3840, 0, 2560, 720)


def test_not_found():
    cfg = Config()
    cfg.display.width, cfg.display.height = 1100, 3840
    assert find_monitor_xrandr(cfg, XRANDR) is None
