// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Jonathan D.A. Jewell (hyperpolymath)
//
// enemies.js — All enemy type systems for Airborne Submarine Squadron.
// Extracted from app_gossamer.js for modular organisation.
// Loaded via <script> tag before app_gossamer.js.
//
// Contents:
//   - Sopwith Camel (passive biplane → Red Baron)
//   - Su-47 Berkut (air supremacy fighter)
//   - English Electric Lightning (interceptor squadrons)
//   - Nemesis mini-sub (rogue submarine)
//   - Destroyer (naval boss)
//   - Interceptor boats (fast patrol)
//   - Akula-Molot (hammerhead enemy sub)
//   - Delfin (dolphin enemy sub)
//   - Passenger ship (civilian target)

// ── Naval enemy constants (shared with initWorld in app_gossamer.js) ──
// --- Destroyer ship constants ---
const DESTROYER_HP = 300;
const DESTROYER_SPEED = 0.4;
const DESTROYER_PATROL_RANGE = 600;
const DESTROYER_MISSILE_COOLDOWN = 120;
const DESTROYER_AA_RANGE = 150;
const DESTROYER_AA_COOLDOWN = 8;
const DESTROYER_AA_DAMAGE = 2;
const DESTROYER_DEPTH_CHARGE_COOLDOWN = 200;
const DESTROYER_TORPEDO_COOLDOWN = 250;
const DESTROYER_MISSILE_RANGE = 400;

// --- Interceptor boat constants ---
const INTERCEPTOR_COUNT = 3;
const INTERCEPTOR_HP = 40;           // 2 torpedoes (25 each) kills
const INTERCEPTOR_SPEED = 1.8;
const INTERCEPTOR_MG_RANGE = 160;
const INTERCEPTOR_MG_COOLDOWN = 6;
const INTERCEPTOR_MG_DAMAGE = 1.2;
const INTERCEPTOR_BAZOOKA_COOLDOWN = 350;
const INTERCEPTOR_BAZOOKA_SPEED = 4;
const INTERCEPTOR_BAZOOKA_PAUSE = 40; // Ticks stopped before firing
const INTERCEPTOR_CAMO_ALPHA = 0.45;

// --- Акула-Молот (Hammerhead) enemy sub constants ---
const AKULA_HP = 180;
const AKULA_SPEED = 0.8;
const AKULA_DIVE_SPEED = 0.4;
const AKULA_SAM_COOLDOWN = 90;
const AKULA_TORPEDO_COOLDOWN = 110;
const AKULA_CLOAK_CYCLE = 200;       // Ticks per cloak on/off cycle
const AKULA_CLOAK_ON_RATIO = 0.55;   // 55% of cycle is cloaked
const AKULA_SONAR_BUOY_INTERVAL = 60;
const AKULA_SONAR_BUOY_RADIUS = 45;  // Radius of torpedo effectiveness reduction
const AKULA_SONAR_BUOY_LIFESPAN = 400;
const AKULA_COLOR = '#8b1a1a';
const AKULA_CLOAK_ALPHA = 0.08;
const AKULA_SONAR_CHAIN_DEPLOY_TIME = 120;  // Ticks to fully deploy
const AKULA_SONAR_CHAIN_MAX_LENGTH = 250;   // Full chain detection range
const AKULA_SONAR_CHAIN_SPEED_PENALTY = 0.45; // Speed multiplier when deployed
const AKULA_SONAR_CHAIN_TURN_PENALTY = 0.3;  // Dive speed multiplier when deployed
const AKULA_SONAR_CHAIN_DETECT_ALL_LAYERS = true;

// --- Дельфин (Dolphin) enemy sub constants ---
const DELFIN_COUNT = 2;
const DELFIN_HP = 80;
const DELFIN_SPEED = 0.35;
const DELFIN_MAX_DEPTH = WATER_LINE + 180;  // Can't go as deep as Akula
const DELFIN_TORPEDO_COOLDOWN = 200;
const DELFIN_MG_COOLDOWN = 7;
const DELFIN_MG_DAMAGE = 1.0;
const DELFIN_MG_RANGE = 130;
const DELFIN_ENGAGE_RANGE = 220;
const DELFIN_BAIL_THRESHOLD = 0.25;  // Below 25% HP, crew may bail
const DELFIN_BAIL_CHANCE = 0.6;
const DELFIN_COLOR = '#6b7280';
const DELFIN_CREW_COUNT = 4;

// --- Passenger ship constants ---
const PASSENGER_SHIP_HP = 60;
const PASSENGER_SHIP_SPEED = 0.3;
const PASSENGER_DWELL_TIME = 300; // Ticks at each island



/* global world, ctx, W, H, WATER_LINE, TERRAIN_LENGTH, THERMAL_LAYER_2_MAX,
   MINE_DAMAGE, CHAFF_COOLDOWN, CHAFF_LIFESPAN, CHAFF_RADIUS, CHAFF_DEFLECT_FORCE,
   CHAFF_COLOR, TWO_PI, SEA_FLOOR, SFX, toScreen, damageRandomPart, islandHitTest,
   addExplosion, addParticles, commanderStatusLabel, groundYFromTerrain,
   getThermalLayer, thermallyVisible, keyJustPressed */


// ============================================================
// SOPWITH CAMEL — One per level. Passive until attacked, then
// turns into the Red Baron (skin peels off) with full acrobatics.
// Fires Sopwith-style bullet streams as a nod to the original game.
// ============================================================
const SOPWITH_SPEED = 1.8;
const SOPWITH_ACROBAT_SPEED = 2.8;
const SOPWITH_FIRE_COOLDOWN = 6;
const SOPWITH_BULLET_SPEED = 4;
const SOPWITH_HP = 5;
const SOPWITH_SCORE = 5000;

function createSopwith(terrain) {
  // Spawn in the middle third of the terrain, cruising high
  const startX = TERRAIN_LENGTH * 0.3 + Math.random() * TERRAIN_LENGTH * 0.4;
  return {
    x: startX,
    y: 50 + Math.random() * 40,
    vx: (Math.random() < 0.5 ? 1 : -1) * SOPWITH_SPEED,
    vy: 0,
    hp: SOPWITH_HP,
    angered: false,        // Turns true on first hit — becomes Red Baron
    acrobatPhase: 0,       // Phase of current acrobatic manoeuvre
    acrobatTimer: 0,       // Ticks into current manoeuvre
    manoeuvre: 'cruise',   // cruise, loop, immelmann, chandelle, barrelRoll, strafingRun
    fireCooldown: 0,
    bullets: [],           // Sopwith-style bullet objects
    alive: true,
    scarfPhase: 0,         // Scarf flutter animation
  };
}

function updateSopwith(dt) {
  const sw = world.sopwith;
  if (!sw || !sw.alive) return;
  const sub = world.sub;
  sw.scarfPhase += dt * 0.12;

  // Update bullets
  for (let i = sw.bullets.length - 1; i >= 0; i--) {
    const b = sw.bullets[i];
    b.x += b.vx * dt; b.y += b.vy * dt;
    b.life -= dt;
    // Hit player sub?
    if (Math.abs(b.x - sub.worldX) < 16 && Math.abs(b.y - sub.y) < 12) {
      damageRandomPart(sub.parts, 4);
      addParticles(sub.worldX, sub.y, 3, '#fbbf24');
      SFX.damage();
      sw.bullets.splice(i, 1);
      continue;
    }
    if (b.life <= 0 || b.y > WATER_LINE || b.y < 5) sw.bullets.splice(i, 1);
  }

  // Check if player torpedoes/missiles hit the Sopwith
  sw.fireCooldown = Math.max(0, sw.fireCooldown - dt);
  for (let i = world.torpedoes.length - 1; i >= 0; i--) {
    const t = world.torpedoes[i];
    if (!t.fromSub) continue;
    if (Math.abs(t.worldX - sw.x) < 20 && Math.abs(t.y - sw.y) < 14) {
      sw.hp--;
      if (!sw.angered) {
        sw.angered = true;
        sw.manoeuvre = 'immelmann';
        sw.acrobatTimer = 0;
        world.caveMessage = { text: 'THE RED BARON AWAKENS!', timer: 120 };
      }
      addExplosion(sw.x, sw.y, 'small');
      SFX.explodeSmall();
      world.torpedoes.splice(i, 1);
      break;
    }
  }
  for (let i = world.missiles.length - 1; i >= 0; i--) {
    const m = world.missiles[i];
    if (m.fromEnemy) continue;
    if (Math.abs(m.worldX - sw.x) < 20 && Math.abs(m.y - sw.y) < 14) {
      sw.hp -= 2;
      if (!sw.angered) {
        sw.angered = true;
        sw.manoeuvre = 'immelmann';
        sw.acrobatTimer = 0;
        world.caveMessage = { text: 'THE RED BARON AWAKENS!', timer: 120 };
      }
      addExplosion(sw.x, sw.y, 'small');
      SFX.explodeSmall();
      world.missiles.splice(i, 1);
      break;
    }
  }

  // Death
  if (sw.hp <= 0) {
    sw.alive = false;
    addExplosion(sw.x, sw.y, 'big');
    addParticles(sw.x, sw.y, 20, '#e74c3c');
    world.score += SOPWITH_SCORE;
    world.kills++;
    world.caveMessage = { text: 'RED BARON SHOT DOWN!', timer: 150 };
    SFX.enemyDestroyed();
    return;
  }

  const distToSub = Math.hypot(sub.worldX - sw.x, sub.y - sw.y);
  const speed = sw.angered ? SOPWITH_ACROBAT_SPEED : SOPWITH_SPEED;
  const dir = sw.vx >= 0 ? 1 : -1;

  if (!sw.angered) {
    // PASSIVE MODE — gentle cruise, harmless biplane puttering along
    sw.x += sw.vx * dt;
    sw.vy = Math.sin(world.tick * 0.02 + sw.scarfPhase) * 0.3;
    sw.y += sw.vy * dt;
    sw.y = clamp(sw.y, 40, WATER_LINE - 40);
    // Reverse at terrain edges
    if (sw.x < 100 || sw.x > TERRAIN_LENGTH - 100) sw.vx = -sw.vx;
  } else {
    // RED BARON MODE — aggressive acrobatics, Sopwith-style combat
    sw.acrobatTimer += dt;
    const toSubX = sub.worldX - sw.x;
    const toSubY = sub.y - sw.y;
    const angleToSub = Math.atan2(toSubY, toSubX);

    switch (sw.manoeuvre) {
      case 'strafingRun': {
        // Dive toward sub, firing bullets
        sw.vx += Math.cos(angleToSub) * 0.15 * dt;
        sw.vy += Math.sin(angleToSub) * 0.12 * dt;
        const spd = Math.hypot(sw.vx, sw.vy);
        if (spd > speed * 1.3) { sw.vx *= speed * 1.3 / spd; sw.vy *= speed * 1.3 / spd; }
        // Fire bullet stream — Sopwith style (pairs of small bullets)
        if (sw.fireCooldown <= 0 && distToSub < 300) {
          const bDir = Math.atan2(sub.y - sw.y, sub.worldX - sw.x);
          const spread = (Math.random() - 0.5) * 0.15;
          sw.bullets.push({
            x: sw.x, y: sw.y,
            vx: Math.cos(bDir + spread) * SOPWITH_BULLET_SPEED,
            vy: Math.sin(bDir + spread) * SOPWITH_BULLET_SPEED,
            life: 80,
          });
          sw.fireCooldown = SOPWITH_FIRE_COOLDOWN;
        }
        // Pull up after getting close or after 120 ticks
        if (distToSub < 60 || sw.acrobatTimer > 120) {
          sw.manoeuvre = 'loop';
          sw.acrobatTimer = 0;
        }
        break;
      }
      case 'loop': {
        // Full loop — Sopwith signature move
        const loopDuration = 80;
        const loopAngle = (sw.acrobatTimer / loopDuration) * TWO_PI;
        sw.vx = dir * speed * Math.cos(loopAngle);
        sw.vy = -speed * Math.sin(loopAngle);
        if (sw.acrobatTimer > loopDuration) {
          sw.manoeuvre = 'chandelle';
          sw.acrobatTimer = 0;
        }
        break;
      }
      case 'immelmann': {
        // Half loop + roll — immediate direction reversal
        const immDuration = 50;
        const immAngle = (sw.acrobatTimer / immDuration) * Math.PI;
        sw.vx = dir * speed * Math.cos(immAngle);
        sw.vy = -speed * Math.abs(Math.sin(immAngle));
        if (sw.acrobatTimer > immDuration) {
          sw.vx = -sw.vx; // Reverse heading
          sw.manoeuvre = 'strafingRun';
          sw.acrobatTimer = 0;
        }
        break;
      }
      case 'chandelle': {
        // Climbing turn toward sub
        sw.vx += Math.cos(angleToSub) * 0.08 * dt;
        sw.vy -= 0.06 * dt; // Climb
        const spd = Math.hypot(sw.vx, sw.vy);
        if (spd > speed) { sw.vx *= speed / spd; sw.vy *= speed / spd; }
        if (sw.acrobatTimer > 60 || sw.y < 30) {
          sw.manoeuvre = 'strafingRun';
          sw.acrobatTimer = 0;
        }
        break;
      }
      case 'barrelRoll': {
        // Spiral evasion — harder to hit
        const rollDuration = 40;
        const rollAngle = (sw.acrobatTimer / rollDuration) * TWO_PI * 2;
        sw.vx = dir * speed;
        sw.vy = Math.sin(rollAngle) * speed * 0.8;
        if (sw.acrobatTimer > rollDuration) {
          sw.manoeuvre = 'strafingRun';
          sw.acrobatTimer = 0;
        }
        break;
      }
      default: { // cruise/fallthrough
        sw.vx += Math.cos(angleToSub) * 0.05 * dt;
        sw.vy += Math.sin(angleToSub) * 0.03 * dt;
        if (sw.acrobatTimer > 40) {
          // Pick a random acrobatic manoeuvre
          const moves = ['strafingRun', 'loop', 'immelmann', 'chandelle', 'barrelRoll'];
          sw.manoeuvre = moves[Math.floor(Math.random() * moves.length)];
          sw.acrobatTimer = 0;
        }
      }
    }

    sw.x += sw.vx * dt;
    sw.y += sw.vy * dt;
    sw.y = clamp(sw.y, 25, WATER_LINE - 15);
    // Reverse at edges
    if (sw.x < 50) { sw.x = 50; sw.vx = Math.abs(sw.vx); }
    if (sw.x > TERRAIN_LENGTH - 50) { sw.x = TERRAIN_LENGTH - 50; sw.vx = -Math.abs(sw.vx); }
  }
}

