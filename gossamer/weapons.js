// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Jonathan D.A. Jewell (hyperpolymath)
//
// weapons.js — Depth-charge constants, torpedo/missile/depth-charge update logic,
// and draw functions for projectile weapons.
// Extracted from app_gossamer.js for modular organisation.
// Loaded via <script> tag before app_gossamer.js.
//
// Contents:
//   - Depth-charge tuning constants
//   - canFireTorpedo, detonateDepthCharge, updateDepthCharges, updateProjectiles
//   - drawDepthCharges, drawTorpedoes, drawMissiles

/* global world, ctx, TWO_PI, SFX, toScreen, addExplosion, addParticles,
   damageRandomPart, WATER_LINE,
   MINE_RADIUS, triggerMine, islandHitTest, getGroundY, W */

// ============================================================
// DEPTH-CHARGE CONSTANTS
// ============================================================

const START_DEPTH_CHARGES       = 8;
const DEPTH_CHARGE_COOLDOWN     = 42;
const DEPTH_CHARGE_GRAVITY      = 0.22;
const DEPTH_CHARGE_WATER_DRAG   = 0.985;
const DEPTH_CHARGE_BLAST_RADIUS = 85;
const DEPTH_CHARGE_LIFE         = 180;
const DEPTH_CHARGE_COLOR        = '#9b59b6';

// ============================================================
// WEAPONS LOGIC
// ============================================================

function canFireTorpedo(parts) { return parts.nose > 20; }

function detonateDepthCharge(charge) {
  addExplosion(charge.worldX, charge.y, 'big');
  addParticles(charge.worldX, charge.y, 18, DEPTH_CHARGE_COLOR);
  SFX.explodeBig();

  for (let i = world.enemies.length - 1; i >= 0; i--) {
    const enemy = world.enemies[i];
    const dist = Math.hypot(enemy.worldX - charge.worldX, enemy.y - charge.y);
    if (dist > DEPTH_CHARGE_BLAST_RADIUS) continue;
    enemy.health -= 4;
    if (enemy.health <= 0) {
      addExplosion(enemy.worldX, enemy.y, 'big');
      addParticles(enemy.worldX, enemy.y, 10, '#ff9f1c');
      world.score += 260;
      world.kills++;
      world.enemies.splice(i, 1);
      SFX.enemyDestroyed();
    }
  }

  for (const mine of world.mines) {
    if (!mine.active) continue;
    const dist = Math.hypot(mine.x - charge.worldX, mine.y - charge.y);
    if (dist <= DEPTH_CHARGE_BLAST_RADIUS + MINE_RADIUS) {
      triggerMine(world, mine);
    }
  }

  for (const radar of world.terrain.radars) {
    if (radar.destroyed) continue;
    const dist = Math.hypot(radar.x - charge.worldX, radar.y - charge.y);
    if (dist > DEPTH_CHARGE_BLAST_RADIUS * 0.75) continue;
    radar.hp -= 35;
    if (radar.hp <= 0) {
      radar.destroyed = true;
      addExplosion(radar.x, radar.y, 'big');
      addParticles(radar.x, radar.y, 15, '#888');
      world.score += radar.tier * 180;
      SFX.enemyDestroyed();
    }
  }

  const sub = world.sub;
  if (Math.hypot(sub.worldX - charge.worldX, sub.y - charge.y) < DEPTH_CHARGE_BLAST_RADIUS * 0.45) {
    damageRandomPart(sub.parts, 18);
    SFX.damage();
  }
}

function updateDepthCharges(dt) {
  const sub = world.sub;
  world.depthChargeCooldown = Math.max(0, world.depthChargeCooldown - dt);
  world.depthCharges = world.depthCharges.filter((charge) => {
    charge.life -= dt;
    if (world.tick % 3 === 0) {
      charge.trail.push({ wx: charge.worldX, y: charge.y, age: 0 });
      if (charge.trail.length > 12) charge.trail.shift();
    }
    charge.trail.forEach((p) => { p.age += dt; });

    if (charge.y < WATER_LINE) {
      charge.vy += DEPTH_CHARGE_GRAVITY * dt;
    } else {
      charge.vy += DEPTH_CHARGE_GRAVITY * 0.25 * dt;
      charge.vx *= DEPTH_CHARGE_WATER_DRAG;
      charge.vy *= DEPTH_CHARGE_WATER_DRAG;
    }
    charge.worldX += charge.vx * dt;
    charge.y += charge.vy * dt;

    const groundY = getGroundY(charge.worldX);
    const hittingGround = charge.y >= groundY - 4;
    const hitMine = world.mines.some((mine) =>
      mine.active && Math.hypot(mine.x - charge.worldX, mine.y - charge.y) < MINE_RADIUS + 8
    );
    // Check island collision (above and below water)
    const hitIsland = islandHitTest(charge.worldX, charge.y);
    // Check radar collision
    const hitRadar = world.terrain.radars && world.terrain.radars.some((r) =>
      !r.destroyed && Math.hypot(r.x - charge.worldX, r.y - charge.y) < 22
    );
    if (charge.life <= 0 || hittingGround || hitMine || hitIsland || hitRadar) {
      if (hittingGround) {
        charge.y = groundY - 4;
        charge.vy = Math.min(0, charge.vy);
      }
      detonateDepthCharge(charge);
      return false;
    }
    return Math.abs(charge.worldX - sub.worldX) < W * 2;
  });
}

