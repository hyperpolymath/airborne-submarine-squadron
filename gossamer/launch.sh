#!/usr/bin/env bash
# SPDX-License-Identifier: PMPL-1.0-or-later
# Copyright (c) 2026 Jonathan D.A. Jewell (hyperpolymath) <j.d.a.jewell@open.ac.uk>
#
# Launch Airborne Submarine Squadron as a Gossamer desktop game.
#
# Two modes:
#   1. Native Gossamer (Ephapax + libgossamer.so) — preferred
#   2. Fallback: Deno file server + system webview via xdg-open
#
# Usage:
#   cd ~/Documents/hyperpolymath-repos/games\ \&\ trivia/airborne-submarine-squadron
#   bash gossamer/launch.sh
#   bash gossamer/launch.sh --fallback   # Skip Gossamer, use Deno + browser

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GAME_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
GOSSAMER_DIR="$SCRIPT_DIR"
GOSSAMER_PID_FILE="/tmp/airborne-gossamer.pid"
GOSSAMER_SERVER_PID_FILE="/tmp/airborne-gossamer-server.pid"

REPOS_ROOT="$(cd "$GAME_ROOT/../.." && pwd)"
EPHAPAX="${REPOS_ROOT}/nextgen-languages/ephapax/target/release/ephapax"
LIBGOSSAMER="${REPOS_ROOT}/gossamer/src/interface/ffi/zig-out/lib/libgossamer.so"

cleanup() {
    local pid_file
    for pid_file in "$GOSSAMER_PID_FILE" "$GOSSAMER_SERVER_PID_FILE"; do
        if [[ -f "$pid_file" ]]; then
            local pid
            pid="$(cat "$pid_file")"
            kill "$pid" 2>/dev/null || true
            rm -f "$pid_file"
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

# --- Fallback: Deno file server ---
echo "=== Airborne Submarine Squadron (Gossamer fallback) ==="
if [[ "$USE_FALLBACK" == false ]]; then
    echo "Note: Ephapax or libgossamer.so not found, using Deno fallback."
    [[ ! -x "$EPHAPAX" ]] && echo "  Missing: $EPHAPAX"
    [[ ! -f "$LIBGOSSAMER" ]] && echo "  Missing: $LIBGOSSAMER"
fi

# Find a free port (default 6870 to avoid collision with main game on 6860)
PORT=6870
while ss -tlnp 2>/dev/null | grep -q ":${PORT} " 2>/dev/null; do
    PORT=$((PORT + 1))
    if [[ $PORT -gt 6899 ]]; then
        echo "ERROR: No free port in range 6870-6899"
        exit 1
    fi
done

echo "Server: http://127.0.0.1:${PORT}/"
echo "Stop from another terminal with: ./launcher.sh --stop"
echo ""

# Serve the gossamer directory via Deno (piped to stdin for Deno 2.x compat)
deno run --allow-net --allow-read - <<DENO_SERVER &
const dir = "${GOSSAMER_DIR}";
Deno.serve({ port: ${PORT}, hostname: "127.0.0.1" }, async (req) => {
  const url = new URL(req.url);
  let path = url.pathname === "/" ? "/index_gossamer.html" : url.pathname;
  const file = dir + path;
  try {
    const data = await Deno.readFile(file);
    const ext = file.split(".").pop();
    const types = {
      html: "text/html", js: "application/javascript",
      css: "text/css", json: "application/json",
      png: "image/png", svg: "image/svg+xml",
      wasm: "application/wasm",
    };
    return new Response(data, {
      headers: { "content-type": types[ext] || "application/octet-stream" },
    });
  } catch {
    return new Response("Not Found", { status: 404 });
  }
});
DENO_SERVER
SERVER_PID=$!
echo "$SERVER_PID" > "$GOSSAMER_SERVER_PID_FILE"

# Wait for server to start
sleep 0.5
if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    rm -f "$GOSSAMER_SERVER_PID_FILE"
    echo "ERROR: Gossamer fallback server failed to start on port ${PORT}" >&2
    exit 1
fi

if should_auto_open; then
    xdg-open "http://127.0.0.1:${PORT}/" 2>/dev/null || true
else
    echo "Auto-open skipped; visit http://127.0.0.1:${PORT}/ manually."
fi

echo "Press Ctrl+C to stop."
trap cleanup INT TERM EXIT
wait $SERVER_PID
