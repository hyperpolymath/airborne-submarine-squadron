// SPDX-License-Identifier: MPL-2.0
// SPDX-FileCopyrightText: 2026 Jonathan D.A. Jewell (hyperpolymath)
//
// jump_test.js — regression suite for "the sub jumps around the screen".
//
// These tests run the REAL engine (every gossamer/*.js script, in the order
// each HTML entry point loads them) inside test/harness/headless.js and watch
// what is actually painted. See docs/JUMP-BUG-POSTMORTEM.adoc for the story.

import { describe, expect, test } from "bun:test";
import { createGame } from "./harness/headless.js";

const ENTRY_POINTS = ["gossamer/index_gossamer.html", "index.html"];

/** Put the sub at depth so the camera Y offset is large, then settle the camera. */
function diveAndSettle(game, frames = 30) {
  game.ev(`world.sub.floating = false; world.sub.disembarked = false;
           world.sub.worldX = 2500; world.sub.y = 640; world.sub.vx = 0; world.sub.vy = 0;
           world.cameraX = 2500 - 320; world.cameraY = 640 - 270;`);
  game.run(frames, { hz: 60 });
}

function startCameratron(game) {
  game.ev(`world._evelCameratron = { active: true, timer: 0, maxTimer: 240,
    evel: { x: world.sub.worldX + 120, y: 380, vx: 1.2, alive: true, swimming: false, jumping: true } };`);
}

describe("every HTML entry point boots the real engine", () => {
  for (const html of ENTRY_POINTS) {
    test(`${html} loads all modules and starts the game loop`, async () => {
      const game = await createGame({ html, seed: 1 });
      try {
        const errorLogs = game.logs.filter((l) => l.level === "error").map((l) => l.text);
        expect(game.errors).toEqual([]);
        expect(errorLogs).toEqual([]);
        expect(game.booted).toBe(true);
      } finally { game.dispose(); }
    });
  }

  test("both entry points load the same engine modules, in the same order", async () => {
    const a = await createGame({ html: ENTRY_POINTS[0], instrument: false });
    const b = await createGame({ html: ENTRY_POINTS[1], instrument: false });
    try {
      // Compare by basename; only the desktop page needs the multiplayer net/ helper.
      const base = (list) => list.map((s) => s.split("/").pop()).filter((s) => s !== "signalling.js");
      expect(base(b.scripts)).toEqual(base(a.scripts));
    } finally { a.dispose(); b.dispose(); }
  });
});

describe("Evel cameratron must not corrupt the camera transform", () => {
  test("sub is painted at the same screen position with or without the popup", async () => {
    const game = await createGame({ seed: 7 });
    try {
      diveAndSettle(game);
      const before = game.lastSubScreen();
      expect(before.cameraY).toBeGreaterThan(100);           // the camera really is offset
      expect(Math.abs(before.y - 270)).toBeLessThan(1);      // H*0.45, per the debug overlay's "want ~270"

      startCameratron(game);
      game.run(1, { hz: 60 });
      const after = game.lastSubScreen();
      // One frame apart at rest: the sub must not teleport by `cameraY` pixels.
      expect(Math.abs(after.y - before.y)).toBeLessThan(2);
    } finally { game.dispose(); }
  });

  test("drawEvelCameratron leaves the canvas save/restore stack balanced", async () => {
    const game = await createGame({ seed: 7 });
    try {
      diveAndSettle(game);
      startCameratron(game);
      game.run(20, { hz: 60 });
      expect(game.violations.filter((v) => v.fn === "drawEvelCameratron")).toEqual([]);
      expect(game.ctx.underflows).toBe(0);                   // no restore() on an empty stack, ever
    } finally { game.dispose(); }
  });

  test("the popup's frame border and label are still drawn unzoomed and unclipped", async () => {
    // Guards against the WRONG fix (deleting the middle restore instead of the extra
    // final one) which balances the stack but leaves the 3x zoom + clip active, so the
    // border / label / REC dot silently vanish.
    const game = await createGame({ seed: 7 });
    try {
      diveAndSettle(game);
      startCameratron(game);
      game.ctx.ops.length = 0;
      game.run(1, { hz: 60 });
      const label = game.ctx.ops.find((o) => o.name === "fillText" && o.args[0] === "CAMERATRON");
      expect(label).toBeDefined();
      expect(label.scale).toBeCloseTo(1, 9);
      expect(label.clipDepth).toBe(0);
    } finally { game.dispose(); }
  });
});
