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


def test_install_service_writes_systemd_unit(tmp_path, monkeypatch):
    monkeypatch.setattr(desktop.shutil, "which", lambda name: None)  # no systemctl to call
    path, kind = desktop.install_service("/opt/venv/bin/hyte-panel", config_home=tmp_path, use_systemd=True)
    assert kind == "systemd" and path == tmp_path / "systemd" / "user" / "hyte-panel.service"
    text = path.read_text()
    assert "ExecStart=/opt/venv/bin/hyte-panel run" in text and "__EXEC__" not in text
    assert "WantedBy=graphical-session.target" in text


def test_install_service_falls_back_to_autostart(tmp_path):
    path, kind = desktop.install_service("/opt/venv/bin/hyte-panel", config_home=tmp_path, use_systemd=False)
    assert kind == "autostart" and path == tmp_path / "autostart" / "io.github.hyte_panel.desktop"
    text = path.read_text()
    assert "Exec=/opt/venv/bin/hyte-panel run" in text and text.startswith("[Desktop Entry]")


def test_install_config_copies_example_once(tmp_path):
    path, created = desktop.install_config(config_home=tmp_path)
    assert created and path == tmp_path / "hyte-panel" / "config.toml"
    assert "[weather]" in path.read_text()
    path.write_text("# mine")
    path2, created2 = desktop.install_config(config_home=tmp_path)
    assert path2 == path and not created2 and path.read_text() == "# mine"


def test_setup_command_does_everything(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path / "cfg"))
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path / "data"))
    monkeypatch.setattr(desktop.shutil, "which", lambda name: None)  # no systemctl -> autostart, no nvidia-smi
    assert main(["setup", "--exec", "/x/hyte-panel"]) == 0
    out = capsys.readouterr().out
    assert (tmp_path / "cfg" / "hyte-panel" / "config.toml").exists()
    assert (tmp_path / "data" / "applications" / "io.github.hyte_panel.desktop").exists()
    assert (tmp_path / "cfg" / "autostart" / "io.github.hyte_panel.desktop").exists()
    assert "created" in out and "autostart" in out and "[--] nvidia-smi" in out


def test_environment_checks_shape():
    checks = desktop.environment_checks()
    names = [c[0] for c in checks]
    assert "GTK4 (PyGObject)" in names and "WebKitGTK 6.0" in names
    assert all(isinstance(ok, bool) for _, ok, _ in checks)
