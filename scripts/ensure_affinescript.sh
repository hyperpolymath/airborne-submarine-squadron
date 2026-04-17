#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:---print-bin}"

find_repo() {
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

main() {
  local repo
  if ! repo="$(find_repo)"; then
    exit 1
  fi

  if [ "${AFFINESCRIPT_AUTO_UPDATE:-1}" = "1" ] && [ -d "$repo/.git" ] && command -v git >/dev/null 2>&1; then
    # Best-effort update; ignore network/offline failures.
    (cd "$repo" && git pull --ff-only >/dev/null 2>&1) || true
  fi

  local bin="$repo/_build/default/bin/main.exe"
  if [ ! -x "$bin" ] && command -v dune >/dev/null 2>&1; then
    # Build compiler binary if absent; non-fatal for startup workflows.
    (cd "$repo" && dune build bin/main.exe >/dev/null 2>&1) || true
  fi

  if [ "$MODE" = "--warmup" ]; then
    exit 0
  fi

  if [ -x "$bin" ]; then
    printf '%s\n' "$bin"
    exit 0
  fi

  exit 1
}

main "$@"
