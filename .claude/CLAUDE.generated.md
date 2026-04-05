<!-- K9 Coordination Protocol — Generated for Claude Code -->
<!-- Source: coordination.k9 | Generated: 2026-04-03 -->
<!-- Re-generate: deno run --allow-read --allow-write generate.js coordination.k9 -->

# Airborne Submarine Squadron — AI Coordination Rules

> **Auto-generated from `coordination.k9`** — do not edit directly.
> Re-generate with: `deno run --allow-read --allow-write generate.js coordination.k9`
> Source of truth: `coordination.k9` in repository root.

## Project

Sopwith-inspired arcade game where a zeppelin launches attack submarines that fly, dive, and torpedo. Browser-based with system tray integration.

**Languages:** JavaScript, AffineScript, Rust, HTML, CSS
**License:** AGPL-3.0-or-later
**Build system:** just
**Runtime:** deno

## Build Commands

| Command | Description |
|---------|-------------|
| `just build` | Build AffineScript to WASM |
| `just serve` | Start Deno file server on port 6880 |
| `just install` | Install desktop integration (XDG .desktop file) |
| `just tray` | Build and run Rust system tray binary |

## INVARIANTS — Do Not Violate

These rules are non-negotiable. Violating them will break the project
or contradict deliberate architectural decisions.

### [CRITICAL] no-typescript

**Rule:** Do not introduce TypeScript files anywhere

**Why:** Vanilla JavaScript and AffineScript are the chosen languages — TypeScript is banned across all hyperpolymath repos

### [CRITICAL] no-tauri-electron

**Rule:** Do not introduce Tauri, Electron, or any desktop framework

**Why:** Architecture is deliberately browser + system tray binary (Gossamer frontend + Rust ksni tray). This is intentional, not a gap to fill.

### [CRITICAL] deno-only-runtime

**Rule:** Deno is the only permitted JS runtime — no Node.js, npm, Bun, pnpm, or yarn

**Why:** Deno is the standard runtime across all hyperpolymath repos. The file server uses Deno.

### [CRITICAL] no-npm-package-managers

**Rule:** Do not create package.json, package-lock.json, node_modules, bun.lockb, or yarn.lock

**Why:** All dependencies managed through Deno — no npm ecosystem

### [MODERATE] port-6880

**Rule:** Default development port is 6880

**Why:** 686 references the Type 686 attack submarine — this is a deliberate thematic choice, not arbitrary

### [CRITICAL] affinescript-engine

**Rule:** The game engine will be AffineScript compiled to WASM — do not replace with a JS game engine

**Why:** AffineScript is a hyperpolymath language (from nextgen-languages). The JS in web/ is a placeholder until WASM build is wired.

### [CRITICAL] standalone-repo

**Rule:** This is a standalone git repository — do not merge into a monorepo

**Why:** Co-developed with son, AGPL-licensed (exception to PMPL), independent history

### [CRITICAL] agpl-license

**Rule:** This project is AGPL-3.0-or-later — do not change the license

**Why:** Co-developed with son, AGPL chosen deliberately. This is an exception to the normal PMPL-1.0-or-later policy.

## Protected Files and Directories

Do NOT delete, reorganise, or replace these without explicit user approval:

| Path | Reason |
|------|--------|
| `gossamer/` | Gossamer frontend — HTML5 Canvas game rendering and UI |
| `tray/` | Rust system tray binary using ksni (KDE StatusNotifierItem) |
| `src/` | AffineScript source — main.as is the game engine source |
| `web/` | Browser-side JS — placeholder engine, will be replaced by WASM but structure stays |
| `build/` | WASM build artifacts from AffineScript compilation |
| `launcher.sh` | Unified launcher script — entry point for the whole application |
| `.machine_readable/` | Canonical location for all A2ML state files — never move to root |
| `coordination.k9` | This file — source of truth for AI coordination |

## Architecture Decisions (Deliberate)

These choices may look unusual but are intentional:

### browser-plus-tray

**Decision:** Game runs in browser window, with a separate Rust system tray binary for desktop integration

**Why:** Lightweight, no heavy framework dependency, works on Wayland/KDE natively via ksni

**Rejected alternatives:** Tauri, Electron, native GTK application

### affinescript-to-wasm

**Decision:** Game logic written in AffineScript, compiled to WASM, loaded by browser

**Why:** AffineScript is a hyperpolymath language with linear types — proves resource safety in game logic

**Rejected alternatives:** Pure JavaScript game engine, Rust compiled to WASM, Unity/Godot

### gossamer-frontend

**Decision:** Gossamer provides the desktop window (WebKitGTK-based)

**Why:** Gossamer is the hyperpolymath desktop runtime — shared with PanLL and other projects

### deno-file-server

**Decision:** Deno serves static files during development

**Why:** Simple, no dependencies, matches ecosystem standard. Python http.server was deprecated.

**Rejected alternatives:** Python http.server, Node.js, nginx

## Do NOT Create

These files, patterns, or systems must NOT be introduced:

- ****/*.ts** — TypeScript is banned — use vanilla JS or AffineScript
- **Dockerfile** — Use Containerfile (Podman, not Docker)
- **package.json** — npm is banned — use deno.json
- **package-lock.json** — npm lock files banned
- **node_modules/**** — npm ecosystem banned
- **Any heavyweight game framework (Phaser, PixiJS, Three.js)** — Game engine is AffineScript→WASM — JS frameworks are not needed
- **Alternative launcher or desktop entry system** — launcher.sh + .desktop file is the intended approach
- **Electron or Tauri wrapper** — Gossamer + Rust tray is the architecture

## Terminology

Use the correct terms for this project:

- Say **"attack submarine"**, NOT "submarine", "plane", "aircraft"
  - The flying vehicles are attack submarines launched from a zeppelin — this is the core game concept

## Port Assignments

| Service | Port |
|---------|------|
| dev-server | 6880 |

## Ecosystem Context

**Depends on:**
- **gossamer** — Desktop window runtime (WebKitGTK + Zig)
- **nextgen-languages** — Contains AffineScript compiler (affinescript subdir)

**Related projects:**
- **idaptik** — Sister game project — also uses Gossamer, also co-developed with son
- **proven** — Formal verification — AffineScript type proofs
