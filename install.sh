#!/bin/bash
# SPDX-License-Identifier: PMPL-1.0-or-later
# Install Airborne Submarine Squadron desktop shortcut + menu entry.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GAME_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DESKTOP_FILE="$SCRIPT_DIR/airborne-submarine-squadron.desktop"
ICON_FILE="$SCRIPT_DIR/icons/airborne-submarine-squadron.png"
LAUNCHER="$GAME_DIR/launcher.sh"

# Patch the .desktop file with the actual launcher path.
# The path may contain & (e.g. "games & trivia") so we use Python for safe replacement.
INSTALLED_DESKTOP="/tmp/airborne-submarine-squadron.desktop"
python3 -c "
import sys
with open(sys.argv[1]) as f:
    print(f.read().replace('LAUNCHER_PATH', sys.argv[2]), end='')
" "$DESKTOP_FILE" "$LAUNCHER" > "$INSTALLED_DESKTOP"

# Install PNG icon via xdg
xdg-icon-resource install --novendor --size 256 "$ICON_FILE" airborne-submarine-squadron
echo "Installed PNG icon"

# Also install SVG for KDE/scalable (KDE supports SVG natively)
SVG_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/scalable/apps"
mkdir -p "$SVG_DIR"
cp "$SCRIPT_DIR/icons/airborne-submarine-squadron.svg" "$SVG_DIR/"
echo "Installed SVG icon"

# Install .desktop to applications menu
xdg-desktop-menu install --novendor "$INSTALLED_DESKTOP"
echo "Installed menu entry"

# Copy to Desktop (KDE Plasma)
DESKTOP_DIR="${XDG_DESKTOP_DIR:-$HOME/Desktop}"
if [ -d "$DESKTOP_DIR" ]; then
    cp "$INSTALLED_DESKTOP" "$DESKTOP_DIR/airborne-submarine-squadron.desktop"
    chmod +x "$DESKTOP_DIR/airborne-submarine-squadron.desktop"
    # Mark as trusted for KDE Plasma (avoids "untrusted" warning)
    gio set "$DESKTOP_DIR/airborne-submarine-squadron.desktop" metadata::trusted true 2>/dev/null || true
    echo "Installed desktop shortcut at $DESKTOP_DIR/"
fi

rm -f "$INSTALLED_DESKTOP"
echo "Done. Airborne Submarine Squadron is now in your start menu and desktop."
