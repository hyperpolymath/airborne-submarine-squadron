// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Jonathan D.A. Jewell (hyperpolymath)
//
// unit_test.js — Blitz unit tests for Airborne Submarine Squadron.
// Tests pure game logic functions extracted from app_gossamer.js.
//
// Reference: standards/testing-and-benchmarking/TESTING-TAXONOMY.adoc §1

import { assertEquals, assert, assertNotEquals } from "jsr:@std/assert";
import extract from "./_extract.js";

const { constants: C, functions: F } = extract;

// ── Thermal layer system ────────────────────────────────────────────

Deno.test("unit: getThermalLayer returns -1 above water", () => {
  assertEquals(F.getThermalLayer(0), -1);
  assertEquals(F.getThermalLayer(C.WATER_LINE - 1), -1);
  assertEquals(F.getThermalLayer(C.WATER_LINE), -1);
});

Deno.test("unit: getThermalLayer returns 0 in warm layer", () => {
  assertEquals(F.getThermalLayer(C.WATER_LINE + 1), 0);
  assertEquals(F.getThermalLayer(C.THERMAL_LAYER_1_MAX - 1), 0);
});

Deno.test("unit: getThermalLayer returns 1 in thermocline", () => {
  assertEquals(F.getThermalLayer(C.THERMAL_LAYER_1_MAX), 1);
  assertEquals(F.getThermalLayer(C.THERMAL_LAYER_2_MAX - 1), 1);
});

Deno.test("unit: getThermalLayer returns 2 in deep cold", () => {
  assertEquals(F.getThermalLayer(C.THERMAL_LAYER_2_MAX), 2);
  assertEquals(F.getThermalLayer(C.THERMAL_LAYER_2_MAX + 100), 2);
});

// ── Thermal visibility ──────────────────────────────────────────────

Deno.test("unit: thermallyVisible — air sees all water layers", () => {
  const airY = 100;
  assert(F.thermallyVisible(airY, C.WATER_LINE + 10));   // warm
  assert(F.thermallyVisible(airY, C.THERMAL_LAYER_1_MAX + 10)); // thermocline
  assert(F.thermallyVisible(airY, C.THERMAL_LAYER_2_MAX + 10)); // deep
});

Deno.test("unit: thermallyVisible — same layer always visible", () => {
  const warmY = C.WATER_LINE + 10;
  assert(F.thermallyVisible(warmY, warmY + 5));
});

Deno.test("unit: thermallyVisible — warm cannot see deep (2 layers apart)", () => {
  const warmY = C.WATER_LINE + 10;
  const deepY = C.THERMAL_LAYER_2_MAX + 10;
  assertEquals(F.thermallyVisible(warmY, deepY), false);
  assertEquals(F.thermallyVisible(deepY, warmY), false);
});

Deno.test("unit: thermallyVisible — adjacent layers visible", () => {
  const warmY = C.WATER_LINE + 10;
  const thermoY = C.THERMAL_LAYER_1_MAX + 10;
  assert(F.thermallyVisible(warmY, thermoY));
  assert(F.thermallyVisible(thermoY, warmY));
});

// ── Thermal silhouette ──────────────────────────────────────────────

Deno.test("unit: thermalSilhouette — thermocline sees warm as silhouette", () => {
  const thermoY = C.THERMAL_LAYER_1_MAX + 10;
  const warmY = C.WATER_LINE + 10;
  assert(F.thermalSilhouette(thermoY, warmY));
});

Deno.test("unit: thermalSilhouette — air never silhouette", () => {
  assertEquals(F.thermalSilhouette(100, C.WATER_LINE + 10), false);
  assertEquals(F.thermalSilhouette(C.WATER_LINE + 10, 100), false);
});

// ── Clamp ───────────────────────────────────────────────────────────

Deno.test("unit: clamp — value within range unchanged", () => {
  assertEquals(F.clamp(5, 0, 10), 5);
});

Deno.test("unit: clamp — value below range clamped to lo", () => {
  assertEquals(F.clamp(-5, 0, 10), 0);
});

Deno.test("unit: clamp — value above range clamped to hi", () => {
  assertEquals(F.clamp(15, 0, 10), 10);
});

Deno.test("unit: clamp — boundary values", () => {
  assertEquals(F.clamp(0, 0, 10), 0);
  assertEquals(F.clamp(10, 0, 10), 10);
});

// ── Component damage system ─────────────────────────────────────────

Deno.test("unit: createParts — all parts initialised to max", () => {
  const parts = F.createParts();
  assert(parts.nose > 0,   "nose must be positive");
  assert(parts.hull > 0,   "hull must be positive");
  assert(parts.tower > 0,  "tower must be positive");
  assert(parts.engine > 0, "engine must be positive");
  assert(parts.wings > 0,  "wings must be positive");
  assert(parts.rudder > 0, "rudder must be positive");
});

