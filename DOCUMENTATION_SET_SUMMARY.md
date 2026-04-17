# Documentation Set Summary for Airborne Submarine Squadron

## Current Documentation Baseline

This repository is now explicitly **Deno-only** and **AffineScript/WASM-first**.

### Core docs
- `README.adoc` — project overview, launcher/build quick start, runtime expectations
- `ROADMAP.adoc` — staged milestones and active work queue
- `explainme.adoc` — technical architecture and implementation rationale

### Runtime docs
- `docs/` — engineering/development notes and subsystem references
- `MULTIPLAYER.md` + `MULTIPLAYER-HANDOFF.md` — networking/multiplayer integration context

## Corrective Documentation Changes Applied

The prior npm/GitHub Packages publish flow has been removed to restore architectural invariants:
- Removed: `GITHUB_PACKAGES_GUIDE.md`
- Removed: `PACKAGE_SETUP_SUMMARY.md`
- Removed npm artifacts from the repo (`package.json`, `.npmignore` already deleted)

## Invariants (Authoritative)

- Runtime/package management: Deno-only (`deno.json`, `deno.lock`)
- Language of game logic: AffineScript (`src/main.affine`) compiled to WASM
- Frontend/game loop: Gossamer JS frontend consuming the WASM artifact
- No npm packaging/distribution path in this repository
