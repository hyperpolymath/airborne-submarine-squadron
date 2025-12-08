;;; =================================================================
;;; STATE.scm - Airborne Submarine Squadron
;;; =================================================================
;;; Checkpoint/restore for AI conversation context
;;; Format: Guile Scheme (human-readable S-expressions)
;;; =================================================================

;;;--------------------------------------------------------------------
;;; 1. METADATA
;;;--------------------------------------------------------------------
(define-module (state airborne-submarine-squadron)
  #:version "1.0.0")

(define metadata
  '((format-version . "1.0.0")
    (created . "2025-12-08")
    (last-updated . "2025-12-08")
    (project-name . "airborne-submarine-squadron")
    (project-version . "0.1.0")
    (language . "Ada 2022")
    (verification . "SPARK")
    (license . "MIT + Palimpsest v0.8")))

;;;--------------------------------------------------------------------
;;; 2. USER CONTEXT
;;;--------------------------------------------------------------------
(define user-context
  '((name . "hyperpolymath")
    (roles . (developer maintainer architect))
    (preferences
     (language . "en")
     (code-style . "Ada GNAT Style")
     (documentation . "markdown")
     (tools . (just nix gnat gprbuild spark)))
    (values
     (type-safety . critical)
     (memory-safety . critical)
     (offline-first . required)
     (rsr-compliance . required))))

;;;--------------------------------------------------------------------
;;; 3. SESSION CONTEXT
;;;--------------------------------------------------------------------
(define session-context
  '((session-id . "claude/create-state-scm-01FVc1vm1Atq1VLzDmRBp7ex")
    (conversation-start . "2025-12-08")
    (messages . 1)
    (tokens-remaining . "sufficient")
    (branch . "claude/create-state-scm-01FVc1vm1Atq1VLzDmRBp7ex")))

;;;--------------------------------------------------------------------
;;; 4. CURRENT FOCUS
;;;--------------------------------------------------------------------
(define current-focus
  '((project . "airborne-submarine-squadron")
    (phase . "alpha-development")
    (goal . "MVP v1: Playable demo with graphics and input")
    (deadline . none)
    (blocking-dependencies
     (graphics-backend . "SDL2 Ada bindings needed")
     (input-handling . "Terminal input or SDL2 events"))))

;;;--------------------------------------------------------------------
;;; 5. CURRENT POSITION
;;;--------------------------------------------------------------------
(define current-position
  '((summary . "Core game systems implemented, text-only rendering, no real input")
    (completion-percent . 35)

    (implemented
     ((package . "main.adb")
      (status . complete)
      (description . "Entry point, splash screen, exception handling"))

     ((package . "game.ads/adb")
      (status . complete)
      (description . "Game loop, state management, environment transitions"))

     ((package . "submarine.ads/adb")
      (status . complete)
      (description . "Player entity, position, velocity, health, buoyancy"))

     ((package . "environment.ads/adb")
      (status . complete)
      (description . "Air/Water environments, physics multipliers"))

     ((package . "physics.ads/adb")
      (status . complete)
      (description . "Gravity, drag, distance calculations"))

     ((package . "renderer.ads/adb")
      (status . partial)
      (description . "Text-only HUD rendering, needs graphics backend"))

     ((package . "weapons.ads/adb")
      (status . complete)
      (description . "4 weapon types, projectile management, cooldowns"))

     ((package . "enemies.ads/adb")
      (status . complete)
      (description . "5 enemy types, AI states, spawning system"))

     ((package . "powerups.ads/adb")
      (status . complete)
      (description . "5 powerup types, collection system"))

     ((package . "collision.ads/adb")
      (status . complete)
      (description . "AABB collision detection"))

     ((package . "missions.ads/adb")
      (status . complete)
      (description . "5 mission types, objectives, progress tracking"))

     ((package . "sound.ads/adb")
      (status . stub)
      (description . "Stub implementation, needs audio backend")))

    (not-implemented
     (graphics-rendering . "SDL2 or similar graphics backend")
     (keyboard-input . "Real-time input handling")
     (scrolling-world . "Camera following submarine")
     (audio-playback . "OpenAL or SDL2_mixer")
     (system-integration . "Connect all systems in game loop")
     (asset-loading . "Sprites, sounds, level data")
     (menu-system . "Title screen, pause menu, game over")
     (save-load . "Game state persistence"))))

