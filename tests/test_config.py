import tomllib
from pathlib import Path

from hyte_panel.config import Config, load_config, parse_config

ROOT = Path(__file__).resolve().parent.parent


def test_defaults():
    cfg = Config()
    assert cfg.server.port == 8787
    assert cfg.display.width == 720 and cfg.display.height == 2560
    assert cfg.url == "http://127.0.0.1:8787/"


def test_example_config_parses():
    with (ROOT / "config.example.toml").open("rb") as fh:
        cfg = parse_config(tomllib.load(fh), source="example")
    assert cfg.weather.label == "Sydney"
    assert len(cfg.apps) >= 5
    assert cfg.apps[0].desktop_id == "org.gnome.Terminal"
    assert cfg.apps[-1].command == "loginctl lock-session"
    assert cfg.apps[0].to_public(0) == {"index": 0, "name": "Terminal", "icon": "terminal"}


def test_unknown_keys_and_bad_values_are_tolerated():
    cfg = parse_config(
        {
            "server": {"port": 9000, "mystery": 1, "refresh_seconds": 0.01},
            "weather": {"units": "kelvin"},
            "apps": [{"icon": "x"}, "junk", {"name": "Ok", "command": "true"}],
        }
    )
    assert cfg.server.port == 9000
    assert cfg.server.refresh_seconds == 0.25
    assert cfg.weather.units == "metric"
    assert [a.name for a in cfg.apps] == ["Ok"]


def test_load_config_from_file(tmp_path):
    p = tmp_path / "config.toml"
    p.write_text('[display]\nconnector = "DP-3"\n[[apps]]\nname = "T"\ncommand = "true"\n')
    cfg = load_config(p)
    assert cfg.display.connector == "DP-3"
    assert cfg.source == str(p)


def test_load_config_missing_falls_back_to_example(tmp_path):
    cfg = load_config(tmp_path / "missing.toml")
    assert "example" in cfg.source
    assert cfg.apps


def test_automata_defaults_and_clamp():
    from hyte_panel.config import parse_config

    cfg = parse_config({})
    assert cfg.automata.enabled is True
    assert cfg.automata.rule == "life"
    assert cfg.automata.cell == 2
    assert cfg.automata.attract_idle_seconds == 45
    cfg = parse_config({"automata": {"enabled": False, "cell": 99, "rule": "brain", "unknown": 1}})
    assert cfg.automata.enabled is False
    assert cfg.automata.cell == 8
    assert cfg.automata.rule == "brain"