Deno.test("unit: overallHealth — full parts = 100", () => {
  const parts = F.createParts();
  const health = F.overallHealth(parts);
  // Returns percentage (0-100), not fraction (0-1)
  assertEquals(health, 100);
});

Deno.test("unit: damageRandomPart — mutates parts in place, reduces HP", () => {
  // damageRandomPart modifies the object in place and returns the
  // part definition that was hit (or null if all destroyed).
  const parts = F.createParts();
  const beforeTotal = Object.values(parts).reduce((a, b) => a + b, 0);
  const hitDef = F.damageRandomPart(parts, 10);
  assert(hitDef !== null, "Should hit a part when all parts have HP");
  const afterTotal = Object.values(parts).reduce((a, b) => a + b, 0);
  assert(afterTotal < beforeTotal, "Total HP must decrease after damage");
});

Deno.test("unit: damageRandomPart — no part goes below zero", () => {
  const parts = F.createParts();
  // Apply massive damage repeatedly (function mutates in place)
  for (let i = 0; i < 100; i++) {
    F.damageRandomPart(parts, 50);
  }
  for (const [name, val] of Object.entries(parts)) {
    assert(val >= 0, `Part ${name} went below zero: ${val}`);
  }
});

// ── Speed/thrust multipliers ────────────────────────────────────────

Deno.test("unit: getSpeedMult — full health parts = 1", () => {
  const parts = F.createParts();
  assertEquals(F.getSpeedMult(parts), 1);
});

Deno.test("unit: getThrustMult — wings at 0 halves thrust", () => {
  const parts = F.createParts();
  assertEquals(F.getThrustMult(parts), 1);
  parts.wings = 0;
  assertEquals(F.getThrustMult(parts), 0.5);
});

Deno.test("unit: getTurnMult — rudder at 0 reduces turning", () => {
  const parts = F.createParts();
  assertEquals(F.getTurnMult(parts), 1);
  parts.rudder = 0;
  assertEquals(F.getTurnMult(parts), 0.3);
});

// ── Weapon availability ─────────────────────────────────────────────

Deno.test("unit: canFireTorpedo — nose >20 required", () => {
  const parts = F.createParts();
  assert(F.canFireTorpedo(parts), "Should fire with full nose");
  parts.nose = 20;
  assertEquals(F.canFireTorpedo(parts), false, "Should not fire at nose=20");
  parts.nose = 21;
  assert(F.canFireTorpedo(parts), "Should fire at nose=21");
});

// ── Part criticality checks ─────────────────────────────────────────

Deno.test("unit: isPartCritical — full health is not critical", () => {
  const parts = F.createParts();
  assertEquals(F.isPartCritical(parts, 'hull'), false);
  assertEquals(F.isPartCritical(parts, 'engine'), false);
});

Deno.test("unit: isPartRed — full health is not red", () => {
  const parts = F.createParts();
  assertEquals(F.isPartRed(parts, 'hull'), false);
});

// ── Commander HP labels ─────────────────────────────────────────────

Deno.test("unit: commanderStatusLabel — 3 HP = OK", () => {
  const label = F.commanderStatusLabel(3);
  assert(typeof label === 'string' && label.length > 0,
    "Must return a non-empty label");
});

Deno.test("unit: commanderStatusLabel — 0 HP = dead/critical", () => {
  const label = F.commanderStatusLabel(0);
  assert(typeof label === 'string' && label.length > 0);
});

// ── Velocity conversion ─────────────────────────────────────────────

Deno.test("unit: velocityToMph — zero velocity = 0 mph", () => {
  const mph = F.velocityToMph(0, 0, 'atmosphere');
  assertEquals(mph, 0);
});

Deno.test("unit: velocityToMph — positive velocity gives positive mph", () => {
  const mph = F.velocityToMph(5, 0, 'atmosphere');
  assert(mph > 0, `Expected positive mph, got ${mph}`);
});

// ── persist.js — keyLabel ────────────────────────────────────────────────────

Deno.test("unit: keyLabel — spacebar maps to 'Space'", () => {
  assertEquals(F.keyLabel(' '), 'Space');
});

Deno.test("unit: keyLabel — 'AltGraph' maps to 'AltGr'", () => {
  assertEquals(F.keyLabel('AltGraph'), 'AltGr');
});

Deno.test("unit: keyLabel — 'Control' maps to 'Ctrl'", () => {
  assertEquals(F.keyLabel('Control'), 'Ctrl');
});

Deno.test("unit: keyLabel — arrow keys map to short names", () => {
  assertEquals(F.keyLabel('ArrowUp'),    'Up');
  assertEquals(F.keyLabel('ArrowDown'),  'Down');
  assertEquals(F.keyLabel('ArrowLeft'),  'Left');
  assertEquals(F.keyLabel('ArrowRight'), 'Right');
});

