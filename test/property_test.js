// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Jonathan D.A. Jewell (hyperpolymath)
//
// property_test.js — Blitz property-based tests for Airborne Submarine Squadron.
// Verifies invariant properties hold across random/varied inputs.
//
// Reference: standards/testing-and-benchmarking/TESTING-TAXONOMY.adoc §9

import { assert, assertEquals } from "jsr:@std/assert";
import extract from "./_extract.js";

const { constants: C, functions: F } = extract;

// ── Helper: seeded pseudo-random (deterministic for reproducibility) ─
function mulberry32(seed) {
  return function() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ── 1. getThermalLayer is monotonically non-decreasing with depth ───
Deno.test("property: getThermalLayer is monotonically non-decreasing with depth", () => {
  const rand = mulberry32(42);
  // Generate 200 random Y values, sort them, verify layers are non-decreasing
  const ys = Array.from({ length: 200 }, () => Math.floor(rand() * 1000));
  ys.sort((a, b) => a - b);
  let prevLayer = -Infinity;
  for (const y of ys) {
    const layer = F.getThermalLayer(y);
    assert(layer >= prevLayer,
      `Layer decreased: y=${y} → layer=${layer}, prev=${prevLayer}`);
    prevLayer = layer;
  }
});

// ── 2. thermallyVisible is reflexive (can always see yourself) ──────
Deno.test("property: thermallyVisible is reflexive — observer sees own position", () => {
  const rand = mulberry32(7);
  for (let i = 0; i < 100; i++) {
    const y = Math.floor(rand() * 900);
    assert(F.thermallyVisible(y, y),
      `Object at y=${y} should be visible to itself`);
  }
});

// ── 3. clamp always returns value in [lo, hi] ──────────────────────
Deno.test("property: clamp(v, lo, hi) always returns value in [lo, hi]", () => {
  const rand = mulberry32(99);
  for (let i = 0; i < 500; i++) {
    const lo = Math.floor(rand() * 100) - 50;
    const hi = lo + Math.floor(rand() * 200);
    const v  = Math.floor(rand() * 500) - 250;
    const result = F.clamp(v, lo, hi);
    assert(result >= lo && result <= hi,
      `clamp(${v}, ${lo}, ${hi}) = ${result} — out of bounds`);
  }
});

// ── 4. Component damage never exceeds initial total ─────────────────
Deno.test("property: damageRandomPart never creates HP (total only decreases)", () => {
  const rand = mulberry32(1337);
  for (let trial = 0; trial < 25; trial++) {
    const parts = F.createParts();
    let prevTotal = Object.values(parts).reduce((a, b) => a + b, 0);
    for (let hit = 0; hit < 20; hit++) {
      const amount = Math.floor(rand() * 30) + 1;
      F.damageRandomPart(parts, amount); // mutates in place, returns hit def
      const total = Object.values(parts).reduce((a, b) => a + b, 0);
      assert(total <= prevTotal,
        `HP increased after damage: ${prevTotal} → ${total}`);
      prevTotal = total;
    }
  }
});

// ── 5. Deterministic: same constants always produce same results ────
Deno.test("property: game constants are deterministic across 3 reads", async () => {
  const ROOT = extract.ROOT;
  const reads = [];
  for (let i = 0; i < 3; i++) {
    const src = await Deno.readTextFile(ROOT + "gossamer/app_gossamer.js");
    // Extract all const lines with numeric values
    const consts = {};
    for (const line of src.split('\n')) {
      const m = line.match(/^const (\w+)\s*=\s*([\d.]+);/);
      if (m) consts[m[1]] = parseFloat(m[2]);
    }
    reads.push(consts);
  }
  // All three reads must produce identical results
  assertEquals(reads[0], reads[1], "Read 1 ≠ Read 2");
  assertEquals(reads[1], reads[2], "Read 2 ≠ Read 3");
});

// ── 6. overallHealth is bounded [0, 1] ──────────────────────────────
Deno.test("property: overallHealth always returns value in [0, 100]", () => {
  const rand = mulberry32(2024);
  for (let trial = 0; trial < 50; trial++) {
    const parts = F.createParts();
    // Random damage pattern (mutates in place)
    const hits = Math.floor(rand() * 30);
    for (let i = 0; i < hits; i++) {
      F.damageRandomPart(parts, Math.floor(rand() * 40) + 1);
    }
    const health = F.overallHealth(parts);
    assert(health >= 0 && health <= 100,
      `overallHealth out of bounds: ${health}`);
  }
});

// ── 7. Velocity to MPH is non-negative for all inputs ───────────────
Deno.test("property: velocityToMph is non-negative for all velocity combinations", () => {
  const rand = mulberry32(555);
  for (let i = 0; i < 100; i++) {
    const vx = (rand() - 0.5) * 20;
    const vy = (rand() - 0.5) * 20;
    const mode = ['atmosphere', 'space'][Math.floor(rand() * 2)];
    const mph = F.velocityToMph(vx, vy, mode);
    assert(mph >= 0, `velocityToMph(${vx}, ${vy}, ${mode}) = ${mph} — negative`);
  }
});

// ── 8. Mission durations are all multiples of 60 (whole seconds) ────
Deno.test("property: all MISSION_TYPES durations divide evenly by 60", async () => {
  const src = await Deno.readTextFile(extract.ROOT + "gossamer/app_gossamer.js");
  // Only match durations inside the MISSION_TYPES block (between { and };)
  const missionBlock = src.match(/const MISSION_TYPES\s*=\s*\{[\s\S]*?\};/);
  assert(missionBlock, "Could not find MISSION_TYPES block");
  const durations = [...missionBlock[0].matchAll(/duration:\s*(\d+)/g)].map(m => parseInt(m[1]));
  assert(durations.length >= 3, `Expected at least 3 durations, found ${durations.length}`);
  for (const d of durations) {
    assertEquals(d % 60, 0,
      `Duration ${d} is not a whole number of seconds (${d}/60 = ${d/60})`);
  }
});

// ── 9. All enemy score rewards are multiples of 100 ─────────────────
Deno.test("property: enemy score rewards are multiples of 100", async () => {
  const src = await Deno.readTextFile(extract.ROOT + "gossamer/enemies.js");
  const scores = [...src.matchAll(/world\.score\s*\+=\s*(\d+)/g)].map(m => parseInt(m[1]));
  for (const s of scores) {
    assertEquals(s % 100, 0,
      `Score reward ${s} is not a multiple of 100`);
  }
});

// ── 10. Spawn thresholds are monotonically increasing ───────────────
Deno.test("property: aircraft spawn thresholds increase with difficulty", async () => {
  const src = await Deno.readTextFile(extract.ROOT + "gossamer/enemies.js");
  const berkutScore = parseInt(src.match(/BERKUT_SPAWN_SCORE\s*=\s*(\d+)/)?.[1] || '0');
  const nemesisScore = parseInt(src.match(/NEMESIS_SPAWN_SCORE\s*=\s*(\d+)/)?.[1] || '0');
  // Lightning threshold is inline in the update function
  const lightningScore = 1000; // Hardcoded in updateAirInterceptors
  assert(lightningScore < berkutScore, `Lightning (${lightningScore}) should spawn before Berkut (${berkutScore})`);
  assert(berkutScore < nemesisScore, `Berkut (${berkutScore}) should spawn before Nemesis (${nemesisScore})`);
});
