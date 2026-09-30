// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Jonathan D.A. Jewell (hyperpolymath)
//
// compatibility_test.js — Blitz compatibility tests for Airborne Submarine Squadron.
// Verifies backward/forward compatibility of file formats, schemas,
// and integration points.
//
// Reference: standards/testing-and-benchmarking/TESTING-TAXONOMY.adoc §15

import { assert, assertEquals } from "./lib/assert.js";
import { existsSync } from "node:fs";
import { BUN, Command, readBytes, readTextFile, test } from "./lib/rt.js";

const ROOT = new URL('..', import.meta.url).pathname;

// ── 1. K9 schema version is 1.0.0 ──────────────────────────────────
test("compat: coordination.k9 declares schema_version 1.0.0", async () => {
  const text = await readTextFile(ROOT + "coordination.k9");
  assert(text.includes("schema_version: 1.0.0"),
    "K9 schema_version must be 1.0.0");
});

// ── 2. K9 has all required top-level sections ───────────────────────
test("compat: coordination.k9 has required sections", async () => {
  const text = await readTextFile(ROOT + "coordination.k9");
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
// Conditional by design: a compiled artifact is NOT tracked in git (the one that used to ship
// returned an all-zero init_state and trapped after ~96 steps; see docs/RECON-2026-09.adoc).
// When build.sh / CI has produced one, it must at least be real WebAssembly.
const WASM_PATH = ["build/airborne-submarine-squadron.wasm", "dist/airborne-submarine-squadron.wasm"].map((p) => ROOT + p).find((p) => existsSync(p));
test.skipIf(!WASM_PATH)("compat: WASM artifact (when built) has valid WebAssembly magic bytes", async () => {
  const buf = await readBytes(WASM_PATH, 4);
  // WebAssembly magic: \0asm (0x00 0x61 0x73 0x6d)
  assertEquals(buf[0], 0x00, "WASM byte 0 must be 0x00");
  assertEquals(buf[1], 0x61, "WASM byte 1 must be 0x61 ('a')");
  assertEquals(buf[2], 0x73, "WASM byte 2 must be 0x73 ('s')");
  assertEquals(buf[3], 0x6d, "WASM byte 3 must be 0x6d ('m')");
});

// ── 4. XDG desktop file is valid format ─────────────────────────────
test("compat: desktop file has required XDG fields", async () => {
  const text = await readTextFile(
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
test("compat: run.js --reflect JSON output round-trips", async () => {
  const cmd = new Command(BUN, {
    args: ["run", ROOT + "run.js", "--reflect"],
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
test("compat: main.affine build_snapshot starts with tick (no legacy length marker)", async () => {
  const src = await readTextFile(ROOT + "src/main.affine");
  assert(src.includes("fn build_snapshot("),
    "main.affine must define build_snapshot()");
  assert(/fn\s+build_snapshot[\s\S]*return\s*\[\s*w\.tick\s*,/.test(src),
    "build_snapshot must start array with tick");
  assert(!/fn\s+build_snapshot[\s\S]*return\s*\[\s*29\s*,/.test(src),
    "build_snapshot must not use legacy leading length marker");
});

// ── 7. HTML entry point exists and references game ──────────────────
test("compat: gossamer/index_gossamer.html exists and loads app_gossamer.js", async () => {
  const text = await readTextFile(ROOT + "gossamer/index_gossamer.html");
  assert(text.includes("app_gossamer.js"),
    "index_gossamer.html must reference app_gossamer.js");
});

// ── 8. Launcher supports all documented modes ───────────────────────
test("compat: launcher.sh supports --browser, --gossamer, --install", async () => {
  const text = await readTextFile(ROOT + "launcher.sh");
  assert(text.includes("--browser"), "Must support --browser mode");
  assert(text.includes("--gossamer"), "Must support --gossamer mode");
  assert(text.includes("--install"), "Must support --install mode");
});

// ── 9. Shared WASM ABI contract script is loaded by both entry points ──
test("compat: HTML entry points load gossamer/wasm_abi.js", async () => {
  const rootHtml = await readTextFile(ROOT + "index.html");
  const gossamerHtml = await readTextFile(ROOT + "gossamer/index_gossamer.html");
  assert(rootHtml.includes("gossamer/wasm_abi.js"),
    "index.html must load gossamer/wasm_abi.js");
  assert(gossamerHtml.includes("wasm_abi.js"),
    "gossamer/index_gossamer.html must load wasm_abi.js");
});

// ── 10. Groove manifest: conformant to the Groove spec data model (SPEC §2.1.1) ─────────
// Offers/consumes use ONLY capability types from groove's registry/groove-registry.json
// (snapshot below; update when the registry changes, and file the gap upstream rather than inventing types).
const GROOVE_CAPABILITY_TYPES = ["voice", "text", "presence", "spatial-audio", "recording", "tts", "stt", "integrity", "feed-verification",
  "hash-chain", "attestation", "octad-storage", "drift-detection", "temporal-versioning", "scanning", "static-analysis", "panel-ui",
  "bot-orchestration", "workflow", "dns-verify", "config-orchestration", "theorem-proving", "bug-reporting", "dogfood-feedback",
  "cve-analysis", "proof-exchange", "neural-dispatch", "custom"];
const GROOVE_PROTOCOLS = ["webrtc", "websocket", "http", "grpc", "nntps", "cli", "mcp", "custom"];

test("compat: www/.well-known/groove/manifest.json is a conformant, truthful ASS manifest", async () => {
  const manifest = JSON.parse(await readTextFile(ROOT + "www/.well-known/groove/manifest.json"));

  assertEquals(manifest.groove_version, "1");
  assertEquals(manifest.service_id, "airborne-submarine-squadron");
  assert(/^[a-z][a-z0-9_-]*$/.test(manifest.service_id), "service_id must match ^[a-z][a-z0-9_-]*$");
  assertEquals(manifest.mode, "active", "the running dev server serves /.well-known/groove, so the manifest is active");

  // capabilities is a MAP (never an array), non-empty, every type registered
  assert(manifest.capabilities && !Array.isArray(manifest.capabilities) && typeof manifest.capabilities === "object", "capabilities must be an object");
  const caps = Object.entries(manifest.capabilities);
  assert(caps.length > 0, "a manifest with zero capabilities has no reason to speak Groove");
  for (const [key, cap] of caps) {
    assert(GROOVE_CAPABILITY_TYPES.includes(cap.type), `capability ${key}: type ${cap.type} is not in the groove registry`);
    if (cap.protocol) assert(GROOVE_PROTOCOLS.includes(cap.protocol), `capability ${key}: protocol ${cap.protocol} not registered`);
  }
  for (const c of manifest.consumes) assert(GROOVE_CAPABILITY_TYPES.includes(c), `consumes: ${c} is not a registered capability type`);

  // truthfulness: this used to describe IDApTIK ("asymmetric co-op stealth game ... CLI build system")
  const blob = JSON.stringify(manifest).toLowerCase();
  assert(!blob.includes("stealth"), "manifest must not describe a different game");
  assert(!blob.includes("invoke_patterns"), "invoke_patterns advertised a CLI that does not exist");

  // the advertised endpoint must agree with the launcher's primary port
  const reg = JSON.parse(await (async () => {
    const p = new Command(BUN, { args: ["run", ROOT + "run.js", "--reflect"], cwd: ROOT, stdout: "piped", stderr: "null" });
    const out = new TextDecoder().decode((await p.output()).stdout);
    return out.slice(out.indexOf("{"));
  })());
  assertEquals(new URL(manifest.endpoints.groove).port, String(reg.registry.ports.primary));
  assertEquals(manifest.service_version, reg.registry.identity.version);
});
