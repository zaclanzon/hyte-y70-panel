# Install on your machine

Follow these steps on the Ubuntu PC that has the HYTE Y70 Touch. Each step
shows the command and how to check the result.

### 1. Get the code

```bash
git clone https://github.com/zaclanzon/hyte-y70-panel-linux.git ~/src/hyte-y70-panel
cd ~/src/hyte-y70-panel
```

### 2. Check the display and the driver

```bash
nvidia-smi                       # must list your GPU
echo $XDG_SESSION_TYPE           # wayland or x11
xrandr --query | grep connected  # X11 only: the HYTE screen shows as 2560x720
```

If `nvidia-smi` fails, install the driver first: `sudo ubuntu-drivers install`,
then reboot.

### 3. Run the installer

```bash
scripts/install-ubuntu.sh
```

The script asks for `sudo` once. It installs GTK4, WebKitGTK, PyGObject and
lm-sensors, creates a virtualenv in `~/.local/share/hyte-panel/venv`, writes
`~/.config/hyte-panel/config.toml` and enables the `hyte-panel` systemd user
service. It does not start the service.

Check: `~/.local/share/hyte-panel/venv/bin/hyte-panel show-config` prints the
config path and the app list.

### 4. Rotate the HYTE screen to portrait

1. Open Settings > Displays.
2. Select the 2560 x 720 monitor.
3. Set Orientation to "Portrait Right". If the image is upside down, use
   "Portrait Left".
4. Click Apply, then Keep Changes.

Check: the HYTE screen shows the desktop upright. GNOME writes
`~/.config/monitors.xml`. See [hyte-y70-ubuntu.md](hyte-y70-ubuntu.md)
for the X11 command line.

### 5. Map the touch sensor to the HYTE screen

```bash
scripts/map-touch.sh              # auto-detect
scripts/map-touch.sh DP-3         # or give the connector name from step 2
```

Check: touch the HYTE screen. The pointer moves on the HYTE screen, not on the
main monitor.

### 6. Edit the config

```bash
nano ~/.config/hyte-panel/config.toml
```

- Set `weather.label`, `weather.latitude` and `weather.longitude`.
- Set `display.connector` if the panel opens on the wrong monitor.
- Add or remove `[[apps]]` blocks. Find desktop ids with
  `ls /usr/share/applications ~/.local/share/applications /var/lib/snapd/desktop/applications`.
- Set `hardware.disks` to the mount points you want to see.

### 7. Start the panel

Open **HYTE Panel** from the app grid and press Start, or:

```bash
systemctl --user start hyte-panel
systemctl --user status hyte-panel
journalctl --user -u hyte-panel -f       # live log
```

Check: the panel fills the HYTE screen. The footer shows a green "live" dot.
Open `http://127.0.0.1:8787` in a browser to see the same page.

If the window does not open, import the session variables and restart:

```bash
systemctl --user import-environment DISPLAY WAYLAND_DISPLAY XDG_SESSION_TYPE
systemctl --user restart hyte-panel
```

### 8. Connect Claude Code

Copy the `hooks` block from
[examples/claude-code-hooks.json](../examples/claude-code-hooks.json) into
`~/.claude/settings.json`. If the file already has a `hooks` block, merge the
entries. Start a Claude Code session. The AI agents card shows it within a
few seconds.

Check: `curl -s http://127.0.0.1:8787/api/agents` lists the session.

### 9. Keep the screen on

Set Settings > Power > Screen Blank to "Never", or set
`display.dim_after_seconds` in the config to dim only the panel.

### Update later

```bash
cd ~/src/hyte-y70-panel && git pull
~/.local/share/hyte-panel/venv/bin/pip install --quiet ".[nvidia]"
systemctl --user restart hyte-panel
```

### Uninstall

```bash
systemctl --user disable --now hyte-panel
rm -rf ~/.local/share/hyte-panel ~/.config/hyte-panel ~/.config/systemd/user/hyte-panel.service
```
