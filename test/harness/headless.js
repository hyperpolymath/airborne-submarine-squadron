// SPDX-License-Identifier: MPL-2.0
// SPDX-FileCopyrightText: 2026 Jonathan D.A. Jewell (hyperpolymath)
//
// headless.js — boots the REAL game scripts, in browser load order, inside a
// node:vm context with a stub DOM and a transform-tracking canvas, then lets a
// test drive the REAL gameLoop() frame by frame.
//
// Why this exists: the "sub jumping around the screen" bug class (unbalanced
// canvas save/restore popping the camera transform, missing script tags,
// frame-rate-dependent physics) cannot be seen by pure-function unit tests.
// It needs the actual draw() + update() + gameLoop() running, observed.
//
// Runs unchanged on Bun (the estate runtime) and on Node (node:vm is identical).

import vm from "node:vm";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MockContext2D, autoMock } from "./mock-canvas.js";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Deterministic PRNG (mulberry32) for seeding Math.random inside the sandbox. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Extract the ordered <script src="..."> list from an HTML entry point and
 * resolve each against the HTML file's own directory — i.e. exactly what a
 * browser would fetch. Query strings (cache-busters) are dropped.
 */
export function scriptsFromHtml(htmlPath) {
  const abs = resolve(ROOT, htmlPath);
  const html = readFileSync(abs, "utf8");
  const out = [];
  const re = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const src = m[1].split("?")[0];
    if (/^https?:/.test(src)) continue;
    out.push({ src, path: resolve(dirname(abs), src) });
  }
  return out;
}

function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(String(k), String(v)); },
    removeItem: (k) => { m.delete(k); },
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
}

function fakeAudioContext() {
  // Real numeric fields + concrete buffers; EVERY other create*()/method returns a
  // chainable no-op node, so the synthesiser in sfx.js runs to completion headlessly.
  class AudioContext {
    constructor() {
      const base = { currentTime: 0, sampleRate: 44100, state: "running", destination: autoMock() };
      return new Proxy(this, {
        get(t, p) {
          if (p in base) return base[p];
          if (p === "createBuffer") {
            return (ch, len, rate) => ({ length: len, duration: len / rate, numberOfChannels: ch, sampleRate: rate, getChannelData: () => new Float32Array(len) });
          }
          if (p === "resume" || p === "suspend" || p === "close") return () => Promise.resolve();
          if (p === "then") return undefined;
          return () => autoMock({ connect: (n) => n ?? autoMock() });
        },
        set(t, p, v) { base[p] = v; return true; },
      });
    }
  }
  return AudioContext;
}

/**
 * Boot the game.
 *
 * @param {object}  [opts]
 * @param {string}  [opts.html="gossamer/index_gossamer.html"]  entry point whose <script> list is executed
 * @param {string[]} [opts.scripts]  explicit absolute paths (overrides opts.html)
 * @param {number}  [opts.seed]      seed Math.random inside the sandbox (determinism tests)
 * @param {Function} [opts.random]   override Math.random (COSMETIC randomness only, now)
 * @param {number|null} [opts.gameSeed=1] seed for the simulation RNG (null = fresh entropy)
 * @param {boolean} [opts.instrument=true]  wrap every draw*() with stack/transform balance checks
 */
