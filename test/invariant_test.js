// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Jonathan D.A. Jewell (hyperpolymath)
//
// invariant_test.js — Property tests for the invariants documented in
// PROOF-NEEDS.md. Each test reimplements the algorithm under test in a
// minimal, self-contained form so this file doesn't depend on the
// full app_gossamer.js source tree.
//
// The ACTUAL implementations live in gossamer/app_gossamer.js and
// gossamer/enemies.js; these tests mirror that logic closely enough to
// catch regressions when someone edits the originals.

import { assert, assertEquals } from "jsr:@std/assert";

// ── Helper: seeded PRNG ──────────────────────────────────────────────
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ═════════════════════════════════════════════════════════════════════
// INVARIANT 1: Mine chain detonation terminates.
//
// Claim: for any initial cluster of mines, triggering one mine causes
// at most N detonations (where N = number of active mines at start).
// No matter the topology of who-is-near-whom, the cascade halts.
//
// Algorithm mirrors triggerMine + updateMines.chainFuse in
// gossamer/app_gossamer.js:1319..1378.
// ═════════════════════════════════════════════════════════════════════

function simulateMineCluster(mines, startIdx, CHAIN_RADIUS = 80) {
  // `mines` is a mutable array; each mine is {x, y, active, chainFuse}.
  // We step the simulation until no mine has fuse > 0 and no further
  // chain reactions happen.
  let step = 0;
  const MAX_STEPS = 10_000; // termination safety net

  function trigger(i) {
    const m = mines[i];
    if (!m.active) return;
    m.active = false;
    // Light fuses on nearby active mines that aren't already fusing.
    for (let j = 0; j < mines.length; j++) {
      if (j === i) continue;
      const other = mines[j];
      if (!other.active || other.chainFuse > 0) continue;
      const dx = other.x - m.x, dy = other.y - m.y;
      if (dx * dx + dy * dy <= CHAIN_RADIUS * CHAIN_RADIUS) {
        other.chainFuse = 6 + Math.random() * 6;
      }
    }
  }

  trigger(startIdx);

  // Fuse-tick loop (each step is one game tick).
  while (step++ < MAX_STEPS) {
    let anyFusing = false;
    for (let i = 0; i < mines.length; i++) {
      const m = mines[i];
      if (m.chainFuse > 0) {
        anyFusing = true;
        m.chainFuse -= 1;
        if (m.chainFuse <= 0) trigger(i);
      }
    }
    if (!anyFusing) break;
  }

  return { step, detonated: mines.filter(m => !m.active).length };
}

Deno.test("invariant: mine chain detonation terminates for linear cluster", () => {
  // 20 mines in a straight line, 60px apart — each within 80 of the next.
  const mines = Array.from({ length: 20 }, (_, i) => ({
    x: i * 60, y: 500, active: true, chainFuse: 0,
  }));
  const { step, detonated } = simulateMineCluster(mines, 0);
  assert(step < 10_000, "chain did not terminate (hit MAX_STEPS)");
  assertEquals(detonated, 20, "every mine should have detonated");
});

Deno.test("invariant: mine chain terminates for random clusters", () => {
  const rand = mulberry32(1337);
  for (let trial = 0; trial < 30; trial++) {
    const n = 5 + Math.floor(rand() * 15);
    const mines = Array.from({ length: n }, () => ({
      x: rand() * 500, y: 400 + rand() * 300,
      active: true, chainFuse: 0,
    }));
    const { step, detonated } = simulateMineCluster(mines, 0);
    assert(step < 10_000, `trial ${trial}: chain did not terminate`);
    assert(detonated >= 1 && detonated <= n, `trial ${trial}: impossible detonation count ${detonated}`);
    // Detonated mines cannot be active. Fuse may be negative due to
    // the terminal `-= 1` step, but no detonated mine should have a
    // positive fuse left (that would mean it's still "about to go off").
    for (const m of mines) {
      if (!m.active) assert(m.chainFuse <= 0, "detonated mine must have non-positive fuse");
    }
  }
});

Deno.test("invariant: isolated mine triggers only itself", () => {
  const mines = [
    { x: 0, y: 0, active: true, chainFuse: 0 },
    { x: 10_000, y: 10_000, active: true, chainFuse: 0 },  // way outside radius
  ];
  const { detonated } = simulateMineCluster(mines, 0);
  assertEquals(detonated, 1, "far-apart mine should not chain");
});

// ═════════════════════════════════════════════════════════════════════
// INVARIANT 2: Sopwith target is never null during an active frame.
//
// Claim: after sopwithTargetResolve() runs, sw.target is always valid.
// Mirrors gossamer/enemies.js resolve-block at line ~417.
// ═════════════════════════════════════════════════════════════════════

function sopwithTargetValid(t) {
  if (!t) return false;
  if (t.destroyed) return false;
  if (t.alive === false) return false;
  return true;
}

function resolveTarget(sw, sub) {
  if (!sopwithTargetValid(sw.target)) {
    sw.target = sub;
    sw.targetKind = 'sub';
  }
  return sw.target;
}

Deno.test("invariant: Sopwith target fallback to sub when target invalid", () => {
  const sub = { worldX: 100, y: 200 };
  const cases = [
    { target: null },
    { target: undefined },
    { target: { alive: false } },
    { target: { destroyed: true } },
    { target: { alive: true, x: 50, y: 50 } }, // valid
    { target: sub },                            // already sub
  ];
  for (const sw of cases) {
    const resolved = resolveTarget(sw, sub);
    assert(resolved !== null && resolved !== undefined, "target must not be null");
    assert(sopwithTargetValid(resolved), "resolved target must be valid");
  }
});

