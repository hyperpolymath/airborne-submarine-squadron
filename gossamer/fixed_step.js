// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Jonathan D.A. Jewell (hyperpolymath)
//
// fixed_step.js — deterministic fixed-timestep clock.
//
// THE INVARIANT (shared with metadatastician/enaction-engine's `enaction-time`):
//   The simulation advances only in WHOLE, EQUAL steps, and render
//   interpolation never feeds simulation state.
//
// Variable frame time must never become simulation input.  Before this module,
// gameLoop() passed `min(frameMs, 32) / 16` straight into update(), while most
// of the physics applied per-FRAME drag (vx *= 0.98, WATER_DRAG, ...).  The same
// 6-second flight ended 254 px further right at 30 Hz and 229 px short at 240 Hz
// (see test/fixed_step_test.js).  Everybody on a 120/144/240 Hz monitor was
// playing a different, sluggish game.
//
// API mirrors the Rust crate so a later swap to the WASM build is mechanical:
//   clock.advance(frameMs) -> number of whole steps to simulate now
//   clock.alpha            -> render-only fraction (0..1) into the next step
//
// Classic script (no modules): exposes window.GossamerFixedStep.

(function initFixedStep(globalScope) {
  "use strict";

  class FixedStep {
    /**
     * @param {object} [opts]
     * @param {number} [opts.hz=60]          simulation rate
     * @param {number} [opts.maxSteps=5]     spiral-of-death guard: never simulate more than this per frame
     * @param {number} [opts.maxFrameMs]     clamp a single frame's real time (tab switch / breakpoint); default 3x the guard window
     */
    constructor(opts = {}) {
      const hz = Number.isFinite(opts.hz) && opts.hz > 0 ? opts.hz : 60;
      this.hz = hz;
      this.stepMs = 1000 / hz;
      this.maxSteps = Number.isInteger(opts.maxSteps) && opts.maxSteps > 0 ? opts.maxSteps : 5;
      this.maxFrameMs = Number.isFinite(opts.maxFrameMs) && opts.maxFrameMs > 0
        ? opts.maxFrameMs
        : this.stepMs * this.maxSteps * 3;
      this.acc = 0;           // real time not yet consumed by whole steps (ms)
      this.totalSteps = 0;    // telemetry
      this.droppedMs = 0;     // telemetry: real time discarded by the guards
    }

    /**
     * Feed elapsed real time; returns how many whole steps the host must
     * simulate now.  Hostile input (NaN, negative, +/-Infinity) counts as 0.
     */
    advance(frameMs) {
      let dt = Number(frameMs);
      if (!Number.isFinite(dt) || dt < 0) dt = 0;
      if (dt > this.maxFrameMs) { this.droppedMs += dt - this.maxFrameMs; dt = this.maxFrameMs; }

      this.acc += dt;
      // 1e-9 ms tolerance: 3 x 16.6666667 ms must be exactly 3 steps, not 2 + dust.
      let steps = Math.floor(this.acc / this.stepMs + 1e-9);
      this.acc -= steps * this.stepMs;
      if (this.acc < 0) this.acc = 0;

      if (steps > this.maxSteps) {
        this.droppedMs += (steps - this.maxSteps) * this.stepMs;
        steps = this.maxSteps;
      }
      this.totalSteps += steps;
      return steps;
    }

    /** Render-only fraction of the way into the NEXT step, in [0, 1]. Never feeds the simulation. */
    get alpha() {
      const a = this.acc / this.stepMs;
      return a < 0 ? 0 : a > 1 ? 1 : a;
    }

    /** Discard accumulated time (after a load, a restart, or unpausing). */
    reset() { this.acc = 0; }
  }

  /**
   * Render-only interpolation helper: linear blend between the two most recent
   * COMPLETED states.  Continuous quantities only (positions); discrete values
   * (mode, flags, counters) must be read from the current state, never blended.
   */
  function lerp(a, b, t) { return a + (b - a) * t; }

  const api = Object.freeze({ FixedStep, lerp });
  if (!globalScope.GossamerFixedStep) globalScope.GossamerFixedStep = api;
})((typeof window !== "undefined") ? window : globalThis);