Deno.test("unit: keyLabel — single character is uppercased", () => {
  assertEquals(F.keyLabel('a'), 'A');
  assertEquals(F.keyLabel('z'), 'Z');
});

Deno.test("unit: keyLabel — multi-char non-arrow key returned as-is", () => {
  assertEquals(F.keyLabel('Escape'), 'Escape');
  assertEquals(F.keyLabel('Shift'),  'Shift');
});

// ── persist.js — currentSubSkin ──────────────────────────────────────────────

Deno.test("unit: currentSubSkin — 'ocean' id returns ocean skin", () => {
  const skin = F.currentSubSkin({ subSkin: 'ocean' });
  assertEquals(skin.id, 'ocean');
  assert(typeof skin.hull === 'string', 'hull must be a string');
});

Deno.test("unit: currentSubSkin — unknown id falls back to first skin", () => {
  const skin = F.currentSubSkin({ subSkin: 'nonexistent' });
  assertEquals(skin.id, 'ocean');
});

Deno.test("unit: currentSubSkin — each known id resolves to itself", () => {
  const ids = ['ocean', 'red', 'amber', 'emerald', 'violet', 'spectrum', 'rainbow', 'pride'];
  for (const id of ids) {
    const skin = F.currentSubSkin({ subSkin: id });
    assertEquals(skin.id, id, `id '${id}' should resolve to itself`);
  }
});

// ── persist.js — getSupplyFrequency ──────────────────────────────────────────

Deno.test("unit: getSupplyFrequency — 'normal' resolves correctly", () => {
  const level = F.getSupplyFrequency({ supplyFrequency: 'normal' });
  assertEquals(level.id, 'normal');
  assert(isFinite(level.interval), 'normal interval must be finite');
});

Deno.test("unit: getSupplyFrequency — 'none' has Infinity interval", () => {
  const level = F.getSupplyFrequency({ supplyFrequency: 'none' });
  assertEquals(level.interval, Infinity);
});

Deno.test("unit: getSupplyFrequency — 'unlimited' has Infinity interval", () => {
  const level = F.getSupplyFrequency({ supplyFrequency: 'unlimited' });
  assertEquals(level.interval, Infinity);
});

Deno.test("unit: getSupplyFrequency — unknown id falls back to 'normal'", () => {
  const level = F.getSupplyFrequency({ supplyFrequency: 'bogus' });
  assertEquals(level.id, 'normal');
});

Deno.test("unit: getSupplyFrequency — 'few' interval greater than 'many'", () => {
  const few  = F.getSupplyFrequency({ supplyFrequency: 'few' });
  const many = F.getSupplyFrequency({ supplyFrequency: 'many' });
  assert(few.interval > many.interval, 'fewer crates = larger interval multiplier');
});

// ── terrain.js — groundYFromTerrain ─────────────────────────────────────────

Deno.test("unit: groundYFromTerrain — negative worldX returns SEA_FLOOR", () => {
  const terrain = { ground: [{ x: 0, y: 400 }, { x: 4, y: 500 }] };
  assertEquals(F.groundYFromTerrain(terrain, -1), C.SEA_FLOOR);
});

Deno.test("unit: groundYFromTerrain — worldX past end returns SEA_FLOOR", () => {
  const terrain = { ground: [{ x: 0, y: 400 }, { x: 4, y: 500 }] };
  // With 2 points, idx must be < 1 (length-1). worldX=8 → idx=2 which is >= 1.
  assertEquals(F.groundYFromTerrain(terrain, 8), C.SEA_FLOOR);
});

Deno.test("unit: groundYFromTerrain — interpolates at midpoint", () => {
  const terrain = { ground: [{ x: 0, y: 400 }, { x: 4, y: 500 }] };
  // worldX=2 → idx=0, frac=0.5, expected = 400 + (500-400)*0.5 = 450
  assertEquals(F.groundYFromTerrain(terrain, 2), 450);
});

Deno.test("unit: groundYFromTerrain — returns first point y at worldX=0", () => {
  const terrain = { ground: [{ x: 0, y: 350 }, { x: 4, y: 600 }] };
  assertEquals(F.groundYFromTerrain(terrain, 0), 350);
});

Deno.test("unit: groundYFromTerrain — result is between endpoints for interior worldX", () => {
  const terrain = { ground: [{ x: 0, y: 400 }, { x: 4, y: 500 }, { x: 8, y: 600 }] };
  const y = F.groundYFromTerrain(terrain, 3);
  assert(y >= 400 && y <= 500, `Expected y between 400 and 500, got ${y}`);
});
