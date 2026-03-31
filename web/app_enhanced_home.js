// SPDX-License-Identifier: PMPL-1.0-or-later
// Airborne Submarine Squadron — Sopwith-style side-scrolling arcade
// A flying submarine over scrolling terrain with sky, water, and land.

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// --- Constants ---
const W = 800, H = 600;
const GRAVITY = 0.15;
const THRUST = 0.35;
const MAX_SPEED = 5;
const SCROLL_SPEED = 2;
const WATER_LINE = 420;       // Where water starts
const GROUND_BASE = 520;      // Base ground level
const FIRE_COOLDOWN = 15;
const TORPEDO_SPEED = 6;

// --- Input state ---
const keys = {};
document.addEventListener('keydown', e => { keys[e.key] = true; e.preventDefault(); });
document.addEventListener('keyup', e => { keys[e.key] = false; });

// --- Terrain generation ---
function generateTerrain(length) {
  const ground = [];
  const islands = [];
  let y = GROUND_BASE;
  for (let x = 0; x < length; x += 4) {
    // Rolling hills
    y += (Math.random() - 0.48) * 3;
    y = Math.max(WATER_LINE + 30, Math.min(H - 20, y));
    ground.push({ x, y });
  }
  // Scattered islands (above water)
  for (let i = 0; i < length / 400; i++) {
    const ix = 400 + Math.random() * (length - 600);
    const iw = 60 + Math.random() * 80;
    const ih = 15 + Math.random() * 25;
    islands.push({ x: ix, w: iw, h: ih });
  }
  return { ground, islands };
}

// --- World init ---
function initWorld() {
  const terrain = generateTerrain(8000);
  return {
    tick: 0,
    scrollX: 0,
    sub: { x: 120, y: 200, vx: 0, vy: 0, angle: 0, health: 100, fuel: 500 },
    torpedoes: [],
    bombs: [],
    enemies: [],
    explosions: [],
    terrain,
    score: 0,
    kills: 0,
    fireCooldown: 0,
    enemyTimer: 0,
    gameOver: false,
    paused: false,
  };
}

let world = null;

// --- Init ---
async function init() {
  canvas.width = W;
  canvas.height = H;
  canvas.focus();

  const loadingEl = document.getElementById('loading');
  if (loadingEl) loadingEl.style.display = 'none';

  world = initWorld();
  requestAnimationFrame(gameLoop);
}

// --- Game loop ---
let lastTime = 0;
function gameLoop(timestamp) {
  const dt = Math.min(timestamp - lastTime, 32);
  lastTime = timestamp;

  if (!world.gameOver && !world.paused) {
    update(dt / 16);
  }
  draw();
  requestAnimationFrame(gameLoop);
}

