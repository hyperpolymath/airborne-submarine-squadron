// SPDX-License-Identifier: MPL-2.0
// SPDX-FileCopyrightText: 2026 Jonathan D.A. Jewell (hyperpolymath)
//
// determinism_test.js — (seed, per-step inputs) must fully determine a run.
//
// This is the property that makes replays, daily challenges, verifiable
// leaderboards, lockstep netcode and WASM golden-vector testing possible.

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { createGame, ROOT } from "./harness/headless.js";
import { findInFunctions, unbalancedCanvasFunctions } from "./lib/source-scan.js";

/** A busy 10 s script, expressed in SIM steps so every display rate presses the same keys on the same step. */
function script(hz) {
  return (i, g) => {
    const step = Math.floor((i / hz) * 60);
    g.releaseAll();
    g.press("ArrowRight");
    if (step >= 60 && step < 150) g.press("ArrowUp");
    if (step >= 150 && step < 300) g.press("ArrowDown");
    if (step >= 200 && step < 400) g.press(" ");
    if (step >= 300 && step < 380) g.press("a");
    if (step === 100 || step === 101) g.press("2");
  };
}

async function tenSeconds(hz, cosmeticSeed, gameSeed = 7) {
  const game = await createGame({ gameSeed, seed: cosmeticSeed, instrument: false });
  game.run(Math.round(10 * hz), { hz, script: script(hz) });
  const fp = game.fingerprint();
  game.dispose();
  return fp;
}

