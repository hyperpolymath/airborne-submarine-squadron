# Component Readiness Grade — Airborne Submarine Squadron

<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

## Current Grade: **D (Alpha)**

Assessed against [CRG v2.0](https://github.com/hyperpolymath/standards/blob/main/component-readiness-grades/COMPONENT-READINESS-GRADES.md) — deliberately strict.

| Criterion          | Status | Notes |
|--------------------|--------|-------|
| Does something useful | ✅ | Full arcade game loop: atmosphere, water, space |
| Works on some things  | ✅ | Atmosphere + underwater + orbital modes all functional |
| RSR compliance        | ⚠️ Partial | Missing `hypatia-scan.yml`; core workflows present |
| Test matrix           | ⚠️ Partial | `test_types.as`, `test_verisimdb_simple.js` exist but no structured test runner |
| **All tests and benches pass** | ⚠️ Unverified | Grade D requires this — see below |
| Scope documented      | ✅ | STATE.scm, ROADMAP.adoc, README.adoc |
| No regressions on own project | ✅ | Runs from repo root via `deno run --allow-all run.js` |

## Grade D Requirements (CRG v2.0)

Grade D mandates:
1. **RSR compliance** — rhodibot workflows must be present and green
2. **Test matrix** — at minimum a documented set of what is and isn't tested
3. **All tests and benches pass** — any test that is declared must pass; a failing test is a blocker for D
4. Scope is documented (what the project does and what it deliberately does not)

### Failing test = D blocker

If a test or benchmark is declared in the repo, it **must pass** to hold grade D.
A repo with broken tests is grade E (pre-alpha) regardless of how much the game works, because the test contract has been violated.

## Known Issues (blocking D completion)

- [ ] `hypatia-scan.yml` missing — add from RSR template
- [ ] No formal test runner; `test_types.as` / `test_verisimdb_simple.js` must be wired to `justfile`
- [ ] All declared tests must be confirmed passing before D is locked
- [ ] Crash logs now captured (logs/ folder + localStorage) — review before next release

## Path to C (Alpha-stable)

- All grade D blockers resolved
- Deep annotation: purpose/boundaries/invariants per directory and per major function group
- Dogfooding: used as the primary test target for PanLL game-dev panels
- CI green on every push (no home failures)

## Assessment Date

2026-04-04 — re-assess on each release cycle or when significant changes land.
