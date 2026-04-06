# Orbital & Weapons Modularisation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract orbital-mode code into `gossamer/orbital.js` and atmospheric weapon code into `gossamer/weapons.js`, reducing `app_gossamer.js` by ~600 lines and restoring the missing orbital-hazard draw functions lost in the hud.js merge.

**Architecture:** Plain `<script>` tags, no bundler. New files load before `app_gossamer.js` and declare globals consumed by later scripts. Functions reference `world`, `ctx`, `SOLAR_GM`, `SOLAR_SYSTEM_BODIES`, etc. defined in `app_gossamer.js`; this works because all functions are called at runtime (after all scripts have loaded), not at definition time. `test/_extract.js` is updated to concatenate all three source files so existing Deno tests keep finding the constants and functions they already test.

**Tech Stack:** Vanilla JS (browser globals), Deno + JSR std/assert for tests.

---

## File Structure

**Create:**
- `gossamer/weapons.js` — depth-charge constants, `canFireTorpedo`, `detonateDepthCharge`, `updateDepthCharges`, `updateProjectiles`, `drawDepthCharges`, `drawTorpedoes`, `drawMissiles`
- `gossamer/orbital.js` — orbital constants, solar helpers, all init/update functions for orbit mode, four new draw functions (`drawComets`, `drawDebrisClouds`, `drawOrbitalProjectiles`, `drawAsteroids`)

**Modify:**
- `gossamer/app_gossamer.js` — delete moved constants/functions; replace three inline weapon draw loops in `draw()` with single-line calls; delete the placeholder comment block left after the orbital functions move
- `gossamer/hud.js` — add four draw-function calls inside the camera transform in `drawOrbitScene()`; update `/* global */` comment
- `gossamer/index_gossamer.html` — add two `<script>` tags before `app_gossamer.js`
- `test/_extract.js` — concatenate three source files so existing test constants and functions are still found

---

### Task 1: Create `gossamer/weapons.js`

**Files:**
- Create: `gossamer/weapons.js`

- [ ] **Step 1: Run the existing tests as a baseline**

```bash
deno test test/unit_test.js test/integration_test.js --allow-read 2>&1 | tail -5
```

Expected: all tests pass. If any fail, fix them before continuing.

- [ ] **Step 2: Create `gossamer/weapons.js`**