// --- Update ---
function update(dt) {
  const sub = world.sub;
  world.tick++;
  world.scrollX += SCROLL_SPEED * dt;

  // --- Submarine physics (Sopwith-style) ---
  // Thrust (up key pitches nose up, adds lift)
  if (keys['ArrowUp']) {
    sub.vy -= THRUST * dt;
    sub.angle = Math.max(sub.angle - 0.03 * dt, -0.5);
  } else if (keys['ArrowDown']) {
    sub.vy += THRUST * 0.6 * dt;
    sub.angle = Math.min(sub.angle + 0.03 * dt, 0.5);
  } else {
    // Angle returns to neutral
    sub.angle *= 0.95;
  }

  // Forward/back speed (left slows, right boosts)
  if (keys['ArrowRight']) {
    sub.vx = Math.min(sub.vx + 0.15 * dt, MAX_SPEED);
  } else if (keys['ArrowLeft']) {
    sub.vx = Math.max(sub.vx - 0.15 * dt, -1);
  } else {
    sub.vx *= 0.98;
  }

  // Gravity always pulls down
  sub.vy += GRAVITY * dt;
  sub.vy = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, sub.vy));

  // Apply velocity
  sub.x += sub.vx * dt;
  sub.y += sub.vy * dt;

  // Keep on screen horizontally
  sub.x = Math.max(40, Math.min(W - 40, sub.x));
  // Ceiling
  if (sub.y < 20) { sub.y = 20; sub.vy = 0; }

  // --- Ground collision ---
  const groundY = getGroundY(sub.x + world.scrollX);
  if (sub.y > groundY - 12) {
    sub.y = groundY - 12;
    sub.vy = 0;
    if (Math.abs(sub.vx) > 1 || world.tick > 10) {
      sub.health -= 2 * dt;
      addExplosion(sub.x, sub.y + 10, 'small');
    }
  }

  // Water splash effect (entering/leaving water)
  const inWater = sub.y > WATER_LINE - world.scrollX * 0 ; // water is at fixed screen Y
  // Drag in water
  if (sub.y > WATER_LINE) {
    sub.vx *= 0.97;
    sub.vy *= 0.97;
  }

  // --- Firing ---
  world.fireCooldown = Math.max(0, world.fireCooldown - dt);
  if (keys[' '] && world.fireCooldown <= 0) {
    // Torpedo (forward)
    world.torpedoes.push({
      x: sub.x + 25, y: sub.y,
      vx: TORPEDO_SPEED + sub.vx, vy: sub.vy * 0.3,
      life: 120
    });
    world.fireCooldown = FIRE_COOLDOWN;
  }
  if (keys['Shift'] && world.fireCooldown <= 0) {
    // Bomb (drops down)
    world.bombs.push({
      x: sub.x, y: sub.y + 10,
      vx: sub.vx * 0.5, vy: 2,
      life: 180
    });
    world.fireCooldown = FIRE_COOLDOWN * 2;
  }

  // --- Update torpedoes ---
  world.torpedoes = world.torpedoes.filter(t => {
    t.x += t.vx * dt;
    t.y += t.vy * dt;
    t.life -= dt;
    // Ground hit
    const gy = getGroundY(t.x + world.scrollX);
    if (t.y > gy) {
      addExplosion(t.x, gy, 'small');
      return false;
    }
    return t.life > 0 && t.x > -10 && t.x < W + 50;
  });

  // --- Update bombs ---
  world.bombs = world.bombs.filter(b => {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.vy += GRAVITY * 0.8 * dt;
    b.life -= dt;
    const gy = getGroundY(b.x + world.scrollX);
    if (b.y > gy) {
      addExplosion(b.x, gy, 'big');
      world.score += 25;
      return false;
    }
    return b.life > 0;
  });

  // --- Spawn enemies ---
  world.enemyTimer += dt;
  if (world.enemyTimer > 80) {
    world.enemyTimer = 0;
    const ey = 60 + Math.random() * (WATER_LINE - 120);
    world.enemies.push({
      x: W + 30, y: ey,
      vx: -(1.5 + Math.random() * 1.5),
      vy: (Math.random() - 0.5) * 0.5,
      health: 2,
      type: Math.random() < 0.3 ? 'jet' : 'heli'
    });
  }

  // --- Update enemies ---
  world.enemies = world.enemies.filter(e => {
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    // Slight vertical wander
    e.vy += (Math.random() - 0.5) * 0.1;
    e.vy = Math.max(-1, Math.min(1, e.vy));
    return e.x > -50 && e.health > 0;
  });

  // --- Torpedo-enemy collisions ---
  world.torpedoes = world.torpedoes.filter(t => {
    for (let i = world.enemies.length - 1; i >= 0; i--) {
      const e = world.enemies[i];
      if (Math.abs(t.x - e.x) < 20 && Math.abs(t.y - e.y) < 15) {
        e.health--;
        if (e.health <= 0) {
          addExplosion(e.x, e.y, 'big');
          world.score += 200;
          world.kills++;
          world.enemies.splice(i, 1);
        } else {
          addExplosion(t.x, t.y, 'small');
        }
        return false;
      }
    }
    return true;
  });

  // --- Enemy-sub collision ---
  for (const e of world.enemies) {
    if (Math.abs(e.x - sub.x) < 25 && Math.abs(e.y - sub.y) < 18) {
      sub.health -= 15;
      addExplosion((e.x + sub.x) / 2, (e.y + sub.y) / 2, 'big');
      e.health = 0;
      world.enemies = world.enemies.filter(en => en.health > 0);
      break;
    }
  }

  // --- Game over ---
  if (sub.health <= 0) {
    sub.health = 0;
    world.gameOver = true;
    addExplosion(sub.x, sub.y, 'big');
  }

  // --- Update explosions ---
  world.explosions = world.explosions.filter(e => {
    e.age += dt;
    return e.age < e.duration;
  });
}

