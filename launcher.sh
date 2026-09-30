#!/bin/bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Airborne Submarine Squadron — Unified Launcher
#
# Usage:
#   ./launcher.sh              Launch in Gossamer/browser mode (default)
#   ./launcher.sh --gossamer   Launch in Gossamer/browser mode explicitly
#   ./launcher.sh --browser    Launch in browser explicitly
#   ./launcher.sh --cli        Run WASM in terminal via wasmtime
#   ./launcher.sh --tray       Start system tray icon
#   ./launcher.sh --gossamer   Launch as resizable Gossamer desktop game
#   ./launcher.sh --stop       Stop running server
#   ./launcher.sh --install    Install desktop shortcut + menu entry
#   ./launcher.sh --uninstall  Remove desktop integration

set -euo pipefail

# Desktop launchers (Terminal=true .desktop entries) start with a stripped
# PATH that doesn't include user shell rc additions. Restore the toolchain
# locations so `bun`, `cargo`, etc. resolve regardless of how we're invoked.
export PATH="$HOME/.bun/bin:$HOME/.opsm/shims:$HOME/.cargo/bin:$HOME/.local/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# CWE-377: a predictable /tmp pid path lets another local user choose which PID
# `--stop` kills. Re-findable PID/port state lives under XDG_RUNTIME_DIR (falling
# back to XDG_STATE_HOME, then ~/.local/state); the durable log lives under
# XDG_STATE_HOME. gossamer/launch.sh computes the byte-identical
# _XDG_RUNTIME_BASE for its own GOSSAMER_* files so both scripts agree on where
# a running instance's state lives.
_XDG_RUNTIME_BASE="${XDG_RUNTIME_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}}/launch-scaffolder/airborne-submarine-squadron"
_XDG_STATE_BASE="${XDG_STATE_HOME:-$HOME/.local/state}/launch-scaffolder/airborne-submarine-squadron"
mkdir -p "$_XDG_RUNTIME_BASE" "$_XDG_STATE_BASE"
chmod 0700 "$_XDG_RUNTIME_BASE" "$_XDG_STATE_BASE"
PID_FILE="$_XDG_RUNTIME_BASE/server.pid"
PORT_FILE="$_XDG_RUNTIME_BASE/server.port"
GOSSAMER_PID_FILE="$_XDG_RUNTIME_BASE/gossamer.pid"
GOSSAMER_SERVER_PID_FILE="$_XDG_RUNTIME_BASE/gossamer-server.pid"
LOG_FILE="$_XDG_STATE_BASE/server.log"
WASM_FILE="$SCRIPT_DIR/build/airborne-submarine-squadron.wasm"
WEB_DIR="$SCRIPT_DIR"
TRAY_BIN="$SCRIPT_DIR/tray/target/release/airborne-tray"

# --- Helpers ---

find_free_port() {
    local port
    # Default port 6880 — after 688 attack sub
    for port in 6880 $(seq 6881 6884); do
        if ! ss -tlnH "sport = :$port" 2>/dev/null | grep -q .; then
            echo "$port"
            return 0
        fi
    done
    echo "8000"
}

