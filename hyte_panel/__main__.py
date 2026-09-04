"""Command line entry point."""

from __future__ import annotations

import argparse
import logging
import os
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request

from .config import default_config_path, load_config


def _serve(args: argparse.Namespace) -> int:
    import uvicorn

    from .server import create_app

    cfg = load_config(args.config)
    app = create_app(cfg)
    uvicorn.run(app, host=cfg.server.host, port=cfg.server.port, log_level="warning")
    return 0


def _wait_for(url: str, timeout: float = 20.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url + "api/config", timeout=1):
                return True
        except (urllib.error.URLError, OSError):
            time.sleep(0.25)
    return False


def _window(args: argparse.Namespace) -> int:
    from .window import run_window

    cfg = load_config(args.config)
    return run_window(cfg, cfg.url)


def _run(args: argparse.Namespace) -> int:
    """Start the server as a child process, then open the window."""
    cfg = load_config(args.config)
    argv = [sys.executable, "-m", "hyte_panel", "serve"]
    if args.config:
        argv += ["--config", args.config]
    server = subprocess.Popen(argv)
    try:
        if not _wait_for(cfg.url):
            print("server did not start", file=sys.stderr)
            return 1
        from .window import run_window

        return run_window(cfg, cfg.url)
    finally:
        if server.poll() is None:
            server.send_signal(signal.SIGTERM)
            try:
                server.wait(5)
            except subprocess.TimeoutExpired:
                server.kill()


def _settings(args: argparse.Namespace) -> int:
    from .desktop import run_settings_window

    return run_settings_window(load_config(args.config), args.config)


def _control(args: argparse.Namespace) -> int:
    from .desktop import run_control_window

    return run_control_window(load_config(args.config), args.config)


def _install_desktop(args: argparse.Namespace) -> int:
    from .desktop import install_desktop_entry

    for path in install_desktop_entry(args.exec):
        print(f"wrote {path}")
    return 0


def _install_service(args: argparse.Namespace) -> int:
    from .desktop import install_service

    path, kind = install_service(args.exec)
    print(f"wrote {path} ({kind})")
    return 0


def _setup(args: argparse.Namespace) -> int:
    """Everything after `pip install`: config, app grid entry, start with the session."""
    from .desktop import environment_checks, install_config, install_desktop_entry, install_service, launcher_command

    exec_cmd = args.exec or launcher_command()
    path, created = install_config()
    print(f"config   : {path} ({'created' if created else 'kept'})")
    for p in install_desktop_entry(exec_cmd):
        print(f"desktop  : {p}")
    unit, kind = install_service(exec_cmd)
    print(f"startup  : {unit} ({kind})")
    print()
    for name, ok, note in environment_checks():
        print(f"  [{'ok' if ok else '--'}] {name}{': ' + note if note else ''}")
    print()
    if kind == "systemd":
        print("Start it: open HYTE Panel from the app grid, or  systemctl --user start hyte-panel")
    else:
        print(f"Start it: {exec_cmd} run    (it will also start with your next login)")
    return 0


def _show_config(args: argparse.Namespace) -> int:
    cfg = load_config(args.config)
    print(f"config source: {cfg.source}")
    print(f"default path : {default_config_path()}")
    print(f"url          : {cfg.url}")
    print(f"display      : {cfg.display.width}x{cfg.display.height} connector={cfg.display.connector or 'auto'} backend={cfg.display.backend}")
    print(f"apps         : {', '.join(a.name for a in cfg.apps) or '(none)'}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="hyte-panel", description="HYTE Y70 Touch panel dashboard")
    parser.add_argument("--config", help="path to config.toml", default=os.environ.get("HYTE_PANEL_CONFIG"))
    parser.add_argument("-v", "--verbose", action="store_true")
    sub = parser.add_subparsers(dest="command")
    sub.add_parser("serve", help="run the HTTP server only").set_defaults(func=_serve)
    sub.add_parser("window", help="open the kiosk window (server must be running)").set_defaults(func=_window)
    sub.add_parser("run", help="run server and window together (default)").set_defaults(func=_run)
    sub.add_parser("show-config", help="print the effective configuration").set_defaults(func=_show_config)
    sub.add_parser("settings", help="open the settings window on the desktop").set_defaults(func=_settings)
    sub.add_parser("control", help="open the control window: start, stop, settings, logs").set_defaults(func=_control)
    p_desk = sub.add_parser("install-desktop", help="add HYTE Panel to the app grid (.desktop file and icon)")
    p_desk.add_argument("--exec", help="command the launcher runs (default: this install's hyte-panel)")
    p_desk.set_defaults(func=_install_desktop)
    p_svc = sub.add_parser("install-service", help="start the panel with the session (systemd user unit, or autostart entry)")
    p_svc.add_argument("--exec", help="command to run (default: this install's hyte-panel)")
    p_svc.set_defaults(func=_install_service)
    p_setup = sub.add_parser("setup", help="after pip install: write config, app grid entry and startup, then check the environment")
    p_setup.add_argument("--exec", help="command the launcher and service run (default: this install's hyte-panel)")
    p_setup.set_defaults(func=_setup)
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    if not args.command:
        args.func = _run
    return int(args.func(args) or 0)


if __name__ == "__main__":
    sys.exit(main())
