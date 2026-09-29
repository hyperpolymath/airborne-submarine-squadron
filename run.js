// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Jonathan D.A. Jewell (hyperpolymath)
//
// run.js — homoiconic, fault-tolerant, platform-independent launcher for
// Airborne Submarine Squadron (ASS).  Runtime: Bun (the estate runtime; Deno is
// retired — standards 0-canon/rsr/LANGUAGE-POLICY.adoc, owner ruling 2026-09-22).
//
// Usage:
//   bun run run.js                 # detect platform, serve, open the game
//   bun run run.js --help
//   bun run run.js --reflect       # print the registry + self-reflection as JSON
//
// Behavioural changes from the Deno-era script (see docs/BUN-MIGRATION.adoc):
//   * The git cycle (add -A / commit / push / checkout main / merge / push mirrors)
//     is now OPT-IN (--git-cycle). It used to run on EVERY launch unless --no-git
//     was passed; launching a game must never touch your branches.  --no-git is
//     still accepted (it is now the default) so old shortcuts keep working.
//   * Stale-instance recovery asks a previous game server to shut itself down
//     (identity check + POST /shutdown) instead of `fuser -k`-ing whatever holds
//     ports 6880-6884.  Strangers' processes are left alone.
//   * The server itself lives in server/ass-server.js (allowlisted static files,
//     same-origin guard, bounded uploads) and is unit-tested without a socket.

import { chdir } from "node:process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, copyFileSync, statSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { createHandler } from "./server/ass-server.js";

const HERE = dirname(fileURLToPath(import.meta.url));

