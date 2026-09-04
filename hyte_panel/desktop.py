"""Desktop integration: a settings window, a small control window, and the
desktop entry that puts both in the app grid.

The kiosk window (window.py) owns the HYTE screen. These windows live on the
main monitor and are ordinary GTK4 windows with libadwaita styling when it is
installed. They talk to the running panel through systemd and its HTTP port.
"""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

from .config import Config

log = logging.getLogger("hyte_panel.desktop")

SERVICE = "hyte-panel.service"
APP_ID = "io.github.hyte_panel"            # control window; matches the desktop entry
SETTINGS_APP_ID = "io.github.hyte_panel.Settings"
DATA_DIR = Path(__file__).resolve().parent / "data"


# ---------------------------------------------------------------------------
# Service and server helpers (no GTK)
# ---------------------------------------------------------------------------

def service_state() -> str:
    """active | inactive | failed | activating | missing | unknown."""
    systemctl = shutil.which("systemctl")
    if not systemctl:
        return "unknown"
    try:
        r = subprocess.run([systemctl, "--user", "is-active", SERVICE], capture_output=True, text=True, timeout=5)
    except (OSError, subprocess.SubprocessError):
        return "unknown"
    state = (r.stdout or "").strip() or "unknown"
    if state == "inactive":
        # Distinguish "installed but stopped" from "unit not installed".
        try:
            e = subprocess.run([systemctl, "--user", "is-enabled", SERVICE], capture_output=True, text=True, timeout=5)
            if "not-found" in (e.stdout + e.stderr) or "No such file" in e.stderr:
                return "missing"
        except (OSError, subprocess.SubprocessError):
            pass
    return state


def service_action(action: str) -> tuple[bool, str]:
    if action not in ("start", "stop", "restart"):
        raise ValueError(action)
    systemctl = shutil.which("systemctl")
    if not systemctl:
        return False, "systemctl not found"
    try:
        r = subprocess.run([systemctl, "--user", action, SERVICE], capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.SubprocessError) as exc:
        return False, str(exc)
    return r.returncode == 0, (r.stderr or r.stdout).strip()


def service_logs(lines: int = 200) -> str:
    journalctl = shutil.which("journalctl")
    if not journalctl:
        return "journalctl not found"
    try:
        r = subprocess.run([journalctl, "--user", "-u", SERVICE, "-n", str(lines), "--no-pager", "-o", "short"],
                           capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.SubprocessError) as exc:
        return str(exc)
    return r.stdout or r.stderr


def server_reachable(url: str, timeout: float = 1.0) -> bool:
    try:
        with urllib.request.urlopen(url + "api/config", timeout=timeout):
            return True
    except (urllib.error.URLError, OSError, ValueError):
        return False


