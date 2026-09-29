// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Jonathan D.A. Jewell (hyperpolymath)
//
// bench.js — Blitz benchmarks for Airborne Submarine Squadron.
// Establishes Six Sigma baselines for critical operations.
// Run with: bun run test/bench.js
//
// Classification (per TESTING-TAXONOMY.adoc §2):
//   Extraordinary: >20% faster than baseline
//   Ordinary:      within ±20% of baseline
//   Acceptable:    20-50% slower than baseline
//   Unacceptable:  >50% slower than baseline
//
// Reference: standards/testing-and-benchmarking/TESTING-TAXONOMY.adoc §2
import { existsSync } from "node:fs";
import { BUN, Command, bench, readTextFile, runBenches, stat } from "./lib/rt.js";

const ROOT = new URL('..', import.meta.url).pathname;

// ── 1. Source file read: app_gossamer.js  ───────────────
bench("latency: read app_gossamer.js ", async () => {
  await readTextFile(ROOT + "gossamer/app_gossamer.js");
});

// ── 2. Source file read: src/main.affine  ────────────────────
bench("latency: read src/main.affine ", async () => {
  await readTextFile(ROOT + "src/main.affine");
});

// ── 3. K9 coordination file read + parse ────────────────────────────
bench("latency: read coordination.k9 + split into sections", async () => {
  const text = await readTextFile(ROOT + "coordination.k9");
  // Parse into sections (YAML-like, split on top-level keys)
  const sections = text.split(/\n(?=\w+:)/);
  if (sections.length < 3) throw new Error("Too few sections parsed");
});

// ── 4. WASM artifact stat (file metadata lookup) ────────────────────
// (only meaningful once build.sh / CI has produced an artifact; it is not tracked in git)
if (existsSync(ROOT + "build/airborne-submarine-squadron.wasm")) {
  bench("latency: stat WASM artifact", async () => {
    await stat(ROOT + "build/airborne-submarine-squadron.wasm");
  });
}

// ── 5. Constant extraction from game engine ─────────────────────────
bench("latency: extract 20 constants from app_gossamer.js", async () => {
  const src = await readTextFile(ROOT + "gossamer/app_gossamer.js");
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
bench("latency: run.js --reflect (full subprocess)", async () => {
  const cmd = new Command(BUN, {
    args: ["run", ROOT + "run.js", "--reflect"],
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

if (import.meta.main) await runBenches();