function drawSopwith() {
  const sw = world.sopwith;
  if (!sw || !sw.alive) return;
  const sx = toScreen(sw.x);
  if (sx < -50 || sx > W + 50) return;
  const dir = sw.vx >= 0 ? 1 : -1;

  ctx.save();
  ctx.translate(sx, sw.y);
  ctx.scale(dir, 1);

  if (!sw.angered) {
    // SOPWITH CAMEL — cream/olive biplane with cute pilot
    // Lower wing
    ctx.fillStyle = '#d4a053';
    ctx.fillRect(-12, 6, 24, 3);
    // Fuselage
    ctx.fillStyle = '#c9b896';
    ctx.fillRect(-14, -2, 28, 5);
    // Upper wing
    ctx.fillStyle = '#d4a053';
    ctx.fillRect(-13, -10, 26, 3);
    // Wing struts
    ctx.strokeStyle = '#8b7332'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-6, -7); ctx.lineTo(-6, 6);
    ctx.moveTo(6, -7); ctx.lineTo(6, 6);
    ctx.stroke();
    // Cross-wires between struts
    ctx.strokeStyle = 'rgba(139,115,50,0.4)'; ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(-6, -7); ctx.lineTo(6, 6);
    ctx.moveTo(6, -7); ctx.lineTo(-6, 6);
    ctx.stroke();
    // Tail
    ctx.fillStyle = '#b5a070';
    ctx.beginPath(); ctx.moveTo(-14, -2); ctx.lineTo(-20, -8); ctx.lineTo(-18, 0); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-14, 3); ctx.lineTo(-20, 8); ctx.lineTo(-18, 1); ctx.fill();
    // Propeller (spinning)
    const pa = Date.now() / 30;
    ctx.strokeStyle = '#555'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(14, Math.sin(pa) * 6); ctx.lineTo(14, -Math.sin(pa) * 6); ctx.stroke();
    // Engine cowling
    ctx.fillStyle = '#7a6b4e';
    ctx.fillRect(10, -3, 4, 6);
    // Pilot — cute with goggles and scarf
    ctx.fillStyle = '#f5deb3'; // Skin
    ctx.beginPath(); ctx.arc(0, -4, 4, 0, TWO_PI); ctx.fill();
    // Goggles
    ctx.fillStyle = '#4a90d9';
    ctx.fillRect(-3, -6, 3, 2);
    ctx.fillRect(1, -6, 3, 2);
    ctx.strokeStyle = '#333'; ctx.lineWidth = 0.5;
    ctx.strokeRect(-3, -6, 3, 2);
    ctx.strokeRect(1, -6, 3, 2);
    // Scarf (fluttering behind)
    ctx.strokeStyle = '#e74c3c'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-2, -3);
    const scarfWave = Math.sin(sw.scarfPhase) * 3;
    ctx.quadraticCurveTo(-8, -3 + scarfWave, -14, -2 + scarfWave * 1.5);
    ctx.stroke();
    // Leather helmet
    ctx.fillStyle = '#8b4513';
    ctx.beginPath(); ctx.arc(0, -5, 3.5, Math.PI, 0); ctx.fill();
  } else {
    // RED BARON — skin peeled off, exposed red skeleton frame + iron cross
    // Stripped fuselage frame
    ctx.fillStyle = '#cc1100';
    ctx.fillRect(-14, -2, 28, 5);
    // Exposed ribs (fabric torn off)
    ctx.strokeStyle = '#990000'; ctx.lineWidth = 1;
    for (let r = -10; r <= 10; r += 4) {
      ctx.beginPath(); ctx.moveTo(r, -2); ctx.lineTo(r, 3); ctx.stroke();
    }
    // Red wings (upper)
    ctx.fillStyle = '#dd2200';
    ctx.fillRect(-13, -10, 26, 3);
    // Red wings (lower)
    ctx.fillRect(-12, 6, 24, 3);
    // Wing struts — dark iron
    ctx.strokeStyle = '#440000'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-6, -7); ctx.lineTo(-6, 6);
    ctx.moveTo(6, -7); ctx.lineTo(6, 6);
    ctx.stroke();
    // Iron cross on upper wing
    ctx.fillStyle = '#111';
    ctx.fillRect(-2, -10, 4, 3); // Vertical bar
    ctx.fillRect(-5, -9, 10, 1);  // Horizontal bar
    // Tail — bare frame
    ctx.fillStyle = '#aa0000';
    ctx.beginPath(); ctx.moveTo(-14, -2); ctx.lineTo(-20, -8); ctx.lineTo(-18, 0); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-14, 3); ctx.lineTo(-20, 8); ctx.lineTo(-18, 1); ctx.fill();
    // Propeller (fast spin)
    const pa = Date.now() / 15;
    ctx.strokeStyle = '#333'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(14, Math.sin(pa) * 7); ctx.lineTo(14, -Math.sin(pa) * 7); ctx.stroke();
    // Engine — darker, meaner
    ctx.fillStyle = '#440000';
    ctx.fillRect(10, -3, 5, 6);
    // Baron pilot — skull-like, menacing
    ctx.fillStyle = '#ddd'; // Pale
    ctx.beginPath(); ctx.arc(0, -4, 3.5, 0, TWO_PI); ctx.fill();
    // Goggles (red tint)
    ctx.fillStyle = '#cc0000';
    ctx.fillRect(-3, -6, 3, 2);
    ctx.fillRect(1, -6, 3, 2);
    // Scarf (black now)
    ctx.strokeStyle = '#111'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-2, -3);
    const scarfWave = Math.sin(sw.scarfPhase) * 4;
    ctx.quadraticCurveTo(-8, -3 + scarfWave, -14, -2 + scarfWave * 1.5);
    ctx.stroke();
    // Spiked helmet
    ctx.fillStyle = '#333';
    ctx.beginPath(); ctx.arc(0, -5.5, 3.5, Math.PI, 0); ctx.fill();
    ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(-1.5, -6); ctx.lineTo(1.5, -6); ctx.closePath(); ctx.fill();

    // Muzzle flash when firing
    if (sw.fireCooldown > SOPWITH_FIRE_COOLDOWN - 2) {
      ctx.fillStyle = 'rgba(255,200,50,0.8)';
      ctx.beginPath(); ctx.arc(14, 0, 4 + Math.random() * 2, 0, TWO_PI); ctx.fill();
    }
  }

  ctx.restore();

  // Draw bullets — small paired dots, Sopwith-style
  ctx.fillStyle = '#fbbf24';
  for (const b of sw.bullets) {
    const bsx = toScreen(b.x);
    if (bsx < -10 || bsx > W + 10) continue;
    ctx.beginPath();
    ctx.arc(bsx, b.y, 2, 0, TWO_PI);
    ctx.fill();
    // Tracer trail
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    ctx.moveTo(bsx, b.y);
    ctx.lineTo(bsx - b.vx * 3, b.y - b.vy * 3);
    ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

// ============================================================
// AIR SUPREMACY FIGHTER — Su-47 Berkut (forward-swept wings)
// Fast, intelligent, rockets/seekers/bombs/MG, deploys chaff.
// Spawns once score exceeds threshold. Controls nearby interceptors.
// ============================================================
const BERKUT_SPEED = 3.5;
const BERKUT_HP = 7;
const BERKUT_SCORE = 8000;
const BERKUT_SPAWN_SCORE = 3500;
const BERKUT_MG_COOLDOWN = 5;
const BERKUT_ROCKET_COOLDOWN = 60;
const BERKUT_SEEKER_COOLDOWN = 120;
const BERKUT_BOMB_COOLDOWN = 90;
const BERKUT_CHAFF_COOLDOWN = 200;

function spawnBerkut() {
  const side = Math.random() < 0.5 ? 1 : -1;
  return {
    x: world.sub.worldX + side * W,
    y: 40 + Math.random() * 60,
    vx: -side * BERKUT_SPEED,
    vy: 0,
    hp: BERKUT_HP,
    alive: true,
    mgCooldown: 30,
    rocketCooldown: 40,
    seekerCooldown: 80,
    bombCooldown: 50,
    chaffCooldown: 100,
    bullets: [],
    state: 'approach', // approach, engage, evade, reposition
    stateTimer: 0,
    evasionDir: 1,
  };
}

function updateAirSupremacy(dt) {
  // Spawn check
  if (!world.airSupremacy && world.score >= BERKUT_SPAWN_SCORE) {
    world.airSupremacy = spawnBerkut();
    world.caveMessage = { text: 'WARNING: Su-47 BERKUT INBOUND', timer: 120 };
  }
  const bk = world.airSupremacy;
  if (!bk || !bk.alive) return;
  const sub = world.sub;
  const dist = Math.hypot(sub.worldX - bk.x, sub.y - bk.y);
  const dir = bk.vx >= 0 ? 1 : -1;
  const angleToSub = Math.atan2(sub.y - bk.y, sub.worldX - bk.x);

  // Cooldowns
  bk.mgCooldown = Math.max(0, bk.mgCooldown - dt);
  bk.rocketCooldown = Math.max(0, bk.rocketCooldown - dt);
  bk.seekerCooldown = Math.max(0, bk.seekerCooldown - dt);
  bk.bombCooldown = Math.max(0, bk.bombCooldown - dt);
  bk.chaffCooldown = Math.max(0, bk.chaffCooldown - dt);
  bk.stateTimer += dt;

  // Update bullets
  for (let i = bk.bullets.length - 1; i >= 0; i--) {
    const b = bk.bullets[i];
    b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
    if (Math.abs(b.x - sub.worldX) < 16 && Math.abs(b.y - sub.y) < 12) {
      damageRandomPart(sub.parts, 3);
      addParticles(sub.worldX, sub.y, 2, '#ef4444');
      SFX.damage();
      bk.bullets.splice(i, 1); continue;
    }
    if (b.life <= 0 || b.y > WATER_LINE + 10 || b.y < 5) bk.bullets.splice(i, 1);
  }

  // Take damage
  for (let i = world.torpedoes.length - 1; i >= 0; i--) {
    const t = world.torpedoes[i];
    if (!t.fromSub) continue;
    if (Math.abs(t.worldX - bk.x) < 22 && Math.abs(t.y - bk.y) < 16) {
      bk.hp--;
      addExplosion(bk.x, bk.y, 'small'); SFX.explodeSmall();
      world.torpedoes.splice(i, 1);
      // Evasive response — deploy chaff and break
      if (bk.chaffCooldown <= 0) {
        world.chaffs.push({ x: bk.x, y: bk.y, age: 0 });
        bk.chaffCooldown = BERKUT_CHAFF_COOLDOWN;
      }
      bk.state = 'evade'; bk.stateTimer = 0;
      break;
    }
  }
  for (let i = world.missiles.length - 1; i >= 0; i--) {
    const m = world.missiles[i];
    if (m.fromEnemy) continue;
    if (Math.abs(m.worldX - bk.x) < 22 && Math.abs(m.y - bk.y) < 16) {
      bk.hp -= 2;
      addExplosion(bk.x, bk.y, 'small'); SFX.explodeSmall();
      world.missiles.splice(i, 1);
      if (bk.chaffCooldown <= 0) {
        world.chaffs.push({ x: bk.x, y: bk.y, age: 0 });
        bk.chaffCooldown = BERKUT_CHAFF_COOLDOWN;
      }
      bk.state = 'evade'; bk.stateTimer = 0;
      break;
    }
  }

  // Death
  if (bk.hp <= 0) {
    bk.alive = false;
    addExplosion(bk.x, bk.y, 'big');
    addParticles(bk.x, bk.y, 25, '#334155');
    world.score += BERKUT_SCORE;
    world.kills++;
    world.caveMessage = { text: 'Su-47 BERKUT DESTROYED!', timer: 150 };
    SFX.enemyDestroyed();
    return;
  }

  // AI state machine
  switch (bk.state) {
    case 'approach': {
      bk.vx += Math.cos(angleToSub) * 0.12 * dt;
      bk.vy += Math.sin(angleToSub) * 0.08 * dt;
      const spd = Math.hypot(bk.vx, bk.vy);
      if (spd > BERKUT_SPEED) { bk.vx *= BERKUT_SPEED / spd; bk.vy *= BERKUT_SPEED / spd; }
      if (dist < 250) { bk.state = 'engage'; bk.stateTimer = 0; }
      break;
    }
    case 'engage': {
      // Circle and attack — maintain distance while firing
      const orbAngle = angleToSub + Math.PI / 2;
      bk.vx += (Math.cos(orbAngle) * 0.1 + Math.cos(angleToSub) * 0.04) * dt;
      bk.vy += (Math.sin(orbAngle) * 0.1 + Math.sin(angleToSub) * 0.03) * dt;
      const spd = Math.hypot(bk.vx, bk.vy);
      if (spd > BERKUT_SPEED) { bk.vx *= BERKUT_SPEED / spd; bk.vy *= BERKUT_SPEED / spd; }

      // MG — close range
      if (dist < 150 && bk.mgCooldown <= 0 && sub.y < WATER_LINE) {
        const spread = (Math.random() - 0.5) * 0.12;
        bk.bullets.push({
          x: bk.x, y: bk.y,
          vx: Math.cos(angleToSub + spread) * 5,
          vy: Math.sin(angleToSub + spread) * 5,
          life: 60,
        });
        bk.mgCooldown = BERKUT_MG_COOLDOWN;
      }
      // Unguided rockets — medium range
      if (dist < 350 && dist > 80 && bk.rocketCooldown <= 0 && sub.y < WATER_LINE) {
        world.missiles.push({
          worldX: bk.x, y: bk.y,
          vx: Math.cos(angleToSub) * 4.5, vy: Math.sin(angleToSub) * 4.5,
          phase: 'ignite', dropTimer: 0, life: 100, trail: [],
          fromEnemy: true, rocket: true,
        });
        bk.rocketCooldown = BERKUT_ROCKET_COOLDOWN;
        SFX.missileLaunch();
      }
      // Seeking missile — long range
      if (dist > 150 && bk.seekerCooldown <= 0 && sub.y < WATER_LINE) {
        world.missiles.push({
          worldX: bk.x, y: bk.y,
          vx: Math.cos(angleToSub) * 2, vy: Math.sin(angleToSub) * 2,
          phase: 'ignite', dropTimer: 0, life: 200, trail: [],
          fromEnemy: true, sam: true,
        });
        bk.seekerCooldown = BERKUT_SEEKER_COOLDOWN;
        SFX.missileLaunch();
      }
      // Bombs — when flying over sub on water surface
      if (Math.abs(bk.x - sub.worldX) < 40 && bk.y < sub.y && sub.floating && bk.bombCooldown <= 0) {
        world.missiles.push({
          worldX: bk.x, y: bk.y,
          vx: bk.vx * 0.3, vy: 2,
          phase: 'ignite', dropTimer: 0, life: 120, trail: [],
          fromEnemy: true, targetPart: 'hull',
        });
        bk.bombCooldown = BERKUT_BOMB_COOLDOWN;
      }
      if (bk.stateTimer > 200 || dist > 500) { bk.state = 'reposition'; bk.stateTimer = 0; }
      break;
    }
    case 'evade': {
      // Break hard, deploy chaff
      bk.evasionDir = -bk.evasionDir;
      bk.vx += bk.evasionDir * 0.3 * dt;
      bk.vy -= 0.15 * dt;
      const spd = Math.hypot(bk.vx, bk.vy);
      if (spd > BERKUT_SPEED * 1.3) { bk.vx *= BERKUT_SPEED * 1.3 / spd; bk.vy *= BERKUT_SPEED * 1.3 / spd; }
      if (bk.stateTimer > 40) { bk.state = 'approach'; bk.stateTimer = 0; }
      break;
    }
    case 'reposition': {
      // Swing wide then come back
      const awayAngle = angleToSub + Math.PI;
      bk.vx += Math.cos(awayAngle) * 0.08 * dt;
      bk.vy -= 0.04 * dt;
      const spd = Math.hypot(bk.vx, bk.vy);
      if (spd > BERKUT_SPEED) { bk.vx *= BERKUT_SPEED / spd; bk.vy *= BERKUT_SPEED / spd; }
      if (bk.stateTimer > 80 || dist > 600) { bk.state = 'approach'; bk.stateTimer = 0; }
      break;
    }
  }

  bk.x += bk.vx * dt;
  bk.y += bk.vy * dt;
  bk.y = clamp(bk.y, 25, WATER_LINE - 15);
  if (bk.x < 50) { bk.x = 50; bk.vx = Math.abs(bk.vx); }
  if (bk.x > TERRAIN_LENGTH - 50) { bk.x = TERRAIN_LENGTH - 50; bk.vx = -Math.abs(bk.vx); }

  // Command nearby interceptors — if Berkut is alive, interceptors get smarter
  for (const li of world.airInterceptors) {
    if (!li.alive) continue;
    if (Math.abs(li.x - bk.x) < W) {
      li.commanded = true; // Flag: use Berkut's targeting intelligence
    }
  }
}

function drawAirSupremacy() {
  const bk = world.airSupremacy;
  if (!bk || !bk.alive) return;
  const sx = toScreen(bk.x);
  if (sx < -60 || sx > W + 60) return;
  const dir = bk.vx >= 0 ? 1 : -1;

  ctx.save();
  ctx.translate(sx, bk.y);
  ctx.scale(dir, 1);

  // Su-47 Berkut — forward-swept wings, dark charcoal/navy
  // Fuselage
  ctx.fillStyle = '#1e293b';
  ctx.beginPath();
  ctx.moveTo(22, 0); ctx.lineTo(16, -3); ctx.lineTo(-18, -2.5);
  ctx.lineTo(-22, 0); ctx.lineTo(-18, 2.5); ctx.lineTo(16, 3);
  ctx.closePath(); ctx.fill();
  // Forward-swept wings (distinctive Berkut feature)
  ctx.fillStyle = '#334155';
  ctx.beginPath();
  ctx.moveTo(4, -3); ctx.lineTo(14, -16); ctx.lineTo(8, -16); ctx.lineTo(-4, -3);
  ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(4, 3); ctx.lineTo(14, 16); ctx.lineTo(8, 16); ctx.lineTo(-4, 3);
  ctx.closePath(); ctx.fill();
  // Canards (small front wings)
  ctx.fillStyle = '#475569';
  ctx.beginPath();
  ctx.moveTo(14, -3); ctx.lineTo(18, -8); ctx.lineTo(16, -8); ctx.lineTo(12, -3);
  ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(14, 3); ctx.lineTo(18, 8); ctx.lineTo(16, 8); ctx.lineTo(12, 3);
  ctx.closePath(); ctx.fill();
  // Twin vertical stabilisers (canted outward)
  ctx.fillStyle = '#1e293b';
  ctx.beginPath(); ctx.moveTo(-16, -2); ctx.lineTo(-20, -9); ctx.lineTo(-18, -2); ctx.fill();
  ctx.beginPath(); ctx.moveTo(-16, 2); ctx.lineTo(-20, 9); ctx.lineTo(-18, 2); ctx.fill();
  // Cockpit
  ctx.fillStyle = '#60a5fa';
  ctx.beginPath(); ctx.ellipse(12, -1, 5, 2, 0, 0, Math.PI * 2); ctx.fill();
  // Engine exhausts
  ctx.fillStyle = 'rgba(255,140,0,0.5)';
  ctx.beginPath(); ctx.moveTo(-22, -1.5); ctx.lineTo(-28 - Math.random() * 4, 0); ctx.lineTo(-22, 1.5); ctx.fill();
  // Star marking
  ctx.fillStyle = '#ef4444';
  ctx.beginPath(); ctx.arc(-8, 0, 2.5, 0, TWO_PI); ctx.fill();

  ctx.restore();

  // Bullets
  ctx.fillStyle = '#ef4444';
  for (const b of bk.bullets) {
    const bsx = toScreen(b.x);
    if (bsx < -10 || bsx > W + 10) continue;
    ctx.beginPath(); ctx.arc(bsx, b.y, 1.5, 0, TWO_PI); ctx.fill();
    ctx.globalAlpha = 0.3;
    ctx.beginPath(); ctx.moveTo(bsx, b.y);
    ctx.lineTo(bsx - b.vx * 2, b.y - b.vy * 2);
    ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 1; ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

// ============================================================
// AIR INTERCEPTORS — English Electric Lightning look.
// Spawn in squadrons of 2-3. MG + unguided rockets.
// When Berkut is on-screen, they follow its AI for coordinated attacks.
// ============================================================
const LIGHTNING_SPEED = 2.8;
const LIGHTNING_HP = 3;
const LIGHTNING_SCORE = 1500;
const LIGHTNING_MG_COOLDOWN = 8;
const LIGHTNING_ROCKET_COOLDOWN = 90;
const LIGHTNING_SQUAD_SPAWN_INTERVAL = 600;

function spawnLightningSquad() {
  const count = 2 + Math.floor(Math.random() * 2); // 2 or 3
  const side = Math.random() < 0.5 ? 1 : -1;
  const baseX = world.sub.worldX + side * (W * 0.7);
  const baseY = 50 + Math.random() * 50;
  const squad = [];
  for (let i = 0; i < count; i++) {
    squad.push({
      x: baseX + i * 30 * side,
      y: baseY + (i - 1) * 15, // V-formation offset
      vx: -side * LIGHTNING_SPEED,
      vy: (Math.random() - 0.5) * 0.3,
      hp: LIGHTNING_HP,
      alive: true,
      mgCooldown: 20 + Math.random() * 20,
      rocketCooldown: 40 + Math.random() * 40,
      bullets: [],
      commanded: false, // Set true when Berkut is nearby
      state: 'attack',  // attack, retreat
      stateTimer: 0,
    });
  }
  return squad;
}

function updateAirInterceptors(dt) {
  const sub = world.sub;

  // Spawn new squadrons periodically (max 1 active squad of 3)
  const aliveCount = world.airInterceptors.filter(l => l.alive).length;
  world.airInterceptorTimer += dt;
  if (aliveCount === 0 && world.airInterceptorTimer > LIGHTNING_SQUAD_SPAWN_INTERVAL && world.score > 1000) {
    world.airInterceptors = spawnLightningSquad();
    world.airInterceptorTimer = 0;
    world.caveMessage = { text: 'LIGHTNING SQUADRON INCOMING', timer: 80 };
  }

  for (const li of world.airInterceptors) {
    if (!li.alive) continue;
    li.stateTimer += dt;
    li.mgCooldown = Math.max(0, li.mgCooldown - dt);
    li.rocketCooldown = Math.max(0, li.rocketCooldown - dt);

    const dist = Math.hypot(sub.worldX - li.x, sub.y - li.y);
    const angleToSub = Math.atan2(sub.y - li.y, sub.worldX - li.x);

    // Update bullets
    for (let i = li.bullets.length - 1; i >= 0; i--) {
      const b = li.bullets[i];
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      if (Math.abs(b.x - sub.worldX) < 16 && Math.abs(b.y - sub.y) < 12) {
        damageRandomPart(sub.parts, 3);
        addParticles(sub.worldX, sub.y, 2, '#94a3b8');
        SFX.damage();
        li.bullets.splice(i, 1); continue;
      }
      if (b.life <= 0 || b.y > WATER_LINE || b.y < 5) li.bullets.splice(i, 1);
    }

    // Take damage
    for (let i = world.torpedoes.length - 1; i >= 0; i--) {
      const t = world.torpedoes[i];
      if (!t.fromSub) continue;
      if (Math.abs(t.worldX - li.x) < 18 && Math.abs(t.y - li.y) < 14) {
        li.hp -= 2;
        addExplosion(li.x, li.y, 'small'); SFX.explodeSmall();
        world.torpedoes.splice(i, 1); break;
      }
    }
    for (let i = world.missiles.length - 1; i >= 0; i--) {
      const m = world.missiles[i];
      if (m.fromEnemy) continue;
      if (Math.abs(m.worldX - li.x) < 18 && Math.abs(m.y - li.y) < 14) {
        li.hp -= 3;
        addExplosion(li.x, li.y, 'small'); SFX.explodeSmall();
        world.missiles.splice(i, 1); break;
      }
    }

    if (li.hp <= 0) {
      li.alive = false;
      addExplosion(li.x, li.y, 'big');
      addParticles(li.x, li.y, 14, '#64748b');
      world.score += LIGHTNING_SCORE;
      world.kills++;
      SFX.enemyDestroyed();
      continue;
    }

    // AI — commanded by Berkut or independent
    if (li.commanded && world.airSupremacy?.alive) {
      // Coordinated: focus fire from flanking positions
      const bk = world.airSupremacy;
      const flankAngle = Math.atan2(sub.y - bk.y, sub.worldX - bk.x) + Math.PI / 3;
      li.vx += Math.cos(flankAngle) * 0.08 * dt;
      li.vy += Math.sin(flankAngle) * 0.06 * dt;
    } else {
      // Independent: direct approach
      li.vx += Math.cos(angleToSub) * 0.1 * dt;
      li.vy += Math.sin(angleToSub) * 0.06 * dt;
    }
    const spd = Math.hypot(li.vx, li.vy);
    if (spd > LIGHTNING_SPEED) { li.vx *= LIGHTNING_SPEED / spd; li.vy *= LIGHTNING_SPEED / spd; }

    // MG fire — close range
    if (dist < 180 && li.mgCooldown <= 0 && sub.y < WATER_LINE) {
      const spread = (Math.random() - 0.5) * 0.15;
      li.bullets.push({
        x: li.x, y: li.y,
        vx: Math.cos(angleToSub + spread) * 4.5,
        vy: Math.sin(angleToSub + spread) * 4.5,
        life: 50,
      });
      li.mgCooldown = LIGHTNING_MG_COOLDOWN;
    }
    // Unguided rockets — medium range
    if (dist < 300 && dist > 60 && li.rocketCooldown <= 0 && sub.y < WATER_LINE) {
      world.missiles.push({
        worldX: li.x, y: li.y,
        vx: Math.cos(angleToSub) * 4, vy: Math.sin(angleToSub) * 4,
        phase: 'ignite', dropTimer: 0, life: 80, trail: [],
        fromEnemy: true, rocket: true,
      });
      li.rocketCooldown = LIGHTNING_ROCKET_COOLDOWN;
    }

    li.x += li.vx * dt;
    li.y += li.vy * dt;
    li.y = clamp(li.y, 25, WATER_LINE - 15);
    // Retreat if too far away
    if (Math.abs(li.x - sub.worldX) > W * 2.5) li.alive = false;
    li.commanded = false; // Reset each tick, Berkut re-sets if nearby
  }
}

function drawAirInterceptors() {
  for (const li of world.airInterceptors) {
    if (!li.alive) continue;
    const sx = toScreen(li.x);
    if (sx < -50 || sx > W + 50) continue;
    const dir = li.vx >= 0 ? 1 : -1;

    ctx.save();
    ctx.translate(sx, li.y);
    ctx.scale(dir, 1);

    // English Electric Lightning — stacked engine nacelles, highly swept wings
    // Fuselage (distinctive round cross-section)
    ctx.fillStyle = '#94a3b8';
    ctx.beginPath();
    ctx.moveTo(20, 0); ctx.lineTo(14, -3); ctx.lineTo(-16, -2.5);
    ctx.lineTo(-18, 0); ctx.lineTo(-16, 2.5); ctx.lineTo(14, 3);
    ctx.closePath(); ctx.fill();
    // Belly bulge (lower engine intake)
    ctx.fillStyle = '#7c8ba0';
    ctx.beginPath();
    ctx.ellipse(0, 3, 10, 2.5, 0, 0, Math.PI); ctx.fill();
    // Highly swept wings (60-degree sweep)
    ctx.fillStyle = '#8293a8';
    ctx.beginPath();
    ctx.moveTo(2, -3); ctx.lineTo(-6, -14); ctx.lineTo(-10, -12); ctx.lineTo(-2, -3);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(2, 3); ctx.lineTo(-6, 14); ctx.lineTo(-10, 12); ctx.lineTo(-2, 3);
    ctx.closePath(); ctx.fill();
    // Tail fin (tall, thin)
    ctx.fillStyle = '#64748b';
    ctx.beginPath(); ctx.moveTo(-14, -2); ctx.lineTo(-18, -12); ctx.lineTo(-16, -2); ctx.fill();
    // Cockpit
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath(); ctx.ellipse(12, -1, 4, 1.8, 0, 0, Math.PI * 2); ctx.fill();
    // Nose cone (shock cone intake)
    ctx.fillStyle = '#e2e8f0';
    ctx.beginPath(); ctx.arc(20, 0, 2, 0, TWO_PI); ctx.fill();
    // Exhaust
    ctx.fillStyle = 'rgba(255,160,0,0.4)';
    ctx.beginPath(); ctx.moveTo(-18, -1); ctx.lineTo(-24 - Math.random() * 3, 0); ctx.lineTo(-18, 1); ctx.fill();
    // Roundel
    ctx.fillStyle = '#1d4ed8';
    ctx.beginPath(); ctx.arc(-4, -3, 2, 0, TWO_PI); ctx.fill();
    ctx.fillStyle = '#dc2626';
    ctx.beginPath(); ctx.arc(-4, -3, 1, 0, TWO_PI); ctx.fill();

    ctx.restore();

    // Bullets
    ctx.fillStyle = '#cbd5e1';
    for (const b of li.bullets) {
      const bsx = toScreen(b.x);
      if (bsx < -10 || bsx > W + 10) continue;
      ctx.beginPath(); ctx.arc(bsx, b.y, 1.5, 0, TWO_PI); ctx.fill();
    }
  }
}

// ============================================================
// NEMESIS MINI-SUB — A smaller airborne submarine that mirrors
// the player. Flies and swims but cannot go deep layer or space.
// Toggle ON in settings or auto-spawns on higher scores.
// ============================================================
const NEMESIS_SPEED_AIR = 2.2;
const NEMESIS_SPEED_WATER = 1.4;
const NEMESIS_HP = 6;
const NEMESIS_SCORE = 6000;
const NEMESIS_SPAWN_SCORE = 6000;
const NEMESIS_TORPEDO_COOLDOWN = 120;
const NEMESIS_MG_COOLDOWN = 10;

function spawnNemesis() {
  // Always emerge from the hidden underwater lair, never the player's hangar.
  const lair = world.terrain.nemesisLair;
  const lairX = lair ? lair.x : world.terrain.startPort.x + 3000;
  const lairY = lair ? lair.y : WATER_LINE + 145;
  return {
    x: lairX,
    y: lairY,
    vx: 0,
    vy: -NEMESIS_SPEED_WATER * 0.6,   // Rising slowly from depth
    hp: NEMESIS_HP,
    alive: true,
    torpedoCooldown: 80,
    mgCooldown: 40,
    bullets: [],
    inWater: true,
    state: 'emerging',   // emerging → hunt, dive, surface, flee
    stateTimer: 0,
    // Lair position cached so we can reveal it once the nemesis is spotted
    lairX,
    lairY,
  };
}

function updateNemesis(dt) {
  // Spawn check
  const shouldSpawn = world.settings.nemesisSub || world.score >= NEMESIS_SPAWN_SCORE;
  if (!world.nemesis && shouldSpawn) {
    world.nemesis = spawnNemesis();
    // Announce after a short delay (the nemesis is deep; player won't see it yet)
    world.caveMessage = { text: 'DEEP SONAR CONTACT — UNKNOWN VESSEL', timer: 140 };
  }
  const nm = world.nemesis;
  if (!nm || !nm.alive) return;
  const sub = world.sub;
  nm.stateTimer += dt;
  nm.torpedoCooldown = Math.max(0, nm.torpedoCooldown - dt);
  nm.mgCooldown = Math.max(0, nm.mgCooldown - dt);
  nm.inWater = nm.y > WATER_LINE;

  // ── EMERGING state: rise from the lair before engaging ──────────────────
  if (nm.state === 'emerging') {
    nm.vy = -NEMESIS_SPEED_WATER * 0.55;   // Slow, menacing ascent
    nm.vx *= 0.92;                          // Bleed off any lateral drift
    nm.x += nm.vx * dt;
    nm.y += nm.vy * dt;
    // Reveal lair on the map as soon as the nemesis breaks the thermocline
    if (nm.y < WATER_LINE + 80 && world.terrain.nemesisLair) {
      world.terrain.nemesisLair.revealed = true;
    }
    // Transition to hunt once at the waterline
    if (nm.y <= WATER_LINE + 5) {
      nm.y = WATER_LINE + 5;
      nm.vy = 0;
      nm.state = 'hunt';
      nm.stateTimer = 0;
      world.caveMessage = { text: 'WARNING: NEMESIS SUB SURFACING', timer: 150 };
    }
    return;  // No combat while emerging
  }
  // ─────────────────────────────────────────────────────────────────────────

  const dist = Math.hypot(sub.worldX - nm.x, sub.y - nm.y);
  const angleToSub = Math.atan2(sub.y - nm.y, sub.worldX - nm.x);
  const speed = nm.inWater ? NEMESIS_SPEED_WATER : NEMESIS_SPEED_AIR;

  // Update bullets
  for (let i = nm.bullets.length - 1; i >= 0; i--) {
    const b = nm.bullets[i];
    b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
    if (Math.abs(b.x - sub.worldX) < 16 && Math.abs(b.y - sub.y) < 12) {
      damageRandomPart(sub.parts, 3);
      SFX.damage();
      nm.bullets.splice(i, 1); continue;
    }
    if (b.life <= 0) nm.bullets.splice(i, 1);
  }

  // Take damage
  for (let i = world.torpedoes.length - 1; i >= 0; i--) {
    const t = world.torpedoes[i];
    if (!t.fromSub) continue;
    if (Math.abs(t.worldX - nm.x) < 20 && Math.abs(t.y - nm.y) < 14) {
      nm.hp -= 2;
      addExplosion(nm.x, nm.y, 'small'); SFX.explodeSmall();
      world.torpedoes.splice(i, 1); break;
    }
  }
  for (let i = world.missiles.length - 1; i >= 0; i--) {
    const m = world.missiles[i];
    if (m.fromEnemy) continue;
    if (Math.abs(m.worldX - nm.x) < 20 && Math.abs(m.y - nm.y) < 14) {
      nm.hp -= 2;
      addExplosion(nm.x, nm.y, 'small'); SFX.explodeSmall();
      world.missiles.splice(i, 1); break;
    }
  }

  // Death
  if (nm.hp <= 0) {
    nm.alive = false;
    addExplosion(nm.x, nm.y, 'big');
    addParticles(nm.x, nm.y, 20, '#475569');
    world.score += NEMESIS_SCORE;
    world.kills++;
    world.caveMessage = { text: 'NEMESIS SUB DESTROYED!', timer: 150 };
    SFX.enemyDestroyed();
    return;
  }

  // AI — mirror the player, follow into water but not deep or space
  const subInWater = sub.y > WATER_LINE;
  const subInDeep = sub.y > THERMAL_LAYER_2_MAX;

  if (subInDeep || world.mode === 'orbit') {
    // Can't follow — circle at medium depth waiting
    nm.vy += (WATER_LINE + 40 - nm.y) * 0.005 * dt;
    nm.vx += Math.cos(world.tick * 0.01) * 0.05 * dt;
  } else if (subInWater && !subInDeep) {
    // Follow sub underwater — dive to match
    nm.vx += Math.cos(angleToSub) * 0.08 * dt;
    nm.vy += Math.sin(angleToSub) * 0.06 * dt;
    // Fire torpedo underwater
    if (nm.torpedoCooldown <= 0 && dist < 300 && nm.inWater) {
      const tDir = sub.worldX > nm.x ? 1 : -1;
      world.torpedoes.push({
        worldX: nm.x + tDir * 15, y: nm.y,
        vx: tDir * TORPEDO_SPEED * 0.6, vy: (sub.y - nm.y) * 0.004,
        phase: 'skim', life: 200, trail: [],
        rogue: false, fromSub: false, active: true,
      });
      nm.torpedoCooldown = NEMESIS_TORPEDO_COOLDOWN;
      SFX.torpedoLaunch();
    }
  } else {
    // Both in air — dogfight
    nm.vx += Math.cos(angleToSub) * 0.1 * dt;
    nm.vy += Math.sin(angleToSub) * 0.08 * dt;
    // MG fire in air
    if (dist < 200 && nm.mgCooldown <= 0 && sub.y < WATER_LINE) {
      const spread = (Math.random() - 0.5) * 0.15;
      nm.bullets.push({
        x: nm.x, y: nm.y,
        vx: Math.cos(angleToSub + spread) * 4,
        vy: Math.sin(angleToSub + spread) * 4,
        life: 60,
      });
      nm.mgCooldown = NEMESIS_MG_COOLDOWN;
    }
  }

  const spd = Math.hypot(nm.vx, nm.vy);
  if (spd > speed) { nm.vx *= speed / spd; nm.vy *= speed / spd; }
  nm.x += nm.vx * dt;
  nm.y += nm.vy * dt;
  // Can't go deep
  nm.y = clamp(nm.y, 25, THERMAL_LAYER_2_MAX - 20);
  if (nm.x < 50) { nm.x = 50; nm.vx = Math.abs(nm.vx); }
  if (nm.x > TERRAIN_LENGTH - 50) { nm.x = TERRAIN_LENGTH - 50; nm.vx = -Math.abs(nm.vx); }
}

// ── NEMESIS LAIR ─────────────────────────────────────────────────────────────
// Draws the hidden underwater cavern from which the nemesis sub emerges.
// Visible only when the player is close enough (thermal layer reveals it)
// OR after the nemesis has surfaced and the lair has been revealed.
function drawNemesisLair() {
  const lair = world.terrain && world.terrain.nemesisLair;
  if (!lair) return;

  const sx = toScreen(lair.x);
  if (sx < -lair.w - 20 || sx > W + lair.w + 20) return;
  // Only visible when sub is below the waterline (underwater view) AND
  // in the right vertical range, OR once the lair has been revealed.
  const sub = world.sub;
  const subUnderwater = sub && sub.y > WATER_LINE;
  if (!lair.revealed && !subUnderwater) return;

  const cx = sx;
  const cy = lair.y;
  const hw = lair.w / 2;   // half-width
  const hh = lair.h / 2;   // half-height
  const t  = world.tick;

  ctx.save();

  // ── Outer rock formation / cliff face ──
  ctx.fillStyle = '#1a1218';
  ctx.beginPath();
  ctx.moveTo(cx - hw - 30, cy + hh + 30);
  ctx.lineTo(cx - hw - 20, cy - hh - 18);
  ctx.lineTo(cx - hw + 10, cy - hh - 24);
  ctx.lineTo(cx - 8,       cy - hh - 6);   // Cave mouth top-left
  ctx.lineTo(cx + 8,       cy - hh - 6);   // Cave mouth top-right
  ctx.lineTo(cx + hw - 10, cy - hh - 24);
  ctx.lineTo(cx + hw + 20, cy - hh - 18);
  ctx.lineTo(cx + hw + 30, cy + hh + 30);
  ctx.closePath();
  ctx.fill();

  // Rock texture — darker shadow on left face
  const rockGrad = ctx.createLinearGradient(cx - hw - 30, cy, cx + hw + 30, cy);
  rockGrad.addColorStop(0,   'rgba(10,6,14,0.8)');
  rockGrad.addColorStop(0.4, 'rgba(28,18,34,0.4)');
  rockGrad.addColorStop(1,   'rgba(10,6,14,0.7)');
  ctx.fillStyle = rockGrad;
  ctx.beginPath();
  ctx.moveTo(cx - hw - 30, cy + hh + 30);
  ctx.lineTo(cx - hw - 20, cy - hh - 18);
  ctx.lineTo(cx + hw + 20, cy - hh - 18);
  ctx.lineTo(cx + hw + 30, cy + hh + 30);
  ctx.closePath();
  ctx.fill();

  // ── Cave mouth opening — deep void ──
  const voidGrad = ctx.createRadialGradient(cx, cy, 4, cx, cy, hw * 0.9);
  voidGrad.addColorStop(0,   'rgba(80,0,0,0.5)');    // faint red core
  voidGrad.addColorStop(0.5, 'rgba(20,0,10,0.85)');
  voidGrad.addColorStop(1,   'rgba(5,0,5,1)');
  ctx.fillStyle = voidGrad;
  ctx.beginPath();
  ctx.ellipse(cx, cy, hw * 0.72, hh * 0.62, 0, 0, TWO_PI);
  ctx.fill();

  // ── Red glow from inside — pulses ominously ──
  const glowAlpha = 0.12 + 0.06 * Math.sin(t * 0.04);
  const glowGrad = ctx.createRadialGradient(cx, cy, 2, cx, cy, hw * 0.85);
  glowGrad.addColorStop(0,   `rgba(220,20,20,${glowAlpha * 2.5})`);
  glowGrad.addColorStop(0.5, `rgba(160,0,0,${glowAlpha})`);
  glowGrad.addColorStop(1,   'rgba(80,0,0,0)');
  ctx.fillStyle = glowGrad;
  ctx.beginPath();
  ctx.ellipse(cx, cy, hw, hh + 10, 0, 0, TWO_PI);
  ctx.fill();

  // ── Jagged stalactites hanging from cave roof ──
  ctx.fillStyle = '#120d18';
  const stalCount = 7;
  for (let i = 0; i < stalCount; i++) {
    const stalX  = cx - hw * 0.55 + i * (hw * 1.1 / (stalCount - 1));
    const stalH  = 8 + ((i * 3 + 5) % 12);  // deterministic irregular heights
    const stalW  = 3 + (i % 3);
    ctx.beginPath();
    ctx.moveTo(stalX - stalW, cy - hh * 0.55);
    ctx.lineTo(stalX,         cy - hh * 0.55 + stalH);
    ctx.lineTo(stalX + stalW, cy - hh * 0.55);
    ctx.closePath();
    ctx.fill();
  }

  // ── Evil antenna / relay tower above the cave mouth ──
  const antBase = cy - hh - 22;
  ctx.strokeStyle = '#3a1a2a';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(cx, antBase); ctx.lineTo(cx, antBase - 28); ctx.stroke();
  // Cross arms
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(cx - 9, antBase - 8);  ctx.lineTo(cx + 9, antBase - 8);  ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx - 6, antBase - 16); ctx.lineTo(cx + 6, antBase - 16); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx - 3, antBase - 22); ctx.lineTo(cx + 3, antBase - 22); ctx.stroke();
  // Blinking red beacon at the tip
  if (t % 40 < 20) {
    ctx.fillStyle = '#ef4444';
    ctx.shadowColor = '#ef4444';
    ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.arc(cx, antBase - 28, 2, 0, TWO_PI); ctx.fill();
    ctx.shadowBlur = 0;
  }

  // ── Bubble vent — trickle of bubbles from the lair ──
  // Use deterministic phase so bubbles don't flicker randomly each frame
  for (let b = 0; b < 4; b++) {
    const phase  = (t * 0.7 + b * 22) % 60;
    const bubX   = cx + (b % 2 === 0 ? -1 : 1) * (4 + b * 3);
    const bubY   = cy - hh * 0.5 - phase * 0.9;
    const bubR   = 1.5 + (b % 3) * 0.8;
    const bubA   = Math.max(0, 0.4 - phase / 90);
    if (bubA <= 0) continue;
    ctx.fillStyle = `rgba(133,193,233,${bubA})`;
    ctx.beginPath(); ctx.arc(bubX, bubY, bubR, 0, TWO_PI); ctx.fill();
  }

  // ── Label (only when revealed / close enough) ──
  if (lair.revealed) {
    ctx.font = 'bold 9px Arial';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(239,68,68,0.75)';
    ctx.fillText('NEMESIS LAIR', cx, cy - hh - 36);
  } else {
    // Unknown contact marker — a question mark with sonar ring
    const sonarAlpha = 0.15 + 0.08 * Math.sin(t * 0.03);
    ctx.strokeStyle = `rgba(239,68,68,${sonarAlpha})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, hw * 1.2 + Math.sin(t * 0.02) * 6, 0, TWO_PI);
    ctx.stroke();
    ctx.font = '10px Arial';
    ctx.fillStyle = `rgba(239,68,68,${sonarAlpha * 2.5})`;
    ctx.textAlign = 'center';
    ctx.fillText('?', cx, cy - hh - 30);
  }

  ctx.restore();
}

function drawNemesis() {
  const nm = world.nemesis;
  if (!nm || !nm.alive) return;
  // Thermal visibility check when underwater
  if (nm.inWater && !thermallyVisible(world.sub.y, nm.y)) return;
  const sx = toScreen(nm.x);
  if (sx < -50 || sx > W + 50) return;
  const dir = nm.vx >= 0 ? 1 : -1;

  ctx.save();
  ctx.translate(sx, nm.y);
  ctx.scale(dir, 1);

  // Smaller, darker version of the player's sub
  // Hull
  ctx.fillStyle = '#1e1e2e';
  ctx.beginPath(); ctx.ellipse(0, 0, 16, 6, 0, 0, TWO_PI); ctx.fill();
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1; ctx.stroke();
  // Tower
  ctx.fillStyle = '#2a2a3a';
  ctx.fillRect(-2, -9, 4, 4);
  // Nose
  ctx.fillStyle = '#444';
  ctx.beginPath(); ctx.arc(16, 0, 3, -Math.PI / 2, Math.PI / 2); ctx.fill();
  // Wings (small)
  ctx.fillStyle = '#3a3a4a';
  ctx.beginPath();
  ctx.moveTo(-2, -5); ctx.lineTo(-8, -11); ctx.lineTo(-4, -11); ctx.lineTo(2, -5);
  ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-2, 5); ctx.lineTo(-8, 11); ctx.lineTo(-4, 11); ctx.lineTo(2, 5);
  ctx.closePath(); ctx.fill();
  // Engine
  ctx.fillStyle = '#555';
  ctx.fillRect(-18, -3, 5, 6);
  // Propeller
  if (!nm.inWater) {
    const pa = Date.now() / 40;
    ctx.strokeStyle = '#888'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(-18, Math.sin(pa) * 4); ctx.lineTo(-18, -Math.sin(pa) * 4); ctx.stroke();
  } else {
    // Underwater — bubble trail
    ctx.fillStyle = 'rgba(133,193,233,0.3)';
    for (let b = 0; b < 3; b++) {
      ctx.beginPath();
      ctx.arc(-20 - b * 5 + Math.random() * 3, (Math.random() - 0.5) * 4, 2 + Math.random(), 0, TWO_PI);
      ctx.fill();
    }
  }
  // Red eye (menacing)
  ctx.fillStyle = '#ef4444';
  ctx.beginPath(); ctx.arc(12, -2, 1.5, 0, TWO_PI); ctx.fill();
  // Warning stripes on hull
  ctx.strokeStyle = 'rgba(239,68,68,0.3)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(-8, -5); ctx.lineTo(-8, 5); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-4, -6); ctx.lineTo(-4, 6); ctx.stroke();

  ctx.restore();

  // Bullets
  ctx.fillStyle = '#f87171';
  for (const b of nm.bullets) {
    const bsx = toScreen(b.x);
    if (bsx < -10 || bsx > W + 10) continue;
    ctx.beginPath(); ctx.arc(bsx, b.y, 1.5, 0, TWO_PI); ctx.fill();
  }
}

function updateChaffs(world, dt) {
  world.chaffCooldown = Math.max(0, world.chaffCooldown - dt);
  for (let i = world.chaffs.length - 1; i >= 0; i--) {
    const chaff = world.chaffs[i];
    chaff.age += dt;
    // Slow downward drift as chaff settles
    chaff.y += 0.12 * dt;
    if (chaff.age > CHAFF_LIFESPAN) {
      world.chaffs.splice(i, 1);
    }
  }
}

function drawChaffs(world) {
  const CHAFF_COLORS = ['#f0b429', '#fcd34d', '#fef3c7', '#f59e0b', '#e2e8f0', '#d4d4d8'];
  for (const chaff of world.chaffs) {
    const sx = toScreen(chaff.x);
    const progress = chaff.age / CHAFF_LIFESPAN;
    const baseAlpha = 0.3 + 0.7 * (1 - progress);
    // Spread increases over time (tight bundle → dispersed)
    const spread = 4 + progress * CHAFF_RADIUS * 1.2;
    const drift = progress * 18; // Downward drift
    const numFlakes = 24;
    for (let i = 0; i < numFlakes; i++) {
      // Each flake has a deterministic seed based on index
      const seed = i * 137.5;
      const angle = (seed % 360) * Math.PI / 180;
      const dist = ((seed * 0.73) % 1) * spread;
      const fx = sx + Math.cos(angle + world.tick * 0.02 * ((i % 3) - 1)) * dist;
      const fy = chaff.y + Math.sin(angle) * dist * 0.6 + drift
        + Math.sin(world.tick * 0.08 + seed) * 3; // Flutter
      // Shimmer: alpha pulses per flake
      const shimmer = 0.5 + 0.5 * Math.sin(world.tick * 0.15 + seed * 2.7);
      ctx.globalAlpha = Math.max(0, baseAlpha * shimmer);
      ctx.fillStyle = CHAFF_COLORS[i % CHAFF_COLORS.length];
      // Tiny rectangles rotated randomly (confetti strips)
      ctx.save();
      ctx.translate(fx, fy);
      ctx.rotate(world.tick * 0.03 + seed);
      ctx.fillRect(-2, -0.6, 4, 1.2);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
}

// ============================================================
// DESTROYER
// ============================================================
function updateDestroyer(dt) {
  const d = world.terrain.destroyer;
  if (!d || d.destroyed) return;
  const sub = world.sub;

  // Patrol movement
  d.x += DESTROYER_SPEED * d.patrolDir * dt;
  if (d.x > d.patrolCenter + DESTROYER_PATROL_RANGE / 2) d.patrolDir = -1;
  if (d.x < d.patrolCenter - DESTROYER_PATROL_RANGE / 2) d.patrolDir = 1;

  // Wake trail
  if (world.tick % 4 === 0) {
    d.wakeTrail.push({ x: d.x, age: 0 });
    if (d.wakeTrail.length > 20) d.wakeTrail.shift();
  }
  d.wakeTrail.forEach((w) => { w.age += dt; });

  // Alert level based on distance to sub
  const distToSub = Math.hypot(sub.worldX - d.x, sub.y - d.y);
  if (distToSub < DESTROYER_AA_RANGE) d.alertLevel = 2;
  else if (distToSub < DESTROYER_MISSILE_RANGE) d.alertLevel = 1;
  else d.alertLevel = 0;

  // Cooldowns
  d.missileCooldown = Math.max(0, d.missileCooldown - dt);
  d.aaCooldown = Math.max(0, d.aaCooldown - dt);
  d.depthChargeCooldown = Math.max(0, d.depthChargeCooldown - dt);
  d.torpedoCooldown = Math.max(0, d.torpedoCooldown - dt);

  // Guided missiles (chaff-defeatable, like SAM)
  if (d.alertLevel >= 1 && d.missileCooldown <= 0 && sub.y < WATER_LINE) {
    const angle = Math.atan2(sub.y - d.y, sub.worldX - d.x);
    world.missiles.push({
      worldX: d.x, y: d.y - 15,
      vx: Math.cos(angle) * 2, vy: -2.5,
      phase: 'ignite', dropTimer: 0, life: 220, trail: [],
      fromEnemy: true, sam: true,
    });
    d.missileCooldown = DESTROYER_MISSILE_COOLDOWN;
    SFX.missileLaunch();
  }

  // Close-range AA fire
  if (d.alertLevel >= 2 && d.aaCooldown <= 0 && sub.y < WATER_LINE) {
    damageRandomPart(sub.parts, DESTROYER_AA_DAMAGE);
    addParticles(sub.worldX, sub.y, 2, '#fbbf24');
    d.aaCooldown = DESTROYER_AA_COOLDOWN;
  }

  // Depth charges (when sub is below water near destroyer)
  if (sub.y > WATER_LINE + 10 && Math.abs(sub.worldX - d.x) < 120 && d.depthChargeCooldown <= 0) {
    world.depthCharges.push({
      worldX: d.x + (Math.random() - 0.5) * 30,
      y: WATER_LINE + 5,
      vx: 0, vy: 1.0,
      life: DEPTH_CHARGE_LIFE, trail: [],
    });
    d.depthChargeCooldown = DESTROYER_DEPTH_CHARGE_COOLDOWN;
  }

  // Torpedo (when sub is in water and close)
  if (sub.y > WATER_LINE - 5 && distToSub < 250 && d.torpedoCooldown <= 0) {
    const dir = sub.worldX > d.x ? 1 : -1;
    world.torpedoes.push({
      worldX: d.x + dir * 30, y: WATER_LINE + 3,
      vx: dir * 1.5, vy: 0.3,
      phase: 'active', life: 200, trail: [],
      rogue: false, fromSub: false, active: true,
    });
    d.torpedoCooldown = DESTROYER_TORPEDO_COOLDOWN;
    SFX.torpedoLaunch();
  }

  // Take damage from player torpedoes
  world.torpedoes = world.torpedoes.filter((t) => {
    if (!t.fromSub) return true;
    if (Math.abs(t.worldX - d.x) < 35 && Math.abs(t.y - d.y) < 20) {
      d.hp -= 25;
      addExplosion(t.worldX, t.y, 'big');
      SFX.explodeBig();
      t.life = 0;
      if (d.hp <= 0) {
        d.destroyed = true;
        addExplosion(d.x, d.y, 'big');
        addExplosion(d.x - 20, d.y - 5, 'big');
        addExplosion(d.x + 15, d.y + 3, 'big');
        addParticles(d.x, d.y, 30, '#e74c3c');
        world.score += 2000;
        world.kills++;
        world.caveMessage = { text: 'DESTROYER SUNK! +2000', timer: 150 };
        SFX.enemyDestroyed();
      }
      return false;
    }
    return true;
  });

  // Take damage from depth charges
  for (const charge of world.depthCharges) {
    const cdist = Math.hypot(charge.worldX - d.x, charge.y - d.y);
    if (cdist < DEPTH_CHARGE_BLAST_RADIUS * 0.5) {
      d.hp -= 15;
    }
  }
}

function drawDestroyer() {
  const d = world.terrain.destroyer;
  if (!d || d.destroyed) return;
  const dx = toScreen(d.x);
  if (dx < -80 || dx > W + 80) return;
  const dy = d.y;

  ctx.save();

  // Wake trail
  ctx.strokeStyle = 'rgba(200,220,240,0.15)';
  ctx.lineWidth = 1;
  for (const w of d.wakeTrail) {
    const wx = toScreen(w.x);
    const spread = w.age * 2;
    ctx.globalAlpha = Math.max(0, 0.3 - w.age * 0.015);
    ctx.beginPath();
    ctx.moveTo(wx - spread, dy + 6);
    ctx.quadraticCurveTo(wx, dy + 6 + spread * 0.3, wx + spread, dy + 6);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Hull — long dark grey warship
  ctx.fillStyle = '#4a4a4a';
  ctx.beginPath();
  ctx.moveTo(dx - 45, dy);
  ctx.lineTo(dx - 35, dy - 8);
  ctx.lineTo(dx + 35, dy - 8);
  ctx.lineTo(dx + 50, dy - 2);
  ctx.lineTo(dx + 50, dy + 4);
  ctx.lineTo(dx - 45, dy + 4);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Superstructure
  ctx.fillStyle = '#555';
  ctx.fillRect(dx - 15, dy - 16, 25, 8);
  ctx.fillStyle = '#666';
  ctx.fillRect(dx - 10, dy - 22, 15, 6);

  // Radar dish (rotating)
  ctx.save();
  ctx.translate(dx, dy - 22);
  ctx.rotate(world.tick * 0.04);
  ctx.fillStyle = '#888';
  ctx.fillRect(-8, -1.5, 16, 3);
  ctx.restore();

  // Gun turret (forward)
  const gunDir = d.patrolDir;
  ctx.fillStyle = '#555';
  ctx.beginPath(); ctx.arc(dx + 25 * gunDir, dy - 10, 5, 0, TWO_PI); ctx.fill();
  ctx.fillStyle = '#444';
  ctx.fillRect(dx + 25 * gunDir, dy - 11, 12 * gunDir, 2);

  // Smoke stack
  ctx.fillStyle = '#3a3a3a';
  ctx.fillRect(dx + 3, dy - 28, 6, 6);
  // Smoke
  if (world.tick % 6 < 4) {
    ctx.fillStyle = 'rgba(80,80,80,0.3)';
    const smokeY = dy - 30 - (world.tick % 20) * 0.5;
    ctx.beginPath(); ctx.arc(dx + 6, smokeY, 3 + Math.random() * 2, 0, TWO_PI); ctx.fill();
  }

  // Alert indicator
  if (d.alertLevel === 2) {
    ctx.strokeStyle = 'rgba(231, 76, 60, 0.4)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.arc(dx, dy, DESTROYER_AA_RANGE, 0, TWO_PI); ctx.stroke();
    ctx.setLineDash([]);
  }

  // Health bar
  const hpPct = d.hp / d.maxHp;
  if (hpPct < 1) {
    const barW = 40;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(dx - barW/2, dy - 35, barW, 4);
    ctx.fillStyle = hpPct > 0.5 ? '#2ecc71' : hpPct > 0.25 ? '#f39c12' : '#e74c3c';
    ctx.fillRect(dx - barW/2, dy - 35, barW * hpPct, 4);
  }

  // Label
  ctx.fillStyle = '#e74c3c'; ctx.font = '9px Arial'; ctx.textAlign = 'center';
  ctx.fillText('DESTROYER', dx, dy - 38);

  ctx.restore();
}

// ============================================================
// INTERCEPTOR BOATS
// ============================================================
const INTERCEPTOR_TARGET_PARTS = ['wings', 'rudder', 'engine', 'tail'];

function damageSpecificPart(parts, partId, amount) {
  if (parts[partId] !== undefined && parts[partId] > 0) {
    parts[partId] = Math.max(0, parts[partId] - amount);
  } else {
    damageRandomPart(parts, amount);
  }
}

function updateInterceptors(dt) {
  const boats = world.terrain.interceptors;
  if (!boats) return;
  const sub = world.sub;

  for (const boat of boats) {
    if (boat.destroyed) continue;
    boat.stateTimer -= dt;
    boat.mgCooldown = Math.max(0, boat.mgCooldown - dt);
    boat.bazookaCooldown = Math.max(0, boat.bazookaCooldown - dt);

    const distToSub = Math.hypot(sub.worldX - boat.x, sub.y - boat.y);

    switch (boat.state) {
      case 'hiding':
        // Wait behind island until sub is in range
        if (distToSub < 350 && boat.stateTimer <= 0) {
          boat.state = 'rushing';
          boat.dir = sub.worldX > boat.x ? 1 : -1;
          boat.targetPart = INTERCEPTOR_TARGET_PARTS[Math.floor(Math.random() * INTERCEPTOR_TARGET_PARTS.length)];
        }
        break;

      case 'rushing':
        // Sprint toward the sub
        boat.x += boat.dir * INTERCEPTOR_SPEED * dt;
        // MG fire while closing
        if (distToSub < INTERCEPTOR_MG_RANGE && boat.mgCooldown <= 0 && sub.y < WATER_LINE + 20) {
          damageSpecificPart(sub.parts, boat.targetPart, INTERCEPTOR_MG_DAMAGE);
          boat.mgCooldown = INTERCEPTOR_MG_COOLDOWN;
          addParticles(sub.worldX + (Math.random() - 0.5) * 20, sub.y + (Math.random() - 0.5) * 10, 1, '#fbbf24');
        }
        // Decide to stop for bazooka
        if (boat.bazookaCooldown <= 0 && distToSub < 250 && distToSub > 80) {
          boat.state = 'stopping';
          boat.aimTimer = INTERCEPTOR_BAZOOKA_PAUSE;
        }
        // If overshot, retreat
        if (distToSub > 400 || boat.stateTimer < -300) {
          boat.state = 'retreating';
          boat.stateTimer = 120;
        }
        break;

      case 'stopping':
        // Brief stop before bazooka
        boat.aimTimer -= dt;
        if (boat.aimTimer <= 0) {
          boat.state = 'firing';
        }
        break;

      case 'firing': {
        // Fire bazooka — parabolic arc toward sub
        const dx = sub.worldX - boat.x;
        const dy = sub.y - boat.y;
        const dist = Math.max(50, Math.hypot(dx, dy));
        const vx = (dx / dist) * INTERCEPTOR_BAZOOKA_SPEED;
        const vy = -2.5; // Lob upward
        world.torpedoes.push({
          worldX: boat.x, y: boat.y - 8,
          vx, vy,
          phase: 'active', life: 140, trail: [],
          rogue: false, fromSub: false, active: true,
          bazooka: true,
        });
        SFX.missileLaunch();
        boat.bazookaCooldown = INTERCEPTOR_BAZOOKA_COOLDOWN;
        boat.state = 'rushing';
        boat.dir = sub.worldX > boat.x ? 1 : -1;
        break;
      }

      case 'retreating':
        // Head back toward home island
        const homeDir = boat.homeIsland.x > boat.x ? 1 : -1;
        boat.x += homeDir * INTERCEPTOR_SPEED * 0.8 * dt;
        if (Math.abs(boat.x - boat.homeIsland.x) < 40) {
          boat.state = 'hiding';
          boat.stateTimer = 200 + Math.random() * 300;
          boat.targetPart = null;
        }
        break;
    }

    // Take damage from player torpedoes
    world.torpedoes = world.torpedoes.filter((t) => {
      if (!t.fromSub) return true;
      if (Math.abs(t.worldX - boat.x) < 20 && Math.abs(t.y - boat.y) < 12) {
        boat.hp -= 25;
        addExplosion(t.worldX, t.y, 'small');
        SFX.explodeBig();
        if (boat.hp <= 0) {
          boat.destroyed = true;
          addExplosion(boat.x, boat.y, 'big');
          addParticles(boat.x, boat.y, 15, '#556b2f');
          world.score += 400;
          world.kills++;
          SFX.enemyDestroyed();
        }
        return false;
      }
      return true;
    });

    // Depth charges also very effective
    for (const charge of world.depthCharges) {
      if (boat.destroyed) break;
      const cdist = Math.hypot(charge.worldX - boat.x, charge.y - boat.y);
      if (cdist < DEPTH_CHARGE_BLAST_RADIUS * 0.4) {
        boat.hp -= 30;
        if (boat.hp <= 0) {
          boat.destroyed = true;
          addExplosion(boat.x, boat.y, 'big');
          addParticles(boat.x, boat.y, 15, '#556b2f');
          world.score += 400;
          world.kills++;
          SFX.enemyDestroyed();
        }
      }
    }
  }
}

function drawInterceptors() {
  const boats = world.terrain.interceptors;
  if (!boats) return;

  for (const boat of boats) {
    if (boat.destroyed) continue;
    const bx = toScreen(boat.x);
    if (bx < -60 || bx > W + 60) continue;
    const by = boat.y;

    ctx.save();

    // Camo transparency — harder to see
    const isHiding = boat.state === 'hiding';
    ctx.globalAlpha = isHiding ? INTERCEPTOR_CAMO_ALPHA * 0.5 : INTERCEPTOR_CAMO_ALPHA + 0.35;

    // Wake spray when moving fast
    if (boat.state === 'rushing' || boat.state === 'retreating') {
      ctx.fillStyle = 'rgba(200,220,240,0.25)';
      const wakeDir = -boat.dir;
      for (let s = 0; s < 3; s++) {
        ctx.beginPath();
        ctx.arc(bx + wakeDir * (12 + s * 6), by + 2 + Math.random() * 3, 2, 0, TWO_PI);
        ctx.fill();
      }
    }

    // Hull — small, low, camo-coloured
    const camo1 = '#556b2f'; // Olive drab
    const camo2 = '#4a5a28';
    const camo3 = '#6b7f3a';

    ctx.fillStyle = camo1;
    ctx.beginPath();
    ctx.moveTo(bx - 18, by);
    ctx.lineTo(bx - 14, by - 5);
    ctx.lineTo(bx + 14, by - 5);
    ctx.lineTo(bx + 20, by - 1);
    ctx.lineTo(bx + 20, by + 2);
    ctx.lineTo(bx - 18, by + 2);
    ctx.closePath();
    ctx.fill();

    // Camo stripe
    ctx.fillStyle = camo2;
    ctx.fillRect(bx - 10, by - 4, 12, 3);
    ctx.fillStyle = camo3;
    ctx.fillRect(bx + 2, by - 3, 10, 2);

    // MG turret
    ctx.fillStyle = '#444';
    ctx.beginPath(); ctx.arc(bx + 5, by - 7, 3, 0, TWO_PI); ctx.fill();
    // Gun barrel toward sub
    const gunAngle = Math.atan2(world.sub.y - by, world.sub.worldX - boat.x);
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(bx + 5, by - 7);
    ctx.lineTo(bx + 5 + Math.cos(gunAngle) * 10, by - 7 + Math.sin(gunAngle) * 10);
    ctx.stroke();

    // MG muzzle flash when firing
    if (boat.mgCooldown > INTERCEPTOR_MG_COOLDOWN * 0.7 && boat.state === 'rushing') {
      ctx.fillStyle = '#fbbf24';
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.arc(bx + 5 + Math.cos(gunAngle) * 12, by - 7 + Math.sin(gunAngle) * 12, 2.5, 0, TWO_PI);
      ctx.fill();
      ctx.globalAlpha = isHiding ? INTERCEPTOR_CAMO_ALPHA * 0.5 : INTERCEPTOR_CAMO_ALPHA + 0.35;
    }

    // Bazooka visible when stopping/aiming
    if (boat.state === 'stopping') {
      ctx.fillStyle = '#5a4a3a';
      ctx.fillRect(bx - 8, by - 10, 16, 3);
      // Aim indicator flash
      if (world.tick % 8 < 4) {
        ctx.fillStyle = 'rgba(255, 100, 50, 0.5)';
        ctx.beginPath(); ctx.arc(bx, by - 12, 4, 0, TWO_PI); ctx.fill();
      }
    }

    // Health bar (only when damaged or engaged)
    const hpPct = boat.hp / boat.maxHp;
    if (hpPct < 1 || boat.state !== 'hiding') {
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(bx - 12, by - 16, 24, 3);
      ctx.fillStyle = hpPct > 0.5 ? '#2ecc71' : '#e74c3c';
      ctx.fillRect(bx - 12, by - 16, 24 * hpPct, 3);
    }

    ctx.restore();
  }
}

// ============================================================
// АКУЛА-МОЛОТ (HAMMERHEAD) ENEMY SUBMARINE
// ============================================================
function isNearSonarBuoy(worldX, y, buoys) {
  for (const b of buoys) {
    if (Math.hypot(b.x - worldX, b.y - y) < AKULA_SONAR_BUOY_RADIUS) return true;
  }
  return false;
}

function updateAkulaMolot(dt) {
  const ak = world.terrain.akulaMolot;
  if (!ak || ak.destroyed) return;
  const sub = world.sub;

  // Sonar detection chain — deploy/reel decision
  const roughDistToSub = Math.hypot(sub.worldX - ak.x, sub.y - ak.y);
  const canSeeSubNormally = thermallyVisible(ak.y, sub.y) && !world.subInCave;
  ak.sonarChainCooldown = Math.max(0, ak.sonarChainCooldown - dt);

  if (!canSeeSubNormally && !ak.sonarChainDeployed && ak.sonarChainCooldown <= 0 && roughDistToSub < 500) {
    // Can't see sub — deploy sonar chain to detect across layers
    ak.sonarChainDeployed = true;
    ak.sonarChainLength = 0;
  } else if (canSeeSubNormally && ak.sonarChainDeployed && roughDistToSub < 200) {
    // Can see sub and it's close — reel in for speed to engage
    ak.sonarChainDeployed = false;
    ak.sonarChainLength = 0;
    ak.sonarChainCooldown = 150; // Don't immediately redeploy
  }

  // Grow/shrink chain
  if (ak.sonarChainDeployed) {
    ak.sonarChainLength = Math.min(AKULA_SONAR_CHAIN_MAX_LENGTH, ak.sonarChainLength + dt * 2);
  } else {
    ak.sonarChainLength = Math.max(0, ak.sonarChainLength - dt * 4);
  }

  // Speed/manoeuvrability penalty when chain is out
  const chainPenalty = ak.sonarChainLength > 10;
  const speedMult = chainPenalty ? AKULA_SONAR_CHAIN_SPEED_PENALTY : 1;
  const diveMult = chainPenalty ? AKULA_SONAR_CHAIN_TURN_PENALTY : 1;

  // Sonar chain detection — can the Akula see the sub across ALL layers?
  // Caterpillar drive defeats sonar chain — only direct same-layer sight works
  const sonarChainDetects = !sub.caterpillarDrive
    && ak.sonarChainLength > 50
    && Math.abs(sub.worldX - ak.x) < ak.sonarChainLength
    && !world.subInCave;
  const akulaCanDetect = (canSeeSubNormally && !sub.caterpillarDrive) || sonarChainDetects;

  // Patrol horizontally
  ak.x += ak.dir * AKULA_SPEED * speedMult * dt;
  if (ak.x > ak.patrolMax) ak.dir = -1;
  if (ak.x < ak.patrolMin) ak.dir = 1;

  // Depth behaviour — vary depth, can dive to floor
  const distToSub = Math.hypot(sub.worldX - ak.x, sub.y - ak.y);
  if (distToSub < 200 && sub.y > WATER_LINE) {
    // Sub is near and underwater — dive deep to evade
    ak.targetDepth = Math.min(SEA_FLOOR - 20, ak.y + 60);
    ak.diving = true;
  } else if (distToSub > 500) {
    // Cruise at medium depth
    ak.targetDepth = WATER_LINE + 60 + Math.sin(world.tick * 0.005) * 40;
    ak.diving = false;
  } else {
    // Engagement depth — stay below water but reachable
    ak.targetDepth = WATER_LINE + 40 + Math.sin(world.tick * 0.008) * 30;
    ak.diving = false;
  }
  // Smoothly move to target depth (penalised when chain deployed)
  const depthDiff = ak.targetDepth - ak.y;
  ak.y += Math.sign(depthDiff) * Math.min(Math.abs(depthDiff), AKULA_DIVE_SPEED * diveMult * dt);
  ak.y = Math.max(WATER_LINE + 15, Math.min(SEA_FLOOR - 15, ak.y));

  // Cloaking — intermittent cycle
  ak.cloakTimer += dt;
  const cyclePos = (ak.cloakTimer % AKULA_CLOAK_CYCLE) / AKULA_CLOAK_CYCLE;
  ak.cloaked = cyclePos < AKULA_CLOAK_ON_RATIO;

  // Sonar buoy trail
  ak.sonarBuoyCooldown = Math.max(0, ak.sonarBuoyCooldown - dt);
  if (ak.sonarBuoyCooldown <= 0) {
    ak.sonarBuoys.push({
      x: ak.x - ak.dir * 15,
      y: ak.y,
      life: AKULA_SONAR_BUOY_LIFESPAN,
      pulse: 0,
    });
    ak.sonarBuoyCooldown = AKULA_SONAR_BUOY_INTERVAL;
  }
  // Update buoys
  for (let i = ak.sonarBuoys.length - 1; i >= 0; i--) {
    const b = ak.sonarBuoys[i];
    b.life -= dt;
    b.pulse += dt * 0.06;
    if (b.life <= 0) ak.sonarBuoys.splice(i, 1);
  }

  // Cooldowns
  ak.samCooldown = Math.max(0, ak.samCooldown - dt);
  ak.torpedoCooldown = Math.max(0, ak.torpedoCooldown - dt);

  // SAM — fires from underwater, targets sub when in air (needs detection)
  if (ak.samCooldown <= 0 && sub.y < WATER_LINE - 10 && distToSub < 450 && akulaCanDetect) {
    const angle = Math.atan2(sub.y - ak.y, sub.worldX - ak.x);
    world.missiles.push({
      worldX: ak.x, y: ak.y - 5,
      vx: Math.cos(angle) * 1.5, vy: -3.5,
      phase: 'ignite', dropTimer: 0, life: 200, trail: [],
      fromEnemy: true, sam: true,
    });
    ak.samCooldown = AKULA_SAM_COOLDOWN;
    // Bubble burst on launch
    addParticles(ak.x, ak.y - 5, 8, '#85c1e9');
    SFX.missileLaunch();
  }

  // Torpedo — fires at sub when both underwater
  if (ak.torpedoCooldown <= 0 && sub.y > WATER_LINE && distToSub < 400 && akulaCanDetect) {
    const dir = sub.worldX > ak.x ? 1 : -1;
    world.torpedoes.push({
      worldX: ak.x + dir * 20, y: ak.y,
      vx: dir * TORPEDO_SPEED * 0.7, vy: (sub.y - ak.y) * 0.005,
      phase: 'skim', life: 250, trail: [],
      rogue: false, fromSub: false, active: true,
    });
    ak.torpedoCooldown = AKULA_TORPEDO_COOLDOWN;
    SFX.torpedoLaunch();
  }

  // Take damage from player torpedoes — sonar buoys reduce effectiveness
  world.torpedoes = world.torpedoes.filter((t) => {
    if (!t.fromSub) return true;
    if (Math.abs(t.worldX - ak.x) < 25 && Math.abs(t.y - ak.y) < 18) {
      // Check if sonar buoys protect
      const nearBuoy = isNearSonarBuoy(t.worldX, t.y, ak.sonarBuoys);
      if (nearBuoy && Math.random() < 0.6) {
        // Torpedo deflected by sonar interference
        t.vx += (Math.random() - 0.5) * 3;
        t.vy += (Math.random() - 0.5) * 2;
        addParticles(t.worldX, t.y, 4, '#60a5fa');
        world.caveMessage = { text: 'TORPEDO DEFLECTED BY SONAR FIELD', timer: 60 };
        return true; // Torpedo survives but is knocked off course
      }
      ak.hp -= 20;
      addExplosion(t.worldX, t.y, 'big');
      SFX.explodeBig();
      if (ak.hp <= 0) {
        ak.destroyed = true;
        addExplosion(ak.x, ak.y, 'big');
        addExplosion(ak.x + 15, ak.y + 5, 'big');
        addExplosion(ak.x - 10, ak.y - 8, 'big');
        addParticles(ak.x, ak.y, 25, AKULA_COLOR);
        world.score += 3000;
        world.kills++;
        world.caveMessage = { text: 'АКУЛА-МОЛОТ DESTROYED! +3000', timer: 180 };
        SFX.enemyDestroyed();
      }
      return false;
    }
    return true;
  });

  // Depth charges also effective
  for (const charge of world.depthCharges) {
    if (ak.destroyed) break;
    const cdist = Math.hypot(charge.worldX - ak.x, charge.y - ak.y);
    if (cdist < DEPTH_CHARGE_BLAST_RADIUS * 0.6) {
      ak.hp -= 18;
      if (ak.hp <= 0) {
        ak.destroyed = true;
        addExplosion(ak.x, ak.y, 'big');
        addParticles(ak.x, ak.y, 25, AKULA_COLOR);
        world.score += 3000;
        world.kills++;
        world.caveMessage = { text: 'АКУЛА-МОЛОТ DESTROYED! +3000', timer: 180 };
        SFX.enemyDestroyed();
      }
    }
  }
}

function drawAkulaMolot() {
  const ak = world.terrain.akulaMolot;
  if (!ak || ak.destroyed) return;
  // Thermal visibility — 2 layers apart = invisible
  if (!thermallyVisible(world.sub.y, ak.y)) return;
  const sx = toScreen(ak.x);
  if (sx < -80 || sx > W + 80) return;
  const sy = ak.y;

  ctx.save();

  // Sonar buoys first (behind the sub)
  for (const b of ak.sonarBuoys) {
    const bsx = toScreen(b.x);
    const bsy = b.y;
    const buoyAlpha = Math.max(0, 0.25 * (b.life / AKULA_SONAR_BUOY_LIFESPAN));
    // Pulsing ring
    ctx.globalAlpha = buoyAlpha;
    ctx.strokeStyle = '#60a5fa';
    ctx.lineWidth = 1;
    const pulseR = AKULA_SONAR_BUOY_RADIUS * (0.3 + 0.7 * (Math.sin(b.pulse) * 0.5 + 0.5));
    ctx.beginPath(); ctx.arc(bsx, bsy, pulseR, 0, TWO_PI); ctx.stroke();
    // Centre dot
    ctx.fillStyle = '#3b82f6';
    ctx.beginPath(); ctx.arc(bsx, bsy, 2, 0, TWO_PI); ctx.fill();
  }

  // Cloaked alpha
  const baseAlpha = ak.cloaked ? AKULA_CLOAK_ALPHA : 0.85;
  // Shimmer when transitioning
  const cyclePos = (ak.cloakTimer % AKULA_CLOAK_CYCLE) / AKULA_CLOAK_CYCLE;
  const transitionZone = 0.05;
  let alpha = baseAlpha;
  if (Math.abs(cyclePos - AKULA_CLOAK_ON_RATIO) < transitionZone) {
    alpha = 0.1 + Math.random() * 0.4; // Shimmer during transition
  }
  ctx.globalAlpha = alpha;

  const dir = ak.dir;
  const swim = Math.sin(world.tick * 0.04) * 2; // Gentle body undulation

  // --- Hammerhead shark body ---
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(dir, 1);

  // Main body — sleek tapered torpedo shape
  ctx.fillStyle = AKULA_COLOR;
  ctx.beginPath();
  ctx.moveTo(20, 0);                  // Nose centre
  ctx.quadraticCurveTo(12, -9, -8, -8);  // Upper body curve
  ctx.quadraticCurveTo(-28, -6, -36, -2 + swim * 0.3); // Taper to tail
  ctx.lineTo(-36, 2 + swim * 0.3);   // Tail bottom
  ctx.quadraticCurveTo(-28, 6, -8, 8);   // Lower body curve
  ctx.quadraticCurveTo(12, 9, 20, 0);    // Back to nose
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#5a0e0e';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Darker belly (countershading)
  ctx.fillStyle = '#6b1010';
  ctx.beginPath();
  ctx.moveTo(18, 2);
  ctx.quadraticCurveTo(10, 8, -8, 7);
  ctx.quadraticCurveTo(-26, 5, -34, 2 + swim * 0.3);
  ctx.lineTo(-34, 0);
  ctx.quadraticCurveTo(-20, 3, 18, 2);
  ctx.closePath();
  ctx.fill();

  // --- Hammerhead — wide flat T-shaped cephalofoil ---
  ctx.fillStyle = '#a02020';
  ctx.beginPath();
  ctx.moveTo(18, -2);                    // Attach to head
  ctx.lineTo(24, -12);                   // Upper left wing
  ctx.quadraticCurveTo(28, -13, 30, -11); // Rounded tip
  ctx.lineTo(26, -4);
  ctx.lineTo(20, -1);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(18, 2);                     // Attach to head
  ctx.lineTo(24, 12);                    // Lower right wing
  ctx.quadraticCurveTo(28, 13, 30, 11);  // Rounded tip
  ctx.lineTo(26, 4);
  ctx.lineTo(20, 1);
  ctx.closePath();
  ctx.fill();

  // Eyes on hammerhead tips
  ctx.fillStyle = '#ff4444';
  ctx.beginPath(); ctx.arc(28, -10, 2, 0, TWO_PI); ctx.fill();
  ctx.fillStyle = '#220000';
  ctx.beginPath(); ctx.arc(28.5, -10, 1, 0, TWO_PI); ctx.fill();
  ctx.fillStyle = '#ff4444';
  ctx.beginPath(); ctx.arc(28, 10, 2, 0, TWO_PI); ctx.fill();
  ctx.fillStyle = '#220000';
  ctx.beginPath(); ctx.arc(28.5, 10, 1, 0, TWO_PI); ctx.fill();

  // Dorsal fin
  ctx.fillStyle = '#7a1515';
  ctx.beginPath();
  ctx.moveTo(-2, -8);
  ctx.lineTo(2, -18);
  ctx.quadraticCurveTo(5, -19, 8, -16);
  ctx.lineTo(8, -8);
  ctx.closePath();
  ctx.fill();

  // Tail fin (caudal) — crescent shaped, oscillating
  ctx.fillStyle = '#6b1010';
  ctx.beginPath();
  ctx.moveTo(-34, -2 + swim * 0.3);
  ctx.lineTo(-42, -10 + swim);
  ctx.quadraticCurveTo(-44, -12 + swim, -40, -8 + swim * 0.5);
  ctx.lineTo(-36, 0 + swim * 0.3);
  ctx.lineTo(-40, 8 - swim * 0.5);
  ctx.quadraticCurveTo(-44, 12 - swim, -42, 10 - swim);
  ctx.lineTo(-34, 2 + swim * 0.3);
  ctx.closePath();
  ctx.fill();

  // Pectoral fins (small, mid-body)
  ctx.fillStyle = '#8b1a1a';
  ctx.beginPath();
  ctx.moveTo(-5, 7);
  ctx.lineTo(-12, 14);
  ctx.lineTo(-8, 7);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-5, -7);
  ctx.lineTo(-12, -14);
  ctx.lineTo(-8, -7);
  ctx.closePath();
  ctx.fill();

  // Gill slits
  ctx.strokeStyle = '#5a0e0e';
  ctx.lineWidth = 0.5;
  for (let g = 0; g < 4; g++) {
    ctx.beginPath();
    ctx.moveTo(10 - g * 3, -5);
    ctx.lineTo(10 - g * 3, -2);
    ctx.stroke();
  }

  // Torpedo tubes (in mouth area)
  ctx.fillStyle = '#333';
  ctx.beginPath(); ctx.arc(20, -1.5, 1.5, 0, TWO_PI); ctx.fill();
  ctx.beginPath(); ctx.arc(20, 1.5, 1.5, 0, TWO_PI); ctx.fill();

  // SAM hatches on back (subtle)
  ctx.fillStyle = '#4a0808';
  ctx.fillRect(-14, -9, 4, 2);
  ctx.fillRect(-6, -9, 4, 2);

  ctx.restore();

  // Propeller bubble wake (behind the shark)
  if (!ak.sonarChainDeployed || ak.sonarChainLength < 50) {
    ctx.fillStyle = 'rgba(133, 193, 233, 0.15)';
    for (let w = 0; w < 5; w++) {
      const age = (world.tick * 0.12 + w * 1.3) % 3;
      ctx.beginPath();
      ctx.arc(sx - dir * (38 + age * 7), sy + Math.sin(world.tick * 0.08 + w) * 3 + swim * 0.2, 1.5 + (1 - age / 3), 0, TWO_PI);
      ctx.fill();
    }
  }

  // Sonar detection chain (when deployed)
  if (ak.sonarChainLength > 10) {
    const chainLen = ak.sonarChainLength;
    const chainDir = -dir;
    ctx.strokeStyle = 'rgba(96, 165, 250, 0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(sx - dir * 28, sy + 3);
    // Chain trails behind, undulating through the water
    for (let c = 0; c < chainLen; c += 15) {
      const cx = sx + chainDir * (30 + c);
      const cy = sy + Math.sin(world.tick * 0.02 + c * 0.08) * 8 + (c / chainLen) * 20;
      ctx.lineTo(cx, cy);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    // Detection nodes along the chain
    ctx.fillStyle = 'rgba(96, 165, 250, 0.5)';
    for (let n = 0; n < chainLen; n += 50) {
      const nx = sx + chainDir * (30 + n);
      const ny = sy + Math.sin(world.tick * 0.02 + n * 0.08) * 8 + (n / chainLen) * 20;
      const nodePulse = 0.3 + 0.3 * Math.sin(world.tick * 0.08 + n * 0.1);
      ctx.globalAlpha = nodePulse;
      ctx.beginPath(); ctx.arc(nx, ny, 3, 0, TWO_PI); ctx.fill();
    }
  }

  ctx.globalAlpha = 1;

  // Health bar (only when visible enough)
  if (!ak.cloaked || alpha > 0.3) {
    const hpPct = ak.hp / ak.maxHp;
    if (hpPct < 1) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(sx - 20, sy - 28, 40, 4);
      ctx.fillStyle = hpPct > 0.5 ? '#2ecc71' : hpPct > 0.25 ? '#f39c12' : '#e74c3c';
      ctx.fillRect(sx - 20, sy - 28, 40 * hpPct, 4);
    }
    ctx.fillStyle = AKULA_COLOR;
    ctx.font = '8px Arial'; ctx.textAlign = 'center';
    ctx.fillText('АКУЛА-МОЛОТ', sx, sy - 30);
  }

  // Cloak shimmer effect
  if (ak.cloaked && alpha > AKULA_CLOAK_ALPHA) {
    ctx.strokeStyle = 'rgba(139, 26, 26, 0.12)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]);
    ctx.beginPath(); ctx.ellipse(sx, sy, 40, 16, 0, 0, TWO_PI); ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.restore();
}

// ============================================================
// ДЕЛЬФИН (DOLPHIN) ENEMY SUBMARINE
// ============================================================
function spawnBailCrew(delfin) {
  delfin.bailed = true;
  delfin.crew = [];
  for (let i = 0; i < DELFIN_CREW_COUNT; i++) {
    delfin.crew.push({
      x: delfin.x + (Math.random() - 0.5) * 20,
      y: delfin.y - 5 - i * 4,
      vy: -0.5 - Math.random() * 0.3,
      vx: (Math.random() - 0.5) * 0.6,
      bobPhase: Math.random() * Math.PI * 2,
      armWave: Math.random() * Math.PI * 2,
      surfaced: false,
    });
  }
}

function updateDelfins(dt) {
  const subs = world.terrain.delfins;
  if (!subs) return;
  const sub = world.sub;

  for (const d of subs) {
    if (d.destroyed) {
      // Update bailed crew
      for (const c of d.crew) {
        if (!c.surfaced) {
          c.y += c.vy * dt;
          c.x += c.vx * dt;
          if (c.y <= WATER_LINE + 2) {
            c.y = WATER_LINE + 2;
            c.surfaced = true;
          }
        } else {
          // Bob on surface, wave arms
          c.bobPhase += dt * 0.08;
          c.armWave += dt * 0.15;
          c.y = WATER_LINE + 2 + Math.sin(c.bobPhase) * 2;
          c.x += Math.sin(c.bobPhase * 0.3) * 0.02 * dt;
        }
      }
      continue;
    }

    const distToSub = Math.hypot(sub.worldX - d.x, sub.y - d.y);

    // Bail-out check at low HP
    if (!d.bailChecked && d.hp <= d.maxHp * DELFIN_BAIL_THRESHOLD) {
      d.bailChecked = true;
      if (Math.random() < DELFIN_BAIL_CHANCE) {
        spawnBailCrew(d);
        d.destroyed = true;
        addParticles(d.x, d.y, 10, '#9ca3af');
        world.caveMessage = { text: 'ДЕЛЬФИН CREW ABANDONING SHIP!', timer: 120 };
        world.score += 200;
        world.kills++;
        continue;
      }
    }

    // Patrol
    d.x += d.dir * DELFIN_SPEED * dt;
    if (d.x > d.patrolCenter + d.patrolRange / 2) d.dir = -1;
    if (d.x < d.patrolCenter - d.patrolRange / 2) d.dir = 1;

    // Depth — stays shallow-ish, surfaces to use MG
    if (distToSub < DELFIN_ENGAGE_RANGE && sub.y < WATER_LINE) {
      // Surface to engage with MG
      d.surfaced = true;
      d.y += (WATER_LINE - 4 - d.y) * 0.03 * dt;
    } else {
      d.surfaced = false;
      const cruiseDepth = WATER_LINE + 50 + Math.sin(world.tick * 0.006 + d.patrolCenter) * 25;
      d.y += (Math.min(DELFIN_MAX_DEPTH, cruiseDepth) - d.y) * 0.02 * dt;
    }
    d.y = Math.max(WATER_LINE - 4, Math.min(DELFIN_MAX_DEPTH, d.y));

    // Cooldowns
    d.torpedoCooldown = Math.max(0, d.torpedoCooldown - dt);
    d.mgCooldown = Math.max(0, d.mgCooldown - dt);

    // Fire-and-forget torpedo (straight line, no homing)
    if (d.torpedoCooldown <= 0 && distToSub < DELFIN_ENGAGE_RANGE && sub.y > WATER_LINE - 20) {
      const tdir = sub.worldX > d.x ? 1 : -1;
      const angle = Math.atan2(sub.y - d.y, sub.worldX - d.x);
      world.torpedoes.push({
        worldX: d.x + tdir * 15, y: d.y,
        vx: Math.cos(angle) * TORPEDO_SPEED * 0.6,
        vy: Math.sin(angle) * TORPEDO_SPEED * 0.4,
        phase: 'active', life: 160, trail: [],
        rogue: false, fromSub: false, active: true,
        bazooka: false,
      });
      d.torpedoCooldown = DELFIN_TORPEDO_COOLDOWN;
      SFX.torpedoLaunch();
    }

    // Surface MG (only when surfaced)
    if (d.surfaced && distToSub < DELFIN_MG_RANGE && d.mgCooldown <= 0 && sub.y < WATER_LINE + 10) {
      damageRandomPart(sub.parts, DELFIN_MG_DAMAGE);
      d.mgCooldown = DELFIN_MG_COOLDOWN;
      addParticles(sub.worldX + (Math.random() - 0.5) * 15, sub.y + (Math.random() - 0.5) * 8, 1, '#fbbf24');
    }

    // Take damage from player torpedoes
    world.torpedoes = world.torpedoes.filter((t) => {
      if (!t.fromSub) return true;
      if (Math.abs(t.worldX - d.x) < 20 && Math.abs(t.y - d.y) < 14) {
        d.hp -= 22;
        addExplosion(t.worldX, t.y, 'big');
        SFX.explodeBig();
        if (d.hp <= 0 && !d.bailed) {
          d.destroyed = true;
          addExplosion(d.x, d.y, 'big');
          addParticles(d.x, d.y, 18, DELFIN_COLOR);
          world.score += 600;
          world.kills++;
          SFX.enemyDestroyed();
        }
        return false;
      }
      return true;
    });

    // Depth charges
    for (const charge of world.depthCharges) {
      if (d.destroyed) break;
      const cdist = Math.hypot(charge.worldX - d.x, charge.y - d.y);
      if (cdist < DEPTH_CHARGE_BLAST_RADIUS * 0.5) {
        d.hp -= 15;
        if (d.hp <= 0 && !d.bailed) {
          d.destroyed = true;
          addExplosion(d.x, d.y, 'big');
          addParticles(d.x, d.y, 18, DELFIN_COLOR);
          world.score += 600;
          world.kills++;
          SFX.enemyDestroyed();
        }
      }
    }
  }
}

function drawDelfins() {
  const subs = world.terrain.delfins;
  if (!subs) return;

  for (const d of subs) {
    const sx = toScreen(d.x);
    if (sx < -60 || sx > W + 60) continue;

    // Draw bailed crew (even after sub is gone)
    if (d.destroyed && d.bailed) {
      for (const c of d.crew) {
        const cx = toScreen(c.x);
        const cy = c.y;
        ctx.save();
        ctx.globalAlpha = 0.9;

        // Life jacket (bright orange, oversized, silly)
        ctx.fillStyle = '#ff6b00';
        ctx.beginPath();
        ctx.ellipse(cx, cy - 2, 6, 8, 0, 0, TWO_PI);
        ctx.fill();

        // Head
        ctx.fillStyle = '#f5d0a9';
        ctx.beginPath(); ctx.arc(cx, cy - 10, 3.5, 0, TWO_PI); ctx.fill();

        // Waving arms (flailing)
        ctx.strokeStyle = '#f5d0a9';
        ctx.lineWidth = 1.5;
        const armAngle = Math.sin(c.armWave) * 0.8;
        ctx.beginPath();
        ctx.moveTo(cx - 5, cy - 4);
        ctx.lineTo(cx - 10, cy - 8 + Math.sin(c.armWave) * 5);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx + 5, cy - 4);
        ctx.lineTo(cx + 10, cy - 8 + Math.sin(c.armWave + 1.5) * 5);
        ctx.stroke();

        // Legs (dangling in water)
        if (c.surfaced) {
          ctx.strokeStyle = '#555';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(cx - 2, cy + 5);
          ctx.lineTo(cx - 3, cy + 12 + Math.sin(c.bobPhase + 0.5) * 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(cx + 2, cy + 5);
          ctx.lineTo(cx + 3, cy + 12 + Math.sin(c.bobPhase + 1.5) * 2);
          ctx.stroke();
        }

        // Scared expression (tiny)
        ctx.fillStyle = '#333';
        ctx.fillRect(cx - 2, cy - 11, 1, 1);
        ctx.fillRect(cx + 1, cy - 11, 1, 1);
        // Open mouth
        ctx.fillStyle = '#333';
        ctx.beginPath(); ctx.arc(cx, cy - 8.5, 1, 0, TWO_PI); ctx.fill();

        ctx.restore();
      }
      continue;
    }

    if (d.destroyed) continue;
    // Thermal visibility
    if (!thermallyVisible(world.sub.y, d.y)) continue;
    const sy = d.y;

    ctx.save();

    // Hull — grey, compact submarine
    ctx.fillStyle = DELFIN_COLOR;
    ctx.beginPath();
    ctx.ellipse(sx, sy, 20, 7, 0, 0, TWO_PI);
    ctx.fill();
    ctx.strokeStyle = '#4b5563';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Rounded nose
    const dir = d.dir;
    ctx.fillStyle = '#7f8c9d';
    ctx.beginPath();
    ctx.arc(sx + dir * 18, sy, 5, -Math.PI / 2, Math.PI / 2);
    ctx.fill();

    // Small conning tower
    ctx.fillStyle = '#555e6b';
    ctx.fillRect(sx - 3, sy - 11, 6, 5);

    // MG turret (visible when surfaced)
    if (d.surfaced) {
      ctx.fillStyle = '#444';
      ctx.beginPath(); ctx.arc(sx, sy - 13, 2.5, 0, TWO_PI); ctx.fill();
      const gunDir = world.sub.worldX > d.x ? 1 : -1;
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(sx, sy - 13);
      ctx.lineTo(sx + gunDir * 10, sy - 14);
      ctx.stroke();
      // Muzzle flash
      if (d.mgCooldown > DELFIN_MG_COOLDOWN * 0.6) {
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath(); ctx.arc(sx + gunDir * 12, sy - 14, 2, 0, TWO_PI); ctx.fill();
      }
    }

    // Torpedo tube
    ctx.fillStyle = '#333';
    ctx.beginPath(); ctx.arc(sx + dir * 18, sy, 1.5, 0, TWO_PI); ctx.fill();

    // Propeller
    ctx.strokeStyle = '#9ca3af';
    ctx.lineWidth = 1.5;
    const pa = world.tick * 0.08;
    ctx.beginPath();
    ctx.moveTo(sx - dir * 20, sy + Math.sin(pa) * 4);
    ctx.lineTo(sx - dir * 20, sy - Math.sin(pa) * 4);
    ctx.stroke();

    // Health bar
    const hpPct = d.hp / d.maxHp;
    if (hpPct < 1) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(sx - 16, sy - 20, 32, 3);
      ctx.fillStyle = hpPct > 0.5 ? '#2ecc71' : hpPct > 0.25 ? '#f39c12' : '#e74c3c';
      ctx.fillRect(sx - 16, sy - 20, 32 * hpPct, 3);
    }

    ctx.fillStyle = DELFIN_COLOR;
    ctx.font = '7px Arial'; ctx.textAlign = 'center';
    ctx.fillText('ДЕЛЬФИН', sx, sy - 22);

    ctx.restore();
  }
}

// ============================================================
// PASSENGER SHIP
// ============================================================
function updatePassengerShip(dt) {
  const ship = world.terrain.passengerShip;
  if (!ship || ship.destroyed) return;

  if (ship.moving) {
    // Move toward next island
    const targetX = ship.routeIslands[ship.currentStop];
    const dx = targetX - ship.x;
    if (Math.abs(dx) < 3) {
      ship.x = targetX;
      ship.moving = false;
      ship.dwellTimer = PASSENGER_DWELL_TIME;
    } else {
      ship.dir = dx > 0 ? 1 : -1;
      ship.x += ship.dir * PASSENGER_SHIP_SPEED * dt;
    }
  } else {
    // Dwell at island
    ship.dwellTimer -= dt;
    if (ship.dwellTimer <= 0) {
      ship.currentStop = (ship.currentStop + 1) % ship.routeIslands.length;
      ship.moving = true;
    }
  }

  // Take damage from player weapons
  world.torpedoes = world.torpedoes.filter((t) => {
    if (!t.fromSub) return true;
    if (Math.abs(t.worldX - ship.x) < 30 && Math.abs(t.y - ship.y) < 15) {
      ship.hp -= 20;
      addExplosion(t.worldX, t.y, 'big');
      SFX.explodeBig();
      if (ship.hp <= 0) {
        ship.destroyed = true;
        addExplosion(ship.x, ship.y, 'big');
        addExplosion(ship.x + 15, ship.y - 5, 'big');
        addParticles(ship.x, ship.y, 20, '#ecf0f1');
        world.score = 0;
        // Spawn survivors in the water
        const numSurvivors = 3 + Math.floor(Math.random() * 4);
        const clothColors = ['#dc2626', '#2563eb', '#16a34a', '#d97706', '#9333ea', '#db2777'];
        for (let s = 0; s < numSurvivors; s++) {
          ship.survivors.push({
            x: ship.x + (Math.random() - 0.5) * 50,
            y: ship.y - 4,
            vy: -0.8 - Math.random() * 0.5,
            vx: (Math.random() - 0.5) * 0.8,
            surfaced: false,
            rescued: false,
            bobPhase: Math.random() * Math.PI * 2,
            panicPhase: Math.random() * Math.PI * 2,
            clothColor: clothColors[s % clothColors.length],
            huddled: Math.random() < 0.4,
          });
        }
        world.caveMessage = { text: 'CIVILIAN SHIP DESTROYED — SURVIVORS IN WATER! SCORE ZERO', timer: 250 };
        SFX.gameOver();
      }
      return false;
    }
    return true;
  });

  // Update survivors
  const sub = world.sub;
  for (const s of ship.survivors) {
    if (s.rescued) continue;
    if (!s.surfaced) {
      s.y += s.vy * dt;
      s.x += s.vx * dt;
      if (s.y <= WATER_LINE + 3) {
        s.y = WATER_LINE + 3;
        s.surfaced = true;
      }
    } else {
      s.bobPhase += dt * 0.06;
      s.panicPhase += dt * 0.12;
      s.y = WATER_LINE + 3 + Math.sin(s.bobPhase) * 2;
      s.x += Math.sin(s.bobPhase * 0.2) * 0.01 * dt;
      // Rescue: sub parks close, floating, slow
      if (!sub.disembarked && sub.floating
        && Math.abs(sub.worldX - s.x) < 30
        && Math.hypot(sub.vx, sub.vy) < 1.5) {
        s.rescued = true;
        world.score += 500;
        world.caveMessage = { text: `SURVIVOR RESCUED! +500 (${ship.survivors.filter(sv => sv.rescued).length}/${ship.survivors.length})`, timer: 80 };
        SFX.embark();
      }
    }
  }
}

function drawPassengerShip() {
  const ship = world.terrain.passengerShip;
  if (!ship) return;

  // Draw survivors even when ship is destroyed
  for (const s of ship.survivors) {
    if (s.rescued) continue;
    const svx = toScreen(s.x);
    const svy = s.y;
    ctx.save();

    // Door Kickers hostage style: small huddled figure, bright clothing, frightened
    ctx.globalAlpha = 0.9;

    // Life preserver ring (if surfaced)
    if (s.surfaced) {
      ctx.strokeStyle = '#ff6b00';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(svx, svy, 5, 0, TWO_PI); ctx.stroke();
    }

    // Body (huddled crouch or upright treading)
    if (s.huddled) {
      // Curled up, knees drawn
      ctx.fillStyle = s.clothColor;
      ctx.beginPath(); ctx.ellipse(svx, svy - 3, 4, 6, 0.2, 0, TWO_PI); ctx.fill();
    } else {
      // Upright, waving
      ctx.fillStyle = s.clothColor;
      ctx.fillRect(svx - 2.5, svy - 8, 5, 9);
    }

    // Head
    ctx.fillStyle = '#f0c8a0';
    ctx.beginPath(); ctx.arc(svx, svy - 10, 3, 0, TWO_PI); ctx.fill();
    // Hair
    ctx.fillStyle = '#4a3520';
    ctx.beginPath(); ctx.arc(svx, svy - 11.5, 2.5, Math.PI, 0); ctx.fill();

    // Panicked arms waving
    if (!s.huddled && s.surfaced) {
      ctx.strokeStyle = '#f0c8a0';
      ctx.lineWidth = 1.5;
      const wave = Math.sin(s.panicPhase);
      ctx.beginPath();
      ctx.moveTo(svx - 3, svy - 6);
      ctx.lineTo(svx - 8, svy - 12 + wave * 4);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(svx + 3, svy - 6);
      ctx.lineTo(svx + 8, svy - 12 + Math.sin(s.panicPhase + 1.8) * 4);
      ctx.stroke();
    }

    // Rescue prompt when sub is nearby
    if (s.surfaced && !world.sub.disembarked) {
      const dist = Math.abs(world.sub.worldX - s.x);
      if (dist < 60) {
        ctx.fillStyle = '#fbbf24';
        ctx.font = '9px Arial'; ctx.textAlign = 'center';
        ctx.fillText('RESCUE', svx, svy - 18);
      }
    }

    ctx.restore();
  }

  if (ship.destroyed) return;
  const sx = toScreen(ship.x);
  if (sx < -80 || sx > W + 80) return;
  const sy = ship.y;

  ctx.save();

  // Hull — white civilian vessel
  ctx.fillStyle = '#f0f0f0';
  ctx.beginPath();
  ctx.moveTo(sx - 35, sy);
  ctx.lineTo(sx - 28, sy - 6);
  ctx.lineTo(sx + 28, sy - 6);
  ctx.lineTo(sx + 38, sy);
  ctx.lineTo(sx + 38, sy + 3);
  ctx.lineTo(sx - 35, sy + 3);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#bbb';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Waterline stripe
  ctx.fillStyle = '#1e40af';
  ctx.fillRect(sx - 35, sy + 1, 73, 2);

  // Superstructure
  ctx.fillStyle = '#e8e8e8';
  ctx.fillRect(sx - 18, sy - 14, 30, 8);
  ctx.fillStyle = '#ddd';
  ctx.fillRect(sx - 12, sy - 19, 18, 5);

  // Windows
  ctx.fillStyle = '#60a5fa';
  for (let w = 0; w < 6; w++) {
    ctx.fillRect(sx - 16 + w * 5, sy - 12, 3, 3);
  }

  // Funnel
  ctx.fillStyle = '#e74c3c';
  ctx.fillRect(sx + 2, sy - 24, 5, 5);
  ctx.fillStyle = '#222';
  ctx.fillRect(sx + 2, sy - 26, 5, 2);
  // Light smoke
  if (ship.moving && world.tick % 8 < 5) {
    ctx.fillStyle = 'rgba(150,150,150,0.2)';
    ctx.beginPath(); ctx.arc(sx + 4, sy - 28 - (world.tick % 15) * 0.3, 2, 0, TWO_PI); ctx.fill();
  }

  // People on deck (tiny dots)
  ctx.fillStyle = '#333';
  const peopleSeed = Math.floor(world.tick / 30);
  for (let p = 0; p < 4; p++) {
    const px = sx - 14 + p * 8 + Math.sin(peopleSeed + p * 1.7) * 2;
    ctx.fillRect(px, sy - 8, 2, 3);
    ctx.fillStyle = ['#c0392b', '#2980b9', '#27ae60', '#f39c12'][p];
    ctx.fillRect(px, sy - 9, 2, 1);
    ctx.fillStyle = '#333';
  }

  // Dwell indicator
  if (!ship.moving) {
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '8px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('DOCKED', sx, sy - 30);
  }

  // Health bar (only show if damaged)
  const hpPct = ship.hp / ship.maxHp;
  if (hpPct < 1) {
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(sx - 20, sy - 36, 40, 4);
    ctx.fillStyle = hpPct > 0.5 ? '#2ecc71' : '#f39c12';
    ctx.fillRect(sx - 20, sy - 36, 40 * hpPct, 4);
  }

  // Civilian label
  ctx.fillStyle = '#60a5fa'; ctx.font = '8px Arial'; ctx.textAlign = 'center';
  ctx.fillText('CIVILIAN', sx, sy - 38);

  ctx.restore();
}
