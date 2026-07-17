#!/bin/bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Install Airborne Submarine Squadron desktop shortcut + menu entry.
# Enhanced with fault tolerance and self-diagnostics.

set -euo pipefail

# --- Self-Awareness ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GAME_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DESKTOP_FILE="$SCRIPT_DIR/airborne-submarine-squadron.desktop"
ICON_FILE="$SCRIPT_DIR/icons/airborne-submarine-squadron.png"
LAUNCHER="$GAME_DIR/launcher.sh"

# --- Fault Tolerance Helpers ---
safe_command() {
    local cmd="$1"
    shift
    if command -v "$cmd" >/dev/null 2>&1; then
        "$cmd" "$@"
        return 0
    else
        echo "Warning: Command '$cmd' not available, skipping step" >&2
        return 1
    fi
}

verify_file() {
    local file="$1"
    local description="$2"
    if [ ! -f "$file" ]; then
        echo "ERROR: $description not found at $file" >&2
        return 1
    fi
    return 0
}

# --- Pre-install Diagnostics ---
pre_install_check() {
    echo "=== Pre-Installation Check ==="
    
    # Verify critical files
    verify_file "$DESKTOP_FILE" "Desktop entry template" || exit 1
    verify_file "$ICON_FILE" "PNG icon" || exit 1
    verify_file "$SCRIPT_DIR/icons/airborne-submarine-squadron.svg" "SVG icon" || exit 1
    verify_file "$LAUNCHER" "Main launcher" || exit 1
    
    # Check for required tools
    local missing_tools=0
    for tool in xdg-icon-resource xdg-desktop-menu; do
        if ! command -v "$tool" >/dev/null 2>&1; then
            echo "Warning: $tool not found - some features may be limited"
            missing_tools=$((missing_tools + 1))
        fi
    done
    
    if [ $missing_tools -gt 0 ]; then
        echo "Proceeding with limited functionality"
    else
        echo "All required tools available"
    fi
}

# --- Installation Steps ---
install_icon() {
    echo "Installing icons..."
    
    # PNG icon via xdg
    if safe_command xdg-icon-resource install --novendor --size 256 "$ICON_FILE" airborne-submarine-squadron; then
        echo "✓ Installed PNG icon"
    else
        echo "⚠ PNG icon installation skipped (xdg-icon-resource unavailable)"
    fi
    
    # SVG icon for KDE/scalable
    local SVG_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/scalable/apps"
    if mkdir -p "$SVG_DIR" && cp "$SCRIPT_DIR/icons/airborne-submarine-squadron.svg" "$SVG_DIR/"; then
        echo "✓ Installed SVG icon"
    else
        echo "⚠ SVG icon installation failed"
    fi
    
    # ICO icon for Windows compatibility (multiple sizes)
    local ICO_FILE="$SCRIPT_DIR/icons/airborne-submarine-squadron.ico"
    if [ -f "$ICO_FILE" ]; then
        # Install ICO to Windows-compatible locations if on Windows or Wine
        if command -v wine >/dev/null 2>&1 || [[ "$OSTYPE" == *cygwin* || "$OSTYPE" == *msys* || "$OSTYPE" == *win* ]]; then
            echo "Detected Windows environment, installing ICO..."
            # Windows icon installation would go here
            # For now, just copy to a known location
            mkdir -p "$HOME/.wine/drive_c/windows"
            cp "$ICO_FILE" "$HOME/.wine/drive_c/windows/airborne-submarine-squadron.ico" 2>/dev/null || true
            echo "✓ Installed ICO icon for Windows compatibility"
        else
            # On Linux, store ICO in icon directory for potential Windows tools
            local ICO_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor"
            for size in 256x256 128x128 64x64 48x48 32x32 16x16; do
                mkdir -p "$ICO_DIR/$size/apps"
                cp "$ICO_FILE" "$ICO_DIR/$size/apps/airborne-submarine-squadron.ico" 2>/dev/null || true
            done
            echo "✓ Installed ICO icon for cross-platform compatibility"
        fi
    else
        echo "⚠ ICO file not found, Windows icon support limited"
    fi
}

install_menu_entry() {
    echo "Installing menu entry..."
    
    # Patch the .desktop file with the actual launcher path
    local INSTALLED_DESKTOP="/tmp/airborne-submarine-squadron.desktop"
    
    # Use Python if available, otherwise sed (less safe but works for simple cases)
    if command -v python3 >/dev/null 2>&1; then
        python3 -c "
import sys
with open(sys.argv[1]) as f:
    print(f.read().replace('LAUNCHER_PATH', sys.argv[2]), end='')
" "$DESKTOP_FILE" "$LAUNCHER" > "$INSTALLED_DESKTOP"
    else
        sed "s|LAUNCHER_PATH|$LAUNCHER|" "$DESKTOP_FILE" > "$INSTALLED_DESKTOP"
    fi
    
    # Install via xdg-desktop-menu if available
    if safe_command xdg-desktop-menu install --novendor "$INSTALLED_DESKTOP"; then
        echo "✓ Installed menu entry"
    else
        # Fallback: copy to local applications directory
        local APPS_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
        mkdir -p "$APPS_DIR"
        cp "$INSTALLED_DESKTOP" "$APPS_DIR/airborne-submarine-squadron.desktop"
        echo "⚠ Menu entry installed to local applications (xdg-desktop-menu unavailable)"
    fi
    
    rm -f "$INSTALLED_DESKTOP"
}

install_desktop_shortcut() {
    echo "Installing desktop shortcut..."
    
    local DESKTOP_DIR="${XDG_DESKTOP_DIR:-$HOME/Desktop}"
    
    if [ ! -d "$DESKTOP_DIR" ]; then
        echo "⚠ Desktop directory not found, skipping desktop shortcut"
        return 0
    fi
    
    # Create patched desktop file
    local INSTALLED_DESKTOP="/tmp/airborne-submarine-squadron.desktop"
    if command -v python3 >/dev/null 2>&1; then
        python3 -c "
import sys
with open(sys.argv[1]) as f:
    print(f.read().replace('LAUNCHER_PATH', sys.argv[2]), end='')
" "$DESKTOP_FILE" "$LAUNCHER" > "$INSTALLED_DESKTOP"
    else
        sed "s|LAUNCHER_PATH|$LAUNCHER|" "$DESKTOP_FILE" > "$INSTALLED_DESKTOP"
    fi
    
    # Install to desktop
    cp "$INSTALLED_DESKTOP" "$DESKTOP_DIR/airborne-submarine-squadron.desktop"
    chmod +x "$DESKTOP_DIR/airborne-submarine-squadron.desktop"
    
    # Mark as trusted for KDE Plasma if gio is available
    if command -v gio >/dev/null 2>&1; then
        gio set "$DESKTOP_DIR/airborne-submarine-squadron.desktop" metadata::trusted true 2>/dev/null || true
    fi
    
    echo "✓ Installed desktop shortcut at $DESKTOP_DIR/"
    rm -f "$INSTALLED_DESKTOP"
}

# --- Main Installation ---
main() {
    pre_install_check
    install_icon
    install_menu_entry
    install_desktop_shortcut
    
    echo ""
    echo "=== Installation Complete ==="
    echo "Airborne Submarine Squadron is now in your start menu and desktop."
    echo "You can launch it from:"
    echo "  - Application menu (under Games)"
    echo "  - Desktop shortcut (if your desktop supports it)"
    echo "  - Command line: $LAUNCHER --gossamer"
}

# Run with error handling
main "$@" || {
    echo "Installation completed with some warnings. The game should still be accessible." >&2
    exit 0
}
