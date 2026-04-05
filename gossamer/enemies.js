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
const DELFIN_MAX_DEPTH = 420 + 180;  // WATER_LINE(420) + 180 — inlined because enemies.js loads before app_gossamer.js
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
   getThermalLayer, thermallyVisible, keyJustPressed,
   SQUADRON_HP */


// ── Motorcyclists — land defenders that patrol island tops ─────────────────
// Normal bikes patrol back and forth on their home island and fire at the sub.
// Evel Knievel is a special one-off who can jump between islands with a
// slow-motion matrix trail effect.
const MOTORCYCLE_HP = 2;
const MOTORCYCLE_SPEED = 1.6;
const MOTORCYCLE_MG_COOLDOWN = 14;
const MOTORCYCLE_MG_SPEED = 4;
const MOTORCYCLE_MG_DAMAGE = 1;
const MOTORCYCLE_MG_RANGE = 150;
const MOTORCYCLE_BULLET_LIFE = 40;
const EVEL_HP = 4;
const EVEL_SPEED = 2.8;
const EVEL_JUMP_SPEED = 5.5;     // Launch speed for island-to-island jump
const EVEL_JUMP_GRAVITY = 0.06;  // Gravity during jump (slow — matrix effect)
const EVEL_SCORE = 3000;
const EVEL_SWIM_SPEED = 0.4;     // Swimming speed after missed jump
const EVEL_CAPTURE_RADIUS = 28;  // How close commander must be to capture

// ── Shared air-enemy stealth check ──────────────────────────────────────────
// Returns true when the sub is hidden from air units (periscope mode or fully
// submerged). Air enemies should orbit/search instead of targeting directly.
function isSubHiddenFromAir(sub) {
  return sub.periscopeMode || sub.y > WATER_LINE + 8;
}

// ============================================================
// SOPWITH CAMEL — One per level. Passive until attacked, then
// turns into the Red Baron (skin peels off) with full acrobatics.
// Fires Sopwith-style bullet streams as a nod to the original game.
// ============================================================
const SOPWITH_SPEED = 1.8;
const SOPWITH_ACROBAT_SPEED = 3.2;  // Faster when angered — harder to track
const SOPWITH_FIRE_COOLDOWN = 5;
const SOPWITH_BULLET_SPEED = 4.5;
const SOPWITH_HP = 18;              // Tenacious — incredibly hard to put down
const SOPWITH_SCORE = 8000;         // Reward matches the difficulty
const SOPWITH_SELF_REPAIR = 0.008;  // Slowly patches itself up (HP/tick)
const SOPWITH_DODGE_RANGE = 55;     // Detects incoming projectiles within this radius
const SOPWITH_DODGE_COOLDOWN = 25;  // Minimum ticks between emergency dodges
const SOPWITH_GRAZE_CHANCE = 0.35;  // 35% chance a hit only grazes (half damage)

function createSopwith(terrain) {
  // Spawn in the middle third of the terrain, cruising high
  const startX = TERRAIN_LENGTH * 0.3 + Math.random() * TERRAIN_LENGTH * 0.4;
  return {
    x: startX,
    y: 50 + Math.random() * 40,
    vx: (Math.random() < 0.5 ? 1 : -1) * SOPWITH_SPEED,
    vy: 0,
    hp: SOPWITH_HP,
    maxHp: SOPWITH_HP,
    angered: false,        // Turns true on first hit — becomes Red Baron
    acrobatPhase: 0,       // Phase of current acrobatic manoeuvre
    acrobatTimer: 0,       // Ticks into current manoeuvre
    manoeuvre: 'cruise',   // cruise, loop, immelmann, chandelle, barrelRoll, strafingRun, snapTurn, splitS
    fireCooldown: 0,
    bullets: [],           // Sopwith-style bullet objects
    alive: true,
    scarfPhase: 0,         // Scarf flutter animation
    dodgeCooldown: 0,      // Ticks until next emergency dodge allowed
    dodging: false,        // True during an emergency evasion
    dodgeDir: 1,           // Direction of current dodge
    timesHit: 0,           // Track total hits — gets wilier with each
    lastHitTick: 0,        // When last hit — affects repair rate
    // Aggro target — the Baron attacks whoever hit him first, then swaps
    // to anyone else who lands a hit (sub, radar SAMs, Evel, interceptors).
    target: null,          // Current target (object reference)
    targetKind: null,      // 'sub' | 'motorcyclist' | 'interceptor' | 'radar'
  };
}

// Read a target's world position — works across units with (worldX,y) or (x,y).
function sopwithTargetPos(t) {
  if (!t) return null;
  const x = t.worldX !== undefined ? t.worldX : t.x;
  return { x, y: t.y };
}

// Is the given target still a valid thing to chase?
function sopwithTargetValid(t) {
  if (!t) return false;
  if (t.destroyed) return false;
  if (t.alive === false) return false;
  return true;
}

