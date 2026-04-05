# Multiplayer — Handoff Doc

Hi! This is where I left the multiplayer work. Goal: **shared submarine, 4
role-based seats** (Pilot / Gunner / Engineer / Commander). Full design
spec is in [`MULTIPLAYER.md`](./MULTIPLAYER.md) — read that first.

This doc is the "continue from here" guide.

---

## Quick orientation

### Where the game is
- Main code: `gossamer/app_gossamer.js` (~7300 lines, the big one)
- Enemies / AI: `gossamer/enemies.js` (motorcyclists, Sopwith, Nemesis, etc.)
- HUD / scoring screen: `gossamer/hud.js`
- Entry point: `gossamer/index_gossamer.html`
- Launcher script: `launcher.sh` → calls `run.js` (Deno file server + browser open)

### How to run the game
```bash
cd /var/mnt/eclipse/repos/airborne-submarine-squadron
./launcher.sh             # normal
./launcher.sh --debug     # debug mode: no cache + on-screen diagnostics overlay
```
Game opens at `http://127.0.0.1:6880/gossamer/index_gossamer.html`.

### Desktop shortcuts
- `desktop/install.sh` installs the main shortcut
- `desktop/install-debug.sh` installs the debug-mode shortcut

---

## What's done (Milestone 1 of 6)

### ✅ Signalling endpoint
**File**: `run.js` — added `/room/:code` endpoint.

- `POST /room/ABCDEF` → pushes a JSON blob into the room's mailbox
- `GET /room/ABCDEF` → drains (returns + clears) the mailbox
- Rooms auto-evict after 10 min idle
- In-memory only, no persistence (fine for handshake)

### ✅ WebRTC wrapper
**File**: `gossamer/net/signalling.js` — exports `window.ASSNet` with:

```js
ASSNet.generateRoomCode()   // returns "X7HQ2K"-style 6-char code
ASSNet.createHost(code)     // host side: creates offer + DataChannel
ASSNet.joinHost(code)       // client side: reads offer, posts answer
```

Both return a `Peer` object (extends `EventTarget`) with:
- `.send(obj)` — JSON-stringify + send over channel
- Events: `open`, `close`, `message`, `ice-state`, `error`

Uses Google public STUN servers. Polls the signalling endpoint every 700ms.

### ✅ Lobby UI
**File**: `gossamer/index_gossamer.html` — two new splash buttons:
- **HOST GAME (multiplayer)** — creates room, shows 6-char code
- **JOIN GAME (multiplayer)** — prompts for code, connects

The lobby overlay shows ICE state + logs incoming messages. Both sides send
a `{t:'hello',from:...}` message on connect, which you'll see in the panel.

### ✅ How to test what's there now
1. `./launcher.sh --debug` in one terminal
2. Open two browser windows at `http://127.0.0.1:6880/gossamer/index_gossamer.html`
3. In tab A: click **HOST GAME** → note the 6-char code
4. In tab B: click **JOIN GAME** → enter that code
5. Both should show "DataChannel OPEN" within ~2 seconds

**LAN test**: On a second machine, use `http://<host-ip>:6880/...` instead of
localhost. Run `ip addr` on the host to find its LAN IP.

---

## What's next — Milestones 2-6

### Milestone 2: Role claims + key filtering

**Goal**: Two connected browsers can each pick a role, and their keyboards
only control their role's keys.

**New file**: `gossamer/net/roles.js`

```js
// Role definitions — keys each role "owns"
export const ROLES = {
  pilot: {
    label: 'PILOT',
    keys: ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown',
           'Shift','a','A','s','S','p','P','Backspace','CapsLock'],
  },
  gunner: {
    label: 'GUNNER',
    keys: ['1','2','3','4','5','9','Control','Enter','z','Z','x','X','q','Q'],
  },
  engineer: {
    label: 'ENGINEER',
    keys: ['t','T','y','Y','u','U','i','I','c','C'],  // repair keys TBD
  },
  commander: {
    label: 'COMMANDER',
    keys: ['e','E','m','M','Tab','f','F','g','G'],
  },
};

export function keyAllowed(role, key) {
  if (!role) return true;  // solo = all keys
  return ROLES[role].keys.includes(key);
}
```

**In `app_gossamer.js`** (near the `keydown` listener at line ~365):