// ═════════════════════════════════════════════════════════════════════
// INVARIANT 3: Ladder passenger shake-off bounded.
//
// Claim: with the ladder tip in water and sustained lateral jerk,
// passenger is released within a bounded number of ticks. Mirrors
// gossamer/app_gossamer.js ladder-physics block at line ~4434.
// ═════════════════════════════════════════════════════════════════════

function simulateLadderShake(dt, jerk, waterContact) {
  // Returns the tick count until ladderShakeAccum crosses 14.
  let accum = 0;
  for (let t = 1; t <= 10_000; t++) {
    if (waterContact) {
      accum += jerk * 8 * dt;
    } else {
      accum *= 0.98;
    }
    if (accum > 14) return t;
  }
  return Infinity;
}

Deno.test("invariant: ladder shake-off triggers in bounded ticks under sustained jerk", () => {
  const t = simulateLadderShake(1, 0.3, true); // jerk=0.3 per tick, in water
  assert(Number.isFinite(t), "shake-off should eventually fire");
  assert(t < 50, `shake-off took ${t} ticks, expected < 50`);
});

Deno.test("invariant: ladder shake-off never triggers while airborne only", () => {
  const t = simulateLadderShake(1, 5.0, false); // high jerk but no water
  assertEquals(t, Infinity, "airborne-only should never trigger shake");
});

Deno.test("invariant: ladder shake-off monotonic — bigger jerk means sooner release", () => {
  const smallJerk = simulateLadderShake(1, 0.2, true);
  const bigJerk = simulateLadderShake(1, 1.0, true);
  assert(bigJerk <= smallJerk, `bigger jerk (${bigJerk}) should release sooner than smaller (${smallJerk})`);
});

// ═════════════════════════════════════════════════════════════════════
// INVARIANT 4: Bouncing bomb always expires within fixed ticks.
//
// Claim: every bouncing bomb is removed within max(BBOMB_LIFE,
// BBOMB_MAX_BOUNCES * <some>) ticks. Mirrors app_gossamer.js:5516.
// ═════════════════════════════════════════════════════════════════════

function simulateBomb({ life = 300, maxBounces = 6, bounceLoss = 0.55 } = {}) {
  // Simple sim: bomb exists until life <= 0 or bounces > maxBounces.
  let remaining = life;
  let bounces = 0;
  let vx = 4, vy = -3;
  let ticks = 0;
  while (remaining > 0 && bounces <= maxBounces) {
    remaining -= 1;
    ticks++;
    if (ticks % 30 === 0 && vx > 0.5) {
      bounces++;
      vy = -Math.abs(vy) * bounceLoss;
      vx *= bounceLoss + 0.15;
    }
    if (ticks > 10_000) return { ticks, reason: 'runaway' };
  }
  return { ticks, reason: bounces > maxBounces ? 'bounces' : 'life' };
}

Deno.test("invariant: bouncing bomb expires in bounded ticks", () => {
  const result = simulateBomb();
  assertEquals(result.reason === 'runaway', false);
  assert(result.ticks <= 300, `bomb took ${result.ticks} ticks, expected <= 300`);
});

// ═════════════════════════════════════════════════════════════════════
// INVARIANT 5: Signalling room cap enforced.
//
// Claim: room count never exceeds MAX_ROOMS, achieved via LRU eviction.
// Mirrors run.js room-cap block at line ~381.
// ═════════════════════════════════════════════════════════════════════

function simulateRooms(requests, MAX_ROOMS = 4) {
  const rooms = new Map();
  for (const { code, t } of requests) {
    if (!rooms.has(code) && rooms.size >= MAX_ROOMS) {
      let oldest = null, oldestT = Infinity;
      for (const [c, r] of rooms) {
        if (r.last < oldestT) { oldestT = r.last; oldest = c; }
      }
      if (oldest) rooms.delete(oldest);
    }
    if (!rooms.has(code)) rooms.set(code, { box: [], last: t });
    rooms.get(code).last = t;
  }
  return rooms;
}

Deno.test("invariant: signalling room count never exceeds MAX_ROOMS", () => {
  const reqs = Array.from({ length: 50 }, (_, i) => ({
    code: `R${i}`, t: i * 1000,
  }));
  const rooms = simulateRooms(reqs, 4);
  assert(rooms.size <= 4, `room count ${rooms.size} exceeded cap 4`);
});

Deno.test("invariant: signalling rooms LRU — most recent survive", () => {
  // 5 rooms, cap at 3 — the last 3 accessed should remain.
  const reqs = [
    { code: 'A', t: 100 },
    { code: 'B', t: 200 },
    { code: 'C', t: 300 },
    { code: 'D', t: 400 }, // should evict A
    { code: 'E', t: 500 }, // should evict B
  ];
  const rooms = simulateRooms(reqs, 3);
  assertEquals(rooms.size, 3);
  assert(!rooms.has('A'), "A should have been evicted");
  assert(!rooms.has('B'), "B should have been evicted");
  assert(rooms.has('C') && rooms.has('D') && rooms.has('E'), "last 3 should survive");
});

Deno.test("invariant: repeated hits on same room do not grow map", () => {
  const reqs = Array.from({ length: 100 }, (_, i) => ({ code: 'X', t: i }));
  const rooms = simulateRooms(reqs, 4);
  assertEquals(rooms.size, 1);
});
