// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Jonathan D.A. Jewell (hyperpolymath)
//
// rt.js — the small slice of runtime the suite needs, on Bun + node: built-ins.
// (Replaces the Deno.* calls; no Deno namespace shim, no dependencies.)

import { test as bunTest } from "bun:test";
import * as fsp from "node:fs/promises";
import { createServer } from "node:net";

export const test = bunTest;

/** Thrown for ENOENT, so `catch (e) { if (e instanceof NotFound) ... }` keeps reading naturally. */
export class NotFound extends Error { constructor(m) { super(m); this.name = "NotFound"; } }
const wrap = (e) => (e && e.code === "ENOENT" ? Object.assign(new NotFound(e.message), { cause: e }) : e);

export async function readTextFile(p) { try { return await fsp.readFile(p, "utf8"); } catch (e) { throw wrap(e); } }
export async function writeTextFile(p, s) { try { await fsp.writeFile(p, s); } catch (e) { throw wrap(e); } }
export async function readBytes(p, n) {
  try { const b = await fsp.readFile(p); return new Uint8Array(n === undefined ? b : b.subarray(0, n)); } catch (e) { throw wrap(e); }
}
export async function stat(p) {
  try {
    const s = await fsp.stat(p);
    return { isFile: s.isFile(), isDirectory: s.isDirectory(), size: s.size, mtime: s.mtime };
  } catch (e) { throw wrap(e); }
}
export async function* readDir(p) {
  for (const d of await fsp.readdir(p, { withFileTypes: true })) {
    yield { name: d.name, isFile: d.isFile(), isDirectory: d.isDirectory(), isSymlink: d.isSymbolicLink() };
  }
}
export const mkdir = (p, o) => fsp.mkdir(p, o);
export const copyFile = (a, b) => fsp.copyFile(a, b);
export const envGet = (k) => process.env[k];
export const buildOs = () => ({ linux: "linux", darwin: "darwin", win32: "windows" }[process.platform] ?? process.platform);
export const buildArch = () => ({ x64: "x86_64", arm64: "aarch64" }[process.arch] ?? process.arch);

/** Path of the running Bun, for spawning `bun run ...`. */
export const BUN = process.execPath;

/** Run a command; mirrors the tiny part of the old Command API the suite used (output() and spawn()). */
export class Command {
  constructor(cmd, opts = {}) { this.cmd = cmd; this.opts = opts; }

  /** Start the process; returns a child handle { pid, kill(sig), output(), status }. */
  spawn() {
    const { args = [], cwd, env, stdout = "piped", stderr = "piped" } = this.opts;
    const p = Bun.spawn([this.cmd, ...args], {
      cwd, env: env ? { ...process.env, ...env } : undefined, stdin: "ignore",
      stdout: stdout === "null" ? "ignore" : "pipe", stderr: stderr === "null" ? "ignore" : "pipe",
    });
    const collect = async () => {
      const [out, err, code] = await Promise.all([
        stdout === "null" ? new Uint8Array() : new Response(p.stdout).bytes(),
        stderr === "null" ? new Uint8Array() : new Response(p.stderr).bytes(),
        p.exited,
      ]);
      return { code, success: code === 0, stdout: out, stderr: err };
    };
    let cached;
    return {
      pid: p.pid,
      kill: (sig = "SIGTERM") => p.kill(sig),
      output: () => (cached ??= collect()),
      get status() { return p.exited.then((code) => ({ code, success: code === 0 })); },
    };
  }

  async output() { return this.spawn().output(); }
}

/** Occupy a TCP port for the duration of a test (returns an object with close()). */
export function listen({ port }) {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(port, "127.0.0.1", () => resolve({ close: () => new Promise((r) => s.close(r)), port: s.address().port }));
  });
}

/**
 * Micro-benchmark: runs when the file is executed as a script (`bun run test/bench.js`),
 * prints avg / p99 per benchmark.  Under `bun test` it registers nothing (benchmarks are
 * not tests), so `just test` stays fast.
 */
const benches = [];
export function bench(name, fn, { iterations = 30, warmup = 3 } = {}) { benches.push({ name, fn, iterations, warmup }); }
export async function runBenches() {
  const rows = [];
  for (const b of benches) {
    for (let i = 0; i < b.warmup; i++) await b.fn();
    const t = [];
    for (let i = 0; i < b.iterations; i++) { const s = performance.now(); await b.fn(); t.push(performance.now() - s); }
    t.sort((x, y) => x - y);
    rows.push({ benchmark: b.name, avg_ms: +(t.reduce((a, c) => a + c, 0) / t.length).toFixed(3), p99_ms: +t[Math.min(t.length - 1, Math.floor(t.length * 0.99))].toFixed(3) });
  }
  console.table(rows);
  return rows;
}