```javascript
// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Jonathan D.A. Jewell (hyperpolymath)
//
// weapons.js — Atmospheric weapon constants, update logic, and draw functions.
// Loaded via <script> tag before app_gossamer.js.

/* global world, ctx, W, H, TWO_PI, SFX, toScreen,
   addExplosion, addParticles, damageRandomPart,
   WATER_LINE, SEA_FLOOR, groundYFromTerrain, islandHitTest */

// ── Depth charge constants ──────────────────────────────────────────────────
const START_DEPTH_CHARGES       = 8;
const DEPTH_CHARGE_COOLDOWN     = 42;
const DEPTH_CHARGE_GRAVITY      = 0.22;
const DEPTH_CHARGE_WATER_DRAG   = 0.985;
const DEPTH_CHARGE_BLAST_RADIUS = 85;
const DEPTH_CHARGE_LIFE         = 180;
const DEPTH_CHARGE_COLOR        = '#9b59b6';

// ── Pure predicate ──────────────────────────────────────────────────────────
function canFireTorpedo(parts) { return parts.nose > 20; }

// ── Depth charge detonation ─────────────────────────────────────────────────
function detonateDepthCharge(charge) {
  addExplosion(charge.worldX, charge.y, 'big');
  addParticles(charge.worldX, charge.y, 18, DEPTH_CHARGE_COLOR);
  SFX.explodeBig();
  // Blast radius damage to all naval enemies
  for (const e of world.navalEnemies || []) {
    const dist = Math.hypot(charge.worldX - e.worldX, charge.y - e.y);
    if (dist < DEPTH_CHARGE_BLAST_RADIUS) {
      const falloff = 1 - dist / DEPTH_CHARGE_BLAST_RADIUS;
      e.health -= Math.round(40 * falloff);
      if (e.health <= 0) {
        addExplosion(e.worldX, e.y, 'big');
        addParticles(e.worldX, e.y, 12, '#ff6b00');
        world.score += 150;
        world.kills++;
        SFX.enemyDestroyed();
      }
    }
  }
}

// ── Depth charge physics + detonation ──────────────────────────────────────
function updateDepthCharges(dt) {
  world.depthChargeCooldown = Math.max(0, (world.depthChargeCooldown || 0) - dt);
  world.depthCharges = world.depthCharges.filter(charge => {
    charge.vx *= DEPTH_CHARGE_WATER_DRAG;
    if (charge.y < WATER_LINE) {
      // In air — gravity only
      charge.vy += DEPTH_CHARGE_GRAVITY * dt;
    } else {
      // In water — drag + gravity
      charge.vy = charge.vy * DEPTH_CHARGE_WATER_DRAG + DEPTH_CHARGE_GRAVITY * 0.5 * dt;
    }
    charge.worldX += charge.vx * dt;
    charge.y      += charge.vy * dt;
    charge.life   -= dt;

    // Add trail
    charge.trail.push({ wx: charge.worldX, y: charge.y, age: 0 });
    if (charge.trail.length > 12) charge.trail.shift();
    charge.trail.forEach(p => { p.age += dt; });

    // Detonate on sea floor or life expired
    const floor = groundYFromTerrain(world.terrain, charge.worldX);
    if (charge.life <= 0 || charge.y >= floor) {
      detonateDepthCharge(charge);
      return false;
    }
    return true;
  });
}

// ── Torpedo and missile collision detection ─────────────────────────────────
function updateProjectiles(dt) {
  world.torpedoes = world.torpedoes.filter(t => {
    for (let i = world.enemies.length - 1; i >= 0; i--) {
      const e = world.enemies[i];
      if (Math.abs(t.worldX - e.worldX) < 22 && Math.abs(t.y - e.y) < 18) {
        e.health -= 2;
        if (e.health <= 0) {
          addExplosion(e.worldX, e.y, 'big'); addParticles(e.worldX, e.y, 10, '#ff6b00');
          world.score += 200; world.kills++; world.enemies.splice(i, 1); SFX.enemyDestroyed();
        } else { addExplosion(t.worldX, t.y, 'small'); SFX.explodeSmall(); }
        return false;
      }
    }
    return true;
  });
  world.missiles = world.missiles.filter(m => {
    if (m.phase === 'drop') return true;
    for (let i = world.enemies.length - 1; i >= 0; i--) {
      const e = world.enemies[i];
      if (Math.abs(m.worldX - e.worldX) < 20 && Math.abs(m.y - e.y) < 15) {
        e.health -= 3;
        if (e.health <= 0) {
          addExplosion(e.worldX, e.y, 'big'); addParticles(e.worldX, e.y, 14, '#ff6b00');
          world.score += 300; world.kills++; world.enemies.splice(i, 1); SFX.enemyDestroyed();
        } else { addExplosion(m.worldX, m.y, 'small'); SFX.explodeSmall(); }
        return false;
      }
    }
    return true;
  });
}

// ── Draw functions ──────────────────────────────────────────────────────────

function drawDepthCharges() {
  for (const charge of world.depthCharges) {
    for (const p of charge.trail) {
      ctx.globalAlpha = Math.max(0, 0.35 - p.age * 0.02);
      ctx.fillStyle = DEPTH_CHARGE_COLOR;
      ctx.beginPath();
      ctx.arc(toScreen(p.wx), p.y, 2, 0, TWO_PI);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = DEPTH_CHARGE_COLOR;
    ctx.beginPath();
    ctx.arc(toScreen(charge.worldX), charge.y, 5, 0, TWO_PI);
    ctx.fill();
    ctx.strokeStyle = '#f8fafc';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(toScreen(charge.worldX), charge.y - 6);
    ctx.lineTo(toScreen(charge.worldX), charge.y - 10);
    ctx.stroke();
  }
}

function drawTorpedoes() {
  for (const t of world.torpedoes) {
    for (const p of t.trail) {
      ctx.globalAlpha = Math.max(0, 1 - p.age / 12) * 0.3;
      ctx.fillStyle = t.phase === 'drop' ? '#bdc3c7' : '#85c1e9';
      ctx.beginPath(); ctx.arc(toScreen(p.wx), p.y, 2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.save(); ctx.translate(toScreen(t.worldX), t.y); ctx.rotate(Math.atan2(t.vy, t.vx));
    if (t.lgt) {
      ctx.fillStyle = '#22d3ee';
      ctx.beginPath(); ctx.ellipse(0, 0, 9, 3.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#0891b2'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = '#06b6d4';
      ctx.beginPath(); ctx.moveTo(-4, -3); ctx.lineTo(-7, -7); ctx.lineTo(-2, -3); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-4, 3); ctx.lineTo(-7, 7); ctx.lineTo(-2, 3); ctx.fill();
      ctx.fillStyle = '#e74c3c'; ctx.beginPath(); ctx.arc(8, 0, 2.5, -Math.PI / 2, Math.PI / 2); ctx.fill();
      ctx.fillStyle = 'rgba(133,193,233,0.6)';
      ctx.beginPath(); ctx.arc(-11, 0, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(-14, (Math.random() - 0.5) * 3, 1.5, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = t.phase === 'drop' ? '#95a5a6' : (t.rogue ? '#ff9800' : '#ffe66d');
      ctx.beginPath(); ctx.ellipse(0, 0, 8, 3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#e74c3c'; ctx.beginPath(); ctx.arc(7, 0, 2.5, -Math.PI / 2, Math.PI / 2); ctx.fill();
      if (t.phase !== 'drop') { ctx.fillStyle = 'rgba(133,193,233,0.5)'; ctx.beginPath(); ctx.arc(-9, 0, 2, 0, Math.PI * 2); ctx.fill(); }
      if (t.rogue && t.phase !== 'drop') {
        ctx.strokeStyle = '#ff9800'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, -3); ctx.lineTo(0, -7); ctx.stroke();
        ctx.fillStyle = '#ff9800'; ctx.beginPath(); ctx.arc(0, -7, 1.5, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }
}

function drawMissiles() {
  for (const m of world.missiles) {
    for (const p of m.trail) {
      ctx.globalAlpha = Math.max(0, 1 - p.age / 15) * 0.5;
      ctx.fillStyle = m.phase === 'drop' ? '#95a5a6' : '#ff6b00';
      ctx.beginPath(); ctx.arc(toScreen(p.wx), p.y, m.phase === 'drop' ? 1 : 2.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.save(); ctx.translate(toScreen(m.worldX), m.y); ctx.rotate(Math.atan2(m.vy, m.vx));
    ctx.fillStyle = '#ecf0f1'; ctx.fillRect(-7, -2, 14, 4);
    ctx.fillStyle = '#e74c3c';
    ctx.beginPath(); ctx.moveTo(-6, -2); ctx.lineTo(-9, -6); ctx.lineTo(-4, -2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-6, 2); ctx.lineTo(-9, 6); ctx.lineTo(-4, 2); ctx.fill();
    ctx.fillStyle = '#2c3e50'; ctx.beginPath(); ctx.moveTo(7, -2); ctx.lineTo(11, 0); ctx.lineTo(7, 2); ctx.fill();
    if (m.phase === 'ignite') {
      ctx.fillStyle = '#ff6b00'; ctx.beginPath(); ctx.moveTo(-7, -1.5); ctx.lineTo(-12 - Math.random() * 4, 0); ctx.lineTo(-7, 1.5); ctx.fill();
      ctx.fillStyle = '#ffcc00'; ctx.beginPath(); ctx.moveTo(-7, -0.8); ctx.lineTo(-10 - Math.random() * 2, 0); ctx.lineTo(-7, 0.8); ctx.fill();
    }
    ctx.restore();
  }
}
```

- [ ] **Step 3: Commit weapons.js (constants/functions are still duplicated — intentional safe state)**

```bash
git add gossamer/weapons.js
git commit -m "feat: create weapons.js — depth-charge constants, update logic, draw functions"
```

---

### Task 2: Update `draw()` in `app_gossamer.js` — replace inline weapon loops

**Files:**
- Modify: `gossamer/app_gossamer.js`

The three inline draw loops for depth charges, torpedoes, and missiles (currently around lines 6596–6673 in `draw()`) must be replaced with calls to the new functions. Find the block that starts with `// --- Depth charges ---` and ends after the missiles loop.

- [ ] **Step 1: Replace the inline weapon draw loops in `draw()`**

