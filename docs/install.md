# Install on your machine

Follow these steps on the Linux PC that has the HYTE Y70 Touch. Each step
shows the command and how to check the result.

### 1. Get the code

```bash
git clone https://github.com/zaclanzon/hyte-y70-panel-linux.git ~/src/hyte-y70-panel
cd ~/src/hyte-y70-panel
```

### 2. Check the display and the driver

```bash
nvidia-smi                       # must list your GPU (skip without NVIDIA: the GPU card stays empty)
echo $XDG_SESSION_TYPE           # wayland or x11
xrandr --query | grep connected  # X11 only: the HYTE screen shows as 2560x720
```

If `nvidia-smi` fails, install your distro's NVIDIA driver first and reboot.

### 3. Run the installer

```bash
scripts/install.sh
```

The script asks for `sudo` once to install the system packages your distro
provides for GTK4, WebKitGTK, PyGObject and lm-sensors (it knows Debian,
Ubuntu, Fedora, Arch, openSUSE, Alpine and Void; elsewhere it prints the list
and you rerun with `--no-packages`). It then creates a virtualenv in
`~/.local/share/hyte-panel/venv`, installs the panel into it and runs
`hyte-panel setup`, which writes `~/.config/hyte-panel/config.toml` if
missing, adds **HYTE Panel** to the app grid, and enables the `hyte-panel`
systemd user service, or an XDG autostart entry on systems without systemd.
It does not start the panel yet.

Check: the setup output ends with a list of environment checks. GTK4 and
WebKitGTK should both say `ok`; without them the kiosk falls back to Chromium.

### 4. Rotate the HYTE screen to portrait

1. Open your desktop's display settings (GNOME: Settings > Displays; KDE:
   System Settings > Display and Monitor).
2. Select the 2560 x 720 monitor.
3. Set Orientation to "Portrait Right". If the image is upside down, use
   "Portrait Left".
4. Apply and keep the change.

Check: the HYTE screen shows the desktop upright. GNOME writes
`~/.config/monitors.xml`. See [hyte-y70-ubuntu.md](hyte-y70-ubuntu.md)
for the X11 command line.

### 5. Map the touch sensor to the HYTE screen

```bash
scripts/map-touch.sh              # auto-detect
scripts/map-touch.sh DP-3         # or give the connector name from step 2
```

Check: touch the HYTE screen. The pointer moves on the HYTE screen, not on the
main monitor. The script handles GNOME and X11 desktops; on KDE Wayland map the
touchscreen in System Settings > Input Devices > Touchscreen.

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

Without systemd, run `~/.local/share/hyte-panel/venv/bin/hyte-panel run`; the
autostart entry does the same at your next login.

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
