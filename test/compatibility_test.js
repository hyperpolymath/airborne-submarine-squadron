// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Jonathan D.A. Jewell (hyperpolymath)
//
// compatibility_test.js — Blitz compatibility tests for Airborne Submarine Squadron.
// Verifies backward/forward compatibility of file formats, schemas,
// and integration points.
//
// Reference: standards/testing-and-benchmarking/TESTING-TAXONOMY.adoc §15

import { assert, assertEquals } from "jsr:@std/assert";

const ROOT = new URL('..', import.meta.url).pathname;

// ── 1. K9 schema version is 1.0.0 ──────────────────────────────────
Deno.test("compat: coordination.k9 declares schema_version 1.0.0", async () => {
  const text = await Deno.readTextFile(ROOT + "coordination.k9");
  assert(text.includes("schema_version: 1.0.0"),
    "K9 schema_version must be 1.0.0");
});

// ── 2. K9 has all required top-level sections ───────────────────────
Deno.test("compat: coordination.k9 has required sections", async () => {
  const text = await Deno.readTextFile(ROOT + "coordination.k9");
  const requiredSections = [
    'metadata:', 'project:', 'build_commands:',
    'invariants:', 'protected:', 'architecture:',
  ];
  for (const section of requiredSections) {
    assert(text.includes(section),
      `Missing required K9 section: ${section}`);
  }
});

// ── 3. WASM file has valid magic bytes ──────────────────────────────
Deno.test("compat: WASM artifact has valid WebAssembly magic bytes", async () => {
  const file = await Deno.open(ROOT + "dist/airborne-submarine-squadron.wasm");
  const buf = new Uint8Array(4);
  await file.read(buf);
  file.close();
  // WebAssembly magic: \0asm (0x00 0x61 0x73 0x6d)
  assertEquals(buf[0], 0x00, "WASM byte 0 must be 0x00");
  assertEquals(buf[1], 0x61, "WASM byte 1 must be 0x61 ('a')");
  assertEquals(buf[2], 0x73, "WASM byte 2 must be 0x73 ('s')");
  assertEquals(buf[3], 0x6d, "WASM byte 3 must be 0x6d ('m')");
});

// ── 4. XDG desktop file is valid format ─────────────────────────────
Deno.test("compat: desktop file has required XDG fields", async () => {
  const text = await Deno.readTextFile(
    ROOT + "desktop/airborne-submarine-squadron.desktop"
  );
  assert(text.includes("[Desktop Entry]"),
    "Must start with [Desktop Entry] section");
  assert(text.includes("Type=Application"),
    "Must declare Type=Application");
  assert(text.includes("Name="),
    "Must have Name= field");
  assert(text.includes("Exec="),
    "Must have Exec= field");
});

// ── 5. run.js REGISTRY JSON round-trips cleanly ────────────────────
Deno.test("compat: run.js --reflect JSON output round-trips", async () => {
  const cmd = new Deno.Command("deno", {
    args: ["run", "--allow-all", ROOT + "run.js", "--reflect"],
    stdout: "piped",
    stderr: "piped",
    cwd: ROOT,
  });
  const { code, stdout } = await cmd.output();
  assertEquals(code, 0);
  const text = new TextDecoder().decode(stdout);
  // Output includes an ANSI-coloured header line before the JSON.
  const jsonStart = text.indexOf('{');
  assert(jsonStart >= 0, "No JSON object found in --reflect output");
  const parsed = JSON.parse(text.slice(jsonStart));
  const reparsed = JSON.parse(JSON.stringify(parsed));
  assertEquals(parsed, reparsed, "JSON must survive serialization round-trip");
});

// ── 6. AffineScript source has canonical 29-field snapshot payload ───
Deno.test("compat: main.affine build_snapshot starts with tick (no legacy length marker)", async () => {
  const src = await Deno.readTextFile(ROOT + "src/main.affine");
  assert(src.includes("fn build_snapshot("),
    "main.affine must define build_snapshot()");
  assert(/fn\s+build_snapshot[\s\S]*return\s*\[\s*w\.tick\s*,/.test(src),
    "build_snapshot must start array with tick");
  assert(!/fn\s+build_snapshot[\s\S]*return\s*\[\s*29\s*,/.test(src),
    "build_snapshot must not use legacy leading length marker");
});

// ── 7. HTML entry point exists and references game ──────────────────
Deno.test("compat: gossamer/index_gossamer.html exists and loads app_gossamer.js", async () => {
  const text = await Deno.readTextFile(ROOT + "gossamer/index_gossamer.html");
  assert(text.includes("app_gossamer.js"),
    "index_gossamer.html must reference app_gossamer.js");
});

// ── 8. Launcher supports all documented modes ───────────────────────
Deno.test("compat: launcher.sh supports --browser, --gossamer, --install", async () => {
  const text = await Deno.readTextFile(ROOT + "launcher.sh");
  assert(text.includes("--browser"), "Must support --browser mode");
  assert(text.includes("--gossamer"), "Must support --gossamer mode");
  assert(text.includes("--install"), "Must support --install mode");
});
