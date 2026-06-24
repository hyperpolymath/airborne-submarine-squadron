<!--
SPDX-License-Identifier: CC-BY-SA-4.0
SPDX-FileCopyrightText: 2026 Jonathan D.A. Jewell (hyperpolymath)
-->

# Changelog

All notable changes to `airborne-submarine-squadron` will be documented in this file.

This file is generated from conventional commits by the
[`changelog-reusable.yml`](https://github.com/hyperpolymath/standards/blob/main/.github/workflows/changelog-reusable.yml)
workflow (`hyperpolymath/standards#206`). Adopt the workflow in this repo's CI to keep this file in sync automatically — see
[`templates/cliff.toml`](https://github.com/hyperpolymath/standards/blob/main/templates/cliff.toml)
for the canonical config.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
this project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- feat: add wasm ABI contract runtime checks and event taxonomy
- feat: add camera layer helpers and enforce deno-only invariants
- feat: v2.1 Customization Layer + v3.0 deployment groundwork (#4)
- feat(v2.1): customization layer, damage refinement, controls module (#3)
- feat(src): refactor main.affine and update build script
- feat: wire terrain.js into HTML and _extract.js; add groundYFromTerrain unit tests
- feat: create terrain.js — generateTerrain, groundYFromTerrain, island hit tests, getGroundY (safe state)
- feat: wire persist.js into HTML and _extract.js; add keyLabel/currentSubSkin/getSupplyFrequency tests
- feat: create persist.js — settings, keybinds, leaderboard, save-game (safe state)
- feat: drawOrbitScene calls drawComets/Debris/Projectiles/Asteroids (restored after merge)

### Fixed

- fix(affine): migrate src/main.affine record literals to #{ } (affinescript#218) (#21)
- fix(ci): bump a2ml/k9-validate-action pins to canonical (standards#85) (#18)
- fix(ci): sync hypatia-scan.yml to canonical (kill cd-scanner build drift) (#17)
- fix(ci): adopt canonical hypatia-scan.yml (env.HOME/scanner-layout + Comment-step gate) (#16)
- fix(ci): Phase-2 fleet submission must not fail the security gate (#15)
- fix(ci): hypatia-scan.yml -- pass GITHUB_TOKEN, use --exit-zero (hyperpolymath/hypatia#213) (#7)
- fix(ci): rsr-antipattern duplicate heredoc + setup-beam ubuntu24 (#8)
- fix(tray): revert anti-pattern .expect("TODO") to .unwrap() in tests (11 sites)
- fix(gossamer): drop duplicate const for keys/keyJustPressed
- fix(launcher): make .desktop launches reliable

### Changed

- refactor: globally rename .as extension to .affine
- refactor: remove terrain functions moved to terrain.js
- refactor: remove persist constants and functions moved to persist.js
- refactor: remove orbital constants and functions moved to orbital.js
- refactor: remove weapon constants and functions moved to weapons.js
- refactor: replace inline weapon draw loops with drawDepthCharges/Torpedoes/Missiles calls

### Documentation

- docs(readme): add SPDX header and/or standard badges
- docs: persist.js + terrain.js modularisation plan
- docs(crg): add Current Grade badge anchor to READINESS.md
- docs: add TOPOLOGY.md
- docs: add TEST-NEEDS.md (CRG C)
- docs: add TEST-NEEDS.md (CRG C)

### CI

- ci: redistribute concurrency-cancel guard to read-only check workflows (#20)
- ci: SHA-pin hyperpolymath validate-actions in dogfood-gate
- ci: update dogfood-gate, add Groove manifest; fix gossamer JS modules
- ci: add dogfood-gate.yml — validates hyperpolymath tool usage

## Pre-history

Prior commits to this file's introduction are recorded in git history but not formally classified into Keep-a-Changelog sections. To backfill, run `git cliff -o CHANGELOG.md` locally using the canonical [`cliff.toml`](https://github.com/hyperpolymath/standards/blob/main/templates/cliff.toml) — this is one-shot mechanical work.

---

<!-- This file was seeded by the 2026-05-26 estate tech-debt audit follow-up (Row-2 Phase 3); see [`hyperpolymath/standards/docs/audits/2026-05-26-estate-documentation-debt.md`](https://github.com/hyperpolymath/standards/blob/main/docs/audits/2026-05-26-estate-documentation-debt.md). -->
