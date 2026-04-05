# PROOF-NEEDS.md — airborne-submarine-squadron

Companion to `TEST-NEEDS.md`. This file tracks invariants in the game
code that deserve **formal proofs** (in Lean, Idris2, or SPARK) rather
than just property tests. Property tests catch regressions on known
inputs; proofs certify that the property holds for *all* inputs.

Tests covering these invariants live in `test/invariant_test.js`.

---

## Current formal proofs

None yet. The game is JavaScript; there is no proof assistant integration
in this repo. All entries below are proof **candidates**.

---

## Candidate obligations

### P1. Mine chain detonation terminates

**File**: `gossamer/app_gossamer.js:1319-1378`
**Tests**: `test/invariant_test.js` — 3 tests

**Claim**: for any initial configuration of N mines and any starting
mine index `i`, calling `triggerMine(world, mines[i])` causes the
cascade to halt in O(N) detonations.

**Argument**:
- Each mine has a boolean `active` flag.
- `triggerMine` sets `active = false` *before* scanning neighbours.
- The neighbour-fuse loop skips mines where `active === false` OR
  `chainFuse > 0`.
- So each mine gets exactly one fuse lit, at most once.
- Mine count is bounded (MINE_COUNT = 12 by default, absolute cap
  enforced at generation time).
- Therefore total detonations ≤ N, so the cascade terminates.

**Why prove it**: `updateMines` runs every frame. If the termination
argument is violated by a future edit (e.g. someone drops the
`active === false` guard, or adds a path where a triggered mine
re-activates), the game freezes in the update loop.

**Target assistant**: Idris2 — the `active` flag and finite-set
bound translate cleanly to dependent types.

### P2. Sopwith target is never null during an active frame

**File**: `gossamer/enemies.js:417-421` (resolve block)
**Tests**: `test/invariant_test.js` — 1 test

**Claim**: after the target-resolution block runs, `sw.target` is
always a valid object reference (neither `null`, nor a dead unit).

**Argument**:
- `sopwithTargetValid` returns false for `null`, `undefined`,
  `{alive:false}`, and `{destroyed:true}`.
- If the check fails, `sw.target = sub`. `sub` is the player submarine,
  which is not null during active frames.
- Therefore: ∀ frame f where `updateSopwith` runs, `sw.target !== null`
  after line 421.

**Why prove it**: downstream code (chase/loop states, bullet targeting)
assumes `sw.target` is non-null without checking. A future edit that
drops the fallback silently introduces null-deref risk.

**Target assistant**: Idris2 refinement type
`Target = (t : Object ** valid(t))`.

### P3. Ladder passenger eventually released

**File**: `gossamer/app_gossamer.js:4434-4477`
**Tests**: `test/invariant_test.js` — 3 tests

**Claim (partial correctness)**: if the ladder tip is in water for at
least K consecutive ticks with lateral velocity-jerk ≥ J, then
`ladderPassenger` is cleared within K ticks. For some K(J) bounded
function.

**Non-claim**: purely airborne passenger can cling indefinitely (by
design — the game rewards water-dragging).

**Argument**:
- `ladderShakeAccum += jerk * 8 * dt` when tip in water.
- `ladderShakeAccum *= 0.98` when airborne.
- Release fires at `ladderShakeAccum > 14`.
- For constant jerk j and dt=1 in water: accum(t) = 8·j·t, so
  release at t > 14/(8·j) = 1.75/j.
- Crush path (`tipY ≥ groundY && speed > 1.0`) clears unconditionally.

**Why prove it**: game-design invariant — "the player can *always*
clear the passenger given enough effort". If broken, the game is
unwinnable in some states.

**Target assistant**: Lean 4 — the monotone-sequence argument is
standard real-analysis.

### P4. Bouncing bomb always expires within BBOMB_LIFE ticks

**File**: `gossamer/app_gossamer.js:5516-5544`
**Tests**: `test/invariant_test.js` — 1 test

**Claim**: every bouncing bomb is removed from `world.bouncingBombs`
within `BBOMB_LIFE` (300) ticks of creation, regardless of input.

**Argument**:
- `bb.life -= dt` every update frame (dt ≥ 0).
- `if (bb.life <= 0) splice()` is unconditional.
- Additional removal conditions (bounces ≥ MAX_BOUNCES, hit ground,
  hit ship, hit island) can only *shorten* the lifetime.
- Therefore lifetime ≤ BBOMB_LIFE.

**Why prove it**: `world.bouncingBombs` is iterated every frame.
Unbounded lifetime → unbounded array → memory leak in long sessions.

**Target assistant**: trivial — any proof assistant.

### P5. WebRTC signalling room count bounded

**File**: `run.js:315-389`
**Tests**: `test/invariant_test.js` — 3 tests

**Claim**: `rooms.size ≤ MAX_ROOMS` holds after every request.

**Argument**:
- Before `rooms.set(code, ...)`, if `rooms.size >= MAX_ROOMS`, LRU
  eviction removes exactly one entry.
- So `rooms.size` can increase by at most 1 per request, only when it
  was below the cap.
- Timer-based `sweepRooms()` removes stale entries (last-touched >
  ROOM_TTL_MS ago). Can only *decrease* size.
- Therefore size never exceeds MAX_ROOMS.

**Why prove it**: server is long-running. A regression here is a
memory leak / DoS vector. The previous version **did** leak because
`sweepRooms` only ran on incoming requests.

**Target assistant**: any — finite-map cardinality proof.

---

## Adding a new obligation

1. Identify an invariant in the code (look for `invariant:`, `must`,
   `always` in comments).
2. Write its claim + argument here.
3. Add property tests in `test/invariant_test.js`.
4. File a tracking issue for the actual proof if the invariant
   justifies it (safety-critical, memory-bounded, termination).

## Status

| ID | Invariant | Tests | Proof |
|----|-----------|-------|-------|
| P1 | Mine chain terminates | ✅ 3 | ❌ none |
| P2 | Sopwith target never null | ✅ 1 | ❌ none |
| P3 | Ladder passenger released | ✅ 3 | ❌ none |
| P4 | Bouncing bomb expires | ✅ 1 | ❌ none |
| P5 | Signalling rooms bounded | ✅ 3 | ❌ none |
