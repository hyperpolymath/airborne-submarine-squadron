# Multiplayer — Shared Sub, Role-Based

Status: design locked, implementation in progress.
Scope: ASS core loop only (atmosphere / water / space). Land-based
SubCommando multiplayer belongs in v2.

## Concept

Up to **4 players share one submarine**, each driving a different role. Any
unclaimed role falls back to the host's keyboard or AI where applicable.

## Roles

| Role | Responsibilities | Keys |
|------|------------------|------|
| **PILOT** | Flight + navigation | Arrows, Shift (stabilise), A (afterburner), S (brake), P (periscope), Backspace (caterpillar), CapsLock (ladder) |
| **GUNNER** | All weapons + squadron | 1–5, 9, Ctrl (fire), Enter (alt-fire), Z/X (aim swivel), Q (squadron mode) |
| **ENGINEER** | Damage control + systems | T/Y/U/I (repair prioritise), C (chaff) |
| **COMMANDER** | Disembark ops (in-scope: diver, ladder pickups, gun post, eject) | E/M (disembark/embark), Tab (eject), F (interact), G (gun post) |

**Minimum**: 1 player (solo = all roles — current game).
**2P**: Pilot + Gunner.
**3P**: + Engineer.
**4P**: + Commander.

AI wingmen (Red Arrows) still spawn in MP to fill squadron slots.

## Network architecture

- **Transport**: WebRTC DataChannel.
  - Input messages: unreliable-unordered (low-latency, drop stale).
  - Role claims / chat / events: reliable-ordered.
- **Authority model**: host's browser runs the authoritative simulation;
  joiners are thin clients sending inputs and rendering received state.
- **Signalling**: tacked onto the existing Deno server in `run.js`.
  - `POST /room/:code` — push SDP offer / answer / ICE blobs under a
    6-character alphanumeric room code.
  - `GET /room/:code` — poll for pending blobs.
  - Rooms TTL: 10 minutes from last activity.
- **STUN**: Google public STUN (`stun:stun.l.google.com:19302`) for NAT
  traversal when players are across the internet. LAN players never hit it.
- **Rates**:
  - Host sim: 60 fps (unchanged).
  - State snapshots: 20 Hz broadcast to clients.
  - Client inputs: on key change, coalesced at 60 Hz max.

## Message protocol (JSON over DataChannel)

```
// Client -> Host
{ t: 'input', k: {KeyName: true|false, ...}, tick: N }
{ t: 'claim', role: 'gunner' }
{ t: 'chat', msg: '...' }
{ t: 'ping', ts: Date.now() }

// Host -> Clients
{ t: 'state', w: {...world slice...}, tick: N }
{ t: 'roles', map: { peerId: 'pilot', ... } }
{ t: 'event', kind: 'ticker'|'midNotice'|'sfx'|'explosion', payload: {...} }
{ t: 'pong', ts: N }
```

### World slice (host -> clients)

Snapshot, not delta, for v1. Compression later.

Fields:
- `sub`: pos/vel/angle/hp/parts/ammo/commanderHp/floating/disembarked/etc.
- `enemies`: array of {worldX, y, health, type}
- `projectiles`: torpedoes, missiles, railgunShots, bouncingBombs, subMgBullets
- `terrain`: regenerated client-side from seed (sent once at game start)
- Summaries only for particles/explosions (rendered client-side)

Target size: 4-8 KB per snapshot.

## Client-side prediction

For the local player's own role only:
- Apply inputs locally immediately (snappy controls).
- On state arrival, reconcile: rewind to snapshot tick, reapply inputs since.
- Non-role state always comes from server (no prediction).

## Lobby flow

Splash screen gains two new buttons (below the mode selectors):
- **HOST GAME** -> generates a 6-char code, shows it, waits for joiners.
- **JOIN GAME** -> prompts for 6-char code, connects to that room.

Role selection screen:
- Grid of 4 role cards with current claimants.
- Click to claim (if unclaimed); click claimed-by-you to release.
- Host presses START when ready.

## Code structure

**New files**:
- `gossamer/net/net.js` — DataChannel wrapper, codec, rate limiters.
- `gossamer/net/signalling.js` — WebRTC offer/answer/ICE handshake via the Deno endpoint.
- `gossamer/net/roles.js` — role definitions + per-role key filters.
- `gossamer/lobby.js` — HOST/JOIN/role-pick UI.

**Touched**:
- `run.js` — add `/room/:code` signalling endpoint.
- `gossamer/index_gossamer.html` — lobby hook-in on splash.
- `gossamer/app_gossamer.js` — `world.net = {mode, role, peers, tick}`, key filter, host-vs-client branching in `update()`.
- `gossamer/hud.js` — role + peer list + ping display.

## Milestones

1. **Signalling endpoint + lobby UI** (no game logic yet).
   Two browsers can enter a room code and exchange a "hello" message.
2. **Role claims + key filtering** — solo, two browsers on same machine.
3. **Input forwarding** — joiner's keys move the host's sub.
4. **State broadcast + client render** — joiner sees host's world.
5. **Client-side prediction** for own role.
6. **Polish** — disconnect / host migration / chat / ping / reconnect.

## Out of scope (v1)

- SubCommando land-based ops (v2 product)
- PvP / dogfighting (separate gamemode later)
- Replay recording (wants deterministic RNG — future)
- Host migration (fails cleanly instead for v1)
- Anti-cheat (host is trusted)