// ─────────────────────────────────────────────────────────────────────────────
// REGISTRY — the script is its own data. Everything it knows about itself is
// declared here and read at runtime via reflect().
// ─────────────────────────────────────────────────────────────────────────────
const REGISTRY = {
  identity: {
    name:    "airborne-submarine-squadron",
    display: "Airborne Submarine Squadron (ASS)",
    version: "0.5.0",
    license: "AGPL-3.0-or-later",
    repo:    "https://github.com/hyperpolymath/airborne-submarine-squadron",
  },
  entryPoints: {
    root:     "index.html",
    gossamer: "gossamer/index_gossamer.html",
  },
  wasm: {
    dist:  "dist/airborne-submarine-squadron.wasm",
    build: "build/airborne-submarine-squadron.wasm",
  },
  ports: {
    primary:  6880,
    fallback: [6881, 6882, 6883, 6884],
  },
  launchers: {
    native:   "gossamer/launch.sh",
    unified:  "launcher.sh",
    build:    "build.sh",
  },
  git: {
    remote:  "origin",
    branch:  "main",
    mirrors: [], // populated at runtime from git remote -v
  },
  platforms: {
    linux:   { display: "Linux", supported: true },
    darwin:  { display: "macOS", supported: true },
    windows: { display: "Windows", supported: "partial" },
  },
  runtime: { name: "bun", minimum: "1.1" },
  capabilities: [
    "reflect",        // reads own source (homoiconic)
    "detectPlatform", // OS, arch, display server
    "checkGitSync",   // fetch + ahead/behind + dirty check
    "selfHeal",       // copy dist→build WASM if missing
    "detectVersions", // git tags + WASM artifact dates
    "findPort",       // bind 6880 then fallbacks
    "launchNative",   // Ephapax + libgossamer.so
    "launchServer",   // Bun game server + open browser
    "launchHeadless", // wasmtime CLI mode
    "gitCycle",       // add, commit, push, mirror  (opt-in: --git-cycle)
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// LOGGING
// ─────────────────────────────────────────────────────────────────────────────
const c = { reset: "\x1b[0m", bold: "\x1b[1m", green: "\x1b[32m", yellow: "\x1b[33m", cyan: "\x1b[36m", red: "\x1b[31m" };
function log(msg)  { console.log(`${c.green}▶${c.reset} ${msg}`); }
function warn(msg) { console.warn(`${c.yellow}⚠${c.reset} ${msg}`); }
function head(msg) { console.log(`\n${c.bold}${c.cyan}${msg}${c.reset}`); }

// ─────────────────────────────────────────────────────────────────────────────
// SUBPROCESS HELPER
// ─────────────────────────────────────────────────────────────────────────────
async function run(cmd, args, opts = {}) {
  try {
    const p = Bun.spawn([cmd, ...args], { stdout: "pipe", stderr: "pipe", stdin: "ignore", ...opts });
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    return { ok: code === 0, out: out.trim(), err: err.trim(), code };
  } catch (e) {
    return { ok: false, out: "", err: e.message, code: -1 };
  }
}
async function commandExists(cmd) {
  const probe = process.platform === "win32" ? "where" : "which";
  return (await run(probe, [cmd])).ok;
}

// ─────────────────────────────────────────────────────────────────────────────
// REFLECTION — reads own source so REGISTRY isn't just code, it's live data
// ─────────────────────────────────────────────────────────────────────────────
async function reflect() {
  const path = fileURLToPath(import.meta.url);
  const src  = readFileSync(path, "utf8");
  return { path, lines: src.split("\n").length, capabilities: REGISTRY.capabilities };
}

// ─────────────────────────────────────────────────────────────────────────────
// PLATFORM DETECTION
// ─────────────────────────────────────────────────────────────────────────────
async function detectPlatform() {
  const os   = { linux: "linux", darwin: "darwin", win32: "windows" }[process.platform] ?? process.platform;
  const arch = { x64: "x86_64", arm64: "aarch64" }[process.arch] ?? process.arch;

  let displayServer = "unknown";
  if (os === "linux") {
    if (process.env.WAYLAND_DISPLAY) displayServer = "wayland";
    else if (process.env.DISPLAY)    displayServer = "x11";
    else                             displayServer = "headless";
  } else if (os === "darwin") displayServer = "quartz";
  else if (os === "windows")  displayServer = "win32";

  // Native Gossamer (Ephapax + libgossamer) — sibling checkouts
  const parentDir = resolve(HERE, "..");
  const ephapax = `${parentDir}/developer-ecosystem/nextgen-languages/ephapax/target/release/ephapax`;
  const libpath = `${parentDir}/gossamer/src/interface/ffi/zig-out/lib/libgossamer.so`;
  const nativeAvailable = existsSync(ephapax) && existsSync(libpath);

  let browserCmd = null;
  for (const cmd of ["xdg-open", "open", "start"]) {
    if (await commandExists(cmd)) { browserCmd = cmd; break; }
  }
  const wasmtime = (await run("wasmtime", ["--version"])).ok;

  return { os, arch, displayServer, nativeAvailable, bunVersion: process.versions.bun ?? null, browserCmd, wasmtime };
}

// ─────────────────────────────────────────────────────────────────────────────
// GIT SYNC CHECK (read-only)
// ─────────────────────────────────────────────────────────────────────────────
async function checkGitSync() {
  const status = { dirty: false, ahead: 0, behind: 0, branch: "unknown", fetchError: false };
  const branch = await run("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: HERE });
  if (branch.ok) status.branch = branch.out;

  const fetch = await run("git", ["fetch", "--quiet", REGISTRY.git.remote], { cwd: HERE });
  if (!fetch.ok) { status.fetchError = true; warn("git fetch failed — working offline"); }

  const revlist = await run("git", ["rev-list", "--left-right", "--count", `${REGISTRY.git.remote}/${status.branch}...HEAD`], { cwd: HERE });
  if (revlist.ok) {
    const parts = revlist.out.split(/\s+/);
    status.behind = parseInt(parts[0], 10) || 0;
    status.ahead  = parseInt(parts[1], 10) || 0;
  }
  const diff = await run("git", ["status", "--porcelain"], { cwd: HERE });
  if (diff.ok && diff.out.length > 0) status.dirty = true;

  const remotes = await run("git", ["remote", "-v"], { cwd: HERE });
  if (remotes.ok) {
    REGISTRY.git.mirrors = [...new Set(
      remotes.out.split("\n")
        .filter((l) => l.includes("(push)") && !l.startsWith(REGISTRY.git.remote + "\t"))
        .map((l) => l.split("\t")[0]),
    )];
  }
  return status;
}

// ─────────────────────────────────────────────────────────────────────────────
// SELF-HEALING
// ─────────────────────────────────────────────────────────────────────────────
async function selfHeal() {
  const healed = [];
  if (!existsSync(REGISTRY.wasm.build) && existsSync(REGISTRY.wasm.dist)) {
    try {
      mkdirSync("build", { recursive: true });
      copyFileSync(REGISTRY.wasm.dist, REGISTRY.wasm.build);
      healed.push("Copied dist WASM → build/");
    } catch { /* cannot heal: compiler needed */ }
  }
  return healed;
}

// ─────────────────────────────────────────────────────────────────────────────
// VERSION DETECTION
// ─────────────────────────────────────────────────────────────────────────────
async function detectVersions() {
  const versions = [];
  const tags = await run("git", ["tag", "--sort=-version:refname"], { cwd: HERE });
  if (tags.ok && tags.out) for (const tag of tags.out.split("\n").slice(0, 5)) if (tag) versions.push({ label: tag, type: "release" });
  const sha = await run("git", ["rev-parse", "--short", "HEAD"], { cwd: HERE });
  if (sha.ok) versions.push({ label: `HEAD (${sha.out})`, type: "current" });
  for (const [key, path] of Object.entries(REGISTRY.wasm)) {
    try {
      const info = statSync(path);
      versions.push({ label: `WASM ${key}: ${path} (${info.mtime.toISOString().slice(0, 10)})`, type: "artifact" });
    } catch { /* not present */ }
  }
  return versions;
}

// ─────────────────────────────────────────────────────────────────────────────
// PORT HANDLING — ask a stale game server to leave; never kill strangers
// ─────────────────────────────────────────────────────────────────────────────
async function reclaimOurPorts(ports) {
  for (const port of ports) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/__ass/identity`, { signal: AbortSignal.timeout(300) });
      const id = await r.json();
      if (id && id.name === REGISTRY.identity.name) {
        log(`Found a previous game server on :${port} — asking it to shut down`);
        await fetch(`http://127.0.0.1:${port}/shutdown`, { method: "POST", signal: AbortSignal.timeout(500) }).catch(() => {});
        await new Promise((res) => setTimeout(res, 250));
      }
    } catch { /* nothing (or something that isn't us) listening: leave it alone */ }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LAUNCH STRATEGIES (native → bun server → headless)
// ─────────────────────────────────────────────────────────────────────────────
async function launchNative(platform) {
  if (!platform.nativeAvailable) return false;
  log("Launching via Ephapax native runtime...");
  const launcher = REGISTRY.launchers.native;
  try {
    if (!existsSync(launcher)) return false;
    const child = Bun.spawn(["bash", launcher], { stdin: "ignore", stdout: "inherit", stderr: "inherit" });
    log("Gossamer native launched (pid via launch.sh)");
    await child.exited;
    return true;
  } catch (e) {
    warn(`Native launch failed: ${e.message}`);
    return false;
  }
}

async function launchServer(platform, opts) {
  const candidates = opts.port ? [opts.port] : [REGISTRY.ports.primary, ...REGISTRY.ports.fallback];
  await reclaimOurPorts(candidates);

  const debug = opts.debug || process.env.AIRBORNE_DEBUG === "1";
  const allowedHosts = (process.env.AIRBORNE_ALLOWED_HOSTS || "").split(",").map((s) => s.trim()).filter(Boolean);
  mkdirSync("logs", { recursive: true });

  let server = null;
  const handler = createHandler({
    root: HERE,
    getPort: () => server.port,
    debug,
    allowedHosts,
    log,
    onShutdown: () => { try { server.stop(); } catch { /* already stopped */ } cleanupPid(); setTimeout(() => process.exit(0), 100); },
  });

  let lastErr = null;
  for (const port of candidates) {
    try {
      server = Bun.serve({ port, hostname: "127.0.0.1", fetch: handler });
      break;
    } catch (e) { lastErr = e; /* port busy: try the next one */ }
  }
  if (!server) throw new Error(`No free port in ${candidates.join(", ")}: ${lastErr?.message ?? "unknown error"}`);

  const url = `http://127.0.0.1:${server.port}/`;
  const pidFile = opts.pidFile;
  function cleanupPid() { if (pidFile) { try { unlinkSync(pidFile); } catch { /* already gone */ } } }
  if (pidFile) { try { writeFileSync(pidFile, String(process.pid)); } catch { /* best effort */ } }

  log(`Game server: ${url}  |  crash reports: POST /crash-report`);
  log(`Press Ctrl+C to stop the server and release port ${server.port}`);

  const shutdown = () => { warn("Shutting down server..."); try { server.stop(true); } catch { /* ignore */ } cleanupPid(); process.exit(0); };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const debugQS = debug ? `?debug=1&cb=${Date.now()}` : "";
  const gameUrl = `${url}${REGISTRY.entryPoints.gossamer}${debugQS}`;
  if (platform.browserCmd && !opts.noOpen) {
    log(`Opening Gossamer at ${gameUrl}`);
    try { Bun.spawn([platform.browserCmd, gameUrl], { stdin: "ignore", stdout: "ignore", stderr: "ignore" }).unref(); }
    catch { log(`Could not open browser — visit ${gameUrl} manually`); }
  } else {
    log(`Server running — open ${gameUrl} in your browser`);
  }

  // Keep the process alive until shutdown (Bun.serve keeps the event loop busy).
  await new Promise(() => {});
  return true;
}

async function launchHeadless(platform) {
  if (!platform.wasmtime) { warn("No launch method available — install Bun or Ephapax to play"); return false; }
  log("Launching in headless WASM mode (wasmtime)...");
  if (!existsSync(REGISTRY.wasm.build)) { warn(`WASM not found at ${REGISTRY.wasm.build} — run: ./build.sh`); return false; }
  const child = Bun.spawn(["wasmtime", REGISTRY.wasm.build], { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  await child.exited;
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// GIT CYCLE — OPT-IN ONLY (--git-cycle): add, commit, push branch, merge to main, push main, push mirrors
// ─────────────────────────────────────────────────────────────────────────────
async function gitCycle(sync) {
  log("\n── Git cycle ──");
  const add = await run("git", ["add", "-A"], { cwd: HERE });
  if (!add.ok) { warn("git add failed: " + add.err); return; }
  const staged = await run("git", ["diff", "--cached", "--stat"], { cwd: HERE });
  if (staged.out.length > 0) {
    const msg = "chore: run.js launch cycle — platform auto-detected, self-healed artifacts";
    const commit = await run("git", ["commit", "-m", msg], { cwd: HERE });
    if (commit.ok) log("Committed: " + msg); else { warn("git commit failed: " + commit.err); return; }
  } else log("Nothing to commit — working tree clean");

  const pushBranch = await run("git", ["push", REGISTRY.git.remote, sync.branch], { cwd: HERE });
  if (pushBranch.ok) log(`Pushed ${sync.branch} → ${REGISTRY.git.remote}`); else warn("Push failed: " + pushBranch.err);

  const mainBranch = "main";
  if (sync.branch !== mainBranch) {
    log(`Merging ${sync.branch} → ${mainBranch}...`);
    const checkout = await run("git", ["checkout", mainBranch], { cwd: HERE });
    if (!checkout.ok) { warn("Could not switch to main: " + checkout.err); return; }
    const merge = await run("git", ["merge", "--ff-only", sync.branch], { cwd: HERE });
    if (merge.ok) log(`Fast-forward merged ${sync.branch} → ${mainBranch}`);
    else {
      warn("Fast-forward merge failed — trying regular merge");
      const mr = await run("git", ["merge", sync.branch, "-m", `chore: merge ${sync.branch} → main`], { cwd: HERE });
      if (!mr.ok) { warn("Merge failed: " + mr.err); return; }
      log(`Merged ${sync.branch} → ${mainBranch}`);
    }
    const pushMain = await run("git", ["push", REGISTRY.git.remote, mainBranch], { cwd: HERE });
    if (pushMain.ok) log(`Pushed ${mainBranch} → ${REGISTRY.git.remote}`); else warn("Main push failed: " + pushMain.err);
  }
  for (const mirror of REGISTRY.git.mirrors) {
    log(`Pushing to mirror: ${mirror}`);
    const mp = await run("git", ["push", mirror, mainBranch], { cwd: HERE });
    if (mp.ok) log(`Pushed to ${mirror}`); else warn(`Mirror push failed (${mirror}): ${mp.err}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
function argValue(args, flag) {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}

if (import.meta.main) {
  // Desktop shortcuts may launch from $HOME: always run from the repo root.
  try { chdir(HERE); } catch { /* keep going */ }
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
${c.bold}${REGISTRY.identity.display} — run.js${c.reset}
${REGISTRY.identity.license} | ${REGISTRY.identity.repo}

Usage: bun run run.js [OPTIONS]

Options:
  --help, -h       Show this help
  --reflect        Print self-reflection data and exit
  --no-launch      Do everything except launch the game
  --git-cycle      OPT-IN: after the game exits, add/commit/push the branch, merge to main, push mirrors
  --no-git         Skip git sync check (this is the default; accepted for old shortcuts)
  --debug          Cache-busting + on-screen diagnostics (?debug=1)
  --port N         Serve on exactly this port (default: 6880, then 6881-6884)
  --pid-file PATH  Write the server PID here (removed on exit)
  --no-open        Do not open a browser window

Environment:
  AIRBORNE_ALLOWED_HOSTS   extra Host patterns besides loopback, e.g. '*.e2b.app' (remote dev / preview proxy)
  AIRBORNE_DEBUG=1         same as --debug

This script is homoiconic: it reads its own source via reflect() and exposes its full
capability registry. It auto-detects the platform, self-heals missing WASM artifacts,
binds a free port, and launches via the best available method (Ephapax native →
Bun game server → wasmtime headless). It never touches git unless you pass --git-cycle.
`);
    process.exit(0);
  }

  const debugMode = args.includes("--debug");
  if (debugMode) { process.env.AIRBORNE_DEBUG = "1"; log("DEBUG MODE ENABLED — cache busting + on-screen diagnostics"); }

  head(`${REGISTRY.identity.display} v${REGISTRY.identity.version}`);

  if (args.includes("--reflect")) {
    const r = await reflect();
    console.log(JSON.stringify({ registry: REGISTRY, reflection: r }, null, 2));
    process.exit(0);
  }

  const r = await reflect();
  log(`Reflected: ${r.lines} lines, ${r.capabilities.length} capabilities`);

  head("Platform detection");
  const platform = await detectPlatform();
  log(`OS: ${platform.os} / ${platform.arch} / display: ${platform.displayServer}`);
  log(`Native Gossamer: ${platform.nativeAvailable ? "available" : "not found"}`);
  log(`Bun: ${platform.bunVersion ?? "not found"}`);
  log(`Browser: ${platform.browserCmd ?? "none"}`);
  log(`wasmtime: ${platform.wasmtime ? "available" : "not found"}`);

  const wantGitCycle = args.includes("--git-cycle");
  let sync = { dirty: false, ahead: 0, behind: 0, branch: "main", fetchError: false };
  if (wantGitCycle) {
    head("Git sync");
    sync = await checkGitSync();
    log(`Branch: ${sync.branch} | ahead: ${sync.ahead} | behind: ${sync.behind}`);
    if (sync.dirty) warn("Working tree has uncommitted changes");
    if (sync.behind > 0) warn(`${sync.behind} commit(s) behind remote — consider git pull`);
    if (sync.fetchError) warn("Could not reach remote — running offline");
    if (REGISTRY.git.mirrors.length > 0) log(`Mirrors: ${REGISTRY.git.mirrors.join(", ")}`);
  }

  head("Self-heal");
  const healed = await selfHeal();
  if (healed.length > 0) healed.forEach((h) => log(`Healed: ${h}`)); else log("No healing required");

  head("Versions");
  (await detectVersions()).forEach((v) => log(`${v.type}: ${v.label}`));

  if (!args.includes("--no-launch")) {
    head("Launching game");
    const opts = {
      debug: debugMode,
      port: argValue(args, "--port") ? parseInt(argValue(args, "--port"), 10) : null,
      pidFile: argValue(args, "--pid-file"),
      noOpen: args.includes("--no-open"),
    };
    let launched = await launchNative(platform);
    launched = launched || await launchServer(platform, opts);
    launched = launched || await launchHeadless(platform);
    if (!launched) warn("Could not launch game — check platform support above");
  }

  if (wantGitCycle) await gitCycle(sync);
  head("Done");
}

export { REGISTRY };
