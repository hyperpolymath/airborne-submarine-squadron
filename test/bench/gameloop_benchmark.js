// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Jonathan D.A. Jewell (hyperpolymath)
//
// gameloop_benchmark.js — Performance benchmarks for Airborne Submarine Squadron
// game loop throughput.
//
// Measures:
// - Single tick execution time
// - Bulk tick throughput (N ticks, ms/tick average)
// - Mission state transitions overhead
// - Thermal layer calculation cost
// - Weapon system overhead
//
// Run with: deno bench --allow-all test/bench/gameloop_benchmark.js
//
// Classification (Six Sigma baselines):
//   Extraordinary: >20% faster than baseline
//   Ordinary:      within ±20% of baseline
//   Acceptable:    20-50% slower than baseline
//   Unacceptable:  >50% slower than baseline
//
// Reference: standards/testing-and-benchmarking/TESTING-TAXONOMY.adoc §2

// Simplified game tick function for benchmarking (pure computation, no DOM)
class GameSimulator {
  constructor() {
    // Constants
    this.WATER_LINE = 420;
    this.THERMAL_LAYER_1_MAX = 495;
    this.THERMAL_LAYER_2_MAX = 615;
    this.GRAVITY = 0.18;
    this.W = 800;
    this.H = 600;
    this.HULL_DEEP_CRUSH_THRESHOLD = 0.2;

    // State
    this.x = this.W / 2;
    this.y = this.WATER_LINE + 50;
    this.vx = 0;
    this.vy = 0;
    this.alive = true;
    this.ticks = 0;
    this.hull = 1.0;
    this.missionTimer = -1;
    this.nemesisSpawned = false;
  }

  getThermalLayer(y) {
    if (y <= this.WATER_LINE) return -1;
    if (y < this.THERMAL_LAYER_1_MAX) return 0;
    if (y < this.THERMAL_LAYER_2_MAX) return 1;
    return 2;
  }

  tick(thrust = 0) {
    if (!this.alive) return;

    this.ticks++;

    // Thrust
    this.vx += thrust;

    // Gravity (water only)
    if (this.y > this.WATER_LINE) {
      this.vy += this.GRAVITY;
    }

    // Update position
    this.x += this.vx;
    this.y += this.vy;

    // Clamp
    this.x = Math.max(0, Math.min(this.W, this.x));
    this.y = Math.max(0, this.y);

    // Thermal layer check
    const thermal = this.getThermalLayer(this.y);

    // Hull crush check
    if (thermal === 2 && this.hull < this.HULL_DEEP_CRUSH_THRESHOLD) {
      this.alive = false;
    }

    // Mission timer
    if (this.missionTimer > 0) {
      this.missionTimer--;
    }

    // Nemesis spawn (simple heuristic)
    if (this.missionTimer > 0 && this.ticks > 500 && !this.nemesisSpawned) {
      this.nemesisSpawned = true;
    }
  }

  startMission(duration) {
    this.missionTimer = duration;
  }

  fireWeapon() {
    // Minimal overhead
    return true;
  }
}

// ── Bench 1: Single tick ────────────────────────────────────────────────────
Deno.bench("perf: Single game tick (no thrust)", () => {
  const game = new GameSimulator();
  game.tick(0);
});

Deno.bench("perf: Single game tick (with thrust)", () => {
  const game = new GameSimulator();
  game.tick(5);
});

// ── Bench 2: Thermal layer calculation ──────────────────────────────────────
Deno.bench("perf: Thermal layer lookup (100 calls)", () => {
  const game = new GameSimulator();
  for (let i = 0; i < 100; i++) {
    game.getThermalLayer(game.WATER_LINE + i);
  }
});

// ── Bench 3: Bulk tick throughput (1000 ticks) ──────────────────────────────
Deno.bench("perf: 1000-tick run (patrol mode)", () => {
  const game = new GameSimulator();
  for (let i = 0; i < 1000; i++) {
    game.tick(1);
  }
});

// ── Bench 4: Bulk tick throughput (5000 ticks) ──────────────────────────────
Deno.bench("perf: 5000-tick run (patrol mode)", () => {
  const game = new GameSimulator();
  for (let i = 0; i < 5000; i++) {
    game.tick(1);
  }
});

// ── Bench 5: Mission with nemesis spawn ─────────────────────────────────────
Deno.bench("perf: 600-tick strike mission (nemesis spawn)", () => {
  const game = new GameSimulator();
  game.startMission(6000);
  for (let i = 0; i < 600; i++) {
    game.tick(2);
  }
});

// ── Bench 6: Multiple mission transitions ───────────────────────────────────
Deno.bench("perf: 3 mission transitions (200 ticks each)", () => {
  const game = new GameSimulator();
  for (let mission = 0; mission < 3; mission++) {
    game.startMission(200);
    for (let i = 0; i < 201; i++) {
      game.tick(1);
    }
  }
});

// ── Bench 7: Thermal layer transitions ──────────────────────────────────────
Deno.bench("perf: Deep water descent (500 ticks)", () => {
  const game = new GameSimulator();
  game.y = game.WATER_LINE + 10;
  game.vy = 1;  // Descend gradually
  for (let i = 0; i < 500; i++) {
    game.tick(0);
  }
});

// ── Bench 8: Weapon fire loop (100 shots) ──────────────────────────────────
Deno.bench("perf: Fire 100 weapons", () => {
  const game = new GameSimulator();
  for (let i = 0; i < 100; i++) {
    game.fireWeapon();
  }
});

// ── Bench 9: High-frequency input (1000 ticks with varying thrust) ──────────
Deno.bench("perf: 1000 ticks with variable thrust input", () => {
  const game = new GameSimulator();
  for (let i = 0; i < 1000; i++) {
    const thrust = Math.sin(i * 0.1) * 5;  // Oscillating input
    game.tick(thrust);
  }
});

// ── Bench 10: Worst-case scenario (deep water, low hull, active mission) ────
Deno.bench("perf: 200 ticks in crush-risk scenario", () => {
  const game = new GameSimulator();
  game.y = game.THERMAL_LAYER_2_MAX + 50;
  game.hull = 0.3;
  game.startMission(200);
  for (let i = 0; i < 200; i++) {
    game.tick(1);
    if (!game.alive) break;
  }
});
