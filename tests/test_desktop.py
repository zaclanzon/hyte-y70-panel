import subprocess

from hyte_panel import desktop
from hyte_panel.__main__ import main


def test_install_desktop_entry_writes_launcher_and_icon(tmp_path, monkeypatch):
    monkeypatch.setattr(desktop.shutil, "which", lambda name: None)  # no cache updaters
    paths = desktop.install_desktop_entry("/opt/venv/bin/hyte-panel", data_home=tmp_path)
    assert [p.name for p in paths] == ["io.github.hyte_panel.desktop", "io.github.hyte_panel.svg"]
    text = paths[0].read_text()
    assert "Exec=/opt/venv/bin/hyte-panel control" in text
    assert "Exec=/opt/venv/bin/hyte-panel settings" in text
    assert "Icon=io.github.hyte_panel" in text and "__EXEC__" not in text
    assert paths[1].read_text().startswith("<svg")
    assert paths[0].parent == tmp_path / "applications"


def test_install_desktop_entry_respects_xdg_data_home(tmp_path, monkeypatch):
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path / "xdg"))
    monkeypatch.setattr(desktop.shutil, "which", lambda name: None)
    paths = desktop.install_desktop_entry("hp")
    assert paths[0].parent == tmp_path / "xdg" / "applications"


def test_service_state_handles_missing_systemctl(monkeypatch):
    monkeypatch.setattr(desktop.shutil, "which", lambda name: None)
    assert desktop.service_state() == "unknown"
    assert desktop.service_action("start") == (False, "systemctl not found")


def test_service_state_reports_missing_unit(monkeypatch):
    monkeypatch.setattr(desktop.shutil, "which", lambda name: "/bin/systemctl")

    def fake_run(argv, **kw):
        if "is-active" in argv:
            return subprocess.CompletedProcess(argv, 3, stdout="inactive\n", stderr="")
        return subprocess.CompletedProcess(argv, 1, stdout="", stderr="Failed to get unit file state for hyte-panel.service: No such file or directory")

    monkeypatch.setattr(desktop.subprocess, "run", fake_run)
    assert desktop.service_state() == "missing"


def test_cli_knows_the_desktop_commands(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path))
    monkeypatch.setattr(desktop.shutil, "which", lambda name: None)
    assert main(["install-desktop", "--exec", "/x/hyte-panel"]) == 0
    out = capsys.readouterr().out
    assert "io.github.hyte_panel.desktop" in out and (tmp_path / "applications" / "io.github.hyte_panel.desktop").exists()
    import argparse

    with_help = argparse.ArgumentParser(prog="t")
    assert with_help  # smoke: importing main worked
