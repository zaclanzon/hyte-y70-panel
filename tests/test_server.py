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
    for key in ("cpu", "memory", "disks", "network", "gpus", "agents", "weather", "uptime_seconds"):
        assert key in snap
    assert snap["cpu"]["cores"] >= 1
    assert snap["gpus"] == []
    assert snap["weather"]["ok"] is False


def test_index_and_static(client):
    assert "HYTE Panel" in client.get("/").text
    assert client.get("/static/app.js").status_code == 200


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
