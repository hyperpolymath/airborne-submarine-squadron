;; SPDX-License-Identifier: AGPL-3.0-or-later
;; Guix development environment for airborne-submarine-squadron.
;; Usage: guix shell -D -f build/guix.scm
;;
;; Guix is the estate's PRIMARY packager (Nix retired 2026-05-18). Bun, the estate JS runtime, is not in Guix
;; main: take it from mise (`mise install`) or https://bun.sh, or use the sealed-container escape hatch
;; (Containerfile) for the not-in-Guix tail. The game itself has ZERO runtime dependencies beyond a browser
;; or a Bun server, so this package only has to describe the source.

(use-modules (guix packages)
             (guix build-system gnu)
             (guix licenses)
             (gnu packages base)
             (gnu packages bash))

(package
  (name "airborne-submarine-squadron")
  (version "0.5.0")
  (source #f)
  (build-system gnu-build-system)
  (inputs (list coreutils bash))
  (synopsis "Airborne Submarine Squadron — Sopwith-style flying-submarine arcade game")
  (description "A deterministic fixed-timestep arcade game in which the attack submarine also flies and reaches orbit. Plain JS engine, AffineScript/typed-WASM core in progress, Bun game server.")
  (home-page "https://github.com/hyperpolymath/airborne-submarine-squadron")
  (license agpl3+))
