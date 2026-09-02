"""FastAPI application: static UI, JSON API and a WebSocket stream."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import __version__
from .collectors.agents import AgentRegistry
from .collectors.gpu import GpuCollector
from .collectors.system import SystemCollector
from .collectors.theme import ThemeCollector
from .collectors.weather import WeatherCollector
from .config import Config, load_config
from .launcher import launch

log = logging.getLogger("hyte_panel")
STATIC_DIR = Path(__file__).resolve().parent / "static"


class PanelState:
    """Holds collectors and the latest snapshot. One instance per server."""

    def __init__(self, cfg: Config) -> None:
        self.cfg = cfg
        self.system = SystemCollector(cfg.hardware.disks, cfg.hardware.network_interface)
        self.gpu = GpuCollector(cfg.hardware.gpu)
        self.weather = WeatherCollector(cfg.weather)
        self.agents = AgentRegistry(
            cfg.agents.process_patterns, cfg.agents.scan_processes, cfg.agents.stale_seconds
        )
        self.theme = ThemeCollector(cfg.theme)
        self.snapshot: dict[str, Any] = {}
        self.clients: set[WebSocket] = set()
        self._task: asyncio.Task | None = None
        self._http: httpx.AsyncClient | None = None
        self._tick = 0

    def public_config(self) -> dict[str, Any]:
        return {
            "version": __version__,
            "source": self.cfg.source,
            "refresh_seconds": self.cfg.server.refresh_seconds,
            "display": {
                "width": self.cfg.display.width,
                "height": self.cfg.display.height,
                "dim_after_seconds": self.cfg.display.dim_after_seconds,
            },
            "weather": {"enabled": self.cfg.weather.enabled, "label": self.cfg.weather.label, "units": self.cfg.weather.units},
            "agents": {"enabled": self.cfg.agents.enabled},
            "apps": [a.to_public(i) for i, a in enumerate(self.cfg.apps)],
        }

    def collect(self) -> dict[str, Any]:
        snap = self.system.snapshot()
        snap["gpus"] = self.gpu.snapshot()
        snap["agents"] = self.agents.snapshot() if self.cfg.agents.enabled else []
        snap["weather"] = self.weather.data
        snap["theme"] = self.theme.snapshot()
        snap["time"] = time.time()
        self.snapshot = snap
        return snap

    async def broadcast(self, message: dict[str, Any]) -> None:
        dead = []
        for ws in list(self.clients):
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.clients.discard(ws)

    async def _loop(self) -> None:
        self._http = httpx.AsyncClient(timeout=10)
        try:
            while True:
                if self.weather.due:
                    await self.weather.refresh(self._http)
                try:
                    snap = await asyncio.to_thread(self.collect)
                    await self.broadcast({"type": "snapshot", "data": snap})
                except Exception:
                    log.exception("collect failed")
                await asyncio.sleep(self.cfg.server.refresh_seconds)
        finally:
            await self._http.aclose()

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None


def create_app(cfg: Config | None = None, *, background: bool = True) -> FastAPI:
    cfg = cfg or load_config()
    state = PanelState(cfg)

    @contextlib.asynccontextmanager
    async def lifespan(_: FastAPI):
        if background:
            state.start()
        yield
        await state.stop()

    app = FastAPI(title="hyte-panel", version=__version__, lifespan=lifespan)
    app.state.panel = state

    @app.middleware("http")
    async def no_cache(request: Request, call_next):
        # The kiosk view must always revalidate the page and static files.
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-cache"
        return response

    @app.get("/")
    async def index() -> FileResponse:
        return FileResponse(STATIC_DIR / "index.html")

    @app.get("/api/config")
    async def api_config() -> dict[str, Any]:
        return state.public_config()

    @app.get("/api/snapshot")
    async def api_snapshot() -> dict[str, Any]:
        return await asyncio.to_thread(state.collect)

    @app.get("/api/weather")
    async def api_weather(refresh: bool = False) -> dict[str, Any]:
        if refresh:
            await state.weather.refresh(state._http)
        return state.weather.data

    @app.get("/api/theme")
    async def api_theme() -> dict[str, Any]:
        return state.theme.snapshot()

    @app.post("/api/launch/{index}")
    async def api_launch(index: int) -> dict[str, Any]:
        if index < 0 or index >= len(cfg.apps):
            raise HTTPException(status_code=404, detail="unknown app")
        app_btn = cfg.apps[index]
        try:
            ran = await asyncio.to_thread(launch, app_btn)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        return {"ok": True, "name": app_btn.name, "ran": ran}

    @app.get("/api/agents")
    async def api_agents() -> list[dict[str, Any]]:
        return state.agents.snapshot()

    @app.post("/api/agents/hook")
    async def api_agents_hook(request: Request) -> JSONResponse:
        """Accepts a Claude Code hook payload (the JSON the hook gets on stdin)."""
        try:
            payload = await request.json()
        except Exception:
            payload = {}
        if not isinstance(payload, dict):
            raise HTTPException(status_code=400, detail="expected a JSON object")
        st = state.agents.apply_hook(payload)
        await state.broadcast({"type": "agent", "data": st.to_dict()})
        # Return an empty object so hooks that read stdout see valid JSON.
        return JSONResponse({})

    @app.post("/api/agents/status")
    async def api_agents_status(payload: dict[str, Any]) -> dict[str, Any]:
        st = state.agents.set_status(payload)
        await state.broadcast({"type": "agent", "data": st.to_dict()})
        return st.to_dict()

    @app.delete("/api/agents/{agent_id:path}")
    async def api_agents_delete(agent_id: str) -> dict[str, Any]:
        return {"removed": state.agents.remove(agent_id)}

    @app.websocket("/ws")
    async def ws_endpoint(ws: WebSocket) -> None:
        await ws.accept()
        state.clients.add(ws)
        try:
            await ws.send_json({"type": "config", "data": state.public_config()})
            if state.snapshot:
                await ws.send_json({"type": "snapshot", "data": state.snapshot})
            while True:
                await ws.receive_text()  # keepalive pings from the client
        except WebSocketDisconnect:
            pass
        finally:
            state.clients.discard(ws)

    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
    return app
