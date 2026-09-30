// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Jonathan D.A. Jewell (hyperpolymath)
//
// verify_artifact.js — conformance check for a compiled AffineScript WASM core (ABI v1).
//
// A compiled artifact is NEVER trusted because it exists.  It must:
//   1. be valid WebAssembly and import nothing but wasi_snapshot_preview1.fd_write  (capability audit:
//      it cannot touch the host beyond writing to a file descriptor);
//   2. satisfy the JS ABI contract (gossamer/wasm_abi.js): memory, init_state(), step_state(34 args);
//   3. return EXACTLY the reference twin's init snapshot;
//   4. match the reference twin (sim/shadow_ref.js) on every step of every golden scenario
//      (sim/vectors/shadow_v1.json) — including a long soak that exposes per-step heap leaks.
//
// Why (2)-(4): the artifact that used to be committed returned an all-zero init_state and trapped with
// "out of bounds memory access" at call #96 (668 bytes bump-allocated per step, never freed, one 64 KiB page).
// The game's try/catch then silently disabled the co-processor.  See docs/RECON-2026-09.adoc §4.

import { readFileSync } from "node:fs";
import { initState, stepState, FIELDS } from "./shadow_ref.js";
import { SCENARIOS, inputFor } from "./scenarios.js";

const ALLOWED_IMPORTS = new Set(["wasi_snapshot_preview1.fd_write"]);
const STATE_FIELDS = 29, INPUT_FIELDS = 5, STEP_ARGS = STATE_FIELDS + INPUT_FIELDS;

/** Same decoder contract as gossamer/wasm_abi.js: optional [tag, len] list header, then i32 payload. */
export function decodeSnapshot(memory, ptr) {
  const view = new DataView(memory.buffer);
  const first = view.getInt32(ptr, true), second = view.getInt32(ptr + 4, true);
  const hasHeader = second === STATE_FIELDS && first >= 0 && first < 64;
  const base = hasHeader ? ptr + 8 : ptr;
  return Array.from({ length: STATE_FIELDS }, (_, i) => view.getInt32(base + i * 4, true));
}

/**
 * Checks 2-4 against live exports (real WASM instance OR anything exposing the same ABI — see test/wasm_artifact_test.js).
 * `fresh` must return a NEW instance's exports (the soak runs on its own instance).
 * @returns {{problems: string[], stepsChecked: number}}
 */
export function verifyInstance(ex, fresh, { soakSteps = 3000 } = {}) {
  const problems = [];
  let stepsChecked = 0;
  if (ex.step_state.length !== undefined && ex.step_state.length !== STEP_ARGS) problems.push(`step_state arity ${ex.step_state.length}, expected ${STEP_ARGS}`);

  let init;
  try { init = decodeSnapshot(ex.memory, ex.init_state()); } catch (e) { return { problems: [...problems, `init_state trapped: ${e.message}`], stepsChecked }; }
  const want = initState();
  if (init.join() !== want.join()) {
    const i = want.findIndex((v, k) => v !== init[k]);
    problems.push(`init_state differs from reference at ${FIELDS[i]} (artifact ${init[i]}, reference ${want[i]})`);
  }

  // Drive each golden scenario; ALWAYS continue from the reference state so one bad step cannot hide the next.
  for (const sc of SCENARIOS) {
    let s = initState();
    for (let n = 0; n < sc.steps; n++) {
      const inp = inputFor(sc, n);
      const expect = stepState(s, inp);
      let got;
      try { got = decodeSnapshot(ex.memory, ex.step_state(...s, ...inp)); }
      catch (e) { problems.push(`scenario ${sc.name}: trapped at step ${n}: ${e.message}`); break; }
      stepsChecked++;
      if (!expect.every((v, i) => v === got[i])) {
        const i = expect.findIndex((v, k) => v !== got[k]);
        problems.push(`scenario ${sc.name}: step ${n}: ${FIELDS[i]} artifact=${got[i]} reference=${expect[i]}`);
        break;
      }
      s = expect;
    }
  }

  // Soak on a FRESH instance: catches per-step heap growth that short scenarios can hide.
  const ex2 = fresh();
  const s = initState();
  for (let n = 0; n < soakSteps; n++) {
    try { ex2.step_state(...s, 0, 0, 0, 0, 0); }
    catch (e) { problems.push(`soak: trapped after ${n} calls (${e.message}) — per-step allocation is never reclaimed`); break; }
    stepsChecked++;
  }
  return { problems, stepsChecked };
}

/** Full check of a compiled artifact (file path or bytes). @returns {Promise<{ok: boolean, problems: string[], stepsChecked: number}>} */
export async function verifyArtifact(pathOrBytes, opts = {}) {
  const bytes = typeof pathOrBytes === "string" ? readFileSync(pathOrBytes) : pathOrBytes;
  if (!WebAssembly.validate(bytes)) return { ok: false, problems: ["not valid WebAssembly"], stepsChecked: 0 };
  const module = await WebAssembly.compile(bytes);

  const problems = [];
  for (const imp of WebAssembly.Module.imports(module)) {
    const id = `${imp.module}.${imp.name}`;
    if (!ALLOWED_IMPORTS.has(id)) problems.push(`forbidden import: ${id}`);
  }
  const exportsList = WebAssembly.Module.exports(module).map((e) => e.name);
  for (const need of ["memory", "init_state", "step_state"]) if (!exportsList.includes(need)) problems.push(`missing export: ${need}`);
  if (problems.length) return { ok: false, problems, stepsChecked: 0 };

  const instantiate = async () => (await WebAssembly.instantiate(module, { wasi_snapshot_preview1: { fd_write: () => 0 } })).exports;
  const ex = await instantiate();
  const ex2 = await instantiate();
  const r = verifyInstance(ex, () => ex2, opts);
  return { ok: r.problems.length === 0, problems: r.problems, stepsChecked: r.stepsChecked };
}

if (import.meta.main) {
  const path = process.argv[2];
  if (!path) { console.error("usage: bun run sim/verify_artifact.js <file.wasm>"); process.exit(2); }
  const r = await verifyArtifact(path);
  console.log(r.ok ? `OK: ${path} conforms to the reference (${r.stepsChecked} steps)` : `FAIL: ${path}\n  - ${r.problems.join("\n  - ")}`);
  process.exit(r.ok ? 0 : 1);
}