function updateSopwith(dt) {
  const sw = world.sopwith;
  if (!sw || !sw.alive) return;
  const sub = world.sub;
  sw.scarfPhase += dt * 0.12;
  sw.dodgeCooldown = Math.max(0, sw.dodgeCooldown - dt);

  // ── Self-repair — the Baron is relentless, slowly patching his plane ──
  if (sw.angered && sw.hp < sw.maxHp) {
    // Repairs faster when not recently hit (30 ticks grace period)
    const repairRate = (world.tick - sw.lastHitTick > 30) ? SOPWITH_SELF_REPAIR * 2 : SOPWITH_SELF_REPAIR;
    sw.hp = Math.min(sw.maxHp, sw.hp + repairRate * dt);
  }

  // Update bullets — they can hurt the sub OR whichever enemy the Baron is
  // currently aggroed on (a Sopwith fight is a genuine dogfight).
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
    // Hit current non-sub target? (Evel, interceptor, radar, etc.)
    const tgt = sw.target;
    if (tgt && tgt !== sub && sopwithTargetValid(tgt)) {
      const tx = tgt.worldX !== undefined ? tgt.worldX : tgt.x;
      if (Math.abs(b.x - tx) < 14 && Math.abs(b.y - tgt.y) < 10) {
        // Apply damage appropriately for the target kind
        if (tgt.hp !== undefined) tgt.hp -= 3;
        addParticles(tx, tgt.y, 3, '#fbbf24');
        SFX.damage();
        sw.bullets.splice(i, 1);
        continue;
      }
    }
    if (b.life <= 0 || b.y > WATER_LINE || b.y < 5) sw.bullets.splice(i, 1);
  }

  // ── Emergency evasion — detect incoming projectiles and dodge ──
  // The Baron has preternatural awareness of incoming fire. When a projectile
  // enters his danger zone he snaps into an evasive manoeuvre instantly.
  if (sw.angered && sw.dodgeCooldown <= 0) {
    let threatened = false;
    let threatX = 0, threatY = 0;
    // Check all player projectile types
    const allProjectiles = [
      ...world.torpedoes.filter(t => t.fromSub !== false),
      ...world.missiles.filter(m => !m.fromEnemy),
      ...world.subMgBullets,
      ...world.railgunShots,
    ];
    for (const p of allProjectiles) {
      const px = p.worldX || p.x;
      const py = p.y;
      const dist = Math.hypot(px - sw.x, py - sw.y);
      // Check if projectile is approaching (closing distance)
      const closing = (p.vx || 0) * (sw.x - px) + (p.vy || 0) * (sw.y - py) > 0;
      if (dist < SOPWITH_DODGE_RANGE && closing) {
        threatened = true;
        threatX = px; threatY = py;
        break;
      }
    }
    if (threatened) {
      // Snap evasion — pick direction away from threat
      const awayAngle = Math.atan2(sw.y - threatY, sw.x - threatX);
      const dodgeSpeed = SOPWITH_ACROBAT_SPEED * 1.5;
      // Perpendicular dodge (more effective than running directly away)
      const perpAngle = awayAngle + (Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
      sw.vx = Math.cos(perpAngle) * dodgeSpeed;
      sw.vy = Math.sin(perpAngle) * dodgeSpeed;
      sw.dodgeCooldown = SOPWITH_DODGE_COOLDOWN;
      sw.dodging = true;
      // Cycle to evasive manoeuvre
      const evasive = ['barrelRoll', 'splitS', 'snapTurn'];
      sw.manoeuvre = evasive[Math.floor(Math.random() * evasive.length)];
      sw.acrobatTimer = 0;
    }
  }

  // Check if ANY projectile hits the Sopwith — player weapons, stray enemy fire, anything.
  // Any hit awakens the Red Baron. He doesn't care who shot him.
  sw.fireCooldown = Math.max(0, sw.fireCooldown - dt);

  // Hitbox shrinks during acrobatic manoeuvres — harder to land a clean hit
  const acrobatic = sw.angered && (sw.manoeuvre === 'barrelRoll' || sw.manoeuvre === 'splitS'
    || sw.manoeuvre === 'snapTurn' || sw.manoeuvre === 'loop');
  const hitShrink = acrobatic ? 0.6 : 1.0;

  function awakenBaron() {
    if (!sw.angered) {
      sw.angered = true;
      sw.manoeuvre = 'immelmann';
      sw.acrobatTimer = 0;
      midNotice('THE RED BARON AWAKENS!', 120);
    }
  }

  // Record a hit and re-target onto the attacker. Attribution lets the Baron
  // retaliate against whoever actually shot him — sub, radar SAM, Evel, an
  // interceptor that missed its real target — not just the player every time.
  function setAttacker(attacker, kind) {
    if (!sopwithTargetValid(attacker)) return;
    if (sw.target !== attacker) {
      sw.target = attacker;
      sw.targetKind = kind;
      sw.manoeuvre = 'chase';
      sw.acrobatTimer = 0;
      // Visible feedback so the player can see the Baron switching targets.
      // (Previously it looked like he always attacked the sub no matter who
      // shot him; this makes the aggro swap observable.)
      const label = kind === 'sub' ? 'the sub'
                  : kind === 'motorcyclist' && attacker.isEvel ? 'Evel Knievel'
                  : kind === 'motorcyclist' ? 'a motorcyclist'
                  : kind === 'radar' ? 'a radar tower'
                  : kind === 'interceptor' ? 'an interceptor'
                  : 'someone';
      if (typeof ticker === 'function') ticker(`Red Baron targets ${label}!`, 60);
    }
  }

  // Graze mechanic — the Baron's wild manoeuvres cause some shots to only clip him
  function applyDamage(baseDmg, attacker, kind) {
    sw.lastHitTick = world.tick;
    sw.timesHit++;
    // Gets increasingly evasive with each hit (dodge cooldown drops)
    sw.dodgeCooldown = Math.max(0, sw.dodgeCooldown - 10);
    setAttacker(attacker, kind);
    if (sw.angered && Math.random() < SOPWITH_GRAZE_CHANCE) {
      // Glancing hit — half damage
      sw.hp -= baseDmg * 0.5;
      addParticles(sw.x, sw.y, 2, '#aaa');
      return;
    }
    sw.hp -= baseDmg;
  }

  // Player torpedoes
  for (let i = world.torpedoes.length - 1; i >= 0; i--) {
    const t = world.torpedoes[i];
    if (t.fromSub === false) continue; // Enemy torpedoes handled below
    if (Math.abs(t.worldX - sw.x) < 20 * hitShrink && Math.abs(t.y - sw.y) < 14 * hitShrink) {
      applyDamage(1, sub, 'sub'); awakenBaron();
      addExplosion(sw.x, sw.y, 'small'); SFX.explodeSmall();
      world.torpedoes.splice(i, 1); break;
    }
  }
  // Player missiles
  for (let i = world.missiles.length - 1; i >= 0; i--) {
    const m = world.missiles[i];
    if (m.fromEnemy) continue; // Enemy missiles handled below
    if (Math.abs(m.worldX - sw.x) < 20 * hitShrink && Math.abs(m.y - sw.y) < 14 * hitShrink) {
      applyDamage(2, sub, 'sub'); awakenBaron();
      addExplosion(sw.x, sw.y, 'small'); SFX.explodeSmall();
      world.missiles.splice(i, 1); break;
    }
  }
  // Sub MG bullets
  for (let i = world.subMgBullets.length - 1; i >= 0; i--) {
    const b = world.subMgBullets[i];
    if (Math.abs(b.worldX - sw.x) < 14 * hitShrink && Math.abs(b.y - sw.y) < 10 * hitShrink) {
      applyDamage(1, sub, 'sub'); awakenBaron();
      addExplosion(sw.x, sw.y, 'small'); SFX.explodeSmall();
      world.subMgBullets.splice(i, 1); break;
    }
  }
  // Railgun (pierces but still damages — even the Baron fears this)
  for (const r of world.railgunShots) {
    if (Math.abs(r.worldX - sw.x) < 16 * hitShrink && Math.abs(r.y - sw.y) < 12 * hitShrink) {
      applyDamage(3, sub, 'sub'); awakenBaron();
      addExplosion(sw.x, sw.y, 'big'); SFX.explodeBig(); break;
    }
  }
  // Stray enemy bullets (Lightning, Berkut, Nemesis — any bullet that hits him)
  for (const li of world.airInterceptors) {
    if (!li.alive) continue;
    for (let i = li.bullets.length - 1; i >= 0; i--) {
      const b = li.bullets[i];
      if (Math.abs(b.x - sw.x) < 12 * hitShrink && Math.abs(b.y - sw.y) < 8 * hitShrink) {
        applyDamage(1, li, 'interceptor'); awakenBaron();
        addExplosion(sw.x, sw.y, 'small'); SFX.explodeSmall();
        li.bullets.splice(i, 1); break;
      }
    }
  }
  // Stray motorcyclist bullets (Evel and other bikers — yes, even Evel can
  // piss off the Baron with a wild potshot from a bike).
  if (world.terrain && world.terrain.motorcyclists) {
    for (const mc of world.terrain.motorcyclists) {
      if (!mc.alive || !mc.bullets) continue;
      for (let i = mc.bullets.length - 1; i >= 0; i--) {
        const b = mc.bullets[i];
        if (Math.abs(b.x - sw.x) < 12 * hitShrink && Math.abs(b.y - sw.y) < 8 * hitShrink) {
          applyDamage(1, mc, 'motorcyclist'); awakenBaron();
          addExplosion(sw.x, sw.y, 'small'); SFX.explodeSmall();
          mc.bullets.splice(i, 1); break;
        }
      }
    }
  }
  // Stray enemy missiles — SAMs from radar towers that wander into his path.
  // These home on the sub but can clip the Baron if he's between radar + sub.
  for (let i = world.missiles.length - 1; i >= 0; i--) {
    const m = world.missiles[i];
    if (!m.fromEnemy) continue;
    if (Math.abs(m.worldX - sw.x) < 18 * hitShrink && Math.abs(m.y - sw.y) < 12 * hitShrink) {
      // Attribute to source radar if tagged, else to a generic "radar" marker
      const attacker = m.sourceRadar || m.owner || null;
      applyDamage(2, attacker, attacker ? 'radar' : null);
      awakenBaron();
      addExplosion(sw.x, sw.y, 'small'); SFX.explodeSmall();
      world.missiles.splice(i, 1); break;
    }
  }

  // Death — takes a LOT to bring him down
  if (sw.hp <= 0) {
    sw.alive = false;
    addExplosion(sw.x, sw.y, 'big');
    addExplosion(sw.x - 10, sw.y + 5, 'big');
    addParticles(sw.x, sw.y, 30, '#e74c3c');
    addParticles(sw.x, sw.y, 15, '#fbbf24');
    world.score += SOPWITH_SCORE;
    world.kills++;
    midNotice('THE RED BARON IS FINALLY DOWN!', 150);
    actionIcon('2b50', 60, '#fbbf24');
    SFX.enemyDestroyed();
    return;
  }

  // Damage smoke/fire trail (visible hint that you're making progress)
  const hpPct = sw.hp / sw.maxHp;
  if (hpPct < 0.7) {
    if (world.tick % (hpPct < 0.3 ? 2 : 5) === 0) {
      const smokeColor = hpPct < 0.3 ? '#ff6600' : '#888';
      addParticles(sw.x - (sw.vx > 0 ? 8 : -8), sw.y + 2, 1, smokeColor);
    }
  }

  // Resolve aggro target — if the chosen target died/destroyed, fall back to
  // the sub (the Baron will still chase *someone*).
  if (!sopwithTargetValid(sw.target)) {
    sw.target = sub;
    sw.targetKind = 'sub';
  }
  const target = sw.target;
  const targetIsSub = (target === sub);
  const targetPos = sopwithTargetPos(target);
  const tX = targetPos.x, tY = targetPos.y;
  const distToTarget = Math.hypot(tX - sw.x, tY - sw.y);
  const distToSub = distToTarget; // preserved name for existing chandelle/strafe logic
  const speed = sw.angered ? SOPWITH_ACROBAT_SPEED : SOPWITH_SPEED;
  // Direction choice: when far from the target, force `dir` toward the target
  // so acrobatic manoeuvres (which use `dir` instead of angleToSub) don't
  // drift the Baron off into the map edge and stay there.
  const dxToTarget = tX - sw.x;
  const farFromTarget = distToTarget > W * 0.75; // ~600px at 800 canvas
  const dir = farFromTarget
    ? (dxToTarget >= 0 ? 1 : -1)
    : (sw.vx >= 0 ? 1 : -1);

  // When the Baron wanders too far from his target (off-screen + drifting),
  // abandon whatever manoeuvre he's in and strafe straight at the target.
  if (sw.angered && farFromTarget
      && sw.manoeuvre !== 'strafingRun' && sw.manoeuvre !== 'chandelle') {
    sw.manoeuvre = 'strafingRun';
    sw.acrobatTimer = 0;
  }

  if (!sw.angered) {
    // PASSIVE MODE — oblivious biplane buzzing along at low altitude,
    // bobbing gently, occasionally dipping near the waterline as if
    // sightseeing in a warzone without a care in the world.
    sw.x += sw.vx * dt;
    sw.vy = Math.sin(world.tick * 0.015 + sw.scarfPhase) * 0.5
          + Math.sin(world.tick * 0.004) * 0.3; // Lazy undulation
    sw.y += sw.vy * dt;
    sw.y = clamp(sw.y, WATER_LINE - 120, WATER_LINE - 18); // Low — skimming near the water
    // Reverse at terrain edges
    if (sw.x < 100 || sw.x > TERRAIN_LENGTH - 100) sw.vx = -sw.vx;
  } else {
    // RED BARON MODE — retro Sopwith arcade style on purpose. 8-directional
    // movement, straight-line MG bursts, visible loop-the-loops, occasional
    // stalls and recoveries. Comic, chunky, out of place — all intentional.
    sw.acrobatTimer += dt;
    const hidden = targetIsSub && isSubHiddenFromAir(sub);
    if (!hidden) { sw._lastKnownX = tX; sw._lastKnownY = tY; }
    const tgtX = hidden ? (sw._lastKnownX || tX) : tX;
    const tgtY = hidden ? Math.min(sw._lastKnownY || tY, WATER_LINE - 35) : tY;

    // 8-direction unit vectors, clockwise from "right" (E,SE,S,SW,W,NW,N,NE)
    const DIRS8 = [
      [ 1,  0], [ 0.7071,  0.7071], [ 0,  1], [-0.7071,  0.7071],
      [-1,  0], [-0.7071, -0.7071], [ 0, -1], [ 0.7071, -0.7071],
    ];
    function quantize8(dx, dy) {
      const a = Math.atan2(dy, dx);
      // Map -π..π to 0..7 by rounding to nearest eighth turn
      let idx = Math.round((a / (Math.PI / 4)) + 8) % 8;
      if (idx < 0) idx += 8;
      return idx;
    }

    // Sane retro states: 'chase', 'loop', 'stall', 'recover'
    if (sw.manoeuvre !== 'chase' && sw.manoeuvre !== 'loop'
        && sw.manoeuvre !== 'stall' && sw.manoeuvre !== 'recover') {
      sw.manoeuvre = 'chase';
      sw.acrobatTimer = 0;
    }

    // ── STALL chance — unpredictable, ruins whatever he's doing ──
    // More likely when wounded ("oil everywhere, engine coughing").
    const stallChance = 0.002 + (1 - hpPct) * 0.004; // ~0.2% → 0.6% per tick
    if (sw.manoeuvre !== 'stall' && sw.manoeuvre !== 'recover'
        && Math.random() < stallChance * dt) {
      sw.manoeuvre = 'stall';
      sw.acrobatTimer = 0;
      sw._stallSpinPhase = 0;
    }

    switch (sw.manoeuvre) {
      case 'chase': {
        // Snap heading to the nearest 8-dir toward the target. No smooth
        // interpolation — the whole plane "clicks" into its new heading
        // every few ticks like the original arcade cabinet.
        if (!sw._dirLockTimer || sw._dirLockTimer <= 0) {
          sw._dirIdx = quantize8(tgtX - sw.x, tgtY - sw.y);
          sw._dirLockTimer = 6 + Math.floor(Math.random() * 4); // re-aim every 6-9 ticks
        } else {
          sw._dirLockTimer -= dt;
        }
        const [ux, uy] = DIRS8[sw._dirIdx];
        sw.vx = ux * speed;
        sw.vy = uy * speed;
        // Straight-line MG burst along current heading — no targeting
        if (sw.fireCooldown <= 0 && distToTarget < 340 && !hidden) {
          sw.bullets.push({
            x: sw.x, y: sw.y,
            vx: ux * SOPWITH_BULLET_SPEED,
            vy: uy * SOPWITH_BULLET_SPEED,
            life: 80,
          });
          if (hpPct < 0.5) {
            // Damaged: pilot panics and fires a second round immediately
            sw.bullets.push({
              x: sw.x, y: sw.y + 3,
              vx: ux * SOPWITH_BULLET_SPEED,
              vy: uy * SOPWITH_BULLET_SPEED,
              life: 80,
            });
          }
          sw.fireCooldown = SOPWITH_FIRE_COOLDOWN;
        }
        // Trigger a loop periodically — longer cooldown when healthy, more
        // frequent when taking a beating (confused, flailing).
        const loopWait = Math.max(50, 140 * hpPct);
        if (sw.acrobatTimer > loopWait && Math.random() < 0.02 * dt) {
          sw.manoeuvre = 'loop';
          sw.acrobatTimer = 0;
          sw._loopStartIdx = sw._dirIdx || 0;
        }
        break;
      }
      case 'loop': {
        // Visible circular loop — cycle through all 8 directions in order.
        // Each 1/8 of the loop takes ~7 ticks, so the full loop is ~56 ticks.
        const tickPerStep = 7;
        const step = Math.floor(sw.acrobatTimer / tickPerStep);
        const loopIdx = ((sw._loopStartIdx || 0) + step) % 8;
        const [ux, uy] = DIRS8[loopIdx];
        sw.vx = ux * speed * 1.1;
        sw.vy = uy * speed * 1.1;
        sw._dirIdx = loopIdx;
        // No firing during loop
        if (step >= 8) {
          sw.manoeuvre = 'chase';
          sw.acrobatTimer = 0;
          sw._dirLockTimer = 0;
        }
        break;
      }
      case 'stall': {
        // Engine sputters, plane tumbles and falls. Slight wobble, no firing.
        sw._stallSpinPhase = (sw._stallSpinPhase || 0) + dt * 0.4;
        sw.vx *= 0.92;
        sw.vy += 0.08 * dt; // gravity drag
        sw.vx += Math.sin(sw._stallSpinPhase) * 0.15 * dt; // comical wobble
        if (world.tick % 20 === 0) {
          addParticles(sw.x, sw.y, 2, '#555'); // black smoke puff
        }
        // Bail out if we get dangerously low
        if (sw.acrobatTimer > 30 || sw.y > WATER_LINE - 40) {
          sw.manoeuvre = 'recover';
          sw.acrobatTimer = 0;
        }
        break;
      }
      case 'recover': {
        // Power climb — full throttle up and forward toward target.
        const recoverIdx = tgtX > sw.x ? 7 : 5; // NE or NW
        const [ux, uy] = DIRS8[recoverIdx];
        sw.vx = ux * speed * 1.2;
        sw.vy = uy * speed * 1.2;
        sw._dirIdx = recoverIdx;
        if (sw.acrobatTimer > 18) {
          sw.manoeuvre = 'chase';
          sw.acrobatTimer = 0;
          sw._dirLockTimer = 0;
        }
        break;
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

  // Health bar — only when angered and damaged (so player can see progress)
  if (sw.angered && sw.hp < sw.maxHp) {
    const hpPct = sw.hp / sw.maxHp;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(sx - 14, sw.y - 18, 28, 3);
    ctx.fillStyle = hpPct > 0.6 ? '#cc1100' : hpPct > 0.3 ? '#ff6600' : '#ffcc00';
    ctx.fillRect(sx - 14, sw.y - 18, 28 * hpPct, 3);
    // Label
    ctx.fillStyle = '#cc1100';
    ctx.font = '7px Arial'; ctx.textAlign = 'center';
    ctx.fillText('RED BARON', sx, sw.y - 20);
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
    hudFlash('Su-47 BERKUT INBOUND', 100, '#ef4444');
  }
  const bk = world.airSupremacy;
  if (!bk || !bk.alive) return;
  const sub = world.sub;
  // Periscope / underwater stealth: Berkut loses track
  const hidden = isSubHiddenFromAir(sub);
  if (!hidden) { bk._lastKnownX = sub.worldX; bk._lastKnownY = sub.y; }
  const tgtX = hidden ? (bk._lastKnownX || sub.worldX) : sub.worldX;
  const tgtY = hidden ? Math.min(bk._lastKnownY || sub.y, WATER_LINE - 30) : sub.y;
  const dist = Math.hypot(tgtX - bk.x, tgtY - bk.y);
  const dir = bk.vx >= 0 ? 1 : -1;
  const angleToSub = Math.atan2(tgtY - bk.y, tgtX - bk.x);

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
    ticker('Su-47 Berkut destroyed!', 70); actionIcon('2b50', 50, '#fbbf24');
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

      // MG — close range (only when sub is visible)
      if (dist < 150 && bk.mgCooldown <= 0 && !hidden && sub.y < WATER_LINE) {
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
      if (dist < 350 && dist > 80 && bk.rocketCooldown <= 0 && !hidden && sub.y < WATER_LINE) {
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
      if (dist > 150 && bk.seekerCooldown <= 0 && !hidden && sub.y < WATER_LINE) {
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
      if (Math.abs(bk.x - sub.worldX) < 40 && bk.y < sub.y && sub.floating && !hidden && bk.bombCooldown <= 0) {
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

  // ── Kamikaze air drones — Berkut deploys small pursuit drones ──
  if (!bk.drones) bk.drones = [];
  if (!bk._droneCooldown) bk._droneCooldown = 300; // Delay before first drone
  bk._droneCooldown = Math.max(0, bk._droneCooldown - dt);
  // Deploy a drone when in engage state, max 3 active
  if (bk.state === 'engage' && bk._droneCooldown <= 0 && bk.drones.length < 3 && !hidden) {
    bk.drones.push({
      x: bk.x, y: bk.y,
      vx: Math.cos(angleToSub) * 3, vy: Math.sin(angleToSub) * 3,
      hp: 1, life: 300,
      trail: [],
    });
    bk._droneCooldown = 200;
    ticker('Berkut deploys kamikaze drone!', 50);
  }
  // Update drones
  for (let i = bk.drones.length - 1; i >= 0; i--) {
    const d = bk.drones[i];
    d.life -= dt;
    // Chase sub
    const dAngle = Math.atan2(sub.y - d.y, sub.worldX - d.x);
    d.vx += Math.cos(dAngle) * 0.2 * dt;
    d.vy += Math.sin(dAngle) * 0.15 * dt;
    const dSpd = Math.hypot(d.vx, d.vy);
    if (dSpd > 4) { d.vx *= 4 / dSpd; d.vy *= 4 / dSpd; }
    d.x += d.vx * dt; d.y += d.vy * dt;
    d.y = clamp(d.y, 15, WATER_LINE - 5);
    // Trail
    if (world.tick % 3 === 0) {
      d.trail.push({ x: d.x, y: d.y, age: 0 });
      if (d.trail.length > 8) d.trail.shift();
    }
    d.trail.forEach(t => t.age += dt);
    // Hit sub — kamikaze explosion
    if (Math.abs(d.x - sub.worldX) < 14 && Math.abs(d.y - sub.y) < 10) {
      damageRandomPart(sub.parts, 6);
      addExplosion(d.x, d.y, 'small');
      SFX.explodeSmall();
      bk.drones.splice(i, 1); continue;
    }
    // Intercept incoming missiles/torpedoes (drone sacrifices itself)
    let intercepted = false;
    for (let j = world.missiles.length - 1; j >= 0; j--) {
      const m = world.missiles[j];
      if (m.fromEnemy) continue;
      if (Math.hypot(m.worldX - d.x, m.y - d.y) < 20) {
        addExplosion(d.x, d.y, 'small');
        world.missiles.splice(j, 1);
        intercepted = true; break;
      }
    }
    if (intercepted) { bk.drones.splice(i, 1); continue; }
    // Player can shoot them down
    for (let j = world.subMgBullets.length - 1; j >= 0; j--) {
      const b = world.subMgBullets[j];
      if (Math.abs(b.worldX - d.x) < 10 && Math.abs(b.y - d.y) < 8) {
        addExplosion(d.x, d.y, 'small');
        world.subMgBullets.splice(j, 1);
        bk.drones.splice(i, 1); intercepted = true; break;
      }
    }
    if (intercepted) continue;
    if (d.life <= 0) { bk.drones.splice(i, 1); }
  }
}

// ── Draw Berkut drones ──
function drawBerkutDrones() {
  const bk = world.airSupremacy;
  if (!bk || !bk.alive || !bk.drones) return;
  for (const d of bk.drones) {
    const dx = toScreen(d.x);
    if (dx < -20 || dx > W + 20) continue;
    // Trail
    for (const t of d.trail) {
      const tx = toScreen(t.x);
      const a = Math.max(0, 0.3 - t.age * 0.03);
      ctx.globalAlpha = a;
      ctx.fillStyle = '#ef4444';
      ctx.beginPath(); ctx.arc(tx, t.y, 1.5, 0, TWO_PI); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // Drone body — small delta wing
    const dDir = d.vx >= 0 ? 1 : -1;
    ctx.save();
    ctx.translate(dx, d.y);
    ctx.scale(dDir, 1);
    ctx.fillStyle = '#334155';
    ctx.beginPath();
    ctx.moveTo(6, 0); ctx.lineTo(-4, -5); ctx.lineTo(-4, 5); ctx.closePath();
    ctx.fill();
    // Red light
    ctx.fillStyle = '#ef4444';
    ctx.beginPath(); ctx.arc(5, 0, 1.5, 0, TWO_PI); ctx.fill();
    ctx.restore();
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
    hudFlash('LIGHTNING SQUADRON INCOMING', 80, '#a78bfa');
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

    // ── Periscope stealth: air enemies lose track when sub is in periscope ──
    // If the sub is in periscope mode (hidden just below surface), air units
    // cannot see it. They circle the last known position instead.
    const subHidden = sub.periscopeMode || sub.y > WATER_LINE + 8;
    const targetX = subHidden ? (li._lastKnownX || sub.worldX) : sub.worldX;
    const targetY = subHidden ? Math.min(sub.y, WATER_LINE - 30) : sub.y;
    if (!subHidden) { li._lastKnownX = sub.worldX; li._lastKnownY = sub.y; }
    const angleToTarget = Math.atan2(targetY - li.y, targetX - li.x);
    const distToTarget = Math.hypot(targetX - li.x, targetY - li.y);

    // ── Squadron tactics: form up at range, then split and attack ──
    // Each member gets an index within the living squad for offset calculations
    const aliveSquad = world.airInterceptors.filter(m => m.alive);
    const myIdx = aliveSquad.indexOf(li);
    const squadSize = aliveSquad.length;

    if (li.commanded && world.airSupremacy?.alive) {
      // Coordinated by Berkut: flanking formation — each member at a different angle
      const bk = world.airSupremacy;
      const baseFlank = Math.atan2(sub.y - bk.y, sub.worldX - bk.x);
      const spread = (myIdx - (squadSize - 1) / 2) * 0.6; // ±0.6 rad between members
      const flankAngle = baseFlank + Math.PI / 3 + spread;
      li.vx += Math.cos(flankAngle) * 0.08 * dt;
      li.vy += Math.sin(flankAngle) * 0.06 * dt;
    } else if (subHidden) {
      // Lost the sub — orbit the last known position searching
      const orbitAngle = angleToTarget + Math.PI / 2;
      li.vx += (Math.cos(orbitAngle) * 0.08 + Math.cos(angleToTarget) * 0.02) * dt;
      li.vy += (Math.sin(orbitAngle) * 0.06) * dt;
      // Gradually lose interest and climb back up
      li.vy -= 0.01 * dt;
    } else if (distToTarget > 250) {
      // Approach phase: fly in formation toward the sub
      // Each member holds a V-formation offset relative to the lead
      const formOffset = (myIdx - (squadSize - 1) / 2) * 40;
      const formTargetX = targetX - Math.cos(angleToTarget) * 200 + Math.sin(angleToTarget) * formOffset;
      const formTargetY = targetY - Math.sin(angleToTarget) * 200 - Math.cos(angleToTarget) * formOffset;
      const formAngle = Math.atan2(formTargetY - li.y, formTargetX - li.x);
      li.vx += Math.cos(formAngle) * 0.12 * dt;
      li.vy += Math.sin(formAngle) * 0.08 * dt;
    } else {
      // Attack phase: split and attack from different angles
      // Each member picks a different attack vector based on their index
      const attackSpread = (myIdx / Math.max(1, squadSize - 1) - 0.5) * Math.PI * 0.8;
      const attackAngle = angleToTarget + attackSpread;
      li.vx += Math.cos(attackAngle) * 0.1 * dt;
      li.vy += Math.sin(attackAngle) * 0.06 * dt;
      // Pull up after a close pass to avoid stacking on the sub
      if (distToTarget < 50) {
        li.vy -= 0.15 * dt; // Nose up — strafe run, don't hover
        li.vx += (li.vx > 0 ? 0.08 : -0.08) * dt; // Maintain forward momentum
      }
    }
    const spd = Math.hypot(li.vx, li.vy);
    if (spd > LIGHTNING_SPEED) { li.vx *= LIGHTNING_SPEED / spd; li.vy *= LIGHTNING_SPEED / spd; }

    // MG fire — close range, only if sub is visible (not in periscope/underwater)
    if (distToTarget < 180 && li.mgCooldown <= 0 && !subHidden) {
      const mgSpread = (Math.random() - 0.5) * 0.15;
      li.bullets.push({
        x: li.x, y: li.y,
        vx: Math.cos(angleToTarget + mgSpread) * 4.5,
        vy: Math.sin(angleToTarget + mgSpread) * 4.5,
        life: 50,
      });
      li.mgCooldown = LIGHTNING_MG_COOLDOWN;
    }
    // Unguided rockets — medium range, only if sub visible
    if (distToTarget < 300 && distToTarget > 60 && li.rocketCooldown <= 0 && !subHidden) {
      world.missiles.push({
        worldX: li.x, y: li.y,
        vx: Math.cos(angleToTarget) * 4, vy: Math.sin(angleToTarget) * 4,
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
    hudFlash('DEEP SONAR CONTACT', 100, '#38bdf8');
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
      hudFlash('NEMESIS SUB SURFACING', 100, '#ef4444');
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
    midNotice('NEMESIS SUB DESTROYED!', 120);
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
        midNotice('DESTROYER SUNK! +2000', 120);
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

// ============================================================
// MOTORCYCLISTS — Land defenders on island tops.
// Normal bikes patrol and shoot. Evel Knievel jumps between
// islands with a slow-motion matrix trail.
// ============================================================
function updateMotorcyclists(dt) {
  const sub = world.sub;
  const bikes = world.terrain.motorcyclists;
  if (!bikes) return;

  for (const m of bikes) {
    if (!m.alive) continue;
    m.mgCooldown = Math.max(0, m.mgCooldown - dt);

    // Update bullets
    for (let i = m.bullets.length - 1; i >= 0; i--) {
      const b = m.bullets[i];
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      if (Math.abs(b.x - sub.worldX) < 16 && Math.abs(b.y - sub.y) < 12) {
        damageRandomPart(sub.parts, b.dmg || MOTORCYCLE_MG_DAMAGE);
        SFX.damage();
        m.bullets.splice(i, 1); continue;
      }
      if (b.life <= 0 || b.y > WATER_LINE + 10) m.bullets.splice(i, 1);
    }

    // Take damage from player
    for (let i = world.subMgBullets.length - 1; i >= 0; i--) {
      const b = world.subMgBullets[i];
      if (Math.abs(b.worldX - m.x) < 12 && Math.abs(b.y - m.y) < 8) {
        m.hp--; world.subMgBullets.splice(i, 1); break;
      }
    }
    for (let i = world.torpedoes.length - 1; i >= 0; i--) {
      const t = world.torpedoes[i];
      if (!t.fromSub) continue;
      if (Math.abs(t.worldX - m.x) < 16 && Math.abs(t.y - m.y) < 12) {
        m.hp -= 2; world.torpedoes.splice(i, 1); break;
      }
    }

    if (m.hp <= 0) {
      m.alive = false;
      addExplosion(m.x, m.y, m.isEvel ? 'big' : 'small');
      addParticles(m.x, m.y, m.isEvel ? 16 : 8, m.isEvel ? '#fbbf24' : '#64748b');
      world.score += m.isEvel ? EVEL_SCORE : 200;
      world.kills++;
      if (m.isEvel) ticker('Evel Knievel down!', 60);
      SFX.enemyDestroyed();
      continue;
    }

    // ── Evel swimming after missed jump ──
    if (m.isEvel && m.swimming) {
      // Swimming toward nearest island with a motorbike (or any island)
      if (!m.swimTarget) {
        // Find nearest island with a bike, or just nearest island
        let best = null, bestDist = Infinity;
        for (const isl of world.terrain.islands) {
          const d = Math.abs(isl.x - m.x);
          if (d < bestDist) { bestDist = d; best = isl; }
        }
        m.swimTarget = best;
      }
      if (m.swimTarget) {
        const dx = m.swimTarget.x - m.x;
        m.vx = Math.sign(dx) * EVEL_SWIM_SPEED;
        m.x += m.vx * dt;
        m.y = WATER_LINE + 2 + Math.sin(world.tick * 0.08) * 1.5; // Bobbing in water

        // Check if player commander can capture him (hostage rescue style)
        const sub = world.sub;
        if (sub.disembarked) {
          const dist = Math.hypot(sub.pilotX - m.x, sub.pilotY - m.y);
          if (dist < EVEL_CAPTURE_RADIUS && (keyJustPressed['f'] || keyJustPressed['F'])) {
            m.captured = true;
            m.swimming = false;
            m.alive = false; // Remove from active
            world.score += EVEL_SCORE;
            midNotice('EVEL KNIEVEL CAPTURED!', 120);
            SFX.embark();
            continue;
          }
        }

        // Reached an island — climb out and commandeer any bike there
        const islLeft = m.swimTarget.x - m.swimTarget.topW / 2;
        const islRight = m.swimTarget.x + m.swimTarget.topW / 2;
        if (m.x >= islLeft && m.x <= islRight) {
          m.swimming = false;
          m.y = WATER_LINE - m.swimTarget.h - 4;
          m.island = m.swimTarget;
          m.jumpCooldown = 400 + Math.random() * 200;
          m.jumpTrail = [];
          m.swimTarget = null;
          ticker('Evel reaches shore — commandeers a bike!', 60);
          addParticles(m.x, m.y, 4, '#fbbf24');
        }
      }
      continue;
    }

    if (m.jumping) {
      // ── In the air — physics + matrix trail ──
      m.x += m.vx * dt;
      m.jumpVy += EVEL_JUMP_GRAVITY * dt;
      m.y += m.jumpVy * dt;
      // Matrix trail: store position snapshots
      if (world.tick % 2 === 0) {
        m.jumpTrail.push({ x: m.x, y: m.y, age: 0 });
        if (m.jumpTrail.length > 20) m.jumpTrail.shift();
      }
      m.jumpTrail.forEach(t => t.age += dt);
      // Land on any island surface
      for (const isl of world.terrain.islands) {
        const islTop = WATER_LINE - isl.h - 4;
        const islLeft = isl.x - isl.topW / 2;
        const islRight = isl.x + isl.topW / 2;
        if (m.x >= islLeft && m.x <= islRight && m.y >= islTop && m.jumpVy > 0) {
          m.y = islTop;
          m.jumping = false;
          m.jumpVy = 0;
          m.island = isl;
          m.jumpTrail = [];
          if (m.isEvel) {
            ticker('Evel Knievel lands!', 40);
            addParticles(m.x, m.y, 6, '#fbbf24');
          }
          break;
        }
      }
      // Fell in the water — Evel doesn't die, he swims! Normal bikers die.
      if (m.y > WATER_LINE) {
        if (m.isEvel) {
          m.jumping = false;
          m.swimming = true;
          m.y = WATER_LINE + 2;
          m.jumpVy = 0;
          m.jumpTrail = [];
          m.swimTarget = null;
          ticker('Evel missed! He\'s swimming for shore...', 60);
          addParticles(m.x, WATER_LINE, 8, '#85c1e9');
          SFX.waterSplash();
        } else {
          m.alive = false;
          addParticles(m.x, WATER_LINE, 8, '#85c1e9');
          SFX.waterSplash();
        }
      }
      continue;
    }

    // ── On the ground — patrol island surface ──
    const isl = m.island;
    const islTop = WATER_LINE - isl.h - 4;
    const islLeft = isl.x - isl.topW / 2 + 6;
    const islRight = isl.x + isl.topW / 2 - 6;
    m.y = islTop;
    m.x += m.vx * dt;
    // Reverse at island edges
    if (m.x <= islLeft) { m.x = islLeft; m.vx = Math.abs(m.vx); }
    if (m.x >= islRight) { m.x = islRight; m.vx = -Math.abs(m.vx); }

    // ── Evel flying-jump for the ladder ──
    // Different from the static-hover offer. If the ladder is dangling and
    // Evel judges the pass close enough, he'll launch himself at it. If he
    // catches, he clings and becomes a flight impediment the player must
    // shake off (by dragging through water erratically) or crush on land.
    if (m.isEvel && !m.jumping && !m.swimming && !m.captured
        && sub.ladderDeployed && !sub.ladderPassenger) {
      const ladderTipY = sub.y + sub.ladderLength;
      const dxTip = sub.worldX - m.x;
      const dyTip = ladderTipY - m.y;
      const subSpeed = Math.hypot(sub.vx, sub.vy);
      const inReach = Math.abs(dxTip) < 50 && dyTip > -30 && dyTip < 10;
      const flyingPast = !sub.floating && subSpeed > 1.0;
      if (inReach && flyingPast && (!m._laddersnatchCd || m._laddersnatchCd <= 0)) {
        m._laddersnatchCd = 90;
        if (Math.random() < 0.25) {
          ticker('Evel leaps for the ladder!', 60);
          if (Math.abs(dxTip) < 30 && Math.abs(dyTip) < 30) {
            sub.ladderPassenger = { kind: 'evel', ref: m };
            m.alive = false;
            m.captured = false;
            midNotice('EVEL SNAGGED THE LADDER — SHAKE HIM OFF!', 140);
            SFX.damage && SFX.damage();
          } else {
            ticker('Evel\'s jump fell short.', 40);
          }
        }
      }
    }
    if (m._laddersnatchCd > 0) m._laddersnatchCd -= dt;

    // ── Rescue-ladder capture (Evel only, while grounded) ──
    // If the player dangles the ladder over him while holding station, Evel
    // MIGHT grab it — 1 in 10 offers. He's a professional showman; rescue is
    // beneath him most of the time. Without VTOL, holding station is nearly
    // impossible so the player rarely gets an offer at all.
    if (m.isEvel && !m.jumping && !m.swimming && !m.captured
        && sub.ladderDeployed && !sub.ladderPassenger) {
      const ladderReach = sub.ladderLength + 6;
      const tipY = sub.y + ladderReach;
      const overEvel = Math.abs(sub.worldX - m.x) < 14 && Math.abs(tipY - m.y) < 16;
      const stable = Math.hypot(sub.vx, sub.vy) < (sub.vtolUpgrade ? 1.2 : 0.25);
      if (overEvel && stable) {
        // One offer per stable hover — track via a per-frame timer
        if (!m._ladderOfferCd || m._ladderOfferCd <= 0) {
          m._ladderOfferCd = 45; // ~3/4 sec between offers
          if (Math.random() < 0.10) {
            m.captured = true;
            m.alive = false;
            world.score += EVEL_SCORE;
            midNotice('EVEL KNIEVEL GRABBED THE LADDER!', 120);
            ticker('Evel: "Alright, you got me." (prisoner)', 80);
            SFX.embark && SFX.embark();
          } else {
            ticker('Evel scoffs at the ladder.', 40);
          }
        }
      }
    }
    if (m._ladderOfferCd > 0) m._ladderOfferCd -= dt;

    // Fire at sub if in range and sub is visible.
    // Evel is a showman AND a professional — when he's on a bike he's much
    // deadlier than regular bikers: longer range, faster cycling, burst fire,
    // tighter aim, heavier damage per round.
    const evelRange = m.isEvel ? MOTORCYCLE_MG_RANGE * 1.7 : MOTORCYCLE_MG_RANGE;
    const dist = Math.hypot(sub.worldX - m.x, sub.y - m.y);
    if (dist < evelRange && m.mgCooldown <= 0 && !isSubHiddenFromAir(sub)) {
      const angle = Math.atan2(sub.y - m.y, sub.worldX - m.x);
      const spread = (Math.random() - 0.5) * (m.isEvel ? 0.08 : 0.2);
      const bulletSpeed = m.isEvel ? MOTORCYCLE_MG_SPEED * 1.35 : MOTORCYCLE_MG_SPEED;
      const burst = m.isEvel ? 3 : 1;
      for (let k = 0; k < burst; k++) {
        const s = spread + (k - (burst - 1) / 2) * 0.04;
        m.bullets.push({
          x: m.x, y: m.y - 4,
          vx: Math.cos(angle + s) * bulletSpeed,
          vy: Math.sin(angle + s) * bulletSpeed,
          life: MOTORCYCLE_BULLET_LIFE + (m.isEvel ? 20 : 0),
          // Custom per-bullet damage tag read by the player-hit check below.
          dmg: m.isEvel ? 4 : MOTORCYCLE_MG_DAMAGE,
        });
      }
      m.mgCooldown = m.isEvel ? MOTORCYCLE_MG_COOLDOWN * 0.55 : MOTORCYCLE_MG_COOLDOWN;
    }

    // ── Evel Knievel: predictive jump — anticipates where you're headed ──
    if (m.isEvel && !m.swimming) {
      if (!m.jumpCooldown) m.jumpCooldown = 0;
      m.jumpCooldown = Math.max(0, m.jumpCooldown - dt);
      if (m.jumpCooldown <= 0 && !m.jumping) {
        // Evel has a sixth sense — he predicts where the sub will be
        // and jumps to an island in its path, especially mission islands.
        const subVelDir = sub.vx > 0.3 ? 1 : sub.vx < -0.3 ? -1 : 0;
        const subFutureX = sub.worldX + sub.vx * 200; // Where sub will be in ~200 ticks

        // Score each reachable island by desirability
        let bestTarget = null, bestScore = -Infinity;
        for (const other of world.terrain.islands) {
          if (other === isl) continue;
          const jumpDist = Math.abs(other.x - m.x);
          if (jumpDist > 800 || jumpDist < 60) continue; // Too far or too close

          let score = 0;
          // Prefer islands the sub is heading toward
          const distToSubFuture = Math.abs(other.x - subFutureX);
          score += 400 - Math.min(400, distToSubFuture * 0.5);
          // Strong preference for mission islands — Evel wants to be in your way
          if (other.missionIsland) score += 300;
          // Prefer military islands (his kind of place)
          if (other.type === 'military') score += 80;
          // Slight randomness so he's not perfectly predictable
          score += Math.random() * 100;
          // Penalise very long jumps (risky)
          score -= jumpDist * 0.1;

          if (score > bestScore) { bestScore = score; bestTarget = other; }
        }

        if (bestTarget) {
          m.jumping = true;
          m.targetIsland = bestTarget;
          const dx = bestTarget.x - m.x;
          m.vx = dx > 0 ? EVEL_JUMP_SPEED : -EVEL_JUMP_SPEED;
          m.jumpVy = -EVEL_JUMP_SPEED * 0.7; // Arc upward
          m.jumpCooldown = 400 + Math.random() * 300;
          m.jumpTrail = [];
          // Cameratron event — triggers the mini-frame popup
          world._evelCameratron = { active: true, timer: 0, maxTimer: 180, evel: m };
          ticker('Evel Knievel jumps!', 50);
        }
      }
    }
  }
}

function drawMotorcyclists() {
  const bikes = world.terrain.motorcyclists;
  if (!bikes) return;

  for (const m of bikes) {
    if (!m.alive && !(m.isEvel && m.swimming)) continue;
    const mx = toScreen(m.x);
    if (mx < -30 || mx > W + 30) continue;
    const dir = m.vx >= 0 ? 1 : -1;

    // ── Evel swimming — bobbing head + arms in water ──
    if (m.isEvel && m.swimming) {
      ctx.save();
      ctx.translate(mx, m.y);
      // Head above water
      ctx.fillStyle = '#f8fafc';
      ctx.beginPath(); ctx.arc(0, -4, 3, 0, TWO_PI); ctx.fill();
      // Helmet
      ctx.fillStyle = '#f8fafc';
      ctx.beginPath(); ctx.arc(0, -5, 3.2, Math.PI, 0); ctx.fill();
      ctx.fillStyle = '#3b82f6'; // Blue visor
      ctx.fillRect(dir * 1, -6, dir * 2, 1.5);
      // Arms splashing
      const armPhase = Math.sin(world.tick * 0.12);
      ctx.strokeStyle = '#f8fafc'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-4, -1); ctx.lineTo(-7, -3 + armPhase * 2);
      ctx.moveTo(4, -1); ctx.lineTo(7, -3 - armPhase * 2);
      ctx.stroke();
      // Water splash particles
      if (world.tick % 4 === 0) {
        ctx.fillStyle = 'rgba(133,193,233,0.4)';
        ctx.beginPath(); ctx.arc(dir * 5, -1 + Math.random() * 2, 1.5, 0, TWO_PI); ctx.fill();
      }
      ctx.restore();
      // Capture hint when commander is nearby
      if (world.sub.disembarked) {
        const dist = Math.hypot(world.sub.pilotX - m.x, world.sub.pilotY - m.y);
        if (dist < 40) {
          ctx.fillStyle = '#fcd34d';
          ctx.font = '10px Arial'; ctx.textAlign = 'center';
          ctx.fillText('[F] CAPTURE', mx, m.y - 12);
        }
      }
      continue;
    }

    // ── Evel's matrix jump trail — ghostly afterimages ──
    if (m.jumping && m.isEvel) {
      for (let i = 0; i < m.jumpTrail.length; i++) {
        const t = m.jumpTrail[i];
        const tx = toScreen(t.x);
        const alpha = Math.max(0, 0.35 - t.age * 0.02);
        if (alpha <= 0) continue;
        ctx.globalAlpha = alpha;
        // Green-tinted ghost (Matrix style)
        ctx.fillStyle = '#00ff41';
        // Ghost rider silhouette
        ctx.beginPath(); ctx.arc(tx, t.y - 3, 3, 0, TWO_PI); ctx.fill(); // Head
        ctx.fillRect(tx - 2, t.y, 4, 5); // Body
        ctx.fillRect(tx - 5, t.y + 5, 10, 3); // Bike
        // Digital rain streaks
        if (i % 3 === 0) {
          ctx.fillStyle = 'rgba(0,255,65,0.2)';
          ctx.fillRect(tx - 1, t.y - 20, 2, 18);
        }
      }
      ctx.globalAlpha = 1;
    }

    ctx.save();
    ctx.translate(mx, m.y);
    ctx.scale(dir, 1);

    if (m.isEvel) {
      // ── Evel Knievel — white jumpsuit, star-spangled, cape ──
      // Bike (bigger, chrome)
      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect(-8, 2, 16, 4); // Frame
      ctx.fillStyle = '#94a3b8';
      ctx.beginPath(); ctx.arc(-6, 6, 3, 0, TWO_PI); ctx.fill(); // Rear wheel
      ctx.beginPath(); ctx.arc(6, 6, 3, 0, TWO_PI); ctx.fill();  // Front wheel
      ctx.strokeStyle = '#475569'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(-6, 6, 3, 0, TWO_PI); ctx.stroke();
      ctx.beginPath(); ctx.arc(6, 6, 3, 0, TWO_PI); ctx.stroke();
      // Exhaust flame when jumping
      if (m.jumping) {
        ctx.fillStyle = '#f97316';
        ctx.beginPath(); ctx.moveTo(-10, 3); ctx.lineTo(-16, 4); ctx.lineTo(-10, 5); ctx.fill();
      }
      // Rider (white jumpsuit)
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(-2, -6, 4, 8); // Body
      // Head (helmet with stars)
      ctx.fillStyle = '#f8fafc';
      ctx.beginPath(); ctx.arc(0, -8, 3.5, 0, TWO_PI); ctx.fill();
      ctx.fillStyle = '#3b82f6'; // Blue visor
      ctx.fillRect(1, -9, 3, 2);
      // Stars on jumpsuit
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(-1, -4, 2, 1);
      ctx.fillRect(-1, -1, 2, 1);
      // Cape (flutters behind when moving)
      ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-2, -5);
      ctx.quadraticCurveTo(-8 - Math.sin(world.tick * 0.1) * 3, -8, -6 - Math.sin(world.tick * 0.15) * 4, -3);
      ctx.stroke();
    } else {
      // ── Normal motorcyclist — olive drab military ──
      // Bike
      ctx.fillStyle = '#4a5a3a';
      ctx.fillRect(-6, 2, 12, 3);
      ctx.fillStyle = '#333';
      ctx.beginPath(); ctx.arc(-5, 5, 2.5, 0, TWO_PI); ctx.fill();
      ctx.beginPath(); ctx.arc(5, 5, 2.5, 0, TWO_PI); ctx.fill();
      // Rider
      ctx.fillStyle = '#4a5a3a';
      ctx.fillRect(-1.5, -5, 3, 7);
      // Helmet
      ctx.fillStyle = '#3a4a2a';
      ctx.beginPath(); ctx.arc(0, -7, 2.5, 0, TWO_PI); ctx.fill();
    }

    ctx.restore();

    // Bullets
    ctx.fillStyle = m.isEvel ? '#fbbf24' : '#94a3b8';
    for (const b of m.bullets) {
      const bsx = toScreen(b.x);
      if (bsx < -5 || bsx > W + 5) continue;
      ctx.beginPath(); ctx.arc(bsx, b.y, 1.2, 0, TWO_PI); ctx.fill();
    }
  }
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

  // ── Movement — patrol when idle, HUNT when detecting sub ──
  const distToSub = Math.hypot(sub.worldX - ak.x, sub.y - ak.y);
  if (!ak.mines) ak.mines = [];
  if (!ak.mgCooldown) ak.mgCooldown = 0;
  if (!ak.mgBullets) ak.mgBullets = [];
  if (!ak.state) ak.state = 'patrol'; // patrol, hunt, ram, surface
  ak.mgCooldown = Math.max(0, ak.mgCooldown - dt);

  // State transitions
  if (akulaCanDetect && distToSub < 350) {
    ak.state = (distToSub < 80) ? 'ram' : 'hunt';
  } else if (!akulaCanDetect && ak.state !== 'patrol') {
    ak.state = 'patrol';
  }

  // Surface state — rises to surface for MG attacks on airborne sub
  if (akulaCanDetect && sub.y < WATER_LINE - 20 && distToSub < 300 && ak.state !== 'ram') {
    ak.state = 'surface';
  }

  if (ak.state === 'hunt') {
    // Actively chase the sub
    const chaseDir = sub.worldX > ak.x ? 1 : -1;
    ak.dir = chaseDir;
    ak.x += chaseDir * AKULA_SPEED * 1.4 * speedMult * dt;
    // Match sub depth to get in torpedo range
    ak.targetDepth = sub.y + (sub.y > WATER_LINE ? 0 : 20);
  } else if (ak.state === 'ram') {
    // Close range — ram attempt (dangerous for both)
    const chaseDir = sub.worldX > ak.x ? 1 : -1;
    ak.dir = chaseDir;
    ak.x += chaseDir * AKULA_SPEED * 2.0 * speedMult * dt;
    ak.targetDepth = sub.y;
    // Ram damage
    if (distToSub < 30) {
      damageRandomPart(sub.parts, 8);
      ak.hp -= 15;
      addExplosion(ak.x, ak.y, 'big');
      SFX.explodeBig();
      ak.state = 'hunt'; // Back off after ram
      ticker('Akula rams your hull!', 60);
    }
  } else if (ak.state === 'surface') {
    // Rise to surface for MG fire at airborne targets
    ak.x += ak.dir * AKULA_SPEED * 0.6 * speedMult * dt;
    ak.targetDepth = WATER_LINE + 8; // Just below surface, MG exposed
    // Surface MG — only fires when at surface
    if (ak.y < WATER_LINE + 15 && ak.mgCooldown <= 0 && distToSub < 250) {
      const angle = Math.atan2(sub.y - ak.y, sub.worldX - ak.x);
      ak.mgBullets.push({
        x: ak.x + ak.dir * 25, y: ak.y - 8,
        vx: Math.cos(angle) * 4.5, vy: Math.sin(angle) * 4.5,
        life: 50,
      });
      ak.mgCooldown = 8;
    }
  } else {
    // Patrol — normal horizontal movement
    ak.x += ak.dir * AKULA_SPEED * speedMult * dt;
    if (ak.x > ak.patrolMax) ak.dir = -1;
    if (ak.x < ak.patrolMin) ak.dir = 1;
    ak.targetDepth = WATER_LINE + 60 + Math.sin(world.tick * 0.005) * 40;
  }

  // Depth behaviour
  if (ak.state === 'patrol' && distToSub > 500) {
    ak.targetDepth = WATER_LINE + 60 + Math.sin(world.tick * 0.005) * 40;
  }
  const depthDiff = ak.targetDepth - ak.y;
  ak.y += Math.sign(depthDiff) * Math.min(Math.abs(depthDiff), AKULA_DIVE_SPEED * diveMult * dt);
  ak.y = Math.max(WATER_LINE + 8, Math.min(SEA_FLOOR - 15, ak.y));

  // ── Mine laying — drops mines behind it while hunting ──
  if (!ak._mineCooldown) ak._mineCooldown = 0;
  ak._mineCooldown = Math.max(0, ak._mineCooldown - dt);
  if (ak.state === 'hunt' && ak._mineCooldown <= 0 && ak.mines.length < 8) {
    ak.mines.push({
      x: ak.x - ak.dir * 20, y: ak.y,
      armed: false, armTimer: 60, // Arms after 60 ticks
      life: 1200, // Disappear after 1200 ticks
    });
    ak._mineCooldown = 120;
  }
  // Update mines
  for (let i = ak.mines.length - 1; i >= 0; i--) {
    const mine = ak.mines[i];
    mine.life -= dt;
    if (!mine.armed) { mine.armTimer -= dt; if (mine.armTimer <= 0) mine.armed = true; }
    // Player sub proximity detonation
    if (mine.armed && Math.hypot(sub.worldX - mine.x, sub.y - mine.y) < 25) {
      damageRandomPart(sub.parts, 12);
      addExplosion(mine.x, mine.y, 'big');
      SFX.explodeBig();
      ticker('Mine detonated!', 50);
      ak.mines.splice(i, 1); continue;
    }
    if (mine.life <= 0) { ak.mines.splice(i, 1); }
  }

  // Update MG bullets
  for (let i = ak.mgBullets.length - 1; i >= 0; i--) {
    const b = ak.mgBullets[i];
    b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
    if (Math.abs(b.x - sub.worldX) < 14 && Math.abs(b.y - sub.y) < 10) {
      damageRandomPart(sub.parts, 2);
      SFX.damage();
      ak.mgBullets.splice(i, 1); continue;
    }
    if (b.life <= 0) ak.mgBullets.splice(i, 1);
  }

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

  // ── Kamikaze sea drones — Akula deploys underwater pursuit drones ──
  if (!ak.seaDrones) ak.seaDrones = [];
  if (!ak._seaDroneCooldown) ak._seaDroneCooldown = 400;
  ak._seaDroneCooldown = Math.max(0, ak._seaDroneCooldown - dt);
  if (ak.state === 'hunt' && ak._seaDroneCooldown <= 0 && ak.seaDrones.length < 2 && akulaCanDetect) {
    ak.seaDrones.push({
      x: ak.x, y: ak.y,
      vx: (sub.worldX > ak.x ? 1 : -1) * 2, vy: 0,
      life: 400,
    });
    ak._seaDroneCooldown = 250;
    ticker('Akula deploys sea drone!', 50);
  }
  for (let i = ak.seaDrones.length - 1; i >= 0; i--) {
    const d = ak.seaDrones[i];
    d.life -= dt;
    const dAngle = Math.atan2(sub.y - d.y, sub.worldX - d.x);
    d.vx += Math.cos(dAngle) * 0.12 * dt;
    d.vy += Math.sin(dAngle) * 0.1 * dt;
    const dSpd = Math.hypot(d.vx, d.vy);
    if (dSpd > 2.5) { d.vx *= 2.5 / dSpd; d.vy *= 2.5 / dSpd; }
    d.x += d.vx * dt; d.y += d.vy * dt;
    d.y = clamp(d.y, WATER_LINE + 5, SEA_FLOOR - 10);
    // Hit sub
    if (Math.abs(d.x - sub.worldX) < 16 && Math.abs(d.y - sub.y) < 12) {
      damageRandomPart(sub.parts, 8);
      addExplosion(d.x, d.y, 'small');
      SFX.explodeSmall();
      ak.seaDrones.splice(i, 1); continue;
    }
    // Intercept incoming torpedoes
    for (let j = world.torpedoes.length - 1; j >= 0; j--) {
      const t = world.torpedoes[j];
      if (!t.fromSub) continue;
      if (Math.hypot(t.worldX - d.x, t.y - d.y) < 18) {
        addExplosion(d.x, d.y, 'small');
        world.torpedoes.splice(j, 1);
        ak.seaDrones.splice(i, 1); break;
      }
    }
    if (d.life <= 0) { ak.seaDrones.splice(i, 1); }
  }

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
        ticker('Torpedo deflected by sonar field', 50);
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

  // ── Akula mines — dark spiked spheres ──
  if (ak.mines) {
    for (const mine of ak.mines) {
      const msx = toScreen(mine.x);
      if (msx < -10 || msx > W + 10) continue;
      ctx.globalAlpha = mine.armed ? 0.8 : 0.4;
      ctx.fillStyle = mine.armed ? '#333' : '#555';
      ctx.beginPath(); ctx.arc(msx, mine.y, 5, 0, TWO_PI); ctx.fill();
      // Spikes
      if (mine.armed) {
        ctx.strokeStyle = '#222'; ctx.lineWidth = 1;
        for (let s = 0; s < 6; s++) {
          const a = (s / 6) * TWO_PI + world.tick * 0.01;
          ctx.beginPath();
          ctx.moveTo(msx + Math.cos(a) * 5, mine.y + Math.sin(a) * 5);
          ctx.lineTo(msx + Math.cos(a) * 8, mine.y + Math.sin(a) * 8);
          ctx.stroke();
        }
        // Red blink
        if (world.tick % 30 < 5) {
          ctx.fillStyle = '#ff0000';
          ctx.beginPath(); ctx.arc(msx, mine.y, 2, 0, TWO_PI); ctx.fill();
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  // ── Akula MG bullets ──
  if (ak.mgBullets) {
    ctx.fillStyle = '#ff6b35';
    for (const b of ak.mgBullets) {
      const bsx = toScreen(b.x);
      if (bsx < -5 || bsx > W + 5) continue;
      ctx.beginPath(); ctx.arc(bsx, b.y, 1.5, 0, TWO_PI); ctx.fill();
    }
  }

  // ── Akula sea drones — small torpedo-like chasers ──
  if (ak.seaDrones) {
    for (const d of ak.seaDrones) {
      const dsx = toScreen(d.x);
      if (dsx < -15 || dsx > W + 15) continue;
      const dDir = d.vx >= 0 ? 1 : -1;
      ctx.save();
      ctx.translate(dsx, d.y);
      ctx.scale(dDir, 1);
      // Torpedo-shaped body
      ctx.fillStyle = '#8b1a1a';
      ctx.beginPath();
      ctx.moveTo(8, 0); ctx.quadraticCurveTo(4, -3, -6, -2);
      ctx.lineTo(-8, 0); ctx.lineTo(-6, 2); ctx.quadraticCurveTo(4, 3, 8, 0);
      ctx.fill();
      // Propeller
      ctx.fillStyle = '#555';
      ctx.beginPath(); ctx.arc(-8, Math.sin(world.tick * 0.3) * 2, 1, 0, TWO_PI); ctx.fill();
      // Red nose light
      ctx.fillStyle = '#ff4444';
      ctx.beginPath(); ctx.arc(7, 0, 1.2, 0, TWO_PI); ctx.fill();
      ctx.restore();
    }
  }

  // ── Surface MG turret (visible when near surface) ──
  if (ak.state === 'surface' && ak.y < WATER_LINE + 15) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#4a0808';
    ctx.fillRect(sx + ak.dir * 15 - 2, sy - 12, 4, 5);
    ctx.fillStyle = '#333';
    ctx.fillRect(sx + ak.dir * 18 - 1, sy - 14, 8, 2); // Barrel
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
