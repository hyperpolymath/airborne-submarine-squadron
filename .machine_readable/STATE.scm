; SPDX-License-Identifier: AGPL-3.0-or-later
; Copyright (c) 2026 Jonathan D.A. Jewell (hyperpolymath) <j.d.a.jewell@open.ac.uk>
;
; STATE.scm -- Airborne Submarine Squadron project state
; Updated: 2026-04-03

(state
  (metadata
    (version "0.5.0")
    (name "airborne-submarine-squadron")
    (type "game")
    (last-updated "2026-04-03"))

  (project-context
    (description "Sopwith-inspired flying submarine arcade game with space, underwater, and land combat")
    (monorepo "games & trivia")
    (language "AffineScript")
    (target "WASM + browser + Gossamer desktop")
    (port 6860))

  (current-position
    (phase "alpha")
    (completion-percentage 75)
    (milestone "Full gameplay loop: atmosphere, water, space. Ships, subs, thermal layers, hangars."))

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
      (details "Save/load to localStorage, key rebinding, HALO/deep-diver-kit upgrades")))

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
      (description "AffineScript compiler not yet mature enough for full WASM pipeline")
      (severity "medium")
      (workaround "JS placeholder engine with prebuilt WASM artifacts"))
    (blocker-2
      (description "Gossamer desktop runtime requires WebKitGTK")
      (severity "low")
      (workaround "Browser fallback works everywhere")))

  (critical-next-actions
    (action-1 "Compress solar system scale and add radar/astrocompass")
    (action-2 "Add mission system with hostage rescue scenarios")
    (action-3 "Implement Trionic SubCommando platformer for mission islands")
    (action-4 "Add more GitHub Actions workflows for CI/CD")))
