# Airborne Submarine Squadron (AffineScript) — Design Notes

## Goals

- Text-first simulation: verify the loop via deterministic output before adding graphics.
- Deterministic updates: same inputs produce the same outputs.
- Small, explicit data structures: no hidden mutation.
- Make safety constraints explicit in types and data flow.
- 2D side-view arcade flight (Sopwith-like), not a head-on cockpit simulator.

## Core Loop

Each tick:

1. Sample deterministic input (`sample_input`).
2. Toggle environment (air/water) based on input or periodic switch.
3. Apply thrust, gravity, integration, and bounds.
4. Update weapons cooldown and fire if requested.
5. Move projectiles and enemies.
6. Resolve collisions and score kills.

The loop is pure and returns a new `World` value.

## Safety Constraints

- Velocity is clamped to a fixed range.
- Submarine position is clamped to the world bounds.
- Projectiles and enemies deactivate when leaving bounds.

## Output

`main` returns a score (integer) for WASM usage.
`debug_main` prints human-readable HUD lines for text-first inspection.

## Visual Framing

This game is explicitly 2D and side-on. The camera reads the world as a plane.
No cockpit view, no head-on flight sim framing, no pseudo-3D projection.
