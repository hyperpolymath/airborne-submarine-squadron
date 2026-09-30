// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Jonathan D.A. Jewell (hyperpolymath)
//
// smoke_test.js — Blitz smoke tests for Airborne Submarine Squadron.
// Fast sanity checks (<30s total). Gate for more expensive suites.
//
// Reference: standards/testing-and-benchmarking/TESTING-TAXONOMY.adoc §1

import { existsSync } from "node:fs";
import { assertEquals, assert } from "./lib/assert.js";
import { BUN, Command, envGet, readTextFile, stat, test } from "./lib/rt.js";

const ROOT = new URL('..', import.meta.url).pathname;

// ── 1. AffineScript source exists and is non-trivial ────────────────
test("smoke: src/main.affine exists and has >100 lines", async () => {
  const text = await readTextFile(ROOT + "src/main.affine");
  const lines = text.split("\n").length;
  assert(lines > 100, `main.affine has only ${lines} lines — expected >100`);
});

// ── 2. Game engine exists and is substantial ────────────────────────
test("smoke: gossamer/app_gossamer.js exists and has >1000 lines", async () => {
  const text = await readTextFile(ROOT + "gossamer/app_gossamer.js");
  const lines = text.split("\n").length;
  assert(lines > 1000, `app_gossamer.js has only ${lines} lines — expected >1000`);
});

// ── 3. Launcher exists with SPDX header ─────────────────────────────
test("smoke: run.js exists and has SPDX header", async () => {
  const text = await readTextFile(ROOT + "run.js");
  assert(/^\/\/ SPDX-License-Identifier: (MPL-2\.0|AGPL-3\.0-or-later)/.test(text),
    "run.js must start with an SPDX-License-Identifier header");
});

// ── 4. K9 coordination file is present and valid ────────────────────
test("smoke: coordination.k9 exists and starts with K9!", async () => {
  const text = await readTextFile(ROOT + "coordination.k9");
  assert(text.startsWith("K9!"), "coordination.k9 must start with K9! magic number");
});

// ── 5. WASM artifact: conditional (not tracked; see docs/RECON-2026-09.adoc) ─────────────
// The one that used to be committed returned an all-zero init_state and trapped after ~96 steps.
// Correctness of any BUILT artifact is asserted by test/wasm_artifact_test.js against the JS twin.
const BUILT = ["build", "dist"].map((d) => `${ROOT}${d}/airborne-submarine-squadron.wasm`).find((p) => existsSync(p));
test.skipIf(!BUILT)("smoke: a built WASM artifact (when present) is a non-trivial regular file", async () => {
  const info = await stat(BUILT);
  assert(info.isFile, "WASM must be a regular file");
  assert(info.size > 100, `WASM is suspiciously small: ${info.size} bytes`);
});

// ── 6. Justfile exists and has build recipe ─────────────────────────
test("smoke: Justfile exists and contains 'build' recipe", async () => {
  const text = await readTextFile(ROOT + "Justfile");
  assert(text.includes("build:"), "Justfile must have a 'build:' recipe");
});

// ── 7. LICENSE is AGPL ──────────────────────────────────────────────
test("smoke: LICENSE file exists and is a recognised licence text", async () => {
  const text = await readTextFile(ROOT + "LICENSE");
  assert(
    text.includes("Mozilla Public License Version 2.0") || text.includes("GNU AFFERO GENERAL PUBLIC LICENSE"),
    "LICENSE must contain MPL-2.0 or AGPL-3.0 text (exact match is asserted in contract_test.js)"
  );
});

// ── 8. Machine-readable state exists ────────────────────────────────
test("smoke: .machine_readable/descriptiles/STATE.a2ml exists", async () => {
  const info = await stat(ROOT + ".machine_readable/descriptiles/STATE.a2ml");
  assert(info.isFile, "STATE.a2ml must be a regular file");
});