describe("simulation is independent of how often (and how randomly) the screen is redrawn", () => {
  test("60 / 120 / 240 Hz with three DIFFERENT cosmetic random streams -> identical world", async () => {
    const a = await tenSeconds(60, 111);
    const b = await tenSeconds(120, 222);
    const c = await tenSeconds(240, 333);
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  test("...and the comparison is not vacuous: a different game seed gives a different world", async () => {
    const a = await tenSeconds(60, 111, 7);
    const other = await tenSeconds(60, 111, 8);
    expect(other).not.toBe(a);
  });
});

describe("seeded worlds", () => {
  test("same seed -> identical terrain; different seed -> different terrain", async () => {
    const t = async (seed) => { const g = await createGame({ gameSeed: seed, instrument: false }); const j = g.ev("JSON.stringify(world.terrain)"); g.dispose(); return j; };
    expect(await t(42)).toBe(await t(42));
    expect(await t(42)).not.toBe(await t(43));
  });

  test("world.seed records the seed, and ?seed= style parsing is stable", async () => {
    const g = await createGame({ gameSeed: 12345, instrument: false });
    try {
      expect(g.world.seed).toBe(12345);
      const P = g.sandbox.GossamerRNG.parseSeed;
      expect(P("123")).toBe(123);
      expect(P("0xff")).toBe(255);
      expect(P("daily-2026-09-29")).toBe(P("daily-2026-09-29"));
      expect(P("daily-2026-09-29")).not.toBe(P("daily-2026-09-30"));
      expect(P("")).toBeNull();
      expect(P(undefined)).toBeNull();
    } finally { g.dispose(); }
  });

  test("a restarted game with a pinned seed replays the same world", async () => {
    const g = await createGame({ gameSeed: 99, instrument: false });
    try {
      const first = g.ev("JSON.stringify(world.terrain)");
      g.ev("world = initWorld()");
      expect(g.ev("JSON.stringify(world.terrain)")).toBe(first);
    } finally { g.dispose(); }
  });
});

describe("no unbounded loops on degenerate randomness (pons-asinorum: missing escape hatch)", () => {
  test("pickPlanetIdx terminates, avoids the Sun and the excluded planet, for any RNG output", async () => {
    const g = await createGame({ instrument: false });
    try {
      const n = g.ev("SOLAR_SYSTEM_BODIES.length") - 1;
      for (const r of [0, 0.25, 0.5, 0.999999, 1, -1, NaN, Infinity]) {
        g.ev(`_simRng = () => ${r}`);
        for (let exclude = -1; exclude <= n; exclude++) {
          const idx = g.ev(`pickPlanetIdx(${exclude})`);
          expect(idx).toBeGreaterThanOrEqual(1);
          expect(idx).toBeLessThanOrEqual(n);
          expect(idx).not.toBe(exclude);
        }
      }
    } finally { g.dispose(); }
  });

  test("the old infinite loop: entering orbit under a constant RNG completes", async () => {
    const g = await createGame({ instrument: false });
    try {
      g.ev("_simRng = () => 0.5");
      g.ev("enterOrbitMode(100)");                 // used to spin forever: while (to === from) to = floor(0.5*n)+1
      expect(g.world.mode).toBe("orbit");
      g.run(10, { hz: 60 });
    } finally { g.dispose(); }
  });

  test("wrapAngle is O(1), stays in [-PI, PI), and never hangs on Infinity/NaN", async () => {
    const g = await createGame({ instrument: false });
    try {
      for (const a of [0, 1, -1, 7, -7, 1e6, -1e6, 1e15]) {
        const w = g.ev(`wrapAngle(${a})`);
        expect(w).toBeGreaterThanOrEqual(-Math.PI - 1e-9);
        expect(w).toBeLessThan(Math.PI + 1e-9);
        // Equivalence modulo 2*PI is only checkable where float argument reduction is exact enough;
        // for |a| ~ 1e6+ even Math.cos(a) itself has lost precision. The contract there is range + O(1).
        if (Math.abs(a) <= 1e3) expect(Math.cos(w)).toBeCloseTo(Math.cos(a), 6);
      }
      for (const bad of ["Infinity", "-Infinity", "NaN"]) expect(g.ev(`wrapAngle(${bad})`)).toBe(0);
    } finally { g.dispose(); }
  });
});

describe("static guard: simulation code never touches the cosmetic RNG", () => {
  // Cosmetic on purpose: particles, death blurbs, asteroid COLOUR. Everything else must use simRand().
  const ALLOW = [
    { fn: "addParticles" },
    { fn: "causeOfDeathBlurb" },
    { fn: "initAsteroids", lineText: "hsl(" },
  ];
  const SKIP_FILES = new Set(["sfx.js"]);          // audio noise synthesis: cosmetic by definition

  function violations(file, src) {
    return findInFunctions(src, /Math\.random\s*\(\)/).filter((hit) => {
      if (hit.fn && /^draw/.test(hit.fn)) return false;
      const lineText = src.split("\n")[hit.line - 1] || "";
      return !ALLOW.some((a) => a.fn === hit.fn && (!a.lineText || lineText.includes(a.lineText)));
    }).map((h) => `${file}:${h.line} in ${h.fn ?? "<top level>"}`);
  }

  test("gossamer/*.js: every Math.random() is in a draw*() function or on the cosmetic allow-list", () => {
    const dir = `${ROOT}/gossamer/`;
    const bad = [];
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".js") && !SKIP_FILES.has(n))) {
      bad.push(...violations(f, readFileSync(dir + f, "utf8")));
    }
    expect(bad).toEqual([]);
  });

  test("negative control: the guard really fails on simulation code that uses Math.random()", () => {
    const naughty = "function update(dt) {\n  if (Math.random() < 0.1) spawn();\n}\nfunction drawThing() { x = Math.random(); }\n";
    expect(violations("fake.js", naughty)).toEqual(["fake.js:2 in update"]);
  });

  test("negative control: template-literal interpolations are scanned too", () => {
    const sneaky = "function spawnEnemy() { return `id-${Math.random()}`; }\n";
    expect(violations("fake.js", sneaky)).toEqual(["fake.js:1 in spawnEnemy"]);
  });
});

describe("static guard: canvas save()/restore() balance (the jump-bug class)", () => {
  test("gossamer/*.js: every function has equal ctx.save() and ctx.restore() counts", () => {
    const dir = `${ROOT}/gossamer/`;
    const bad = [];
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".js"))) {
      for (const u of unbalancedCanvasFunctions(readFileSync(dir + f, "utf8"))) bad.push(`${f}:${u.line} ${u.fn} save=${u.saves} restore=${u.restores}`);
    }
    expect(bad).toEqual([]);
  });

  test("negative control: the original drawEvelCameratron shape (2 saves, 3 restores) is caught", () => {
    const original = "function drawEvelCameratron() {\n ctx.save();\n ctx.save();\n ctx.restore();\n ctx.restore();\n ctx.restore();\n}\n";
    expect(unbalancedCanvasFunctions(original)).toEqual([{ fn: "drawEvelCameratron", saves: 2, restores: 3, line: 1 }]);
  });
});
