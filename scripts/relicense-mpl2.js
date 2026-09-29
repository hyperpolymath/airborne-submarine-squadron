// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Jonathan D.A. Jewell (hyperpolymath)
//
// relicense-mpl2.js — OWNER-RUN migration of this repository's CODE licence from AGPL-3.0-or-later to MPL-2.0.
//
//   bun run scripts/relicense-mpl2.js                  dry run: lists every change, writes nothing (DEFAULT)
//   ASS_RELICENSE_OWNER_CONFIRM=yes bun run scripts/relicense-mpl2.js --apply
//
// WHY IT IS A SCRIPT THE OWNER RUNS, NOT A COMMIT AN AGENT MADE:
//   Estate doctrine 6 (CLAUDE.md): "No automated licence edits — ever — manual, owner-only."  Relicensing also needs
//   the agreement of EVERY copyright holder (see docs/decisions/ADR-0002-licence-mpl-2.0.adoc: hyperpolymath and
//   JoshuaJewell, plus a decision on AI-assisted contributions).  An agent must not make that call, so it was STAGED:
//   written, tested in a scratch copy, and left for you.
//
// What it changes (and only this):
//   * `SPDX-License-Identifier: AGPL-3.0-or-later` -> `MPL-2.0` in tracked CODE/CONFIG files
//     (docs keep CC-BY-SA-4.0; vendored upstream MPL files are untouched; archive/ is history and is untouched)
//   * LICENSE <- LICENSES/MPL-2.0.txt ; LICENSES/AGPL-3.0-or-later.txt is removed once nothing references it
//   * licence metadata: run.js, package.json, CITATION.cff, tray/Cargo.toml, packaging/rpm spec, machine-readable manifests
//   * the AGPL-only invariant in 0-AI-MANIFEST.a2ml / coordination.k9 / AGENTS.adoc (replaced by the owner-only rule)
//   * the README licence block (between the LICENCE-STATUS markers) and badge
//
// It does NOT touch git history (releases already distributed under AGPL stay AGPL for their recipients), and it does
// NOT commit: review `git diff`, then commit and sign it yourself.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apply = process.argv.includes("--apply");
const FROM = "AGPL-3.0-or-later", TO = "MPL-2.0";

if (apply && process.env.ASS_RELICENSE_OWNER_CONFIRM !== "yes") {
  console.error("Refusing: set ASS_RELICENSE_OWNER_CONFIRM=yes (you are the owner, and every copyright holder has agreed).");
  process.exit(2);
}
if (!existsSync(resolve(ROOT, "LICENSES/MPL-2.0.txt"))) { console.error("LICENSES/MPL-2.0.txt missing"); process.exit(2); }
if (apply) {
  const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: ROOT }).toString().trim();
  if (dirty) { console.error("Refusing: working tree is not clean (commit or stash first, so the diff is exactly this migration)."); process.exit(2); }
}

const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT }).toString().split("\0").filter(Boolean);
const SKIP = (f) => f.startsWith("archive/") || f.startsWith("LICENSES/") || f === "LICENSE" || f.startsWith("test/fixtures/")
  || /\.(png|ico|gz|wasm|wav|midi|pdf|lock|svg)$/.test(f)
  || ["scripts/update-actions-lock.sh", "scripts/check-root-shape.sh", "scripts/check-lock-sync.sh"].includes(f);

const report = [];
function edit(file, fn, why) {
  const p = resolve(ROOT, file);
  if (!existsSync(p)) return;
  const before = readFileSync(p, "utf8"), after = fn(before);
  if (after !== before) { report.push(`${file}  —  ${why}`); if (apply) writeFileSync(p, after); }
}

// 1. SPDX headers in code/config (docs carry CC-BY-SA-4.0 and are not matched)
for (const f of tracked) {
  if (SKIP(f)) continue;
  edit(f, (s) => s.replaceAll(`SPDX-License-Identifier: ${FROM}`, `SPDX-License-Identifier: ${TO}`), "SPDX header");
}

