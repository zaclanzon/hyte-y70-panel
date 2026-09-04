import pytest
from fastapi.testclient import TestClient

from hyte_panel.config import AppButton, Config
from hyte_panel.server import create_app


@pytest.fixture
def client(monkeypatch):
    cfg = Config()
    cfg.weather.enabled = False
    cfg.hardware.gpu = False
    cfg.agents.scan_processes = False
    cfg.apps = [AppButton(name="Echo", icon="terminal", command="true"), AppButton(name="Missing", command="/nonexistent/bin/x")]
    app = create_app(cfg, background=False)
    with TestClient(app) as c:
        yield c


def test_config_endpoint_hides_commands(client):
    data = client.get("/api/config").json()
    assert data["apps"] == [{"index": 0, "name": "Echo", "icon": "terminal"}, {"index": 1, "name": "Missing", "icon": "app"}]
    assert "command" not in str(data)


def test_snapshot_has_all_sections(client):
    snap = client.get("/api/snapshot").json()
    for key in ("cpu", "memory", "disks", "network", "gpus", "agents", "weather", "theme", "uptime_seconds"):
        assert key in snap
    assert snap["cpu"]["cores"] >= 1
    assert snap["gpus"] == []
    assert snap["weather"]["ok"] is False
    assert snap["theme"]["primary"].startswith("#")
    assert client.get("/api/theme").json() == snap["theme"]


def test_index_and_static(client):
    assert "HYTE Panel" in client.get("/").text
    r = client.get("/static/app.js")
    assert r.status_code == 200
    assert r.headers["cache-control"] == "no-cache"
    assert client.get("/").headers["cache-control"] == "no-cache"


def test_launch(client, monkeypatch):
    calls = []
    monkeypatch.setattr("hyte_panel.server.launch", lambda app: calls.append(app.name) or "ran")
    r = client.post("/api/launch/0")
    assert r.status_code == 200 and r.json()["name"] == "Echo"
    assert calls == ["Echo"]
    assert client.post("/api/launch/99").status_code == 404
    assert client.post("/api/launch/-1").status_code == 404


def test_launch_error_is_reported(client):
    r = client.post("/api/launch/1")
    assert r.status_code == 500
    assert "not found" in r.json()["detail"]


def test_agent_hook_and_status_endpoints(client):
    r = client.post("/api/agents/hook", json={"hook_event_name": "PreToolUse", "tool_name": "Bash", "session_id": "abc", "cwd": "/p/q"})
    assert r.status_code == 200 and r.json() == {}
    agents = client.get("/api/agents").json()
    assert agents[0]["status"] == "working" and agents[0]["detail"] == "Running Bash" and agents[0]["project"] == "q"

    r = client.post("/api/agents/status", json={"id": "job", "status": "attention", "detail": "Approve"})
    assert r.json()["status"] == "attention"
    ids = {a["id"] for a in client.get("/api/agents").json()}
    assert "hook:job" in ids
    assert client.delete("/api/agents/hook:job").json() == {"removed": True}
    assert client.post("/api/agents/hook", json=[1, 2]).status_code == 400


def test_websocket_sends_config_then_agent_events(client):
    with client.websocket_connect("/ws") as ws:
        first = ws.receive_json()
        assert first["type"] == "config"
        client.post("/api/agents/status", json={"id": "ws-test", "status": "working"})
        msg = ws.receive_json()
        assert msg["type"] == "agent" and msg["data"]["id"] == "hook:ws-test"


def test_automata_card_and_module_are_served(client):
    cfg = client.get("/api/config").json()
    assert cfg["automata"]["enabled"] is True
    assert cfg["automata"]["rule"] == "life"
    assert set(cfg["automata"]) >= {"cell", "attract_idle_seconds", "attract_rotate_seconds", "reactive"}
    index = client.get("/").text
    assert 'id="ca-card"' in index
    assert "/static/ca/ca.js" in index and "/static/ca/core.js" in index and "/static/ca/ca.css" in index
    assert 'data-widget="apps" hidden' in index, "apps card exists but is hidden until the layout lists it"
    for name in ("core.js", "ca.js", "ca.css"):
        r = client.get(f"/static/ca/{name}")
        assert r.status_code == 200, name
    assert "CA.mount" in client.get("/static/app.js").text


@pytest.fixture
def saving_client(tmp_path):
    cfg = Config()
    cfg.weather.enabled = False
    cfg.hardware.gpu = False
    cfg.agents.scan_processes = False
    cfg.path = str(tmp_path / "config.toml")
    app = create_app(cfg, background=False)
    with TestClient(app) as c:
        yield c, cfg.path


def test_settings_get_returns_editable_config(saving_client):
    client, _ = saving_client
    data = client.get("/api/settings").json()
    assert set(data["config"]) >= {"server", "weather", "theme", "layout", "apps", "automata"}
    assert data["config"]["layout"]["widgets"][0] == "clock"
    assert "apps" in data["widgets"]
    assert 'id="widgets"' in client.get("/settings").text


def test_settings_put_saves_reloads_and_hides_widgets(saving_client):
    import tomllib

    client, path = saving_client
    body = client.get("/api/settings").json()["config"]
    body["layout"]["widgets"] = ["automata", "clock", "cpu"]
    body["weather"]["label"] = "Somewhere"
    body["theme"]["source"] = "static"
    body["theme"]["preset"] = "sunset"
    body["server"]["port"] = 1  # must be ignored: needs a restart
    r = client.put("/api/settings", json=body)
    assert r.status_code == 200, r.text
    saved = tomllib.loads(open(path, encoding="utf-8").read())
    assert saved["layout"]["widgets"] == ["automata", "clock", "cpu"]
    assert saved["weather"]["label"] == "Somewhere"
    assert saved["server"]["port"] == 8787
    cfg = client.get("/api/config").json()
    assert cfg["layout"]["widgets"] == ["automata", "clock", "cpu"]
    assert cfg["weather"]["enabled"] is False and cfg["agents"]["enabled"] is False
    snap = client.get("/api/snapshot").json()
    assert snap["weather"] is None and snap["agents"] == []
    assert snap["theme"]["source"] == "static" and snap["theme"]["raw"]["primary"] == [255, 90, 0]


def test_settings_put_rejects_bad_input_and_cross_origin(saving_client):
    client, path = saving_client
    assert client.put("/api/settings", content=b"nope", headers={"content-type": "application/json"}).status_code == 400
    assert client.put("/api/settings", json=[1, 2]).status_code == 400
    r = client.put("/api/settings", json={}, headers={"origin": "http://evil.example"})
    assert r.status_code == 403
    r = client.put("/api/settings", json={}, headers={"origin": "http://testserver"})
    assert r.status_code == 200
    import os
    assert os.path.exists(path)


def test_settings_reload_keeps_hook_agents(saving_client):
    client, _ = saving_client
    client.post("/api/agents/hook", json={"hook_event_name": "SessionStart", "session_id": "keepme", "cwd": "/tmp/p"})
    assert any(a["id"].endswith("keepme") or "keepme" in a["id"] for a in client.get("/api/agents").json())
    body = client.get("/api/settings").json()["config"]
    client.put("/api/settings", json=body)
    assert any("keepme" in a["id"] for a in client.get("/api/agents").json())
