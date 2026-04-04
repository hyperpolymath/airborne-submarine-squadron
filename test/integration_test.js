// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Jonathan D.A. Jewell (hyperpolymath)
//
// integration_test.js — Integration tests for Airborne Submarine Squadron.
// Tests game state transitions and interactions across multiple systems:
// - Game initialization (start → playing → game over)
// - Mission state machine (patrol → strike → hostage → escort)
// - Nemesis spawning and behavior
// - Hangar damage progression
// - Thermal layer transitions
// - Weapon system interactions (torpedoes, missiles, depth charges)
// - Hull integrity and crush mechanics
//
// Run with: deno test --allow-all test/integration_test.js
//
// Reference: standards/testing-and-benchmarking/TESTING-TAXONOMY.adoc §3

import { assertEquals, assert, assertGreater, assertLess } from "jsr:@std/assert";
import extract from "./_extract.js";

const { constants: C, functions: F } = extract;

// ── Game state machine simulation ───────────────────────────────────────────
//
// These tests verify that game state transitions are consistent and valid.
// They simulate the game loop without rendering.

class GameStateMachine {
  constructor() {
    this.state = {
      x: C.W / 2,
      y: C.WATER_LINE + 50,
      vx: 0,
      vy: 0,
      alive: true,
      hp: C.COMMANDER_HP,
      hpMax: C.COMMANDER_MAX_HP,
      ticks: 0,
      missionType: 'patrol',
      missionTimer: -1,
      missionProgress: 0,
      score: 0,
      nemesisSpawned: false,
      hangarDamage: 0,
      torpedoes: C.START_TORPEDOES,
      missiles: C.START_MISSILES,
      depthCharges: C.START_DEPTH_CHARGES,
      afterburnerCharge: 0,
      hull: 1.0,
      thermal: F.getThermalLayer(C.WATER_LINE + 50),
    };
  }

  tick(input = {}) {
    if (!this.state.alive) return;

    this.state.ticks++;

    // Apply thrust
    const thrust = input.thrust || 0;
    this.state.vx += thrust;

    // Apply gravity
    if (this.state.y > C.WATER_LINE) {
      this.state.vy += C.GRAVITY;
    }

    // Update position
    this.state.x += this.state.vx;
    this.state.y += this.state.vy;

    // Clamp to bounds
    this.state.x = Math.max(0, Math.min(C.W, this.state.x));
    this.state.y = Math.max(0, this.state.y);

    // Update thermal layer
    this.state.thermal = F.getThermalLayer(this.state.y);

    // Hull crush check (deep layer with low hull)
    if (this.state.thermal === 2 && this.state.hull < C.HULL_DEEP_CRUSH_THRESHOLD) {
      this.state.alive = false;
    }

    // Mission timer countdown
    if (this.state.missionTimer > 0) {
      this.state.missionTimer--;
      if (this.state.missionTimer === 0) {
        this.state.missionType = 'patrol';
      }
    }

    // Nemesis spawn check (simple heuristic: after 500 ticks in a mission)
    if (this.state.missionTimer > 0 && this.state.ticks > 500 && !this.state.nemesisSpawned) {
      this.state.nemesisSpawned = true;
    }
  }

  startMission(type, duration) {
    if (!this.state.alive) return false;
    this.state.missionType = type;
    this.state.missionTimer = duration;
    this.state.missionProgress = 0;
    return true;
  }

  takeDamage(amount) {
    if (this.state.hp > 0) {
      this.state.hp -= amount;
      if (this.state.hp <= 0) {
        this.state.alive = false;
      }
    }
  }

  takeSurfaceDamage(amount) {
    if (this.state.hull > 0) {
      this.state.hull -= amount;
      this.state.hangarDamage += Math.floor(amount * 100);
      if (this.state.hull < 0) this.state.hull = 0;
    }
  }

  fireWeapon(type) {
    if (!this.state.alive) return false;
    switch (type) {
      case 'torpedo':
        if (this.state.torpedoes > 0) {
          this.state.torpedoes--;
          return true;
        }
        break;
      case 'missile':
        if (this.state.missiles > 0) {
          this.state.missiles--;
          return true;
        }
        break;
      case 'depthcharge':
        if (this.state.depthCharges > 0) {
          this.state.depthCharges--;
          return true;
        }
        break;
    }
    return false;
  }

  isInDeepWater() {
    return this.state.thermal === 2;
  }

  canEnterDeepWater() {
    return this.state.hull >= C.HULL_DEEP_THRESHOLD;
  }
}

// ── Test: Game initialization ───────────────────────────────────────────────

Deno.test("integration: Game initializes in valid state", () => {
  const game = new GameStateMachine();
  assert(game.state.alive, "Game should start alive");
  assertEquals(game.state.hp, C.COMMANDER_HP, "Commander should have full HP");
  assertEquals(game.state.hull, 1.0, "Hull should be at 100%");
  assertEquals(game.state.missionType, "patrol", "Should start in patrol");
  assertEquals(game.state.ticks, 0, "Should start at tick 0");
  assertEquals(game.state.torpedoes, C.START_TORPEDOES);
  assertEquals(game.state.missiles, C.START_MISSILES);
  assertEquals(game.state.depthCharges, C.START_DEPTH_CHARGES);
});

