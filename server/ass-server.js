// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Jonathan D.A. Jewell (hyperpolymath)
//
// ass-server.js — the local game server's request handler, as a pure
// `(Request) => Response` factory so it can be tested without binding a port
// and served by `Bun.serve` (the estate runtime; Deno is retired, LANGUAGE-POLICY 2026-09-22).
//
// What changed from the Deno-era run.js server, and why (each has a test in
// test/server_test.js):
//
//  * STATIC ALLOWLIST, not "serve the repo root".  The old serveDir(".") exposed
//    .git/ (remote URLs can embed tokens), logs/, .machine_readable/ ... Now only the
//    game's own assets are reachable, dotfiles never are.
//  * SAME-ORIGIN ONLY for anything that mutates.  The old server answered
//    `POST /shutdown` and `POST /crash-report` with `Access-Control-Allow-Origin: *`:
//    any web page you visited could stop your game server or fill your disk.  Host
//    must be loopback:<our port> (defeats DNS rebinding); Origin / Sec-Fetch-Site must
//    agree.
//  * BOUNDED: crash reports <= 256 KiB and <= 50 files kept; signalling bodies <= 64 KiB;
//    rooms/boxes capped with LRU eviction and a TTL sweep.
//  * GROOVE: GET /.well-known/groove serves the capability manifest, making the running
//    game a discoverable groove provider (mode "active").

import { mkdirSync, readdirSync, unlinkSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { resolve, sep, extname } from "node:path";

/** How long /shutdown waits (ms) so its own response is flushed before the server stops. */
export const SHUTDOWN_GRACE_MS = 50;

export const LIMITS = Object.freeze({
  crashBytes: 256 * 1024,
  crashFiles: 50,
  roomBodyBytes: 64 * 1024,
  roomTtlMs: 10 * 60 * 1000,
  maxRooms: 256,
  maxBoxMsgs: 64,
});

/** Top-level names that may be served at all. Everything else is 404. */
const STATIC_TOP = new Set(["index.html", "gossamer", "build", "dist", "desktop", "docs/assets/banner.png", "favicon.ico"]);
/** `desktop/` only exposes icons. */
const STATIC_SUB_ALLOW = { desktop: "icons" };
/** File types the game actually loads. No .sh, .eph, .desktop, .md ... */
const STATIC_EXT = new Set([".html", ".js", ".mjs", ".css", ".json", ".wasm", ".png", ".svg", ".ico", ".jpg", ".jpeg", ".webp", ".wav", ".mp3", ".ogg", ".txt", ".map"]);

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".wasm": "application/wasm", ".png": "image/png",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".wav": "audio/wav", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".txt": "text/plain; charset=utf-8", ".map": "application/json",
};

const SECURITY_HEADERS = Object.freeze({
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "same-origin",
});

/**
 * Map a URL pathname to an absolute file path, or null if it must not be served.
 * Pure (no I/O) so the traversal tests are exhaustive and fast.
 */
export function resolveStatic(root, pathname) {
  let p;
  try { p = decodeURIComponent(pathname); } catch { return null; }
  if (p.includes("\0") || p.includes("\\")) return null;
  if (p === "/") p = "/index.html";
  const segs = p.split("/").filter(Boolean);
  if (segs.length === 0) return null;

  // RFC 9116 / groove: /.well-known/* lives in www/.well-known/ (the RSR layout)
  let base = segs;
  if (segs[0] === ".well-known") base = ["www", ".well-known", ...segs.slice(1)];
  const checkable = segs[0] === ".well-known" ? segs.slice(1) : segs;
  if (checkable.some((s) => s === ".." || s === "." || s.startsWith("."))) return null;   // dotfiles, .git, traversal

  if (segs[0] !== ".well-known") {
    if (!STATIC_TOP.has(segs[0])) return null;
    const sub = STATIC_SUB_ALLOW[segs[0]];
    if (sub && segs[1] !== sub) return null;
  }
  const last = base[base.length - 1];
  const ext = extname(last).toLowerCase();
  const isGrooveManifest = segs[0] === ".well-known" && segs[1] === "groove" && segs.length === 2;
  if (isGrooveManifest) base = ["www", ".well-known", "groove", "manifest.json"];
  else if (!STATIC_EXT.has(ext)) return null;

  const rootAbs = resolve(root);
  const abs = resolve(rootAbs, ...base);
  if (abs !== rootAbs && !abs.startsWith(rootAbs + sep)) return null;
  return abs;
}

