#!/usr/bin/env bash
# Install hyte-panel for the current user on any Linux distribution.
#
#   scripts/install.sh                 # system packages + venv + setup
#   scripts/install.sh --no-packages   # skip the package manager step
#
# System packages give Python access to GTK4, WebKitGTK and libadwaita; they
# cannot come from pip. Everything else is a virtualenv under
# ~/.local/share/hyte-panel and `hyte-panel setup`, which writes the config,
# the app grid entry and the systemd user unit (or an autostart entry when
# there is no systemd).
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/hyte-panel"
VENV="$DATA_DIR/venv"
DO_PACKAGES=1
[[ "${1:-}" == "--no-packages" ]] && DO_PACKAGES=0

# ---- 1. system packages ----------------------------------------------------
if [[ $DO_PACKAGES == 1 ]]; then
  . /etc/os-release 2>/dev/null || true
  like="${ID:-} ${ID_LIKE:-}"
  SUDO=""; [[ $EUID -ne 0 ]] && SUDO="sudo"
  echo "==> Installing system packages (${ID:-unknown distro})"
  case "$like" in
    *debian*|*ubuntu*)
      $SUDO apt-get update -qq
      $SUDO apt-get install -y --no-install-recommends python3 python3-venv python3-pip python3-gi python3-gi-cairo \
        gir1.2-gtk-4.0 gir1.2-webkit-6.0 gir1.2-adw-1 lm-sensors curl ;;
    *fedora*|*rhel*|*centos*|*nobara*)
      $SUDO dnf install -y python3 python3-pip python3-gobject gtk4 webkitgtk6.0 libadwaita lm_sensors curl ;;
    *arch*|*manjaro*|*endeavouros*|*cachyos*)
      $SUDO pacman -Sy --needed --noconfirm python python-gobject gtk4 webkitgtk-6.0 libadwaita lm_sensors curl ;;
    *suse*|*opensuse*)
      $SUDO zypper --non-interactive install python3 python3-gobject python3-gobject-Gdk \
        typelib-1_0-Gtk-4_0 typelib-1_0-WebKit-6_0 typelib-1_0-Adw-1 sensors curl ;;
    *alpine*)
      $SUDO apk add python3 py3-gobject3 gtk4.0 webkit2gtk-6.0 libadwaita lm-sensors curl ;;
    *void*)
      $SUDO xbps-install -Sy python3 python3-gobject gtk4 webkitgtk6 libadwaita lm_sensors curl ;;
    *)
      cat <<MSG
Unknown distribution. Install these with your package manager, then rerun with --no-packages:
  python3 (3.11+) with venv, PyGObject (python gi), GTK4 typelib, WebKitGTK 6.0 typelib,
  libadwaita typelib (optional), lm_sensors, curl
MSG
      exit 1 ;;
  esac
fi

# ---- 2. virtualenv ------------------------------------------------------------
echo "==> Creating virtualenv in $VENV"
mkdir -p "$DATA_DIR"
# --system-site-packages lets the venv see the distro's PyGObject (gi).
python3 -m venv --system-site-packages "$VENV"
"$VENV/bin/pip" install --quiet --upgrade pip
"$VENV/bin/pip" install --quiet "$REPO_DIR[nvidia]"

# ---- 3. config, app grid entry, startup -----------------------------------------
echo "==> Setting up"
"$VENV/bin/hyte-panel" setup

cat <<MSG

Next:
  1. Rotate the HYTE screen to portrait in your display settings (docs/hyte-y70-ubuntu.md).
  2. Map touch to the HYTE screen:  $REPO_DIR/scripts/map-touch.sh
  3. Open HYTE Panel from the app grid and press Start.
  4. Adjust widgets and weather location in Settings.
MSG
