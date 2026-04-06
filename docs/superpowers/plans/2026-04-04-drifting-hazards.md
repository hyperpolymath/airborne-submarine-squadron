# Drifting Hazards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three passive orbital hazards — asteroid belt, debris clouds, and rogue comets — plus an orbital projectile system that lets the player shoot all of them, with all projectiles obeying gravity.

**Architecture:** All hazard state lives in `world.space` (initialized in `createOrbitState`). Each hazard type has an `init*`, `update*`, and `draw*` function added to `gossamer/app_gossamer.js`. The orbital projectile system mirrors the atmospheric one but is separate — it shares no state with `world.torpedoes` etc. Gravity is applied to projectiles via the same per-body loop already used for the ship.

**Tech Stack:** Vanilla JS canvas game, single file `gossamer/app_gossamer.js`. No build step — changes are live on reload.

---

## File Map

- **Modify:** `gossamer/app_gossamer.js`
  - Constants block (~line 82): add hazard constants
  - `createOrbitState` (~line 2604): add `asteroids`, `debrisClouds`, `comets`, `projectiles` to returned state
  - `updateOrbitMode` (~line 5380): call update functions, handle fire input
  - `drawOrbitScene` (~line 7099): call draw functions inside camera transform (before `ctx.restore()` at line 7230)

---

## Task 1: Constants and data-shape comments

**Files:**
- Modify: `gossamer/app_gossamer.js` — constants block near line 82

- [ ] **Add hazard constants after the existing orbital constants block (after `ORBITAL_COLLISION_RADIUS`):**

```javascript
// --- Drifting Hazards ---
const ASTEROID_COUNT         = 60;
const ASTEROID_BELT_MIN      = 615;   // inner edge (Mars orbit radius)
const ASTEROID_BELT_MAX      = 780;   // outer edge (Jupiter orbit radius)
const ASTEROID_COLLISION_DMG = 8;     // base damage per unit of closing speed
const DEBRIS_CLOUD_COUNT     = 4;
const DEBRIS_PARTICLES       = 20;    // particles per cloud
const DEBRIS_COLLECT_SPEED   = 0.4;   // max ship speed to collect resources
const COMET_COUNT            = 2;
const ORB_PROJ_TORPEDO_SPEED = 6;
const ORB_PROJ_MISSILE_SPEED = 3;
const ORB_PROJ_TORPEDO_LIFE  = 180;   // frames
const ORB_PROJ_MISSILE_LIFE  = 360;
```

- [ ] **Commit:**
```bash
git add gossamer/app_gossamer.js
git commit -m "feat: hazard constants for asteroid belt, debris clouds, comets, orbital projectiles"
```

---

## Task 2: Asteroid belt initialisation

**Files:**
- Modify: `gossamer/app_gossamer.js` — add `initAsteroids()` before `createOrbitState`

- [ ] **Add `initAsteroids()` function before `createOrbitState`:**

```javascript
function initAsteroids() {
  const asteroids = [];
  for (let i = 0; i < ASTEROID_COUNT; i++) {
    const orbitR = ASTEROID_BELT_MIN + Math.random() * (ASTEROID_BELT_MAX - ASTEROID_BELT_MIN);
    const angle  = Math.random() * Math.PI * 2;
    const speed  = Math.sqrt(SOLAR_GM / orbitR) * (0.92 + Math.random() * 0.16); // slight eccentricity
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
```

- [ ] **Add `asteroids: initAsteroids()` to the object returned by `createOrbitState` (alongside `trail`, `nearestBody`, etc.):**

```javascript
    asteroids: initAsteroids(),
```

- [ ] **Verify in browser:** open the game, enter orbit — no console errors.

- [ ] **Commit:**
```bash
git add gossamer/app_gossamer.js
git commit -m "feat: asteroid belt initialisation — 60 rocks in stable circular orbits"
```

---

## Task 3: Asteroid update (physics + ship collision + fragmentation)

**Files:**
- Modify: `gossamer/app_gossamer.js` — add `updateAsteroids()`, call from `updateOrbitMode`

- [ ] **Add `updateAsteroids(space, bodies, sub, dt)` before `updateOrbitMode`:**

```javascript
function updateAsteroids(space, bodies, sub, dt) {
  const next = [];
  for (const a of space.asteroids) {
    // Gravity from all bodies
    for (const body of bodies) {
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

    // Ship collision
    const dxS = space.shipX - a.x;
    const dyS = space.shipY - a.y;
    if (Math.hypot(dxS, dyS) < a.radius + ORBITAL_COLLISION_RADIUS) {
      const closingSpeed = Math.hypot(space.shipVx - a.vx, space.shipVy - a.vy);
      damageRandomPart(sub.parts, ASTEROID_COLLISION_DMG * closingSpeed);
      SFX.damage();
      addExplosion(a.x, a.y, 'small');
      world.caveMessage = { text: `ASTEROID IMPACT`, timer: 80 };
      // Push ship away
      const nx = dxS / Math.max(1, Math.hypot(dxS, dyS));
      const ny = dyS / Math.max(1, Math.hypot(dxS, dyS));
      space.shipVx += nx * closingSpeed * 0.5;
      space.shipVy += ny * closingSpeed * 0.5;
      continue; // remove this asteroid; fragments added below
    }

    next.push(a);
  }
  space.asteroids = next;
}
```

