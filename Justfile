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

# Serve game via Deno file server on port 6880
web:
  deno run --allow-net --allow-read jsr:@std/http@1/file-server --port 6880

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

# Type-check AffineScript test file
test-types:
  if command -v affinescript >/dev/null 2>&1; then \
    affinescript check test_types.as; \
  elif [ -n "${AFFINESCRIPT_REPO:-}" ] && [ -x "$AFFINESCRIPT_REPO/_build/default/bin/main.exe" ]; then \
    "$AFFINESCRIPT_REPO/_build/default/bin/main.exe" check test_types.as; \
  else \
    echo "affinescript not found — skipping type check" >&2; \
  fi

# Run VeriSimDB connectivity test
test-verisimdb:
  deno run --allow-net test_verisimdb_simple.js

# ── Blitz test suite ─────────────────────────────────────────────────

# Run all blitz tests (smoke → unit → contract → property → mutation → fuzz → regression → compat)
test:
  deno test --allow-all test/

# Run smoke tests only (fast gate, <30s)
test-smoke:
  deno test --allow-all test/smoke_test.js

# Run unit tests (game logic)
test-unit:
  deno test --allow-all test/unit_test.js

# Run contract/invariant tests (K9 compliance)
test-contract:
  deno test --allow-all test/contract_test.js

# Run property-based tests
test-property:
  deno test --allow-all test/property_test.js

# Run mutation tests
test-mutation:
  deno test --allow-all test/mutation_test.js

# Run fuzz tests (adversarial inputs)
test-fuzz:
  deno test --allow-all test/fuzz_test.js

# Run regression tests (locked bug fixes)
test-regression:
  deno test --allow-all test/regression_test.js

# Run compatibility tests (file formats, schemas)
test-compat:
  deno test --allow-all test/compatibility_test.js

# Run chaos/resilience tests
test-chaos:
  deno test --allow-all test/chaos_test.js

# Run mission-specific tests
test-missions:
  deno test --allow-all test/mission_test.js

# Run benchmarks (Six Sigma baselines)
bench:
  deno bench --allow-all test/bench.js
