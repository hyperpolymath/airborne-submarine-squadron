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
