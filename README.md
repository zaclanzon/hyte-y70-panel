# hyte-panel

A dashboard for the **HYTE Y70 Touch** case screen, for any Linux desktop. Clock, weather,
CPU, GPU, memory, network, fan speeds, your AI coding agents, and a cellular
automata playground you can paint on. Colors follow your case lighting.

<img src="docs/screenshot.png" alt="The panel on the HYTE Y70 Touch screen" width="341">

## How it works

The panel is a small web app that runs on your PC.

- A Python server (FastAPI) reads the hardware once a second and serves one
  page. It listens on `http://127.0.0.1:8787` only.
- A kiosk window shows that page full screen on the HYTE screen. It is a GTK4
  window with WebKit inside, so touch works like on a phone.
- The same page opens in any browser on the PC. `http://127.0.0.1:8787/` is
  the panel, `http://127.0.0.1:8787/settings` is the settings page, and
  `/api/...` returns the data as JSON.
- Everything runs as a systemd user service and shows up as **HYTE Panel** in
  the app grid. No build step, no API keys, one Python venv.

## Install

Any Linux distribution with a desktop session. Python 3.11+. NVIDIA driver for
GPU data. The installer knows the package names for Debian, Ubuntu, Fedora,
Arch, openSUSE, Alpine and Void; on anything else it tells you what to install.

```bash
git clone https://github.com/zaclanzon/hyte-y70-panel-linux.git ~/src/hyte-y70-panel
cd ~/src/hyte-y70-panel
scripts/install.sh        # system packages (sudo once), a venv, config, app grid entry, autostart
```

Then rotate the HYTE screen to portrait in your display settings, run
`scripts/map-touch.sh` so touches land on it, and open **HYTE Panel** from
the app grid and press Start.

Prefer pipx? The system packages for GTK4, WebKitGTK and PyGObject still come
from your distro (see the installer for names), then:

```bash
pipx install --system-site-packages "hyte-panel[nvidia] @ git+https://github.com/zaclanzon/hyte-y70-panel-linux.git"
hyte-panel setup          # config, app grid entry, systemd user unit or autostart entry, environment check
```

With systemd the panel runs as a user service; without it, an XDG autostart
entry starts it at login. The step-by-step checklist is in
[docs/install.md](docs/install.md), screen and driver notes in
[docs/hyte-y70-ubuntu.md](docs/hyte-y70-ubuntu.md).

Update later:

```bash
cd ~/src/hyte-y70-panel && git pull
~/.local/share/hyte-panel/venv/bin/pip install --quiet ".[nvidia]"
systemctl --user restart hyte-panel      # or: hyte-panel run
```

## Use it

**Control window.** Open **HYTE Panel** from the app grid: running or not,
Start / Stop / Restart, Settings, Open in browser, recent log. Right-click the
icon for Settings, Start and Stop.

**Choose your widgets.** Tap the sliders icon at the bottom of the panel. Every
card gets up, down and hide buttons; hidden ones wait in a tray at the bottom.
Or open Settings, in the control window or at `http://127.0.0.1:8787/settings`,
to toggle and reorder widgets and change each one's options: weather location
with a place search, disks, agent process names, the automata rule, app
buttons, and where the colors come from. Changes apply immediately.

**Colors.** Two accent colors drive the whole page. By default they come from
your case lighting through an [OpenRGB](https://openrgb.org) server, or from a
JSON file your lighting tool writes. Without either, pick a preset or two
colors in Settings.

**Automata.** The card runs Life-like rules, Brian's Brain, Wolfram's
elementary rules and cyclic automata on the GPU. Drag to paint, hold to stamp
a pattern, tap the rule name to pick another. Left alone it rotates rules, and
CPU load, network traffic and agent activity feed the world. Details in
[automata/README.md](automata/README.md).

**AI agents.** The card lists running agent CLIs (Claude Code, Codex, Aider,
Gemini, and more). For live status from Claude Code, copy the `hooks` block
from [examples/claude-code-hooks.json](examples/claude-code-hooks.json) into
`~/.claude/settings.json`. Any script can post a status:

```bash
curl -X POST http://127.0.0.1:8787/api/agents/status \
  -H 'Content-Type: application/json' \
  -d '{"id":"nightly","name":"Nightly build","status":"working","detail":"Compiling"}'
```

## Configure by hand

Settings are stored in `~/.config/hyte-panel/config.toml`. The settings page
writes the same file, so editing by hand is optional. See
[config.example.toml](config.example.toml) for every key with comments. The
ones the settings page does not cover, read at start only:

| Key | Purpose |
|---|---|
| `server.host`, `server.port` | Keep the host at `127.0.0.1`: the page can launch programs. |
| `display.width`, `display.height` | Screen size. Y70 Touch: 720 x 2560. Infinite: 1100 x 3840. |
| `display.connector` | Force a monitor, for example `"DP-3"`. Empty = match by size. |
| `display.backend` | `auto`, `gtk`, or `chromium` as a fallback kiosk. |

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/snapshot` | One reading of all hardware, weather, agents and theme. |
| GET | `/api/config` | Public config: layout, apps, display, weather label. |
| GET, PUT | `/api/settings` | Read or save the config. Saving reloads live. Same-origin only. |
| GET | `/api/theme` | Accent colors and their source. |
| GET | `/api/agents` | Agent list. |
| POST | `/api/agents/hook` | Claude Code hook payload. |
| POST | `/api/agents/status` | Generic status: `{id, name, status, detail}`. |
| POST | `/api/launch/{index}` | Start app button `index`. |
| WS | `/ws` | Push stream of `config`, `snapshot` and `agent` messages. |

## Develop

```bash
python3 -m venv --system-site-packages .venv
.venv/bin/pip install -e ".[nvidia,dev]"
.venv/bin/hyte-panel serve       # server only; open http://127.0.0.1:8787 in a browser
.venv/bin/hyte-panel run         # server + kiosk window
.venv/bin/pytest
```

Use the browser's device toolbar at 682 x 2560 to see the portrait layout.
Front end is plain HTML, CSS and JS in `hyte_panel/static/`; the automata
module is `hyte_panel/static/ca/` with its own tests in `automata/`.

```
hyte_panel/
  __main__.py    CLI: run | serve | window | setup | settings | control | show-config
  server.py      FastAPI app, WebSocket stream, settings and launch endpoints
  config.py      TOML config, defaults, save
  window.py      GTK4/WebKit kiosk window, Chromium fallback
  desktop.py     control window, settings window, desktop entry, service / autostart
  data/          example config, .desktop file, icon, systemd unit
  collectors/    system, gpu, weather, agents, theme
  static/        index.html, style.css, app.js, ambient.js, settings.html, ca/
scripts/         install.sh, map-touch.sh
docs/            install checklist, HYTE screen notes
```

## License

MIT. See [LICENSE](LICENSE).