function addExplosion(x, y, size) {
  world.explosions.push({
    x, y, age: 0,
    duration: size === 'big' ? 40 : 20,
    radius: size === 'big' ? 30 : 15
  });
}

function getGroundY(worldX) {
  const terrain = world.terrain.ground;
  const idx = Math.floor(worldX / 4);
  if (idx < 0) return GROUND_BASE;
  if (idx >= terrain.length - 1) return GROUND_BASE;
  const t0 = terrain[idx], t1 = terrain[idx + 1];
  const frac = (worldX / 4) - idx;
  return t0.y + (t1.y - t0.y) * frac;
}

// --- Drawing ---
function draw() {
  // Sky gradient
  const skyGrad = ctx.createLinearGradient(0, 0, 0, WATER_LINE);
  skyGrad.addColorStop(0, '#0a1628');
  skyGrad.addColorStop(0.5, '#1a3a5c');
  skyGrad.addColorStop(1, '#2a6496');
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, W, WATER_LINE);

  // Stars (in upper sky)
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 30; i++) {
    const sx = ((i * 137 + world.scrollX * 0.1) % W);
    const sy = (i * 73) % (WATER_LINE * 0.6);
    const brightness = 0.3 + (Math.sin(world.tick * 0.02 + i) * 0.2);
    ctx.globalAlpha = brightness;
    ctx.fillRect(sx, sy, 1.5, 1.5);
  }
  ctx.globalAlpha = 1;

  // Clouds (parallax)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
  for (let i = 0; i < 6; i++) {
    const cx = ((i * 200 + 50 - world.scrollX * 0.3) % (W + 100)) - 50;
    const cy = 40 + i * 30;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 40 + i * 5, 12, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Water
  const waterGrad = ctx.createLinearGradient(0, WATER_LINE, 0, H);
  waterGrad.addColorStop(0, '#1a5276');
  waterGrad.addColorStop(0.3, '#154360');
  waterGrad.addColorStop(1, '#0b2e4a');
  ctx.fillStyle = waterGrad;
  ctx.fillRect(0, WATER_LINE, W, H - WATER_LINE);

  // Water surface waves
  ctx.strokeStyle = 'rgba(100, 180, 255, 0.4)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let x = 0; x < W; x += 2) {
    const wy = WATER_LINE + Math.sin((x + world.scrollX) * 0.03 + world.tick * 0.05) * 3;
    x === 0 ? ctx.moveTo(x, wy) : ctx.lineTo(x, wy);
  }
  ctx.stroke();

  // Ground / seafloor
  ctx.fillStyle = '#2d1810';
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let sx = 0; sx <= W; sx += 4) {
    const gy = getGroundY(sx + world.scrollX);
    ctx.lineTo(sx, gy);
  }
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fill();

  // Ground surface detail
  ctx.strokeStyle = '#4a3020';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let sx = 0; sx <= W; sx += 4) {
    const gy = getGroundY(sx + world.scrollX);
    sx === 0 ? ctx.moveTo(sx, gy) : ctx.lineTo(sx, gy);
  }
  ctx.stroke();

  // Green on top of ground (above water = grass, below water = seaweed)
  ctx.strokeStyle = '#2ecc71';
  ctx.lineWidth = 1;
  for (let sx = 0; sx < W; sx += 12) {
    const gy = getGroundY(sx + world.scrollX);
    if (gy < WATER_LINE + 10) {
      // Grass tufts
      ctx.beginPath();
      ctx.moveTo(sx, gy);
      ctx.lineTo(sx - 2, gy - 5);
      ctx.moveTo(sx, gy);
      ctx.lineTo(sx + 2, gy - 4);
      ctx.stroke();
    }
  }

  // --- Islands (above water) ---
  for (const isl of world.terrain.islands) {
    const screenX = isl.x - world.scrollX;
    if (screenX > -100 && screenX < W + 100) {
      // Island body
      ctx.fillStyle = '#5d4037';
      ctx.beginPath();
      ctx.ellipse(screenX, WATER_LINE, isl.w / 2, isl.h, 0, Math.PI, 0);
      ctx.fill();
      // Palm tree
      ctx.strokeStyle = '#795548';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(screenX, WATER_LINE - isl.h);
      ctx.lineTo(screenX + 2, WATER_LINE - isl.h - 25);
      ctx.stroke();
      ctx.fillStyle = '#27ae60';
      ctx.beginPath();
      ctx.ellipse(screenX + 2, WATER_LINE - isl.h - 28, 12, 6, 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // --- Torpedoes ---
  ctx.fillStyle = '#ffe66d';
  for (const t of world.torpedoes) {
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.fillRect(-6, -2, 12, 4);
    ctx.fillStyle = '#ff6b6b';
    ctx.fillRect(5, -1, 3, 2);
    ctx.fillStyle = '#ffe66d';
    ctx.restore();
  }

  // --- Bombs ---
  ctx.fillStyle = '#34495e';
  for (const b of world.bombs) {
    ctx.beginPath();
    ctx.arc(b.x, b.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // --- Enemies ---
  for (const e of world.enemies) {
    drawEnemy(e);
  }

  // --- Submarine ---
  drawSub(world.sub);

  // --- Explosions ---
  for (const exp of world.explosions) {
    const progress = exp.age / exp.duration;
    const r = exp.radius * (0.5 + progress);
    ctx.globalAlpha = 1 - progress;
    ctx.fillStyle = '#ff6b00';
    ctx.beginPath();
    ctx.arc(exp.x, exp.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffcc00';
    ctx.beginPath();
    ctx.arc(exp.x, exp.y, r * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // --- HUD ---
  drawHUD();

  // --- Game over ---
  if (world.gameOver) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#e74c3c';
    ctx.font = 'bold 48px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('MISSION FAILED', W / 2, H / 2 - 30);
    ctx.fillStyle = '#ecf0f1';
    ctx.font = '24px Arial';
    ctx.fillText(`Score: ${world.score}  |  Kills: ${world.kills}`, W / 2, H / 2 + 20);
    ctx.font = '18px Arial';
    ctx.fillStyle = '#bdc3c7';
    ctx.fillText('Press R to restart', W / 2, H / 2 + 60);

    if (keys['r'] || keys['R']) {
      world = initWorld();
    }
  }
}

function drawSub(sub) {
  ctx.save();
  ctx.translate(sub.x, sub.y);
  ctx.rotate(sub.angle);

  // Hull
  const inWater = sub.y > WATER_LINE;
  ctx.fillStyle = inWater ? '#2980b9' : '#4a6baf';
  ctx.beginPath();
  ctx.ellipse(0, 0, 22, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#1a5276';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Conning tower / wings
  if (!inWater) {
    // Wings (in air mode)
    ctx.fillStyle = '#e74c3c';
    ctx.beginPath();
    ctx.moveTo(-5, -4);
    ctx.lineTo(-15, -18);
    ctx.lineTo(-2, -6);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-5, 4);
    ctx.lineTo(-15, 18);
    ctx.lineTo(-2, 6);
    ctx.fill();
  }

  // Conning tower
  ctx.fillStyle = '#34495e';
  ctx.fillRect(-3, -15, 6, 7);

  // Periscope
  ctx.strokeStyle = '#7f8c8d';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, -15);
  ctx.lineTo(0, -20);
  ctx.lineTo(4, -20);
  ctx.stroke();

  // Nose
  ctx.fillStyle = '#2c3e50';
  ctx.beginPath();
  ctx.arc(22, 0, 4, -Math.PI / 2, Math.PI / 2);
  ctx.fill();

  // Propeller
  const pa = Date.now() / 40;
  ctx.strokeStyle = '#95a5a6';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-22, Math.sin(pa) * 6);
  ctx.lineTo(-22, -Math.sin(pa) * 6);
  ctx.stroke();

  // Porthole
  ctx.fillStyle = '#85c1e9';
  ctx.beginPath();
  ctx.arc(8, 0, 2.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();

  // Exhaust bubbles
  if (keys['ArrowUp'] || keys['ArrowRight']) {
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = inWater ? '#85c1e9' : '#bdc3c7';
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(
        sub.x - 22 - Math.random() * 15,
        sub.y + (Math.random() - 0.5) * 8,
        1 + Math.random() * 2, 0, Math.PI * 2
      );
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

function drawEnemy(e) {
  ctx.save();
  ctx.translate(e.x, e.y);

  if (e.type === 'jet') {
    // Fast enemy jet
    ctx.fillStyle = '#c0392b';
    ctx.beginPath();
    ctx.moveTo(15, 0);
    ctx.lineTo(-12, -8);
    ctx.lineTo(-8, 0);
    ctx.lineTo(-12, 8);
    ctx.closePath();
    ctx.fill();
    // Tail
    ctx.fillStyle = '#922b21';
    ctx.beginPath();
    ctx.moveTo(-8, 0);
    ctx.lineTo(-15, -5);
    ctx.lineTo(-15, 5);
    ctx.closePath();
    ctx.fill();
  } else {
    // Helicopter
    ctx.fillStyle = '#7f8c8d';
    ctx.beginPath();
    ctx.ellipse(0, 0, 12, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    // Rotor
    const ra = Date.now() / 30;
    ctx.strokeStyle = '#bdc3c7';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(Math.cos(ra) * 16, -8);
    ctx.lineTo(-Math.cos(ra) * 16, -8);
    ctx.stroke();
    // Tail
    ctx.strokeStyle = '#7f8c8d';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-12, 0);
    ctx.lineTo(-20, -2);
    ctx.stroke();
  }

  // Health indicator
  if (e.health < 2) {
    ctx.fillStyle = 'rgba(255, 0, 0, 0.6)';
    ctx.beginPath();
    ctx.arc(0, -12, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawHUD() {
  const sub = world.sub;

  // Health bar
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.fillRect(15, 15, 104, 18);
  const healthColor = sub.health > 50 ? '#2ecc71' : sub.health > 25 ? '#f39c12' : '#e74c3c';
  ctx.fillStyle = healthColor;
  ctx.fillRect(17, 17, sub.health, 14);
  ctx.strokeStyle = '#ecf0f1';
  ctx.lineWidth = 1;
  ctx.strokeRect(15, 15, 104, 18);

  // Labels
  ctx.fillStyle = '#ecf0f1';
  ctx.font = '13px Arial';
  ctx.textAlign = 'left';
  ctx.fillText(`HP: ${Math.ceil(sub.health)}`, 125, 29);

  // Score
  ctx.font = 'bold 18px Arial';
  ctx.fillText(`Score: ${world.score}`, 15, 55);

  // Kills
  ctx.font = '13px Arial';
  ctx.fillText(`Kills: ${world.kills}`, 15, 72);

  // Altitude / depth indicator
  const alt = Math.round(WATER_LINE - sub.y);
  const label = alt > 0 ? `Alt: ${alt}` : `Depth: ${-alt}`;
  ctx.textAlign = 'right';
  ctx.fillText(label, W - 15, 29);

  // Controls hint
  ctx.font = '11px Arial';
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.textAlign = 'center';
  ctx.fillText('Arrows: fly  |  Space: torpedo  |  Shift: bomb  |  R: restart', W / 2, H - 10);
}

// Start
init().catch(console.error);
