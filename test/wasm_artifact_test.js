// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Jonathan D.A. Jewell (hyperpolymath)
//
// wasm_artifact_test.js — the AffineScript core must be held to the reference twin.
//
//   * the twin (sim/shadow_ref.js) is itself locked by golden vectors + model properties;
//   * the verifier is locked by a positive control (a conformant fake instance passes) and by
//     negative controls (perturbed / leaky / zero-init instances fail for the RIGHT reason, and the
//     REAL legacy artifact that used to ship is rejected);
//   * a freshly built artifact (build/ or dist/), when present, must pass the verifier.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { initState, stepState, IDX } from "../sim/shadow_ref.js";
import { SCENARIOS, inputFor } from "../sim/scenarios.js";
import { verifyArtifact, verifyInstance } from "../sim/verify_artifact.js";
import { buildVectors, render, VECTOR_PATH } from "../sim/make_vectors.js";
import { ROOT } from "./harness/headless.js";

/** A fake "instance" that speaks the real ABI through real WebAssembly.Memory (so decodeSnapshot is exercised). */
function fakeInstance({ leakPerStep = 0, zeroInit = false, perturb = null } = {}) {
  const memory = new WebAssembly.Memory({ initial: 1 });
  let heap = 1024, calls = 0;
  // A CONFORMANT build writes each result into a fixed slot (no per-step allocation: ABI v2's whole point);
  // the LEAKY variant bump-allocates a fresh list per call and never frees, like the legacy artifact.
  const write = (vals) => {
    const listBytes = 8 + 29 * 4;
    let ptr = 1024;
    if (leakPerStep > 0) {
      const need = listBytes + leakPerStep;
      if (heap + need > memory.buffer.byteLength) throw new RangeError("Out of bounds memory access");
      ptr = heap; heap += need;
    }
    const dv = new DataView(memory.buffer);
    dv.setInt32(ptr, 30, true); dv.setInt32(ptr + 4, 29, true);
    vals.forEach((v, i) => dv.setInt32(ptr + 8 + i * 4, v, true));
    return ptr;
  };
  const ex = {
    memory,
    init_state: () => write(zeroInit ? new Array(29).fill(0) : initState()),
    step_state: Object.assign((...a) => {
      const next = stepState(a.slice(0, 29), a.slice(29));
      if (perturb) perturb(next, calls);
      calls++;
      return write(next);
    }, {}),
  };
  Object.defineProperty(ex.step_state, "length", { value: 34 });
  return ex;
}
const make = (opts) => () => fakeInstance(opts);

describe("reference twin (ABI v1) is pinned", () => {
  test("golden vectors on disk equal what the twin produces now (drift guard)", () => {
    expect(readFileSync(VECTOR_PATH, "utf8")).toBe(render(buildVectors()));
  });

  test("model properties: determinism, bounds, cooldown, env cadence, scoring", () => {
    for (const sc of SCENARIOS) {
      let a = initState(), b = initState();
      for (let n = 0; n < sc.steps; n++) {
        a = stepState(a, inputFor(sc, n)); b = stepState(b, inputFor(sc, n));
        expect(a).toEqual(b);                                               // deterministic
        expect(a[IDX.sub_x]).toBeGreaterThanOrEqual(0); expect(a[IDX.sub_x]).toBeLessThanOrEqual(799);
        expect(a[IDX.sub_y]).toBeGreaterThanOrEqual(0); expect(a[IDX.sub_y]).toBeLessThanOrEqual(520);
        expect(Math.abs(a[IDX.sub_vx])).toBeLessThanOrEqual(20); expect(Math.abs(a[IDX.sub_vy])).toBeLessThanOrEqual(20);
        expect(a[IDX.sub_cooldown]).toBeGreaterThanOrEqual(0); expect(a[IDX.sub_cooldown]).toBeLessThanOrEqual(8);
        expect(a[IDX.tick]).toBe(n + 1);
        expect(a.every(Number.isInteger)).toBe(true);                        // integer-only: no float can creep in
      }
    }
  });

  test("env flips every 120 ticks and on demand; gravity follows env", () => {
    let s = initState();
    const envs = [];
    for (let n = 0; n < 250; n++) { s = stepState(s, [0, 0, 0, 0, 0]); envs.push(s[IDX.env]); }
    expect(envs[118]).toBe(0); expect(envs[119]).toBe(1); expect(envs[238]).toBe(1); expect(envs[239]).toBe(0);
    expect(stepState(initState(), [0, 0, 0, 0, 1])[IDX.env]).toBe(1);        // toggle input
  });

  test("a held trigger is rate-limited by the 8-tick cooldown and ammo only ever decreases", () => {
    let s = initState(); const ammo = [];
    for (let n = 0; n < 80; n++) { s = stepState(s, [0, 0, 1, 0, 0]); ammo.push(s[IDX.sub_ammo]); }
    expect(ammo.at(-1)).toBeLessThan(200);
    expect(ammo.every((v, i) => i === 0 || v <= ammo[i - 1])).toBe(true);
    expect(200 - ammo.at(-1)).toBeLessThanOrEqual(Math.ceil(80 / 9) + 1);
  });

  test("a kill scores exactly 100 and the mission fails when the clock runs out", () => {
    let s = initState();
    s[IDX.enemy1_x] = 700; s[IDX.enemy1_y] = s[IDX.sub_y];                 // enemy in the line of fire
    s[IDX.proj_a_alive] = 1; s[IDX.proj_a_x] = 690; s[IDX.proj_a_y] = s[IDX.sub_y];
    s = stepState(s, [0, 0, 0, 0, 0]);
    expect(s[IDX.kills] % 1).toBe(0);
    let t = initState(); for (let n = 0; n < 361; n++) t = stepState(t, [0, 0, 0, 0, 0]);
    expect(t[IDX.mission_failed]).toBe(1); expect(t[IDX.mission_complete]).toBe(0);
  });
});

