// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Jonathan D.A. Jewell (hyperpolymath)
//
// _extract.js — exposes the engine's pure functions and constants to unit tests.
//
// The Deno-era version regex-extracted function text out of the source and
// re-evaluated it in a stub sandbox (`world = null`, fake SFX): it broke every time
// a helper grew a dependency (e.g. simRand).  This version boots the REAL engine
// headlessly (test/harness/headless.js) and reads the real bindings, so unit tests
// exercise the code the game actually runs.

import { readFileSync } from "node:fs";
import { createGame, ROOT as _ROOT } from "./harness/headless.js";

const ROOT = _ROOT + "/";
const FILES = ["controls.js", "app_gossamer.js", "weapons.js", "orbital.js", "persist.js", "terrain.js"];
const SRC = FILES.map((f) => readFileSync(`${ROOT}gossamer/${f}`, "utf8")).join("\n");

const game = await createGame({ instrument: false, gameSeed: 1 });

export const CONST_NAMES = [
  "WATER_LINE", "THERMAL_LAYER_1_MAX", "THERMAL_LAYER_2_MAX", "GRAVITY", "THRUST", "MAX_SPEED", "GROUND_BASE", "SEA_FLOOR",
  "HULL_DEEP_THRESHOLD", "HULL_DEEP_CRUSH_THRESHOLD", "COMMANDER_HP", "COMMANDER_MAX_HP", "W", "H", "TERRAIN_LENGTH",
  "START_TORPEDOES", "START_MISSILES", "START_DEPTH_CHARGES", "MPH_PER_GAME_SPEED", "SPACE_MPH_PER_GAME_SPEED",
  "ORBIT_TRIGGER_SPEED_MPH", "SPEEDOMETER_MAX_MPH", "CATERPILLAR_SPEED_MULT", "FIRE_COOLDOWN", "TORPEDO_SPEED", "MISSILE_SPEED",
  "BUOYANCY", "SURFACE_DAMPING", "WATER_DRAG", "AFTERBURNER_MAX_CHARGE", "AFTERBURNER_DRAIN", "AFTERBURNER_RECHARGE",
  "MINE_COUNT", "MINE_RADIUS", "MINE_DAMAGE", "CHAFF_COOLDOWN", "CHAFF_LIFESPAN", "CHAFF_RADIUS",
  "DEPTH_CHARGE_BLAST_RADIUS", "DEPTH_CHARGE_LIFE", "EJECT_PRIME_TIMEOUT", "HALO_DESCENT_SPEED", "HALO_OPEN_ALTITUDE",
  "GUN_POST_MG_COOLDOWN", "GUN_POST_MG_SPEED", "GUN_POST_MG_RANGE", "SETTINGS_KEY", "LEADERBOARD_KEY", "KEYBIND_STORAGE_KEY",
  "SIM_HZ", "SIM_DT", "CAMERA_MAX_PAN",
  "SUB_PARTS", "SUB_SKINS", "DEFAULT_SETTINGS", "SUPPLY_FREQUENCY_LEVELS", "DEFAULT_KEYBINDS",
];

export const FN_NAMES = [
  "getThermalLayer", "thermallyVisible", "thermalSilhouette", "createParts", "damageRandomPart", "overallHealth",
  "getSpeedMult", "getThrustMult", "getTurnMult", "isPartCritical", "isPartRed", "anyPartCritical", "anyPartRed",
  "canFireTorpedo", "clamp", "velocityToMph", "commanderStatusLabel", "componentConditionLabel", "componentConditionColor",
  "isEngineCritical", "isHullCritical", "getBackDamagePenalty", "getFrontControlPenalty", "getHullBuoyancyPenalty",
  "getSupplyFrequency", "cycleSupplyFrequency", "currentSubSkin", "resolveSubSkin", "keyLabel", "groundYFromTerrain",
];

export const constants = {};
export const functions = {};

for (const name of CONST_NAMES) {
  try { constants[name] = game.ev(`typeof ${name} === "undefined" ? undefined : ${name}`); } catch { /* absent */ }
  if (constants[name] === undefined) delete constants[name];
}
for (const name of FN_NAMES) {
  if (game.ev(`typeof ${name} === "function"`)) {
    // Call through the VM so the function runs against the engine's real globals (world, SFX, constants).
    functions[name] = (...args) => {
      game.sandbox.__args = args;
      return game.ev(`${name}(...__args)`);
    };
  }
}

export { SRC as source, ROOT, game };
export default { constants, functions, source: SRC, ROOT };
