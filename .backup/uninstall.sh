#!/bin/bash
# SPDX-License-Identifier: PMPL-1.0-or-later
# Remove Airborne Submarine Squadron desktop integration.

set -euo pipefail

# Remove icon
xdg-icon-resource uninstall --size 256 airborne-submarine-squadron 2>/dev/null || true
echo "Removed icon"

# Remove menu entry
xdg-desktop-menu uninstall airborne-submarine-squadron.desktop 2>/dev/null || true
echo "Removed menu entry"

# Remove desktop shortcut
DESKTOP_DIR="${XDG_DESKTOP_DIR:-$HOME/Desktop}"
rm -f "$DESKTOP_DIR/airborne-submarine-squadron.desktop" 2>/dev/null || true
echo "Removed desktop shortcut"

echo "Done. Desktop integration removed."