// ── Test: State transitions ────────────────────────────────────────────────

Deno.test("integration: Patrol → Strike mission transition", () => {
  const game = new GameStateMachine();
  assertEquals(game.state.missionType, "patrol");

  const result = game.startMission("strike", 6000);
  assert(result, "Mission start should succeed");
  assertEquals(game.state.missionType, "strike");
  assertEquals(game.state.missionTimer, 6000);
  assertEquals(game.state.missionProgress, 0);
});

Deno.test("integration: Mission timer counts down and expires", () => {
  const game = new GameStateMachine();
  game.startMission("strike", 10);

  for (let i = 0; i < 11; i++) {
    game.tick();
  }

  assertEquals(game.state.missionTimer, 0, "Timer should be 0 after expiry");
  assertEquals(game.state.missionType, "patrol", "Should revert to patrol");
});

Deno.test("integration: Hostage rescue mission transition", () => {
  const game = new GameStateMachine();
  const result = game.startMission("hostage", 5400);

  assert(result);
  assertEquals(game.state.missionType, "hostage");
  assertGreater(game.state.missionTimer, 0);
});

Deno.test("integration: Escort mission transition", () => {
  const game = new GameStateMachine();
  const result = game.startMission("escort", 7200);

  assert(result);
  assertEquals(game.state.missionType, "escort");
  assertGreater(game.state.missionTimer, 0);
});

// ── Test: Nemesis spawning ─────────────────────────────────────────────────

Deno.test("integration: Nemesis doesn't spawn in patrol", () => {
  const game = new GameStateMachine();

  for (let i = 0; i < 1000; i++) {
    game.tick();
  }

  assertEquals(game.state.nemesisSpawned, false, "Nemesis should not spawn in patrol");
});

Deno.test("integration: Nemesis spawns after 500 ticks in active mission", () => {
  const game = new GameStateMachine();
  game.startMission("strike", 6000);

  for (let i = 0; i < 501; i++) {
    game.tick();
  }

  assert(game.state.nemesisSpawned, "Nemesis should spawn in active mission after 500+ ticks");
});

// ── Test: Hangar damage progression ─────────────────────────────────────────

Deno.test("integration: Hangar takes damage from surface hits", () => {
  const game = new GameStateMachine();
  const initialHull = game.state.hull;

  game.takeSurfaceDamage(0.1);

  assertLess(game.state.hull, initialHull, "Hull should decrease");
  assertGreater(game.state.hangarDamage, 0, "Hangar damage counter should increment");
});

Deno.test("integration: Cumulative hangar damage tracking", () => {
  const game = new GameStateMachine();

  game.takeSurfaceDamage(0.05);
  const damage1 = game.state.hangarDamage;

  game.takeSurfaceDamage(0.05);
  const damage2 = game.state.hangarDamage;

  assertGreater(damage2, damage1, "Hangar damage should accumulate");
});

// ── Test: Hull integrity mechanics ─────────────────────────────────────────

Deno.test("integration: Cannot enter deep water with low hull", () => {
  const game = new GameStateMachine();
  game.state.hull = C.HULL_DEEP_THRESHOLD - 0.05;

  assert(!game.canEnterDeepWater(), "Cannot enter deep with low hull");
});

Deno.test("integration: Can enter deep water with sufficient hull", () => {
  const game = new GameStateMachine();
  game.state.hull = C.HULL_DEEP_THRESHOLD + 0.05;

  assert(game.canEnterDeepWater(), "Can enter deep with sufficient hull");
});

Deno.test("integration: Hull crush ends game in deep layer", () => {
  const game = new GameStateMachine();
  game.state.y = C.THERMAL_LAYER_2_MAX + 50;  // Force to deep layer
  game.state.hull = C.HULL_DEEP_CRUSH_THRESHOLD - 0.05;

  game.tick();

  assertEquals(game.state.thermal, 2, "Should be in deep thermal layer");
  assertEquals(game.state.alive, false, "Game should end on crush");
});

// ── Test: Thermal layer transitions ────────────────────────────────────────

Deno.test("integration: Detect surface (air) layer", () => {
  const game = new GameStateMachine();
  game.state.y = 0;
  game.tick();

  assertEquals(game.state.thermal, -1, "Should detect air layer");
});

Deno.test("integration: Detect warm water layer", () => {
  const game = new GameStateMachine();
  game.state.y = C.WATER_LINE + 10;
  game.tick();

  assertEquals(game.state.thermal, 0, "Should detect warm layer");
});

Deno.test("integration: Detect thermocline layer", () => {
  const game = new GameStateMachine();
  game.state.y = C.THERMAL_LAYER_1_MAX + 50;
  game.tick();

  assertEquals(game.state.thermal, 1, "Should detect thermocline layer");
});

Deno.test("integration: Detect deep cold layer", () => {
  const game = new GameStateMachine();
  game.state.y = C.THERMAL_LAYER_2_MAX + 50;
  game.tick();

  assertEquals(game.state.thermal, 2, "Should detect deep layer");
});

