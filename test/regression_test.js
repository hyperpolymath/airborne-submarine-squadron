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