def wait_for_server(url: str, timeout: float = 20.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if server_reachable(url):
            return True
        time.sleep(0.25)
    return False


class TemporaryServer:
    """Runs `hyte-panel serve` as a child while a window needs it.

    Used when the systemd service is not running, so the settings window
    always has something to talk to. Stopped when the window closes."""

    def __init__(self, cfg: Config, config_path: str | None = None) -> None:
        self.cfg = cfg
        self.config_path = config_path
        self.proc: subprocess.Popen | None = None

    def ensure(self) -> bool:
        if server_reachable(self.cfg.url):
            return True
        argv = [sys.executable, "-m", "hyte_panel", "serve"]
        if self.config_path:
            argv += ["--config", self.config_path]
        log.info("starting a temporary server: %s", " ".join(argv))
        self.proc = subprocess.Popen(argv)
        return wait_for_server(self.cfg.url)

    def stop(self) -> None:
        if self.proc is not None and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(5)
            except subprocess.TimeoutExpired:
                self.proc.kill()
        self.proc = None


# ---------------------------------------------------------------------------
# Desktop entry
# ---------------------------------------------------------------------------

def launcher_command() -> str:
    """The command a desktop entry should run: the venv's hyte-panel if there is one."""
    exe = Path(sys.executable).parent / "hyte-panel"
    if exe.is_file():
        return str(exe)
    return f"{sys.executable} -m hyte_panel"


def install_desktop_entry(exec_cmd: str | None = None, data_home: str | os.PathLike | None = None) -> list[Path]:
    """Write the .desktop file and icon under XDG_DATA_HOME. Returns the paths written."""
    base = Path(data_home) if data_home else Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share")
    exec_cmd = exec_cmd or launcher_command()
    apps = base / "applications"
    icons = base / "icons" / "hicolor" / "scalable" / "apps"
    apps.mkdir(parents=True, exist_ok=True)
    icons.mkdir(parents=True, exist_ok=True)
    desktop = (DATA_DIR / "hyte-panel.desktop").read_text(encoding="utf-8").replace("__EXEC__", exec_cmd)
    written = []
    p = apps / f"{APP_ID}.desktop"
    p.write_text(desktop, encoding="utf-8")
    written.append(p)
    p = icons / f"{APP_ID}.svg"
    shutil.copyfile(DATA_DIR / "hyte-panel.svg", p)
    written.append(p)
    for tool, args in (("update-desktop-database", [str(apps)]), ("gtk-update-icon-cache", ["-q", "-t", str(base / "icons" / "hicolor")])):
        exe = shutil.which(tool)
        if exe:
            subprocess.run([exe, *args], capture_output=True, timeout=30, check=False)
    return written


def _config_home(config_home=None) -> Path:
    return Path(config_home) if config_home else Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config")


def systemd_user_available() -> bool:
    """True when this session has a systemd user manager to talk to."""
    systemctl = shutil.which("systemctl")
    if not systemctl:
        return False
    try:
        r = subprocess.run([systemctl, "--user", "show-environment"], capture_output=True, text=True, timeout=5)
    except (OSError, subprocess.SubprocessError):
        return False
    return r.returncode == 0


def install_service(exec_cmd: str | None = None, config_home: str | os.PathLike | None = None,
                    use_systemd: bool | None = None) -> tuple[Path, str]:
    """Make the panel start with the session.

    With a systemd user manager: write and enable hyte-panel.service. Without
    one: write an XDG autostart entry, which every desktop honours.
    Returns (path written, "systemd" | "autostart")."""
    exec_cmd = exec_cmd or launcher_command()
    home = _config_home(config_home)
    if use_systemd is None:
        use_systemd = systemd_user_available()
    if use_systemd:
        unit_dir = home / "systemd" / "user"
        unit_dir.mkdir(parents=True, exist_ok=True)
        unit = unit_dir / SERVICE
        unit.write_text((DATA_DIR / "hyte-panel.service").read_text(encoding="utf-8").replace("__EXEC__", exec_cmd), encoding="utf-8")
        systemctl = shutil.which("systemctl")
        if systemctl:
            subprocess.run([systemctl, "--user", "daemon-reload"], capture_output=True, timeout=30, check=False)
            subprocess.run([systemctl, "--user", "enable", SERVICE], capture_output=True, timeout=30, check=False)
        return unit, "systemd"
    auto_dir = home / "autostart"
    auto_dir.mkdir(parents=True, exist_ok=True)
    entry = auto_dir / f"{APP_ID}.desktop"
    entry.write_text(
        "[Desktop Entry]\nType=Application\nName=HYTE Panel\nComment=Start the HYTE panel with the session\n"
        f"Exec={exec_cmd} run\nIcon={APP_ID}\nTerminal=false\nX-GNOME-Autostart-enabled=true\n", encoding="utf-8")
    return entry, "autostart"


def install_config(config_home: str | os.PathLike | None = None) -> tuple[Path, bool]:
    """Copy the example config into place unless one exists. Returns (path, created)."""
    path = _config_home(config_home) / "hyte-panel" / "config.toml"
    if path.is_file():
        return path, False
    path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(DATA_DIR / "config.example.toml", path)
    return path, True


def environment_checks() -> list[tuple[str, bool, str]]:
    """(name, ok, note) for the things the panel needs beyond Python."""
    out = []
    try:
        import gi

        gi.require_version("Gtk", "4.0")
        from gi.repository import Gtk  # noqa: F401
        gtk = True
    except (ImportError, ValueError):
        gtk = False
    out.append(("GTK4 (PyGObject)", gtk, "" if gtk else "kiosk falls back to Chromium; install your distro's python gobject + gtk4 packages"))
    try:
        import gi

        gi.require_version("WebKit", "6.0")
        from gi.repository import WebKit  # noqa: F401
        wk = True
    except (ImportError, ValueError):
        wk = False
    out.append(("WebKitGTK 6.0", wk, "" if wk else "needed for the GTK kiosk and the settings window"))
    try:
        import gi

        gi.require_version("Adw", "1")
        from gi.repository import Adw  # noqa: F401
        adw = True
    except (ImportError, ValueError):
        adw = False
    out.append(("libadwaita", adw, "" if adw else "optional: GNOME styling for the desktop windows"))
    nv = shutil.which("nvidia-smi") is not None
    out.append(("nvidia-smi", nv, "" if nv else "no GPU card data without the NVIDIA driver"))
    sensors = any(Path("/sys/class/hwmon").glob("hwmon*")) if Path("/sys/class/hwmon").exists() else False
    out.append(("hwmon sensors", sensors, "" if sensors else "no temperatures or fan speeds; run sensors-detect"))
    out.append(("systemd user session", systemd_user_available(), "" if systemd_user_available() else "autostart entry is used instead of a service"))
    return out


# ---------------------------------------------------------------------------
# GTK windows
# ---------------------------------------------------------------------------

def _gtk():
    """Import GTK4 (+ WebKit, + libadwaita when present) or raise RuntimeError."""
    try:
        import gi

        gi.require_version("Gtk", "4.0")
        gi.require_version("Gdk", "4.0")
        from gi.repository import Gdk, Gio, GLib, Gtk  # type: ignore
    except (ImportError, ValueError) as exc:
        raise RuntimeError("GTK4 unavailable. Install python3-gi gir1.2-gtk-4.0") from exc
    try:
        gi.require_version("WebKit", "6.0")
        from gi.repository import WebKit  # type: ignore
    except (ImportError, ValueError):
        WebKit = None
    try:
        gi.require_version("Adw", "1")
        from gi.repository import Adw  # type: ignore

        Adw.init()
    except (ImportError, ValueError):
        Adw = None
    return Gtk, Gdk, Gio, GLib, WebKit, Adw


def _autoquit(app, GLib) -> None:
    """HYTE_PANEL_AUTOQUIT=<seconds> closes the window by itself (used by tests)."""
    secs = os.environ.get("HYTE_PANEL_AUTOQUIT")
    if secs:
        GLib.timeout_add(int(float(secs) * 1000), lambda: (app.quit(), False)[1])


def make_settings_window(app, url: str, Gtk, WebKit, on_close=None):
    """A decorated window showing the settings page. Falls back to the browser without WebKit."""
    if WebKit is None:
        Gtk.UriLauncher.new(url + "settings").launch(None, None, None, None)
        return None
    win = Gtk.ApplicationWindow(application=app, title="HYTE Panel settings")
    win.set_default_size(1040, 880)
    view = WebKit.WebView()
    view.get_settings().set_enable_smooth_scrolling(True)
    view.load_uri(url + "settings")
    win.set_child(view)
    if on_close:
        win.connect("close-request", lambda *_: (on_close(), False)[1])
    win.present()
    return win


def run_settings_window(cfg: Config, config_path: str | None = None) -> int:
    Gtk, Gdk, Gio, GLib, WebKit, Adw = _gtk()
    temp = TemporaryServer(cfg, config_path)
    if not temp.ensure():
        print("could not reach or start the panel server", file=sys.stderr)
        return 1
    base = Adw.Application if Adw else Gtk.Application

    class SettingsApp(base):
        def __init__(self):
            super().__init__(application_id=SETTINGS_APP_ID)

        def do_activate(self):
            make_settings_window(self, cfg.url, Gtk, WebKit)
            _autoquit(self, GLib)

    try:
        return SettingsApp().run([sys.argv[0]])
    finally:
        temp.stop()


def run_control_window(cfg: Config, config_path: str | None = None) -> int:
    """Start / stop / restart the service, open settings, read the logs."""
    Gtk, Gdk, Gio, GLib, WebKit, Adw = _gtk()
    base = Adw.Application if Adw else Gtk.Application
    temp = TemporaryServer(cfg, config_path)

    class ControlApp(base):
        def __init__(self):
            super().__init__(application_id=APP_ID)
            self.win = None
            self.timer = None

        # -- construction -----------------------------------------------------------
        def do_activate(self):
            if self.win is not None:
                self.win.present()
                return
            win = Gtk.ApplicationWindow(application=self, title="HYTE Panel")
            win.set_default_size(560, 640)
            self.win = win
            header = Gtk.HeaderBar()
            win.set_titlebar(header)

            body = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=18)
            for side in ("top", "bottom", "start", "end"):
                getattr(body, f"set_margin_{side}")(22)
            win.set_child(body)

            # status row
            status = Gtk.Box(spacing=12)
            self.dot = Gtk.Label(label="●")
            self.dot.add_css_class("title-2")
            self.state_label = Gtk.Label(label="Checking…", xalign=0)
            self.state_label.add_css_class("title-3")
            self.state_label.set_hexpand(True)
            self.detail = Gtk.Label(label=cfg.url, xalign=0)
            self.detail.add_css_class("dim-label")
            text = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=2)
            text.append(self.state_label)
            text.append(self.detail)
            text.set_hexpand(True)
            status.append(self.dot)
            status.append(text)
            body.append(status)

            # buttons
            row = Gtk.Box(spacing=8)
            row.set_homogeneous(True)
            self.btn_start = self._button(row, "Start", lambda *_: self._service("start"), "suggested-action")
            self.btn_stop = self._button(row, "Stop", lambda *_: self._service("stop"), "destructive-action")
            self.btn_restart = self._button(row, "Restart", lambda *_: self._service("restart"))
            body.append(row)
            row2 = Gtk.Box(spacing=8)
            row2.set_homogeneous(True)
            self._button(row2, "Settings", self._open_settings)
            self._button(row2, "Open in browser", lambda *_: Gtk.UriLauncher.new(cfg.url).launch(win, None, None, None))
            self._button(row2, "Refresh logs", lambda *_: self._refresh_logs())
            body.append(row2)

            # logs
            logs_label = Gtk.Label(label="Recent log", xalign=0)
            logs_label.add_css_class("heading")
            body.append(logs_label)
            self.logview = Gtk.TextView(editable=False, monospace=True, cursor_visible=False)
            self.logview.set_wrap_mode(Gtk.WrapMode.WORD_CHAR)
            scroller = Gtk.ScrolledWindow(child=self.logview, vexpand=True)
            scroller.add_css_class("card") if Adw else None
            body.append(scroller)

            self.config_label = Gtk.Label(label=f"Config: {cfg.path or cfg.source}", xalign=0)
            self.config_label.add_css_class("dim-label")
            self.config_label.set_ellipsize(3)  # Pango.EllipsizeMode.END
            body.append(self.config_label)

            win.connect("close-request", lambda *_: (temp.stop(), False)[1])
            win.present()
            self._refresh_state()
            self._refresh_logs()
            self.timer = GLib.timeout_add_seconds(3, self._tick)
            _autoquit(self, GLib)

        def _button(self, box, label, handler, css=None):
            b = Gtk.Button(label=label)
            if css:
                b.add_css_class(css)
            b.add_css_class("pill") if Adw else None
            b.connect("clicked", handler)
            box.append(b)
            return b

        # -- behaviour ----------------------------------------------------------------
        def _tick(self):
            self._refresh_state()
            self._refresh_logs()
            return True

        def _refresh_state(self):
            def work():
                state = service_state()
                reachable = server_reachable(cfg.url)
                GLib.idle_add(self._show_state, state, reachable)
            threading.Thread(target=work, daemon=True).start()

        def _show_state(self, state, reachable):
            colors = {"active": "success", "activating": "warning", "failed": "error"}
            for cls in ("success", "warning", "error", "dim-label"):
                self.dot.remove_css_class(cls)
            self.dot.add_css_class(colors.get(state, "dim-label"))
            names = {"active": "Panel is running", "inactive": "Panel is stopped", "failed": "Panel failed to start",
                     "activating": "Panel is starting", "missing": "Service not installed", "unknown": "Service state unknown"}
            self.state_label.set_text(names.get(state, state))
            self.detail.set_text(f"{cfg.url}  ·  server {'reachable' if reachable else 'not reachable'}")
            self.btn_start.set_sensitive(state not in ("active", "activating", "missing"))
            self.btn_stop.set_sensitive(state in ("active", "activating"))
            self.btn_restart.set_sensitive(state not in ("missing",))
            return False

        def _service(self, action):
            self.state_label.set_text(f"{action.capitalize()}ing…")

            def work():
                ok, msg = service_action(action)
                if not ok:
                    GLib.idle_add(self._log_line, f"[{action} failed] {msg}")
                GLib.idle_add(self._refresh_state)
                GLib.timeout_add(1500, lambda: (self._refresh_logs(), False)[1])
            threading.Thread(target=work, daemon=True).start()

        def _open_settings(self, *_):
            def work():
                ok = temp.ensure()
                GLib.idle_add(lambda: (make_settings_window(self, cfg.url, Gtk, WebKit) if ok else self._log_line("[settings] could not start a server"), False)[1])
            threading.Thread(target=work, daemon=True).start()

        def _refresh_logs(self):
            def work():
                text = service_logs()
                GLib.idle_add(self._show_logs, text)
            threading.Thread(target=work, daemon=True).start()

        def _show_logs(self, text):
            buf = self.logview.get_buffer()
            if buf.get_text(buf.get_start_iter(), buf.get_end_iter(), False) != text:
                buf.set_text(text)
                GLib.idle_add(lambda: (self.logview.scroll_to_iter(buf.get_end_iter(), 0, False, 0, 1), False)[1])
            return False

        def _log_line(self, line):
            buf = self.logview.get_buffer()
            buf.insert(buf.get_end_iter(), f"\n{line}\n")
            return False

    return ControlApp().run([sys.argv[0]])
