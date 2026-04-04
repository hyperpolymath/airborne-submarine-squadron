// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Jonathan D.A. Jewell (hyperpolymath)
//
// _extract.js — Extracts pure (non-DOM) functions and constants from
// gossamer/app_gossamer.js for headless testing under Deno.
//
// Approach: read the source text, pull out named constants and function
// bodies by regex, then evaluate them in a sandboxed scope via
// new Function().  All extracted items are DOM-free; any function that
// touches `document` or `canvas` is excluded.

const ROOT = new URL('..', import.meta.url).pathname;
const SRC  = await Deno.readTextFile(ROOT + 'gossamer/app_gossamer.js');

// ── Constant extraction ─────────────────────────────────────────────
// Matches `const NAME = <literal>;` where literal is a number, string,
// or simple expression involving previously-defined constants.

/**
 * Extract a numeric constant by name from the source.
 * Throws if not found.
 */
export function extractConst(name) {
  // Match both `const X = 42;` and `const X = EXPR;` (single-line)
  const re = new RegExp(`(?:^|\\n)const ${name}\\s*=\\s*([^;]+);`);
  const m = SRC.match(re);
  if (!m) throw new Error(`Constant "${name}" not found in source`);
  return m[1].trim();
}

/**
 * Extract a function body (including signature) by name.
 * Brace-counting handles nested blocks.
 */
export function extractFn(name) {
  const marker = `function ${name}(`;
  const idx = SRC.indexOf(marker);
  if (idx === -1) throw new Error(`Function "${name}" not found in source`);
  let depth = 0;
  let started = false;
  let i = idx;
  while (i < SRC.length) {
    if (SRC[i] === '{') { depth++; started = true; }
    if (SRC[i] === '}') { depth--; if (started && depth === 0) break; }
    i++;
  }
  return SRC.slice(idx, i + 1);
}

// ── Multi-line constant extraction (arrays/objects) ─────────────────
// SUB_PARTS is an array of objects spanning multiple lines.
function extractMultiLineConst(name) {
  const re = new RegExp(`(?:^|\\n)const ${name}\\s*=\\s*`);
  const m = SRC.match(re);
  if (!m) throw new Error(`Multi-line constant "${name}" not found`);
  const startIdx = m.index + m[0].length;
  // Find opening bracket/brace and count depth
  let depth = 0, started = false, i = startIdx;
  while (i < SRC.length) {
    if (SRC[i] === '[' || SRC[i] === '{') { depth++; started = true; }
    if (SRC[i] === ']' || SRC[i] === '}') { depth--; if (started && depth === 0) { i++; break; } }
    i++;
  }
  return SRC.slice(startIdx, i);
}

// ── Pre-extracted constants (numeric, needed by functions) ──────────
const CONST_NAMES = [
  'WATER_LINE', 'THERMAL_LAYER_1_MAX', 'THERMAL_LAYER_2_MAX',
  'GRAVITY', 'THRUST', 'MAX_SPEED', 'GROUND_BASE', 'SEA_FLOOR',
  'HULL_DEEP_THRESHOLD', 'HULL_DEEP_CRUSH_THRESHOLD',
  'COMMANDER_HP', 'COMMANDER_MAX_HP',
  'W', 'H', 'TERRAIN_LENGTH',
  'START_TORPEDOES', 'START_MISSILES', 'START_DEPTH_CHARGES',
  'MPH_PER_GAME_SPEED', 'SPACE_MPH_PER_GAME_SPEED',
  'ORBIT_TRIGGER_SPEED_MPH', 'SPEEDOMETER_MAX_MPH',
  'CATERPILLAR_SPEED_MULT',
  'FIRE_COOLDOWN', 'TORPEDO_SPEED', 'MISSILE_SPEED',
  'BUOYANCY', 'SURFACE_DAMPING', 'WATER_DRAG',
  'AFTERBURNER_MAX_CHARGE', 'AFTERBURNER_DRAIN', 'AFTERBURNER_RECHARGE',
  'MINE_COUNT', 'MINE_RADIUS', 'MINE_DAMAGE',
  'CHAFF_COOLDOWN', 'CHAFF_LIFESPAN', 'CHAFF_RADIUS',
  'DEPTH_CHARGE_BLAST_RADIUS', 'DEPTH_CHARGE_LIFE',
  'EJECT_PRIME_TIMEOUT', 'HALO_DESCENT_SPEED', 'HALO_OPEN_ALTITUDE',
  'GUN_POST_MG_COOLDOWN', 'GUN_POST_MG_SPEED', 'GUN_POST_MG_RANGE',
];

// Multi-line constants that functions depend on
const MULTI_CONST_NAMES = ['SUB_PARTS'];
const multiConstPreamble = MULTI_CONST_NAMES.map(name => {
  try {
    const expr = extractMultiLineConst(name);
    return `const ${name} = ${expr};`;
  } catch {
    return `// SKIP: ${name} not found`;
  }
}).join('\n');

// Build a preamble that defines all constants so extracted functions
// can reference them.
const constPreamble = multiConstPreamble + '\n' + CONST_NAMES.map(name => {
  try {
    const expr = extractConst(name);
    return `const ${name} = ${expr};`;
  } catch {
    return `// SKIP: ${name} not found`;
  }
}).join('\n');

// ── Pre-extracted pure functions ────────────────────────────────────
const FN_NAMES = [
  'getThermalLayer', 'thermallyVisible', 'thermalSilhouette',
  'createParts', 'damageRandomPart', 'overallHealth',
  'getSpeedMult', 'getThrustMult', 'getTurnMult',
  'isPartCritical', 'isPartRed', 'anyPartCritical', 'anyPartRed',
  'canFireTorpedo', 'clamp', 'velocityToMph',
  'commanderStatusLabel', 'componentConditionLabel', 'componentConditionColor',
  'isEngineCritical', 'isHullCritical',
  'getBackDamagePenalty', 'getFrontControlPenalty', 'getHullBuoyancyPenalty',
  'getSupplyFrequency', 'cycleSupplyFrequency',
];

const fnBodies = FN_NAMES.map(name => {
  try { return extractFn(name); }
  catch { return `// SKIP: ${name} not found`; }
}).join('\n\n');

// ── Build sandbox and export ────────────────────────────────────────
const exportNames = FN_NAMES.concat(CONST_NAMES);
const assignBlock = exportNames.map(n =>
  `try { __out.${n} = ${n}; } catch {}`
).join('\n');

// Stubs for globals referenced by game functions (e.g. damageRandomPart
// reads `world` to check commander HP, and calls SFX.damage()).
const globalStubs = `
var world = null;
var SFX = { damage: function(){}, gameOver: function(){} };
`;

const fullCode = `
${globalStubs}
${constPreamble}

${fnBodies}

${assignBlock}
`;

const __out = {};
try {
  new Function('__out', fullCode)(__out);
} catch (e) {
  console.error('[_extract] sandbox eval error:', e.message);
}

// Re-export everything as named exports
export const constants = {};
export const functions = {};

for (const name of CONST_NAMES) {
  if (name in __out) constants[name] = __out[name];
}
for (const name of FN_NAMES) {
  if (typeof __out[name] === 'function') functions[name] = __out[name];
}

// Convenience: also export the raw source and root path
export { SRC as source, ROOT };
export default { constants, functions, source: SRC, ROOT };
