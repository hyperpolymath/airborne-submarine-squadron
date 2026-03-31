; SPDX-License-Identifier: PMPL-1.0-or-later
; Copyright (c) 2026 Jonathan D.A. Jewell (hyperpolymath) <j.d.a.jewell@open.ac.uk>
;
; META.scm -- Airborne Submarine Squadron architecture decisions and meta-information
; Updated: 2026-03-21

(meta
  (metadata
    (version "1.0.0")
    (name "airborne-submarine-squadron")
    (media-type "application/meta+scheme")
    (last-updated "2026-03-21"))

  (architecture-decisions
    (adr-001
      (title "No Tauri -- pure WASM + browser")
      (status "accepted")
      (date "2026-01-25")
      (rationale "The game targets the browser as primary platform.
                  A system tray binary provides desktop integration without
                  the weight of a full Tauri/Electron wrapper. The game runs
                  in any browser via a local Deno file server."))

    (adr-002
      (title "No TypeScript -- vanilla JS + AffineScript")
      (status "accepted")
      (date "2026-01-25")
      (rationale "TypeScript is a banned language per hyperpolymath standards.
                  The game engine is written in AffineScript (compiling to WASM).
                  The browser frontend uses vanilla JavaScript for the canvas
                  renderer and input handling. No build toolchain needed for JS."))

    (adr-003
      (title "Deno file server -- not Python, not Node")
      (status "accepted")
      (date "2026-03-21")
      (rationale "Node and npm are banned. Python is banned. Deno provides a
                  lightweight file server with no dependencies. The server is
                  embedded inline in launcher.sh as a heredoc script. Python
                  http.server remains as a deprecated fallback."))

    (adr-004
      (title "ksni for system tray -- KDE StatusNotifierItem")
      (status "accepted")
      (date "2026-03-21")
      (rationale "ksni is a Rust crate implementing the KDE StatusNotifierItem
                  protocol, which is the standard for system tray icons on
                  Wayland (KDE Plasma). This avoids X11 dependencies and
                  works natively with the developer's Fedora + KDE setup."))

    (adr-005
      (title "Port 6860 -- 686 attack sub reference")
      (status "accepted")
      (date "2026-03-21")
      (rationale "The default port 6860 is a thematic nod to the Type 686
                  attack submarine. The launcher tries ports 6860-6869 before
                  falling back to 8000 if all are occupied."))

    (adr-006
      (title "AffineScript as game engine language")
      (status "accepted")
      (date "2026-01-25")
      (rationale "AffineScript is a hyperpolymath language from the
                  nextgen-languages ecosystem. It compiles to WASM and provides
                  affine type safety for game state management. The game serves
                  as a real-world test case for the AffineScript compiler.")))

  (development-practices
    (no-npm "npm, Bun, pnpm, yarn are all banned")
    (no-node "Node.js is banned; use Deno")
    (no-typescript "TypeScript is banned; use ReScript or vanilla JS")
    (no-tauri "No Tauri/Electron wrappers; browser + tray binary")
    (deno-first "Deno is the preferred JavaScript runtime")
    (vanilla-js "Browser code uses vanilla JavaScript, no frameworks")
    (xdg-desktop "Desktop integration follows XDG standards"))

  (design-rationale
    (sopwith-inspiration "The game is inspired by the classic DOS game Sopwith (1984).
                          Side-scrolling terrain, gravity-based flight, bombs and
                          torpedoes, and a retro arcade aesthetic.")
    (wasm-first "The long-term goal is a pure WASM game engine compiled from
                 AffineScript. The JS placeholder exists to validate gameplay
                 mechanics before the compiler is mature enough.")
    (desktop-integration "System tray + desktop shortcut makes the game feel like
                          a native application while remaining a browser game.")))