Find and replace this block (approximately lines 6596–6674):

```javascript
  // --- Depth charges ---
  for (const charge of world.depthCharges) {
    for (const p of charge.trail) {
      ctx.globalAlpha = Math.max(0, 0.35 - p.age * 0.02);
      ctx.fillStyle = DEPTH_CHARGE_COLOR;
      ctx.beginPath();
      ctx.arc(toScreen(p.wx), p.y, 2, 0, TWO_PI);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = DEPTH_CHARGE_COLOR;
    ctx.beginPath();
    ctx.arc(toScreen(charge.worldX), charge.y, 5, 0, TWO_PI);
    ctx.fill();
    ctx.strokeStyle = '#f8fafc';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(toScreen(charge.worldX), charge.y - 6);
    ctx.lineTo(toScreen(charge.worldX), charge.y - 10);
    ctx.stroke();
  }

  // --- Torpedoes ---
  for (const t of world.torpedoes) {
```

With:

```javascript
  // --- Depth charges, torpedoes, missiles (drawn by weapons.js) ---
  drawDepthCharges();
  drawTorpedoes();
```

Then find the block `// --- Missiles ---` and everything from there through the closing `}` of the missiles loop (the last `ctx.restore();` before the next comment after missiles), and delete it. Also delete `// --- Torpedoes ---` and the torpedoes loop (they're replaced by `drawTorpedoes()` above).

The net result: three large loops gone, replaced by three 1-line calls.

- [ ] **Step 2: Verify no remaining torpedo/missile/depth-charge draw loops remain**

```bash
grep -n "for (const charge\|for (const t of world.torpedoes\|for (const m of world.missiles" gossamer/app_gossamer.js
```

Expected: no matches.

- [ ] **Step 3: Commit**

```bash
git add gossamer/app_gossamer.js
git commit -m "refactor: replace inline weapon draw loops with drawDepthCharges/Torpedoes/Missiles calls"
```

---

### Task 3: Remove weapon code from `app_gossamer.js`

**Files:**
- Modify: `gossamer/app_gossamer.js`

Now that `draw()` uses the new functions and `weapons.js` is the authoritative source, delete the duplicated definitions from `app_gossamer.js`.

- [ ] **Step 1: Delete the seven depth-charge constants**

Find and delete these lines (currently ~133–139):

```javascript
const START_DEPTH_CHARGES       = 8;
const DEPTH_CHARGE_COOLDOWN     = 42;
const DEPTH_CHARGE_GRAVITY      = 0.22;
const DEPTH_CHARGE_WATER_DRAG   = 0.985;
const DEPTH_CHARGE_BLAST_RADIUS = 85;
const DEPTH_CHARGE_LIFE         = 180;
const DEPTH_CHARGE_COLOR        = '#9b59b6';
```

- [ ] **Step 2: Delete `canFireTorpedo` from app_gossamer.js**

Find and delete the line (currently ~1655):

```javascript
function canFireTorpedo(parts) { return parts.nose > 20; }
```

- [ ] **Step 3: Delete `detonateDepthCharge` from app_gossamer.js**

Find and delete the entire function body starting with:

```javascript
function detonateDepthCharge(charge) {
```

- [ ] **Step 4: Delete `updateDepthCharges` from app_gossamer.js**

Find and delete the entire function body starting with:

```javascript
function updateDepthCharges(dt) {
```

- [ ] **Step 5: Delete `updateProjectiles` from app_gossamer.js**

Find and delete the entire function body starting with:

```javascript
function updateProjectiles(dt) {
  const sub = world.sub;
  world.torpedoes = world.torpedoes.filter(t => {
```

- [ ] **Step 6: Verify the deleted names no longer appear as definitions**

```bash
grep -n "^function canFireTorpedo\|^function detonateDepth\|^function updateDepthCharges\|^function updateProjectiles\|^const DEPTH_CHARGE_COOLDOWN\|^const START_DEPTH_CHARGES" gossamer/app_gossamer.js
```

Expected: no matches.

- [ ] **Step 7: Commit**

```bash
git add gossamer/app_gossamer.js
git commit -m "refactor: remove weapon constants and functions moved to weapons.js"
```

---

### Task 4: Update `index_gossamer.html` and `test/_extract.js` for weapons

**Files:**
- Modify: `gossamer/index_gossamer.html`
- Modify: `test/_extract.js`

- [ ] **Step 1: Add `weapons.js` script tag to `index_gossamer.html`**

Find the existing script tags (currently in order: sfx.js, verisimdb.js, enemies.js, hud.js, app_gossamer.js). Insert `weapons.js` before `app_gossamer.js`:

```html
<script src="sfx.js?v=2"></script>
<script src="verisimdb.js?v=2"></script>
<script src="enemies.js?v=2"></script>
<script src="hud.js?v=2"></script>
<script src="weapons.js?v=2"></script>
<script src="app_gossamer.js?v=2"></script>
```

- [ ] **Step 2: Update `test/_extract.js` to concatenate sources**

Find this line near the top of `_extract.js`:

```javascript
const SRC  = await Deno.readTextFile(ROOT + 'gossamer/app_gossamer.js');
```

Replace it with:

```javascript
const SRC = [
  await Deno.readTextFile(ROOT + 'gossamer/app_gossamer.js'),
  await Deno.readTextFile(ROOT + 'gossamer/weapons.js'),
].join('\n');
```

- [ ] **Step 3: Run tests — they must still pass**

```bash
deno test test/unit_test.js test/integration_test.js --allow-read 2>&1 | tail -10
```

Expected: all tests pass. `canFireTorpedo`, `START_DEPTH_CHARGES`, `DEPTH_CHARGE_BLAST_RADIUS`, `DEPTH_CHARGE_LIFE` are now extracted from `weapons.js` via the concatenated source.

- [ ] **Step 4: Commit**

```bash
git add gossamer/index_gossamer.html test/_extract.js
git commit -m "chore: load weapons.js; update _extract.js to read from all source files"
```

---

### Task 5: Create `gossamer/orbital.js`

**Files:**
- Create: `gossamer/orbital.js`

This task moves all orbital-mode code out of `app_gossamer.js` and adds the four missing draw functions that were lost when `hud.js` was extracted upstream.

- [ ] **Step 1: Create `gossamer/orbital.js`**

The file contains:
1. A `/* global */` declaration listing everything it references from other files
2. Orbital + hazard constants (moved from app_gossamer.js)
3. Solar helpers (`solarBodyPosition`, `getSolarBodies`, `nearestSolarBody`)
4. Init functions (`initComets`, `cometPosition`, `initDebrisClouds`, `initAsteroids`)
5. State + entry (`createOrbitState`, `enterOrbitMode`)
6. Update functions (`updateComets`, `updateDebrisClouds`, `damageAsteroid`, `fireOrbitalProjectile`, `updateOrbitalProjectiles`, `updateAsteroids`, `updateOrbitMode`)
7. **New** draw functions (`drawComets`, `drawDebrisClouds`, `drawOrbitalProjectiles`, `drawAsteroids`)

```javascript
// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Jonathan D.A. Jewell (hyperpolymath)
//
// orbital.js — Orbital mode: constants, solar helpers, hazard init/update/draw,
//              ship orbit physics. Loaded via <script> tag before app_gossamer.js.

/* global world, ctx, W, H, TWO_PI, SFX,
   addExplosion, addParticles, damageRandomPart,
   keys, keyJustPressed, keybinds,
   SOLAR_GM, SOLAR_SYSTEM_BODIES, SOLAR_SYSTEM_BOUNDARY, PLANETS,
   AFTERBURNER_COLOR, AFTERBURNER_MAX_CHARGE,
   ensureLeaderboardRecorded, velocityToMph, updateTelemetry,
   resolveSubSkin, stripedGradient */

// ── Orbital physics constants ───────────────────────────────────────────────
const SPACE_CAMERA_SMOOTH        = 0.06;
const SPACE_TIME_SCALE           = 0.22;
const ORBITAL_TURN_RATE          = 0.025;
const ORBITAL_THRUST             = 0.004;
const ORBITAL_RETRO_THRUST       = 0.003;
const ORBITAL_AFTERBURNER_THRUST = 0.010;
const ORBITAL_COLLISION_RADIUS   = 12;

// ── Drifting hazard constants ───────────────────────────────────────────────
const ASTEROID_COUNT         = 60;
const ASTEROID_BELT_MIN      = 615;   // inner edge (Mars orbit radius)
const ASTEROID_BELT_MAX      = 780;   // outer edge (Jupiter orbit radius)
const ASTEROID_COLLISION_DMG = 8;     // base damage per unit of closing speed
const DEBRIS_CLOUD_COUNT     = 4;
const DEBRIS_PARTICLES       = 20;    // particles per cloud
const DEBRIS_COLLECT_SPEED   = 0.4;   // max ship speed to collect resources
const COMET_COUNT            = 2;
const ORB_PROJ_TORPEDO_SPEED = 1.5;
const ORB_PROJ_MISSILE_SPEED = 0.8;
const ORB_PROJ_TORPEDO_LIFE  = 300;
const ORB_PROJ_MISSILE_LIFE  = 600;

// ── Solar body helpers ──────────────────────────────────────────────────────
function solarBodyPosition(def, time) {
  if (def.id === 'sun') {
    return { ...def, x: 0, y: 0, angle: 0 };
  }
  const angle = def.phase + (time * SPACE_TIME_SCALE / def.period) * TWO_PI;
  const a = def.orbitRadius;
  const e = def.ecc || 0;
  const omega = def.peri || 0;
  const b = a * Math.sqrt(1 - e * e);
  const ex = -a * e + a * Math.cos(angle);
  const ey = b * Math.sin(angle);
  const x = ex * Math.cos(omega) - ey * Math.sin(omega);
  const y = ex * Math.sin(omega) + ey * Math.cos(omega);
  return { ...def, angle, x, y };
}

function getSolarBodies(time) {
  return SOLAR_SYSTEM_BODIES.map((def) => solarBodyPosition(def, time));
}

function nearestSolarBody(space, bodies) {
  let best = null;
  let bestDist = Infinity;
  for (const body of bodies) {
    if (body.id === 'sun') continue;
    const dist = Math.hypot(space.shipX - body.x, space.shipY - body.y);
    if (dist < bestDist) {
      bestDist = dist;
      best = body;
    }
  }
  return best ? { body: best, distance: bestDist } : null;
}

// ── Hazard initialisation ───────────────────────────────────────────────────
function initComets() {
  return [
    { a: 900,  ecc: 0.82, peri: 0.7,  phase: 0.0,  period: 700, radius: 9,  trail: [] },
    { a: 1100, ecc: 0.75, peri: 2.3,  phase: 3.14, period: 950, radius: 7,  trail: [] },
  ];
}

function cometPosition(c, time) {
  const angle = c.phase + (time * SPACE_TIME_SCALE / c.period) * Math.PI * 2;
  const b  = c.a * Math.sqrt(1 - c.ecc * c.ecc);
  const ex = -c.a * c.ecc + c.a * Math.cos(angle);
  const ey = b * Math.sin(angle);
  return {
    x: ex * Math.cos(c.peri) - ey * Math.sin(c.peri),
    y: ex * Math.sin(c.peri) + ey * Math.cos(c.peri),
    angle,
  };
}

function initDebrisClouds() {
  const zones = [330, 450, 570, 700];
  return zones.slice(0, DEBRIS_CLOUD_COUNT).map((orbitR, i) => {
    const angle = (i / DEBRIS_CLOUD_COUNT) * Math.PI * 2 + 0.7;
    const speed = Math.sqrt(SOLAR_GM / (2 * orbitR));
    const particles = Array.from({ length: DEBRIS_PARTICLES }, () => ({
      dx: (Math.random() - 0.5) * 40,
      dy: (Math.random() - 0.5) * 40,
      r:  1.5 + Math.random() * 3,
    }));
    return {
      x:  Math.cos(angle) * orbitR,
      y:  Math.sin(angle) * orbitR,
      vx: -Math.sin(angle) * speed,
      vy:  Math.cos(angle) * speed,
      radius: 28,
      particles,
      type: i % 2 === 0 ? 'hull' : 'ammo',
      collected: false,
    };
  });
}

function initAsteroids() {
  const asteroids = [];
  for (let i = 0; i < ASTEROID_COUNT; i++) {
    const orbitR = ASTEROID_BELT_MIN + Math.random() * (ASTEROID_BELT_MAX - ASTEROID_BELT_MIN);
    const angle  = Math.random() * Math.PI * 2;
    const speed  = Math.sqrt(SOLAR_GM / (2 * orbitR)) * (0.92 + Math.random() * 0.16);
    const radius = 4 + Math.random() * 14;
    asteroids.push({
      x:  Math.cos(angle) * orbitR,
      y:  Math.sin(angle) * orbitR,
      vx: -Math.sin(angle) * speed,
      vy:  Math.cos(angle) * speed,
      radius,
      hp: radius < 7 ? 1 : radius < 12 ? 2 : 3,
      id: i,
      color: `hsl(${25 + Math.random() * 20},${30 + Math.random() * 20}%,${28 + Math.random() * 18}%)`,
    });
  }
  return asteroids;
}

// ── Orbit state + entry ─────────────────────────────────────────────────────
function createOrbitState() {
  const originId = (world.lastSolarBodyId && world.lastSolarBodyId !== 'sun')
    ? world.lastSolarBodyId : 'earth';
  const originDef = SOLAR_SYSTEM_BODIES.find((body) => body.id === originId)
    || SOLAR_SYSTEM_BODIES.find((body) => body.id === 'earth');
  const origin = solarBodyPosition(originDef, 0);
  const orbitalRadius = originDef.orbitRadius + originDef.radius * 2;
  const angle = origin.angle;
  const orbitalSpeed = Math.sqrt(SOLAR_GM / orbitalRadius);
  const touristFromIdx = Math.floor(Math.random() * (SOLAR_SYSTEM_BODIES.length - 1)) + 1;
  let touristToIdx = touristFromIdx;
  while (touristToIdx === touristFromIdx) touristToIdx = Math.floor(Math.random() * (SOLAR_SYSTEM_BODIES.length - 1)) + 1;
  const fromBody = solarBodyPosition(SOLAR_SYSTEM_BODIES[touristFromIdx], 0);
  return {
    time: 0,
    shipX: Math.cos(angle) * orbitalRadius,
    shipY: Math.sin(angle) * orbitalRadius,
    shipVx: -Math.sin(angle) * orbitalSpeed,
    shipVy: Math.cos(angle) * orbitalSpeed,
    shipAngle: angle + Math.PI / 2,
    cameraX: Math.cos(angle) * orbitalRadius,
    cameraY: Math.sin(angle) * orbitalRadius,
    cameraZoom: 1,
    currentSOI: null,
    trail: [],
    nearestBody: { body: origin, distance: originDef.radius * 2 },
    autopilotTarget: null,
    touristShip: {
      x: fromBody.x, y: fromBody.y,
      fromPlanetIdx: touristFromIdx,
      toPlanetIdx: touristToIdx,
      progress: 0,
      speed: 0.0008,
      visible: true,
      dwellTimer: 0,
    },
    asteroids: initAsteroids(),
    debrisClouds: initDebrisClouds(),
    comets: initComets(),
    projectiles: [],
  };
}

function enterOrbitMode(entrySpeedMph) {
  const sub = world.sub;
  world.mode = 'orbit';
  world.space = createOrbitState();
  world.torpedoes = [];
  world.missiles = [];
  world.depthCharges = [];
  world.enemies = [];
  world.chaffs = [];
  sub.floating = false;
  sub.liftingOff = false;
  sub.diving = false;
  sub.wasInWater = false;
  sub.periscopeMode = false;
  sub.periscopeDepth = 0;
  sub.vx = world.space.shipVx;
  sub.vy = world.space.shipVy;
  sub.angle = world.space.shipAngle;
  sub.y = world.space.shipY;
}

// ── Hazard update functions ─────────────────────────────────────────────────
function updateComets(space, sub, dt) {
  for (const c of space.comets) {
    const pos = cometPosition(c, space.time);
    c.trail.push({ x: pos.x, y: pos.y });
    if (c.trail.length > 30) c.trail.shift();

    if (Math.hypot(space.shipX - pos.x, space.shipY - pos.y) < c.radius + ORBITAL_COLLISION_RADIUS) {
      damageRandomPart(sub.parts, 60);
      damageRandomPart(sub.parts, 60);
      addExplosion(pos.x, pos.y, 'big');
      SFX.damage();
      world.caveMessage = { text: 'COMET STRIKE — CRITICAL DAMAGE', timer: 200 };
      const dx = space.shipX - pos.x;
      const dy = space.shipY - pos.y;
      const mag = Math.max(1, Math.hypot(dx, dy));
      space.shipVx += (dx / mag) * 4;
      space.shipVy += (dy / mag) * 4;
    }
  }
}

function updateDebrisClouds(space, bodies, sub, dt) {
  for (const c of space.debrisClouds) {
    if (c.collected) continue;
    // Solar gravity only — planetary GMs are tuned for SOI transitions, not N-body stability.
    // Jupiter (gm=22) at r=780 would kick outer-belt objects out of orbit on close passes.
    for (const body of bodies) {
      if (body.id !== 'sun') continue;
      const dx = body.x - c.x;
      const dy = body.y - c.y;
      const distSq = Math.max(dx * dx + dy * dy, body.radius ** 2);
      const dist   = Math.sqrt(distSq);
      c.vx += (body.gm || 0) / distSq * (dx / dist) * dt;
      c.vy += (body.gm || 0) / distSq * (dy / dist) * dt;
    }
    c.x += c.vx * dt * 4;
    c.y += c.vy * dt * 4;

    const shipDist = Math.hypot(space.shipX - c.x, space.shipY - c.y);
    if (shipDist < c.radius + ORBITAL_COLLISION_RADIUS) {
      const shipSpeed = Math.hypot(space.shipVx, space.shipVy);
      if (shipSpeed < DEBRIS_COLLECT_SPEED) {
        if (c.type === 'hull') {
          const parts = sub.parts;
          const keys  = Object.keys(parts).filter(k => typeof parts[k] === 'number' && parts[k] < 100);
          if (keys.length) {
            const ki = Math.floor(Math.random() * keys.length);
            parts[keys[ki]] = Math.min(100, parts[keys[ki]] + 20);
          }
        } else {
          world.sub.ammo = Math.min((world.sub.ammo || 0) + 30, 200);
        }
        world.caveMessage = { text: `SALVAGE: ${c.type === 'hull' ? 'HULL REPAIR' : 'AMMO +30'}`, timer: 120 };
        c.collected = true;
      } else {
        damageRandomPart(sub.parts, 2 * shipSpeed);
        world.caveMessage = { text: 'DEBRIS IMPACT — SLOW TO SALVAGE', timer: 80 };
      }
    }
  }
}

function damageAsteroid(space, asteroid, damage) {
  asteroid.hp -= damage;
  if (asteroid.hp > 0) return;
  addExplosion(asteroid.x, asteroid.y, asteroid.radius > 10 ? 'big' : 'small');
  if (asteroid.radius >= 7) {
    const fragCount = asteroid.radius >= 12 ? 3 : 2;
    for (let i = 0; i < fragCount; i++) {
      const spreadAngle = (Math.random() - 0.5) * Math.PI;
      const speed = Math.hypot(asteroid.vx, asteroid.vy) * 0.6;
      const baseAngle = Math.atan2(asteroid.vy, asteroid.vx) + spreadAngle;
      space.asteroids.push({
        x: asteroid.x + Math.cos(baseAngle) * asteroid.radius,
        y: asteroid.y + Math.sin(baseAngle) * asteroid.radius,
        vx: Math.cos(baseAngle) * speed,
        vy: Math.sin(baseAngle) * speed,
        radius: asteroid.radius / fragCount,
        hp: 1,
        id: Math.random(),
        color: asteroid.color,
      });
    }
  }
}

function fireOrbitalProjectile(space, sub, type) {
  const speed  = type === 'torpedo' ? ORB_PROJ_TORPEDO_SPEED : ORB_PROJ_MISSILE_SPEED;
  const maxAge = type === 'torpedo' ? ORB_PROJ_TORPEDO_LIFE  : ORB_PROJ_MISSILE_LIFE;
  space.projectiles.push({
    x:      space.shipX + Math.cos(space.shipAngle) * 20,
    y:      space.shipY + Math.sin(space.shipAngle) * 20,
    vx:     space.shipVx + Math.cos(space.shipAngle) * speed,
    vy:     space.shipVy + Math.sin(space.shipAngle) * speed,
    type,
    age:    0,
    maxAge,
  });
}

function updateOrbitalProjectiles(space, bodies, dt) {
  const survivors = [];
  for (const p of space.projectiles) {
    if (p.age > p.maxAge) continue;
    for (const body of bodies) {
      const dx = body.x - p.x;
      const dy = body.y - p.y;
      const distSq = Math.max(dx * dx + dy * dy, body.radius ** 2);
      const dist   = Math.sqrt(distSq);
      const accel  = (body.gm || 0) / distSq;
      p.vx += (dx / dist) * accel * dt;
      p.vy += (dy / dist) * accel * dt;
    }
    p.x += p.vx * dt * 4;
    p.y += p.vy * dt * 4;
    p.age++;

    let hit = false;
    const asteroidSnapshot = space.asteroids.slice();
    for (const a of asteroidSnapshot) {
      if (Math.hypot(p.x - a.x, p.y - a.y) < a.radius + 3) {
        damageAsteroid(space, a, 1);
        hit = true;
        break;
      }
    }
    if (!hit) survivors.push(p);
  }
  space.asteroids = space.asteroids.filter(a => a.hp > 0);
  space.projectiles = survivors;
}

function updateAsteroids(space, bodies, sub, dt) {
  const next = [];
  for (const a of space.asteroids) {
    // Solar gravity only — planetary GMs are tuned for SOI transitions, not N-body stability.
    // Jupiter (gm=22) at r=780 would kick outer-belt asteroids out of orbit on close passes.
    for (const body of bodies) {
      if (body.id !== 'sun') continue;
      const dx = body.x - a.x;
      const dy = body.y - a.y;
      const distSq = Math.max(dx * dx + dy * dy, (body.radius + a.radius) ** 2);
      const dist   = Math.sqrt(distSq);
      const accel  = (body.gm || 0) / distSq;
      a.vx += (dx / dist) * accel * dt;
      a.vy += (dy / dist) * accel * dt;
    }
    a.x += a.vx * dt * 4;
    a.y += a.vy * dt * 4;

    // Ship collision — asteroid is immovable, bounce the ship off it
    const dxS = space.shipX - a.x;
    const dyS = space.shipY - a.y;
    const shipDist = Math.hypot(dxS, dyS);
    if (shipDist < a.radius + ORBITAL_COLLISION_RADIUS) {
      const mag = Math.max(1, shipDist);
      const nx = dxS / mag;
      const ny = dyS / mag;
      const vRel = (space.shipVx - a.vx) * nx + (space.shipVy - a.vy) * ny;
      if (vRel < 0) {
        if (-vRel > 0.2) {
          damageRandomPart(sub.parts, ASTEROID_COLLISION_DMG * (-vRel));
          SFX.damage();
          addExplosion(a.x, a.y, 'small');
          world.caveMessage = { text: 'ASTEROID IMPACT', timer: 80 };
        }
        space.shipVx -= vRel * nx;
        space.shipVy -= vRel * ny;
      }
      const overlap = a.radius + ORBITAL_COLLISION_RADIUS - shipDist;
      space.shipX += nx * overlap;
      space.shipY += ny * overlap;
    }

    next.push(a);
  }
  space.asteroids = next;
}

// updateOrbitMode is large — copy it verbatim from app_gossamer.js starting at
// "function updateOrbitMode(dt) {" through its closing "}" just before
// "// ============================================================\n// UPDATE"
// (approximately lines 3897–4163 in the pre-extraction app_gossamer.js).
// The function body is unchanged; only its location moves.
function updateOrbitMode(dt) {
  // ── PASTE THE FULL BODY OF updateOrbitMode FROM app_gossamer.js HERE ──
  // Do not modify it — just move it verbatim.
  // It ends with:
  //   sub.facing = Math.cos(space.shipAngle) >= 0 ? 1 : -1;
  //   updateTelemetry(dt, space.shipVx, space.shipVy, 'orbit');
  // }
}

// ── Draw functions (new — restored after hud.js extraction dropped them) ────

function drawComets(space) {
  for (const c of space.comets) {
    // Glowing trail (oldest = transparent, newest = bright)
    for (let i = 0; i < c.trail.length; i++) {
      const p = c.trail[i];
      ctx.globalAlpha = (i / c.trail.length) * 0.55;
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.5, 0, TWO_PI);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // Body with halo glow
    const pos = cometPosition(c, space.time);
    const grad = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, c.radius * 3);
    grad.addColorStop(0, 'rgba(125,211,252,0.85)');
    grad.addColorStop(1, 'rgba(56,189,248,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, c.radius * 3, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = '#e0f2fe';
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, c.radius, 0, TWO_PI);
    ctx.fill();
  }
}

function drawDebrisClouds(space) {
  for (const c of space.debrisClouds) {
    if (c.collected) continue;
    ctx.save();
    ctx.translate(c.x, c.y);
    for (const p of c.particles) {
      ctx.globalAlpha = 0.4 + Math.sin(p.dx * p.dy) * 0.2; // cheap shimmer, no RNG in draw
      ctx.fillStyle = '#64748b';
      ctx.beginPath();
      ctx.arc(p.dx, p.dy, p.r, 0, TWO_PI);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // Resource type label
    ctx.fillStyle = c.type === 'hull' ? '#22d3ee' : '#fbbf24';
    ctx.font = '9px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(c.type === 'hull' ? '⬡ HULL' : '⬡ AMMO', 0, -c.radius - 4);
    ctx.restore();
  }
}

function drawOrbitalProjectiles(space) {
  for (const p of space.projectiles) {
    const isTorpedo = p.type === 'torpedo';
    // Glow halo
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = isTorpedo ? '#22d3ee' : '#f97316';
    ctx.beginPath();
    ctx.arc(p.x, p.y, isTorpedo ? 8 : 10, 0, TWO_PI);
    ctx.fill();
    // Solid body
    ctx.globalAlpha = 1;
    ctx.fillStyle = isTorpedo ? '#7dd3fc' : '#fdba74';
    ctx.beginPath();
    ctx.arc(p.x, p.y, isTorpedo ? 3 : 4, 0, TWO_PI);
    ctx.fill();
  }
}

function drawAsteroids(space) {
  for (const a of space.asteroids) {
    ctx.save();
    ctx.translate(a.x, a.y);
    ctx.fillStyle = a.color;
    ctx.beginPath();
    const sides = 6 + Math.floor(a.radius / 4);
    for (let i = 0; i < sides; i++) {
      const ang = (i / sides) * Math.PI * 2;
      const r   = a.radius * (0.75 + 0.25 * Math.sin(ang * 3 + a.id));
      i === 0 ? ctx.moveTo(Math.cos(ang) * r, Math.sin(ang) * r)
              : ctx.lineTo(Math.cos(ang) * r, Math.sin(ang) * r);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
```

**Important:** The `updateOrbitMode` body above has a placeholder comment. You must paste the verbatim function body from `app_gossamer.js` (grep: `function updateOrbitMode`; it runs from that line to the `}` just before `// ============================================================\n// UPDATE`). Do not rewrite or summarise it.

- [ ] **Step 2: Verify orbital.js has no syntax errors**

```bash
node --check gossamer/orbital.js 2>&1
```

Expected: no output (clean parse).

- [ ] **Step 3: Commit orbital.js (duplicated in both files — safe state)**

```bash
git add gossamer/orbital.js
git commit -m "feat: create orbital.js — constants, solar helpers, hazards, orbit mode, draw functions"
```

---

### Task 6: Update `hud.js` `drawOrbitScene` to call orbital draw functions

**Files:**
- Modify: `gossamer/hud.js`

The orbital hazards (asteroids, comets, debris clouds, orbital projectiles) are updated in orbital.js but never drawn. They must be drawn inside the camera transform in `drawOrbitScene`, which is in hud.js.

- [ ] **Step 1: Add the four draw calls inside the camera transform**

In `gossamer/hud.js`, find `drawOrbitScene()`. Inside it, find:

```javascript
  ctx.restore(); // End camera transform
```

Insert the four calls immediately before that line:

```javascript
  drawComets(space);
  drawDebrisClouds(space);
  drawOrbitalProjectiles(space);
  drawAsteroids(space);
  ctx.restore(); // End camera transform
```

- [ ] **Step 2: Update the `/* global */` comment in hud.js**

Find the `/* global ... */` comment at the top of `hud.js` and add the new names it now calls:

```javascript
/* global world, ctx, W, H, WATER_LINE, SUB_PARTS, MISSION_TYPES,
   COMMANDER_HP, COMMANDER_MAX_HP, SPEEDOMETER_MAX_MPH, ACCELEROMETER_MAX_G,
   MPH_PER_GAME_SPEED, SPACE_MPH_PER_GAME_SPEED, AFTERBURNER_MAX_CHARGE,
   SOLAR_SYSTEM_BODIES, SOLAR_SYSTEM_BOUNDARY, PLANETS, SUN_DESTINATION,
   ORBIT_TRIGGER_SPEED_MPH, EJECT_PRIME_TIMEOUT, THERMAL_TEMPS, THERMAL_LABELS,
   AFTERBURNER_COLOR, TWO_PI,
   SFX, toScreen, velocityToMph, overallHealth, clamp, componentConditionLabel,
   componentConditionColor, commanderStatusLabel, getThermalLayer,
   loadLeaderboard, saveLeaderboard, loadSettings, saveSettings,
   currentSubSkin, resolveSubSkin, cycleSubSkin, adjustCustomHue,
   getSupplyFrequency, cycleSupplyFrequency, loadKeybinds, saveKeybinds,
   resetKeybinds, keyLabel, keyJustPressed, stripedGradient,
   solarBodyPosition, getSolarBodies,
   drawComets, drawDebrisClouds, drawOrbitalProjectiles, drawAsteroids,
   cometPosition */
```

- [ ] **Step 3: Commit**

```bash
git add gossamer/hud.js
git commit -m "feat: drawOrbitScene calls drawComets/Debris/Projectiles/Asteroids (restored after merge)"
```

---

### Task 7: Remove orbital code from `app_gossamer.js`

**Files:**
- Modify: `gossamer/app_gossamer.js`

Delete everything that is now authoritative in orbital.js. The deletions are in two clusters: constants near the top of the file and functions in the middle.

- [ ] **Step 1: Delete orbital constants**

Find and delete these lines (approximately lines 240–260):

```javascript
const SPACE_CAMERA_SMOOTH        = 0.06;
const SPACE_TIME_SCALE           = 0.22;
const ORBITAL_TURN_RATE          = 0.025;
const ORBITAL_THRUST             = 0.004;
const ORBITAL_RETRO_THRUST       = 0.003;
const ORBITAL_AFTERBURNER_THRUST = 0.010;
const ORBITAL_COLLISION_RADIUS   = 12;

// --- Drifting Hazards ---
const ASTEROID_COUNT         = 60;
const ASTEROID_BELT_MIN      = 615;   // inner edge (Mars orbit radius)
const ASTEROID_BELT_MAX      = 780;   // outer edge (Jupiter orbit radius)
const ASTEROID_COLLISION_DMG = 8;     // base damage per unit of closing speed
const DEBRIS_CLOUD_COUNT     = 4;
const DEBRIS_PARTICLES       = 20;    // particles per cloud
const DEBRIS_COLLECT_SPEED   = 0.4;   // max ship speed to collect resources
const COMET_COUNT            = 2;
const ORB_PROJ_TORPEDO_SPEED = 1.5;
const ORB_PROJ_MISSILE_SPEED = 0.8;
const ORB_PROJ_TORPEDO_LIFE  = 300;
const ORB_PROJ_MISSILE_LIFE  = 600;
```

- [ ] **Step 2: Delete solar helpers and all orbital functions**

Delete the following functions (each in their entirety):
- `solarBodyPosition` (~line 1848)
- `getSolarBodies` (~line 1866)
- `nearestSolarBody` (~line 1870)
- `initComets` (~line 1884)
- `cometPosition` (~line 1891)
- `initDebrisClouds` (~line 1903)
- `initAsteroids` (~line 1926)
- `createOrbitState` (~line 1947)
- `enterOrbitMode` (~line 1991)
- `updateComets` (~line 3707)
- `updateDebrisClouds` (~line 3731)
- `damageAsteroid` (~line 3773)
- `fireOrbitalProjectile` (~line 3798)
- `updateOrbitalProjectiles` (~line 3812)
- `updateAsteroids` (~line 3847)
- `updateOrbitMode` (~line 3897)

- [ ] **Step 3: Verify none of the deleted function names remain as definitions**

```bash
grep -n "^function solarBodyPosition\|^function getSolarBodies\|^function nearestSolarBody\|^function initComets\|^function cometPosition\|^function initDebrisClouds\|^function initAsteroids\|^function createOrbitState\|^function enterOrbitMode\|^function updateComets\|^function updateDebrisClouds\|^function damageAsteroid\|^function fireOrbitalProjectile\|^function updateOrbitalProjectiles\|^function updateAsteroids\|^function updateOrbitMode\|^const ORBITAL_TURN_RATE\|^const ASTEROID_COUNT" gossamer/app_gossamer.js
```

Expected: no matches.

- [ ] **Step 4: Commit**

```bash
git add gossamer/app_gossamer.js
git commit -m "refactor: remove orbital constants and functions moved to orbital.js"
```

---

### Task 8: Update `index_gossamer.html` and `test/_extract.js` for orbital

**Files:**
- Modify: `gossamer/index_gossamer.html`
- Modify: `test/_extract.js`

- [ ] **Step 1: Add `orbital.js` script tag to `index_gossamer.html`**

The load order must be `orbital.js` before `app_gossamer.js`:

```html
<script src="sfx.js?v=2"></script>
<script src="verisimdb.js?v=2"></script>
<script src="enemies.js?v=2"></script>
<script src="hud.js?v=2"></script>
<script src="weapons.js?v=2"></script>
<script src="orbital.js?v=2"></script>
<script src="app_gossamer.js?v=2"></script>
```

- [ ] **Step 2: Update `test/_extract.js` to include orbital.js**

The SRC concatenation added in Task 4 currently reads:

```javascript
const SRC = [
  await Deno.readTextFile(ROOT + 'gossamer/app_gossamer.js'),
  await Deno.readTextFile(ROOT + 'gossamer/weapons.js'),
].join('\n');
```

Add `orbital.js`:

```javascript
const SRC = [
  await Deno.readTextFile(ROOT + 'gossamer/app_gossamer.js'),
  await Deno.readTextFile(ROOT + 'gossamer/weapons.js'),
  await Deno.readTextFile(ROOT + 'gossamer/orbital.js'),
].join('\n');
```

- [ ] **Step 3: Run full test suite — everything must still pass**

```bash
deno test test/unit_test.js test/integration_test.js --allow-read 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 4: Final line-count check — confirm reduction**

```bash
wc -l gossamer/app_gossamer.js gossamer/weapons.js gossamer/orbital.js gossamer/hud.js
```

Expected: `app_gossamer.js` well under 7,500 lines (was ~8,000); `weapons.js` ~180 lines; `orbital.js` ~350 lines.

- [ ] **Step 5: Commit**

```bash
git add gossamer/index_gossamer.html test/_extract.js
git commit -m "chore: load orbital.js; extend _extract.js to read all three source files"
```

---

## Self-Review

**Spec coverage:**

| Requirement | Covered by |
|---|---|
| `weapons.js` with depth-charge constants | Task 1 |
| `weapons.js` with `canFireTorpedo`, `detonateDepthCharge`, `updateDepthCharges`, `updateProjectiles` | Task 1 |
| `drawDepthCharges`, `drawTorpedoes`, `drawMissiles` new draw functions | Task 1 |
| `draw()` updated to call weapon draw functions | Task 2 |
| Weapon code deleted from `app_gossamer.js` | Task 3 |
| `index_gossamer.html` + `_extract.js` updated for weapons | Task 4 |
| `orbital.js` with all orbital constants, solar helpers, hazard init/update | Task 5 |
| Four new draw functions restored in `orbital.js` | Task 5 |
| `hud.js` `drawOrbitScene` calls the four draw functions | Task 6 |
| Orbital code deleted from `app_gossamer.js` | Task 7 |
| `index_gossamer.html` + `_extract.js` updated for orbital | Task 8 |

**Placeholder scan:** Task 5 Step 1 contains a placeholder in `updateOrbitMode`. The implementer must paste the verbatim function body — this is intentional (the body is ~250 lines, duplicating it in the plan adds no value and risks transcription errors; grep for `function updateOrbitMode` in `app_gossamer.js` to find it).

**Type consistency:** All four draw function names (`drawComets`, `drawDebrisClouds`, `drawOrbitalProjectiles`, `drawAsteroids`) are consistent between their definition in `orbital.js` (Task 5) and their call sites in `hud.js` (Task 6).