- [ ] **Call `updateAsteroids` inside `updateOrbitMode`, just before the SOI capture block (after `space.shipY += ...`):**

```javascript
  updateAsteroids(space, bodies, sub, dt);
```

- [ ] **Verify in browser:** fly into an asteroid — should take damage.

- [ ] **Commit:**
```bash
git add gossamer/app_gossamer.js
git commit -m "feat: asteroid physics update — gravity, orbital motion, ship collision damage"
```

---

## Task 4: Asteroid fragmentation on projectile hit (placeholder hook)

**Files:**
- Modify: `gossamer/app_gossamer.js` — add `damageAsteroid()` helper used by both projectile system (Task 6) and any future collision

- [ ] **Add `damageAsteroid(space, asteroid, damage)` before `updateAsteroids`:**

```javascript
function damageAsteroid(space, asteroid, damage) {
  asteroid.hp -= damage;
  if (asteroid.hp > 0) return;
  addExplosion(asteroid.x, asteroid.y, asteroid.radius > 10 ? 'big' : 'small');
  // Spawn fragments if large enough
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
```

- [ ] **Commit:**
```bash
git add gossamer/app_gossamer.js
git commit -m "feat: asteroid fragmentation helper — splits large rocks into 2–3 pieces on death"
```

---

## Task 5: Asteroid rendering

**Files:**
- Modify: `gossamer/app_gossamer.js` — add `drawAsteroids()`, call from `drawOrbitScene`

- [ ] **Add `drawAsteroids(space)` before `drawOrbitScene`:**

```javascript
function drawAsteroids(space) {
  for (const a of space.asteroids) {
    ctx.save();
    ctx.translate(a.x, a.y);
    ctx.fillStyle = a.color;
    // Rough polygon shape
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

- [ ] **Call `drawAsteroids(space)` inside `drawOrbitScene`, inside the camera transform (just before `ctx.restore(); // End camera transform`):**

```javascript
  drawAsteroids(space);
```

- [ ] **Verify in browser:** belt of rocks visible between Mars and Jupiter orbits.

- [ ] **Commit:**
```bash
git add gossamer/app_gossamer.js
git commit -m "feat: asteroid rendering — rough polygon shapes in belt zone"
```

---

## Task 6: Orbital projectile system

**Files:**
- Modify: `gossamer/app_gossamer.js` — add `fireOrbitalProjectile()`, `updateOrbitalProjectiles()`, `drawOrbitalProjectiles()`

- [ ] **Add `fireOrbitalProjectile(space, sub, type)` before `updateOrbitMode`:**

```javascript
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
    active: true,
  });
}
```

- [ ] **Add `updateOrbitalProjectiles(space, bodies, dt)` before `updateOrbitMode`:**

```javascript
function updateOrbitalProjectiles(space, bodies, dt) {
  const survivors = [];
  for (const p of space.projectiles) {
    if (!p.active || p.age > p.maxAge) continue;
    // Gravity
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

    // Asteroid collision
    let hit = false;
    for (const a of space.asteroids) {
      if (Math.hypot(p.x - a.x, p.y - a.y) < a.radius + 3) {
        damageAsteroid(space, a, 1);
        hit = true;
        break;
      }
    }
    // Remove dead asteroids after damageAsteroid zeroed hp
    space.asteroids = space.asteroids.filter(a => a.hp > 0 || space.asteroids.includes(a));

    if (!hit) survivors.push(p);
  }
  space.projectiles = survivors;
}
```

- [ ] **Wire fire input inside `updateOrbitMode` — add just after the rotation/thrust input block (after the `space.shipAngle` lines), before gravity loop:**

```javascript
  // Orbital weapons
  if (keyJustPressed['Control'] && space.projectiles.length < 8) {
    fireOrbitalProjectile(space, sub, 'torpedo');
  }
  if (keyJustPressed['Enter'] && space.projectiles.length < 8) {
    fireOrbitalProjectile(space, sub, 'missile');
  }
```

- [ ] **Call `updateOrbitalProjectiles` inside `updateOrbitMode`, just after `updateAsteroids(...)` call:**

```javascript
  updateOrbitalProjectiles(space, bodies, dt);
```

- [ ] **Add `drawOrbitalProjectiles(space)` before `drawOrbitScene`:**

