// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Jonathan D.A. Jewell (hyperpolymath)
//
// regression_test.js — Blitz regression tests for Airborne Submarine Squadron.
// Each test locks a specific bug fix. Numbered by date/commit.
// A regression test is permanent — never delete.
//
// Reference: standards/testing-and-benchmarking/TESTING-TAXONOMY.adoc §13

import { assert, assertEquals } from "jsr:@std/assert";

const ROOT = new URL('..', import.meta.url).pathname;

// ── #001: Port 6880 everywhere (was 6860) ───────────────────────────
// Bug: Port was 6860 in some places, 6880 in others. Caused double-
// server on different ports, orphaned processes.
// Fixed: 5be6c41 — "fix: port 6880 everywhere"
Deno.test("regression #001: port 6880 used consistently in run.js", async () => {
  const src = await Deno.readTextFile(ROOT + "run.js");
  // REGISTRY must declare 6880 as primary
  assert(src.includes("primary:  6880") || src.includes("primary: 6880"),
    "REGISTRY.ports.primary must be 6880");
  // No references to old port 6860 in active code
  // (comments/history OK, but not in REGISTRY or serve calls)
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith('//')) continue; // skip comments
    if (line.includes('6860') && !line.includes('// was 6860')) {
      throw new Error(`Line ${i + 1} still references port 6860: ${line.trim()}`);
    }
  }
});

// ── #002: CWD chdir on launch (desktop shortcut fix) ────────────────
// Bug: Desktop shortcut launched from $HOME, causing 'Not Found' for
// all relative file paths (WASM, gossamer/, etc.).
// Fixed: 7c98031 — "fix: chdir to script dir on launch"
Deno.test("regression #002: run.js chdir to script directory", async () => {
  const src = await Deno.readTextFile(ROOT + "run.js");
  assert(src.includes("Deno.chdir"),
    "run.js must chdir to script directory for desktop shortcut support");
  // Specifically, the chdir must happen early (inside import.meta.main block)
  const mainIdx = src.indexOf("import.meta.main");
  const chdirIdx = src.indexOf("Deno.chdir");
  assert(mainIdx > 0 && chdirIdx > mainIdx,
    "Deno.chdir must appear after import.meta.main check");
});

// ── #003: Deno safe shutdown (fatal crash fix) ──────────────────────
// Bug: Aborting the server mid-response caused Deno to crash with
// unhandled promise rejection on AbortError.
// Fixed: 9cecab2 — "fix: Deno fatal crash — safe shutdown"
Deno.test("regression #003: run.js uses queueMicrotask for shutdown", async () => {
  const src = await Deno.readTextFile(ROOT + "run.js");
  assert(src.includes("queueMicrotask"),
    "Shutdown must use queueMicrotask to avoid aborting mid-response");
});

// ── #004: jsr import for Deno 2.x std library ──────────────────────
// Bug: Old `import("https://deno.land/std/...")` broke on Deno 2.x
// which requires `jsr:@std/...` for standard library.
// Fixed: 9cecab2 — "fix: Deno fatal crash — safe shutdown, jsr import"
Deno.test("regression #004: run.js uses jsr: imports (not deno.land/std)", async () => {
  const src = await Deno.readTextFile(ROOT + "run.js");
  // The dynamic import for serveDir should use jsr: protocol
  assert(src.includes('jsr:@std/http'),
    "Must use jsr:@std/http (not https://deno.land/std/http)");
  // No active deno.land/std imports
  const lines = src.split('\n').filter(l => !l.trim().startsWith('//'));
  const oldImports = lines.filter(l => l.includes('deno.land/std'));
  assertEquals(oldImports.length, 0,
    `Found old deno.land/std imports:\n${oldImports.join('\n')}`);
});

// ── #005: Browser child unref (orphaned process fix) ────────────────
// Bug: Deno kept running because the spawned browser child process
// kept the event loop alive. Had to Ctrl+C twice.
// Fixed: 9cecab2 — ".spawn(); child.unref()"
Deno.test("regression #005: browser child is unref'd", async () => {
  const src = await Deno.readTextFile(ROOT + "run.js");
  assert(src.includes(".unref()"),
    "Browser child process must be unref'd to prevent keeping Deno alive");
});

// ── #006: Desktop shortcut uses --gossamer flag ─────────────────────
// Bug: Desktop shortcut opened browser instead of Gossamer window.
// Fixed: 82e1f7a — "fix: desktop shortcut uses run.js via --gossamer"
Deno.test("regression #006: desktop file has Exec with --gossamer", async () => {
  const desktop = await Deno.readTextFile(
    ROOT + "desktop/airborne-submarine-squadron.desktop"
  );
  assert(desktop.includes("--gossamer"),
    "Desktop entry must use --gossamer flag to launch Gossamer (not browser)");
});

// ── #007: Signal handlers for clean port release ────────────────────
// Bug: Ctrl+C left port locked. Next run got "No free port" error.
// Fixed: run.js registers SIGINT/SIGTERM handlers that abort server.
Deno.test("regression #007: SIGINT handler registered for clean shutdown", async () => {
  const src = await Deno.readTextFile(ROOT + "run.js");
  assert(src.includes("SIGINT"),
    "Must register SIGINT handler for clean port release");
  assert(src.includes("SIGTERM"),
    "Must register SIGTERM handler for clean port release");
});

