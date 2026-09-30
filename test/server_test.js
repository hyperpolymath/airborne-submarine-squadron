// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Jonathan D.A. Jewell (hyperpolymath)
//
// server_test.js — the game server's security + behaviour contract.
// (panic-attack `assail` class: path exposure, CSRF-able shutdown, unbounded writes.)

import { describe, expect, test, beforeEach } from "bun:test";
import { mkdtempSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHandler, resolveStatic, hostAllowed, originOk, LIMITS, SHUTDOWN_GRACE_MS } from "../server/ass-server.js";
import { ROOT } from "./harness/headless.js";

const PORT = 6880;
const H = `127.0.0.1:${PORT}`;
const req = (path, init = {}) => new Request(`http://${H}${path}`, { ...init, headers: { host: H, ...(init.headers || {}) } });

function make(extra = {}) {
  const logsDir = mkdtempSync(join(tmpdir(), "ass-logs-"));
  const shutdowns = [];
  let clock = 1_000_000;
  const handler = createHandler({ root: ROOT, getPort: () => PORT, logsDir, onShutdown: () => shutdowns.push(1), now: () => clock, ...extra });
  return { handler, logsDir, shutdowns, tick: (ms) => { clock += ms; } };
}

describe("Request objects preserve the Host header (test precondition)", () => {
  test("host survives new Request()", () => {
    expect(new Request("http://x/", { headers: { host: "evil.example" } }).headers.get("host")).toBe("evil.example");
  });
});

describe("static files: allowlist, never the repo root", () => {
  const { handler } = make();
  const status = async (p) => (await handler(req(p))).status;

  test("the game itself is served", async () => {
    expect(await status("/")).toBe(200);
    expect(await status("/index.html")).toBe(200);
    const js = await handler(req("/gossamer/app_gossamer.js"));
    expect(js.status).toBe(200);
    expect(js.headers.get("content-type")).toContain("javascript");
    expect(js.headers.get("x-content-type-options")).toBe("nosniff");
  });

  test("secrets, history, tooling and source-of-truth files are NOT served", async () => {
    for (const p of ["/.git/config", "/.git/HEAD", "/.github/workflows/test.yml", "/.gitignore", "/.machine_readable/STATE.a2ml",
      "/logs/.gitkeep", "/run.js", "/server/ass-server.js", "/package.json", "/Justfile", "/tray/Cargo.toml", "/README.adoc",
      "/test/harness/headless.js", "/gossamer/launch.sh", "/gossamer/main.eph", "/.env", "/LICENSE"]) {
      expect([p, await status(p)]).toEqual([p, 404]);
    }
  });

  test("traversal attempts of every flavour are refused", async () => {
    for (const p of ["/gossamer/../run.js", "/gossamer/%2e%2e/run.js", "/gossamer/..%2frun.js", "/%2e%2e/%2e%2e/etc/passwd",
      "/gossamer/..\\run.js", "/gossamer/%00.js", "/gossamer/%2e%2e%2f%2e%2e%2f.git%2fconfig", "//etc/passwd", "/gossamer//..//run.js"]) {
      const s = await status(p);
      expect([p, s === 404 || s === 403 || s === 400]).toEqual([p, true]);
    }
  });

  test("resolveStatic is pure and exhaustive on dotfiles / traversal", () => {
    expect(resolveStatic(ROOT, "/.git/config")).toBeNull();
    expect(resolveStatic(ROOT, "/gossamer/.hidden.js")).toBeNull();
    expect(resolveStatic(ROOT, "/gossamer/%2e%2e/run.js")).toBeNull();
    expect(resolveStatic(ROOT, "/desktop/install.sh")).toBeNull();          // only desktop/icons is exposed
    expect(resolveStatic(ROOT, "/desktop/icons/airborne-submarine-squadron.png")).toContain("desktop");
    expect(resolveStatic(ROOT, "/gossamer/terrain.js")).toContain("terrain.js");
  });

  test(".well-known is served from www/.well-known, groove manifest as application/groove+json", async () => {
    const g = await handler(req("/.well-known/groove"));
    expect(g.status).toBe(200);
    expect(g.headers.get("content-type")).toBe("application/groove+json");
    const m = await g.json();
    expect(m.service_id).toBe("airborne-submarine-squadron");
    expect(await status("/.well-known/security.txt")).toBe(200);
    expect(await status("/.well-known/../run.js")).toBe(404);
    expect(await status("/.well-known/.hidden")).toBe(404);
  });

  test("identity endpoint lets a fresh launcher recognise a stale game server", async () => {
    const r = await handler(req("/__ass/identity"));
    expect(await r.json()).toEqual({ name: "airborne-submarine-squadron", kind: "game-server" });
  });
});

