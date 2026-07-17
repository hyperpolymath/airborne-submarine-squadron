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

function updateOrbitMode(dt) {
  const sub = world.sub;
  const space = world.space;
  space.time += dt;

  const bodies = getSolarBodies(space.time);
  if (world.tick % 2 === 0) {
    space.trail.push({ x: space.shipX, y: space.shipY, age: 0 });
    if (space.trail.length > 120) space.trail.shift();
  }
  space.trail.forEach((point) => { point.age += dt; });

  // Autopilot: number keys set course toward a body
  // 0=Sun, 1=Mercury, 2=Venus, 3=Earth, 4=Mars, 5=Jupiter, 6=Saturn, 7=Uranus, 8=Neptune, 9=Pluto
  for (let k = 0; k <= 9; k++) {
    if (keyJustPressed[String(k)] && !world.paused && !world.menuOpen && k < SOLAR_SYSTEM_BODIES.length) {
      space.autopilotTarget = SOLAR_SYSTEM_BODIES[k].id;
      world.caveMessage = { text: `COURSE SET: ${SOLAR_SYSTEM_BODIES[k].label.toUpperCase()}`, timer: 80 };
    }
  }

  // Manual steering cancels autopilot
  if (keys['ArrowLeft'] || keys['ArrowRight']) {
    if (space.autopilotTarget) {
      space.autopilotTarget = null;
      world.caveMessage = { text: 'AUTOPILOT DISENGAGED', timer: 50 };
    }
  }

  if (space.autopilotTarget) {
    // Autopilot: rotate toward target body
    const targetBody = bodies.find((b) => b.id === space.autopilotTarget);
    if (targetBody) {
      const targetAngle = Math.atan2(targetBody.y - space.shipY, targetBody.x - space.shipX);
      // Smooth rotation toward target
      let angleDiff = targetAngle - space.shipAngle;
      // Normalise to [-PI, PI]
      while (angleDiff > Math.PI) angleDiff -= TWO_PI;
      while (angleDiff < -Math.PI) angleDiff += TWO_PI;
      space.shipAngle += angleDiff * 0.04 * dt;
    }
  } else {
    // Manual steering
    if (keys['ArrowLeft']) space.shipAngle -= ORBITAL_TURN_RATE * dt * 4;
    if (keys['ArrowRight']) space.shipAngle += ORBITAL_TURN_RATE * dt * 4;
  }

  // Thrust/retro always work (speed control even in autopilot)
  let thrust = 0;
  if (keys['ArrowUp']) thrust += ORBITAL_THRUST;
  if (keys['ArrowDown']) thrust -= ORBITAL_RETRO_THRUST;

  // No afterburners in space — only available in atmosphere
  sub.afterburnerActive = false;
  sub.afterburnerCharge = Math.min(AFTERBURNER_MAX_CHARGE, sub.afterburnerCharge + AFTERBURNER_RECHARGE * dt);

  if (thrust !== 0) {
    space.shipVx += Math.cos(space.shipAngle) * thrust * dt * 4;
    space.shipVy += Math.sin(space.shipAngle) * thrust * dt * 4;
  }

  // Orbital weapons
  if (keyJustPressed['Control'] && space.projectiles.length < 8) {
    fireOrbitalProjectile(space, sub, 'torpedo');
  }
  if (keyJustPressed['Enter'] && space.projectiles.length < 8) {
    fireOrbitalProjectile(space, sub, 'missile');
  }

  // Left Shift: stabiliser / full stop in orbit
  if (keys['Shift'] || keys[keybinds.stabilise]) {
    space.shipVx *= Math.pow(0.85, dt);
    space.shipVy *= Math.pow(0.85, dt);
    if (Math.hypot(space.shipVx, space.shipVy) < 0.01) {
      space.shipVx = 0;
      space.shipVy = 0;
    }
  }

  // Solar proximity — exponential heat damage and surface collision
  const distFromSun = Math.hypot(space.shipX, space.shipY);
  const sunBody = SOLAR_SYSTEM_BODIES[0]; // Sun is always index 0
  if (distFromSun < sunBody.radius * 8) {
    const heatDamage = 0.8 * Math.pow(sunBody.radius / Math.max(distFromSun, sunBody.radius), 4) * dt;
    damageRandomPart(sub.parts, heatDamage);
    if (world.tick % 60 === 0) {
      const intensity = distFromSun < sunBody.radius * 2 ? 'CRITICAL' : distFromSun < sunBody.radius * 4 ? 'EXTREME' : 'HIGH';
      world.caveMessage = { text: `SOLAR HEAT: ${intensity}`, timer: 80 };
    }
  }
  if (distFromSun < sunBody.radius + ORBITAL_COLLISION_RADIUS) {
    // Hit the Sun — game over
    addExplosion(space.shipX, space.shipY, 'big');
    world.caveMessage = { text: 'SOLAR IMPACT — TOTAL LOSS', timer: 300 };
    world.gameOver = true;
    SFX.gameOver();
    ensureLeaderboardRecorded('SOLAR IMPACT');
  }

  // Boundary enforcement — cannot fly past Pluto's orbit
  if (distFromSun > SOLAR_SYSTEM_BOUNDARY) {
    // Push back toward centre
    const bAngle = Math.atan2(space.shipY, space.shipX);
    space.shipX = Math.cos(bAngle) * SOLAR_SYSTEM_BOUNDARY;
    space.shipY = Math.sin(bAngle) * SOLAR_SYSTEM_BOUNDARY;
    // Reflect velocity inward
    const dot = space.shipVx * Math.cos(bAngle) + space.shipVy * Math.sin(bAngle);
    if (dot > 0) {
      space.shipVx -= Math.cos(bAngle) * dot * 1.2;
      space.shipVy -= Math.sin(bAngle) * dot * 1.2;
    }
    if (world.tick % 60 < 2) {
      world.caveMessage = { text: 'BOUNDARY — CANNOT EXIT SOLAR SYSTEM', timer: 80 };
    }
  }

  // --- Space tourist ship ---
  const tourist = space.touristShip;
  if (tourist && tourist.visible) {
    if (tourist.dwellTimer > 0) {
      tourist.dwellTimer -= dt;
    } else {
      tourist.progress += tourist.speed * dt;
      if (tourist.progress >= 1) {
        // Arrived at destination — dwell, then pick new route
        tourist.progress = 0;
        tourist.dwellTimer = 200;
        tourist.fromPlanetIdx = tourist.toPlanetIdx;
        let next = tourist.fromPlanetIdx;
        while (next === tourist.fromPlanetIdx) next = Math.floor(Math.random() * (SOLAR_SYSTEM_BODIES.length - 1)) + 1;
        tourist.toPlanetIdx = next;
      }
      const fromBody = solarBodyPosition(SOLAR_SYSTEM_BODIES[tourist.fromPlanetIdx], space.time);
      const toBody = solarBodyPosition(SOLAR_SYSTEM_BODIES[tourist.toPlanetIdx], space.time);
      tourist.x = fromBody.x + (toBody.x - fromBody.x) * tourist.progress;
      tourist.y = fromBody.y + (toBody.y - fromBody.y) * tourist.progress;
    }

    // Collision with player sub
    if (Math.hypot(space.shipX - tourist.x, space.shipY - tourist.y) < 15) {
      // Crash into tourist ship
      damageRandomPart(sub.parts, 30);
      addExplosion(tourist.x, tourist.y, 'big');
      world.caveMessage = { text: 'COLLISION WITH TOURIST VESSEL — HULL DAMAGED', timer: 150 };
      SFX.damage();
      // Bounce off
      space.shipVx *= -0.5;
      space.shipVy *= -0.5;
    }
  }

  for (const body of bodies) {
    const dx = body.x - space.shipX;
    const dy = body.y - space.shipY;
    const distSq = Math.max(dx * dx + dy * dy, (body.radius + 6) ** 2);
    const dist = Math.sqrt(distSq);
    const accel = (body.gm || 0) / distSq;
    space.shipVx += (dx / dist) * accel * dt;
    space.shipVy += (dy / dist) * accel * dt;
  }

  space.shipX += space.shipVx * dt * 4;
  space.shipY += space.shipVy * dt * 4;
  updateAsteroids(space, bodies, sub, dt);
  updateDebrisClouds(space, bodies, sub, dt);
  updateComets(space, sub, dt);
  updateOrbitalProjectiles(space, bodies, dt);
  space.cameraX += (space.shipX - space.cameraX) * SPACE_CAMERA_SMOOTH * dt * 4;
  space.cameraY += (space.shipY - space.cameraY) * SPACE_CAMERA_SMOOTH * dt * 4;

  // SOI capture: find the body whose SOI the ship is most deeply inside (smallest dist/soi ratio)
  let capturedBody = null;
  let bestRatio = 1;
  for (const body of bodies) {
    if (!body.soi) continue;
    const dist = Math.hypot(space.shipX - body.x, space.shipY - body.y);
    const ratio = dist / body.soi;
    if (ratio < 1 && ratio < bestRatio) {
      bestRatio = ratio;
      capturedBody = body;
    }
  }
  const prevSOI = space.currentSOI;
  space.currentSOI = capturedBody;
  if (capturedBody && (!prevSOI || prevSOI.id !== capturedBody.id)) {
    world.caveMessage = { text: `SOI: ${capturedBody.label.toUpperCase()}`, timer: 120 };
  }

  // Camera zoom: 1× in open space, up to 4× at planet surface inside SOI
  let targetZoom = 1;
  if (space.currentSOI) {
    const dist = Math.hypot(space.shipX - space.currentSOI.x, space.shipY - space.currentSOI.y);
    const t = 1 - dist / space.currentSOI.soi; // 0 at SOI edge, 1 at centre
    targetZoom = 1 + t * t * 3;
  }
  space.cameraZoom += (targetZoom - space.cameraZoom) * 0.03 * dt * 4;

  const nearest = nearestSolarBody(space, bodies);
  space.nearestBody = nearest;
  if (nearest && nearest.distance < nearest.body.radius + ORBITAL_COLLISION_RADIUS) {
    const dx = space.shipX - nearest.body.x;
    const dy = space.shipY - nearest.body.y;
    const dist = Math.max(1, Math.hypot(dx, dy));
    const nx = dx / dist;
    const ny = dy / dist;
    // Radial approach speed (positive = moving toward planet)
    const impactSpeed = -(space.shipVx * nx + space.shipVy * ny);

    if (impactSpeed > 0.5) {
      // Too fast — crash
      damageRandomPart(sub.parts, 40);
      damageRandomPart(sub.parts, 40);
      addExplosion(space.shipX, space.shipY, 'big');
      world.caveMessage = { text: `IMPACT: ${nearest.body.label.toUpperCase()} — HULL CRITICAL`, timer: 180 };
      SFX.damage();
      // Push ship back to surface edge, zero approach velocity
      const edge = nearest.body.radius + ORBITAL_COLLISION_RADIUS + 2;
      space.shipX = nearest.body.x + nx * edge;
      space.shipY = nearest.body.y + ny * edge;
      const dot = space.shipVx * nx + space.shipVy * ny;
      if (dot < 0) {
        space.shipVx -= dot * nx;
        space.shipVy -= dot * ny;
      }
    } else {
      // Gentle approach — land on the planet using warp logic (bypasses atmospheric guard)
      world.lastSolarBodyId = nearest.body.id;
      const isSun = nearest.body.id === 'sun';
      let destination;
      if (isSun) {
        destination = SUN_DESTINATION;
      } else {
        world.currentPlanet = (world.currentPlanet + 1) % PLANETS.length;
        destination = PLANETS[world.currentPlanet];
      }
      world.planetPalette = destination;
      world.currentDestination = destination;
      world.caveMessage = { text: `LANDING: ${nearest.body.label.toUpperCase()} — ${destination.name.toUpperCase()}`, timer: 160 };
      world.terrain = generateTerrain(TERRAIN_LENGTH);
      const baseX = Math.random() * (TERRAIN_LENGTH - 200) + 100;
      world.sub.worldX = baseX;
      world.sub.y = -150;
      world.sub.vx = 0;
      world.sub.vy = 0;
      world.sub.angle = 0;
      world.sub.floating = false;
      world.sub.liftingOff = false;
      world.sub.wasInWater = false;
      world.sub.periscopeMode = false;
      world.sub.diverMode = false;
      world.cameraX = world.sub.worldX - W * 0.4;
      world.cameraY = -120;
      world.menuOpen = false;
      world.sunBurnTimer = isSun ? SUN_BURN_DURATION : 0;
      world.sunBurnTick  = isSun ? SUN_BURN_TICK  : 0;
      world.mode = 'flight';
    }
  }

  sub.worldX = space.shipX;
  sub.y = space.shipY;
  sub.vx = space.shipVx;
  sub.vy = space.shipVy;
  sub.angle = space.shipAngle;
  sub.facing = Math.cos(space.shipAngle) >= 0 ? 1 : -1;
  updateTelemetry(dt, space.shipVx, space.shipVy, 'orbit');
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