// ── #008: Deep-camera world-layer integrity (underwater split fix) ─────────
// Bug: On deep dives, land/water fill used shallow/static extents and produced
// visual tearing where land appeared to drop under water.
// Fixed: shared camera-layer helpers + camera-aware view/water bounds.
Deno.test("regression #008: camera-space layer helpers guard deep-dive coverage", async () => {
  const helper = await Deno.readTextFile(ROOT + "gossamer/camera_layers.js");
  const app = await Deno.readTextFile(ROOT + "gossamer/app_gossamer.js");
  assert(helper.includes("computeWorldLayerBounds"),
    "camera_layers.js must provide computeWorldLayerBounds()");
  assert(app.includes("GossamerCameraLayers.computeWorldLayerBounds"),
    "app_gossamer.js must use shared camera layer helper");
  assert(app.includes("viewBottom = layerBounds.viewBottom"),
    "ground fill must use camera-space viewBottom");
  assert(app.includes("waterBottom = layerBounds.waterBottom"),
    "water fill must use camera-aware waterBottom");
});

// ── #009: Legacy event messaging restored (BELLYFLOP/EVEL/LIGHTNING) ───────
// Bug: legacy callouts disappeared during gameplay churn.
// Fixed: explicit notifications restored on key events.
Deno.test("regression #009: legacy event phrases still fire", async () => {
  const app = await Deno.readTextFile(ROOT + "gossamer/app_gossamer.js");
  const enemies = await Deno.readTextFile(ROOT + "gossamer/enemies.js");

  assert(app.includes("midNotice('BELLYFLOP!'"),
    "BELLYFLOP must trigger midNotice");
  assert(app.includes("ticker('BELLYFLOP!'"),
    "BELLYFLOP must trigger ticker");

  assert(enemies.includes("midNotice('EVEL TAKES THE JUMP!'"),
    "EVEL TAKES THE JUMP must trigger midNotice");

  assert(enemies.includes("midNotice('LIGHTNING SQUADRON INCOMING'"),
    "LIGHTNING SQUADRON INCOMING must trigger midNotice");
  assert(enemies.includes("ticker('Lightning squadron appearing on radar'"),
    "LIGHTNING squadron spawn must trigger ticker");
  assert(enemies.includes("hudFlash('LIGHTNING SQUADRON INCOMING'"),
    "LIGHTNING SQUADRON INCOMING must trigger hudFlash");
});

// ── #010: Canonical WASM artifact path (no legacy filename dependency) ─────
// Bug: runtime/tooling drifted between canonical and ad-hoc filenames.
// Fixed: build/runtime now standardize on airborne-submarine-squadron.wasm.
Deno.test("regression #010: no runtime dependency on airborne-final-working.wasm", async () => {
  const files = [
    "run.js",
    "build.sh",
    "launcher.sh",
    "gossamer/app_gossamer.js",
    "gossamer/launch.sh",
  ];
  for (const rel of files) {
    const src = await Deno.readTextFile(ROOT + rel);
    assert(!src.includes("airborne-final-working.wasm"),
      `${rel} must not reference legacy airborne-final-working.wasm`);
  }
});

// ── #011: Source-level step_state ABI lock (29 state + 5 input i32) ───────
Deno.test("regression #011: main.affine step_state keeps 34-arg bridge signature", async () => {
  const src = await Deno.readTextFile(ROOT + "src/main.affine");
  assert(src.includes("fn step_state("),
    "main.affine must define step_state()");
  assert(src.includes("state_tick: Int"),
    "step_state must include state_* ABI parameters");
  assert(src.includes("state_mission_failed: Int"),
    "step_state must include all 29 state fields");
  assert(src.includes("input_toggle_env: Int"),
    "step_state must include 5 input fields");
});

// ── #012: Runtime ABI constants + fail-fast diagnostics wired in JS bridge ──
// Bug: ABI shape lived only in comments, so drift could silently continue.
// Fixed: shared gossamer/wasm_abi.js constants + startup/export validation.
Deno.test("regression #012: app_gossamer consumes shared wasm ABI contract and diagnostics", async () => {
  const abi = await Deno.readTextFile(ROOT + "gossamer/wasm_abi.js");
  const app = await Deno.readTextFile(ROOT + "gossamer/app_gossamer.js");

  assert(abi.includes("const ABI_VERSION = \"1.0.0\""),
    "wasm_abi.js must pin ABI version");
  assert(abi.includes("const STEP_STATE_ARG_COUNT = STATE_FIELD_COUNT + INPUT_FIELD_COUNT"),
    "wasm_abi.js must derive step_state argument count");
  assert(abi.includes("validateExports"),
    "wasm_abi.js must expose export validation");
  assert(abi.includes("decodeSnapshot"),
    "wasm_abi.js must expose snapshot decoder");

  assert(app.includes("WASM_ABI.validateExports"),
    "app_gossamer.js must validate WASM exports at startup");
  assert(app.includes("WASM_ABI.getStartupDiagnostics"),
    "app_gossamer.js must emit ABI startup diagnostics");
  assert(app.includes("WASM co-processor disabled due to ABI mismatch"),
    "app_gossamer.js must fail-fast and disable WASM on ABI mismatch");
});