describe("DNS rebinding and cross-site requests", () => {
  test("a Host that is not loopback:<port> is refused (DNS rebinding)", async () => {
    const { handler } = make();
    for (const host of ["evil.example", "evil.example:6880", "127.0.0.1:1", "127.0.0.1.evil.example:6880", ""]) {
      const r = await handler(new Request(`http://${H}/`, { headers: { host } }));
      expect([host, r.status]).toEqual([host, 403]);
    }
  });

  test("...unless the operator explicitly allows it (remote dev / preview proxy)", async () => {
    const { handler } = make({ allowedHosts: ["*.e2b.app", "dev.example"] });
    for (const host of ["6880-abc.e2b.app", "dev.example", "x.y.e2b.app"]) {
      expect([host, (await handler(new Request(`http://${H}/`, { headers: { host } }))).status]).toEqual([host, 200]);
    }
    expect((await handler(new Request(`http://${H}/`, { headers: { host: "e2b.app.evil.example" } }))).status).toBe(403);
    expect((await handler(new Request(`http://${H}/`, { headers: { host: "e2b.app" } }))).status).toBe(403);   // bare suffix is not a match
  });

  test("a cross-origin POST /shutdown cannot stop the server", async () => {
    const { handler, shutdowns } = make();
    for (const headers of [{ origin: "http://evil.example" }, { origin: "null" }, { "sec-fetch-site": "cross-site" }, { origin: `http://localhost:${PORT}` }]) {
      const r = await handler(req("/shutdown", { method: "POST", headers }));
      expect([JSON.stringify(headers), r.status]).toEqual([JSON.stringify(headers), 403]);
    }
    await new Promise((res) => setTimeout(res, SHUTDOWN_GRACE_MS + 60));
    expect(shutdowns.length).toBe(0);
  });

  test("a same-origin POST /shutdown works, and only AFTER the response is produced", async () => {
    const { handler, shutdowns } = make();
    const r = await handler(req("/shutdown", { method: "POST", headers: { origin: `http://${H}`, "sec-fetch-site": "same-origin" } }));
    expect(r.status).toBe(200);
    expect(await r.text()).toBe("ok");
    expect(shutdowns.length).toBe(0);                                   // not yet: the reply must be flushed first
    await new Promise((res) => setTimeout(res, SHUTDOWN_GRACE_MS + 60));
    expect(shutdowns.length).toBe(1);
    expect((await handler(req("/shutdown", { method: "GET" }))).status).not.toBe(200);   // GET must not shut down
  });

  test("no CORS grants anywhere (the old server sent Access-Control-Allow-Origin: *)", async () => {
    const { handler } = make();
    for (const r of [await handler(req("/")), await handler(req("/__ass/identity")), await handler(req("/room/ABCD", { method: "GET" })),
      await handler(req("/anything", { method: "OPTIONS" })), await handler(req("/shutdown", { method: "POST" }))]) {
      expect(r.headers.get("access-control-allow-origin")).toBeNull();
    }
  });

  test("hostAllowed / originOk unit behaviour", () => {
    const r = (headers) => new Request("http://x/", { headers });
    expect(hostAllowed(r({ host: H }), PORT)).toBe(true);
    expect(hostAllowed(r({ host: `localhost:${PORT}` }), PORT)).toBe(true);
    expect(hostAllowed(r({ host: `[::1]:${PORT}` }), PORT)).toBe(true);
    expect(originOk(r({ host: H, origin: `http://${H}` }))).toBe(true);
    expect(originOk(r({ host: H }))).toBe(true);                                   // non-browser clients send no Origin
    expect(originOk(r({ host: H, origin: "http://evil.example" }))).toBe(false);
    expect(originOk(r({ host: H, "sec-fetch-site": "cross-site" }))).toBe(false);
  });
});

describe("crash reports are bounded", () => {
  const post = (handler, body, headers = {}) => handler(req("/crash-report", { method: "POST", body, headers: { origin: `http://${H}`, ...headers } }));

  test("valid report is written to logs/", async () => {
    const { handler, logsDir } = make();
    const r = await post(handler, JSON.stringify({ msg: "boom", tick: 12 }));
    expect(r.status).toBe(200);
    const files = readdirSync(logsDir);
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/^crash-.*\.json$/);
  });

  test("oversized report is rejected (413) and writes nothing", async () => {
    const { handler, logsDir } = make();
    const huge = JSON.stringify({ blob: "x".repeat(LIMITS.crashBytes + 10) });
    expect((await post(handler, huge)).status).toBe(413);
    expect(existsSync(logsDir) ? readdirSync(logsDir).length : 0).toBe(0);
  });

  test("invalid JSON -> 400; cross-origin -> 403", async () => {
    const { handler, logsDir } = make();
    expect((await post(handler, "{not json")).status).toBe(400);
    expect((await handler(req("/crash-report", { method: "POST", body: "{}", headers: { origin: "http://evil.example" } }))).status).toBe(403);
    expect(readdirSync(logsDir).length).toBe(0);
  });

  test("the log directory never grows past LIMITS.crashFiles", async () => {
    const { handler, logsDir, tick } = make();
    for (let i = 0; i < LIMITS.crashFiles + 15; i++) { tick(1000); await post(handler, JSON.stringify({ i })); }
    expect(readdirSync(logsDir).length).toBeLessThanOrEqual(LIMITS.crashFiles);
  });
});

