#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (c) 2026 Jonathan D.A. Jewell (hyperpolymath) <j.d.a.jewell@open.ac.uk>
#
# Launch Airborne Submarine Squadron as a Gossamer desktop game.
#
# Two modes:
#   1. Native Gossamer (Ephapax + libgossamer.so) — preferred
#   2. Fallback: Bun game server (run.js) + system webview via xdg-open
#
# Usage:
#   cd ~/Documents/hyperpolymath-repos/games\ \&\ trivia/airborne-submarine-squadron
#   bash gossamer/launch.sh
#   bash gossamer/launch.sh --fallback   # Skip Gossamer, use Bun + browser

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GAME_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
GOSSAMER_DIR="$SCRIPT_DIR"
GOSSAMER_PID_FILE="/tmp/airborne-gossamer.pid"
GOSSAMER_SERVER_PID_FILE="/tmp/airborne-gossamer-server.pid"

REPOS_ROOT="$(cd "$GAME_ROOT/.." && pwd)"
EPHAPAX="${REPOS_ROOT}/developer-ecosystem/nextgen-languages/ephapax/target/release/ephapax"
LIBGOSSAMER="${REPOS_ROOT}/gossamer/src/interface/ffi/zig-out/lib/libgossamer.so"

cleanup() {
    local pid_file
    for pid_file in "$GOSSAMER_PID_FILE" "$GOSSAMER_SERVER_PID_FILE"; do
        if [[ -f "$pid_file" ]]; then
            local pid
            pid="$(cat "$pid_file")"
            # SIGTERM first, then SIGKILL after 2 s if still alive.
            kill "$pid" 2>/dev/null || true
            local waited=0
            while kill -0 "$pid" 2>/dev/null && [[ $waited -lt 20 ]]; do
                sleep 0.1
                waited=$((waited + 1))
            done
            if kill -0 "$pid" 2>/dev/null; then
                kill -9 "$pid" 2>/dev/null || true
            fi
            rm -f "$pid_file"
        fi
    done
    # Ask any previous game server (recognised by /__ass/identity) to shut itself down gracefully.
    # We never kill processes that are not ours (the old `fuser -k` SIGKILLed whatever held the port).
    for port in 6880 $(seq 6881 6884); do
        if curl -fsS -m 1 "http://127.0.0.1:${port}/__ass/identity" 2>/dev/null | grep -q '"airborne-submarine-squadron"'; then
            curl -fsS -m 2 -X POST "http://127.0.0.1:${port}/shutdown" >/dev/null 2>&1 || true
        fi
    done
}

should_auto_open() {
    [[ "${AIRBORNE_NO_OPEN:-0}" != "1" ]] || return 1
    command -v xdg-open >/dev/null 2>&1 || return 1
    [[ -n "${DISPLAY:-}" || -n "${WAYLAND_DISPLAY:-}" ]]
}

# --- Parse args ---
USE_FALLBACK=false
if [[ "${1:-}" == "--fallback" ]]; then
    USE_FALLBACK=true
fi

# --- Native Gossamer launch ---
if [[ "$USE_FALLBACK" == false ]] && [[ -x "$EPHAPAX" ]] && [[ -f "$LIBGOSSAMER" ]]; then
    echo "=== Airborne Submarine Squadron (Gossamer) ==="
    echo "Window: resizable, 960x720 initial"
    echo "Compiler: $EPHAPAX"
    echo "FFI lib:  $LIBGOSSAMER"
    echo "Stop from another terminal with: ./launcher.sh --stop"
    echo ""

    # Export absolute page URL so main.eph resolves it correctly
    # regardless of the invoking shell's working directory.
    export GOSSAMER_PAGE_URL="file://${GOSSAMER_DIR}/index_gossamer.html"

    trap cleanup INT TERM EXIT
    "$EPHAPAX" run "$GOSSAMER_DIR/main.eph" \
        -L "$LIBGOSSAMER" \
        -v &
    APP_PID=$!
    echo "$APP_PID" > "$GOSSAMER_PID_FILE"
    wait "$APP_PID"
    STATUS=$?
    rm -f "$GOSSAMER_PID_FILE"
    trap - INT TERM EXIT
    exit "$STATUS"
fi

# --- Fallback: Bun game server (run.js) ---
echo "=== Airborne Submarine Squadron (Gossamer fallback) ==="
if [[ "$USE_FALLBACK" == false ]]; then
    echo "Note: Ephapax or libgossamer.so not found, using Bun fallback."
    [[ ! -x "$EPHAPAX" ]] && echo "  Missing: $EPHAPAX"
    [[ ! -f "$LIBGOSSAMER" ]] && echo "  Missing: $LIBGOSSAMER"
fi

# Find a free port (default 6880 — after 688 attack sub)
PORT=6880
while ss -tlnp 2>/dev/null | grep -q ":${PORT} " 2>/dev/null; do
    PORT=$((PORT + 1))
    if [[ $PORT -gt 6884 ]]; then
        echo "ERROR: No free port in range 6880-6884"
        exit 1
    fi
done

echo "Server: http://127.0.0.1:${PORT}/"
echo "Stop from another terminal with: ./launcher.sh --stop"
echo ""

# run.js serves the allowlisted game files from the repo root so that
#   /gossamer/index_gossamer.html, /gossamer/app_gossamer.js and /build/*.wasm
# are all reachable from ONE origin (required for the WASM fetch), with a same-origin guard on
# anything that mutates. (This replaces an embedded server whose `root + path` prefix check
# accepted  root/../../etc/passwd.)
if ! command -v bun >/dev/null 2>&1; then
    echo "ERROR: bun not found. Install it from https://bun.sh" >&2
    exit 1
fi
bun run "$GAME_ROOT/run.js" --no-open --port "${PORT}" --pid-file "$GOSSAMER_SERVER_PID_FILE" &
SERVER_PID=$!

# Wait for server to start
sleep 0.5
if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    rm -f "$GOSSAMER_SERVER_PID_FILE"
    echo "ERROR: Gossamer fallback server failed to start on port ${PORT}" >&2
    exit 1
fi

if should_auto_open; then
    xdg-open "http://127.0.0.1:${PORT}/gossamer/index_gossamer.html" 2>/dev/null || true
else
    echo "Auto-open skipped; visit http://127.0.0.1:${PORT}/ manually."
fi

echo "Press Ctrl+C to stop."
trap cleanup INT TERM EXIT
wait $SERVER_PID
