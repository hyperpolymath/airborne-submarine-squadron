// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Jonathan D.A. Jewell (hyperpolymath)
//
// fixed_step_test.js — the clock primitive, then the engine wired to it.

import { describe, expect, test } from "bun:test";
import "../gossamer/fixed_step.js";
import { createGame, mulberry32 } from "./harness/headless.js";

const { FixedStep, lerp } = globalThis.GossamerFixedStep;

/** Drive a clock at `hz` display frames for `seconds`; return total steps. */
function stepsAt(displayHz, seconds, clock = new FixedStep({ hz: 60 })) {
  const frameMs = 1000 / displayHz;
  let steps = 0;
  for (let i = 0; i < Math.round(displayHz * seconds); i++) steps += clock.advance(frameMs);
  return steps;
}

describe("FixedStep (the enaction-time contract)", () => {
  test("whole equal steps: every display rate yields the same number of simulation steps per second", () => {
    for (const hz of [30, 60, 75, 90, 120, 144, 165, 240, 360]) {
      const steps = stepsAt(hz, 10);
      // 10 s at 60 Hz = 600 steps; allow 1 step of boundary slack, never more.
      expect(Math.abs(steps - 600)).toBeLessThanOrEqual(1);
    }
  });

  test("60 Hz display: exactly one step per frame, no residue", () => {
    const c = new FixedStep({ hz: 60 });
    for (let i = 0; i < 1000; i++) expect(c.advance(1000 / 60)).toBe(1);
    expect(c.alpha).toBeLessThan(1e-6);
  });

  test("30 Hz display: two steps per frame; 120 Hz display: alternating 0/1", () => {
    const c30 = new FixedStep({ hz: 60 });
    for (let i = 0; i < 100; i++) expect(c30.advance(1000 / 30)).toBe(2);
    const c120 = new FixedStep({ hz: 60 });
    const seq = Array.from({ length: 8 }, () => c120.advance(1000 / 120));
    expect(seq.every((n) => n === 0 || n === 1)).toBe(true);
    expect(seq.reduce((a, b) => a + b, 0)).toBe(4);
  });

  test("alpha is always within [0,1] and is render-only (never returned as a step)", () => {
    const c = new FixedStep({ hz: 60 });
    const rnd = mulberry32(99);
    for (let i = 0; i < 5000; i++) {
      c.advance(rnd() * 40);
      expect(c.alpha).toBeGreaterThanOrEqual(0);
      expect(c.alpha).toBeLessThanOrEqual(1);
    }
  });

  test("hostile frame times never poison the clock", () => {
    const c = new FixedStep({ hz: 60 });
    for (const bad of [NaN, -1, -1e9, Infinity, -Infinity, undefined, null, "x", {}]) {
      expect(c.advance(bad)).toBe(0);
      expect(Number.isFinite(c.acc)).toBe(true);
    }
    expect(c.advance(1000 / 60)).toBe(1);
  });

  test("spiral-of-death guard: a long stall is clamped, not fast-forwarded", () => {
    const c = new FixedStep({ hz: 60, maxSteps: 5 });
    expect(c.advance(10_000)).toBeLessThanOrEqual(5);
    expect(c.droppedMs).toBeGreaterThan(9_000);
    expect(c.advance(1000 / 60)).toBe(1);       // recovers immediately
  });

  test("long random runs: total steps == floor(total real time / step) within 1", () => {
    const c = new FixedStep({ hz: 60, maxSteps: 1000, maxFrameMs: 1000 });
    const rnd = mulberry32(2026);
    let t = 0, steps = 0;
    for (let i = 0; i < 20000; i++) { const dt = 1 + rnd() * 30; t += dt; steps += c.advance(dt); }
    expect(Math.abs(steps - Math.floor(t / (1000 / 60)))).toBeLessThanOrEqual(1);
  });

  test("lerp endpoints are exact", () => {
    expect(lerp(3, 9, 0)).toBe(3);
    expect(lerp(3, 9, 1)).toBe(9);
    expect(lerp(3, 9, 0.5)).toBe(6);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The engine, driven through its REAL gameLoop() at different display rates.
// ─────────────────────────────────────────────────────────────────────────────

const HALF = () => 0.5; // constant RNG: any remaining divergence is timing, not randomness

/** Same wall-clock flight script at any display rate; inputs change only on 1/60 s boundaries. */
async function flight(hz, seconds = 6, opts = {}) {
  const game = await createGame({ random: HALF, instrument: false, ...opts });
  game.run(Math.round(seconds * hz), {
    hz,
    script: (i, g) => {
      const t = Math.floor((i / hz) * 60) / 60;       // quantise to sim steps
      g.releaseAll();
      g.press("ArrowRight");
      if (t > 1.0 && t < 2.5) g.press("ArrowUp");
    },
  });
  const s = game.sub, w = game.world;
  const out = { hz, tick: w.tick, x: s.worldX, y: s.y, vx: s.vx, vy: s.vy, camX: w.cameraX, camY: w.cameraY };
  game.dispose();
  return out;
}

describe("engine is frame-rate independent (same physics on every monitor)", () => {
  test("the same 6 s flight lands in (almost) the same place at 30/60/120/144/240 Hz", async () => {
    const ref = await flight(60);
    for (const hz of [30, 120, 144, 240]) {
      const r = await flight(hz);
      // Input edges may land one 1/60 s step apart between rates: a few px, never the
      // 100-250 px the variable-dt loop produced (254 px @30 Hz, -229 px @240 Hz).
      expect(Math.abs(r.x - ref.x)).toBeLessThan(25);
      expect(Math.abs(r.y - ref.y)).toBeLessThan(25);
      expect(Math.abs(r.vx - ref.vx)).toBeLessThan(0.6);
    }
  });

  test("whole-multiple rates (60/120/240 Hz) are bit-for-bit identical", async () => {
    const a = await flight(60), b = await flight(120), c = await flight(240);
    for (const k of ["tick", "x", "y", "vx", "vy"]) { expect(b[k]).toBe(a[k]); expect(c[k]).toBe(a[k]); }
  });

  test("simulation ticks per real second are 60 regardless of display rate", async () => {
    for (const hz of [30, 60, 144, 240]) {
      const r = await flight(hz, 4);
      expect(Math.abs(r.tick - 240)).toBeLessThanOrEqual(2);
    }
  });

  test("the very first frame does not fast-forward the world (no catch-up burst)", async () => {
    const game = await createGame({ random: HALF, instrument: false });
    try {
      game.frame(5000);                 // page has been open 5 s before the first rAF
      expect(game.world.tick).toBeLessThanOrEqual(1);
    } finally { game.dispose(); }
  });
});

describe("one-shot key presses survive any display rate", () => {
  test("a press that lands on a 0-step frame (240 Hz) is not lost", async () => {
    const game = await createGame({ random: HALF, instrument: false });
    try {
      game.run(10, { hz: 240 });
      // advance until a frame that simulates nothing, then press weapon slot 2
      let tick = game.world.tick, guard = 0;
      do { game.run(1, { hz: 240 }); guard++; } while (game.world.tick !== tick && (tick = game.world.tick, guard < 20));
      game.press("2");
      game.run(8, { hz: 240 });
      expect(game.world.selectedWeapon).toBe(2);
    } finally { game.dispose(); }
  });

  test("a press is seen by exactly ONE step even when a frame runs two (30 Hz)", async () => {
    const game = await createGame({ random: HALF, instrument: false });
    try {
      game.run(5, { hz: 30 });
      game.press("Shift", "p");          // Shift+P toggles auto-periscope: observable, parity-sensitive
      game.run(3, { hz: 30 });
      game.release("Shift", "p");
      game.run(2, { hz: 30 });
      expect(game.world.autoPeriscope).toBe(true);   // toggled once (twice would leave it false)
    } finally { game.dispose(); }
  });
});

describe("camera never lurches", () => {
  test("at tick 1 the sub is already framed where the camera wants it (no intro swoop)", async () => {
    const game = await createGame({ random: HALF });
    try {
      game.run(3, { hz: 60 });
      const d = game.lastSubScreen();
      expect(Math.abs(d.y - 270)).toBeLessThan(2);
    } finally { game.dispose(); }
  });

  test("camera pan speed is capped: switching follow target (eject/embark) pans, it does not snap", async () => {
    const game = await createGame({ random: HALF, instrument: false });
    try {
      game.run(30, { hz: 60 });
      const cap = game.ev("CAMERA_MAX_PAN");
      // Pretend the commander is far from the sub: the follow target jumps ~400 px.
      game.ev("world.sub.disembarked = true; world.sub.diverMode = true; world.sub.pilotX = world.sub.worldX + 400; world.sub.pilotY = world.sub.y + 300; world.sub.pilotVx = 0; world.sub.pilotVy = 0;");
      let prevX = game.world.cameraX, prevY = game.world.cameraY, worst = 0;
      for (let i = 0; i < 60; i++) {
        game.run(1, { hz: 60 });
        worst = Math.max(worst, Math.abs(game.world.cameraX - prevX), Math.abs(game.world.cameraY - prevY));
        prevX = game.world.cameraX; prevY = game.world.cameraY;
      }
      expect(worst).toBeLessThanOrEqual(cap * 1.05 + 1e-6);
    } finally { game.dispose(); }
  });

  test("fuzzed play: no single-step camera move exceeds the cap (restarts excluded)", async () => {
    const KEYS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " ", "Shift", "a", "s", "p", "1", "2", "3", "e", "m", "Tab", "Backspace"];
    for (const seed of [11, 12, 13]) {
      const game = await createGame({ seed, instrument: false });
      try {
        const rnd = mulberry32(seed * 31);
        const cap = game.ev("CAMERA_MAX_PAN");
        let prev = null, worst = 0;
        for (let i = 0; i < 1500; i++) {
          if (i % 9 === 0) { game.releaseAll(); game.press(KEYS[Math.floor(rnd() * KEYS.length)]); }
          game.run(1, { hz: 60 });
          const w = game.world;
          if (prev && w.tick === prev.tick + 1 && w.mode === "atmosphere" && prev.mode === "atmosphere") {
            worst = Math.max(worst, Math.abs(w.cameraX - prev.x), Math.abs(w.cameraY - prev.y));
          }
          prev = { tick: w.tick, mode: w.mode, x: w.cameraX, y: w.cameraY };
        }
        expect(worst).toBeLessThanOrEqual(cap * 1.05 + 1e-6);
      } finally { game.dispose(); }
    }
  });
});

describe("UI timers count simulation steps, not display frames", () => {
  for (const hz of [60, 144, 240]) {
    test(`a 60-tick ticker lives ~1 s at ${hz} Hz`, async () => {
      const game = await createGame({ random: HALF, instrument: false });
      try {
        game.run(Math.round(hz * 0.1), { hz });
        game.ev("ticker('hello', 60)");
        game.run(Math.round(hz * 0.5), { hz });
        expect(game.ev("world._notifications.ticker.length")).toBe(1);   // alive at 0.5 s
        game.run(Math.round(hz * 0.7), { hz });
        expect(game.ev("world._notifications.ticker.length")).toBe(0);   // gone by 1.2 s
      } finally { game.dispose(); }
    });
  }
});

describe("render interpolation smooths high refresh rates without touching the sim", () => {
  test("144 Hz: painted sub advances evenly frame to frame (no 0,0,v,0,v stair-steps)", async () => {
    const game = await createGame({ random: HALF });
    try {
      game.ev("world.sub.floating = false; world.sub.worldX = 3000; world.sub.y = 250; world.sub.vx = 3; world.sub.vy = 0; world.cameraX = 2700; world.cameraY = 0;");
      game.run(120, { hz: 144, script: (i, g) => { g.press("ArrowRight"); } });
      const xs = game.subDraws.slice(-60).map((d) => d.worldX);
      const dxs = xs.slice(1).map((x, i) => x - xs[i]);
      const mean = dxs.reduce((a, b) => a + b, 0) / dxs.length;
      expect(mean).toBeGreaterThan(0.5);
      expect(Math.max(...dxs)).toBeLessThan(mean * 1.35);   // no frame moves >35% more than average
      expect(Math.min(...dxs)).toBeGreaterThan(mean * 0.65);
    } finally { game.dispose(); }
  });

  test("interpolation never writes back into the simulation state", async () => {
    const a = await createGame({ random: HALF, instrument: false });
    const b = await createGame({ random: HALF, instrument: false });
    try {
      a.run(240, { hz: 144 });                 // interpolated display
      b.run(Math.round(240 * 60 / 144), { hz: 60 }); // aligned 60 Hz, no interpolation
      // same number of sim steps => identical state
      expect(a.world.tick).toBe(b.world.tick);
      expect(a.sub.worldX).toBe(b.sub.worldX);
      expect(a.sub.y).toBe(b.sub.y);
    } finally { a.dispose(); b.dispose(); }
  });
});
