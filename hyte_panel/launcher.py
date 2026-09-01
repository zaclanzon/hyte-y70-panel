"""Launch configured app buttons. Only entries from the config can run."""

from __future__ import annotations

import os
import shlex
import shutil
import subprocess

from .config import AppButton


def _detached(argv: list[str]) -> None:
    subprocess.Popen(
        argv,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
        cwd=os.path.expanduser("~"),
    )


def launch(app: AppButton) -> str:
    """Start the app. Returns a short description of what ran."""
    if app.desktop_id:
        desktop_id = app.desktop_id
        if not desktop_id.endswith(".desktop"):
            desktop_id += ".desktop"
        for tool in ("gtk-launch", "gio"):
            exe = shutil.which(tool)
            if not exe:
                continue
            if tool == "gtk-launch":
                _detached([exe, desktop_id])
            else:
                _detached([exe, "launch", desktop_id])
            return f"{tool} {desktop_id}"
        raise RuntimeError("gtk-launch or gio is required to launch desktop apps")
    if app.command:
        argv = shlex.split(app.command)
        if not argv:
            raise RuntimeError("empty command")
        if not shutil.which(argv[0]) and not os.path.exists(argv[0]):
            raise RuntimeError(f"command not found: {argv[0]}")
        _detached(argv)
        return app.command
    raise RuntimeError("app has neither desktop_id nor command")
