#!/usr/bin/env bun
// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Jonathan D.A. Jewell (hyperpolymath)
/**
 * Dependency-free Bun counterpart to check-lock-sync.sh for machines without gawk.
 * Checks direct workflow refs, orphan lock entries, transitive closure, and
 * SHA/ref comment agreement. A named ref without a dependency record can prevent
 * GitHub from starting the workflow, even when all direct refs are locked.
 * The lock format is a fixed, simple shape; no YAML dependency is required.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const USES = /^\s*(?:-\s*)?uses:\s*([^\s#]+)(?:\s*#\s*(\S+))?/gm;
const norm = (ref) => ref.replace(/^([^/@]+\/[^/@]+)(?:\/[^@]+)?@/, "$1@");

function parseLock(text) {
  const workflows = new Map();
  const deps = new Map();
  let cur, section, sub;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("workflows:")) { section = "w"; continue; }
    if (line.startsWith("dependencies:")) { section = "d"; continue; }
    let match = line.match(/^    '([^']+)':\s*(\[\])?$/);
    if (match) {
      cur = match[1];
      sub = undefined;
      const records = section === "w" ? workflows : deps;
      if (!records.has(cur)) records.set(cur, section === "w" ? [] : { uses: [] });
      continue;
    }
    match = line.match(/^        - '([^']+)'$/);
    if (match && section === "w") { workflows.get(cur).push(match[1]); continue; }
    if (section === "d") {
      if (/^        uses:\s*$/.test(line)) { sub = "uses"; continue; }
      match = line.match(/^            - '([^']+)'$/);
      if (match && sub === "uses") { deps.get(cur).uses.push(match[1]); continue; }
      match = line.match(/^        (\w+):\s*'?([^']*)'?$/);
      if (match) { sub = undefined; deps.get(cur)[match[1]] = match[2]; }
    }
  }
  return { workflows, deps };
}

export function checkLockClosure(root = ROOT) {
  const dir = join(root, ".github/workflows");
  const { workflows, deps } = parseLock(readFileSync(join(dir, "actions.lock"), "utf8"));
  const errors = [];
  const actual = new Map();
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".yml")).sort()) {
    const refs = new Map();
    for (const match of readFileSync(join(dir, file), "utf8").matchAll(USES)) {
      const ref = match[1];
      if (["./", "docker://", "hyperpolymath/standards/"].some((prefix) => ref.startsWith(prefix))) continue;
      refs.set(norm(ref), match[2] || "");
    }
    actual.set(`.github/workflows/${file}`, refs);
  }
  for (const [name, refs] of actual) {
    const locked = new Set(workflows.get(name) || []);
    for (const ref of refs.keys()) {
      if (!locked.has(ref)) errors.push(`clause 1: ${name}: \`${ref}\` is used but not locked`);
    }
  }
  for (const [name, locked] of workflows) {
    if (!actual.has(name)) {
      errors.push(`clause 2: lock lists workflow ${name} which does not exist`);
      continue;
    }
    for (const ref of locked) {
      if (!actual.get(name).has(ref)) errors.push(`clause 2: ${name}: lock entry \`${ref}\` is no longer referenced (orphan)`);
    }
  }
  const named = new Set([...workflows.values()].flat().concat([...deps.values()].flatMap((dep) => dep.uses)));
  for (const ref of [...named].sort()) {
    if (!deps.has(ref)) errors.push(`clause 3 (FATAL): \`${ref}\` is named in the lock but has no dependencies: record — GitHub will refuse to start the workflow`);
  }
  for (const [name, refs] of actual) {
    for (const [ref, comment] of refs) {
      const dep = deps.get(ref);
      if (dep && comment && dep.ref !== comment) {
        errors.push(`comment mismatch: ${name}: \`${ref}\` says \`# ${comment}\` but the lock records ref ${dep.ref}`);
      }
      const sha = ref.split("@").slice(1).join("@");
      if (dep && dep.commit !== `sha1-${sha}`) errors.push(`commit mismatch for ${ref}: lock says ${dep.commit}`);
    }
  }
  const count = [...actual.values()].reduce((sum, refs) => sum + refs.size, 0);
  return {
    errors,
    summary: `actions.lock OK: ${count} direct refs in ${actual.size} workflows; ${deps.size} dependency records; transitively closed`,
  };
}

if (import.meta.main) {
  const { errors, summary } = checkLockClosure();
  if (errors.length) {
    console.log("actions.lock problems:");
    for (const error of errors) console.log("  -", error);
    process.exitCode = 1;
  } else {
    console.log(summary);
  }
}
