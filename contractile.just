# SPDX-License-Identifier: AGPL-3.0-or-later
# contractile.just — Airborne Submarine Squadron contractile runner
# Auto-generated from contractiles/ directory.
# Re-generate with: contractile gen-just --dir contractiles

# === MUST (Mandatory Invariants) ===
# Source: contractiles/must/Mustfile

# Run all mandatory invariant checks
must-check:
    @echo '=== Running Airborne Submarine Squadron mandatory checks ==='
    @just check || (echo 'FAIL: affinescript typecheck' && exit 1)
    @test -f contractiles/must/Mustfile && echo 'PASS: Mustfile present'
    @echo '=== All mandatory checks passed ==='

# Check SPDX headers in source files
must-spdx:
    @echo 'Checking SPDX headers...'
    @find src/ -name '*.as' -o -name '*.zig' -o -name '*.idr' 2>/dev/null | \
        xargs grep -L 'SPDX-License-Identifier' 2>/dev/null | head -5 | \
        (read -r line; if [ -n "$$line" ]; then echo "FAIL: missing SPDX: $$line"; exit 1; fi)
    @echo 'PASS: SPDX headers present'

# Check machine-readable files exist
must-scm-files:
    @echo 'Checking machine-readable files...'
    @test -f .machine_readable/STATE.scm && echo 'PASS: STATE.scm' || (echo 'FAIL: missing STATE.scm' && exit 1)
    @test -f .machine_readable/META.scm && echo 'PASS: META.scm' || (echo 'FAIL: missing META.scm' && exit 1)
    @test -f .machine_readable/ECOSYSTEM.scm && echo 'PASS: ECOSYSTEM.scm' || (echo 'FAIL: missing ECOSYSTEM.scm' && exit 1)

# === DUST (Recovery & Rollback) ===
# Source: contractiles/dust/Dustfile

# Show available recovery actions
dust-status:
    @echo '  dust-rollback-source: Revert source changes to last commit [rollback]'
    @echo '  dust-clean-build:     Remove WASM build artifacts [cleanup]'

# Revert source changes to last commit
dust-rollback-source:
    @echo 'Rolling back source changes...'
    git checkout HEAD -- src/ 2>/dev/null || true
    @echo 'Rollback complete.'

# Remove build artifacts
dust-clean-build:
    rm -rf build/ dist/ 2>/dev/null || true
    @echo 'Build artifacts cleaned.'

# === LUST (Aspirational Goals) ===
# Source: contractiles/lust/

# Show aspirational goals
lust-status:
    @echo 'Airborne Submarine Squadron aspirational goals:'
    @echo '  - Native WASM compilation via AffineScript'
    @echo '  - Multi-player co-op missions'
    @echo '  - Formal proof of game balance invariants (Idris2)'
    @echo '  - Mobile-first responsive design'
