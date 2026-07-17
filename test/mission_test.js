// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Jonathan D.A. Jewell (hyperpolymath)
//
// mission_test.js — Tests for all mission types (strike, hostage, escort).
// Validates constants, MISSION_TYPES definition, and integration points.
//
// Reference: standards/testing-and-benchmarking/TESTING-TAXONOMY.adoc §1, §12

import { assert, assertEquals, assertNotEquals } from "jsr:@std/assert";

const ROOT = new URL('..', import.meta.url).pathname;

// ── Helper: extract constants from source ───────────────────────────
async function getMissionConstants() {
  const src = await Deno.readTextFile(ROOT + "gossamer/app_gossamer.js");
  const extract = (name) => {
    const m = src.match(new RegExp(`const ${name}\\s*=\\s*([^;]+);`));
    return m ? m[1].trim() : null;
  };
  return { src, extract };
}

// ── 1. MISSION_TYPES has all 4 types ────────────────────────────────
Deno.test("mission: MISSION_TYPES defines patrol, strike, hostage, escort", async () => {
  const { src } = await getMissionConstants();
  assert(src.includes("patrol:"), "Missing patrol mission type");
  assert(src.includes("strike:"), "Missing strike mission type");
  assert(src.includes("hostage:"), "Missing hostage mission type");
  assert(src.includes("escort:"), "Missing escort mission type");
});

// ── 2. Strike has kill target ───────────────────────────────────────
Deno.test("mission: strike type has killTarget defined", async () => {
  const { src } = await getMissionConstants();
  assert(src.includes("killTarget:"), "Strike must define killTarget");
  const m = src.match(/strike:\s*\{[^}]*killTarget:\s*(\d+)/);
  assert(m, "Could not parse killTarget");
  const target = parseInt(m[1]);
  assert(target >= 3 && target <= 20, `killTarget ${target} should be 3-20`);
});

// ── 3. Hostage has hostageCount ─────────────────────────────────────
Deno.test("mission: hostage type has hostageCount defined", async () => {
  const { src } = await getMissionConstants();
  assert(src.includes("hostageCount:"), "Hostage must define hostageCount");
  const m = src.match(/hostage:\s*\{[^}]*hostageCount:\s*(\d+)/);
  assert(m, "Could not parse hostageCount");
  const count = parseInt(m[1]);
  assert(count >= 1 && count <= 10, `hostageCount ${count} should be 1-10`);
});

// ── 4. Escort is mandatory ──────────────────────────────────────────
Deno.test("mission: escort type is mandatory", async () => {
  const { src } = await getMissionConstants();
  const escortDef = src.match(/escort:\s*\{[^}]+\}/);
  assert(escortDef, "Could not find escort definition");
  assert(escortDef[0].includes("mandatory: true"), "Escort must be mandatory");
});

// ── 5. Hostage is mandatory ─────────────────────────────────────────
Deno.test("mission: hostage type is mandatory", async () => {
  const { src } = await getMissionConstants();
  const hostageDef = src.match(/hostage:\s*\{[^}]+\}/);
  assert(hostageDef, "Could not find hostage definition");
  assert(hostageDef[0].includes("mandatory: true"), "Hostage must be mandatory");
});

// ── 6. All timed missions have positive durations ───────────────────
Deno.test("mission: all timed missions have duration > 0", async () => {
  const { src } = await getMissionConstants();
  const durations = [...src.matchAll(/duration:\s*(\d+)/g)];
  assert(durations.length >= 3, "Expected at least 3 timed missions");
  for (const m of durations) {
    const d = parseInt(m[1]);
    assert(d > 0, `Duration must be positive, got ${d}`);
    assert(d >= 1800, `Duration ${d} ticks (${Math.round(d/60)}s) seems too short`);
  }
});

// ── 7. Mission bonus constants exist ────────────────────────────────
Deno.test("mission: bonus constants are defined and positive", async () => {
  const { extract } = await getMissionConstants();
  const strikeBonus = extract('STRIKE_COMPLETE_BONUS');
  const escortBonus = extract('ESCORT_COMPLETE_BONUS');
  const strikeKill = extract('STRIKE_KILL_BONUS');
  const hostageBonus = extract('HOSTAGE_SCORE_BONUS');
  assert(strikeBonus && parseInt(strikeBonus) > 0, "STRIKE_COMPLETE_BONUS must be positive");
  assert(escortBonus && parseInt(escortBonus) > 0, "ESCORT_COMPLETE_BONUS must be positive");
  assert(strikeKill && parseInt(strikeKill) > 0, "STRIKE_KILL_BONUS must be positive");
  assert(hostageBonus && parseInt(hostageBonus) > 0, "HOSTAGE_SCORE_BONUS must be positive");
});

// ── 8. startMission function handles all types ──────────────────────
Deno.test("mission: startMission handles strike setup", async () => {
  const { src } = await getMissionConstants();
  assert(src.includes("typeKey === 'strike'"), "startMission must handle strike");
  assert(src.includes("_lastKnownKills"), "Strike must track kill baseline");
});

// ── 9. startMission function handles escort setup ───────────────────
Deno.test("mission: startMission handles escort setup", async () => {
  const { src } = await getMissionConstants();
  assert(src.includes("typeKey === 'escort'"), "startMission must handle escort");
  assert(src.includes("passengerShip"), "Escort must reference passenger ship");
});

// ── 10. VeriSimDB mission recording wired ───────────────────────────
Deno.test("mission: verisimdbRecordMission is called on completion/failure", async () => {
  const { src } = await getMissionConstants();
  const calls = (src.match(/verisimdbRecordMission/g) || []).length;
  assert(calls >= 4, `Expected at least 4 verisimdbRecordMission calls, found ${calls}`);
});

// ── 11. Mission cycle key (M) is wired ──────────────────────────────
Deno.test("mission: M key cycles through mission types", async () => {
  const { src } = await getMissionConstants();
  assert(src.includes("missionCycle"), "Must have mission cycle array");
  assert(src.includes("'strike'") && src.includes("'hostage'") && src.includes("'escort'"),
    "Cycle must include all 3 mission types");
});

// ── 12. Hostage rescue range constant exists ────────────────────────
Deno.test("mission: HOSTAGE_RESCUE_RANGE is defined and reasonable", async () => {
  const { extract } = await getMissionConstants();
  const range = extract('HOSTAGE_RESCUE_RANGE');
  assert(range, "HOSTAGE_RESCUE_RANGE must be defined");
  const val = parseInt(range);
  assert(val >= 30 && val <= 150, `Rescue range ${val} should be 30-150`);
});