```js
document.addEventListener('keydown', e => {
  if (world?.net?.mode !== 'off' && !keyAllowed(world.net.role, e.key)) return;
  // ...existing code...
});
```

**In the lobby UI**: after DataChannel opens, show a 2×2 grid of role cards.
Clicking a card sends `{t:'claim', role:'gunner'}`. Host is authoritative:
tracks `roles: { peerId: role }` and broadcasts `{t:'roles', map:{...}}` to
everyone.

Only one player per role. If you try to claim an already-claimed role, host
rejects and sends back the current map.

**When both/all players have claimed and host clicks START**: host sends
`{t:'start', seed:<number>}` to all clients → all splash screens close,
game begins. Solo-mode keyboard behaviour is preserved if no MP.

### Milestone 3: Input forwarding

**Goal**: Joiner's role keys actually move the host's sub.

Client side: after START, hook the key listener. On change, `.send()`:
```js
{ t: 'input', k: { 'ArrowLeft': true, 'Control': false }, tick: N }
```

Coalesce at 60Hz (one send per frame max).

Host side: add `world.net.remoteInputs = {}` — a map of `peerId → key state`.
In the game's input-reading code, OR the host's own keys with the remote
keys from players whose role covers that key. Simplest version:

```js
function effectiveKeys() {
  const merged = Object.assign({}, keys);  // host's own keys
  for (const [peerId, keymap] of Object.entries(world.net.remoteInputs)) {
    const role = world.net.roles[peerId];
    for (const [k, v] of Object.entries(keymap)) {
      if (keyAllowed(role, k)) merged[k] = v || merged[k];
    }
  }
  return merged;
}
```

Then replace `keys[...]` reads with `effectiveKeys()[...]` throughout.

### Milestone 4: State broadcast + client render

**Goal**: Joiner's canvas shows the host's world.

Host: every 3 frames (20Hz), serialize a world slice and broadcast:
```js
{ t: 'state', w: {
  tick: world.tick,
  sub: { worldX, y, vx, vy, angle, parts, commanderHp, ...ammo fields, flags },
  enemies: world.enemies.map(e => ({ worldX:e.worldX, y:e.y, hp:e.health, type:e.type })),
  torpedoes: world.torpedoes.map(t => ({ worldX, y, vx, vy, fromSub })),
  missiles: ...,
  bouncingBombs: ...,
  railgunShots: ...,
  subMgBullets: ...,
  score, kills, gameOver, deathCause,
}, tick: N }
```

Client: receive state, copy it into a local `clientWorld`. In the client's
`update()`, **don't run physics** — just decorative stuff (particle drift,
sfx). In `draw()`, render from `clientWorld` instead of `world`.

Simplest path: make the existing `world` variable be assigned from received
state on clients. Skip the `update(dt)` call at `app_gossamer.js:2821` when
`world.net.mode === 'client'`.

**Terrain sync**: don't send every frame. Send a `{t:'start', seed:N}` once
at game start, and have `generateTerrain()` use a seeded RNG so both sides
produce the same map. Replace `Math.random()` in `generateTerrain` with a
seeded version. Keep the seed in `world.net.seed`.

### Milestone 5: Client-side prediction

**Goal**: Joiner's own role inputs feel snappy despite ~100ms round-trip.

For each local input, immediately apply it to the local `world` *as if it
were server-authoritative*. When the next server snapshot arrives, discard
the local state and re-apply any inputs that came after the snapshot's tick.

Standard rollback-netcode loop:
```
onServerSnapshot(snap):
  world = snap.w                         // authoritative
  for each unacked input since snap.tick:
    applyInput(input)
    stepPhysics(1)                       // only for local sub
```

This needs `applyInput` and `stepPhysics` to be deterministic for the
local sub. Good news: physics is simple here (gravity, drag, velocity
integration). You can punt on enemy AI prediction entirely — they're
authoritative from the server.

### Milestone 6: Polish

- Ping display in HUD (send `{t:'ping', ts}`, receive `{t:'pong', ts}`)
- Chat overlay (T key to type, Enter to send)
- Graceful disconnect: if DataChannel closes mid-game, host fills the role
  with AI or the host's keyboard
- Host migration: **skip for v1** — just show "HOST DISCONNECTED" and
  return to splash
- Reconnect: joiner can retry with the same code if the host is still up

