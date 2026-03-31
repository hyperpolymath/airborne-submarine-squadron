# Airborne Submarine Squadron (AffineScript)

set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

check:
  if command -v affinescript >/dev/null 2>&1; then \
    affinescript check src/main.as; \
  elif [ -n "${AFFINESCRIPT_REPO:-}" ] && [ -x "$AFFINESCRIPT_REPO/_build/default/bin/main.exe" ]; then \
    "$AFFINESCRIPT_REPO/_build/default/bin/main.exe" check src/main.as; \
  else \
    echo "affinescript not found. Set AFFINESCRIPT_REPO=/path/to/affinescript" >&2; \
    exit 1; \
  fi

build:
  ./build.sh

run:
  node run_wasm.js build/airborne-submarine-squadron.wasm main

web:
  python -m http.server
