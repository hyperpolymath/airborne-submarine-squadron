# Development Guide

<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

## Project Structure

```
airborne-submarine-squadron/
├── index.html            # Web entry point (no redirect — loads Gossamer engine directly)
├── src/
│   └── main.affine           # Canonical AffineScript source (compiled to WASM)
├── gossamer/
│   ├── app_gossamer.js   # Gossamer v2 game engine (7300+ lines, current playable game)
│   ├── index_gossamer.html  # Desktop Gossamer page (served by gossamer/launch.sh)
│   ├── launch.sh         # Desktop launcher (Ephapax native or Deno fallback)
│   └── main.eph          # Ephapax linear-type Gossamer shell entry point
├── build/                # Local WASM build output (gitignored; canonical artifact copied from dist/)
│   └── airborne-submarine-squadron.wasm
├── dist/
│   └── airborne-submarine-squadron.wasm  # Tracked release artifact
├── tray/
│   └── src/main.rs       # Rust system tray binary (ksni KDE StatusNotifierItem)
├── ffi/zig/              # Zig FFI layer (ABI bridge)
├── docs/                 # Design docs (GAMEPLAY.md, DESIGN.md, etc.)
├── desktop/              # XDG .desktop file + install/uninstall scripts
├── launcher.sh           # Unified launcher (browser / CLI / tray / Gossamer / desktop install)
├── build.sh              # AffineScript → WASM build script
├── Justfile              # Task runner (just build, just run, just web, etc.)
└── .machine_readable/    # STATE.a2ml, META.a2ml, ECOSYSTEM.a2ml
```

## Running the Game

### Browser (recommended)
```bash
./launcher.sh            # starts Deno file server on port 6880, opens browser
./launcher.sh --browser  # explicit
```
Then open `http://127.0.0.1:6880/` — loads `index.html` which serves the Gossamer engine.

### Gossamer Desktop
```bash
./launcher.sh --gossamer  # Ephapax native (requires libgossamer.so) or Deno fallback
```

### CLI (WASM via wasmtime)
```bash
./launcher.sh --cli
```

### System Tray
```bash
./launcher.sh --tray      # requires tray binary built first: cd tray && cargo build --release
```

## Building the WASM

`build.sh` tries the following in order:
1. `affinescript` binary on `$PATH`
2. `$AFFINESCRIPT_REPO/_build/default/bin/main.exe` (local checkout)
3. Sibling `nextgen-languages/affinescript/` (auto-detected)
4. Falls back to copying `dist/airborne-submarine-squadron.wasm` → `build/`

```bash
./build.sh
# or
just build
```

The AffineScript compiler is at `nextgen-languages/affinescript/` in the hyperpolymath repo tree.
To build the compiler itself:
```bash
cd ../nextgen-languages/affinescript
dune build
```

## Task Runner

```bash
just check        # type-check src/main.affine
just build        # compile to WASM
just run          # run WASM via wasmtime
just web          # serve on port 6880
just launch       # unified launcher
just gossamer     # Gossamer desktop variant
just check-tray   # cargo check on tray binary
just build-tray   # build tray binary
```

## Architecture

### Two-layer engine

| Layer | File | Role |
|-------|------|------|
| JS game engine | `gossamer/app_gossamer.js` | Renders full game, handles all input, runs at 60fps |
| WASM co-processor | `dist/airborne-submarine-squadron.wasm` | Runs `step_state()` each tick as verified frame counter and secondary score tracker |

The WASM co-processor is loaded asynchronously in `init()`. If it fails to load (e.g. WebKit WASM limitation), the JS engine continues unaffected. When the AffineScript compiler WebKit issue is resolved, the co-processor will be promoted to primary physics engine.

### WASM exports

`src/main.affine` must export:
- `init_state() -> i32` — returns pointer to 29-field state snapshot
- `step_state(s0..s28: i32, thrust_x: i32, thrust_y: i32, fire: i32, fire_alt: i32, toggle_env: i32) -> i32`
- `build_snapshot(29 args) -> i32`

### Deno instead of Node/npm

All JS tooling uses Deno. There is no `package-lock.json`, no `node_modules/`, no `npm`. The Deno file server in `launcher.sh` is inlined as a heredoc — no install step required.

## Tray Binary

`tray/src/main.rs` uses `ksni` (KDE StatusNotifierItem) for native Wayland tray support.

```bash
cd tray && cargo build --release
./tray/target/release/airborne-tray  # or use ./launcher.sh --tray
```

One `unsafe` block exists: `libc::kill(pid, 0)` to check process liveness via signal 0 — this is the standard POSIX idiom and is intentional.

## Desktop Integration

```bash
./launcher.sh --install    # installs XDG .desktop entry + icon
./launcher.sh --uninstall  # removes it
```

## Ports

| Port | Purpose |
|------|---------|
| 6880 | Main browser game server (686 = Type 688 attack sub) |
| 6881–6879 | Gossamer fallback server range |

## Forward Development Backlog (Perfective)

This section is the current maintainers' list for "develop this repo further"
work. Source of truth is `docs/MAINTENANCE-ACTIONS-2026-04-17.adoc`.

- [x] Promote ABI constants from comments into runtime constants shared by JS HUD/WASM bridge (`gossamer/wasm_abi.js`).
- [x] Add startup diagnostics that print ABI version/hash and fail-fast on mismatch (wired in `gossamer/app_gossamer.js`).
- Split remaining monolith sections in `app_gossamer.js` into stable, test-covered modules.
- Add replay fixtures for deterministic tick-by-tick validation of JS vs WASM co-processor drift.
- Add stricter source-to-artifact provenance check (embed compiler+contract metadata in artifact manifest).
- Extend CI to run cross-repo dogfood checks when sibling repos are present.
- [x] Add event taxonomy docs for gameplay notifications, multiplayer control events, and ops alerts (`docs/EVENT-TAXONOMY.md`).
