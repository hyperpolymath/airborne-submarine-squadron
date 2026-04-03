# SPDX-License-Identifier: AGPL-3.0-or-later
# Airborne Submarine Squadron (AffineScript)

set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

# Type-check AffineScript source
check:
  if command -v affinescript >/dev/null 2>&1; then \
    affinescript check src/main.as; \
  elif [ -n "${AFFINESCRIPT_REPO:-}" ] && [ -x "$AFFINESCRIPT_REPO/_build/default/bin/main.exe" ]; then \
    "$AFFINESCRIPT_REPO/_build/default/bin/main.exe" check src/main.as; \
  else \
    echo "affinescript not found. Set AFFINESCRIPT_REPO=/path/to/affinescript" >&2; \
    exit 1; \
  fi

# Build AffineScript to WASM
build:
  ./build.sh

# Launch the game (platform-detect, self-heal, git cycle)
run:
  deno run --allow-all run.js

# Run WASM directly via wasmtime (CLI/headless mode)
run-wasm:
  wasmtime build/airborne-submarine-squadron.wasm

# Serve game via Deno file server on port 6860
web:
  deno run --allow-net --allow-read https://deno.land/std/http/file_server.ts --port 6860

# Launch via unified launcher (default: browser)
launch:
  ./launcher.sh

# Launch Gossamer desktop variant
gossamer:
  ./launcher.sh --gossamer

# Run Rust tray binary checks
check-tray:
  cd tray && cargo check

# Build Rust tray binary
build-tray:
  cd tray && cargo build --release

# Run VeriSimDB connectivity test
test-verisimdb:
  deno run --allow-net test_verisimdb_simple.js
