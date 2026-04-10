<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (c) 2026 Jonathan D.A. Jewell (hyperpolymath) <j.d.a.jewell@open.ac.uk> -->

# TOPOLOGY.md — Airborne Submarine Squadron

## Purpose

A browser-forward arcade flight game built on Gossamer launcher. Features atmosphere flight, underwater combat with thermal layers, orbital space navigation, three ship types, and commander ejection system. Core game logic in AffineScript/WASM wrapped by Gossamer frontend; focus on gameplay loop stability and cross-platform builds.

## Module Map

```
airborne-submarine-squadron/
├── src/
│   └── main.affine                # AffineScript core (compiled to WASM)
├── wasm/
│   └── ... (WASM build artifacts)
├── build.sh                   # Build orchestration (AffineScript → WASM)
├── src/frontend/
│   └── ... (Gossamer launcher integration)
└── .github/workflows/
    └── ... (CI/CD for builds and deploys)
```

## Data Flow

```
[AffineScript] ──► [Compiler] ──► [WASM] ──► [Gossamer Launcher] ──► [Browser/Deno]
                                     ↓
                              [Game State Machine]
                                     ↓
                         [Flight/Combat/Orbit Systems]
```

## Key Invariants

- Core game logic proven in AffineScript with linear type safety
- WASM interface exposes deterministic game updates for UI binding
- Gossamer launcher handles cross-platform distribution and hot reload