;;;--------------------------------------------------------------------
;;; 6. ROUTE TO MVP V1
;;;--------------------------------------------------------------------
(define mvp-v1-roadmap
  '((version . "1.0.0-alpha")
    (target . "Playable demo with graphics, input, and core gameplay")

    (milestones
     ((milestone . "M1: Graphics Foundation")
      (status . not-started)
      (completion . 0)
      (tasks
       ("Add SDL2Ada or AdaSDL bindings to project")
       ("Create window and rendering context")
       ("Implement sprite loading and drawing")
       ("Replace text renderer with graphics renderer")
       ("Draw submarine with environment-appropriate sprites")))

     ((milestone . "M2: Input System")
      (status . not-started)
      (completion . 0)
      (tasks
       ("Handle keyboard events from SDL2")
       ("Map controls to submarine actions")
       ("Implement weapon switching and firing")
       ("Add pause functionality")))

     ((milestone . "M3: System Integration")
      (status . not-started)
      (completion . 0)
      (tasks
       ("Spawn enemies in game loop")
       ("Fire weapons and track projectiles")
       ("Detect collisions between entities")
       ("Spawn and collect powerups")
       ("Apply mission objectives")))

     ((milestone . "M4: Audio")
      (status . not-started)
      (completion . 0)
      (tasks
       ("Integrate SDL2_mixer or OpenAL")
       ("Implement music crossfade (air/water themes)")
       ("Add sound effects for weapons, collisions")
       ("Volume controls")))

     ((milestone . "M5: Polish")
      (status . not-started)
      (completion . 0)
      (tasks
       ("Title screen and menus")
       ("HUD overlay with graphics")
       ("Particle effects for explosions")
       ("Screen shake and visual feedback")
       ("Scrolling camera"))))))

;;;--------------------------------------------------------------------
;;; 7. ISSUES / BLOCKERS
;;;--------------------------------------------------------------------
(define issues
  '((critical . ())  ; No critical blockers

    (high
     ((issue . "No graphics backend")
      (impact . "Game is text-only, not visually playable")
      (resolution . "Integrate SDL2Ada bindings")
      (effort . "medium")))

    (medium
     ((issue . "Sound system is stub-only")
      (impact . "No audio feedback")
      (resolution . "Integrate SDL2_mixer or OpenAL")
      (effort . "medium"))

     ((issue . "Systems not integrated in game loop")
      (impact . "Enemies, weapons, powerups exist but unused")
      (resolution . "Wire all systems into Game.Run procedure")
      (effort . "low"))

     ((issue . "No real input handling")
      (impact . "Player cannot control submarine")
      (resolution . "Add SDL2 or terminal input")
      (effort . "medium")))

    (low
     ((issue . "Game loop runs for fixed 300 frames")
      (impact . "Demo exits automatically")
      (resolution . "Run until player quits or game over")
      (effort . "trivial"))

     ((issue . "No save/load functionality")
      (impact . "Progress not persisted")
      (resolution . "Serialize game state to file")
      (effort . "medium")))))

;;;--------------------------------------------------------------------
;;; 8. QUESTIONS FOR USER
;;;--------------------------------------------------------------------
(define questions
  '(((id . 1)
     (question . "Which graphics backend do you prefer?")
     (options . ("SDL2Ada (most common)"
                 "AdaSDL2 (alternative)"
                 "Raylib-Ada (simpler)"
                 "Terminal graphics (ASCII art)")))

    ((id . 2)
     (question . "Should the game target a specific resolution/aspect ratio?")
     (context . "Currently 800x600 defined in game.ads"))

    ((id . 3)
     (question . "What platforms are priority for MVP?")
     (options . ("Linux only"
                 "Linux + macOS"
                 "Linux + macOS + Windows"
                 "All platforms via Nix")))

    ((id . 4)
     (question . "Should multiplayer be considered in architecture now?")
     (context . "Current architecture is single-player only"))

    ((id . 5)
     (question . "Asset creation approach?")
     (options . ("Placeholder/programmer art for MVP"
                 "Commission pixel art"
                 "AI-generated sprites"
                 "Open-source game assets")))))

