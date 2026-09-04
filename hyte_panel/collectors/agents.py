"""AI agent monitoring.

Two sources feed the registry:

1. Hook events. Claude Code (and any tool that can run a shell command) posts
   its hook payload to POST /api/agents/hook. The registry maps the event
   name to a status such as "working" or "waiting".
2. Process scan. psutil finds running agent CLIs (claude, codex, aider, ...)
   by executable name, so agents without hooks still show up.
"""

from __future__ import annotations

import os
import time
from dataclasses import asdict, dataclass, field
from typing import Any

import psutil

STATUS_WORKING = "working"
STATUS_WAITING = "waiting"
STATUS_ATTENTION = "attention"
STATUS_IDLE = "idle"
STATUS_ENDED = "ended"

VALID_STATUSES = {STATUS_WORKING, STATUS_WAITING, STATUS_ATTENTION, STATUS_IDLE, STATUS_ENDED}

# Claude Code hook_event_name -> (status, detail template)
_HOOK_MAP: dict[str, tuple[str, str]] = {
    "SessionStart": (STATUS_IDLE, "Session started"),
    "UserPromptSubmit": (STATUS_WORKING, "Thinking"),
    "PreToolUse": (STATUS_WORKING, "Running {tool}"),
    "PostToolUse": (STATUS_WORKING, "Finished {tool}"),
    "PostToolUseFailure": (STATUS_WORKING, "{tool} failed"),
    "SubagentStart": (STATUS_WORKING, "Subagent started"),
    "SubagentStop": (STATUS_WORKING, "Subagent finished"),
    "PermissionRequest": (STATUS_ATTENTION, "Permission needed: {tool}"),
    "Notification": (STATUS_ATTENTION, "{message}"),
    "Stop": (STATUS_WAITING, "Waiting for input"),
    "PreCompact": (STATUS_WORKING, "Compacting context"),
    "SessionEnd": (STATUS_ENDED, "Session ended"),
}


@dataclass
class AgentState:
    id: str
    name: str
    status: str = STATUS_IDLE
    detail: str = ""
    cwd: str = ""
    source: str = "hook"  # hook | process
    pid: int | None = None
    started_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    events: int = 0
    tools_used: int = 0
    cpu_percent: float | None = None
    memory_mb: float | None = None
    last_tool: str = ""

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["age_seconds"] = time.time() - self.updated_at
        d["project"] = os.path.basename(self.cwd.rstrip("/")) if self.cwd else ""
        return d


def map_hook_event(payload: dict[str, Any]) -> tuple[str, str]:
    """Translate a Claude Code hook payload into (status, detail)."""
    event = str(payload.get("hook_event_name") or payload.get("event") or "")
    tool = str(payload.get("tool_name") or "")
    message = str(payload.get("message") or payload.get("title") or "")
    status, template = _HOOK_MAP.get(event, (STATUS_WORKING, event or "Event"))
    detail = template.format(tool=tool or "tool", message=message or "Needs attention")
    if event == "Notification":
        low = message.lower()
        if "waiting for your input" in low or "idle" in low:
            status = STATUS_WAITING
    return status, detail.strip()


