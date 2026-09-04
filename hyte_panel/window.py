"""Kiosk window on the HYTE screen.

Backends:
  gtk      - GTK4 + WebKitGTK 6.0 window, fullscreen on the matching monitor.
             Works on Wayland and X11. Needs python3-gi, gir1.2-gtk-4.0 and
             gir1.2-webkit-6.0 (system packages).
  chromium - Chromium/Chrome in --kiosk mode. On X11 the window is placed on
             the monitor with xrandr geometry. On Wayland it opens on the
             monitor that has the pointer.
"""

from __future__ import annotations

import logging
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

from .config import Config

log = logging.getLogger("hyte_panel.window")


def _size_matches(w: int, h: int, cfg: Config) -> bool:
    want = {(cfg.display.width, cfg.display.height), (cfg.display.height, cfg.display.width)}
    return (w, h) in want


# ---------------------------------------------------------------------------
# GTK backend
# ---------------------------------------------------------------------------

def run_gtk(cfg: Config, url: str) -> int:
    try:
        import gi

        gi.require_version("Gtk", "4.0")
        gi.require_version("Gdk", "4.0")
        gi.require_version("WebKit", "6.0")
        from gi.repository import Gdk, GLib, Gtk, WebKit  # type: ignore
    except (ImportError, ValueError) as exc:
        raise RuntimeError(
            "GTK backend unavailable. Install python3-gi gir1.2-gtk-4.0 gir1.2-webkit-6.0"
        ) from exc

    def pick_monitor(display):
        monitors = display.get_monitors()
        chosen = None
        for i in range(monitors.get_n_items()):
            m = monitors.get_item(i)
            geo = m.get_geometry()
            connector = m.get_connector() or ""
            log.info("monitor %s: %dx%d at %d,%d", connector, geo.width, geo.height, geo.x, geo.y)
            if cfg.display.connector and connector == cfg.display.connector:
                return m
            if chosen is None and _size_matches(geo.width, geo.height, cfg):
                chosen = m
        return chosen

    class PanelApp(Gtk.Application):
        def __init__(self):
            super().__init__(application_id="io.github.hyte_panel.Kiosk")

        def do_activate(self):
            win = Gtk.ApplicationWindow(application=self, title="HYTE Panel")
            win.set_decorated(False)
            win.set_default_size(cfg.display.width, cfg.display.height)
            # Ephemeral session: no disk cache, so edits to the static files
            # show up on the next restart instead of hours later.
            try:
                view = WebKit.WebView(network_session=WebKit.NetworkSession.new_ephemeral())
            except (AttributeError, TypeError):
                view = WebKit.WebView()
            settings = view.get_settings()
            settings.set_enable_developer_extras(False)
            settings.set_enable_smooth_scrolling(True)
            try:
                view.set_background_color(Gdk.RGBA(red=0.04, green=0.05, blue=0.07, alpha=1.0))
            except Exception:
                pass
            view.load_uri(url)
            win.set_child(view)
            win.present()

            def go_fullscreen():
                display = Gdk.Display.get_default()
                monitor = pick_monitor(display) if display else None
                if monitor is not None:
                    win.fullscreen_on_monitor(monitor)
                else:
                    log.warning("HYTE monitor not found; fullscreen on current monitor")
                    win.fullscreen()
                return False

            GLib.idle_add(go_fullscreen)

    return PanelApp().run([sys.argv[0]])


# ---------------------------------------------------------------------------
# Chromium backend
# ---------------------------------------------------------------------------

_XRANDR_RE = re.compile(r"^(\S+) connected(?: primary)? (\d+)x(\d+)\+(\d+)\+(\d+)", re.M)


def find_monitor_xrandr(cfg: Config, xrandr_output: str) -> tuple[int, int, int, int] | None:
    """Return (x, y, w, h) of the HYTE monitor from `xrandr` output."""
    fallback = None
    for name, w, h, x, y in _XRANDR_RE.findall(xrandr_output):
        w, h, x, y = int(w), int(h), int(x), int(y)
        if cfg.display.connector and name == cfg.display.connector:
            return (x, y, w, h)
        if fallback is None and _size_matches(w, h, cfg):
            fallback = (x, y, w, h)
    return fallback


def _chromium_binary(cfg: Config) -> str | None:
    if cfg.display.chromium:
        return cfg.display.chromium
    for name in ("chromium", "chromium-browser", "google-chrome", "google-chrome-stable", "brave-browser"):
        exe = shutil.which(name)
        if exe:
            return exe
    return None


def run_chromium(cfg: Config, url: str) -> int:
    exe = _chromium_binary(cfg)
    if not exe:
        raise RuntimeError("no Chromium/Chrome binary found; set display.chromium in the config")
    profile = Path(os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache") / "hyte-panel" / "chromium-profile"
    profile.mkdir(parents=True, exist_ok=True)
    argv = [
        exe,
        "--kiosk",
        f"--app={url}",
        f"--user-data-dir={profile}",
        "--no-first-run",
        "--disable-session-crashed-bubble",
        "--disable-infobars",
        "--touch-events=enabled",
        "--overscroll-history-navigation=0",
        "--autoplay-policy=no-user-gesture-required",
    ]
    if os.environ.get("XDG_SESSION_TYPE") == "wayland" or os.environ.get("WAYLAND_DISPLAY"):
        argv += ["--ozone-platform-hint=auto", "--enable-features=UseOzonePlatform"]
    xrandr = shutil.which("xrandr")
    if xrandr and os.environ.get("DISPLAY"):
        try:
            out = subprocess.run([xrandr, "--query"], capture_output=True, text=True, timeout=5, check=False).stdout
            geo = find_monitor_xrandr(cfg, out)
            if geo:
                x, y, w, h = geo
                argv += [f"--window-position={x},{y}", f"--window-size={w},{h}"]
        except (OSError, subprocess.SubprocessError):
            pass
    log.info("starting %s", " ".join(argv))
    return subprocess.call(argv)


def run_window(cfg: Config, url: str) -> int:
    backend = cfg.display.backend
    if backend in ("auto", "gtk"):
        try:
            return run_gtk(cfg, url)
        except RuntimeError as exc:
            if backend == "gtk":
                raise
            log.warning("%s; falling back to chromium", exc)
    return run_chromium(cfg, url)
