#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT_DIR="$ROOT_DIR/build"
OUT_WASM="$OUT_DIR/airborne-submarine-squadron.wasm"
DIST_WASM="$ROOT_DIR/dist/airborne-submarine-squadron.wasm"
TMP_WASM="$OUT_DIR/.airborne-submarine-squadron.wasm.tmp"

mkdir -p "$OUT_DIR"

find_affinescript_repo() {
  local candidate
  for candidate in \
    "${AFFINESCRIPT_REPO:-}" \
    "$ROOT_DIR/../nextgen-languages/affinescript" \
    "$ROOT_DIR/../../nextgen-languages/affinescript" \
    "$ROOT_DIR/../../developer-ecosystem/nextgen-languages/affinescript" \
    "/var/mnt/eclipse/repos/developer-ecosystem/nextgen-languages/affinescript" \
    "/var/mnt/eclipse/repos/nextgen-languages/affinescript"
  do
    [ -n "$candidate" ] || continue
    if [ -d "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

if [ -x "$ROOT_DIR/scripts/ensure_affinescript.sh" ]; then
  "$ROOT_DIR/scripts/ensure_affinescript.sh" --warmup >/dev/null 2>&1 || true
fi

compile_with_affinescript() {
  local compiler_repo="$1"
  rm -f "$TMP_WASM"
  if command -v affinescript >/dev/null 2>&1; then
    echo "Using affinescript from PATH (WASM GC)"
    affinescript compile "$ROOT_DIR/src/main.affine" --wasm-gc -o "$TMP_WASM"
    [ -f "$TMP_WASM" ]
    return $?
  fi

  if [ -x "$compiler_repo/_build/default/bin/main.exe" ]; then
    echo "Using affinescript from $compiler_repo/_build/default/bin/main.exe (WASM GC)"
    "$compiler_repo/_build/default/bin/main.exe" compile "$ROOT_DIR/src/main.affine" --wasm-gc -o "$TMP_WASM"
    [ -f "$TMP_WASM" ]
    return $?
  fi

  echo "Using dune exec affinescript from $compiler_repo (WASM GC)"
  ( cd "$compiler_repo" && dune exec affinescript -- compile "$ROOT_DIR/src/main.affine" --wasm-gc -o "$TMP_WASM" )
  [ -f "$TMP_WASM" ]
  return $?
}

preserve_bundled_wasm() {
  rm -f "$TMP_WASM"
  if [ -f "$DIST_WASM" ]; then
    cp "$DIST_WASM" "$OUT_WASM"
  elif [ -f "$OUT_WASM" ]; then
    :
  else
    echo "No fallback WASM artifact available." >&2
    exit 1
  fi
  echo "Compile failed; reusing fallback WASM:"
  echo "  $OUT_WASM"
  exit 0
}

if REPO_PATH="$(find_affinescript_repo)"; then
  if ! compile_with_affinescript "$REPO_PATH"; then
    preserve_bundled_wasm
  fi
elif command -v affinescript >/dev/null 2>&1; then
  if ! compile_with_affinescript ""; then
    preserve_bundled_wasm
  fi
else
  if [ -f "$DIST_WASM" ]; then
    cp "$DIST_WASM" "$OUT_WASM"
    echo "affinescript not found. Reusing prebuilt WASM artifact:"
    echo "  $OUT_WASM"
    echo "Set AFFINESCRIPT_REPO=/path/to/affinescript only if you need a fresh compile."
    exit 0
  elif [ -f "$OUT_WASM" ]; then
    echo "affinescript not found. Reusing existing WASM artifact:"
    echo "  $OUT_WASM"
    echo "Set AFFINESCRIPT_REPO=/path/to/affinescript only if you need a fresh compile."
    exit 0
  fi

  echo "affinescript not found on PATH and no local checkout was detected." >&2
  echo "Looked for AFFINESCRIPT_REPO, sibling nextgen-languages/affinescript, and /var/mnt/eclipse/repos/nextgen-languages/affinescript" >&2
  exit 1
fi

mv "$TMP_WASM" "$OUT_WASM"
echo "Wrote $OUT_WASM"
