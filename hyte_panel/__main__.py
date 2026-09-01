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
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    if not args.command:
        args.func = _run
    return int(args.func(args) or 0)


if __name__ == "__main__":
    sys.exit(main())