// 2. licence metadata
edit("run.js", (s) => s.replace(`license: "${FROM}"`, `license: "${TO}"`), "REGISTRY.identity.license");
edit("package.json", (s) => s.replace(`"license": "${FROM}"`, `"license": "${TO}"`), "package.json license");
edit("CITATION.cff", (s) => s.replace(`license: ${FROM}`, `license: ${TO}`), "CITATION.cff license");
edit("tray/Cargo.toml", (s) => s.replace(`license = "${FROM}"`, `license = "${TO}"`), "Cargo license");
edit("packaging/rpm/airborne-submarine-squadron.spec", (s) => s.replace(`License:        ${FROM}`, `License:        ${TO}`), "rpm License:");
edit("build/guix.scm", (s) => s.replace("(license agpl3+)", "(license mpl2.0)"), "guix licence");
edit(".machine_readable/descriptiles/ECOSYSTEM.a2ml", (s) => s.replace(`(license "${FROM}")`, `(license "${TO}")`), "ECOSYSTEM license");
edit("0-AI-MANIFEST.a2ml", (s) => s
  .replace(`(license "${FROM}")`, `(license "${TO}")`)
  .replace(/Licence: currently AGPL-3\.0-or-later; an owner-run migration to MPL-2\.0 is staged but NOT applied\s*\(docs\/decisions\/ADR-0002-licence-mpl-2\.0\.adoc\)\./,
    "Licence: MPL-2.0 (migrated from AGPL-3.0-or-later; docs/decisions/ADR-0002-licence-mpl-2.0.adoc).")
  .replace(/\(rule "Licence changes are OWNER-ONLY[^\n]*\n/, `(rule "MPL-2.0 (code) + CC-BY-SA-4.0 (docs). Licence changes are OWNER-ONLY and MANUAL (estate doctrine 6).")\n`),
  "manifest licence + invariant");

// 3. the AGPL-only invariant in coordination.k9 (and the generated AGENTS text)
edit("coordination.k9", (s) => s
  .replace(`  license: ${FROM}`, `  license: ${TO}`)
  .replace(/  - id: agpl-license\n    rule: "[^\n]*"\n    reason: "[^\n]*"\n/,
    `  - id: licence-owner-only\n    rule: "Code is MPL-2.0, docs CC-BY-SA-4.0. Licence changes are owner-only and manual"\n    reason: "Estate doctrine 6 (no automated licence edits). Migrated from AGPL-3.0-or-later; see docs/decisions/ADR-0002-licence-mpl-2.0.adoc"\n`)
  .replace(/Co-developed with son, AGPL-licensed \(exception to PMPL\), independent history/, "Co-developed with son, independent history"),
  "coordination.k9 licence invariant");
edit(".machine_readable/ai/AGENTS.adoc", (s) => s
  .replace(/\*License:\* AGPL-3\.0-or-later/, `*License:* ${TO}`)
  .replace(/==== \[CRITICAL\] agpl-license[\s\S]*?(?=\n=== |\n==== )/, `==== [CRITICAL] licence-owner-only\n\n*Rule:* Code is ${TO}, docs CC-BY-SA-4.0. Licence changes are owner-only and manual.\n\n*Why:* Estate doctrine 6. Migrated from ${FROM} (docs/decisions/ADR-0002-licence-mpl-2.0.adoc).\n`),
  "AGENTS.adoc licence invariant");

// 4. README licence block + badge
edit("README.adoc", (s) => s
  .replace(/\/\/ LICENCE-STATUS:BEGIN[\s\S]*?\/\/ LICENCE-STATUS:END/,
    `// LICENCE-STATUS:BEGIN\nCode: *${TO}* (migrated from ${FROM} — see docs/decisions/ADR-0002-licence-mpl-2.0.adoc). Documentation and prose: *CC-BY-SA-4.0*. Full texts in \`LICENSES/\`.\n// LICENCE-STATUS:END`)
  .replace("img.shields.io/badge/License-AGPL_v3-blue.svg[License: AGPL-3.0,link=LICENSE]", "img.shields.io/badge/License-MPL_2.0-blue.svg[License: MPL-2.0,link=LICENSE]"),
  "README licence block + badge");

// 5. LICENSE text + drop the AGPL text once nothing references it
const mpl = readFileSync(resolve(ROOT, "LICENSES/MPL-2.0.txt"), "utf8");
if (readFileSync(resolve(ROOT, "LICENSE"), "utf8") !== mpl) { report.push("LICENSE  —  replaced with LICENSES/MPL-2.0.txt"); if (apply) writeFileSync(resolve(ROOT, "LICENSE"), mpl); }
if (apply) {
  let left = "";
  try { left = execFileSync("git", ["grep", "-l", `SPDX-License-Identifier: ${FROM}`, "--", ".", ":!archive", ":!LICENSES"], { cwd: ROOT }).toString().trim(); } catch { /* none */ }
  if (!left && existsSync(resolve(ROOT, `LICENSES/${FROM}.txt`))) { unlinkSync(resolve(ROOT, `LICENSES/${FROM}.txt`)); report.push(`LICENSES/${FROM}.txt  —  removed (no file references it)`); }
  else if (left) console.warn(`note: LICENSES/${FROM}.txt kept; still referenced by:\n${left}`);
}

console.log(`${apply ? "APPLIED" : "DRY RUN (nothing written)"}: ${report.length} change(s)`);
for (const r of report) console.log("  " + r);
if (!apply) console.log("\nTo apply:  ASS_RELICENSE_OWNER_CONFIRM=yes bun run scripts/relicense-mpl2.js --apply   (then review `git diff`, commit, SIGN it)");
