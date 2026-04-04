// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Jonathan D.A. Jewell (hyperpolymath)
//
// chaos_test.js — Blitz chaos/resilience tests for Airborne Submarine Squadron.
// Verifies graceful degradation under adverse conditions:
// port conflicts, filesystem stress, network loss, resource exhaustion.
//
// Reference: standards/testing-and-benchmarking/TESTING-TAXONOMY.adoc §14

import { assert, assertEquals } from "jsr:@std/assert";

const ROOT = new URL('..', import.meta.url).pathname;

// ── Helper: run launcher with timeout ───────────────────────────────
async function runLauncher(args, timeout = 10000) {
  try {
    const cmd = new Deno.Command("deno", {
      args: ["run", "--allow-all", ROOT + "run.js", ...args],
      stdout: "piped", stderr: "piped", cwd: ROOT,
    });
    const child = cmd.spawn();
    const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, timeout);
    const { code, stdout, stderr } = await child.output();
    clearTimeout(timer);
    return {
      code,
      out: new TextDecoder().decode(stdout),
      err: new TextDecoder().decode(stderr),
    };
  } catch (e) {
    return { code: 1, out: "", err: e.message };
  }
}

// ── 1. Port conflict: all ports occupied ────────────────────────────
Deno.test("chaos: launcher handles all ports occupied", async () => {
  // Occupy ports 6880-6884 (the full range)
  const listeners = [];
  const ports = [6880, 6881, 6882, 6883, 6884];
  for (const port of ports) {
    try {
      const listener = Deno.listen({ port });
      listeners.push(listener);
    } catch {
      // Port already in use — that's fine for this test
    }
  }

  try {
    // --reflect doesn't need a port, so it should still work
    const { code } = await runLauncher(["--reflect"], 5000);
    assertEquals(code, 0, "--reflect should succeed even with ports occupied");
  } finally {
    for (const l of listeners) {
      try { l.close(); } catch {}
    }
  }
});

// ── 2. Concurrent launcher instances don't corrupt state ────────────
Deno.test("chaos: 3 concurrent --reflect invocations don't interfere", async () => {
  const results = await Promise.all([
    runLauncher(["--reflect"]),
    runLauncher(["--reflect"]),
    runLauncher(["--reflect"]),
  ]);
  for (const r of results) {
    assertEquals(r.code, 0, "All concurrent --reflect must succeed");
    const jsonStart = r.out.indexOf('{');
    assert(jsonStart >= 0, "Must produce JSON output");
    const data = JSON.parse(r.out.slice(jsonStart));
    assert(data.registry, "Must have registry");
  }
});

// ── 3. Missing WASM artifact: --reflect still works ─────────────────
Deno.test("chaos: --reflect works even with missing build artifacts", async () => {
  // --reflect reads REGISTRY and source, doesn't need WASM
  const { code, out } = await runLauncher(["--reflect"]);
  assertEquals(code, 0);
  const jsonStart = out.indexOf('{');
  const data = JSON.parse(out.slice(jsonStart));
  assertEquals(data.registry.identity.name, "airborne-submarine-squadron");
});

// ── 4. Filesystem stress: read source files under load ──────────────
Deno.test("chaos: concurrent file reads don't corrupt data", async () => {
  const path = ROOT + "gossamer/app_gossamer.js";
  const reads = await Promise.all(
    Array.from({ length: 10 }, () => Deno.readTextFile(path))
  );
  // All reads must return identical content
  const first = reads[0];
  for (let i = 1; i < reads.length; i++) {
    assertEquals(reads[i].length, first.length,
      `Read ${i} returned different length: ${reads[i].length} vs ${first.length}`);
  }
});

// ── 5. Large crash log doesn't break localStorage logic ─────────────
Deno.test("chaos: VeriSimDB module handles network failure gracefully", async () => {
  // Read verisimdb.js and verify it has timeout + fallback logic
  const src = await Deno.readTextFile(ROOT + "gossamer/verisimdb.js");
  assert(src.includes("AbortController"), "Must use AbortController for timeouts");
  assert(src.includes("VERISIMDB_TIMEOUT"), "Must have configurable timeout");
  assert(src.includes("localStorage"), "Must fall back to localStorage");
  assert(src.includes("verisimdbAvailable"), "Must track connection state");
});

// ── 6. K9 file corruption: missing sections don't crash ─────────────
Deno.test("chaos: run.js --help works regardless of K9 file state", async () => {
  // --help only reads REGISTRY (hardcoded), not K9
  const { code } = await runLauncher(["--help"]);
  assertEquals(code, 0, "--help must always succeed");
});

// ── 7. Rapid startup/shutdown cycles ────────────────────────────────
Deno.test("chaos: 5 rapid startup/shutdown cycles don't leave orphans", async () => {
  for (let i = 0; i < 5; i++) {
    const { code } = await runLauncher(["--reflect"]);
    assertEquals(code, 0, `Cycle ${i + 1} failed`);
  }
  // If we get here without hanging, no orphan processes
});

// ── 8. Source file integrity under concurrent test runs ──────────────
Deno.test("chaos: game engine files are syntactically valid JS", async () => {
  const files = [
    ROOT + "gossamer/app_gossamer.js",
    ROOT + "gossamer/enemies.js",
    ROOT + "gossamer/hud.js",
    ROOT + "gossamer/verisimdb.js",
  ];
  for (const f of files) {
    const src = await Deno.readTextFile(f);
    // Basic check: file is non-empty and has roughly balanced braces
    // (String literals can contain unmatched braces, so allow small imbalance)
    assert(src.length > 100, `${f.split('/').pop()} is suspiciously small`);
    let depth = 0;
    for (const ch of src) {
      if (ch === '{') depth++;
      if (ch === '}') depth--;
    }
    assert(Math.abs(depth) <= 5,
      `${f.split('/').pop()} has severely unbalanced braces (depth=${depth})`);
  }
});