// ── 9. run.js --reflect outputs valid JSON ──────────────────────────
test("smoke: run.js --reflect produces valid JSON", async () => {
  const cmd = new Command(BUN, {
    args: ["run", ROOT + "run.js", "--reflect"],
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

// ── 10. AffineScript type-check (conditional — needs compiler) ───────
test("smoke: test/affine/types_smoke.affine type-checks if AffineScript compiler available", async () => {
  // Try to find the AffineScript compiler
  let compilerCmd = null;
  const compilerPaths = [
    "affinescript",
    ROOT + "../nextgen-languages/affinescript/_build/default/bin/main.exe",
    ROOT + "../../developer-ecosystem/nextgen-languages/affinescript/_build/default/bin/main.exe",
  ];
  // Check PATH first
  try {
    const p = new Command("which", { args: ["affinescript"], stdout: "null", stderr: "null" });
    const { success } = await p.output();
    if (success) compilerCmd = "affinescript";
  } catch {}
  // Check sibling repo
  if (!compilerCmd) {
    for (const path of compilerPaths.slice(1)) {
      try {
        await stat(path);
        compilerCmd = path;
        break;
      } catch {}
    }
  }
  // Also check AFFINESCRIPT_REPO env var
  if (!compilerCmd) {
    const repo = envGet("AFFINESCRIPT_REPO");
    if (repo) {
      const exe = repo + "/_build/default/bin/main.exe";
      try { await stat(exe); compilerCmd = exe; } catch {}
    }
  }

  if (!compilerCmd) {
    console.log("  [skip] AffineScript compiler not found — conditional test");
    return;
  }

  const cmd = new Command(compilerCmd, {
    args: ["check", ROOT + "test/affine/types_smoke.affine"],
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stderr } = await cmd.output();
  assertEquals(code, 0,
    `test/affine/types_smoke.affine type-check failed (exit ${code}): ${new TextDecoder().decode(stderr).trim()}`);
});

// ── 11. src/main.affine type-checks if AffineScript compiler available ──
test("smoke: src/main.affine type-checks if AffineScript compiler available", async () => {
  let compilerCmd = null;
  try {
    const p = new Command("which", { args: ["affinescript"], stdout: "null", stderr: "null" });
    const { success } = await p.output();
    if (success) compilerCmd = "affinescript";
  } catch {}
  if (!compilerCmd) {
    const repo = envGet("AFFINESCRIPT_REPO");
    if (repo) {
      const exe = repo + "/_build/default/bin/main.exe";
      try { await stat(exe); compilerCmd = exe; } catch {}
    }
  }
  if (!compilerCmd) {
    const siblingExe = ROOT + "../nextgen-languages/affinescript/_build/default/bin/main.exe";
    try { await stat(siblingExe); compilerCmd = siblingExe; } catch {}
  }
  if (!compilerCmd) {
    const ecosystemExe = ROOT + "../../developer-ecosystem/nextgen-languages/affinescript/_build/default/bin/main.exe";
    try { await stat(ecosystemExe); compilerCmd = ecosystemExe; } catch {}
  }

  if (!compilerCmd) {
    console.log("  [skip] AffineScript compiler not found — conditional test");
    return;
  }

  const cmd = new Command(compilerCmd, {
    args: ["check", ROOT + "src/main.affine"],
    stdout: "piped",
    stderr: "piped",
  });
  const { code } = await cmd.output();
  assertEquals(code, 0, "src/main.affine must type-check cleanly");
});

// ── 12. run.js --help exits cleanly ─────────────────────────────────
test("smoke: run.js --help exits 0", async () => {
  const cmd = new Command(BUN, {
    args: ["run", ROOT + "run.js", "--help"],
    stdout: "piped",
    stderr: "piped",
    cwd: ROOT,
  });
  const { code, stdout } = await cmd.output();
  assertEquals(code, 0, "run.js --help must exit 0");
  const out = new TextDecoder().decode(stdout);
  assert(out.includes("Usage:"), "Help output must contain 'Usage:'");
});
