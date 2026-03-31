#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT_DIR="$ROOT_DIR/build"
OUT_WASM="$OUT_DIR/airborne-submarine-squadron.wasm"

mkdir -p "$OUT_DIR"

if command -v affinescript >/dev/null 2>&1; then
  affinescript compile "$ROOT_DIR/src/main.as" -o "$OUT_WASM"
  echo "Wrote $OUT_WASM"
  exit 0
fi

if [ -z "${AFFINESCRIPT_REPO:-}" ]; then
  echo "affinescript not found on PATH. Set AFFINESCRIPT_REPO=/path/to/affinescript" >&2
  exit 1
fi

if [ -x "$AFFINESCRIPT_REPO/_build/default/bin/main.exe" ]; then
  "$AFFINESCRIPT_REPO/_build/default/bin/main.exe" compile "$ROOT_DIR/src/main.as" -o "$OUT_WASM"
else
  ( cd "$AFFINESCRIPT_REPO" && dune exec affinescript -- compile "$ROOT_DIR/src/main.as" -o "$OUT_WASM" )
fi

echo "Wrote $OUT_WASM"
