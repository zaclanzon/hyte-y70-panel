# HYTE Y70 Touch on Ubuntu 26.04 with NVIDIA drivers

This page tells you how to connect the case screen and prepare it for the panel.

## The screen

| Model | Panel | Native mode | Portrait mode |
|---|---|---|---|
| Y70 Touch | 14.1 in IPS, 60 Hz | 2560 x 720 | 720 x 2560 |
| Y70 Touch Infinite | 14.1 in IPS, 60 Hz | 3840 x 1100 | 1100 x 3840 |

The screen is mounted vertically. The operating system sees it as a wide
landscape monitor. You must rotate it in the display settings. The touch sensor
is a USB HID device. It needs no driver.

## Connect the cables

1. Connect the DisplayPort cable from the case to a DisplayPort output on the
   NVIDIA card. Use the card, not the motherboard, unless the motherboard drives
   your main display.
2. Connect the USB cable from the case to a USB 2.0 header on the motherboard.
3. Start Ubuntu. Run `xrandr --query` (X11) or open Settings > Displays. The
   HYTE screen shows as a 2560 x 720 monitor.

## NVIDIA driver notes

- Install the driver with `sudo ubuntu-drivers install`. Ubuntu 26.04 ships the
  580+ series. The GNOME Wayland session works with it.
- The kernel option `nvidia-drm.modeset=1` is on by default. If the HYTE
  screen stays black, confirm it with `cat /sys/module/nvidia_drm/parameters/modeset`.
- Keep the HYTE screen as a secondary display. Do not make it primary.

## Rotate the screen

### GNOME (Wayland or X11)

1. Open Settings > Displays.
2. Select the HYTE monitor.
3. Set Orientation to "Portrait Right" or "Portrait Left". Test both. The
   correct choice depends on how the case is built.
4. Click Apply, then Keep Changes. GNOME writes `~/.config/monitors.xml`.

### X11 only, from a terminal

```bash
xrandr --output DP-3 --mode 2560x720 --rotate left --right-of DP-1
```

Replace `DP-3` and `DP-1` with your connector names from `xrandr --query`.

## Map the touch sensor to the screen

Without a mapping, touches on the HYTE screen move the pointer on your main
display. Run:

```bash
scripts/map-touch.sh          # auto-detect
scripts/map-touch.sh DP-3     # or name the connector
```

On GNOME the script writes the mapping to gsettings. It survives reboots. On
other X11 desktops it calls `xinput --map-to-output`. Add that command to your
session autostart.

## Keep the screen on

GNOME turns off all monitors after the idle timeout. Set Settings > Power >
Screen Blank to "Never" if you want the panel visible at all times. Use the
`dim_after_seconds` option in the panel config to dim only the panel instead.

## Troubleshooting

| Symptom | Check |
|---|---|
| Panel opens on the wrong monitor | Set `display.connector` in the config, for example `"DP-3"`. Run `hyte-panel -v window` to list monitors. |
| Window does not open from the service | Run `systemctl --user import-environment DISPLAY WAYLAND_DISPLAY XDG_SESSION_TYPE`, then restart the service. |
| GTK backend not available | Install `python3-gi gir1.2-gtk-4.0 gir1.2-webkit-6.0`, or set `display.backend = "chromium"`. |
| No GPU data | Run `nvidia-smi`. If it works, the panel works. Install the `nvidia` extra for NVML support. |
| No CPU temperature | Run `sudo sensors-detect` once, then reboot. |
| Touch moves the pointer on the main screen | Run `scripts/map-touch.sh`. |
| Journal floods with `vkAcquireNextImageKHR ... VK_ERROR_OUT_OF_DATE_KHR` and the `hyte-panel` process sits at 20% CPU | GTK's Vulkan renderer recreates its swapchain every frame on the rotated output. Add a drop-in with `Environment=GSK_RENDERER=gl` under `~/.config/systemd/user/hyte-panel.service.d/`, then `systemctl --user daemon-reload` and restart the service. |
