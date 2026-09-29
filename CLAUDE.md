<!--
SPDX-License-Identifier: AGPL-3.0-or-later
SPDX-FileCopyrightText: 2026 Jonathan D.A. Jewell <j.d.a.jewell@open.ac.uk>
-->
<!-- Hand-authored. The estate arrival pack (`just claude-md`) is not wired in this repo yet; the estate-common
     section below is copied from hyperpolymath/rsr-template-repo CLAUDE.md. -->

# You are in the hyperpolymath estate — orient before acting

If you are unsure what something is, **read the canon; do not guess**. Start here, then the files named below.

## Doctrine (the rules here)
1. **Holes before anything else** — fix soundness holes before features/perf/docs.
2. **Fixes first, on firm foundations** — ground-truth by running the tool, not trusting status docs.
3. **Fail loudly, seal soundly** — no silent green; seams (ABI/FFI) sealed & proven.
4. **Distrust the neural for exactness** — licences/invariants/equivalence belong to **PLASMA** (formal), not to an LLM. Your edits there are provisional + supervised.
5. **Squabble, don't bypass** — reach green by *satisfying* the gate, never by admin-override.
6. **No automated licence edits — ever** — manual, owner-only; third-party untouchable.
7. **No deletion by access-recency** — cold ≠ disposable.
8. **Wire first** — unwired is not done.
9. **Always sign** commits (`id_ed25519_signing`; verify `status:G`).
10. **Report faithfully — no overclaim** (the AFFIRMATION ethos).
11. **Stop-first** when an action is costly to undo or outward-facing.
12. **Boundaries are real** — respect IS / IS-NOT; never assimilate or rename across them.
13. **Equivalence as identity** — the estate's intellectual through-line.
14. **Solutions at source** — fix the canonical/upstream origin, never patch the downstream symptom.
15. **Elegance by default** — label which option is the most elegant/correct long-term when you put a choice to the owner.

## The machine-readable substrate (read in this order on arrival)
`0-AI-MANIFEST.a2ml` → `coordination.k9` → `.machine_readable/descriptiles/{META,ECOSYSTEM,STATE}.a2ml` → `.machine_readable/rsr-profile.a2ml`.
(`CLADE`, `ANCHOR`, `AGENTIC`, `NEUROSYM`, `PLAYBOOK` and the six contractile tridents from the template are NOT adopted yet — see `docs/RSR-COMPLIANCE.adoc`.)

## Estate language policy (overridable per-repo via AGENTIC)
Deny: **Nix, Python, Go, TypeScript, AGPL**. (Guix, not Nix.)
JavaScript tooling order: **Bun** (default) > Deno (being removed — owner ruling 2026-08-26, standards#655) > pnpm > npm (last resort, permitted).
Use plain JavaScript when this tooling is needed. Do not migrate Bun to Deno.

---

# This repo: `airborne-submarine-squadron`

A Sopwith-style arcade game; the player flies an **attack submarine** (never "plane"/"aircraft" — `coordination.k9`
terminology rule) that dives, flies and reaches orbit. Web-first; Gossamer desktop shell; AffineScript/typed-WASM core in progress.

## Orient (2 minutes)
| Want | Read |
|---|---|
| Where the project really is (verified) | `docs/RECON-2026-09.adoc` |
| Where it is going, and the commercial path | `docs/ROADMAP.adoc`, `docs/CULT-GAME-STRATEGY.adoc` |
| What other repos must do for this to happen | `docs/JOINERY-AND-UPSTREAM-ASKS.adoc` |
| The jump bugs and how they were found | `docs/JUMP-BUG-POSTMORTEM.adoc` |
| How to run / test | `just --list`; `docs/TESTING.adoc` |

## Hard rules for this repo
- **Runtime: Bun only.** `bun run run.js`, `bun test`. No Deno, Node, npm, yarn, pnpm. `package.json` is expected and must stay dependency-free.
- **The engine is deterministic.** Simulation code uses `simRand()` (seeded), never `Math.random()`; `update()` is called only by the fixed-step loop with `SIM_DT`; draw code must not mutate simulation-visible state. `test/determinism_test.js` and `test/jump_test.js` enforce this — keep them green.
- **Canvas `save()`/`restore()` must balance in every function** (the original "sub jumps around the screen" bug). Enforced statically and dynamically.
- **A compiled WASM core is never trusted because it exists**: it must pass `sim/verify_artifact.js` against `sim/shadow_ref.js`.
- **Launching the game never touches git or other repos.** (`run.js --git-cycle` is opt-in; the compiler auto-update is opt-in.)
- **Licence edits are owner-only and manual** (doctrine 6). A staged MPL-2.0 migration exists: `scripts/relicense-mpl2.js` (dry-run by default) and `docs/decisions/ADR-0002-licence-mpl-2.0.adoc`. Do not run it on the owner's behalf.
- Ground-truth before believing docs: several older status documents in this repo overclaimed (see the RECON).