;;;--------------------------------------------------------------------
;;; 9. LONG-TERM ROADMAP
;;;--------------------------------------------------------------------
(define long-term-roadmap
  '((v1.0.0
     (name . "First Playable")
     (description . "Complete single-player game with core loop")
     (features
      "Graphics rendering (sprites, backgrounds)"
      "Full keyboard/gamepad input"
      "All enemy types active with AI"
      "All weapon types functional"
      "All powerup types collectible"
      "3 mission types playable"
      "Sound effects and music"
      "Title screen, pause, game over"
      "Score tracking"))

    (v1.1.0
     (name . "Content Update")
     (description . "More missions and gameplay variety")
     (features
      "10+ mission campaigns"
      "Boss enemies"
      "New weapon types"
      "Difficulty settings"
      "Achievements system"))

    (v1.2.0
     (name . "Polish Update")
     (description . "Visual and audio improvements")
     (features
      "Particle effects"
      "Screen shake and feedback"
      "Dynamic music system"
      "Detailed sprites and animations"
      "Parallax scrolling backgrounds"))

    (v2.0.0
     (name . "Persistence Update")
     (description . "Save/load and progression")
     (features
      "Save/load game state"
      "Player profile and statistics"
      "Unlockable submarines"
      "Unlockable weapons"
      "Level editor"))

    (v3.0.0
     (name . "Multiplayer Update")
     (description . "Local and network multiplayer")
     (features
      "Local co-op (2 players)"
      "Versus mode"
      "LAN multiplayer"
      "Online leaderboards"))))

;;;--------------------------------------------------------------------
;;; 10. HISTORY / COMPLETION SNAPSHOTS
;;;--------------------------------------------------------------------
(define history
  '(((date . "2025-01-22")
     (version . "0.1.0")
     (completion . 15)
     (notes . "Initial RSR-compliant repository structure"))

    ((date . "2025-01-22")
     (version . "0.1.0")
     (completion . 35)
     (notes . "Added weapons, enemies, powerups, collision, missions, sound systems"))

    ((date . "2025-12-08")
     (version . "0.1.0")
     (completion . 35)
     (notes . "Created STATE.scm, documented route to MVP"))))

;;;--------------------------------------------------------------------
;;; 11. CRITICAL NEXT ACTIONS
;;;--------------------------------------------------------------------
(define next-actions
  '(((priority . 1)
     (action . "Choose and integrate graphics backend (SDL2Ada recommended)")
     (rationale . "Unlocks visual gameplay, highest impact")
     (deadline . none))

    ((priority . 2)
     (action . "Create basic window with submarine sprite rendering")
     (rationale . "Proof of concept for graphics pipeline")
     (deadline . none))

    ((priority . 3)
     (action . "Add keyboard input handling")
     (rationale . "Enable player control")
     (deadline . none))

    ((priority . 4)
     (action . "Integrate enemies and weapons into game loop")
     (rationale . "Core gameplay with existing code")
     (deadline . none))

    ((priority . 5)
     (action . "Implement collision callbacks")
     (rationale . "Damage, powerup collection, game over")
     (deadline . none))))

;;;--------------------------------------------------------------------
;;; 12. TECHNICAL DEBT
;;;--------------------------------------------------------------------
(define technical-debt
  '(((item . "Hardcoded 300-frame limit in game loop")
     (location . "src/game.adb:45")
     (severity . low)
     (fix . "Replace with proper game loop termination"))

    ((item . "Sound package is stub implementation")
     (location . "src/sound.adb")
     (severity . medium)
     (fix . "Integrate real audio backend"))

    ((item . "Renderer uses Text_IO only")
     (location . "src/renderer.adb")
     (severity . high)
     (fix . "Add graphics rendering backend"))))

;;;--------------------------------------------------------------------
;;; END OF STATE
;;;--------------------------------------------------------------------
;;; To resume: Load this file at session start
;;; Claude will reconstruct context from these definitions
;;; Update this file at session end with new progress
;;;--------------------------------------------------------------------
