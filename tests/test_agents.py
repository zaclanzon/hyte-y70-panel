import time

from hyte_panel.collectors.agents import (
    STATUS_ATTENTION,
    STATUS_ENDED,
    STATUS_IDLE,
    STATUS_WAITING,
    STATUS_WORKING,
    AgentRegistry,
    map_hook_event,
)


def test_hook_event_mapping():
    assert map_hook_event({"hook_event_name": "PreToolUse", "tool_name": "Bash"}) == (STATUS_WORKING, "Running Bash")
    assert map_hook_event({"hook_event_name": "Stop"}) == (STATUS_WAITING, "Waiting for input")
    assert map_hook_event({"hook_event_name": "PermissionRequest", "tool_name": "Edit"}) == (
        STATUS_ATTENTION,
        "Permission needed: Edit",
    )
    assert map_hook_event({"hook_event_name": "SessionEnd"}) == (STATUS_ENDED, "Session ended")
    status, detail = map_hook_event({"hook_event_name": "Notification", "message": "Claude is waiting for your input"})
    assert status == STATUS_WAITING and "waiting" in detail
    status, _ = map_hook_event({"hook_event_name": "Notification", "message": "Claude needs your permission"})
    assert status == STATUS_ATTENTION
    assert map_hook_event({})[0] == STATUS_WORKING


def test_registry_tracks_sessions_and_tools():
    reg = AgentRegistry(patterns=[], scan_processes=False)
    reg.apply_hook({"hook_event_name": "SessionStart", "session_id": "s1", "cwd": "/home/u/proj"})
    reg.apply_hook({"hook_event_name": "PreToolUse", "session_id": "s1", "tool_name": "Read"})
    reg.apply_hook({"hook_event_name": "PreToolUse", "session_id": "s1", "tool_name": "Bash"})
    reg.apply_hook({"hook_event_name": "SessionStart", "session_id": "s2", "cwd": "/tmp/other"})
    rows = reg.snapshot()
    assert len(rows) == 2
    working = next(r for r in rows if r["status"] == STATUS_WORKING)
    assert working["tools_used"] == 2
    assert working["last_tool"] == "Bash"
    assert working["project"] == "proj"
    assert working["events"] == 3
    # Working sorts before idle.
    assert rows[0]["status"] == STATUS_WORKING and rows[1]["status"] == STATUS_IDLE


def test_generic_status_and_removal():
    reg = AgentRegistry(patterns=[], scan_processes=False)
    st = reg.set_status({"id": "build", "status": "ATTENTION", "detail": "Approve?"})
    assert st.status == STATUS_ATTENTION
    bad = reg.set_status({"id": "x", "status": "nonsense"})
    assert bad.status == STATUS_WORKING
    assert reg.remove(st.id) is True
    assert reg.remove(st.id) is False


def test_stale_and_ended_agents_are_dropped():
    reg = AgentRegistry(patterns=[], scan_processes=False, stale_seconds=10)
    old = reg.apply_hook({"hook_event_name": "Stop", "session_id": "old"})
    old.updated_at = time.time() - 60
    ended = reg.apply_hook({"hook_event_name": "SessionEnd", "session_id": "done"})
    ended.updated_at = time.time() - 61
    fresh = reg.apply_hook({"hook_event_name": "Stop", "session_id": "fresh"})
    ids = [r["id"] for r in reg.snapshot()]
    assert ids == [fresh.id]


def test_process_scan_finds_matching_process():
    import subprocess
    import sys
    import shutil
    import tempfile

    # Run a copy of "sleep" named "codex" so the scanner has something to find.
    with tempfile.TemporaryDirectory() as d:
        fake = f"{d}/codex"
        shutil.copy(shutil.which("sleep"), fake)
        proc = subprocess.Popen([fake, "30"], cwd=d)
        try:
            reg = AgentRegistry(patterns=["codex"], scan_processes=True)
            time.sleep(0.2)
            rows = [r for r in reg.snapshot() if r["pid"] == proc.pid]
            assert rows and rows[0]["name"] == "codex"
            assert rows[0]["source"] == "process"
            assert rows[0]["cwd"] == d
        finally:
            proc.kill()
            proc.wait()
    assert sys.executable  # keep import used