// ── Test: Weapon systems ────────────────────────────────────────────────────

Deno.test("integration: Fire torpedo decrements counter", () => {
  const game = new GameStateMachine();
  const initialCount = game.state.torpedoes;

  const fired = game.fireWeapon("torpedo");

  assert(fired, "Should fire torpedo");
  assertEquals(game.state.torpedoes, initialCount - 1);
});

Deno.test("integration: Fire missile decrements counter", () => {
  const game = new GameStateMachine();
  const initialCount = game.state.missiles;

  const fired = game.fireWeapon("missile");

  assert(fired, "Should fire missile");
  assertEquals(game.state.missiles, initialCount - 1);
});

Deno.test("integration: Fire depth charge decrements counter", () => {
  const game = new GameStateMachine();
  const initialCount = game.state.depthCharges;

  const fired = game.fireWeapon("depthcharge");

  assert(fired, "Should fire depth charge");
  assertEquals(game.state.depthCharges, initialCount - 1);
});

Deno.test("integration: Cannot fire when out of ammo", () => {
  const game = new GameStateMachine();
  game.state.torpedoes = 0;

  const fired = game.fireWeapon("torpedo");

  assertEquals(fired, false, "Should not fire without ammo");
});

// ── Test: Combat damage ─────────────────────────────────────────────────────

Deno.test("integration: Take damage reduces HP", () => {
  const game = new GameStateMachine();
  const initialHP = game.state.hp;

  game.takeDamage(1);

  assertEquals(game.state.hp, initialHP - 1);
  assert(game.state.alive, "Game should still be alive");
});

Deno.test("integration: HP zero ends game", () => {
  const game = new GameStateMachine();
  game.state.hp = 1;

  game.takeDamage(1);

  assertEquals(game.state.hp, 0);
  assertEquals(game.state.alive, false, "Game should end at 0 HP");
});

Deno.test("integration: Cannot take damage when dead", () => {
  const game = new GameStateMachine();
  game.state.alive = false;
  game.state.hp = 0;

  game.takeDamage(1);

  assertEquals(game.state.hp, 0, "Dead game should not go negative");
});

// ── Test: Physics simulation ────────────────────────────────────────────────

Deno.test("integration: Gravity applies when underwater", () => {
  const game = new GameStateMachine();
  game.state.y = C.WATER_LINE + 50;
  game.state.vy = 0;

  game.tick();

  assertGreater(game.state.vy, 0, "Should have downward velocity from gravity");
});

Deno.test("integration: Thrust affects velocity", () => {
  const game = new GameStateMachine();
  game.state.vx = 0;

  game.tick({ thrust: 5 });

  assertEquals(game.state.vx, 5, "Thrust should add to velocity");
});

Deno.test("integration: Position updates from velocity", () => {
  const game = new GameStateMachine();
  const initialX = game.state.x;
  game.state.vx = 10;

  game.tick();

  assertEquals(game.state.x, initialX + 10, "Position should update from velocity");
});

Deno.test("integration: Position clamped to world bounds", () => {
  const game = new GameStateMachine();
  game.state.x = C.W + 100;

  game.tick();

  assertEquals(game.state.x, C.W, "X should be clamped to world width");
});

// ── Test: Multi-tick scenarios ──────────────────────────────────────────────

Deno.test("integration: 100-tick patrol run", () => {
  const game = new GameStateMachine();

  for (let i = 0; i < 100; i++) {
    game.tick({ thrust: 1 });
  }

  assert(game.state.alive, "Should survive 100 ticks in patrol");
  assertEquals(game.state.ticks, 100);
  assertGreater(game.state.x, 0, "Should have moved");
});

Deno.test("integration: Mission sequence: patrol → strike → patrol", () => {
  const game = new GameStateMachine();

  // Phase 1: Patrol
  for (let i = 0; i < 50; i++) game.tick();
  assertEquals(game.state.missionType, "patrol");

  // Phase 2: Start strike
  game.startMission("strike", 20);
  assertEquals(game.state.missionType, "strike");

  // Phase 3: Run mission
  for (let i = 0; i < 21; i++) game.tick();
  assertEquals(game.state.missionType, "patrol", "Should revert to patrol after strike");
});

// ── Test: Edge cases ────────────────────────────────────────────────────────

Deno.test("integration: Cannot start mission when dead", () => {
  const game = new GameStateMachine();
  game.state.alive = false;

  const result = game.startMission("strike", 100);

  assertEquals(result, false, "Dead game cannot start missions");
});

Deno.test("integration: Y position never goes negative", () => {
  const game = new GameStateMachine();
  game.state.y = 5;
  game.state.vy = -100;

  game.tick();

  assertGreater(game.state.y, -1, "Y should be non-negative");
});

Deno.test("integration: Multiple surface damage calls accumulate", () => {
  const game = new GameStateMachine();

  for (let i = 0; i < 5; i++) {
    game.takeSurfaceDamage(0.1);
  }

  assertLess(game.state.hull, 1.0, "Hull should decrease");
  assertGreater(game.state.hangarDamage, 0, "Hangar should accumulate damage");
});