class AgentRegistry:
    def __init__(self, patterns: list[str], scan_processes: bool = True, stale_seconds: int = 900) -> None:
        self.patterns = {p.lower() for p in patterns if p}
        self.scan_processes = scan_processes
        self.stale_seconds = stale_seconds
        self._hook_agents: dict[str, AgentState] = {}
        self._own_pid = os.getpid()

    def adopt(self, other: "AgentRegistry") -> None:
        """Take over another registry's hook-reported agents (after a settings reload)."""
        self._hook_agents.update(other._hook_agents)

    # ---- hook / status sources -------------------------------------------------

    def apply_hook(self, payload: dict[str, Any]) -> AgentState:
        session = str(payload.get("session_id") or payload.get("id") or "unknown")
        agent_name = str(payload.get("agent") or payload.get("name") or "Claude Code")
        key = f"hook:{agent_name}:{session}"
        state = self._hook_agents.get(key)
        if state is None:
            state = AgentState(id=key, name=agent_name, source="hook")
            self._hook_agents[key] = state
        status, detail = map_hook_event(payload)
        state.status = status
        state.detail = detail
        state.cwd = str(payload.get("cwd") or state.cwd)
        state.updated_at = time.time()
        state.events += 1
        tool = payload.get("tool_name")
        if tool and payload.get("hook_event_name") == "PreToolUse":
            state.tools_used += 1
            state.last_tool = str(tool)
        return state

    def set_status(self, payload: dict[str, Any]) -> AgentState:
        """Generic status update: {id, name, status, detail, cwd}."""
        agent_id = str(payload.get("id") or payload.get("name") or "agent")
        key = f"hook:{agent_id}"
        state = self._hook_agents.get(key)
        if state is None:
            state = AgentState(id=key, name=str(payload.get("name") or agent_id), source="hook")
            self._hook_agents[key] = state
        status = str(payload.get("status") or STATUS_WORKING).lower()
        state.status = status if status in VALID_STATUSES else STATUS_WORKING
        state.detail = str(payload.get("detail") or "")
        state.cwd = str(payload.get("cwd") or state.cwd)
        state.updated_at = time.time()
        state.events += 1
        return state

    def remove(self, agent_id: str) -> bool:
        return self._hook_agents.pop(agent_id, None) is not None

    def clear(self) -> None:
        self._hook_agents.clear()

    # ---- process scan ------------------------------------------------------------

    def _match(self, proc: psutil.Process) -> str | None:
        try:
            name = (proc.name() or "").lower()
            cmdline = proc.cmdline()
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            return None
        candidates = [name]
        for arg in cmdline[:3]:
            candidates.append(os.path.basename(arg).lower())
        for c in candidates:
            base = c.split(".")[0] if c.endswith((".js", ".py", ".mjs", ".cjs")) else c
            if base in self.patterns:
                return base
        return None

    def scan(self) -> list[AgentState]:
        if not self.scan_processes:
            return []
        found: list[AgentState] = []
        hooked_pids = set()
        for p in psutil.process_iter(["pid", "name", "create_time"]):
            if p.pid == self._own_pid:
                continue
            match = self._match(p)
            if not match:
                continue
            try:
                # Skip child helper processes of an already listed agent.
                parent = p.parent()
                if parent is not None and parent.pid in hooked_pids:
                    continue
                cwd = p.cwd()
            except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                cwd = ""
            try:
                cpu = p.cpu_percent(interval=None)
                mem = p.memory_info().rss / 1024 / 1024
            except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                cpu, mem = None, None
            hooked_pids.add(p.pid)
            found.append(
                AgentState(
                    id=f"proc:{p.pid}",
                    name=match,
                    status=STATUS_WORKING if (cpu or 0) > 5 else STATUS_IDLE,
                    detail="Process running",
                    cwd=cwd,
                    source="process",
                    pid=p.pid,
                    started_at=p.info.get("create_time") or time.time(),
                    updated_at=time.time(),
                    cpu_percent=cpu,
                    memory_mb=mem,
                )
            )
        return found

    # ---- combined view -----------------------------------------------------------

    def snapshot(self) -> list[dict[str, Any]]:
        now = time.time()
        for key, st in list(self._hook_agents.items()):
            if st.status == STATUS_ENDED and now - st.updated_at > 60:
                del self._hook_agents[key]
            elif now - st.updated_at > self.stale_seconds:
                del self._hook_agents[key]
        hooked = list(self._hook_agents.values())
        procs = self.scan()
        # Hide process rows whose cwd matches a hook-reported agent; the hook has better data.
        hook_cwds = {st.cwd for st in hooked if st.cwd}
        procs = [p for p in procs if not (p.cwd and p.cwd in hook_cwds)]
        order = {STATUS_ATTENTION: 0, STATUS_WORKING: 1, STATUS_WAITING: 2, STATUS_IDLE: 3, STATUS_ENDED: 4}
        rows = hooked + procs
        rows.sort(key=lambda s: (order.get(s.status, 9), -s.updated_at))
        return [r.to_dict() for r in rows]
