// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Jonathan D.A. Jewell (hyperpolymath)
//
// rng.js — small, fast, seedable PRNG for the SIMULATION.
//
// Rule (enforced by test/determinism_test.js):
//   * simulation code (terrain, spawns, AI, damage, hazards)  ->  simRand()   (seeded, replayable)
//   * cosmetic code (draw*, particles, death blurbs)          ->  Math.random()
// so that how often the screen is redrawn can never change what happens in the world.
//
// mulberry32: 32-bit state, passes PractRand to 4 GB, and is trivially portable to
// AffineScript / typed WASM as pure integer maths (Math.imul + shifts), which is the point.
//
// Classic script: exposes window.GossamerRNG.

(function initRng(globalScope) {
  "use strict";

  /** @returns {(() => number) & {getState(): number, setState(s: number): void}} floats in [0,1) */
  function mulberry32(seed) {
    let a = seed >>> 0;
    const next = function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    next.getState = () => a;
    next.setState = (s) => { a = s >>> 0; };
    return next;
  }

  /** Parse a user-supplied seed (?seed=...): decimal, hex (0x..), or any string (FNV-1a hashed). */
  function parseSeed(text) {
    if (text === undefined || text === null || text === "") return null;
    const t = String(text).trim();
    if (/^\d+$/.test(t)) return Number(t) >>> 0;
    if (/^0x[0-9a-f]+$/i.test(t)) return parseInt(t, 16) >>> 0;
    let h = 0x811c9dc5;
    for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h >>> 0;
  }

  const api = Object.freeze({ mulberry32, parseSeed });
  if (!globalScope.GossamerRNG) globalScope.GossamerRNG = api;
})((typeof window !== "undefined") ? window : globalThis);
