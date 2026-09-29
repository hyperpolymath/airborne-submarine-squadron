#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 Jonathan D.A. Jewell (hyperpolymath)
#
# build.sh — compile src/main.affine (AffineScript) to core WebAssembly: build/airborne-submarine-squadron.wasm
#
# The WASM co-processor is OPTIONAL: the game is fully playable without it (init() logs
# "WASM co-processor unavailable" and carries on).  So:
#   * no compiler available      -> exit 0 with a clear note (nothing is broken)
#   * compiler present, compile fails            -> exit 1 (a real error)
#   * compile succeeds but the artifact FAILS sim/verify_artifact.js -> the artifact is DELETED and we
#     exit 2: a WASM that disagrees with the reference twin must never be loaded by the game.
#
# Target is CORE wasm (linear memory), NOT --wasm-gc: the JS loader (gossamer/wasm_abi.js) reads the
# snapshot from an exported linear `memory`.  The old script passed --wasm-gc, producing a module the
# loader rejects ("memory export missing").  See docs/AFFINESCRIPT-PORT-PLAN.adoc for ABI v2 (typed-wasm regions).
#
# Compiler discovery (first hit wins):
#   1. `affinescript` on PATH
#   2. $AFFINESCRIPT_REPO/_build/default/bin/main.exe  (a local checkout of hyperpolymath/affinescript)
#   3. sibling checkouts: ../nextgen-languages/affinescript, ../../nextgen-languages/affinescript, ...
# If none exist:  "affinescript not found" (set AFFINESCRIPT_REPO=/path/to/affinescript to build).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT_DIR="$ROOT_DIR/build"
OUT_WASM="$OUT_DIR/airborne-submarine-squadron.wasm"
TMP_WASM="$OUT_DIR/.airborne-submarine-squadron.wasm.tmp"
mkdir -p "$OUT_DIR"

find_compiler() {
  if command -v affinescript >/dev/null 2>&1; then command -v affinescript; return 0; fi
  local candidate
  for candidate in \
    "${AFFINESCRIPT_REPO:-}" \
    "$ROOT_DIR/../nextgen-languages/affinescript" \
    "$ROOT_DIR/../../nextgen-languages/affinescript" \
    "$ROOT_DIR/../../developer-ecosystem/nextgen-languages/affinescript" \
    "$ROOT_DIR/../affinescript"; do
    [ -n "$candidate" ] || continue
    if [ -x "$candidate/_build/default/bin/main.exe" ]; then printf '%s\n' "$candidate/_build/default/bin/main.exe"; return 0; fi
  done
  return 1
}

if ! COMPILER="$(find_compiler)"; then
  echo "affinescript not found: skipping the WASM co-processor (optional — the game runs without it)."
  echo "Set AFFINESCRIPT_REPO=/path/to/affinescript (a built checkout) or put 'affinescript' on PATH to build it."
  exit 0
fi

echo "Compiling src/main.affine with $COMPILER (core WASM)"
rm -f "$TMP_WASM"
if ! "$COMPILER" compile "$ROOT_DIR/src/main.affine" -o "$TMP_WASM"; then
  rm -f "$TMP_WASM"
  echo "ERROR: affinescript failed to compile src/main.affine" >&2
  exit 1
fi
[ -f "$TMP_WASM" ] || { echo "ERROR: compiler reported success but produced no file" >&2; exit 1; }

if command -v bun >/dev/null 2>&1 && [ "${ASS_SKIP_VERIFY:-0}" != "1" ]; then
  echo "Verifying the artifact against the reference twin (sim/verify_artifact.js)..."
  if ! bun run "$ROOT_DIR/sim/verify_artifact.js" "$TMP_WASM"; then
    rm -f "$TMP_WASM" "$OUT_WASM"
    echo "ERROR: the compiled artifact does not conform to the reference; it was deleted (the game will run without a WASM co-processor)." >&2
    echo "       Set ASS_SKIP_VERIFY=1 to keep it anyway (NOT recommended)." >&2
    exit 2
  fi
else
  echo "note: bun not found (or ASS_SKIP_VERIFY=1): artifact NOT verified against the reference" >&2
fi

mv "$TMP_WASM" "$OUT_WASM"
echo "Wrote $OUT_WASM"
