// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Jonathan D.A. Jewell (hyperpolymath)
//
// run_wasm.js — minimal runner: instantiate a compiled core and call an export.
//   bun run sim/run_wasm.js build/airborne-submarine-squadron.wasm [export]
// (Was a Node script at the repo root; Node is retired by the estate LANGUAGE-POLICY. For a CONFORMANCE
//  check of an artifact use sim/verify_artifact.js — this only runs it.)

import { readFileSync } from "node:fs";

const [, , file, exportName = "main"] = process.argv;
if (!file) { console.error("usage: bun run sim/run_wasm.js <file.wasm> [export]"); process.exit(2); }

const bytes = readFileSync(file);
const { instance } = await WebAssembly.instantiate(bytes, { wasi_snapshot_preview1: { fd_write: () => 0 } });
const fn = instance.exports[exportName];
if (typeof fn !== "function") { console.error(`no exported function "${exportName}"; exports: ${Object.keys(instance.exports).join(", ")}`); process.exit(1); }
console.log(`${exportName}() ->`, fn());
