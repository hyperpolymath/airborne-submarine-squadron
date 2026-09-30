// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Jonathan D.A. Jewell (hyperpolymath)
//
// shadow_ref.js — bit-exact JavaScript REFERENCE TWIN of src/main.affine (ABI v1).
//
// Purpose: src/main.affine compiles to WASM; this file is the independent oracle the
// compiled artifact (dist/ or a fresh CI build) is checked against, step for step, in
// test/wasm_artifact_test.js.  Integer-only, no floats, no Math.*, no randomness, so
// "same inputs -> same outputs" holds on every engine (and is exactly what a lockstep /
// replay / verified-leaderboard design needs).
//
// ABI v1: 29 state integers + 5 input integers -> 29 state integers.
// Keep this file and src/main.affine in lock-step; the test fails if they drift.

export const FIELDS = Object.freeze([
  "tick", "env", "sub_x", "sub_y", "sub_vx", "sub_vy", "sub_hp", "sub_ammo", "sub_cooldown",
  "proj_a_alive", "proj_a_x", "proj_a_y", "proj_b_alive", "proj_b_x", "proj_b_y",
  "enemy1_alive", "enemy1_x", "enemy1_y", "enemy1_hp", "enemy2_alive", "enemy2_x", "enemy2_y", "enemy2_hp",
  "score", "kills", "mission_total", "mission_ticks", "mission_complete", "mission_failed",
]);
export const IDX = Object.freeze(Object.fromEntries(FIELDS.map((n, i) => [n, i])));
export const INPUT_FIELDS = Object.freeze(["thrust_x", "thrust_y", "fire", "fire_alt", "toggle_env"]);

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const b2i = (b) => (b ? 1 : 0);

/** init_state(): the canonical starting snapshot. */
export function initState() {
  return [
    0, 0, 400, 200, 0, 0, 100, 200, 0,
    0, 0, 0, 0, 0, 0,
    1, 760, 220, 50, 1, 740, 280, 50,
    0, 0, 4, 360, 0, 0,
  ];
}

function nextEnv(env, tick, toggle) {
  if (toggle) return env === 0 ? 1 : 0;
  if (tick % 120 === 0) return env === 0 ? 1 : 0;
  return env;
}

function stepProjectile(active, x, y, vx, vy) {
  if (!active) return [false, x, y];
  const nx = x + vx, ny = y + vy;
  return (nx < -20 || nx > 820 || ny < -20 || ny > 620) ? [false, nx, ny] : [true, nx, ny];
}

function stepEnemy(active, x, y, hp, speed) {
  if (!active) return [false, x, y, hp];
  const nx = x - speed;
  return nx < -20 ? [false, nx, y, hp] : [true, nx, y, hp];
}

const hits = (px, py, ex, ey) => Math.abs(px - ex) < 10 && Math.abs(py - ey) < 10;

/**
 * step_state(state29, input5) -> state29.  Mirrors step_world() in src/main.affine, line for line.
 * @param {number[]} s  29-element snapshot
 * @param {number[]} i  [thrust_x, thrust_y, fire, fire_alt, toggle_env]
 */
export function stepState(s, i) {
  const [tick, env, sx, sy, svx, svy, shp, ammo, cooldown,
    paA, paX, paY, pbA, pbX, pbY,
    e1A, e1X, e1Y, e1Hp, e2A, e2X, e2Y, e2Hp,
    score, kills, mTotal, mTicks] = s;
  const [thrustX, thrustY, fire, fireAlt, toggleEnv] = i;

  const tick2 = tick + 1;
  const env2 = nextEnv(env, tick2, toggleEnv !== 0);

  // apply_input, then integrate_submarine
  const vx1 = clamp(svx + thrustX, -20, 20);
  const vy1 = clamp(svy + thrustY, -20, 20);
  const gravity = env2 === 0 ? 1 : -1;
  const vxDrag = vx1 > 0 ? vx1 - 1 : vx1 < 0 ? vx1 + 1 : 0;
  const vyNext = clamp(vy1 + gravity, -20, 20);
  const subX = clamp(sx + vxDrag, 0, 799);
  const subY = clamp(sy + vyNext, 0, 520);

  // firing
  const cooldown1 = cooldown > 0 ? cooldown - 1 : 0;
  const canFire = cooldown1 === 0 && ammo > 0;
  const fireA = fire !== 0 && canFire && paA === 0;
  const ammoAfterA = fireA ? ammo - 1 : ammo;
  const fireB = fireAlt !== 0 && cooldown1 === 0 && ammoAfterA > 0 && pbA === 0;
  const ammo2 = fireB ? ammoAfterA - 1 : ammoAfterA;
  const cooldown2 = (fireA || fireB) ? 8 : cooldown1;

  const a0 = fireA ? [true, subX + 12, subY] : [paA !== 0, paX, paY];
  const b0 = fireB ? [true, subX + 12, subY + 4] : [pbA !== 0, pbX, pbY];
  const [a1Act, a1X, a1Y] = stepProjectile(a0[0], a0[1], a0[2], 7, 0);
  const [b1Act, b1X, b1Y] = stepProjectile(b0[0], b0[1], b0[2], 7, 0);

  // enemy spawn + step
  const sp1 = e1A === 0 && tick2 % 140 === 1;
  const e1 = sp1 ? [true, 760, 220, 50] : [e1A !== 0, e1X, e1Y, e1Hp];
  const sp2 = e2A === 0 && tick2 % 190 === 1;
  const e2 = sp2 ? [true, 740, 280, 50] : [e2A !== 0, e2X, e2Y, e2Hp];
  const [e1Act1, e1X1, e1Y1, e1Hp1] = stepEnemy(e1[0], e1[1], e1[2], e1[3], 2);
  const [e2Act1, e2X1, e2Y1, e2Hp1] = stepEnemy(e2[0], e2[1], e2[2], e2[3], 1);

  // collisions
  const hit1 = e1Act1 && ((a1Act && hits(a1X, a1Y, e1X1, e1Y1)) || (b1Act && hits(b1X, b1Y, e1X1, e1Y1)));
  const hit2 = e2Act1 && ((a1Act && hits(a1X, a1Y, e2X1, e2Y1)) || (b1Act && hits(b1X, b1Y, e2X1, e2Y1)));
  const anyHit = hit1 || hit2;

  const killsGain = b2i(hit1) + b2i(hit2);
  const kills2 = kills + killsGain;
  const score2 = score + killsGain * 100;
  const complete = kills2 >= mTotal;
  const failed = complete ? false : tick2 > mTicks;

  return [
    tick2, env2, subX, subY, vxDrag, vyNext, shp, ammo2, cooldown2,
    b2i(anyHit ? false : a1Act), a1X, a1Y, b2i(anyHit ? false : b1Act), b1X, b1Y,
    b2i(hit1 ? false : e1Act1), e1X1, e1Y1, hit1 ? 0 : e1Hp1,
    b2i(hit2 ? false : e2Act1), e2X1, e2Y1, hit2 ? 0 : e2Hp1,
    score2, kills2, mTotal, mTicks, b2i(complete), b2i(failed),
  ];
}
