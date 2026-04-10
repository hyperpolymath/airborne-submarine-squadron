// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Jonathan D.A. Jewell (hyperpolymath)
//
// contract_test.js — Blitz contract/invariant tests for Airborne Submarine Squadron.
// Verifies that K9 coordination invariants hold against the actual filesystem.
//
// Reference: standards/testing-and-benchmarking/TESTING-TAXONOMY.adoc §12

import { assertEquals, assert } from "jsr:@std/assert";

const ROOT = new URL('..', import.meta.url).pathname;

// ── Helper: recursive file listing ──────────────────────────────────
async function walkFiles(dir, filter = () => true) {
  const files = [];
  for await (const entry of Deno.readDir(dir)) {
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
Deno.test("contract: no TypeScript files anywhere in repo", async () => {
  const tsFiles = await walkFiles(ROOT, (name) => /\.tsx?$/.test(name));
  assertEquals(tsFiles.length, 0,
    `TypeScript files found (K9 invariant no-typescript violated):\n${tsFiles.join('\n')}`);
});

// ── 2. No npm artifacts (K9 invariant: no-npm-package-managers) ─────
Deno.test("contract: no package-lock.json, node_modules, bun.lockb, yarn.lock", async () => {
  const banned = ['package-lock.json', 'bun.lockb', 'yarn.lock'];
  for (const name of banned) {
    try {
      await Deno.stat(ROOT + name);
      throw new Error(`Banned file found: ${name} (K9 invariant no-npm-package-managers)`);
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) continue;
      throw e;
    }
  }
  try {
    await Deno.stat(ROOT + 'node_modules');
    throw new Error('node_modules/ exists (K9 invariant no-npm-package-managers)');
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
});

// ── 3. AGPL license (K9 invariant: agpl-license) ───────────────────
Deno.test("contract: LICENSE is AGPL-3.0-or-later", async () => {
  const license = await Deno.readTextFile(ROOT + "LICENSE");
  assert(
    license.includes("GNU AFFERO GENERAL PUBLIC LICENSE") ||
    license.includes("AGPL-3.0"),
    "LICENSE must be AGPL-3.0 (K9 invariant agpl-license)"
  );
});

// ── 4. Port 6880 in REGISTRY (K9 invariant: port-6880) ─────────────
Deno.test("contract: run.js REGISTRY uses port 6880", async () => {
  const src = await Deno.readTextFile(ROOT + "run.js");
  assert(src.includes("primary:  6880") || src.includes("primary: 6880"),
    "REGISTRY.ports.primary must be 6880");
});

// ── 5. Standalone repo (K9 invariant: standalone-repo) ──────────────
Deno.test("contract: .git exists — repo is standalone, not monorepo subdir", async () => {
  const info = await Deno.stat(ROOT + ".git");
  assert(info.isDirectory, "Must have own .git directory (K9 invariant standalone-repo)");
});

// ── 6. Machine-readable files are A2ML, not SCM ────────────────────
Deno.test("contract: .machine_readable/ contains .a2ml files, not .scm", async () => {
  const mrDir = ROOT + ".machine_readable";
  const a2mlFiles = [];
  const scmFiles = [];
  for await (const entry of Deno.readDir(mrDir)) {
    if (entry.name.endsWith('.a2ml')) a2mlFiles.push(entry.name);
    if (entry.name.endsWith('.scm')) scmFiles.push(entry.name);
  }
  assert(a2mlFiles.length > 0, "Must have at least one .a2ml file");
  assertEquals(scmFiles.length, 0,
    `SCM files found in .machine_readable/ (should be A2ML):\n${scmFiles.join('\n')}`);
});

// ── 7. All JS source files have SPDX headers ───────────────────────
Deno.test("contract: all JS source files have AGPL SPDX header", async () => {
  const jsFiles = await walkFiles(ROOT, (name, path) =>
    name.endsWith('.js') &&
    !path.includes('/archive/') &&
    !path.includes('/build/') &&
    !path.includes('/node_modules/') &&
    !path.includes('/target/')
  );
  const missing = [];
  for (const f of jsFiles) {
    const text = await Deno.readTextFile(f);
    if (!text.includes('SPDX-License-Identifier:')) {
      missing.push(f.replace(ROOT, ''));
    }
  }
  assertEquals(missing.length, 0,
    `JS files missing SPDX header:\n${missing.join('\n')}`);
});

// ── 8. Protected paths from K9 all exist ────────────────────────────
Deno.test("contract: all K9-protected paths exist", async () => {
  const protectedPaths = [
    'gossamer/',
    'tray/',
    'src/',
    'build/',
    'launcher.sh',
    '.machine_readable/',
    'coordination.k9',
  ];
  const missing = [];
  for (const p of protectedPaths) {
    try {
      await Deno.stat(ROOT + p);
    } catch {
      missing.push(p);
    }
  }
  assertEquals(missing.length, 0,
    `Protected paths missing:\n${missing.join('\n')}`);
});

// ── 9. AffineScript engine invariant (K9: affinescript-engine) ──────
Deno.test("contract: src/main.affine is AffineScript, not JS framework", async () => {
  const text = await Deno.readTextFile(ROOT + "src/main.affine");
  assert(text.includes("fn main()"), "main.affine must contain 'fn main()' (AffineScript)");
  assert(text.includes("type World"), "main.affine must define World type");
  // Negative: no JS framework imports
  assert(!text.includes("import React"), "main.affine must not import React");
  assert(!text.includes("import Phaser"), "main.affine must not import Phaser");
});