export async function createGame(opts = {}) {
  const html = opts.html ?? "gossamer/index_gossamer.html";
  const scripts = opts.scripts
    ? opts.scripts.map((p) => ({ src: p, path: p }))
    : scriptsFromHtml(html);

  const logs = [];
  const logFn = (level) => (...args) => { logs.push({ level, text: args.map(String).join(" ") }); };
  const fakeConsole = { log: logFn("log"), info: logFn("info"), warn: logFn("warn"), error: logFn("error"), debug: logFn("debug") };

  const canvas = {
    width: 800, height: 600, style: {},
    focus() {}, addEventListener() {}, removeEventListener() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }),
  };
  const ctx2d = new MockContext2D(canvas);
  canvas.getContext = () => ctx2d;

  const splash = { style: { display: "none" }, classList: { contains: () => true, add() {}, remove() {} }, addEventListener() {} };
  const listeners = { document: {}, window: {} };
  const addL = (bag) => (type, fn) => { (bag[type] ||= []).push(fn); };

  const document = {
    readyState: "complete",
    currentScript: null,
    documentElement: { requestFullscreen() {}, style: {} },
    fullscreenElement: null,
    exitFullscreen() {},
    getElementById: (id) => (id === "gameCanvas" ? canvas : id === "loading" ? splash : autoMock({ style: {}, classList: { add() {}, remove() {}, contains: () => false } })),
    querySelector: () => autoMock(),
    querySelectorAll: () => [],
    createElement: () => autoMock({ style: {}, getContext: () => new MockContext2D({}) }),
    addEventListener: addL(listeners.document),
    removeEventListener() {},
    body: autoMock(),
  };

  let rafCallback = null;
  const timers = new Set();
  const sandbox = {
    console: fakeConsole,
    document,
    localStorage: memoryStorage(),
    navigator: { userAgent: "headless-test", sendBeacon: () => true, getGamepads: () => [] },
    location: { search: "", href: "http://localhost/", protocol: "http:", host: "localhost" },
    performance,
    URL, URLSearchParams, TextEncoder, TextDecoder, EventTarget, Event, CustomEvent,
    AudioContext: fakeAudioContext(),
    fetch: () => Promise.reject(new Error("offline (headless)")),
    requestAnimationFrame: (cb) => { rafCallback = cb; return 1; },
    cancelAnimationFrame: () => { rafCallback = null; },
    setTimeout: (...a) => { const t = setTimeout(...a); timers.add(t); return t; },
    setInterval: (...a) => { const t = setInterval(...a); timers.add(t); return t; },
    clearTimeout: (t) => { timers.delete(t); clearTimeout(t); },
    clearInterval: (t) => { timers.delete(t); clearInterval(t); },
    Image: class { set src(_v) {} },
    addEventListener: addL(listeners.window),
    removeEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    close() { logs.push({ level: "window", text: "window.close()" }); },
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.webkitAudioContext = sandbox.AudioContext;
  vm.createContext(sandbox);

  // Reproducible worlds by default (terrain, spawns, AI all come from this seed).
  // Pass gameSeed: null to get the engine's own fresh entropy instead.
  if (opts.gameSeed !== null) sandbox.__ASS_SEED = opts.gameSeed ?? 1;
  if (typeof opts.random === "function") {
    sandbox.__seeded = opts.random;           // e.g. () => 0.5 : isolates timing from randomness
    vm.runInContext("Math.random = __seeded;", sandbox);
  } else if (opts.seed !== undefined) {
    sandbox.__seeded = mulberry32(opts.seed);
    vm.runInContext("Math.random = __seeded;", sandbox);
  }

  const errors = [];
  for (const s of scripts) {
    let code;
    try { code = readFileSync(s.path, "utf8"); }
    catch (e) { errors.push({ script: s.src, error: `missing script: ${e.message}` }); continue; }
    try { vm.runInContext(code, sandbox, { filename: s.path }); }
    catch (e) { errors.push({ script: s.src, error: String(e && e.stack || e) }); }
  }

  // init() is async (it awaits a fetch that rejects offline); let it settle.
  for (let i = 0; i < 5 && !rafCallback; i++) await new Promise((r) => setImmediate(r));

  const ev = (code) => vm.runInContext(code, sandbox);
  const booted = ev("typeof world !== 'undefined' && world !== null") && typeof rafCallback === "function";

  // ── instrumentation ────────────────────────────────────────────────────
  const violations = [];   // unbalanced save/restore or transform drift inside a draw*() call
  const subDraws = [];     // where the sub was actually painted, per drawSub() call
  let clock = 0;
  let game_instrumented = [];

  if (booted && opts.instrument !== false) {
    const same = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
    // Host-side callbacks; the wrappers themselves are installed from INSIDE the
    // context because Bun (unlike Node) ignores outside assignments to VM globals.
    sandbox.__instr = {
      enter(name) {
        if (name === "drawSub") {
          const sub = ev("world.sub"), camX = ev("world.cameraX");
          const p = ctx2d.toCanvas(sub.worldX - camX, sub.y);
          subDraws.push({ tick: ev("world.tick"), x: p.x, y: p.y, matrix: ctx2d.matrix, worldX: sub.worldX, worldY: sub.y, cameraY: ev("world.cameraY") });
        }
        return { d0: ctx2d.depth, m0: ctx2d.matrix, u0: ctx2d.underflows };
      },
      leave(name, t) {
        const d1 = ctx2d.depth, m1 = ctx2d.matrix, u1 = ctx2d.underflows;
        if (d1 !== t.d0 || u1 !== t.u0 || !same(t.m0, m1)) {
          violations.push({ fn: name, tick: ev("world.tick"), depthBefore: t.d0, depthAfter: d1, underflows: u1 - t.u0, matrixBefore: t.m0, matrixAfter: m1 });
        }
      },
    };
    game_instrumented = vm.runInContext(`(function () {
      const names = Object.getOwnPropertyNames(globalThis).filter((n) => /^draw[A-Z0-9_]/.test(n) && typeof globalThis[n] === "function");
      for (const n of names) {
        const orig = globalThis[n];
        globalThis[n] = function (...args) {
          const tok = __instr.enter(n);
          try { return orig.apply(this, args); } finally { __instr.leave(n, tok); }
        };
      }
      return names;
    })()`, sandbox);
  }

  const game = {
    sandbox, ctx: ctx2d, canvas, logs, errors, booted, violations, subDraws, listeners,
    scripts: scripts.map((s) => s.src),
    get instrumented() { return game_instrumented; },

    /** Evaluate JS in the game's global lexical scope (sees `world`, `keys`, consts …). */
    ev,
    get world() { return ev("world"); },
    get sub() { return ev("world.sub"); },
    get keys() { return ev("keys"); },

    press(...ks) { for (const k of ks) { ev("keys")[k] = true; ev("keyJustPressed")[k] = true; } },
    release(...ks) { for (const k of ks) { ev("keys")[k] = false; } },
    releaseAll() { const k = ev("keys"); for (const n of Object.keys(k)) delete k[n]; },
    /** Fire the game's own DOM key listeners (exercises pause/menu hooks). */
    dispatchKey(type, key) {
      for (const fn of listeners.document[type] || []) fn({ key, preventDefault() {}, stopPropagation() {}, repeat: false, code: key });
    },

    /** Run ONE real rAF callback (gameLoop) at wall-clock `tsMs`. */
    frame(tsMs) {
      if (!rafCallback) throw new Error("no rAF callback registered — game did not boot");
      const cb = rafCallback; rafCallback = null;
      clock = tsMs;
      cb(tsMs);
    },

    /**
     * Drive `n` display frames at `hz`, calling `script(i, game)` before each
     * frame to set inputs. Returns the per-frame trace.
     */
    run(n, { hz = 60, script, start } = {}) {
      const step = 1000 / hz;
      let t = start ?? (clock || 0) + step;
      const trace = [];
      for (let i = 0; i < n; i++) {
        if (script) script(i, game);
        this.frame(t);
        const w = ev("world"), s = w.sub;
        trace.push({ i, t, tick: w.tick, mode: w.mode, x: s.worldX, y: s.y, vx: s.vx, vy: s.vy, camX: w.cameraX, camY: w.cameraY });
        t += step;
      }
      return trace;
    },

    /** Direct update(dt) — bypasses gameLoop's timing (dt is in 16 ms "frames"). */
    update(dt = 1) { ev(`update(${dt})`); },
    draw() { ev("draw()"); },

    /** Where the sub was painted on the canvas in the most recent draw. */
    lastSubScreen() { return subDraws[subDraws.length - 1] || null; },

    /** Deterministic fingerprint of the simulation-relevant world state. */
    fingerprint() {
      return ev(`JSON.stringify({tick: world.tick, mode: world.mode, score: world.score, kills: world.kills,
        sub: {x: world.sub.worldX, y: world.sub.y, vx: world.sub.vx, vy: world.sub.vy, angle: world.sub.angle, floating: world.sub.floating},
        cam: [world.cameraX, world.cameraY], enemies: world.enemies.length, torps: world.torpedoes.length,
        parts: world.sub.parts})`);
    },

    dispose() { for (const t of timers) { clearTimeout(t); clearInterval(t); } timers.clear(); },
  };
  return game;
}
