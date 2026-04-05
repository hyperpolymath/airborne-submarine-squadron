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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="/tmp/airborne-server.pid"
PORT_FILE="/tmp/airborne-server.port"
GOSSAMER_PID_FILE="/tmp/airborne-gossamer.pid"
GOSSAMER_SERVER_PID_FILE="/tmp/airborne-gossamer-server.pid"
WASM_FILE="$SCRIPT_DIR/build/airborne-final-working.wasm"
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

    if command -v deno >/dev/null 2>&1; then
        # Deno file server — no npm/node needed.
        # Uses AbortController + signal handlers to guarantee port release on exit.
        deno run --allow-net --allow-read --allow-sys --allow-write - "$WEB_DIR" "$port" "$PID_FILE" <<'DENO_SERVER' &
const dir = Deno.args[0] || ".";
const port = parseInt(Deno.args[1] || "8000");
const pidFile = Deno.args[2] || "";

// Write own PID so the launcher can track us accurately
if (pidFile) {
    try { Deno.writeTextFileSync(pidFile, String(Deno.pid)); } catch { /* best-effort */ }
}

const ac = new AbortController();

function shutdown() {
    ac.abort();
    if (pidFile) { try { Deno.removeSync(pidFile); } catch { /* already gone */ } }
    Deno.exit(0);
}

try { Deno.addSignalListener("SIGINT", shutdown); } catch { /* Windows */ }
try { Deno.addSignalListener("SIGTERM", shutdown); } catch { /* Windows */ }
try { Deno.addSignalListener("SIGHUP", shutdown); } catch { /* not always available */ }

const server = Deno.serve({ port, hostname: "127.0.0.1", signal: ac.signal, onListen() {} }, async (req) => {
    const url = new URL(req.url);
    let path = decodeURIComponent(url.pathname);
    if (path === "/") path = "/index.html";

    const filePath = dir + path;
    try {
        const file = await Deno.open(filePath, { read: true });
        const ext = filePath.split(".").pop() || "";
        const types = {
            html: "text/html", css: "text/css", js: "application/javascript",
            wasm: "application/wasm", json: "application/json",
            svg: "image/svg+xml", png: "image/png",
        };
        return new Response(file.readable, {
            headers: { "content-type": types[ext] || "application/octet-stream" },
        });
    } catch {
        return new Response("Not Found", { status: 404 });
    }
});

await server.finished;
DENO_SERVER
    else
        # Fallback: Python (banned but functional)
        echo "Warning: Deno not found, falling back to Python" >&2
        cd "$WEB_DIR" && python3 -m http.server "$port" --bind 127.0.0.1 &
    fi

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
    # Aggressively release all game ports (6880–6884).
    # Uses fuser to SIGKILL any process still holding the port.
    for port in $(seq 6880 6884); do
        if ss -tlnH "sport = :$port" 2>/dev/null | grep -q .; then
            fuser -k "${port}/tcp" 2>/dev/null || true
        fi
    done
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

    # Unconditional port release — catches orphaned Deno processes whose
    # PID files were already cleaned up.
    _release_game_ports

    if [ "$stopped" -eq 0 ]; then
        echo "No managed Airborne Submarine Squadron runtime is running"
    fi
}

launch_browser() {
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
    # Use run.js as the canonical launcher — it handles port management,
    # opens the Gossamer HTML entry point, and cleans up on exit.
    if command -v deno >/dev/null 2>&1; then
        exec deno run --allow-all "$SCRIPT_DIR/run.js" --no-git
    else
        # Fallback to gossamer/launch.sh if Deno isn't available
        exec bash "$SCRIPT_DIR/gossamer/launch.sh" "${@}"
    fi
}

launch_debug() {
    # Same as launch_gossamer but with --debug: no cache, ?debug=1 in URL,
    # on-screen diagnostics turned on in the game JS.
    if command -v deno >/dev/null 2>&1; then
        exec deno run --allow-all "$SCRIPT_DIR/run.js" --no-git --debug
    else
        echo "Error: debug mode requires Deno" >&2
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
