// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Jonathan D.A. Jewell (hyperpolymath)
//
// smoke_test.js — Blitz smoke tests for Airborne Submarine Squadron.
// Fast sanity checks (<30s total). Gate for more expensive suites.
//
// Reference: standards/testing-and-benchmarking/TESTING-TAXONOMY.adoc §1

import { assertEquals, assert } from "jsr:@std/assert";

const ROOT = new URL('..', import.meta.url).pathname;

// ── 1. AffineScript source exists and is non-trivial ────────────────
Deno.test("smoke: src/main.as exists and has >100 lines", async () => {
  const text = await Deno.readTextFile(ROOT + "src/main.as");
  const lines = text.split("\n").length;
  assert(lines > 100, `main.as has only ${lines} lines — expected >100`);
});

// ── 2. Game engine exists and is substantial ────────────────────────
Deno.test("smoke: gossamer/app_gossamer.js exists and has >1000 lines", async () => {
  const text = await Deno.readTextFile(ROOT + "gossamer/app_gossamer.js");
  const lines = text.split("\n").length;
  assert(lines > 1000, `app_gossamer.js has only ${lines} lines — expected >1000`);
});

// ── 3. Launcher exists with SPDX header ─────────────────────────────
Deno.test("smoke: run.js exists and has SPDX header", async () => {
  const text = await Deno.readTextFile(ROOT + "run.js");
  assert(text.startsWith("// SPDX-License-Identifier: AGPL-3.0-or-later"),
    "run.js must start with AGPL SPDX header");
});

// ── 4. K9 coordination file is present and valid ────────────────────
Deno.test("smoke: coordination.k9 exists and starts with K9!", async () => {
  const text = await Deno.readTextFile(ROOT + "coordination.k9");
  assert(text.startsWith("K9!"), "coordination.k9 must start with K9! magic number");
});

// ── 5. WASM artifact exists in dist/ ────────────────────────────────
Deno.test("smoke: dist/airborne-submarine-squadron.wasm exists", async () => {
  const info = await Deno.stat(ROOT + "dist/airborne-submarine-squadron.wasm");
  assert(info.isFile, "WASM must be a regular file");
  assert(info.size > 100, `WASM is suspiciously small: ${info.size} bytes`);
});

// ── 6. Justfile exists and has build recipe ─────────────────────────
Deno.test("smoke: Justfile exists and contains 'build' recipe", async () => {
  const text = await Deno.readTextFile(ROOT + "Justfile");
  assert(text.includes("build:"), "Justfile must have a 'build:' recipe");
});

// ── 7. LICENSE is AGPL ──────────────────────────────────────────────
Deno.test("smoke: LICENSE file exists and is AGPL-3.0", async () => {
  const text = await Deno.readTextFile(ROOT + "LICENSE");
  assert(
    text.includes("GNU AFFERO GENERAL PUBLIC LICENSE") ||
    text.includes("AGPL") ||
    text.includes("Affero"),
    "LICENSE must contain AGPL text"
  );
});

// ── 8. Machine-readable state exists ────────────────────────────────
Deno.test("smoke: .machine_readable/STATE.a2ml exists", async () => {
  const info = await Deno.stat(ROOT + ".machine_readable/STATE.a2ml");
  assert(info.isFile, "STATE.a2ml must be a regular file");
});

// ── 9. run.js --reflect outputs valid JSON ──────────────────────────
Deno.test("smoke: run.js --reflect produces valid JSON", async () => {
  const cmd = new Deno.Command("deno", {
    args: ["run", "--allow-all", ROOT + "run.js", "--reflect"],
    stdout: "piped",
    stderr: "piped",
    cwd: ROOT,
  });
  const { code, stdout } = await cmd.output();
  assertEquals(code, 0, "run.js --reflect must exit 0");
  const out = new TextDecoder().decode(stdout);
  // Output includes an ANSI-coloured header line before the JSON object.
  // Find the first '{' to locate the JSON start.
  const jsonStart = out.indexOf('{');
  assert(jsonStart >= 0, "No JSON object found in --reflect output");
  const data = JSON.parse(out.slice(jsonStart));
  assert(data.registry, "JSON must contain 'registry' key");
  assert(data.registry.identity.name === "airborne-submarine-squadron",
    "Registry identity must be airborne-submarine-squadron");
});

// ── 10. run.js --help exits cleanly ─────────────────────────────────
Deno.test("smoke: run.js --help exits 0", async () => {
  const cmd = new Deno.Command("deno", {
    args: ["run", "--allow-all", ROOT + "run.js", "--help"],
    stdout: "piped",
    stderr: "piped",
    cwd: ROOT,
  });
  const { code, stdout } = await cmd.output();
  assertEquals(code, 0, "run.js --help must exit 0");
  const out = new TextDecoder().decode(stdout);
  assert(out.includes("Usage:"), "Help output must contain 'Usage:'");
});
