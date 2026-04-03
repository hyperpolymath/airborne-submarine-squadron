// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Jonathan D.A. Jewell (hyperpolymath)
//
// run.js — Homoiconic, fault-tolerant, platform-independent run script
// for Airborne Submarine Squadron (ASS)
//
// Usage:
//   deno run --allow-all run.js          # auto-detect and launch
//   deno run --allow-all run.js --help   # show usage

// ─────────────────────────────────────────────────────────────────────────────
// REGISTRY — The script is its own data. Everything the script knows about
// itself is declared here and read at runtime via reflect().
// ─────────────────────────────────────────────────────────────────────────────
const REGISTRY = {
  identity: {
    name:    "airborne-submarine-squadron",
    display: "Airborne Submarine Squadron (ASS)",
    version: "0.4.0",
    license: "AGPL-3.0-or-later",
    repo:    "https://github.com/hyperpolymath/airborne-submarine-squadron",
  },
  entryPoints: {
    root:     "index.html",
    gossamer: "gossamer/index_gossamer.html",
  },
  wasm: {
    dist:  "dist/airborne-submarine-squadron.wasm",
    build: "build/airborne-final-working.wasm",
  },
  ports: {
    primary:  6860,
    fallback: [6870, 6871, 6872, 6873, 6874],
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
  capabilities: [
    "reflect",        // reads own source (homoiconic)
    "detectPlatform", // OS, arch, display server
    "checkGitSync",   // fetch + ahead/behind + dirty check
    "selfHeal",       // copy dist→build WASM if missing
    "detectVersions", // git tags + WASM artifact dates
    "findPort",       // probe 6860 then fallbacks
    "launchNative",   // Ephapax + libgossamer.so
    "launchDeno",     // Deno file server + xdg-open
    "launchHeadless", // wasmtime CLI mode
    "gitCycle",       // add, commit, push, mirror
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// REFLECTION — reads own source so REGISTRY isn't just code, it's live data
// ─────────────────────────────────────────────────────────────────────────────
async function reflect() {
  const path = new URL(import.meta.url).pathname;
  const src  = await Deno.readTextFile(path);
  const lines = src.split("\n").length;
  return { path, lines, capabilities: REGISTRY.capabilities };
}

// ─────────────────────────────────────────────────────────────────────────────
// PLATFORM DETECTION
// ─────────────────────────────────────────────────────────────────────────────
async function detectPlatform() {
  const os   = Deno.build.os;   // "linux" | "darwin" | "windows"
  const arch = Deno.build.arch; // "x86_64" | "aarch64"

  let displayServer = "unknown";
  if (os === "linux") {
    if (Deno.env.get("WAYLAND_DISPLAY")) displayServer = "wayland";
    else if (Deno.env.get("DISPLAY"))     displayServer = "x11";
    else                                  displayServer = "headless";
  } else if (os === "darwin") {
    displayServer = "quartz";
  } else if (os === "windows") {
    displayServer = "win32";
  }

  // Check if Ephapax native runtime is available
  const repoRoot  = Deno.cwd();
  const parentDir = repoRoot + "/..";
  const ephapax   = parentDir + "/nextgen-languages/ephapax/target/release/ephapax";
  const libpath   = parentDir + "/gossamer/src/interface/ffi/zig-out/lib/libgossamer.so";

  let nativeAvailable = false;
  try {
    await Deno.stat(ephapax);
    await Deno.stat(libpath);
    nativeAvailable = true;
  } catch { /* not available */ }

  let denoAvailable = false;
  try {
    const p = new Deno.Command("deno", { args: ["--version"], stdout: "null", stderr: "null" });
    const { success } = await p.output();
    denoAvailable = success;
  } catch { /* not available */ }

  let browserCmd = null;
  for (const cmd of ["xdg-open", "open", "start"]) {
    try {
      const p = new Deno.Command("which", { args: [cmd], stdout: "null", stderr: "null" });
      const { success } = await p.output();
      if (success) { browserCmd = cmd; break; }
    } catch { /* try next */ }
  }

  let wasmtime = false;
  try {
    const p = new Deno.Command("wasmtime", { args: ["--version"], stdout: "null", stderr: "null" });
    const { success } = await p.output();
    wasmtime = success;
  } catch { /* not available */ }

  return { os, arch, displayServer, nativeAvailable, denoAvailable, browserCmd, wasmtime };
}

// ─────────────────────────────────────────────────────────────────────────────
// GIT SYNC CHECK
// ─────────────────────────────────────────────────────────────────────────────
async function run(cmd, args, opts = {}) {
  try {
    const p = new Deno.Command(cmd, { args, stdout: "piped", stderr: "piped", ...opts });
    const { code, stdout, stderr } = await p.output();
    const out = new TextDecoder().decode(stdout).trim();
    const err = new TextDecoder().decode(stderr).trim();
    return { ok: code === 0, out, err, code };
  } catch (e) {
    return { ok: false, out: "", err: e.message, code: -1 };
  }
}

async function checkGitSync() {
  const status = { dirty: false, ahead: 0, behind: 0, branch: "unknown", fetchError: false };

  const branch = await run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch.ok) status.branch = branch.out;

  // Fetch quietly (don't block on network failures)
  const fetch = await run("git", ["fetch", "--quiet", REGISTRY.git.remote]);
  if (!fetch.ok) {
    status.fetchError = true;
    warn("git fetch failed — working offline");
  }

  // Ahead/behind
  const revlist = await run("git", ["rev-list", "--left-right", "--count",
    `${REGISTRY.git.remote}/${status.branch}...HEAD`]);
  if (revlist.ok) {
    const parts = revlist.out.split(/\s+/);
    status.behind = parseInt(parts[0], 10) || 0;
    status.ahead  = parseInt(parts[1], 10) || 0;
  }

  // Dirty check
  const diff = await run("git", ["status", "--porcelain"]);
  if (diff.ok && diff.out.length > 0) status.dirty = true;

  // Collect mirrors
  const remotes = await run("git", ["remote", "-v"]);
  if (remotes.ok) {
    REGISTRY.git.mirrors = [...new Set(
      remotes.out.split("\n")
        .filter(l => l.includes("(push)") && !l.startsWith(REGISTRY.git.remote + "\t"))
        .map(l => l.split("\t")[0])
    )];
  }

  return status;
}

// ─────────────────────────────────────────────────────────────────────────────
// SELF-HEALING
// ─────────────────────────────────────────────────────────────────────────────
async function selfHeal() {
  const healed = [];

  // Copy dist WASM → build if build is missing
  try {
    await Deno.stat(REGISTRY.wasm.build);
  } catch {
    try {
      await Deno.stat(REGISTRY.wasm.dist);
      await Deno.mkdir("build", { recursive: true });
      await Deno.copyFile(REGISTRY.wasm.dist, REGISTRY.wasm.build);
      healed.push("Copied dist WASM → build/");
    } catch { /* dist also missing — compiler needed */ }
  }

  return healed;
}

// ─────────────────────────────────────────────────────────────────────────────
// VERSION DETECTION
// ─────────────────────────────────────────────────────────────────────────────
async function detectVersions() {
  const versions = [];

  // Git tags
  const tags = await run("git", ["tag", "--sort=-version:refname"]);
  if (tags.ok && tags.out) {
    for (const tag of tags.out.split("\n").slice(0, 5)) {
      if (tag) versions.push({ label: tag, type: "release" });
    }
  }

  // Current HEAD
  const sha = await run("git", ["rev-parse", "--short", "HEAD"]);
  if (sha.ok) versions.push({ label: `HEAD (${sha.out})`, type: "current" });

  // WASM artifact timestamps
  for (const [key, path] of Object.entries(REGISTRY.wasm)) {
    try {
      const info = await Deno.stat(path);
      versions.push({
        label: `WASM ${key}: ${path} (${info.mtime?.toISOString().slice(0,10) ?? "?"})`,
        type: "artifact",
      });
    } catch { /* not present */ }
  }

  return versions;
}

// ─────────────────────────────────────────────────────────────────────────────
// PORT PROBING
// ─────────────────────────────────────────────────────────────────────────────
async function findFreePort() {
  const candidates = [REGISTRY.ports.primary, ...REGISTRY.ports.fallback];
  for (const port of candidates) {
    try {
      const listener = Deno.listen({ port });
      listener.close();
      return port;
    } catch { /* port in use */ }
  }
  throw new Error("No free port found in range 6860–6874");
}

// ─────────────────────────────────────────────────────────────────────────────
// LAUNCH STRATEGIES (native → deno → headless)
// ─────────────────────────────────────────────────────────────────────────────
async function launchNative(platform) {
  if (!platform.nativeAvailable) return false;
  log("Launching via Ephapax native runtime...");
  const launcher = REGISTRY.launchers.native;
  try {
    await Deno.stat(launcher);
    const p = new Deno.Command("bash", {
      args: [launcher],
      stdin: "null", stdout: "inherit", stderr: "inherit",
    });
    const child = p.spawn();
    log(`Gossamer native launched (pid via launch.sh)`);
    await child.status;
    return true;
  } catch (e) {
    warn(`Native launch failed: ${e.message}`);
    return false;
  }
}

async function launchDeno(platform) {
  if (!platform.denoAvailable) return false;
  log("Launching via Deno file server...");

  const port = await findFreePort();
  const url  = `http://127.0.0.1:${port}/`;

  // Inline Deno file server — no install step
  const serverScript = `
    import { serveDir } from "https://deno.land/std@0.224.0/http/file_server.ts";
    const handler = (req) => serveDir(req, { fsRoot: ".", quiet: true });
    const server = Deno.serve({ port: ${port}, hostname: "127.0.0.1" }, handler);
    console.log("ASS game server: ${url}");
  `;
  const tmpServer = await Deno.makeTempFile({ suffix: ".js" });
  await Deno.writeTextFile(tmpServer, serverScript);

  const server = new Deno.Command("deno", {
    args: ["run", "--allow-net", "--allow-read", tmpServer],
    stdin: "null", stdout: "inherit", stderr: "inherit",
  }).spawn();

  // Give the server a moment to start
  await new Promise(r => setTimeout(r, 800));

  if (platform.browserCmd) {
    log(`Opening browser at ${url}`);
    await run(platform.browserCmd, [url]);
  } else {
    log(`Server running at ${url} — open in your browser`);
  }

  await server.status;
  try { await Deno.remove(tmpServer); } catch { /* cleanup best-effort */ }
  return true;
}

async function launchHeadless(platform) {
  if (!platform.wasmtime) {
    warn("No launch method available — install Deno or Ephapax to play");
    return false;
  }
  log("Launching in headless WASM mode (wasmtime)...");
  try {
    await Deno.stat(REGISTRY.wasm.build);
  } catch {
    warn(`WASM not found at ${REGISTRY.wasm.build} — run: ./build.sh`);
    return false;
  }
  const p = new Deno.Command("wasmtime", {
    args: [REGISTRY.wasm.build],
    stdin: "inherit", stdout: "inherit", stderr: "inherit",
  });
  const child = p.spawn();
  await child.status;
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// GIT CYCLE — add, commit outstanding, push to origin + mirrors
// ─────────────────────────────────────────────────────────────────────────────
async function gitCycle(sync) {
  log("\n── Git cycle ──");

  // Stage all changes
  const add = await run("git", ["add", "-A"]);
  if (!add.ok) { warn("git add failed: " + add.err); return; }

  // Check if anything to commit
  const staged = await run("git", ["diff", "--cached", "--stat"]);
  if (staged.out.length === 0) {
    log("Nothing to commit — working tree clean");
  } else {
    const msg = `chore: run.js launch cycle — platform auto-detected, self-healed artifacts`;
    const commit = await run("git", ["commit", "-m", msg]);
    if (commit.ok) {
      log("Committed: " + msg);
    } else {
      warn("git commit failed: " + commit.err);
    }
  }

  // Push to origin
  if (sync.ahead > 0 || staged.out.length > 0) {
    log(`Pushing to ${REGISTRY.git.remote}/${sync.branch}...`);
    const push = await run("git", ["push", REGISTRY.git.remote, sync.branch]);
    if (push.ok) log("Pushed to origin");
    else warn("Push failed: " + push.err);
  } else {
    log("Already up to date with remote");
  }

  // Push to mirrors
  for (const mirror of REGISTRY.git.mirrors) {
    log(`Pushing to mirror: ${mirror}`);
    const mp = await run("git", ["push", mirror, sync.branch]);
    if (mp.ok) log(`Pushed to ${mirror}`);
    else warn(`Mirror push failed (${mirror}): ${mp.err}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LOGGING
// ─────────────────────────────────────────────────────────────────────────────
const c = {
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
  green:  "\x1b[32m",
  yellow: "\x1b[33m",
  cyan:   "\x1b[36m",
  red:    "\x1b[31m",
};
function log(msg)  { console.log(`${c.green}▶${c.reset} ${msg}`); }
function warn(msg) { console.warn(`${c.yellow}⚠${c.reset} ${msg}`); }
function head(msg) { console.log(`\n${c.bold}${c.cyan}${msg}${c.reset}`); }

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
if (import.meta.main) {
  const args = Deno.args;

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
${c.bold}${REGISTRY.identity.display} — run.js${c.reset}
${REGISTRY.identity.license} | ${REGISTRY.identity.repo}

Usage: deno run --allow-all run.js [OPTIONS]

Options:
  --help, -h       Show this help
  --no-git         Skip git sync check and post-launch git cycle
  --no-launch      Git cycle only (no game launch)
  --reflect        Print self-reflection data and exit

This script is homoiconic: it reads its own source via reflect() and exposes
its full capability registry at startup. It auto-detects platform, self-heals
missing WASM artifacts, probes for a free port, launches via the best available
method (Ephapax native → Deno file server → wasmtime headless), then runs a
full git cycle (add, commit, push to origin and mirrors).
`);
    Deno.exit(0);
  }

  const skipGit    = args.includes("--no-git");
  const launchOnly = !args.includes("--no-launch");

  head(`${REGISTRY.identity.display} v${REGISTRY.identity.version}`);

  // 1. Reflect
  if (args.includes("--reflect")) {
    const r = await reflect();
    console.log(JSON.stringify({ registry: REGISTRY, reflection: r }, null, 2));
    Deno.exit(0);
  }

  const r = await reflect();
  log(`Reflected: ${r.lines} lines, ${r.capabilities.length} capabilities`);

  // 2. Platform detection
  head("Platform detection");
  const platform = await detectPlatform();
  log(`OS: ${platform.os} / ${platform.arch} / display: ${platform.displayServer}`);
  log(`Native Gossamer: ${platform.nativeAvailable ? "available" : "not found"}`);
  log(`Deno: ${platform.denoAvailable ? "available" : "not found"}`);
  log(`Browser: ${platform.browserCmd ?? "none"}`);
  log(`wasmtime: ${platform.wasmtime ? "available" : "not found"}`);

  // 3. Git sync check
  let sync = { dirty: false, ahead: 0, behind: 0, branch: "main", fetchError: false };
  if (!skipGit) {
    head("Git sync");
    sync = await checkGitSync();
    log(`Branch: ${sync.branch} | ahead: ${sync.ahead} | behind: ${sync.behind}`);
    if (sync.dirty)      warn("Working tree has uncommitted changes");
    if (sync.behind > 0) warn(`${sync.behind} commit(s) behind remote — consider git pull`);
    if (sync.fetchError) warn("Could not reach remote — running offline");
    if (REGISTRY.git.mirrors.length > 0)
      log(`Mirrors: ${REGISTRY.git.mirrors.join(", ")}`);
  }

  // 4. Self-heal
  head("Self-heal");
  const healed = await selfHeal();
  if (healed.length > 0) healed.forEach(h => log(`Healed: ${h}`));
  else log("No healing required");

  // 5. Versions
  head("Versions");
  const versions = await detectVersions();
  versions.forEach(v => log(`${v.type}: ${v.label}`));

  // 6. Launch
  if (launchOnly) {
    head("Launching game");
    let launched = false;
    launched = launched || await launchNative(platform);
    launched = launched || await launchDeno(platform);
    launched = launched || await launchHeadless(platform);
    if (!launched) {
      warn("Could not launch game — check platform support above");
    }
  }

  // 7. Git cycle
  if (!skipGit) {
    await gitCycle(sync);
  }

  head("Done");
}
