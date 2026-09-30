# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 Jonathan D.A. Jewell (hyperpolymath)
#
# Airborne Submarine Squadron — task runner.  Runtime: Bun (estate standard; Deno retired 2026-09-22).
#
# NB: this file used Make-style `$$` escapes, which `just` passes straight to bash where `$$` is the
# PROCESS ID — so `just check` and `just crg-grade` could never have worked.  Plain `$` below.

set shell := ["bash", "-euo", "pipefail", "-c"]
set positional-arguments := true

project := "airborne-submarine-squadron"
version := "0.5.0"

# List recipes
default:
    @just --list --unsorted

# Project info
info:
    @echo "{{project}} v{{version}}"
    @echo "runtime : $(bun --version 2>/dev/null | sed 's/^/bun /' || echo 'bun NOT FOUND — https://bun.sh')"
    @echo "port    : 6880 (fallbacks 6881-6884)"
    @echo "engine  : gossamer/*.js (fixed 60 Hz sim, seeded RNG)  |  core: src/main.affine -> WASM (optional)"

# ── Play ─────────────────────────────────────────────────────────────────

# Serve + open the game (Bun game server on :6880)
run *args:
    bun run run.js "$@"

# Serve without opening a browser
serve *args:
    bun run run.js --no-open "$@"

# Debug mode: no cache, ?debug=1 diagnostics overlay
debug:
    bun run run.js --debug

# Launch via the unified launcher (gossamer desktop / browser)
launch *args:
    ./launcher.sh "$@"

# ── Test ─────────────────────────────────────────────────────────────────

# Everything: boots the REAL engine headlessly (see docs/TESTING.adoc)
test *args:
    bun test "$@"

# The jump-bug regression suite (canvas transform, camera, entry points)
test-jump:
    bun test test/jump_test.js

# Frame-rate independence + determinism (fixed step, seeded RNG, static guards)
test-determinism:
    bun test test/fixed_step_test.js test/determinism_test.js

# Server security contract (allowlist, same-origin, bounds)
test-server:
    bun test test/server_test.js

# Reference twin + golden vectors + WASM artifact conformance
test-wasm:
    bun test test/wasm_artifact_test.js

# Coverage
coverage:
    bun test --coverage

# Benchmarks on the REAL engine
bench:
    bun run bench

# ── AffineScript / WASM core ────────────────────────────────────────────

# Type-check the AffineScript source (needs the compiler)
check:
    if command -v affinescript >/dev/null 2>&1; then \
      affinescript check src/main.affine; \
    elif [ -n "${AFFINESCRIPT_REPO:-}" ] && [ -x "$AFFINESCRIPT_REPO/_build/default/bin/main.exe" ]; then \
      "$AFFINESCRIPT_REPO/_build/default/bin/main.exe" check src/main.affine; \
    else \
      echo "affinescript not found. Set AFFINESCRIPT_REPO=/path/to/affinescript" >&2; exit 1; \
    fi

# Compile to core WASM and verify against the reference twin (no compiler: skips, exit 0)
build:
    ./build.sh

# Conformance-check any compiled artifact against the reference twin
verify-wasm file="build/airborne-submarine-squadron.wasm":
    bun run sim/verify_artifact.js {{file}}

# Regenerate / check the golden vectors (sim/vectors/shadow_v1.json)
vectors:
    bun run sim/make_vectors.js

vectors-check:
    bun run sim/make_vectors.js --check

# ── Static analysis (estate tools; need a Rust toolchain: cargo install --git ...) ──

# pons-asinorum: dead work, self-contradiction, missing escape hatches (https://github.com/hyperpolymath/pons-asinorum)
pons path=".":
    pons scan {{path}}

# panic-attack: multi-language weak-point analysis (https://github.com/hyperpolymath/panic-attack)
assail path=".":
    panic-attack assail {{path}} --output-format json --store .panic-attack

# ── Compliance ──────────────────────────────────────────────────────────

# Root-shape allowlist (RSR template check)
rsr-root:
    bash scripts/check-root-shape.sh .

# Assemble the GitHub Pages site locally
pages out="_site":
    bash scripts/build-pages.sh {{out}}

# All local gates
ci: test vectors-check rsr-root

# Print the CRG grade (docs/governance/READINESS.adoc '*Current Grade:* X')
crg-grade:
    @grade=$(grep -oP '(?<=\*Current Grade:\* )[A-FX]' docs/governance/READINESS.adoc 2>/dev/null | head -1); \
    echo "${grade:-X}"

# shields.io badge markdown for the CRG grade
crg-badge:
    @grade=$(grep -oP '(?<=\*Current Grade:\* )[A-FX]' docs/governance/READINESS.adoc 2>/dev/null | head -1); grade="${grade:-X}"; \
    case "$grade" in A) c=brightgreen;; B) c=green;; C) c=yellow;; D) c=orange;; E) c=red;; F) c=critical;; *) c=lightgrey;; esac; \
    echo "[![CRG $grade](https://img.shields.io/badge/CRG-$grade-$c?style=flat-square)](https://github.com/hyperpolymath/standards/tree/main/component-readiness-grades)"

# ── Rust tray + desktop integration ─────────────────────────────────────

check-tray:
    cd tray && cargo check

build-tray:
    cd tray && cargo build --release

install:
    ./desktop/install.sh

uninstall:
    ./desktop/uninstall.sh

# Remove generated output
clean:
    rm -rf build/airborne-submarine-squadron.wasm build/.*.tmp _site cov .panic-attack logs/*.json

# ── Mandatory invariants / recovery (was contractile.just; repaired: dead `*.as` globs, `$$`, STATE.scm) ──

must-check: test vectors-check
    @test -f .machine_readable/contractiles/must/Mustfile && echo 'PASS: Mustfile present'
    @echo '=== All mandatory checks passed ==='

must-spdx:
    @missing=$(git ls-files 'src/*.affine' 'gossamer/*.js' 'server/*.js' 'sim/*.js' 'test/*.js' 'ffi/zig/src/*.zig' | xargs grep -L 'SPDX-License-Identifier' || true); \
    if [ -n "$missing" ]; then echo "FAIL: missing SPDX:"; echo "$missing"; exit 1; fi; echo 'PASS: SPDX headers present'

must-state:
    @for f in STATE META ECOSYSTEM; do test -f ".machine_readable/descriptiles/$f.a2ml" && echo "PASS: $f.a2ml" || { echo "FAIL: missing $f.a2ml"; exit 1; }; done

dust-rollback-source:
    git checkout HEAD -- src/

dust-clean-build:
    rm -rf build/airborne-submarine-squadron.wasm
