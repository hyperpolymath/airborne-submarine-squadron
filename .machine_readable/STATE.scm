; SPDX-License-Identifier: AGPL-3.0-or-later
; Copyright (c) 2026 Jonathan D.A. Jewell (hyperpolymath) <j.d.a.jewell@open.ac.uk>
;
; STATE.scm -- Airborne Submarine Squadron project state
; Updated: 2026-03-21

(state
  (metadata
    (version "0.3.0")
    (name "airborne-submarine-squadron")
    (type "game")
    (last-updated "2026-03-21"))

  (project-context
    (description "Sopwith-inspired flying submarine arcade game")
    (monorepo "games & trivia")
    (language "AffineScript")
    (target "WASM + browser")
    (port 6860))

  (current-position
    (phase "playable-prototype")
    (completion-percentage 55)
    (milestone "JS placeholder engine playable, WASM builds exist"))

  (components
    (game-engine
      (status "working")
      (details "Sopwith-style side-scrolling, gravity, thrust, terrain generation,
                enemy AI, torpedo/bomb weapons, cooldowns, collision detection,
                particle effects, procedural audio, HUD overlay")
      (implementation "JavaScript placeholder in web/app_enhanced_home.js")
      (wasm-builds "exist in build/ but not yet wired to frontend"))

    (desktop-integration
      (status "working")
      (details "XDG .desktop file, SVG icon, install/uninstall scripts")
      (installer "desktop/install.sh")
      (shortcut "desktop/airborne-submarine-squadron.desktop"))

    (system-tray
      (status "working")
      (details "Rust binary using ksni for KDE StatusNotifierItem")
      (binary "tray/target/release/airborne-tray")
      (features "launch browser, launch CLI, server status, stop server, quit"))

    (launcher
      (status "working")
      (details "Unified launcher.sh with browser, CLI, tray, install modes")
      (server "Deno inline file server")
      (fallback "Python http.server (deprecated)"))

    (affinescript-source
      (status "compiles")
      (details "Multiple source iterations in src/, main.as is canonical")
      (compiler "affinescript from nextgen-languages/affinescript")))

  (route-to-mvp
    (milestone-1
      (name "Wire WASM engine to browser frontend")
      (status "not-started")
      (details "Replace JS placeholder with compiled AffineScript WASM module"))
    (milestone-2
      (name "Sound effects")
      (status "not-started")
      (details "Replace procedural audio with proper sound assets"))
    (milestone-3
      (name "More enemy types")
      (status "not-started")
      (details "Add destroyers, mines, aircraft, depth charges"))
    (milestone-4
      (name "Mission structure")
      (status "not-started")
      (details "Objectives, waves, boss encounters, scoring tiers"))
    (milestone-5
      (name "Power-ups and obstacles")
      (status "designed")
      (details "See powerups-design.md and obstacles-design.md")))

  (blockers-and-issues
    (blocker-1
      (description "AffineScript compiler maturity")
      (severity "medium")
      (details "Compiler is in development in nextgen-languages/affinescript"))
    (blocker-2
      (description "WASM-JS bridge not wired")
      (severity "low")
      (details "WASM builds exist but JS frontend runs standalone")))

  (critical-next-actions
    (action-1 "Wire WASM game engine to replace JS placeholder")
    (action-2 "Add sound asset loading")
    (action-3 "Design and implement additional enemy types")
    (action-4 "Integrate power-ups from powerups-design.md")))