is_server_running() {
    [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

should_auto_open() {
    [ "${AIRBORNE_NO_OPEN:-0}" != "1" ] || return 1
    command -v xdg-open >/dev/null 2>&1 || return 1
    [ -n "${DISPLAY:-}" ] || [ -n "${WAYLAND_DISPLAY:-}" ]
}

warmup_affinescript_compiler() {
    [ "${AFFINESCRIPT_AUTO_UPDATE_ON_STARTUP:-0}" = "1" ] || return 0
    if [ -x "$SCRIPT_DIR/scripts/ensure_affinescript.sh" ]; then
        "$SCRIPT_DIR/scripts/ensure_affinescript.sh" --warmup >/dev/null 2>&1 || true
    fi
}

start_server() {
    if is_server_running; then
        local port
        port=$(cat "$PORT_FILE" 2>/dev/null || echo "8000")
        echo "Server already running on port $port (PID $(cat "$PID_FILE"))" >&2
        echo "$port"
        return 0
    fi

    # Clean up stale PID file (process died without cleanup) and release orphaned ports
    if [ -f "$PID_FILE" ]; then
        rm -f "$PID_FILE" "$PORT_FILE"
    fi
    _release_game_ports

    local port
    port=$(find_free_port)

    if ! command -v bun >/dev/null 2>&1; then
        echo "Error: bun not found. Install it from https://bun.sh (Bun is the estate runtime;" >&2
        echo "       the old Deno and Python fallbacks were retired: LANGUAGE-POLICY, 2026-09-22)." >&2
        return 1
    fi
    # The real game server (server/ass-server.js via run.js): allowlisted static files, same-origin
    # guard, bounded uploads. It writes its own PID to $PID_FILE and releases the port on exit.
    bun run "$SCRIPT_DIR/run.js" --no-open --port "$port" --pid-file "$PID_FILE" \
        >"$LOG_FILE" 2>&1 &

    local pid=$!
    sleep 0.3
    if ! kill -0 "$pid" 2>/dev/null; then
        rm -f "$PID_FILE" "$PORT_FILE"
        echo "Error: web server failed to start on port $port" >&2
        return 1
    fi
    echo "$pid" > "$PID_FILE"
    echo "$port" > "$PORT_FILE"
    echo "Server started on port $port (PID $pid)" >&2
    echo "$port"
}

_kill_pid_aggressive() {
    local pid="$1" label="$2"
    kill "$pid" 2>/dev/null || return 0
    # Wait up to 2 s for graceful exit, then SIGKILL.
    local waited=0
    while kill -0 "$pid" 2>/dev/null && [ "$waited" -lt 20 ]; do
        sleep 0.1
        waited=$((waited + 1))
    done
    if kill -0 "$pid" 2>/dev/null; then
        kill -9 "$pid" 2>/dev/null || true
        echo "  (force-killed $label PID $pid)"
    fi
}

_release_game_ports() {
    # Ask any PREVIOUS game server (recognised by /__ass/identity) to shut itself down gracefully.
    # We never kill processes that are not ours: the old `fuser -k` SIGKILLed whatever held 6880-6884.
    local port
    for port in $(seq 6880 6884); do
        if curl -fsS -m 1 "http://127.0.0.1:${port}/__ass/identity" 2>/dev/null | grep -q '"airborne-submarine-squadron"'; then
            curl -fsS -m 2 -X POST "http://127.0.0.1:${port}/shutdown" >/dev/null 2>&1 || true
        fi
    done
    sleep 0.3
}

stop_server() {
    local stopped=0
    if is_server_running; then
        local pid
        pid=$(cat "$PID_FILE")
        _kill_pid_aggressive "$pid" "web server"
        rm -f "$PID_FILE" "$PORT_FILE"
        echo "Server stopped (PID $pid)"
        stopped=1
    else
        rm -f "$PID_FILE" "$PORT_FILE"
    fi

    for pf in "$GOSSAMER_PID_FILE" "$GOSSAMER_SERVER_PID_FILE"; do
        if [ -f "$pf" ]; then
            local pid
            pid=$(cat "$pf")
            _kill_pid_aggressive "$pid" "Gossamer runtime"
            rm -f "$pf"
            echo "Stopped Gossamer runtime (PID $pid)"
            stopped=1
        fi
    done

    # Graceful release of any game server whose PID file was already cleaned up.
    _release_game_ports

    if [ "$stopped" -eq 0 ]; then
        echo "No managed Airborne Submarine Squadron runtime is running"
    fi
}

launch_browser() {
    warmup_affinescript_compiler
    local port
    port=$(start_server)

    # Ensure the server is cleaned up when the launcher exits (terminal close, Ctrl+C, etc.)
    trap 'stop_server' INT TERM HUP EXIT

    sleep 0.5
    if should_auto_open; then
        echo "Opening http://127.0.0.1:$port/gossamer/index_gossamer.html"
        xdg-open "http://127.0.0.1:$port/gossamer/index_gossamer.html" 2>/dev/null &
    else
        echo "Server ready at http://127.0.0.1:$port/gossamer/index_gossamer.html"
        echo "Auto-open skipped (set up a GUI session or unset AIRBORNE_NO_OPEN)"
    fi

    # Wait for the server process so we stay alive (and the trap can fire)
    if [ -f "$PID_FILE" ]; then
        wait "$(cat "$PID_FILE")" 2>/dev/null || true
    fi
}

launch_cli() {
    if ! command -v wasmtime >/dev/null 2>&1; then
        echo "Error: wasmtime not found. Install via: asdf install wasmtime latest" >&2
        exit 1
    fi
    if [ ! -f "$WASM_FILE" ]; then
        echo "Error: WASM file not found at $WASM_FILE" >&2
        exit 1
    fi
    echo "=== Airborne Submarine Squadron (CLI) ==="
    wasmtime run "$WASM_FILE"
}

launch_tray() {
    if [ ! -x "$TRAY_BIN" ]; then
        echo "Tray binary not found. Building..." >&2
        cd "$SCRIPT_DIR/tray" && cargo build --release 2>&1
        if [ ! -x "$TRAY_BIN" ]; then
            echo "Error: Failed to build tray binary" >&2
            exit 1
        fi
    fi
    exec "$TRAY_BIN"
}

launch_gossamer() {
    warmup_affinescript_compiler
    # Use run.js as the canonical launcher — it handles port management,
    # opens the Gossamer HTML entry point, and cleans up on exit.
    if command -v bun >/dev/null 2>&1; then
        exec bun run "$SCRIPT_DIR/run.js"
    else
        # Fallback to gossamer/launch.sh (native Gossamer only; needs bun for the web fallback)
        exec bash "$SCRIPT_DIR/gossamer/launch.sh" "${@}"
    fi
}

launch_debug() {
    warmup_affinescript_compiler
    # Same as launch_gossamer but with --debug: no cache, ?debug=1 in URL,
    # on-screen diagnostics turned on in the game JS.
    if command -v bun >/dev/null 2>&1; then
        exec bun run "$SCRIPT_DIR/run.js" --debug
    else
        echo "Error: debug mode requires Bun (https://bun.sh)" >&2
        exit 1
    fi
}

do_install() {
    exec "$SCRIPT_DIR/desktop/install.sh"
}

do_uninstall() {
    exec "$SCRIPT_DIR/desktop/uninstall.sh"
}

# --- Main ---

case "${1:---gossamer}" in
    --gossamer|-g|--auto) launch_gossamer ;;
    --debug|-d)     launch_debug ;;
    --browser|-b)   launch_browser ;;
    --cli|-c)       launch_cli ;;
    --tray|-t)      launch_tray ;;
    --stop|-s)      stop_server ;;
    --install)      do_install ;;
    --uninstall)    do_uninstall ;;
    --help|-h)
        echo "Airborne Submarine Squadron Launcher"
        echo ""
        echo "Usage: $(basename "$0") [MODE]"
        echo ""
        echo "Modes:"
        echo "  --gossamer, -g   Launch as resizable Gossamer desktop game (default)"
        echo "  --debug, -d      Launch in DEBUG mode (no cache, on-screen diagnostics)"
        echo "  --browser, -b    Launch in browser"
        echo "  --cli, -c        Run WASM in terminal via wasmtime"
        echo "  --tray, -t       Start system tray icon"
        echo "  --stop, -s       Stop running server"
        echo "  --install        Install desktop shortcut + menu entry"
        echo "  --uninstall      Remove desktop integration"
        ;;
    *)
        echo "Unknown option: $1 (try --help)" >&2
        exit 1
        ;;
esac