function updateProjectiles(dt) {
  const sub = world.sub;
  world.torpedoes = world.torpedoes.filter(t => {
    for (let i = world.enemies.length-1; i >= 0; i--) {
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
    for (let i = world.enemies.length-1; i >= 0; i--) {
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

// ============================================================
// DRAW FUNCTIONS
// ============================================================

function drawDepthCharges() {
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
}

function drawTorpedoes() {
  // --- Torpedoes ---
  for (const t of world.torpedoes) {
    for (const p of t.trail) {
      ctx.globalAlpha = Math.max(0,1-p.age/12)*0.3;
      ctx.fillStyle = t.phase==='drop'?'#bdc3c7':'#85c1e9';
      ctx.beginPath(); ctx.arc(toScreen(p.wx), p.y, 2, 0, Math.PI*2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.save(); ctx.translate(toScreen(t.worldX), t.y); ctx.rotate(Math.atan2(t.vy, t.vx));
    if (t.lgt) {
      // LGT: bright cyan body with fins, distinctive look
      ctx.fillStyle = '#22d3ee';
      ctx.beginPath(); ctx.ellipse(0,0,9,3.5,0,0,Math.PI*2); ctx.fill();
      ctx.strokeStyle = '#0891b2'; ctx.lineWidth = 1; ctx.stroke();
      // Fins (hydrofoils)
      ctx.fillStyle = '#06b6d4';
      ctx.beginPath(); ctx.moveTo(-4,-3); ctx.lineTo(-7,-7); ctx.lineTo(-2,-3); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-4,3); ctx.lineTo(-7,7); ctx.lineTo(-2,3); ctx.fill();
      // Nose
      ctx.fillStyle = '#e74c3c'; ctx.beginPath(); ctx.arc(8,0,2.5,-Math.PI/2,Math.PI/2); ctx.fill();
      // Wake spray
      ctx.fillStyle = 'rgba(133,193,233,0.6)';
      ctx.beginPath(); ctx.arc(-11,0,2.5,0,Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(-14,(Math.random()-0.5)*3,1.5,0,Math.PI*2); ctx.fill();
    } else {
      ctx.fillStyle = t.phase==='drop'?'#95a5a6':(t.rogue?'#ff9800':'#ffe66d');
      ctx.beginPath(); ctx.ellipse(0,0,8,3,0,0,Math.PI*2); ctx.fill();
      ctx.fillStyle='#e74c3c'; ctx.beginPath(); ctx.arc(7,0,2.5,-Math.PI/2,Math.PI/2); ctx.fill();
      if (t.phase!=='drop') { ctx.fillStyle='rgba(133,193,233,0.5)'; ctx.beginPath(); ctx.arc(-9,0,2,0,Math.PI*2); ctx.fill(); }
      if (t.rogue && t.phase!=='drop') {
        ctx.strokeStyle='#ff9800'; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(0,-3); ctx.lineTo(0,-7); ctx.stroke();
        ctx.fillStyle='#ff9800'; ctx.beginPath(); ctx.arc(0,-7,1.5,0,Math.PI*2); ctx.fill();
      }
    }
    ctx.restore();
  }
}

function drawMissiles() {
  // --- Missiles ---
  for (const m of world.missiles) {
    for (const p of m.trail) {
      ctx.globalAlpha = Math.max(0,1-p.age/15)*0.5;
      ctx.fillStyle = m.phase==='drop'?'#95a5a6':'#ff6b00';
      ctx.beginPath(); ctx.arc(toScreen(p.wx),p.y,m.phase==='drop'?1:2.5,0,Math.PI*2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.save(); ctx.translate(toScreen(m.worldX),m.y); ctx.rotate(Math.atan2(m.vy,m.vx));
    ctx.fillStyle='#ecf0f1'; ctx.fillRect(-7,-2,14,4);
    ctx.fillStyle='#e74c3c';
    ctx.beginPath(); ctx.moveTo(-6,-2); ctx.lineTo(-9,-6); ctx.lineTo(-4,-2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-6,2); ctx.lineTo(-9,6); ctx.lineTo(-4,2); ctx.fill();
    ctx.fillStyle='#2c3e50'; ctx.beginPath(); ctx.moveTo(7,-2); ctx.lineTo(11,0); ctx.lineTo(7,2); ctx.fill();
    if (m.phase==='ignite') {
      ctx.fillStyle='#ff6b00'; ctx.beginPath(); ctx.moveTo(-7,-1.5); ctx.lineTo(-12-Math.random()*4,0); ctx.lineTo(-7,1.5); ctx.fill();
      ctx.fillStyle='#ffcc00'; ctx.beginPath(); ctx.moveTo(-7,-0.8); ctx.lineTo(-10-Math.random()*2,0); ctx.lineTo(-7,0.8); ctx.fill();
    }
    ctx.restore();
  }
}
