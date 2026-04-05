// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Jonathan D.A. Jewell (hyperpolymath)
//
// bench.js — Blitz benchmarks for Airborne Submarine Squadron.
// Establishes Six Sigma baselines for critical operations.
// Run with: deno bench --allow-all test/bench.js
//
// Classification (per TESTING-TAXONOMY.adoc §2):
//   Extraordinary: >20% faster than baseline
//   Ordinary:      within ±20% of baseline
//   Acceptable:    20-50% slower than baseline
//   Unacceptable:  >50% slower than baseline
//
// Reference: standards/testing-and-benchmarking/TESTING-TAXONOMY.adoc §2

const ROOT = new URL('..', import.meta.url).pathname;

// ── 1. Source file read: app_gossamer.js (8966 lines) ───────────────
Deno.bench("latency: read app_gossamer.js (8966 lines)", async () => {
  await Deno.readTextFile(ROOT + "gossamer/app_gossamer.js");
});

// ── 2. Source file read: src/main.as (819 lines) ────────────────────
Deno.bench("latency: read src/main.as (819 lines)", async () => {
  await Deno.readTextFile(ROOT + "src/main.as");
});

// ── 3. K9 coordination file read + parse ────────────────────────────
Deno.bench("latency: read coordination.k9 + split into sections", async () => {
  const text = await Deno.readTextFile(ROOT + "coordination.k9");
  // Parse into sections (YAML-like, split on top-level keys)
  const sections = text.split(/\n(?=\w+:)/);
  if (sections.length < 3) throw new Error("Too few sections parsed");
});

// ── 4. WASM artifact stat (file metadata lookup) ────────────────────
Deno.bench("latency: stat WASM artifact", async () => {
  await Deno.stat(ROOT + "dist/airborne-submarine-squadron.wasm");
});

// ── 5. Constant extraction from game engine ─────────────────────────
Deno.bench("latency: extract 20 constants from app_gossamer.js", async () => {
  const src = await Deno.readTextFile(ROOT + "gossamer/app_gossamer.js");
  const targets = [
    'GRAVITY', 'THRUST', 'MAX_SPEED', 'WATER_LINE', 'GROUND_BASE',
    'SEA_FLOOR', 'FIRE_COOLDOWN', 'TORPEDO_SPEED', 'MISSILE_SPEED',
    'BUOYANCY', 'SURFACE_DAMPING', 'WATER_DRAG', 'TERRAIN_LENGTH',
    'START_TORPEDOES', 'START_MISSILES', 'COMMANDER_HP', 'MINE_COUNT',
    'MINE_DAMAGE', 'W', 'H',
  ];
  const consts = {};
  for (const name of targets) {
    const re = new RegExp(`const ${name}\\s*=\\s*([^;]+);`);
    const m = src.match(re);
    if (m) consts[name] = m[1].trim();
  }
  if (Object.keys(consts).length < 15) throw new Error("Too few constants extracted");
});

// ── 6. run.js --reflect end-to-end ──────────────────────────────────
Deno.bench("latency: run.js --reflect (full subprocess)", async () => {
  const cmd = new Deno.Command("deno", {
    args: ["run", "--allow-all", ROOT + "run.js", "--reflect"],
    stdout: "piped",
    stderr: "piped",
    cwd: ROOT,
  });
  const { code, stdout } = await cmd.output();
  if (code !== 0) throw new Error("--reflect failed");
  const text = new TextDecoder().decode(stdout);
  // Output includes ANSI-coloured header before JSON — skip to first '{'
  const jsonStart = text.indexOf('{');
  if (jsonStart < 0) throw new Error("No JSON in output");
  const data = JSON.parse(text.slice(jsonStart));
  if (!data.registry) throw new Error("Missing registry in output");
});