/**
 * Host-header allowlist (DNS-rebinding defence): the request must be addressed to us on loopback, on OUR port —
 * or to a host the operator explicitly allowed (e.g. AIRBORNE_ALLOWED_HOSTS='*.e2b.app' for a preview proxy).
 * Patterns are exact hostnames or '*.suffix'.
 */
export function hostAllowed(req, port, extraHosts = []) {
  const host = (req.headers.get("host") || "").toLowerCase();
  if ([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(host)) return true;
  const name = host.replace(/:\d+$/, "");
  return extraHosts.some((p) => {
    const pat = p.trim().toLowerCase();
    return pat.startsWith("*.") ? name.endsWith(pat.slice(1)) && name.length > pat.length - 1 : name === pat;
  });
}

/** For mutating requests: Origin (if sent) must be THIS origin, and the browser must not call it cross-site. */
export function originOk(req) {
  const host = (req.headers.get("host") || "").toLowerCase();
  const origin = req.headers.get("origin");
  if (origin) {
    let oh;
    try { oh = new URL(origin).host.toLowerCase(); } catch { return false; }
    if (oh !== host) return false;
  }
  const site = req.headers.get("sec-fetch-site");
  return !site || site === "same-origin" || site === "none";
}

export function sameOriginOk(req, port, extraHosts = []) {
  return hostAllowed(req, port, extraHosts) && originOk(req);
}

async function readLimited(req, limit) {
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > limit) return { tooBig: true };
  if (!req.body) return { text: "" };
  const reader = req.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) { try { await reader.cancel(); } catch { /* already closed */ } return { tooBig: true }; }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.byteLength; }
  return { text: new TextDecoder().decode(buf) };
}

const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", ...SECURITY_HEADERS, ...extra } });
const text = (body, status = 200) =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", ...SECURITY_HEADERS } });

/**
 * @param {object} o
 * @param {string} o.root                 repo root (files are served from here, allowlisted)
 * @param {() => number} o.getPort        the port actually bound (for the Host check)
 * @param {string} [o.logsDir]            crash report directory (default <root>/logs)
 * @param {() => void} [o.onShutdown]     called AFTER the /shutdown response is sent
 * @param {string[]} [o.allowedHosts]     extra Host patterns besides loopback (e.g. ['*.e2b.app'])
 * @param {boolean} [o.debug]             disable caching
 * @param {(m: string) => void} [o.log]
 * @param {() => number} [o.now]          injectable clock (tests)
 */
