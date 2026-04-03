; SPDX-License-Identifier: AGPL-3.0-or-later
; Copyright (c) 2026 Jonathan D.A. Jewell (hyperpolymath) <j.d.a.jewell@open.ac.uk>
;
; STATE.scm -- Airborne Submarine Squadron project state
; Updated: 2026-04-04

(state
  (metadata
    (version "0.5.0")
    (name "airborne-submarine-squadron")
    (type "game")
    (last-updated "2026-04-04"))

  (project-context
    (description "Sopwith-inspired flying submarine arcade game with space, underwater, and land combat")
    (monorepo "games & trivia")
    (language "AffineScript")
    (target "WASM + browser + Gossamer desktop")
    (port 6860)
    (crg-grade "D")
    (crg-file "READINESS.md"))

  (current-position
    (phase "alpha")
    (completion-percentage 77)
    (milestone "Full gameplay loop: atmosphere, water, space. Ships, subs, thermal layers, hangars.
                Crash logging, port management, and CRG assessment added 2026-04-04."))

  (components
    (game-engine
      (status "working")
      (details "Gossamer variant: free flight, orbital mechanics, periscope, depth charges,
                torpedoes (including LGT), missiles, chaff, mines with chain-cutting,
                thermal layers with visibility rules, caterpillar drive, supply drops"))
    (ships
      (status "working")
      (details "Destroyer (patrol, SAM, AA, torpedoes), Passenger (island-hopping, survivors),
                Interceptor boats (camo, MG, bazooka), Space tourist"))
    (submarines
      (status "working")
      (details "Akula-Molot hammerhead (SAM, torpedo, cloak, sonar chain, all-layer detection),
                Delfin dolphin (fire-forget torpedo, surface MG, crew bail-out)"))
    (hangar-system
      (status "working")
      (details "Health tiers (green/yellow/red/purple), point defense, explosion"))
    (thermal-layers
      (status "working")
      (details "Three asymmetric layers, visibility rules, temperature gauge, hull depth restriction"))
    (space
      (status "working")
      (details "Solar system with Pluto, boundary, autopilot (0-9 keys), tourist ship, no afterburners"))
    (desktop-integration
      (status "working")
      (details "XDG shortcut, system tray (ksni 0.3), install/uninstall"))
    (save-system
      (status "working")
      (details "Save/load to localStorage, key rebinding, HALO/deep-diver-kit upgrades"))
    (crash-logging
      (status "working")
      (details "window.onerror + onunhandledrejection capture errors with world snapshot.
                Stored in localStorage (ass_crash_logs, max 20 entries).
                POST /crash-report sends to Deno dev server → logs/<timestamp>.json on disk.
                Console helpers: ASS_dumpCrashLog(), ASS_downloadCrashLog(), ASS_clearCrashLog().
                Implemented 2026-04-04 in gossamer/app_gossamer.js."))
    (dev-server
      (status "working")
      (details "run.js Deno file server on port 6860 (fallback 6870-6874).
                freePort() kills stale processes via fuser (Linux) / lsof+kill (macOS) before probe.
                SIGINT/SIGTERM handlers kill child server on exit.
                POST /crash-report endpoint writes JSON to logs/ directory.
                Fixed 2026-04-04 — was leaving orphan processes locking the port.")))

  (route-to-mvp
    (milestone-1
      (name "v2: Trionic SubCommando")
      (status "planned")
      (tasks "Island platformer mode, diver mission tunnels"))
    (milestone-2
      (name "v3: Subterranean Labyrinth")
      (status "planned")
      (tasks "Underground cave system, modified sub controls"))
    (milestone-3
      (name "Space expansion")
      (status "planned")
      (tasks "Radar/astrocompass, compressed scale, more vessels, dimensional travel")))

  (blockers-and-issues
    (blocker-1
      (description "hypatia-scan.yml workflow missing — required for RSR compliance and CRG grade D lock")
      (severity "medium")
      (workaround "Other CI workflows present; hypatia scan not yet blocking"))
    (blocker-2
      (description "No formal test runner — test_types.as and test_verisimdb_simple.js exist but
                    are not wired to justfile. CRG v2.0 requires all declared tests to pass for grade D.")
      (severity "medium")
      (workaround "Manual testing only; justfile wiring is the next action"))
    (blocker-3
      (description "Gossamer desktop runtime requires WebKitGTK")
      (severity "low")
      (workaround "Browser fallback works everywhere")))

  (critical-next-actions
    (action-1 "Add hypatia-scan.yml workflow from RSR template (required for RSR compliance)")
    (action-2 "Wire test_types.as and test_verisimdb_simple.js to justfile 'test' recipe")
    (action-3 "Verify all declared tests pass — this locks CRG grade D per READINESS.md")
    (action-4 "Compress solar system scale and add radar/astrocompass")
    (action-5 "Add mission system with hostage rescue scenarios")))