describe("signalling rooms are bounded", () => {
  const post = (handler, code, blob) => handler(req(`/room/${code}`, { method: "POST", body: JSON.stringify(blob), headers: { origin: `http://${H}` } }));
  const drain = async (handler, code) => (await handler(req(`/room/${code}`))).json();

  test("POST then GET drains FIFO, then the box is empty", async () => {
    const { handler } = make();
    await post(handler, "abcdef", { sdp: 1 }); await post(handler, "ABCDEF", { sdp: 2 });   // codes are case-insensitive
    expect(await drain(handler, "ABCDEF")).toEqual([{ sdp: 1 }, { sdp: 2 }]);
    expect(await drain(handler, "ABCDEF")).toEqual([]);
  });

  test("room count never exceeds LIMITS.maxRooms (LRU eviction)", async () => {
    const { handler, tick } = make();
    for (let i = 0; i < LIMITS.maxRooms + 40; i++) { tick(5); await post(handler, `R${String(i).padStart(5, "0")}`, { i }); }
    expect(handler.rooms.size).toBeLessThanOrEqual(LIMITS.maxRooms);
    expect(handler.rooms.has(`R${String(LIMITS.maxRooms + 39).padStart(5, "0")}`)).toBe(true);   // newest survives
    expect(handler.rooms.has("R00000")).toBe(false);                                              // oldest evicted
  });

  test("a room's mailbox is capped and rooms expire after the TTL", async () => {
    const { handler, tick } = make();
    for (let i = 0; i < LIMITS.maxBoxMsgs + 10; i++) await post(handler, "CAPPED", { i });
    expect((await drain(handler, "CAPPED")).length).toBe(LIMITS.maxBoxMsgs);
    await post(handler, "STALE1", { a: 1 });
    tick(LIMITS.roomTtlMs + 1);
    handler.sweepRooms();
    expect(handler.rooms.has("STALE1")).toBe(false);
  });

  test("oversized signalling body -> 413; bad room code is not a room", async () => {
    const { handler } = make();
    expect((await post(handler, "BIGBOX", { x: "y".repeat(LIMITS.roomBodyBytes + 5) })).status).toBe(413);
    expect((await handler(req("/room/ab", { method: "GET" }))).status).toBe(404);          // too short
    expect((await handler(req("/room/../etc", { method: "GET" }))).status).toBe(404);
  });
});

describe("the launcher CLI", () => {
  const run = async (...args) => {
    const p = Bun.spawn([process.execPath, "run", join(ROOT, "run.js"), ...args], { cwd: ROOT, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    return { out, err, code };
  };

  test("--help exits 0 and documents the opt-in git cycle", async () => {
    const r = await run("--help");
    expect(r.code).toBe(0);
    expect(r.out).toContain("--git-cycle");
    expect(r.out).toContain("never touches git unless you pass --git-cycle");
  });

  test("--reflect prints valid JSON with identity, capabilities and a Bun runtime", async () => {
    const r = await run("--reflect");
    expect(r.code).toBe(0);
    const json = JSON.parse(r.out.slice(r.out.indexOf("{")));
    expect(json.registry.identity.name).toBe("airborne-submarine-squadron");
    expect(json.registry.ports.primary).toBe(6880);
    expect(json.registry.runtime.name).toBe("bun");
    expect(json.registry.capabilities).toContain("launchServer");
    expect(json.reflection.lines).toBeGreaterThan(100);
  });

  test("--no-launch runs detection + self-heal and leaves git completely alone", async () => {
    const before = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: ROOT }).stdout.toString();
    const statusBefore = Bun.spawnSync(["git", "status", "--porcelain"], { cwd: ROOT }).stdout.toString();
    const r = await run("--no-launch");
    expect(r.code).toBe(0);
    expect(r.out).not.toContain("Git cycle");
    expect(Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: ROOT }).stdout.toString()).toBe(before);
    expect(Bun.spawnSync(["git", "status", "--porcelain"], { cwd: ROOT }).stdout.toString()).toBe(statusBefore);
  });
});

describe("real socket smoke test", () => {
  test("Bun.serve + the handler serve the game and reject a forged Host", async () => {
    let server;
    const handler = createHandler({ root: ROOT, getPort: () => server.port });
    server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: handler });
    try {
      const ok = await fetch(`http://127.0.0.1:${server.port}/gossamer/index_gossamer.html`);
      expect(ok.status).toBe(200);
      expect(ok.headers.get("content-type")).toContain("text/html");
      const git = await fetch(`http://127.0.0.1:${server.port}/.git/config`);
      expect(git.status).toBe(404);
    } finally { server.stop(true); }
  });
});