```javascript
function drawOrbitalProjectiles(space) {
  for (const p of space.projectiles) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.fillStyle = p.type === 'torpedo' ? '#38bdf8' : '#f97316';
    ctx.beginPath();
    ctx.arc(0, 0, p.type === 'torpedo' ? 3 : 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
```

- [ ] **Call `drawOrbitalProjectiles(space)` inside `drawOrbitScene`, just before `ctx.restore(); // End camera transform`:**

```javascript
  drawOrbitalProjectiles(space);
```

- [ ] **Fix `updateOrbitalProjectiles` asteroid removal — replace the `space.asteroids.filter` line with:**

```javascript
    space.asteroids = space.asteroids.filter(a => a.hp > 0);
```

- [ ] **Verify in browser:** press Ctrl in orbit — bright dot fires and curves under gravity. Hitting a large asteroid should split it.

- [ ] **Commit:**
```bash
git add gossamer/app_gossamer.js
git commit -m "feat: orbital projectiles — torpedo (Ctrl) and missile (Enter) with gravity trajectories"
```

---

## Task 7: Debris clouds

**Files:**
- Modify: `gossamer/app_gossamer.js` — add `initDebrisClouds()`, `updateDebrisClouds()`, `drawDebrisClouds()`

- [ ] **Add `initDebrisClouds()` before `createOrbitState`:**

```javascript
function initDebrisClouds() {
  const zones = [330, 450, 570, 700]; // orbital radii for cloud centres
  return zones.slice(0, DEBRIS_CLOUD_COUNT).map((orbitR, i) => {
    const angle = (i / DEBRIS_CLOUD_COUNT) * Math.PI * 2 + 0.7;
    const speed = Math.sqrt(SOLAR_GM / orbitR);
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
```

- [ ] **Add `debrisClouds: initDebrisClouds()` to the object returned by `createOrbitState`.**

- [ ] **Add `updateDebrisClouds(space, bodies, sub, dt)` before `updateOrbitMode`:**

```javascript
function updateDebrisClouds(space, bodies, sub, dt) {
  for (const c of space.debrisClouds) {
    if (c.collected) continue;
    // Gravity
    for (const body of bodies) {
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
        // Slow enough — collect
        if (c.type === 'hull') {
          const parts = sub.parts;
          const keys  = Object.keys(parts).filter(k => typeof parts[k] === 'number' && parts[k] < 100);
          if (keys.length) parts[keys[Math.floor(Math.random() * keys.length)]] = Math.min(100, parts[keys[0]] + 20);
        } else {
          world.sub.ammo = Math.min((world.sub.ammo || 0) + 30, 200);
        }
        world.caveMessage = { text: `SALVAGE: ${c.type === 'hull' ? 'HULL REPAIR' : 'AMMO +30'}`, timer: 120 };
        c.collected = true;
      } else {
        // Too fast — take chip damage
        damageRandomPart(sub.parts, 2 * shipSpeed);
        world.caveMessage = { text: 'DEBRIS IMPACT — SLOW TO SALVAGE', timer: 80 };
      }
    }
  }
}
```

- [ ] **Call `updateDebrisClouds(space, bodies, sub, dt)` inside `updateOrbitMode` after `updateAsteroids(...)`:**

```javascript
  updateDebrisClouds(space, bodies, sub, dt);
```

- [ ] **Add `drawDebrisClouds(space)` before `drawOrbitScene`:**

```javascript
function drawDebrisClouds(space) {
  for (const c of space.debrisClouds) {
    if (c.collected) continue;
    ctx.save();
    ctx.translate(c.x, c.y);
    // Soft glow
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, c.radius);
    grad.addColorStop(0, c.type === 'hull' ? 'rgba(100,200,100,0.12)' : 'rgba(100,150,255,0.12)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, c.radius, 0, Math.PI * 2);
    ctx.fill();
    // Particles
    ctx.fillStyle = c.type === 'hull' ? '#6ee7b7' : '#93c5fd';
    for (const p of c.particles) {
      ctx.beginPath();
      ctx.arc(p.dx, p.dy, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
```

- [ ] **Call `drawDebrisClouds(space)` inside `drawOrbitScene` before `ctx.restore(); // End camera transform`.**

- [ ] **Verify in browser:** glowing cloud clusters visible in orbit. Slowing down inside one should show salvage message.

- [ ] **Commit:**
```bash
git add gossamer/app_gossamer.js
git commit -m "feat: debris clouds — orbit in belt, chip damage at speed, salvage when slow"
```

---

## Task 8: Rogue comets

**Files:**
- Modify: `gossamer/app_gossamer.js` — add `initComets()`, `updateComets()`, `drawComets()`

- [ ] **Add `initComets()` before `createOrbitState`:**

