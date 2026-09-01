# hyte-panel

A touch panel dashboard for the **HYTE Y70 Touch** case screen on
**Ubuntu 26.04** with NVIDIA drivers.

The panel is a local web app. A small Python server reads the hardware and
serves the page. A kiosk window shows the page full screen on the HYTE screen.

![Layout](docs/layout.svg)

## Widgets

- **Clock** with date, hostname and uptime.
- **Weather** from Open-Meteo. No API key. Current conditions and a 5-day strip.
- **CPU** usage ring, temperature, clock, load, per-core bars and a history graph.
- **GPU** (NVIDIA) usage ring, temperature, power, clock, fan, VRAM and a history graph.
- **Memory** and **storage** bars.
- **Network** throughput and case fan speeds.
- **AI agents** monitor. Shows Claude Code, Codex, Aider and other agent CLIs with
  a live status: working, waiting, needs attention, idle, ended.
- **App buttons**. Large touch targets that start programs from the config.

## Requirements

- Ubuntu 24.04 or 26.04. GNOME on Wayland or X11.
- Python 3.11 or newer.
- NVIDIA driver with `nvidia-smi` (for GPU data).
- For the kiosk window: `python3-gi`, `gir1.2-gtk-4.0`, `gir1.2-webkit-6.0`,
  or a Chromium/Chrome browser as a fallback.

## Install

```bash
git clone <this repo> hyte-y70-panel
cd hyte-y70-panel
scripts/install-ubuntu.sh
```

The script installs system packages, creates a virtualenv, writes
`~/.config/hyte-panel/config.toml` and enables a systemd user service.

Then:

1. Rotate the HYTE screen to portrait. See [docs/hyte-y70-ubuntu.md](docs/hyte-y70-ubuntu.md).
2. Map the touch sensor: `scripts/map-touch.sh`.
3. Edit the config. Set your weather location and app buttons.
4. Start the panel: `systemctl --user start hyte-panel`.

## Run by hand

```bash
python3 -m venv --system-site-packages .venv
.venv/bin/pip install -e ".[nvidia,dev]"
.venv/bin/hyte-panel run            # server + kiosk window
.venv/bin/hyte-panel serve          # server only, open http://127.0.0.1:8787 in a browser
.venv/bin/hyte-panel show-config    # print the effective config
```

Open `http://127.0.0.1:8787` in any browser to preview the panel. Use the
device toolbar in the browser at 720 x 2560 to see the portrait layout.

## Configure

The config file is `~/.config/hyte-panel/config.toml`. Start from
[config.example.toml](config.example.toml). Key settings:

| Section | Setting | Purpose |
|---|---|---|
| `display` | `width`, `height` | Screen size. Y70 Touch: 720 x 2560. Infinite: 1100 x 3840. |
| `display` | `connector` | Force a monitor, for example `"DP-3"`. Empty = match by size. |
| `display` | `backend` | `auto`, `gtk` or `chromium`. |
| `display` | `dim_after_seconds` | Dim the panel after idle time. Touch wakes it. |
| `weather` | `latitude`, `longitude`, `units` | Location and unit system. |
| `hardware` | `disks`, `network_interface` | Mount points to show. Interface to graph. |
| `agents` | `process_patterns` | Executable names that count as agents. |
| `[[apps]]` | `desktop_id` or `command` | One block per button. |

Only apps from the config can start. The page cannot run arbitrary commands.
Keep `server.host` at `127.0.0.1`.

## Monitor AI agents

The panel finds agents in two ways.

**Process scan.** The server looks for running executables named in
`agents.process_patterns` (default: claude, codex, aider, gemini, cursor-agent,
copilot, goose). It shows the working directory, CPU and memory.

**Hook events.** Claude Code can post its hook payload to the panel. Then the
panel shows the real state: thinking, running a tool, waiting for input, or
waiting for a permission. Copy the `hooks` block from
[examples/claude-code-hooks.json](examples/claude-code-hooks.json) into
`~/.claude/settings.json`.

Any script can report a status too:

```bash
examples/report-status.sh nightly-build working "Compiling"
examples/report-status.sh nightly-build ended   "Build passed"
```

Or with curl:

```bash
curl -X POST http://127.0.0.1:8787/api/agents/status \
  -H 'Content-Type: application/json' \
  -d '{"id":"my-agent","name":"My agent","status":"attention","detail":"Needs approval"}'
```

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/config` | Public config: apps, display, weather label. |
| GET | `/api/snapshot` | One reading of all hardware, weather and agents. |
| GET | `/api/weather?refresh=1` | Weather; `refresh=1` forces a fetch. |
| GET | `/api/agents` | Agent list. |
| POST | `/api/agents/hook` | Claude Code hook payload (JSON on stdin). |
| POST | `/api/agents/status` | Generic status: `{id, name, status, detail, cwd}`. |
| DELETE | `/api/agents/{id}` | Remove a hook-reported agent. |
| POST | `/api/launch/{index}` | Start app button `index`. |
| WS | `/ws` | Push stream: `config`, `snapshot` and `agent` messages. |

## Layout

```
hyte_panel/
  __main__.py          CLI: run | serve | window | show-config
  config.py            TOML config and defaults
  server.py            FastAPI app, WebSocket stream, launch endpoint
  window.py            GTK4/WebKit kiosk window, Chromium fallback
  launcher.py          Starts app buttons (gtk-launch or command)
  collectors/
    system.py          CPU, memory, disks, network, sensors (psutil)
    gpu.py             NVIDIA via NVML or nvidia-smi
    weather.py         Open-Meteo client
    agents.py          Agent registry: hook events + process scan
  static/              index.html, style.css, app.js
scripts/               install-ubuntu.sh, map-touch.sh
systemd/               user service unit
examples/              Claude Code hooks, report-status.sh
docs/                  Ubuntu + HYTE setup notes
tests/                 pytest suite
```

## Test

```bash
.venv/bin/pytest
```

## License

MIT. See [LICENSE](LICENSE).