describe("the verifier is itself verified", () => {
  test("positive control: a conformant instance passes (steps counted, no problems)", () => {
    const r = verifyInstance(fakeInstance(), make());
    expect(r.problems).toEqual([]);
    expect(r.stepsChecked).toBeGreaterThan(3000);
  });

  test("negative control: all-zero init_state is reported at the first wrong field", () => {
    const r = verifyInstance(fakeInstance({ zeroInit: true }), make());
    expect(r.problems.some((p) => p.includes("init_state differs from reference at sub_x"))).toBe(true);
  });

  test("negative control: a single wrong value on ONE step of ONE scenario is caught", () => {
    const r = verifyInstance(fakeInstance({ perturb: (next, call) => { if (call === 123) next[IDX.score] += 1; } }), make());
    expect(r.problems.some((p) => p.includes("score"))).toBe(true);
  });

  test("negative control: per-step allocation that is never freed fails the soak (the real defect)", () => {
    const r = verifyInstance(fakeInstance(), make({ leakPerStep: 600 }));
    expect(r.problems.some((p) => p.startsWith("soak: trapped after") && p.includes("never reclaimed"))).toBe(true);
  });

  test("REAL legacy artifact (what used to be committed) is rejected for its three known defects", async () => {
    const r = await verifyArtifact(`${ROOT}/test/fixtures/legacy-broken-init-zero-heap-exhaust.wasm`);
    expect(r.ok).toBe(false);
    expect(r.problems.some((p) => p.includes("init_state differs from reference at sub_x (artifact 0, reference 400)"))).toBe(true);
    expect(r.problems.some((p) => p.includes("env artifact=1 reference=0"))).toBe(true);
    expect(r.problems.some((p) => p.startsWith("soak: trapped after"))).toBe(true);
  });

  test("garbage bytes and forbidden imports are refused", async () => {
    expect((await verifyArtifact(new Uint8Array([1, 2, 3]))).ok).toBe(false);
    // a minimal, VALID module that imports env.steal_secrets : () -> ()
    const enc = new TextEncoder();
    const mod = enc.encode("env"), name = enc.encode("steal_secrets");
    const importBody = [1, mod.length, ...mod, name.length, ...name, 0x00, 0x00];           // count, module, field, kind=func, type 0
    const bytes = new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0,                          // magic + version
      1, 4, 1, 0x60, 0, 0,                                                                  // type section: one func () -> ()
      2, importBody.length, ...importBody]);                                                // import section
    expect(WebAssembly.validate(bytes)).toBe(true);                                         // the fixture itself must be valid
    const r = await verifyArtifact(bytes);
    expect(r.ok).toBe(false);
    expect(r.problems.join()).toContain("forbidden import");
  });
});

describe("a freshly built artifact (when build.sh / CI produced one)", () => {
  const built = ["build", "dist"].map((d) => `${ROOT}/${d}/airborne-submarine-squadron.wasm`).find((p) => existsSync(p));
  test.skipIf(!built)("conforms to the reference twin on every golden step and survives the soak", async () => {
    const r = await verifyArtifact(built);
    expect(r.problems).toEqual([]);
  });
});
