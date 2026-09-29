// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Jonathan D.A. Jewell (hyperpolymath)
//
// gameloop_benchmark.js — benchmarks the REAL engine.
//
// The Deno-era version timed a hand-written `GameSimulator` stand-in (GRAVITY 0.18, no enemies,
// no weapons): it measured nothing about the game.  This one boots the actual engine headlessly
// (test/harness/headless.js) and times the real update() and gameLoop().
//
// Run:   bun run test/bench/gameloop_benchmark.js
// Budget (enforced in test/perf_budget_test.js): one sim step must stay well inside a 16.7 ms frame.
//
// Note: draw() runs against a call-counting mock canvas, so its time is NOT real raster cost; the
// number that matters there is ctx-calls-per-frame (a proxy for GPU command-buffer pressure).

import { bench, runBenches } from "../lib/rt.js";
import { createGame } from "../harness/headless.js";

const game = await createGame({ gameSeed: 7, instrument: false });

function scenario(name, setup) {
  bench(`real update(): ${name}`, () => { game.update(game.ev("SIM_DT")); }, { iterations: 300, warmup: 30 });
  return setup;
}

// 1. cruising in the air over the sea
game.ev("world.sub.floating = false; world.sub.y = 250; world.sub.vx = 3;");
scenario("atmosphere cruise");

// 2. busy: enemies, projectiles, mines around a submerged sub
bench("real update(): underwater, weapons firing", () => {
  game.press(" ", "ArrowRight");
  game.update(game.ev("SIM_DT"));
}, { iterations: 300, warmup: 30 });

bench("real gameLoop frame @60 Hz (update + draw on a mock canvas)", () => { game.run(1, { hz: 60 }); }, { iterations: 200, warmup: 20 });
bench("real gameLoop frame @144 Hz (interpolated)", () => { game.run(1, { hz: 144 }); }, { iterations: 200, warmup: 20 });

if (import.meta.main) {
  // Pre-position the second scenario's world, then run.
  game.ev("world.sub.floating = false; world.sub.y = 560; world.sub.worldX = 2600;");
  await runBenches();
  game.ctx.calls = 0; game.ctx.recordOps = false;
  game.run(120, { hz: 60 });
  console.log(`ctx calls per frame (save/restore only; proxy): ${(game.ctx.calls / 120).toFixed(1)}  | max save depth: ${game.ctx.maxDepth}`);
  game.dispose();
}
