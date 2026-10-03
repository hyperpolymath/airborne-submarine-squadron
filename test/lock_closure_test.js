// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Jonathan D.A. Jewell (hyperpolymath)
import { afterEach, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkLockClosure } from "../scripts/check-lock-closure.js";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const sha = "a".repeat(40);
const ref = `owner/action@${sha}`;
const nested = `owner/nested@${"b".repeat(40)}`;
const workflow = `jobs:\n  check:\n    steps:\n      - uses: owner/action/subpath@${sha} # v1\n`;
const lock = `workflows:
    '.github/workflows/check.yml':
        - '${ref}'
dependencies:
    '${ref}':
        commit: 'sha1-${sha}'
        ref: v1
        uses:
            - '${nested}'
    '${nested}':
        commit: 'sha1-${"b".repeat(40)}'
        ref: v2
`;

function fixture(lockText = lock, workflowText = workflow) {
  const root = mkdtempSync(join(tmpdir(), "ass-lock-closure-"));
  roots.push(root);
  mkdirSync(join(root, ".github/workflows"), { recursive: true });
  writeFileSync(join(root, ".github/workflows/actions.lock"), lockText);
  writeFileSync(join(root, ".github/workflows/check.yml"), workflowText);
  return root;
}

function rejects(lockText, workflowText, message) {
  const { errors } = checkLockClosure(fixture(lockText, workflowText));
  expect(errors.some((error) => error.includes(message))).toBe(true);
}

test("lock closure: accepts subpath actions and closed transitive dependencies", () => {
  const result = checkLockClosure(fixture());
  expect(result.errors).toEqual([]);
  expect(result.summary).toBe("actions.lock OK: 1 direct refs in 1 workflows; 2 dependency records; transitively closed");
});

test("lock closure: rejects an unlocked workflow reference", () => {
  rejects(lock.replace(`        - '${ref}'\n`, ""), workflow, "clause 1:");
});

test("lock closure: rejects an orphan reference", () => {
  rejects(lock, "jobs: {}\n", "no longer referenced (orphan)");
});

test("lock closure: rejects a lock entry for a deleted workflow", () => {
  rejects(lock.replace("check.yml", "deleted.yml"), workflow, "which does not exist");
});

test("lock closure: rejects a dangling transitive dependency", () => {
  rejects(lock.slice(0, lock.indexOf(`    '${nested}':`)), workflow, `clause 3 (FATAL): \`${nested}\``);
});

test("lock closure: rejects a missing direct dependency record", () => {
  rejects(lock.slice(0, lock.indexOf("dependencies:")) + "dependencies:\n", workflow, `clause 3 (FATAL): \`${ref}\``);
});

test("lock closure: rejects stale version comments and commit metadata", () => {
  rejects(lock, workflow.replace("# v1", "# v0"), "comment mismatch:");
  rejects(lock.replace(`sha1-${sha}`, `sha1-${"c".repeat(40)}`), workflow, "commit mismatch for");
});

test("lock closure: retains local, Docker and standards reusable exclusions", () => {
  const extra = "      - uses: ./local\n      - uses: docker://alpine:3\n      - uses: hyperpolymath/standards/.github/workflows/governance-reusable.yml@123\n";
  expect(checkLockClosure(fixture(lock, workflow + extra)).errors).toEqual([]);
});

test("lock closure: CLI resolves paths relative to script and fails on violations", () => {
  const root = fixture();
  mkdirSync(join(root, "scripts"));
  const script = join(root, "scripts/check-lock-closure.js");
  copyFileSync(new URL("../scripts/check-lock-closure.js", import.meta.url), script);
  const run = () => Bun.spawnSync([process.execPath, script], { cwd: tmpdir() });
  const passed = run();
  expect(passed.exitCode).toBe(0);
  expect(passed.stdout.toString()).toContain("actions.lock OK:");
  writeFileSync(join(root, ".github/workflows/check.yml"), "jobs: {}\n");
  const failed = run();
  expect(failed.exitCode).toBe(1);
  expect(failed.stdout.toString()).toContain("no longer referenced (orphan)");
});
