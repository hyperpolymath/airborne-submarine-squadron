// SPDX-License-Identifier: AGPL-3.0-or-later
// Shared WASM ABI contract constants for Airborne Submarine Squadron.

(() => {
  const ABI_VERSION = "1.0.0";
  const WORD_BYTES = 4;

  // Canonical 29-field snapshot payload returned by init_state/step_state.
  const SNAPSHOT_FIELDS = Object.freeze([
    "tick",
    "env",
    "sub_x",
    "sub_y",
    "sub_vx",
    "sub_vy",
    "sub_hp",
    "sub_ammo",
    "sub_cooldown",
    "proj_a_alive",
    "proj_a_x",
    "proj_a_y",
    "proj_b_alive",
    "proj_b_x",
    "proj_b_y",
    "enemy1_alive",
    "enemy1_x",
    "enemy1_y",
    "enemy1_hp",
    "enemy2_alive",
    "enemy2_x",
    "enemy2_y",
    "enemy2_hp",
    "score",
    "kills",
    "mission_total",
    "mission_ticks",
    "mission_complete",
    "mission_failed",
  ]);

  const SNAPSHOT_INDEX = Object.freeze(
    Object.fromEntries(SNAPSHOT_FIELDS.map((name, idx) => [name, idx]))
  );

  const STATE_FIELD_COUNT = SNAPSHOT_FIELDS.length;
  const INPUT_FIELD_COUNT = 5;
  const STEP_STATE_ARG_COUNT = STATE_FIELD_COUNT + INPUT_FIELD_COUNT;

  function fnv1a32(input) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
  }

  const ABI_HASH = fnv1a32(JSON.stringify({
    version: ABI_VERSION,
    snapshotFields: SNAPSHOT_FIELDS,
    stateFieldCount: STATE_FIELD_COUNT,
    inputFieldCount: INPUT_FIELD_COUNT,
    stepStateArgCount: STEP_STATE_ARG_COUNT,
  }));

  function validateExports(exportsObj) {
    if (!exportsObj || typeof exportsObj !== "object") {
      return { ok: false, error: "WASM exports object missing" };
    }
    if (typeof exportsObj.memory !== "object") {
      return { ok: false, error: "memory export missing" };
    }
    if (typeof exportsObj.init_state !== "function") {
      return { ok: false, error: "init_state export missing" };
    }
    if (typeof exportsObj.step_state !== "function") {
      return { ok: false, error: "step_state export missing" };
    }
    if (exportsObj.init_state.length !== 0) {
      return {
        ok: false,
        error: `init_state arity mismatch (expected 0, got ${exportsObj.init_state.length})`,
      };
    }
    if (exportsObj.step_state.length !== STEP_STATE_ARG_COUNT) {
      return {
        ok: false,
        error: `step_state arity mismatch (expected ${STEP_STATE_ARG_COUNT}, got ${exportsObj.step_state.length})`,
      };
    }
    return { ok: true };
  }

  // Decoder supports both shapes used by AffineScript list layout:
  // 1) [tag, len=29, payload...] list-node header
  // 2) [payload...] direct contiguous i32 payload
  function decodeSnapshot(memory, ptr) {
    const view = new DataView(memory.buffer);
    const firstWord = view.getInt32(ptr, true);
    const secondWord = view.getInt32(ptr + WORD_BYTES, true);
    const hasHeader = secondWord === STATE_FIELD_COUNT && firstWord >= 0 && firstWord < 64;
    const payloadPtr = hasHeader ? ptr + (WORD_BYTES * 2) : ptr;

    return Array.from(
      { length: STATE_FIELD_COUNT },
      (_, idx) => view.getInt32(payloadPtr + (idx * WORD_BYTES), true)
    );
  }

  function validateSnapshot(snapshot) {
    return Array.isArray(snapshot)
      && snapshot.length === STATE_FIELD_COUNT
      && snapshot.every((n) => Number.isInteger(n));
  }

  function getStartupDiagnostics(snapshot) {
    return {
      version: ABI_VERSION,
      hash: ABI_HASH,
      stateFields: STATE_FIELD_COUNT,
      inputFields: INPUT_FIELD_COUNT,
      stepStateArgs: STEP_STATE_ARG_COUNT,
      initTick: Array.isArray(snapshot) ? snapshot[SNAPSHOT_INDEX.tick] : null,
    };
  }

  globalThis.AirborneWasmABI = Object.freeze({
    ABI_VERSION,
    ABI_HASH,
    SNAPSHOT_FIELDS,
    SNAPSHOT_INDEX,
    STATE_FIELD_COUNT,
    INPUT_FIELD_COUNT,
    STEP_STATE_ARG_COUNT,
    validateExports,
    decodeSnapshot,
    validateSnapshot,
    getStartupDiagnostics,
  });
})();
