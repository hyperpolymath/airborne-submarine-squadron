// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Jonathan D.A. Jewell (hyperpolymath)
//
// contract_test.js — Blitz contract/invariant tests for Airborne Submarine Squadron.
// Verifies that K9 coordination invariants hold against the actual filesystem.
//
// Reference: standards/testing-and-benchmarking/TESTING-TAXONOMY.adoc §12

import { assertEquals, assert } from "./lib/assert.js";
import { BUN, Command, NotFound, readDir, readTextFile, stat, test } from "./lib/rt.js";

const ROOT = new URL('..', import.meta.url).pathname;

// ── Helper: recursive file listing ──────────────────────────────────
async function walkFiles(dir, filter = () => true) {
  const files = [];
  for await (const entry of readDir(dir)) {
    const path = dir + '/' + entry.name;
    if (entry.name.startsWith('.git') && entry.name !== '.github') continue;
    if (entry.name === 'node_modules') continue;
    if (entry.name === 'target') continue; // Rust build output
    if (entry.isDirectory) {
      files.push(...await walkFiles(path, filter));
    } else if (filter(entry.name, path)) {
      files.push(path);
    }
  }
  return files;
}

// ── 1. No TypeScript files (K9 invariant: no-typescript) ────────────
test("contract: no TypeScript files anywhere in repo", async () => {
  const tsFiles = await walkFiles(ROOT, (name) => /\.tsx?$/.test(name));
  assertEquals(tsFiles.length, 0,
    `TypeScript files found (K9 invariant no-typescript violated):\n${tsFiles.join('\n')}`);
});

// ── 2. Package policy (estate LANGUAGE-POLICY, owner ruling 2026-09-22): Bun is tier 1 ─────
// package.json + bun.lock are EXPECTED (Bun's manifest); Deno and the npm/yarn/pnpm lockfiles are not.
test("contract: Bun manifest present, zero-dependency and private; no Deno/npm/yarn/pnpm artifacts", async () => {
  const pkg = JSON.parse(await readTextFile(ROOT + "package.json"));
  assertEquals(pkg.private, true, "package.json must be private (this is a game, not a library)");
  assertEquals(pkg.type, "module");
  assertEquals(Object.keys(pkg.dependencies ?? {}).length, 0, "runtime dependencies: none (the game ships dependency-free)");
  assertEquals(Object.keys(pkg.devDependencies ?? {}).length, 0, "devDependencies: none (bun:test is built in)");
  assert(pkg.scripts && pkg.scripts.test === "bun test", 'scripts.test must be "bun test"');

  const banned = ["package-lock.json", ".npmignore", "bun.lockb", "yarn.lock", "pnpm-lock.yaml", "deno.json", "deno.jsonc", "deno.lock"];
  const found = [];
  for (const name of banned) {
    try { await stat(ROOT + name); found.push(name); } catch (e) { if (!(e instanceof NotFound)) throw e; }
  }
  assertEquals(found, [], `banned package-manager artifacts present: ${found.join(", ")}`);
  try { await stat(ROOT + "node_modules"); throw new Error("node_modules/ exists"); }
  catch (e) { if (!(e instanceof NotFound)) throw e; }
});

// ── 3. Licence: LICENSE text, run.js REGISTRY and SPDX headers must all agree ───────────────
const LICENCE_TEXT = { "MPL-2.0": "Mozilla Public License Version 2.0", "AGPL-3.0-or-later": "GNU AFFERO GENERAL PUBLIC LICENSE" };
test("contract: LICENSE text matches the licence declared in run.js REGISTRY", async () => {
  const { stdout } = await new Command(BUN, { args: ["run", ROOT + "run.js", "--reflect"], cwd: ROOT, stderr: "null" }).output();
  const out = new TextDecoder().decode(stdout);
  const declared = JSON.parse(out.slice(out.indexOf("{"))).registry.identity.license;
  assert(declared in LICENCE_TEXT, `unknown declared licence ${declared}`);
  const license = await readTextFile(ROOT + "LICENSE");
  assert(license.includes(LICENCE_TEXT[declared]), `LICENSE must contain the ${declared} text`);
  assert(await (async () => { try { return (await stat(`${ROOT}LICENSES/${declared}.txt`)).isFile; } catch { return false; } })(),
    `LICENSES/${declared}.txt must exist (REUSE layout)`);
});

// ── 4. Port 6880 in REGISTRY (K9 invariant: port-6880) ─────────────
test("contract: run.js REGISTRY uses port 6880", async () => {
  const src = await readTextFile(ROOT + "run.js");
  assert(src.includes("primary:  6880") || src.includes("primary: 6880"),
    "REGISTRY.ports.primary must be 6880");
});

// ── 5. Standalone repo (K9 invariant: standalone-repo) ──────────────
test("contract: .git exists — repo is standalone, not monorepo subdir", async () => {
  const info = await stat(ROOT + ".git");
  assert(info.isDirectory, "Must have own .git directory (K9 invariant standalone-repo)");
});

// ── 6. Machine-readable files are A2ML, not SCM ────────────────────
test("contract: .machine_readable/ contains .a2ml files, not .scm", async () => {
  const mrDir = ROOT + ".machine_readable";
  const a2mlFiles = [];
  const scmFiles = [];
  for await (const entry of readDir(mrDir)) {
    if (entry.name.endsWith('.a2ml')) a2mlFiles.push(entry.name);
    if (entry.name.endsWith('.scm')) scmFiles.push(entry.name);
  }
  assert(a2mlFiles.length > 0, "Must have at least one .a2ml file");
  assertEquals(scmFiles.length, 0,
    `SCM files found in .machine_readable/ (should be A2ML):\n${scmFiles.join('\n')}`);
});

// ── 7. All JS source files have SPDX headers ───────────────────────
test("contract: all JS source files have AGPL SPDX header", async () => {
  const jsFiles = await walkFiles(ROOT, (name, path) =>
    name.endsWith('.js') &&
    !path.includes('/archive/') &&
    !path.includes('/build/') &&
    !path.includes('/node_modules/') &&
    !path.includes('/target/')
  );
  const missing = [];
  for (const f of jsFiles) {
    const text = await readTextFile(f);
    if (!text.includes('SPDX-License-Identifier:')) {
      missing.push(f.replace(ROOT, ''));
    }
  }
  assertEquals(missing.length, 0,
    `JS files missing SPDX header:\n${missing.join('\n')}`);
});

// ── 8. Protected paths from K9 all exist ────────────────────────────
test("contract: all K9-protected paths exist", async () => {
  const protectedPaths = [
    'gossamer/',
    'tray/',
    'src/',
    'launcher.sh',
    '.machine_readable/',
    'coordination.k9',
  ];
  const missing = [];
  for (const p of protectedPaths) {
    try {
      await stat(ROOT + p);
    } catch {
      missing.push(p);
    }
  }
  assertEquals(missing.length, 0,
    `Protected paths missing:\n${missing.join('\n')}`);
});

// ── 9. AffineScript engine invariant (K9: affinescript-engine) ──────
test("contract: src/main.affine is AffineScript, not JS framework", async () => {
  const text = await readTextFile(ROOT + "src/main.affine");
  assert(
    text.includes("fn create_world()") || text.includes("fn step_state("),
    "main.affine must define AffineScript world/step entrypoints"
  );
  assert(text.includes("type World"), "main.affine must define World type");
  // Negative: no JS framework imports
  assert(!text.includes("import React"), "main.affine must not import React");
  assert(!text.includes("import Phaser"), "main.affine must not import Phaser");
});
