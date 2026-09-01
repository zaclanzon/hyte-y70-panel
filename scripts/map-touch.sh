#!/usr/bin/env bash
# Map the HYTE Y70 Touch touchscreen to the HYTE display output.
#
# On GNOME (Wayland or X11) the mapping is stored in gsettings and survives
# reboots. On other X11 desktops the script uses xinput --map-to-output for
# the current session only.
#
# Usage:
#   scripts/map-touch.sh                # auto-detect touchscreen and HYTE output
#   scripts/map-touch.sh DP-3           # name the output explicitly
set -euo pipefail

OUTPUT="${1:-}"
PANEL_W="${HYTE_WIDTH:-720}"
PANEL_H="${HYTE_HEIGHT:-2560}"

# ---- find the touchscreen -----------------------------------------------------
find_touch_device() {
  # Prints: "<vendor_hex>:<product_hex>|<name>" for the first touchscreen.
  local vid="" pid="" name=""
  while IFS= read -r line; do
    case "$line" in
      I:*) vid=$(sed -n 's/.*Vendor=\([0-9a-f]*\).*/\1/p' <<<"$line"); pid=$(sed -n 's/.*Product=\([0-9a-f]*\).*/\1/p' <<<"$line") ;;
      N:*) name=$(sed -n 's/^N: Name="\(.*\)"/\1/p' <<<"$line") ;;
      "")  vid=""; pid=""; name="" ;;
      B:*)
        # ABS_MT_POSITION_X (0x35) present and the device is not a mouse -> touchscreen.
        if [[ "$line" == B:\ ABS=* ]]; then
          local abs; abs=$(sed 's/^B: ABS=//' <<<"$line")
          if [[ "$abs" == *"260800000000000"* || "$abs" == *"2608000 0"* || "$abs" == *"6600000000000"* || "$abs" == *"2f3800000000000"* ]]; then
            echo "$vid:$pid|$name"; return 0
          fi
        fi ;;
    esac
  done < /proc/bus/input/devices
  return 1
}

TOUCH=""
if command -v libinput >/dev/null 2>&1 && [ -r /dev/input ] ; then
  TOUCH=$(sudo -n libinput list-devices 2>/dev/null | awk -F': *' '/^Device:/{n=$2} /Capabilities:.*touch/{print n; exit}' || true)
fi
DEV=$(find_touch_device || true)
VIDPID=${DEV%%|*}
NAME=${DEV#*|}
[ -n "$TOUCH" ] || TOUCH="$NAME"
if [ -z "$TOUCH" ]; then
  echo "No touchscreen found in /proc/bus/input/devices. Is the HYTE USB cable connected?" >&2
  exit 1
fi
echo "Touchscreen: $TOUCH ($VIDPID)"

# ---- find the output ------------------------------------------------------------
if [ -z "$OUTPUT" ] && command -v xrandr >/dev/null 2>&1 && [ -n "${DISPLAY:-}" ]; then
  OUTPUT=$(xrandr --query 2>/dev/null | awk -v w="$PANEL_W" -v h="$PANEL_H" '
    / connected/ { if (match($0, /[0-9]+x[0-9]+\+/)) { split(substr($0, RSTART, RLENGTH-1), s, "x"); if ((s[1]==w && s[2]==h) || (s[1]==h && s[2]==w)) { print $1; exit } } }')
fi

SESSION="${XDG_SESSION_TYPE:-}"
DESKTOP="${XDG_CURRENT_DESKTOP:-}"

if [[ "$DESKTOP" == *GNOME* ]] && command -v gsettings >/dev/null 2>&1; then
  # GNOME stores the mapping as [vendor, product, serial] of the monitor (EDID).
  # Read those from the monitors.xml that Settings > Displays writes.
  MON_XML="${XDG_CONFIG_HOME:-$HOME/.config}/monitors.xml"
  if [ ! -f "$MON_XML" ]; then
    echo "Open Settings > Displays, rotate the HYTE screen to portrait and click Apply first." >&2
    echo "That writes $MON_XML, which this script needs." >&2
    exit 1
  fi
  # Pick the monitor block whose connector matches OUTPUT, else the one with a portrait 'transform'.
  read -r VENDOR PRODUCT SERIAL < <(python3 - "$MON_XML" "$OUTPUT" <<'PY'
import sys, xml.etree.ElementTree as ET
tree = ET.parse(sys.argv[1]); want = sys.argv[2]
best = None
for cfg in tree.iter("configuration"):
    for lm in cfg.iter("logicalmonitor"):
        transform = (lm.findtext("transform/rotation") or "normal").strip()
        for mon in lm.iter("monitor"):
            spec = mon.find("monitorspec")
            conn = spec.findtext("connector") or ""
            row = (spec.findtext("vendor") or "", spec.findtext("product") or "", spec.findtext("serial") or "", conn)
            if want and conn == want:
                best = row; break
            if not want and transform in ("left", "right") and best is None:
                best = row
    if best: break
if not best:
    sys.exit("No matching monitor in monitors.xml. Pass the connector name, for example: map-touch.sh DP-3")
print(*best[:3])
PY
)
  SCHEMA_PATH="/org/gnome/desktop/peripherals/touchscreens/$VIDPID/"
  echo "Mapping to monitor vendor=$VENDOR product=$PRODUCT serial=$SERIAL"
  gsettings set "org.gnome.desktop.peripherals.touchscreen:$SCHEMA_PATH" output "['$VENDOR', '$PRODUCT', '$SERIAL']"
  echo "Done. GNOME applies the mapping immediately."
elif [ "$SESSION" = "x11" ] && command -v xinput >/dev/null 2>&1; then
  [ -n "$OUTPUT" ] || { echo "Pass the output name: map-touch.sh DP-3" >&2; exit 1; }
  xinput --map-to-output "$TOUCH" "$OUTPUT"
  echo "Mapped '$TOUCH' to $OUTPUT for this X session. Add this command to your autostart to keep it."
else
  echo "Desktop '$DESKTOP' on '$SESSION' is not handled. Map the touchscreen in your compositor settings." >&2
  exit 1
fi
