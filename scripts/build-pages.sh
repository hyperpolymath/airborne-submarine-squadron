#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 Jonathan D.A. Jewell (hyperpolymath)
#
# build-pages.sh — assemble the deployable static game into $1 (default _site).
#
# Copies ONLY what the browser needs (the same allowlist the local server enforces in
# server/ass-server.js), so nothing from the repo root leaks onto the public site.
# test/pages_test.js boots the assembled site in the headless harness: if this script
# forgets a module, CI fails here instead of the public link silently breaking.
set -euo pipefail

OUT="${1:-_site}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
rm -rf "$OUT"
mkdir -p "$OUT/gossamer/net" "$OUT/desktop/icons" "$OUT/.well-known"

cp "$ROOT/index.html" "$OUT/index.html"
cp "$ROOT"/gossamer/*.js "$ROOT/gossamer/index_gossamer.html" "$OUT/gossamer/"
cp "$ROOT"/gossamer/net/*.js "$OUT/gossamer/net/"
cp "$ROOT"/desktop/icons/*.png "$ROOT"/desktop/icons/*.svg "$ROOT"/desktop/icons/*.ico "$OUT/desktop/icons/" 2>/dev/null || true
[ -f "$ROOT/airborne-submarine-squadron.png" ] && cp "$ROOT/airborne-submarine-squadron.png" "$OUT/"

# RFC 9116 + groove manifest live under www/.well-known in this repo (RSR layout)
cp -r "$ROOT"/www/.well-known/. "$OUT/.well-known/"
# Groove discovery: GET /.well-known/groove -> the manifest (static-file deployment form, spec 2.1.4)
[ -f "$OUT/.well-known/groove/manifest.json" ] && cp "$OUT/.well-known/groove/manifest.json" "$OUT/.well-known/groove.json"

# A compiled WASM co-processor is optional (not tracked); include it if a build produced one.
if [ -f "$ROOT/build/airborne-submarine-squadron.wasm" ]; then
  mkdir -p "$OUT/build" && cp "$ROOT/build/airborne-submarine-squadron.wasm" "$OUT/build/"
fi

# Serve dot-directories (.well-known) under GitHub Pages' Jekyll default.
: > "$OUT/.nojekyll"
printf '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=./"><title>Airborne Submarine Squadron</title>' > "$OUT/404.html"

echo "site assembled in $OUT ($(find "$OUT" -type f | wc -l) files)"
