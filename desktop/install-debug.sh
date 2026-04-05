#!/bin/bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Install the DEBUG desktop shortcut for Airborne Submarine Squadron.
# Run once after pulling. Safe to re-run.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GAME_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DESKTOP_FILE="$SCRIPT_DIR/airborne-submarine-squadron-debug.desktop"
LAUNCHER="$GAME_DIR/launcher.sh"
DESKTOP_DIR="${XDG_DESKTOP_DIR:-$HOME/Desktop}"

if [ ! -f "$DESKTOP_FILE" ]; then
    echo "ERROR: Debug .desktop template not found at $DESKTOP_FILE" >&2
    exit 1
fi
if [ ! -x "$LAUNCHER" ]; then
    echo "ERROR: Launcher not executable at $LAUNCHER" >&2
    exit 1
fi
if [ ! -d "$DESKTOP_DIR" ]; then
    echo "ERROR: Desktop directory not found: $DESKTOP_DIR" >&2
    exit 1
fi

INSTALLED="/tmp/airborne-submarine-squadron-debug.desktop"
sed "s|LAUNCHER_PATH|$LAUNCHER|" "$DESKTOP_FILE" > "$INSTALLED"

cp "$INSTALLED" "$DESKTOP_DIR/airborne-submarine-squadron-debug.desktop"
chmod +x "$DESKTOP_DIR/airborne-submarine-squadron-debug.desktop"

# Trust the file in KDE Plasma so it runs without the warning dialog
if command -v gio >/dev/null 2>&1; then
    gio set "$DESKTOP_DIR/airborne-submarine-squadron-debug.desktop" metadata::trusted true 2>/dev/null || true
fi

# Also install to applications menu
APPS_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
mkdir -p "$APPS_DIR"
cp "$INSTALLED" "$APPS_DIR/airborne-submarine-squadron-debug.desktop"

rm -f "$INSTALLED"

echo "✓ Installed DEBUG launcher to $DESKTOP_DIR/airborne-submarine-squadron-debug.desktop"
echo "✓ Installed menu entry to $APPS_DIR/"
echo ""
echo "The debug shortcut disables browser caching and enables an on-screen"
echo "diagnostics overlay. Use it when you need fresh JS on every reload or"
echo "want to see camera/sub/pilot state live."