export function createHandler(o) {
  const root = resolve(o.root);
  const logsDir = o.logsDir ?? resolve(root, "logs");
  const now = o.now ?? (() => Date.now());
  const log = o.log ?? (() => {});
  const allowedHosts = o.allowedHosts ?? [];

  /** @type {Map<string, { box: any[], last: number }>} */
  const rooms = new Map();
  function sweepRooms() {
    const t = now();
    for (const [code, r] of rooms) if (t - r.last > LIMITS.roomTtlMs) rooms.delete(code);
  }

  function pruneCrashLogs() {
    try {
      const files = readdirSync(logsDir).filter((f) => f.startsWith("crash-") && f.endsWith(".json")).sort();
      for (const f of files.slice(0, Math.max(0, files.length - LIMITS.crashFiles))) unlinkSync(resolve(logsDir, f));
    } catch { /* best effort */ }
  }

  async function handle(req) {
    const url = new URL(req.url);
    const { pathname } = url;
    const method = req.method;
    const port = o.getPort();
    const mutating = method === "POST" || method === "PUT" || method === "DELETE" || method === "PATCH";

    if (method === "OPTIONS") return new Response(null, { status: 204, headers: SECURITY_HEADERS });   // no CORS grants

    // 1) EVERY request must be addressed to us (DNS-rebinding defence).
    if (!hostAllowed(req, port, allowedHosts)) return text("forbidden", 403);
    // 2) Anything that mutates must be same-origin (no cross-site POSTs to /shutdown, /crash-report, /room/*).
    if (mutating && !originOk(req)) return text("forbidden", 403);

    if (mutating && pathname === "/shutdown") {
      if (method !== "POST") return text("method not allowed", 405);
      log("Shutdown requested from game — closing server");
      // Respond first; stop only AFTER the response has been flushed. (A bare microtask runs before
      // the socket write, and a forced stop then truncates the reply: the client sees a network error.)
      queueMicrotask(() => setTimeout(() => { try { o.onShutdown?.(); } catch { /* shutting down anyway */ } }, SHUTDOWN_GRACE_MS));
      return text("ok");
    }

    if (mutating && pathname === "/crash-report") {
      if (method !== "POST") return text("method not allowed", 405);
      const body = await readLimited(req, LIMITS.crashBytes);
      if (body.tooBig) return text("payload too large", 413);
      let parsed;
      try { parsed = JSON.parse(body.text); } catch { return text("invalid json", 400); }
      try {
        mkdirSync(logsDir, { recursive: true });
        const ts = new Date(now()).toISOString().replace(/[:.]/g, "-");
        writeFileSync(resolve(logsDir, `crash-${ts}-${Math.random().toString(36).slice(2, 8)}.json`), JSON.stringify(parsed, null, 2));
        pruneCrashLogs();
        return text("ok");
      } catch (e) { return text(String(e && e.message || e), 500); }
    }

    // ── WebRTC signalling mailbox (peers exchange SDP/ICE here; data then flows peer-to-peer) ──
    const roomMatch = pathname.match(/^\/room\/([A-Za-z0-9]{4,12})$/);
    if (roomMatch) {
      sweepRooms();
      const code = roomMatch[1].toUpperCase();
      if (!rooms.has(code) && rooms.size >= LIMITS.maxRooms) {
        let oldest = null, oldestT = Infinity;
        for (const [c, rr] of rooms) if (rr.last < oldestT) { oldestT = rr.last; oldest = c; }
        if (oldest) rooms.delete(oldest);
      }
      if (!rooms.has(code)) rooms.set(code, { box: [], last: now() });
      const r = rooms.get(code);
      r.last = now();
      if (method === "POST") {
        const body = await readLimited(req, LIMITS.roomBodyBytes);
        if (body.tooBig) return json({ ok: false, error: "payload too large" }, 413);
        let blob;
        try { blob = JSON.parse(body.text); } catch (e) { return json({ ok: false, error: "invalid json" }, 400); }
        if (r.box.length >= LIMITS.maxBoxMsgs) r.box.shift();
        r.box.push(blob);
        return json({ ok: true });
      }
      if (method === "GET") return json(r.box.splice(0));
      return text("method not allowed", 405);
    }

    if (method !== "GET" && method !== "HEAD") return text("method not allowed", 405);

    if (pathname === "/__ass/identity") {
      return json({ name: "airborne-submarine-squadron", kind: "game-server" });
    }

    const abs = resolveStatic(root, pathname);
    if (!abs) return text("not found", 404);
    // Bun.file when running under Bun; plain fs fallback keeps this module testable under Node too.
    let body, size;
    if (typeof Bun !== "undefined") {
      const f = Bun.file(abs);
      if (!(await f.exists())) return text("not found", 404);
      body = f; size = f.size;
    } else {
      if (!existsSync(abs)) return text("not found", 404);
      body = readFileSync(abs); size = body.length;
    }
    const isManifest = abs.endsWith(`${sep}groove${sep}manifest.json`);
    const headers = {
      ...SECURITY_HEADERS,
      "content-type": isManifest ? "application/groove+json" : (MIME[extname(abs).toLowerCase()] || "application/octet-stream"),
      "content-length": String(size),
    };
    if (o.debug) Object.assign(headers, { "Cache-Control": "no-store, no-cache, must-revalidate", Pragma: "no-cache", Expires: "0" });
    return new Response(method === "HEAD" ? null : body, { status: 200, headers });
  }

  return Object.assign(handle, { rooms, sweepRooms });
}
