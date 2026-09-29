// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Jonathan D.A. Jewell (hyperpolymath)
//
// pages_test.js — the DEPLOYABLE site (what GitHub Pages serves) must actually boot.
// This is the go-to-market gate: a playable, zero-install link is the cheapest marketing asset the
// game has, and "it silently stopped loading" is the most expensive regression it can have.

import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGame, ROOT } from "./harness/headless.js";

function assemble() {
  const out = mkdtempSync(join(tmpdir(), "ass-site-"));
  const p = Bun.spawnSync(["bash", join(ROOT, "scripts/build-pages.sh"), out], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`build-pages.sh failed: ${p.stderr.toString()}`);
  return out;
}

function walk(dir, base = dir, acc = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, base, acc); else acc.push(p.slice(base.length + 1));
  }
  return acc;
}

describe("GitHub Pages site", () => {
  const site = assemble();
  const files = walk(site);

  test("the assembled ROOT page boots the real engine (all modules present, game loop running)", async () => {
    const game = await createGame({ html: join(site, "index.html"), gameSeed: 3 });
    try {
      expect(game.errors).toEqual([]);
      expect(game.logs.filter((l) => l.level === "error")).toEqual([]);
      expect(game.booted).toBe(true);
      game.run(30, { hz: 60 });
      expect(game.world.tick).toBeGreaterThan(20);
    } finally { game.dispose(); }
  });

  test("the assembled DESKTOP page boots too (same module set)", async () => {
    const game = await createGame({ html: join(site, "gossamer/index_gossamer.html"), gameSeed: 3 });
    try { expect(game.booted).toBe(true); expect(game.errors).toEqual([]); } finally { game.dispose(); }
  });

  test("nothing from the repo internals leaks onto the public site", () => {
    const leaks = files.filter((f) => /(^|\/)(run\.js|server\/|\.git|\.github|\.machine_readable|test\/|tray\/|src\/|logs\/|package\.json|Justfile|coordination\.k9|.*\.sh$|.*\.eph$|.*\.tar\.gz$)/.test(f));
    expect(leaks).toEqual([]);
  });

  test(".well-known ships (security.txt + groove manifest) and .nojekyll keeps dot-directories served", () => {
    expect(existsSync(join(site, ".nojekyll"))).toBe(true);
    expect(existsSync(join(site, ".well-known/security.txt"))).toBe(true);
    const m = JSON.parse(readFileSync(join(site, ".well-known/groove.json"), "utf8"));
    expect(m.service_id).toBe("airborne-submarine-squadron");
  });

  test("the site is small enough to be a one-click play link", () => {
    const bytes = files.reduce((n, f) => n + statSync(join(site, f)).size, 0);
    expect(bytes).toBeLessThan(6 * 1024 * 1024);   // the whole playable game incl. art < 6 MiB
  });
});
