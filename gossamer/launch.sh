#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
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

REPOS_ROOT="$(cd "$GAME_ROOT/.." && pwd)"
EPHAPAX="${REPOS_ROOT}/nextgen-languages/ephapax/target/release/ephapax"
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
    # Aggressively release the Deno server port so a new launch never
    # finds it occupied.  Run unconditionally — the port might be held
    # by a Deno process whose PID file was already cleaned up.
    for port in 6860 $(seq 6861 6869) $(seq 6870 6899); do
        if ss -tlnH "sport = :$port" 2>/dev/null | grep -q .; then
            # fuser sends SIGKILL to all processes bound to the port.
            fuser -k "${port}/tcp" 2>/dev/null || true
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

# Serve from the game root (one level up from gossamer/) so that:
#   /gossamer/index_gossamer.html  — the game page
#   /gossamer/app_gossamer.js      — the game engine
#   /build/airborne-final-working.wasm — WASM co-processor
# are all reachable from the same origin (required for WASM fetch).
deno run --allow-net --allow-read - <<DENO_SERVER &
const root = "${GAME_ROOT}";
Deno.serve({ port: ${PORT}, hostname: "127.0.0.1" }, async (req) => {
  const url = new URL(req.url);
  // Default route: redirect / to the Gossamer game page
  let path = url.pathname === "/" ? "/gossamer/index_gossamer.html" : url.pathname;
  // Prevent path traversal above root
  const resolved = root + path;
  if (!resolved.startsWith(root)) {
    return new Response("Forbidden", { status: 403 });
  }
  const file = resolved;
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
    xdg-open "http://127.0.0.1:${PORT}/gossamer/index_gossamer.html" 2>/dev/null || true
else
    echo "Auto-open skipped; visit http://127.0.0.1:${PORT}/ manually."
fi

echo "Press Ctrl+C to stop."
trap cleanup INT TERM EXIT
wait $SERVER_PID
