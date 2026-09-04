#!/usr/bin/env bash
# Install hyte-panel on Ubuntu 24.04+ / 26.04 for the current user.
#
# The script:
#   1. installs system packages (GTK4, WebKitGTK, PyGObject, lm-sensors),
#   2. creates a virtualenv in ~/.local/share/hyte-panel/venv,
#   3. installs this package into the venv,
#   4. copies the example config to ~/.config/hyte-panel/config.toml (if missing),
#   5. adds a desktop entry (control window + settings) to the app grid,
#   6. installs and enables the systemd user service.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/hyte-panel"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/hyte-panel"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
VENV="$DATA_DIR/venv"

echo "==> Installing system packages (sudo)"
sudo apt-get update -qq
sudo apt-get install -y --no-install-recommends \
  python3 python3-venv python3-pip python3-gi python3-gi-cairo \
  gir1.2-gtk-4.0 gir1.2-webkit-6.0 gir1.2-adw-1 lm-sensors curl

echo "==> Creating virtualenv in $VENV"
mkdir -p "$DATA_DIR" "$CONFIG_DIR" "$UNIT_DIR"
# --system-site-packages lets the venv see the apt-installed PyGObject (gi).
python3 -m venv --system-site-packages "$VENV"
"$VENV/bin/pip" install --quiet --upgrade pip
"$VENV/bin/pip" install --quiet "$REPO_DIR[nvidia]"

if [ ! -f "$CONFIG_DIR/config.toml" ]; then
  echo "==> Writing default config to $CONFIG_DIR/config.toml"
  cp "$REPO_DIR/config.example.toml" "$CONFIG_DIR/config.toml"
else
  echo "==> Keeping existing config $CONFIG_DIR/config.toml"
fi

echo "==> Adding HYTE Panel to the app grid"
"$VENV/bin/hyte-panel" install-desktop

echo "==> Installing systemd user service"
sed "s|__VENV__|$VENV|g" "$REPO_DIR/systemd/hyte-panel.service" > "$UNIT_DIR/hyte-panel.service"
systemctl --user daemon-reload
systemctl --user enable hyte-panel.service

cat <<MSG

Done.

Next steps:
  1. Edit $CONFIG_DIR/config.toml (weather location, app buttons).
  2. Rotate the HYTE screen to portrait in Settings > Displays (see docs/hyte-y70-ubuntu.md).
  3. Map the touch input to the HYTE screen:  $REPO_DIR/scripts/map-touch.sh
  4. Start the panel: open "HYTE Panel" from the app grid and press Start,
     or run:                                   systemctl --user start hyte-panel
     Logs:                                     journalctl --user -u hyte-panel -f
  5. Optional: add examples/claude-code-hooks.json to ~/.claude/settings.json
     so Claude Code sessions show up on the panel.
MSG