---

## Code conventions in this repo

- **No TypeScript**. JavaScript only (some files mention ReScript — ignore
  for now, not wired into the game).
- **SPDX headers**: every new file starts with
  `// SPDX-License-Identifier: AGPL-3.0-or-later`
- **No `npm` / `node_modules`**. Deno's file server is the whole backend.
- **No build step for the game**. Edit JS → reload browser. WASM is
  pre-built.
- **Comments**: explain *why*, not *what*. If a constant's value matters,
  say why it's that number.

## Things that will trip you up

- **Browser caching**: if you edit `app_gossamer.js` and don't see your
  change, hard-reload with `Ctrl+Shift+R`. Or use `./launcher.sh --debug`
  which sends `Cache-Control: no-store`.
- **`dt` units**: the game loop computes `dt = Math.min(ts - lastTime, 32)`
  in ms, then passes `dt/16` to `update()`. So inside `update`, `dt` is
  in "60fps frame units" — `dt=1` at 60fps, `dt=2` at 30fps, capped at 2.
- **`world.cameraY` clamp**: it's clamped to `Math.max(0, cameraY)` at
  line ~3814, which causes weirdness when the sub flies high. Might need
  to lift that clamp once you have time to tune.
- **WASM co-processor**: `world.wasm` runs parallel physics for verification.
  If you change sub physics in JS, the WASM state will drift. For MP you
  can ignore WASM (it's advisory).
- **`world.settings` vs `world.sub.*`**: settings persist across lives,
  sub state resets each run. Don't conflate them.

## Files I've touched in this session

(Everything is in a single session's work — not committed yet. `git status`
will show all the changes.)

- `run.js` — signalling endpoint
- `gossamer/net/signalling.js` — WebRTC wrapper (new)
- `gossamer/index_gossamer.html` — splash buttons + lobby modal + wiring
- `gossamer/app_gossamer.js` — lots of game-logic changes (see below)
- `gossamer/enemies.js` — Sopwith / Evel rework
- `gossamer/hud.js` — weapons panel, cause-of-death, coord readout
- `launcher.sh` — `--debug` flag
- `desktop/airborne-submarine-squadron-debug.desktop` — debug shortcut
- `desktop/install-debug.sh` — debug shortcut installer

Game-logic changes this session (context for what state you're inheriting):

- **Rescue ladder** (CapsLock to toggle) — dangles from sub, can pluck
  hostages / Evel. Evel may jump for it mid-flight if close; clinging Evel
  slows you down until shaken off in water or crushed on land.
- **VTOL upgrade stub** (`sub.vtolUpgrade`) — currently always false,
  but wired into hover stability checks. Your task later: add a pickup.
- **Sopwith retro rework** — 8-directional movement, straight-line MG
  bursts, loop-the-loops, random stalls with smoky wobble, power-climb
  recovery. Now also aggros on whoever hit it last.
- **Mine field** — spacing enforced (70px min), domino chain detonation,
  mine hit is instant kill (sub + commander both destroyed).
- **Bouncing bombs** now collide with ships (destroyer, interceptors,
  passenger ship with civilian penalty).
- **Splash menu** — PLAY / SUBCOMMANDO (v2 placeholder) / HOST / JOIN /
  SETTINGS buttons.
- **Cause-of-death screen** — amusing blurbs when mission failed.
- **Weapons HUD** at top-centre showing all 6 slots + ammo.
- **Coord readout** at bottom-left, always on, for diagnosing weird bugs.

## Known open bugs

1. **"Sub vanishes and reappears sideways"** — unreproducible on my end.
   Check the coord readout when it happens next. Possibly camera-clamp
   related.
2. **Home port appears near seabed when sub drops from start** — same
   family as above. Need actual debug values to diagnose.
3. **Seabed items sometimes render under islands** — could be drawing
   order; would need to audit the island-loop block in `draw()`.

## Contact + decisions to ask me about

- If you want to switch to an authoritative **dedicated server** (vs
  host-is-authoritative), that's a bigger rearchitecture — ping me.
- If determinism becomes important (replays, rollback netcode), we need
  to seed every `Math.random()` call. Doable but invasive.
- Role key maps are a guess — playtest and rebalance them.

Good luck! Codebase is messy but fun. Start with Milestone 2 and work down.
