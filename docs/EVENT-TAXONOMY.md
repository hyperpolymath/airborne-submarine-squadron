<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# Event Taxonomy

This taxonomy defines event ownership and routing for Airborne Submarine Squadron.

## Ownership

Authoritative gameplay state lives in the game loop + Gossamer event bus.
Burble/Groove mirrors are non-authoritative observers.

## Gameplay Events

Use these for player-facing simulation outcomes.

- `gameplay.notice.mid` — prominent center-screen banners (`midNotice`)
- `gameplay.notice.ticker` — lower-priority ticker updates (`ticker`)
- `gameplay.alert.hud` — HUD-highlight warnings (`hudFlash`)
- `gameplay.mission.state` — mission transitions (`start`, `complete`, `failed`)
- `gameplay.combat.hit` — damage/death events for submarine/enemies
- `gameplay.environment.transition` — air/water/orbit mode changes

## Multiplayer Control Events

Use these for session coordination and transport metadata.

- `multiplayer.room.created`
- `multiplayer.room.joined`
- `multiplayer.signal.offer`
- `multiplayer.signal.answer`
- `multiplayer.signal.ice`
- `multiplayer.peer.ready`
- `multiplayer.peer.disconnected`

## Ops Events

Use these for runtime diagnostics and operational monitoring.

- `ops.startup.ready`
- `ops.wasm.abi.ok`
- `ops.wasm.abi.mismatch`
- `ops.server.port.bound`
- `ops.server.shutdown`
- `ops.error.unhandled`

## Mirroring Rules

When mirroring selected gameplay events to Groove/API/FFI:

- Include monotonic event ID
- Include UTC timestamp
- Include local tick value
- Preserve canonical local ordering
- Never treat mirrored events as source-of-truth state