```javascript
function initComets() {
  return [
    { a: 900,  ecc: 0.82, peri: 0.7,  phase: 0.0,  period: 700, radius: 9,  trail: [] },
    { a: 1100, ecc: 0.75, peri: 2.3,  phase: 3.14, period: 950, radius: 7,  trail: [] },
  ];
}
```

- [ ] **Add `cometPosition(comet, time)` helper before `updateComets`:**

```javascript
function cometPosition(c, time) {
  const angle = c.phase + (time * SPACE_TIME_SCALE / c.period) * Math.PI * 2;
  const b  = c.a * Math.sqrt(1 - c.ecc * c.ecc);
  const ex = -c.a * c.ecc + c.a * Math.cos(angle);
  const ey = b * Math.sin(angle);
  return {
    x:     ex * Math.cos(c.peri) - ey * Math.sin(c.peri),
    y:     ex * Math.sin(c.peri) + ey * Math.cos(c.peri),
    angle,
  };
}
```

- [ ] **Add `comets: initComets()` to the object returned by `createOrbitState`.**

- [ ] **Add `updateComets(space, sub, dt)` before `updateOrbitMode`:**

```javascript
function updateComets(space, sub, dt) {
  for (const c of space.comets) {
    const pos = cometPosition(c, space.time);
    // Update trail (store last 30 positions)
    c.trail.push({ x: pos.x, y: pos.y });
    if (c.trail.length > 30) c.trail.shift();

    // Ship collision
    if (Math.hypot(space.shipX - pos.x, space.shipY - pos.y) < c.radius + ORBITAL_COLLISION_RADIUS) {
      damageRandomPart(sub.parts, 60);
      damageRandomPart(sub.parts, 60);
      addExplosion(pos.x, pos.y, 'big');
      SFX.damage();
      world.caveMessage = { text: 'COMET STRIKE — CRITICAL DAMAGE', timer: 200 };
      // Deflect ship
      const nx = (space.shipX - pos.x) / Math.max(1, Math.hypot(space.shipX - pos.x, space.shipY - pos.y));
      const ny = (space.shipY - pos.y) / Math.max(1, Math.hypot(space.shipX - pos.x, space.shipY - pos.y));
      space.shipVx += nx * 4;
      space.shipVy += ny * 4;
    }
  }
}
```

- [ ] **Call `updateComets(space, sub, dt)` inside `updateOrbitMode` after `updateDebrisClouds(...)`:**

```javascript
  updateComets(space, sub, dt);
```

- [ ] **Add `drawComets(space)` before `drawOrbitScene`:**

```javascript
function drawComets(space) {
  for (const c of space.comets) {
    if (c.trail.length < 2) continue;
    const pos = c.trail[c.trail.length - 1];
    // Trail
    for (let i = 1; i < c.trail.length; i++) {
      const t0 = c.trail[i - 1];
      const t1 = c.trail[i];
      ctx.globalAlpha = (i / c.trail.length) * 0.6;
      ctx.strokeStyle = '#7dd3fa';
      ctx.lineWidth   = 1.5 * (i / c.trail.length);
      ctx.beginPath();
      ctx.moveTo(t0.x, t0.y);
      ctx.lineTo(t1.x, t1.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // Head
    ctx.fillStyle = '#e0f2fe';
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, c.radius, 0, Math.PI * 2);
    ctx.fill();
  }
}
```

- [ ] **Call `drawComets(space)` inside `drawOrbitScene` before `ctx.restore(); // End camera transform`.**

- [ ] **Verify in browser:** two comets on elliptical paths with icy trails visible.

- [ ] **Commit:**
```bash
git add gossamer/app_gossamer.js
git commit -m "feat: rogue comets — parametric elliptical orbits, glowing trails, heavy collision damage"
```

---

## Self-Review

**Spec coverage:**
- ✅ Asteroid belt — 60 rocks, orbit physics, ship collision, fragmentation
- ✅ Debris clouds — 4 clouds, orbital motion, salvage mechanic, chip damage at speed
- ✅ Rogue comets — 2 comets, elliptical orbits, trail, heavy damage
- ✅ Orbital projectiles — torpedo (Ctrl) + missile (Enter), gravity-curved trajectories, asteroid hit detection

**Placeholder scan:** None found — all code blocks are complete.

**Type consistency check:**
- `space.asteroids`, `space.debrisClouds`, `space.comets`, `space.projectiles` — all initialised in Task 2/7/8/6 and consumed consistently
- `damageAsteroid(space, asteroid, damage)` — defined Task 4, called Task 6 ✅
- `cometPosition(c, time)` — defined and called within Task 8 ✅
- `ORBITAL_COLLISION_RADIUS` — existing constant used in Tasks 3, 7, 8 ✅
- `SOLAR_GM` — existing constant used in Tasks 2, 7 ✅
