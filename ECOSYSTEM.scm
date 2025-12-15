;; SPDX-License-Identifier: AGPL-3.0-or-later
;; SPDX-FileCopyrightText: 2025 Jonathan D.A. Jewell
;; ECOSYSTEM.scm — airborne-submarine-squadron

(ecosystem
  (version "1.0.0")
  (name "airborne-submarine-squadron")
  (type "project")
  (purpose "A 2D flying submarine game written in Ada 2022, inspired by Sopwith. Control a submarine that seamlessly transitions between aerial and underwater combat.")

  (position-in-ecosystem
    "Part of hyperpolymath ecosystem. Follows RSR guidelines.")

  (related-projects
    (project (name "rhodium-standard-repositories")
             (url "https://github.com/hyperpolymath/rhodium-standard-repositories")
             (relationship "standard")))

  (what-this-is "A 2D flying submarine game written in Ada 2022, inspired by Sopwith. Control a submarine that seamlessly transitions between aerial and underwater combat.")
  (what-this-is-not "- NOT exempt from RSR compliance"))
