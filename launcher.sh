#!/bin/bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Airborne Submarine Squadron — Unified Launcher
#
# Usage:
#   ./launcher.sh              Launch in browser (default)
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
    # Default port 6860 — a nod to the 686 attack sub
    for port in 6860 $(seq 6861 6869); do
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
        echo "Server already running on port $port (PID $(cat "$PID_FILE"))"
        echo "$port"
        return 0
    fi

    local port
    port=$(find_free_port)

    if command -v deno >/dev/null 2>&1; then
        # Deno file server — no npm/node needed
        deno run --allow-net --allow-read --allow-sys - "$WEB_DIR" "$port" <<'DENO_SERVER' &
const dir = Deno.args[0] || ".";
const port = parseInt(Deno.args[1] || "8000");

Deno.serve({ port, hostname: "127.0.0.1" }, async (req) => {
    const url = new URL(req.url);
    let path = decodeURIComponent(url.pathname);
    if (path === "/") path = "/web/index_home.html";

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
    echo "Server started on port $port (PID $pid)"
    echo "$port"
}

stop_server() {
    local stopped=0
    if is_server_running; then
        local pid
        pid=$(cat "$PID_FILE")
        kill "$pid" 2>/dev/null || true
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
            kill "$pid" 2>/dev/null || true
            rm -f "$pf"
            echo "Stopped Gossamer runtime (PID $pid)"
            stopped=1
        fi
    done

    if [ "$stopped" -eq 0 ]; then
        echo "No managed Airborne Submarine Squadron runtime is running"
    fi
}

launch_browser() {
    local port
    port=$(start_server)
    sleep 0.5
    if should_auto_open; then
        echo "Opening http://127.0.0.1:$port/web/index_home.html"
        xdg-open "http://127.0.0.1:$port/web/index_home.html" 2>/dev/null &
    else
        echo "Server ready at http://127.0.0.1:$port/web/index_home.html"
        echo "Auto-open skipped (set up a GUI session or unset AIRBORNE_NO_OPEN)"
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
    exec bash "$SCRIPT_DIR/gossamer/launch.sh" "${@}"
}

do_install() {
    exec "$SCRIPT_DIR/desktop/install.sh"
}

do_uninstall() {
    exec "$SCRIPT_DIR/desktop/uninstall.sh"
}

# --- Main ---

case "${1:---browser}" in
    --browser|-b)   launch_browser ;;
    --gossamer|-g)  launch_gossamer ;;
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
        echo "  --browser, -b    Launch in browser (default)"
        echo "  --gossamer, -g   Launch as resizable Gossamer desktop game"
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
