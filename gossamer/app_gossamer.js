// SPDX-License-Identifier: PMPL-1.0-or-later
// Airborne Submarine Squadron — Gossamer desktop game variant.
//
// Sopwith-style arcade: a flying submarine over scrolling terrain.
// Camera follows the sub — no forced scrolling. Sub can face and
// fly in either direction.
//
// ROADMAP:
//   v2 (current) — free movement, facing, component damage, buoyancy,
//                   islands, torpedoes, missiles, disembark, sound
//   v3 (planned) — multiplayer: fleet mechanics, coordination, shared
//                   world state, formation flying, role specialisation
//   v4 (planned) — space: orbital mechanics, atmosphere exit/re-entry,
//                   zero-g physics, upgradeable engines for orbit capability
//
// Architecture notes for v3/v4:
//   - All positions are world-coords; camera is just a view offset.
//     This decouples rendering from simulation (needed for netcode).
//   - Sub state is a self-contained object (serialisable for sync).
//   - Update logic is deterministic given inputs (lockstep-ready).
//   - Physics constants are grouped for easy per-environment override
//     (atmosphere vs vacuum vs water for v4 orbital transitions).

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// --- Constants ---
const W = 800, H = 600;
const GRAVITY = 0.15;
const THRUST = 0.35;
const MAX_SPEED = 5;
const WATER_LINE = 420;        // World Y where water surface is
const GROUND_BASE = 520;       // Shallow ground (above-water areas)
const SEA_FLOOR = 750;         // Deep sea floor (below water)
const FIRE_COOLDOWN = 15;
const TORPEDO_SPEED = 4;
const MISSILE_SPEED = 5;
const BUOYANCY = 0.25;
const SURFACE_DAMPING = 0.92;
const WATER_DRAG = 0.96;
const CAMERA_SMOOTH = 0.08;
const TERRAIN_LENGTH = 16000;
const START_TORPEDOES = 24;
const START_MISSILES = 12;
const PERISCOPE_MOVE_ACCEL = 0.15;
const PERISCOPE_MAX_SPEED = 1.5;
const PERISCOPE_DRAG = 0.93;
const PERISCOPE_MANUAL_SINK_RATE = 0.5;
const PERISCOPE_MANUAL_RISE_RATE = 0.4;
const PERISCOPE_MAX_DEPTH = 42;
const PERISCOPE_DIP_DEPTH = 28;
const PERISCOPE_SINK_RATE = 0.32;
const PERISCOPE_RISE_RATE = 0.28;
const PERISCOPE_VISIBLE_TOP = 6;
const PILOT_RUN_SPEED = 160;
const PILOT_JUMP_STRENGTH = 8;
const PILOT_GRAVITY = 0.6;
const PILOT_FRICTION = 0.82;
const DIVE_ACCEL = 0.18;
const MAX_DIVE_SPEED = 4.5;
const FORWARD_DIVE_BOOST = 0.02;
const AMMO_STATION_COUNT = 4;
const AMMO_STATION_RADIUS = 40;
const AMMO_STATION_REFILL_RATE = 0.7;
const AMMO_STATION_HEIGHT = 18;
const AMMO_STATION_COLOR = '#3b82f6';
const CHAFF_COOLDOWN = 120;
const CHAFF_LIFESPAN = 150;
const CHAFF_RADIUS = 48;
const CHAFF_DEFLECT_FORCE = 2.4;
const CHAFF_COLOR = '#f0b429';
const MINE_COUNT = 12;
const MINE_RADIUS = 16;
const MINE_CHAIN_LENGTH = 32;
const MINE_DAMAGE = 35;
const MINE_COLOR = '#7f1111';
const TWO_PI = Math.PI * 2;
const ATMOSPHERE_CEILING = 20;
const ORBIT_TRIGGER_SPEED_MPH = 88;
const SPEEDOMETER_MAX_MPH = 3200;
const ACCELEROMETER_MAX_G = 3.2;
const MPH_PER_GAME_SPEED = 24;
const SPACE_MPH_PER_GAME_SPEED = 2400;
const ACCEL_G_SCALE = 0.42;
const SHARP_ASCENT_ANGLE = -0.42;
const SHARP_ASCENT_VY = -2.4;
const STARLIFT_ACCEL = 0.65;
const SPACE_ENTRY_ALTITUDE = -220;
const START_DEPTH_CHARGES = 8;
const DEPTH_CHARGE_COOLDOWN = 42;
const DEPTH_CHARGE_GRAVITY = 0.22;
const DEPTH_CHARGE_WATER_DRAG = 0.985;
const DEPTH_CHARGE_BLAST_RADIUS = 58;
const DEPTH_CHARGE_LIFE = 180;
const DEPTH_CHARGE_COLOR = '#9b59b6';
const AFTERBURNER_MAX_CHARGE = 100;
const AFTERBURNER_DRAIN = 1.4;
const AFTERBURNER_RECHARGE = 0.55;
const AFTERBURNER_ACCEL = 0.24;
const AFTERBURNER_SPEED_MULT = 1.7;
const AFTERBURNER_LIFT = 0.08;
const AFTERBURNER_COLOR = '#ff7a18';
const SPACE_CAMERA_SMOOTH = 0.06;
const SPACE_TIME_SCALE = 0.22;
const SOLAR_GM = 1180;
const ORBITAL_TURN_RATE = 0.06;
const ORBITAL_THRUST = 0.035;
const ORBITAL_RETRO_THRUST = 0.025;
const ORBITAL_AFTERBURNER_THRUST = 0.065;
const ORBITAL_COLLISION_RADIUS = 12;
const SOLAR_SYSTEM_BODIES = [
  { id: 'sun', label: 'Sun', orbitRadius: 0, radius: 32, color: '#ffd166', period: 1, phase: 0, gm: SOLAR_GM },
  { id: 'mercury', label: 'Mercury', orbitRadius: 85, radius: 4, color: '#b08968', period: 60, phase: 0.4, gm: 4 },
  { id: 'venus', label: 'Venus', orbitRadius: 120, radius: 7, color: '#d4a373', period: 90, phase: 1.1, gm: 6 },
  { id: 'earth', label: 'Earth', orbitRadius: 165, radius: 8, color: '#4ea8de', period: 120, phase: 2.0, gm: 10 },
  { id: 'mars', label: 'Mars', orbitRadius: 205, radius: 6, color: '#e76f51', period: 190, phase: 2.7, gm: 5 },
  { id: 'jupiter', label: 'Jupiter', orbitRadius: 260, radius: 16, color: '#d9a066', period: 320, phase: 0.8, gm: 22 },
  { id: 'saturn', label: 'Saturn', orbitRadius: 315, radius: 14, color: '#e9c46a', period: 420, phase: 1.8, gm: 18, ring: true },
  { id: 'uranus', label: 'Uranus', orbitRadius: 355, radius: 11, color: '#8ecae6', period: 520, phase: 2.9, gm: 12 },
  { id: 'neptune', label: 'Neptune', orbitRadius: 395, radius: 11, color: '#4361ee', period: 620, phase: 3.6, gm: 12 },
];
const PLANETS = [
  { name: 'Aegis', sky: '#041133', water: '#0f1f3b', land: '#2a1a1d', enemy: '#f76262', accent: '#ffb703' },
  { name: 'Nemoris', sky: '#171b1c', water: '#0c3331', land: '#1c2f1d', enemy: '#9de2d6', accent: '#5eead4' },
  { name: 'Vesper', sky: '#190b1a', water: '#2a0d20', land: '#331931', enemy: '#ffd6a5', accent: '#ff6b6b' },
  { name: 'Arcadia', sky: '#021625', water: '#0c3246', land: '#1f1a2a', enemy: '#f8f3a6', accent: '#48cae4' },
];

const SUN_DESTINATION = {
  name: 'Sun',
  sky: '#090b1a',
  water: '#000000',
  land: '#090b1a',
  enemy: '#f97316',
  accent: '#fcd34d',
  hotkey: '5',
  star: true,
};

const PLANET_DESTINATIONS = [
  ...PLANETS.map((planet, idx) => ({ ...planet, hotkey: `${idx + 1}`, index: idx })),
  SUN_DESTINATION,
];

const PLANET_HOTKEY_MAP = {
  '1': 0,
  '2': 1,
  '3': 2,
  '4': 3,
  '5': 'sun',
};

const SOLAR_MAP_SIZE = 110;
const SOLAR_MAP_PADDING = 12;
const SOLAR_MAP_SCALE = 0.32;
const SOLAR_MAP_ANIMATION_SPEED = 0.08;
const SUN_BURN_DURATION = 260;
const SUN_BURN_DAMAGE = 3.6;
const SUN_BURN_TICK = 18;
const SETTINGS_KEY = 'airborne-submarine-squadron:gossamer:settings';
const LEADERBOARD_KEY = 'airborne-submarine-squadron:gossamer:leaderboard';
const SAFE_DIVER_SPEED = 0.55;
const DIVER_RANGE = 140;
const DIVER_SPEED = 2.4;
const SUB_SKINS = [
  { id: 'ocean', label: 'Ocean Blue', hull: '#4a6baf', hullStroke: '#1a5276', wings: '#e74c3c', tower: '#34495e', nose: '#2c3e50', porthole: '#85c1e9' },
  { id: 'red', label: 'Retro Red', hull: '#c0392b', hullStroke: '#7b241c', wings: '#f6b93b', tower: '#641e16', nose: '#3d0c02', porthole: '#fdebd0' },
  { id: 'amber', label: 'Amber Gold', hull: '#d68910', hullStroke: '#9c640c', wings: '#f8c471', tower: '#7e5109', nose: '#5d4037', porthole: '#fff2cc' },
  { id: 'emerald', label: 'Emerald', hull: '#1e8449', hullStroke: '#145a32', wings: '#58d68d', tower: '#0b5345', nose: '#0e6251', porthole: '#d5f5e3' },
  { id: 'violet', label: 'Violet', hull: '#7d3c98', hullStroke: '#512e5f', wings: '#c39bd3', tower: '#4a235a', nose: '#2e1a47', porthole: '#ebdef0' },
  { id: 'spectrum', label: 'Spectrum Custom', customHue: true },
  { id: 'rainbow', label: 'Rainbow', rainbow: true, porthole: '#ffffff', wings: '#ffffff', nose: '#1d3557', tower: '#111827' },
  { id: 'pride', label: 'Pride Submarine', pride: true, porthole: '#ffffff', wings: '#ffffff', nose: '#111827', tower: '#111827' },
];
const DEFAULT_SETTINGS = {
  subSkin: 'ocean',
  customHue: 210,
  showLegend: true,
};

// --- Sub component definitions ---
// Each part has max HP, a weight for random hit distribution, and a
// functional penalty description.  The HUD damage diagram draws these
// in order from nose (front) to rudder (rear).
const SUB_PARTS = [
  { id: 'nose',    name: 'Nose',    maxHp: 100, weight: 2, color: '#2c3e50' },
  { id: 'hull',    name: 'Hull',    maxHp: 120, weight: 5, color: '#4a6baf' },
  { id: 'tower',   name: 'Tower',   maxHp: 70,  weight: 1, color: '#34495e' },
  { id: 'engine',  name: 'Engine',  maxHp: 80,  weight: 3, color: '#95a5a6' },
  { id: 'wings',   name: 'Wings',   maxHp: 60,  weight: 2, color: '#e74c3c' },
  { id: 'rudder',  name: 'Rudder',  maxHp: 60,  weight: 2, color: '#7f8c8d' },
];

// ============================================================
// SOUND ENGINE
// ============================================================
const SFX = (function() {
  let audioCtx = null;
  function ensureCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }
  function tone(freq, dur, type, vol, det) {
    const ac = ensureCtx(), o = ac.createOscillator(), g = ac.createGain();
    o.type = type||'square'; o.frequency.value = freq; if (det) o.detune.value = det;
    g.gain.setValueAtTime(vol||0.15, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
    o.connect(g); g.connect(ac.destination); o.start(ac.currentTime); o.stop(ac.currentTime + dur);
  }
  function noise(dur, vol) {
    const ac = ensureCtx(), n = ac.sampleRate * dur, b = ac.createBuffer(1, n, ac.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random()*2-1;
    const s = ac.createBufferSource(); s.buffer = b;
    const g = ac.createGain(); g.gain.setValueAtTime(vol||0.2, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
    const f = ac.createBiquadFilter(); f.type='lowpass'; f.frequency.value=600;
    s.connect(f); f.connect(g); g.connect(ac.destination); s.start(ac.currentTime); s.stop(ac.currentTime+dur);
  }
  return {
    torpedoLaunch()  { tone(220,0.08,'sine',0.12); tone(110,0.15,'sine',0.08); },
    torpedoSplash()  { noise(0.12,0.1); tone(80,0.1,'sine',0.06); },
    missileLaunch()  { tone(150,0.06,'sawtooth',0.1); tone(400,0.3,'sawtooth',0.12); noise(0.15,0.08); },
    missileIgnite()  { tone(300,0.05,'sawtooth',0.08); tone(800,0.25,'sawtooth',0.1); },
    explodeSmall()   { noise(0.2,0.15); tone(120,0.15,'sine',0.1); },
    explodeBig()     { noise(0.4,0.25); tone(60,0.3,'sine',0.15); tone(40,0.4,'triangle',0.1); },
    damage()         { noise(0.1,0.12); tone(90,0.08,'square',0.08); },
    islandCrash()    { noise(0.3,0.3); tone(50,0.25,'sine',0.2); tone(35,0.35,'triangle',0.15); },
    enemyDestroyed() { noise(0.35,0.2); tone(200,0.1,'square',0.08); tone(100,0.25,'sine',0.12); },
    gameOver()       { tone(300,0.2,'square',0.1); tone(200,0.3,'square',0.1); tone(100,0.5,'sawtooth',0.15); noise(0.6,0.2); },
    thrustPulse()    { tone(65,0.08,'sawtooth',0.03, Math.random()*20-10); },
    waterSplash()    { noise(0.15,0.12); tone(150,0.1,'sine',0.06); },
    waterBob()       { tone(100,0.05,'sine',0.03); },
    disembark()      { tone(440,0.1,'sine',0.08); tone(550,0.1,'sine',0.06); tone(660,0.15,'sine',0.08); },
    embark()         { tone(660,0.1,'sine',0.08); tone(550,0.1,'sine',0.06); tone(440,0.15,'sine',0.08); },
  };
})();

// --- Input ---
const keys = {};
const keyJustPressed = {};
document.addEventListener('keydown', e => {
  if (!keys[e.key]) keyJustPressed[e.key] = true;
  keys[e.key] = true;
  if (e.key === 'F11') {
    e.preventDefault();
    if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(()=>{});
    else document.exitFullscreen().catch(()=>{});
    return;
  }
  if (e.key === 'Escape' && world && !world.gameOver) {
    world.paused = !world.paused; e.preventDefault(); return;
  }
  e.preventDefault();
});
document.addEventListener('keyup', e => { keys[e.key] = false; });
window.addEventListener('focus', () => { canvas.focus(); });

// --- Terrain ---
function generateTerrain(length) {
  const ground = [], islands = [], caves = [];
  let y = SEA_FLOOR;
  for (let x = 0; x < length; x += 4) {
    y += (Math.random() - 0.48) * 4;
    y = Math.max(WATER_LINE + 60, Math.min(SEA_FLOOR + 40, y));
    ground.push({ x, y });
  }
  // Cave entrances in the sea floor (lead to underground levels)
  for (let i = 0; i < length / 2000; i++) {
    const cx = 800 + Math.random() * (length - 1600);
    const cw = 40 + Math.random() * 30; // Entrance width
    const ch = 25 + Math.random() * 15; // Entrance height
    // Get ground Y at this position
    const gIdx = Math.floor(cx / 4);
    const groundY = (gIdx >= 0 && gIdx < ground.length) ? ground[gIdx].y : SEA_FLOOR;
    caves.push({ x: cx, y: groundY, w: cw, h: ch, levelId: i });
  }
  for (let i = 0; i < length / 400; i++) {
    const ix = 400 + Math.random() * (length - 600);
    const topW = 40 + Math.random() * 50;
    const baseW = topW + 30 + Math.random() * 40;
    const ih = 18 + Math.random() * 22;
    // Underwater foundation: uneven rocky base extending down from waterline
    const underwaterDepth = 30 + Math.random() * 50; // How deep the rock goes
    const underwaterW = baseW + 10 + Math.random() * 30; // Wider than above-water
    const hasTunnel = Math.random() < 0.25; // 25% chance of a passage through
    const tunnelY = WATER_LINE + underwaterDepth * (0.3 + Math.random() * 0.4); // Tunnel vertical pos
    const tunnelH = 18 + Math.random() * 10; // Tunnel height (must fit sub)
    // Generate uneven underwater rock profile (jagged points)
    const rockPoints = [];
    const numPts = 6 + Math.floor(Math.random() * 4);
    for (let p = 0; p <= numPts; p++) {
      const frac = p / numPts;
      const px = ix - underwaterW / 2 + frac * underwaterW;
      const baseDepth = WATER_LINE + underwaterDepth * Math.sin(frac * Math.PI); // Arch shape
      const jitter = (Math.random() - 0.5) * 15;
      rockPoints.push({ x: px, y: baseDepth + jitter });
    }
    islands.push({ x: ix, topW, baseW, h: ih, underwaterDepth, underwaterW, hasTunnel, tunnelY, tunnelH, rockPoints });
  }
  // Radar towers on islands — 3 tiers
  const radars = [];
  const islandsCopy = [...islands];
  // Shuffle and pick islands for radars
  for (let i = islandsCopy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [islandsCopy[i], islandsCopy[j]] = [islandsCopy[j], islandsCopy[i]];
  }
  const radarCount = Math.min(Math.floor(islands.length * 0.4), 15);
  for (let i = 0; i < radarCount; i++) {
    const isl = islandsCopy[i];
    if (!isl || isl.h < 20) continue; // Need tall enough island
    const roll = Math.random();
    let tier;
    if (roll < 0.5)      tier = 1; // Basic — slow rotation, alerts ships
    else if (roll < 0.85) tier = 2; // Medium — fast rotation, machine guns
    else                  tier = 3; // Heavy — SAM missiles, armoured, reflects missiles
    const hp = tier === 1 ? 30 : tier === 2 ? 80 : 150;
    radars.push({
      x: isl.x,
      y: WATER_LINE - isl.h,  // Top of island
      tier,
      hp, maxHp: hp,
      angle: Math.random() * Math.PI * 2, // Current dish rotation
      cooldown: 0,
      alertRadius: tier === 1 ? 250 : tier === 2 ? 350 : 450,
      destroyed: false,
    });
  }
  // Start and end ports (docks at water level)
  const startPort = { x: 150, w: 80, name: 'HOME PORT' };
  const endPort = { x: length - 200, w: 80, name: 'DESTINATION' };
  return { ground, islands, caves, radars, startPort, endPort };
}

function createAmmoStations(terrain) {
  const stations = [];
  const sample = terrain.islands.length;
  const count = Math.min(AMMO_STATION_COUNT, sample);
  for (let i = 0; i < count; i++) {
    const idx = Math.floor((i + 0.5) * sample / count);
    const isl = terrain.islands[idx];
    if (!isl) continue;
    const offset = (Math.random() - 0.5) * isl.topW * 0.4;
    stations.push({
      x: isl.x + offset,
      y: WATER_LINE - 12,
      pulse: Math.random() * Math.PI * 2,
      glow: 0,
    });
  }
  return stations;
}

function updateAmmoStations(world, dt) {
  const sub = world.sub;
  for (const station of world.ammoStations) {
    const dist = Math.hypot(sub.worldX - station.x, sub.y - station.y);
    if (dist <= AMMO_STATION_RADIUS) {
      station.glow = Math.min(1, station.glow + dt * 1.5);
      const refill = AMMO_STATION_REFILL_RATE * dt;
      sub.torpedoAmmo = Math.min(START_TORPEDOES, sub.torpedoAmmo + refill);
      sub.missileAmmo = Math.min(START_MISSILES, sub.missileAmmo + refill * 0.6);
    } else {
      station.glow = Math.max(0, station.glow - dt * 0.4);
    }
  }
}

function drawAmmoStations(world) {
  for (const station of world.ammoStations) {
    const sx = toScreen(station.x);
    const alpha = 0.25 + 0.2 * Math.sin(world.tick * 0.04 + station.pulse);
    ctx.save();
    ctx.globalAlpha = station.glow * 0.5 + 0.4;
    ctx.strokeStyle = AMMO_STATION_COLOR;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.arc(sx, station.y, AMMO_STATION_RADIUS * (0.3 + 0.1 * station.glow), 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = AMMO_STATION_COLOR;
    ctx.beginPath();
    ctx.ellipse(sx, station.y, 12, 6 + Math.sin(world.tick * 0.1 + station.pulse) * 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function generateMines(terrain) {
  const mines = [];
  const sample = terrain.islands.length;
  for (let i = 0; i < MINE_COUNT; i++) {
    const isl = terrain.islands[Math.floor(Math.random() * sample)];
    const baseX = isl ? isl.x : Math.random() * TERRAIN_LENGTH;
    const spread = isl ? isl.baseW * 0.5 : 120;
    const x = baseX + (Math.random() - 0.5) * spread;
    const y = groundYFromTerrain(terrain, x) - 10;
    mines.push({
      x, y,
      active: true,
      pulse: Math.random() * Math.PI * 2,
    });
  }
  return mines;
}

function groundYFromTerrain(terrain, worldX) {
  const t = terrain.ground;
  const idx = Math.floor(worldX / 4);
  if (idx < 0 || idx >= t.length - 1) return SEA_FLOOR;
  const t0 = t[idx], t1 = t[idx + 1];
  return t0.y + (t1.y - t0.y) * ((worldX / 4) - idx);
}

function updateMines(world, dt) {
  const sub = world.sub;
  for (const mine of world.mines) {
    if (!mine.active) continue;
    mine.pulse += dt * 0.04;
    const dist = Math.hypot(sub.worldX - mine.x, sub.y - mine.y);
    if (dist < MINE_RADIUS + 12) {
      triggerMine(world, mine);
      continue;
    }
    for (const torp of world.torpedoes) {
      if (!torp.active) continue;
      const mdist = Math.hypot(torp.worldX - mine.x, torp.y - mine.y);
      if (mdist < MINE_RADIUS + 6) {
        torp.life = 0;
        triggerMine(world, mine);
        break;
      }
    }
  }
}

function triggerMine(world, mine) {
  if (!mine.active) return;
  mine.active = false;
  addExplosion(mine.x, mine.y, 'big');
  addParticles(mine.x, mine.y, 16, '#f44336');
  damageRandomPart(world.sub.parts, MINE_DAMAGE);
  world.score += 120;
}

function drawMines(world) {
  for (const mine of world.mines) {
    if (!mine.active) continue;
    const sx = toScreen(mine.x);
    const sy = mine.y;
    ctx.save();
    ctx.strokeStyle = MINE_COLOR;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx, sy - MINE_CHAIN_LENGTH);
    ctx.lineTo(sx, sy);
    ctx.stroke();
    ctx.fillStyle = MINE_COLOR;
    ctx.beginPath();
    ctx.arc(sx, sy, MINE_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.arc(sx, sy, MINE_RADIUS + 4 + Math.sin(world.tick * 0.03 + mine.pulse) * 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

function updateChaffs(world, dt) {
  world.chaffCooldown = Math.max(0, world.chaffCooldown - dt);
  for (let i = world.chaffs.length - 1; i >= 0; i--) {
    const chaff = world.chaffs[i];
    chaff.age += dt;
    if (chaff.age > CHAFF_LIFESPAN) {
      world.chaffs.splice(i, 1);
    }
  }
}

function drawChaffs(world) {
  for (const chaff of world.chaffs) {
    const sx = toScreen(chaff.x);
    ctx.save();
    const alpha = 0.4 + 0.6 * (1 - chaff.age / CHAFF_LIFESPAN);
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.fillStyle = CHAFF_COLOR;
    ctx.beginPath();
    ctx.arc(sx, chaff.y, CHAFF_RADIUS * 0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// --- Island hit test (above water trapezoid + underwater rock) ---
function islandHitTest(worldX, screenY) {
  for (const isl of world.terrain.islands) {
    const top = WATER_LINE - isl.h;
    // Above-water trapezoid check
    if (screenY <= WATER_LINE && screenY >= top - 2) {
      const t = Math.max(0, Math.min(1, (screenY - top) / isl.h));
      const halfW = (isl.topW / 2) + t * ((isl.baseW - isl.topW) / 2);
      if (Math.abs(worldX - isl.x) <= halfW) return { island: isl };
    }
    // Underwater rock check
    if (screenY > WATER_LINE && screenY < WATER_LINE + isl.underwaterDepth + 10) {
      const dx = Math.abs(worldX - isl.x);
      if (dx > isl.underwaterW / 2) continue;
      // Check if inside the rock profile
      const frac = (worldX - (isl.x - isl.underwaterW/2)) / isl.underwaterW;
      const depthAtX = WATER_LINE + isl.underwaterDepth * Math.sin(Math.max(0, Math.min(1, frac)) * Math.PI);
      if (screenY < depthAtX) {
        // Inside rock — but check for tunnel
        if (isl.hasTunnel && screenY > isl.tunnelY - isl.tunnelH/2 && screenY < isl.tunnelY + isl.tunnelH/2
            && dx < isl.underwaterW * 0.35) {
          continue; // In the tunnel — no collision
        }
        return { island: isl, underwater: true };
      }
    }
  }
  return null;
}

function nearbyIslandForDocking(worldX, screenY) {
  for (const isl of world.terrain.islands) {
    const dx = Math.abs(worldX - isl.x);
    if (dx > isl.baseW/2 - 5 && dx < isl.baseW/2 + 30 && screenY > WATER_LINE - 15 && screenY < WATER_LINE + 15)
      return isl;
  }
  return null;
}

// --- Damage system ---
function createParts() {
  const parts = {};
  for (const def of SUB_PARTS) parts[def.id] = def.maxHp;
  return parts;
}

// Deal damage to a random part (weighted). Returns the part hit.
function damageRandomPart(parts, amount) {
  const totalWeight = SUB_PARTS.reduce((s, p) => s + (parts[p.id] > 0 ? p.weight : 0), 0);
  if (totalWeight <= 0) return null;
  let roll = Math.random() * totalWeight;
  for (const def of SUB_PARTS) {
    if (parts[def.id] <= 0) continue;
    roll -= def.weight;
    if (roll <= 0) {
      parts[def.id] = Math.max(0, parts[def.id] - amount);
      return def;
    }
  }
  return null;
}

// Overall health = sum of all parts / sum of all max
function overallHealth(parts) {
  let cur = 0, max = 0;
  for (const def of SUB_PARTS) { cur += parts[def.id]; max += def.maxHp; }
  return cur / max * 100;
}

// Functional penalties from damaged parts
function getSpeedMult(parts)   { return parts.engine > 0 ? 1 : 0.4; }
function getThrustMult(parts)  { return parts.wings > 0 ? 1 : 0.5; }
function getTurnMult(parts)    { return parts.rudder > 0 ? 1 : 0.3; }
function getBackDamagePenalty(parts) {
  const enginePct = clamp(parts.engine / 80, 0, 1);
  const rudderPct = clamp(parts.rudder / 60, 0, 1);
  return clamp(1 - (enginePct + rudderPct) / 2, 0, 1);
}
function getFrontControlPenalty(parts) {
  return clamp(1 - parts.nose / 100, 0, 1);
}
function getHullBuoyancyPenalty(parts) {
  return clamp(1 - parts.hull / 120, 0, 1);
}
function canFireTorpedo(parts) { return parts.nose > 20; }
function clamp(v, lo, hi)      { return Math.max(lo, Math.min(hi, v)); }

function velocityToMph(vx, vy, mode) {
  const scale = mode === 'orbit' ? SPACE_MPH_PER_GAME_SPEED : MPH_PER_GAME_SPEED;
  return Math.hypot(vx, vy) * scale;
}

function loadLeaderboard() {
  try {
    const raw = window.localStorage.getItem(LEADERBOARD_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.slice(0, 5) : [];
  } catch {
    return [];
  }
}

function saveLeaderboard(entries) {
  try {
    window.localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(entries.slice(0, 5)));
  } catch {
    // Ignore storage failures; the in-memory leaderboard still works.
  }
}

function loadSettings() {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings) {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage failures and keep running.
  }
}

function currentSubSkin(settings) {
  return SUB_SKINS.find((skin) => skin.id === settings.subSkin) || SUB_SKINS[0];
}

function resolveSubSkin(settings) {
  const skin = currentSubSkin(settings);
  if (!skin.customHue) return skin;
  const hue = ((settings.customHue ?? DEFAULT_SETTINGS.customHue) % 360 + 360) % 360;
  return {
    ...skin,
    hue,
    hull: `hsl(${hue} 74% 54%)`,
    hullStroke: `hsl(${hue} 72% 28%)`,
    wings: `hsl(${(hue + 30) % 360} 88% 70%)`,
    tower: `hsl(${hue} 42% 22%)`,
    nose: `hsl(${(hue + 10) % 360} 58% 18%)`,
    porthole: `hsl(${(hue + 180) % 360} 95% 86%)`,
  };
}

function cycleSubSkin(settings, direction) {
  const index = SUB_SKINS.findIndex((skin) => skin.id === settings.subSkin);
  const nextIndex = (index + direction + SUB_SKINS.length) % SUB_SKINS.length;
  settings.subSkin = SUB_SKINS[nextIndex].id;
  saveSettings(settings);
  return currentSubSkin(settings);
}

function adjustCustomHue(settings, delta) {
  settings.customHue = ((settings.customHue ?? DEFAULT_SETTINGS.customHue) + delta + 360) % 360;
  saveSettings(settings);
  return resolveSubSkin(settings);
}

function isSubStationaryForDiver(sub) {
  return Math.hypot(sub.vx, sub.vy) <= SAFE_DIVER_SPEED && !sub.liftingOff && !sub.periscopeMode;
}

function recordLeaderboardEntry(result) {
  const board = loadLeaderboard();
  board.push(result);
  board.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.kills !== a.kills) return b.kills - a.kills;
    return a.duration - b.duration;
  });
  const trimmed = board.slice(0, 5);
  saveLeaderboard(trimmed);
  return trimmed;
}

function updateTelemetry(dt, vx, vy, mode) {
  if (!world || !world.telemetry) return;
  const telemetry = world.telemetry;
  const safeDt = Math.max(dt, 0.001);
  const ax = ((vx - telemetry.lastVx) / safeDt) * ACCEL_G_SCALE;
  const ay = ((vy - telemetry.lastVy) / safeDt) * ACCEL_G_SCALE;
  telemetry.lastVx = vx;
  telemetry.lastVy = vy;
  telemetry.accelX = ax;
  telemetry.accelY = ay;
  telemetry.accelG = Math.hypot(ax, ay);
  telemetry.speedMph = velocityToMph(vx, vy, mode);
  telemetry.maxSpeedMph = Math.max(telemetry.maxSpeedMph, telemetry.speedMph);
  telemetry.mode = mode;
  telemetry.launchReady = mode === 'atmosphere' && telemetry.speedMph >= ORBIT_TRIGGER_SPEED_MPH;
}

function solarBodyPosition(def, time) {
  if (def.id === 'sun') {
    return { ...def, x: 0, y: 0, angle: 0 };
  }
  const angle = def.phase + (time * SPACE_TIME_SCALE / def.period) * TWO_PI;
  return {
    ...def,
    angle,
    x: Math.cos(angle) * def.orbitRadius,
    y: Math.sin(angle) * def.orbitRadius,
  };
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

function createOrbitState(entrySpeedMph) {
  const earthDef = SOLAR_SYSTEM_BODIES.find((body) => body.id === 'earth');
  const earth = solarBodyPosition(earthDef, 0);
  const orbitalRadius = earthDef.orbitRadius + 18;
  const angle = earth.angle;
  const orbitalSpeed = Math.sqrt(SOLAR_GM / orbitalRadius);
  const speedBonus = Math.max(0, entrySpeedMph - ORBIT_TRIGGER_SPEED_MPH) / 150;
  return {
    time: 0,
    shipX: Math.cos(angle) * orbitalRadius,
    shipY: Math.sin(angle) * orbitalRadius,
    shipVx: -Math.sin(angle) * (orbitalSpeed + speedBonus),
    shipVy: Math.cos(angle) * (orbitalSpeed + speedBonus),
    shipAngle: angle + Math.PI / 2,
    cameraX: 0,
    cameraY: 0,
    trail: [],
    nearestBody: { body: earth, distance: 18 },
  };
}

function enterOrbitMode(entrySpeedMph) {
  const sub = world.sub;
  world.mode = 'orbit';
  world.space = createOrbitState(entrySpeedMph);
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
  sub.worldX = world.space.shipX;
  world.caveMessage = { text: '88 MPH LOCKED — ORBITAL MECHANICS ONLINE', timer: 180 };
}

function getCurrentPlanetPalette() {
  return world.planetPalette || PLANETS[world.currentPlanet] || PLANETS[0];
}

function canWarpToPlanet() {
  const sub = world.sub;
  const currentSpeed = velocityToMph(sub.vx, sub.vy, 'atmosphere');
  return currentSpeed >= ORBIT_TRIGGER_SPEED_MPH
    && keys['ArrowUp']
    && sub.y <= ATMOSPHERE_CEILING
    && sub.angle <= SHARP_ASCENT_ANGLE;
}

function startPlanetWarp(target = null) {
  if (!canWarpToPlanet()) {
    world.caveMessage = { text: 'BUILD 88 MPH + SHARP CLIMB BEFORE WARP', timer: 120 };
    return;
  }

  let destination = PLANETS[(world.currentPlanet + 1) % PLANETS.length];
  if (target === 'sun') {
    destination = SUN_DESTINATION;
  } else if (typeof target === 'number' && target >= 0 && target < PLANETS.length) {
    world.currentPlanet = target;
    destination = PLANETS[target];
  } else {
    world.currentPlanet = (world.currentPlanet + 1) % PLANETS.length;
  }

  if (destination.star) {
    world.caveMessage = { text: 'SUN BURN — RETROGRADE NOW', timer: 160 };
  } else {
    world.planetPalette = destination;
    world.caveMessage = { text: `Warp drop: ${destination.name}`, timer: 140 };
  }

  world.currentDestination = destination;
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
  world.sunBurnTimer = destination.star ? SUN_BURN_DURATION : 0;
  world.sunBurnTick = destination.star ? SUN_BURN_TICK : 0;
}

function ensureLeaderboardRecorded(status) {
  if (world.leaderboardRecorded) return;
  world.leaderboard = recordLeaderboardEntry({
    status,
    score: world.score,
    kills: world.kills,
    duration: world.tick,
    mode: world.mode || 'atmosphere',
    recordedAt: new Date().toISOString(),
  });
  world.leaderboardRecorded = true;
}

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
    if (charge.life <= 0 || charge.y >= groundY - 4 || hitMine) {
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

function handleSunBurn(dt) {
  if (world.sunBurnTimer <= 0) return;
  world.sunBurnTimer = Math.max(0, world.sunBurnTimer - dt);
  world.sunBurnTick -= dt;
  if (world.sunBurnTick <= 0) {
    damageRandomPart(world.sub.parts, SUN_BURN_DAMAGE);
    world.sunBurnTick = SUN_BURN_TICK;
  }
  if (world.sunBurnTimer <= 0) {
    world.caveMessage = { text: 'SUN BURN: SYSTEMS CRITICAL', timer: 120 };
  }
}

// --- World init ---
function initWorld() {
  const terrain = generateTerrain(TERRAIN_LENGTH);
  const settings = loadSettings();
  return {
    tick: 0,
    mode: 'atmosphere',
    cameraX: 0,        // World X at left screen edge
    cameraY: 0,        // World Y at top screen edge (0 = sky view)
    levelComplete: false,
    settings,
    leaderboard: loadLeaderboard(),
    leaderboardRecorded: false,
    telemetry: {
      speedMph: 0,
      maxSpeedMph: 0,
      accelX: 0,
      accelY: 0,
      accelG: 0,
      lastVx: 0,
      lastVy: 0,
      mode: 'atmosphere',
      launchReady: false,
    },
    space: null,
    currentPlanet: 0,
    planetPalette: PLANETS[0],
    currentDestination: PLANET_DESTINATIONS[0],
    sunBurnTimer: 0,
    sunBurnTick: 0,
    sub: {
      worldX: 180,      // Start at home port
      y: WATER_LINE - 7, // Floating at dock
      vx: 0, vy: 0,
      angle: 0,
      facing: 1,        // 1 = right, -1 = left
      parts: createParts(),
      wasInWater: false,
      floating: false,
      liftingOff: false,
      disembarked: false,
      disembarkIsland: null,
      diverMode: false,
      pilotX: 0, pilotY: 0,
      pilotVx: 0,
      pilotVy: 0,
      pilotOnGround: true,
      diving: false,
      periscopeMode: false,
      periscopeDepth: 0,
      torpedoAmmo: START_TORPEDOES,
      missileAmmo: START_MISSILES,
      depthChargeAmmo: START_DEPTH_CHARGES,
      afterburnerCharge: AFTERBURNER_MAX_CHARGE,
      afterburnerActive: false,
    },
    torpedoes: [],       // All positions in world coords
    missiles: [],
    depthCharges: [],
    enemies: [],
    explosions: [],
    particles: [],
    terrain,
    ammoStations: createAmmoStations(terrain),
    chaffs: [],
    chaffCooldown: 0,
    mines: generateMines(terrain),
    score: 0,
    kills: 0,
    fireCooldown: 0,
    missileCooldown: 0,
    depthChargeCooldown: 0,
    enemyTimer: 0,
    gameOver: false,
    paused: false,
    thrustSoundTimer: 0,
  };
}

let world = null;

async function init() {
  canvas.width = W; canvas.height = H; canvas.focus();
  world = initWorld();
  const splash = window.__gossamerSplash;
  if (splash && typeof splash.markReady === 'function') {
    splash.markReady();
  }
  requestAnimationFrame(gameLoop);
}

let lastTime = 0;
function gameLoop(ts) {
  const dt = Math.min(ts - lastTime, 32);
  lastTime = ts;
  if (!world.gameOver && !world.paused) update(dt / 16);
  else if (world.paused) updatePauseMenu();
  draw();
  for (const k in keyJustPressed) delete keyJustPressed[k];
  requestAnimationFrame(gameLoop);
}

// World coord -> screen coord
function toScreen(worldX) { return worldX - world.cameraX; }

function findNearestEnemy(wx, wy, maxDist, filter) {
  let best = null, bd = maxDist || 9999;
  for (const e of world.enemies) {
    if (filter && !filter(e)) continue;
    const d = Math.hypot(e.worldX - wx, e.y - wy);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

function getGroundY(worldX) {
  const t = world.terrain.ground, idx = Math.floor(worldX / 4);
  if (idx < 0 || idx >= t.length - 1) return GROUND_BASE;
  const t0 = t[idx], t1 = t[idx + 1];
  return t0.y + (t1.y - t0.y) * ((worldX / 4) - idx);
}

function enterPeriscopeMode(sub) {
  if (!sub.floating) return;
  sub.periscopeMode = true;
  sub.periscopeDepth = Math.max(0, sub.periscopeDepth);
  sub.floating = false;
  sub.liftingOff = false;
  sub.vx *= 0.5;
  sub.vy = 0;
  sub.angle = 0;
}

function exitPeriscopeMode(sub) {
  sub.periscopeMode = false;
  sub.periscopeDepth = 0;
  sub.floating = true;
  sub.liftingOff = false;
  sub.vx = 0;
  sub.vy = 0;
  sub.angle = 0;
  sub.y = WATER_LINE - 7;
}

function updatePeriscopeDepth(sub, dt, manualSink, manualRise) {
  if (sub.periscopeMode) {
    if (manualSink && !manualRise) {
      sub.periscopeDepth = Math.min(PERISCOPE_MAX_DEPTH, sub.periscopeDepth + PERISCOPE_MANUAL_SINK_RATE * dt);
    } else if (manualRise && !manualSink) {
      sub.periscopeDepth = Math.max(0, sub.periscopeDepth - PERISCOPE_MANUAL_RISE_RATE * dt);
    } else {
      if (sub.periscopeDepth > PERISCOPE_DIP_DEPTH) {
        sub.periscopeDepth = Math.max(PERISCOPE_DIP_DEPTH, sub.periscopeDepth - PERISCOPE_RISE_RATE * dt);
      } else {
        sub.periscopeDepth = Math.min(PERISCOPE_DIP_DEPTH, sub.periscopeDepth + PERISCOPE_SINK_RATE * dt);
      }
    }
    sub.y = WATER_LINE - 7 + sub.periscopeDepth;
    sub.vx *= 0.85;
    sub.vy = 0;
    sub.angle *= 0.7;
    sub.liftingOff = false;
  } else if (sub.periscopeDepth > 0) {
    sub.periscopeDepth = Math.max(0, sub.periscopeDepth - PERISCOPE_RISE_RATE * dt);
    sub.y = WATER_LINE - 7 + sub.periscopeDepth;
    if (sub.periscopeDepth === 0) sub.floating = true;
  }
}

function drawPeriscopeRod(sub) {
  const x = toScreen(sub.worldX);
  const top = WATER_LINE - PERISCOPE_VISIBLE_TOP;
  ctx.save();
  ctx.strokeStyle = '#ecf0f1';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x, WATER_LINE + 2);
  ctx.lineTo(x, top);
  ctx.stroke();
  ctx.fillStyle = '#95a5a6';
  ctx.fillRect(x - 3, top - 8, 6, 8);
  ctx.beginPath();
  ctx.arc(x, top - 12, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function updatePauseMenu() {
  if (!world) return;
  if (keyJustPressed['[']) cycleSubSkin(world.settings, -1);
  if (keyJustPressed[']']) cycleSubSkin(world.settings, 1);
  if (keyJustPressed[',']) adjustCustomHue(world.settings, -12);
  if (keyJustPressed['.']) adjustCustomHue(world.settings, 12);
  if (keyJustPressed['l'] || keyJustPressed['L']) {
    world.settings.showLegend = !world.settings.showLegend;
    saveSettings(world.settings);
  }
}

function embarkSub(sub) {
  sub.disembarked = false;
  sub.disembarkIsland = null;
  sub.diverMode = false;
  sub.pilotVx = 0;
  sub.pilotVy = 0;
  sub.pilotOnGround = false;
  SFX.embark();
}

function deployDiver(sub) {
  sub.disembarked = true;
  sub.disembarkIsland = null;
  sub.diverMode = true;
  sub.pilotX = sub.worldX;
  sub.pilotY = clamp(sub.y + 24, WATER_LINE + 18, getGroundY(sub.worldX) - 16);
  sub.pilotVx = 0;
  sub.pilotVy = 0;
  sub.pilotOnGround = false;
  SFX.disembark();
}

function deployDockPilot(sub, dock) {
  sub.disembarked = true;
  sub.disembarkIsland = dock;
  sub.diverMode = false;
  const side = (sub.worldX < dock.x) ? -1 : 1;
  sub.pilotX = dock.x + side * (dock.topW / 2 - 8);
  sub.pilotY = WATER_LINE - dock.h - 4;
  sub.pilotVx = 0;
  sub.pilotVy = 0;
  sub.pilotOnGround = true;
  SFX.disembark();
}

function attemptEject(sub) {
  const wantsTab = !!keyJustPressed['Tab'];
  const wantsE = !!keyJustPressed['e'] || !!keyJustPressed['E'];
  const wantsDeep = !!keyJustPressed['m'] || !!keyJustPressed['M'];
  const wantsEject = wantsTab || wantsE || wantsDeep;
  if (wantsDeep) keyJustPressed['m'] = keyJustPressed['M'] = false;
  if (!wantsEject) return;

  if (sub.disembarked) {
    embarkSub(sub);
    return;
  }

  if (!isSubStationaryForDiver(sub)) {
    world.caveMessage = { text: 'STABILISE THE SUB TO DEPLOY THE DIVER', timer: 100 };
    return;
  }

  const dock = nearbyIslandForDocking(sub.worldX, sub.y);
  if (dock && sub.floating) {
    deployDockPilot(sub, dock);
    return;
  }

  if (sub.y > WATER_LINE + 8 || wantsDeep) {
    deployDiver(sub);
    return;
  }

  world.caveMessage = { text: 'DIVER DEPLOYMENT REQUIRES WATER COVER', timer: 100 };
}

function updateDiverMode(sub, dt) {
  const moveX = (keys['ArrowRight'] || keys['l'] || keys['L'] ? 1 : 0) - (keys['ArrowLeft'] || keys['j'] || keys['J'] ? 1 : 0);
  const moveY = (keys['ArrowDown'] ? 1 : 0) - (keys['ArrowUp'] ? 1 : 0);
  sub.pilotX += moveX * DIVER_SPEED * dt;
  sub.pilotY += moveY * DIVER_SPEED * dt;

  const dx = sub.pilotX - sub.worldX;
  const dy = sub.pilotY - sub.y;
  const dist = Math.hypot(dx, dy);
  if (dist > DIVER_RANGE) {
    const scale = DIVER_RANGE / dist;
    sub.pilotX = sub.worldX + dx * scale;
    sub.pilotY = sub.y + dy * scale;
  }

  sub.pilotY = clamp(sub.pilotY, WATER_LINE + 14, getGroundY(sub.pilotX) - 10);
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

  if (keys['ArrowLeft']) space.shipAngle -= ORBITAL_TURN_RATE * dt * 4;
  if (keys['ArrowRight']) space.shipAngle += ORBITAL_TURN_RATE * dt * 4;

  let thrust = 0;
  if (keys['ArrowUp']) thrust += ORBITAL_THRUST;
  if (keys['ArrowDown']) thrust -= ORBITAL_RETRO_THRUST;

  const usingAfterburner = (keys['a'] || keys['A']) && sub.afterburnerCharge > 0;
  if (usingAfterburner) {
    sub.afterburnerActive = true;
    sub.afterburnerCharge = Math.max(0, sub.afterburnerCharge - AFTERBURNER_DRAIN * dt);
    thrust += ORBITAL_AFTERBURNER_THRUST;
  } else {
    sub.afterburnerActive = false;
    sub.afterburnerCharge = Math.min(AFTERBURNER_MAX_CHARGE, sub.afterburnerCharge + AFTERBURNER_RECHARGE * dt);
  }

  if (thrust !== 0) {
    space.shipVx += Math.cos(space.shipAngle) * thrust * dt * 4;
    space.shipVy += Math.sin(space.shipAngle) * thrust * dt * 4;
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
  space.cameraX += (space.shipX - space.cameraX) * SPACE_CAMERA_SMOOTH * dt * 4;
  space.cameraY += (space.shipY - space.cameraY) * SPACE_CAMERA_SMOOTH * dt * 4;

  const nearest = nearestSolarBody(space, bodies);
  space.nearestBody = nearest;
  if (nearest && nearest.distance < nearest.body.radius + ORBITAL_COLLISION_RADIUS) {
    const dx = space.shipX - nearest.body.x;
    const dy = space.shipY - nearest.body.y;
    const dist = Math.max(1, Math.hypot(dx, dy));
    const nx = dx / dist;
    const ny = dy / dist;
    const edge = nearest.body.radius + ORBITAL_COLLISION_RADIUS + 2;
    space.shipX = nearest.body.x + nx * edge;
    space.shipY = nearest.body.y + ny * edge;
    const dot = space.shipVx * nx + space.shipVy * ny;
    if (dot < 0) {
      space.shipVx -= dot * 1.8 * nx;
      space.shipVy -= dot * 1.8 * ny;
    }
    world.caveMessage = { text: `ORBIT SKIM: ${nearest.body.label.toUpperCase()}`, timer: 90 };
  }

  sub.worldX = space.shipX;
  sub.y = space.shipY;
  sub.vx = space.shipVx;
  sub.vy = space.shipVy;
  sub.angle = space.shipAngle;
  sub.facing = Math.cos(space.shipAngle) >= 0 ? 1 : -1;
  updateTelemetry(dt, space.shipVx, space.shipVy, 'orbit');
}

// ============================================================
// UPDATE
// ============================================================
function update(dt) {
  const sub = world.sub;
  world.tick++;
  handleSunBurn(dt);
  const directWarpKey = ['1', '2', '3', '4', '5'].find((k) => keyJustPressed[k]);
  if (directWarpKey && world.mode === 'orbit' && !world.paused) {
    const dest = PLANET_HOTKEY_MAP[directWarpKey];
    startPlanetWarp(dest);
  }
  if ((keyJustPressed['f'] || keyJustPressed['F']) && !world.paused) {
    world.menuOpen = !world.menuOpen;
  }
  if (world.menuOpen && (keyJustPressed['Enter'] || keyJustPressed['Return'])) {
    startPlanetWarp();
  }

  if (world.mode === 'orbit') {
    updateOrbitMode(dt);
    return;
  }

  // --- Camera: smooth follow sub (X and Y) ---
  const targetCamX = sub.worldX - W * 0.4;
  world.cameraX += (targetCamX - world.cameraX) * CAMERA_SMOOTH * dt * 4;
  world.cameraX = Math.max(0, Math.min(TERRAIN_LENGTH - W, world.cameraX));

  // Vertical camera: follow sub, keeping it roughly in the middle
  const targetCamY = sub.y - H * 0.45;
  world.cameraY += (targetCamY - world.cameraY) * CAMERA_SMOOTH * dt * 4;
  world.cameraY = Math.max(0, world.cameraY); // Don't go above sky

  // --- Disembarked ---
  if (sub.disembarked) {
    if (keyJustPressed['Tab'] || keyJustPressed['e'] || keyJustPressed['E']) {
      embarkSub(sub);
    }
    if (sub.diverMode) {
      updateDiverMode(sub, dt);
    } else if (sub.disembarkIsland) {
      const dock = sub.disembarkIsland;
      const leftLimit = dock.x - dock.baseW / 2 + 4;
      const rightLimit = dock.x + dock.baseW / 2 - 4;
      const moveInput = (keys['k'] || keys['K'] || keys['ArrowRight']) ? 1
        : (keys['j'] || keys['J'] || keys['ArrowLeft']) ? -1 : 0;
      if (moveInput !== 0) {
        sub.pilotVx = moveInput * PILOT_RUN_SPEED;
      } else {
        sub.pilotVx *= PILOT_FRICTION;
      }
      sub.pilotX = Math.max(leftLimit, Math.min(rightLimit, sub.pilotX + sub.pilotVx * dt));
      const groundY = WATER_LINE - dock.h - 4;
      if ((keyJustPressed[' '] || keyJustPressed['ArrowUp']) && sub.pilotOnGround) {
        sub.pilotVy = -PILOT_JUMP_STRENGTH;
        sub.pilotOnGround = false;
      }
      if (!sub.pilotOnGround) {
        sub.pilotVy += PILOT_GRAVITY * dt;
        sub.pilotY += sub.pilotVy * dt;
        if (sub.pilotY >= groundY) {
          sub.pilotY = groundY;
          sub.pilotVy = 0;
          sub.pilotOnGround = true;
        }
      } else {
        sub.pilotY = groundY;
      }
    }
    updateEnemies(dt);
    updateProjectiles(dt);
    updateEffects(dt);
    updateTelemetry(dt, sub.vx, sub.vy, 'atmosphere');
    return;
  }

  if (world.chaffCooldown > 0) world.chaffCooldown = Math.max(0, world.chaffCooldown - dt);
  const periscopeToggle = keyJustPressed['p'] || keyJustPressed['P'];
  if (!sub.disembarked && periscopeToggle) {
    if (sub.periscopeMode) exitPeriscopeMode(sub);
    else enterPeriscopeMode(sub);
  }
  const periscopeSinkInput = sub.periscopeMode && keys['ArrowDown'];
  const periscopeRiseInput = sub.periscopeMode && keys['ArrowUp'];
  updatePeriscopeDepth(sub, dt, periscopeSinkInput, periscopeRiseInput);
  const dropChaff = (keyJustPressed['c'] || keyJustPressed['C']) && !sub.disembarked;
  if (dropChaff && world.chaffCooldown <= 0) {
    world.chaffs.push({ x: sub.worldX, y: sub.y - 6, age: 0 });
    world.chaffCooldown = CHAFF_COOLDOWN;
    SFX.waterBob();
  }

  // --- Facing & movement ---
  if (!sub.periscopeMode) {
    const spdMult = getSpeedMult(sub.parts);
    const thrMult = getThrustMult(sub.parts);
    const turnMult = getTurnMult(sub.parts);
    const diveInput = keys['ArrowDown'];
    const afterburnerHeld = (keys['a'] || keys['A']) && sub.afterburnerCharge > 0 && sub.y < WATER_LINE - 6;

    if (keys['ArrowUp']) {
      sub.vy -= THRUST * thrMult * dt;
      sub.angle = Math.max(sub.angle - 0.03 * turnMult * dt, -0.5);
      // Takeoff from water requires some forward speed
      sub.diving = false;
      if (sub.floating) {
        const fwdSpeed = Math.abs(sub.vx);
        if (fwdSpeed > 1.5) {
          // Enough speed — lift off! Convert forward momentum to lift
          sub.floating = false;
          sub.liftingOff = true;
          sub.vy = -fwdSpeed * 0.6;
        } else {
          // Holding up with low speed: build upward push gradually
          sub.vy -= 0.05 * dt;
          if (sub.vy < -1) { sub.floating = false; sub.liftingOff = true; }
        }
      } else if (sub.y > WATER_LINE - 15 && sub.wasInWater) {
        // Breaking surface from underwater — need upward angle
        if (sub.angle < -0.15) {
          // Good angle, nose up — allow breakthrough
          sub.liftingOff = true;
        } else {
          // Too flat — surface tension holds, reduced lift
          sub.vy -= THRUST * thrMult * dt * -0.3; // Cancel most of the thrust
          sub.liftingOff = false;
        }
      } else {
        sub.floating = false;
        sub.liftingOff = true;
      }
    } else if (diveInput) {
      sub.vy += THRUST * 0.6 * thrMult * dt;
      sub.vy += DIVE_ACCEL * dt + Math.abs(sub.vx) * FORWARD_DIVE_BOOST * dt;
      sub.vy = Math.min(MAX_DIVE_SPEED, sub.vy);
      sub.angle = Math.min(sub.angle + 0.03 * turnMult * dt, 0.5);
      sub.floating = false;
      sub.liftingOff = false;
      sub.diving = true;
    } else {
      sub.angle *= 0.95;
      sub.liftingOff = false;
      sub.diving = false;
    }

    if (keys['ArrowRight']) {
      sub.facing = 1;
      sub.vx = Math.min(sub.vx + 0.15 * spdMult * dt, MAX_SPEED * spdMult);
    } else if (keys['ArrowLeft']) {
      sub.facing = -1;
      sub.vx = Math.max(sub.vx - 0.15 * spdMult * dt, -MAX_SPEED * spdMult);
    } else {
      sub.vx *= 0.98;
    }

    // Thrust sound
    if (keys['ArrowUp'] || keys['ArrowRight'] || keys['ArrowLeft']) {
      world.thrustSoundTimer += dt;
      if (world.thrustSoundTimer > 8) { SFX.thrustPulse(); world.thrustSoundTimer = 0; }
    }

    if (afterburnerHeld) {
      sub.afterburnerActive = true;
      sub.afterburnerCharge = Math.max(0, sub.afterburnerCharge - AFTERBURNER_DRAIN * dt);
      const burnerLimit = MAX_SPEED * AFTERBURNER_SPEED_MULT * spdMult;
      sub.vx = clamp(sub.vx + sub.facing * AFTERBURNER_ACCEL * spdMult * dt, -burnerLimit, burnerLimit);
      if (keys['ArrowUp']) sub.vy -= AFTERBURNER_LIFT * dt;
      if (world.tick % 3 === 0) addParticles(sub.worldX - sub.facing * 18, sub.y, 2, AFTERBURNER_COLOR);
    } else {
      sub.afterburnerActive = false;
      sub.afterburnerCharge = Math.min(AFTERBURNER_MAX_CHARGE, sub.afterburnerCharge + AFTERBURNER_RECHARGE * dt);
    }

    // Gravity
    if (!sub.floating) sub.vy += GRAVITY * dt;
    sub.vy = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, sub.vy));

    sub.worldX += sub.vx * dt;
    sub.y += sub.vy * dt;
  } else {
    const moveDirection = (keys['ArrowRight'] ? 1 : 0) - (keys['ArrowLeft'] ? 1 : 0);
    if (moveDirection !== 0) {
      sub.vx += moveDirection * PERISCOPE_MOVE_ACCEL * dt;
      sub.vx = Math.max(-PERISCOPE_MAX_SPEED, Math.min(PERISCOPE_MAX_SPEED, sub.vx));
      sub.facing = moveDirection > 0 ? 1 : -1;
    } else {
      sub.vx *= PERISCOPE_DRAG;
    }
    sub.worldX += sub.vx * dt;
    sub.worldX = Math.max(30, Math.min(TERRAIN_LENGTH - 30, sub.worldX));
    sub.vy = 0;
    sub.angle *= 0.8;
    sub.floating = false;
    sub.liftingOff = false;
    sub.y = WATER_LINE - 7 + sub.periscopeDepth;
    sub.afterburnerActive = false;
    sub.afterburnerCharge = Math.min(AFTERBURNER_MAX_CHARGE, sub.afterburnerCharge + AFTERBURNER_RECHARGE * dt);
  }

  // World bounds
  sub.worldX = Math.max(30, Math.min(TERRAIN_LENGTH - 30, sub.worldX));

  // --- Water physics ---
  const inWater = sub.y + 9 > WATER_LINE;
  if (!sub.periscopeMode) {
    if (inWater && !sub.wasInWater) {
      const spd = Math.abs(sub.vy);
      const fwdSpd = Math.abs(sub.vx);
      const entryAngle = Math.abs(sub.angle); // How nose-down the sub is
      SFX.waterSplash();
      addParticles(sub.worldX, WATER_LINE, Math.min(15, Math.floor(spd * 3)), '#85c1e9');

      if (spd < 1.5) {
        // Gentle landing — float
        sub.floating = true; sub.vy = 0; sub.y = WATER_LINE - 7;
      } else if (entryAngle > 0.3 && sub.angle > 0) {
        // Nose-down dive entry — clean, minimal damage
        sub.floating = false;
      } else if (entryAngle < 0.1 && fwdSpd > 2 && spd < 2) {
        // Shallow angle + forward speed = skip/skim (like a stone)
        sub.vy = -spd * 0.6; // Bounce back up
        sub.floating = false;
        sub.liftingOff = true;
        addParticles(sub.worldX, WATER_LINE, 10, '#85c1e9');
      } else {
        // Bad angle entry (belly flop, sideways, etc.) — DAMAGE
        const impactForce = spd * (1 - entryAngle); // Worse when flat
        const dmg = Math.max(3, impactForce * 5);
        damageRandomPart(sub.parts, dmg);
        SFX.islandCrash();
        addExplosion(sub.worldX, WATER_LINE, 'small');
        addParticles(sub.worldX, WATER_LINE, 12, '#85c1e9');
        sub.floating = false;
        // Hard impact slows you down
        sub.vx *= 0.7;
        sub.vy *= 0.5;
      }
    }
    sub.wasInWater = inWater;

    const wantsDive = keys['ArrowDown'] && !sub.periscopeMode;
    if (inWater && !sub.liftingOff) {
      if (sub.floating) {
        sub.y = WATER_LINE - 7 + Math.sin(world.tick * 0.06) * 1.5;
        sub.vy = 0; sub.vx *= 0.99;
        const dock = nearbyIslandForDocking(sub.worldX, sub.y);
      if (dock && (keyJustPressed['e'] || keyJustPressed['E'])) {
        sub.disembarked = true; sub.disembarkIsland = dock;
        const side = (sub.worldX < dock.x) ? -1 : 1;
        sub.pilotX = dock.x + side * (dock.topW / 2 - 8);
        const groundY = WATER_LINE - dock.h - 4;
        sub.pilotY = groundY;
        sub.pilotVx = 0;
        sub.pilotVy = 0;
        sub.pilotOnGround = true;
        SFX.disembark();
      }
        if (wantsDive) {
          sub.floating = false;
          sub.vy = 1.2;
          sub.y = WATER_LINE - 7 + 2;
        }
      } else {
      const depth = sub.y - (WATER_LINE - 7);
      if (depth > 0) {
        const buoyFactor = sub.diving ? 0.3 : 1;
        sub.vy -= BUOYANCY * buoyFactor * dt * (1 + depth * 0.02);
      }
        sub.vx *= WATER_DRAG; sub.vy *= SURFACE_DAMPING;
        if (!wantsDive && sub.y <= WATER_LINE - 5 && Math.abs(sub.vy) < 0.5) {
          sub.floating = true; sub.y = WATER_LINE - 7; sub.vy = 0; SFX.waterBob();
        }
      }
    } else {
      sub.floating = false;
    }
  } else {
    sub.wasInWater = true;
    sub.floating = false;
    sub.liftingOff = false;
    sub.vx *= 0.97;
  }

  attemptEject(sub);

  const currentSpeedMph = velocityToMph(sub.vx, sub.vy, 'atmosphere');
  const sharpAscent = currentSpeedMph >= ORBIT_TRIGGER_SPEED_MPH
    && keys['ArrowUp']
    && sub.angle <= SHARP_ASCENT_ANGLE
    && sub.vy <= SHARP_ASCENT_VY
    && !sub.floating
    && !sub.periscopeMode;
  if (sharpAscent) {
    sub.vy -= STARLIFT_ACCEL * dt;
    if (sub.y <= SPACE_ENTRY_ALTITUDE) {
      enterOrbitMode(currentSpeedMph);
      updateTelemetry(dt, world.space.shipVx, world.space.shipVy, 'orbit');
      return;
    }
  } else if (sub.y < ATMOSPHERE_CEILING) {
    sub.y = ATMOSPHERE_CEILING;
    sub.vy = Math.max(0, sub.vy);
  }

  // Ground collision
  const gy = getGroundY(sub.worldX);
  if (sub.y > gy - 12) {
    sub.y = gy - 12; sub.vy = 0; sub.floating = false;
    if (Math.abs(sub.vx) > 1 || world.tick > 10) {
      damageRandomPart(sub.parts, 2 * dt); SFX.damage();
      addExplosion(sub.worldX, sub.y + 10, 'small');
    }
  }

  // Island collision
  const hit = islandHitTest(sub.worldX, sub.y);
  if (hit) {
    const spd = Math.hypot(sub.vx, sub.vy);
    damageRandomPart(sub.parts, Math.max(8, spd * 8) * dt);
    const dx = sub.worldX - hit.island.x;
    if (Math.abs(dx) < 5) {
      sub.y = WATER_LINE - hit.island.h - 14;
      sub.vy = Math.min(sub.vy, -Math.abs(sub.vy) * 0.4);
    } else {
      sub.vx = (dx > 0 ? 1 : -1) * Math.max(2, Math.abs(sub.vx) * 0.5);
      sub.vy *= -0.3;
    }
    sub.floating = false; SFX.islandCrash();
    addExplosion(sub.worldX, sub.y + 10, 'big');
    addParticles(sub.worldX, sub.y + 10, 12, '#5d4037');
  }

  // --- Firing ---
  world.fireCooldown = Math.max(0, world.fireCooldown - dt);
  world.missileCooldown = Math.max(0, world.missileCooldown - dt);

  if (keys[' '] && world.fireCooldown <= 0 && canFireTorpedo(sub.parts) && sub.torpedoAmmo > 0) {
    sub.torpedoAmmo--;
    const isRogue = Math.random() < 0.1;
    world.torpedoes.push({
      worldX: sub.worldX + sub.facing * 15, y: sub.y + 5,
      vx: sub.vx * 0.5 + sub.facing * 1, vy: 1.5,
      phase: 'drop', life: 300, trail: [], rogue: isRogue,
      fromSub: true, active: true,
    });
    world.fireCooldown = FIRE_COOLDOWN; SFX.torpedoLaunch();
  }

  const surfaceLaunch = sub.floating && !sub.periscopeMode;
  if (keys['Shift'] && world.missileCooldown <= 0 && sub.missileAmmo > 0 && surfaceLaunch) {
    sub.missileAmmo--;
    world.missiles.push({
      worldX: sub.worldX + sub.facing * 10, y: sub.y - 5,
      vx: 0, vy: -2.2,
      phase: 'drop', dropTimer: 12, life: 250, trail: [],
      surfaceLaunch: true,
    });
    world.missileCooldown = FIRE_COOLDOWN * 1.5; SFX.missileLaunch();
  }

  if (keyJustPressed['Control'] && world.depthChargeCooldown <= 0 && sub.depthChargeAmmo > 0) {
    sub.depthChargeAmmo--;
    world.depthCharges.push({
      worldX: sub.worldX - sub.facing * 4,
      y: sub.y + 10,
      vx: sub.vx * 0.35,
      vy: Math.max(sub.vy, 0) + 1.2,
      life: DEPTH_CHARGE_LIFE,
      trail: [],
    });
    world.depthChargeCooldown = DEPTH_CHARGE_COOLDOWN;
    addParticles(sub.worldX, sub.y + 10, 6, DEPTH_CHARGE_COLOR);
  }

  // --- Update torpedoes (world coords) ---
  world.torpedoes = world.torpedoes.filter(t => {
    t.life -= dt;
    if (world.tick % 2 === 0) { t.trail.push({ wx: t.worldX, y: t.y, age: 0 }); if (t.trail.length > 15) t.trail.shift(); }
    t.trail.forEach(p => p.age += dt);

    if (t.phase === 'drop') {
      t.vy += GRAVITY * 0.6 * dt; t.worldX += t.vx * dt; t.y += t.vy * dt;
      if (t.y >= WATER_LINE) {
        t.y = WATER_LINE + 3; t.vy = 0; t.vx = (t.vx > 0 ? 1 : -1) * TORPEDO_SPEED;
        t.phase = 'skim'; SFX.torpedoSplash(); addParticles(t.worldX, WATER_LINE, 5, '#85c1e9');
      }
    } else if (t.phase === 'skim') {
      t.worldX += t.vx * dt;
      if (t.rogue) {
        // Rogue: helplessly skimming the surface, occasionally popping out
        // of the water like a flying fish. Not seeking — just hopeful.
        t.y = WATER_LINE - 2 + Math.sin(world.tick * 0.2 + t.worldX * 0.08) * 8;
        // It might dip back under or leap above — it's a torpedo trying its best
        if (world.tick % 6 === 0) addParticles(t.worldX, WATER_LINE, 1, '#85c1e9');
      } else {
        // Normal: skim just below surface, seek surface/underwater targets
        t.y = WATER_LINE + 3 + Math.sin(world.tick * 0.15 + t.worldX * 0.05) * 2;
        const target = findNearestEnemy(t.worldX, t.y, 400, e => e.y > WATER_LINE - 60);
        if (target) { t.phase = 'seek'; t.target = target; }
      }
    } else if (t.phase === 'seek') {
      const tgt = t.target;
      if (tgt && tgt.health > 0) {
        const dx = tgt.worldX - t.worldX, dy = tgt.y - t.y, a = Math.atan2(dy, dx);
        t.vx += Math.cos(a) * 0.3 * dt; t.vy += Math.sin(a) * 0.2 * dt;
        const spd = Math.hypot(t.vx, t.vy);
        if (spd > TORPEDO_SPEED * 1.2) { t.vx *= TORPEDO_SPEED*1.2/spd; t.vy *= TORPEDO_SPEED*1.2/spd; }
      } else { t.phase = 'skim'; t.vy = 0; }
      t.worldX += t.vx * dt; t.y += t.vy * dt;
      // Normal torpedoes stay near/below water
      if (t.y < WATER_LINE - 8) t.y = WATER_LINE - 8;
    }
    // Ground or island hit
    const tgy = getGroundY(t.worldX);
    if (t.y > tgy) { addExplosion(t.worldX, tgy, 'small'); SFX.explodeSmall(); return false; }
    const tIsland = islandHitTest(t.worldX, t.y);
    if (tIsland) { addExplosion(t.worldX, t.y, 'small'); SFX.explodeSmall(); addParticles(t.worldX, t.y, 6, '#5d4037'); return false; }
    return t.life > 0 && Math.abs(t.worldX - sub.worldX) < W * 2;
  });

  // --- Update missiles (world coords) ---
  world.missiles = world.missiles.filter(m => {
    m.life -= dt;
    if (world.tick%2===0) { m.trail.push({ wx: m.worldX, y: m.y, age: 0 }); if (m.trail.length > 20) m.trail.shift(); }
    m.trail.forEach(p => p.age += dt);

    for (const chaff of world.chaffs) {
      if (Math.hypot(m.worldX - chaff.x, m.y - chaff.y) < CHAFF_RADIUS && !m.distracted) {
        m.vx += (Math.random() - 0.5) * CHAFF_DEFLECT_FORCE;
        m.vy += (Math.random() - 0.3) * CHAFF_DEFLECT_FORCE;
        m.distracted = true;
        m.target = null;
        addParticles(m.worldX, m.y, 4, CHAFF_COLOR);
        break;
      }
    }

    if (m.phase === 'drop') {
      m.vy += GRAVITY*0.5*dt; m.worldX += m.vx*dt; m.y += m.vy*dt;
      m.dropTimer -= dt;
      if (m.dropTimer <= 0) {
        m.phase = 'ignite'; m.vy = -MISSILE_SPEED*0.5;
        m.vx = (m.vx >= 0 ? 1 : -1) * 2;
        SFX.missileIgnite();
      }
      if (m.surfaceLaunch && m.y < 60) {
        addExplosion(m.worldX, m.y, 'small');
        SFX.explodeSmall();
        return false;
      }
    } else if (m.phase === 'ignite') {
      const tgt = findNearestEnemy(m.worldX, m.y, 500);
      if (tgt && tgt.health > 0) {
        const dx = tgt.worldX - m.worldX, dy = tgt.y - m.y, a = Math.atan2(dy, dx);
        m.vx += Math.cos(a)*0.4*dt; m.vy += Math.sin(a)*0.4*dt;
      } else { m.vy -= 0.15*dt; m.vx += (m.vx >= 0 ? 0.1 : -0.1)*dt; }
      const spd = Math.hypot(m.vx, m.vy);
      if (spd > MISSILE_SPEED*1.3) { m.vx *= MISSILE_SPEED*1.3/spd; m.vy *= MISSILE_SPEED*1.3/spd; }
      m.worldX += m.vx*dt; m.y += m.vy*dt;
    }
    if (!m.surfaceLaunch && m.y > WATER_LINE - 6) { addExplosion(m.worldX, WATER_LINE, 'small'); SFX.explodeSmall(); return false; }
    const mgy = getGroundY(m.worldX);
    if (m.y > mgy || m.y < 5) { addExplosion(m.worldX, m.y<5?10:mgy, 'small'); SFX.explodeSmall(); return false; }
    const mIsland = islandHitTest(m.worldX, m.y);
    if (mIsland) { addExplosion(m.worldX, m.y, 'small'); SFX.explodeSmall(); addParticles(m.worldX, m.y, 6, '#5d4037'); return false; }
    return m.life > 0 && Math.abs(m.worldX - sub.worldX) < W * 2;
  });

  updateEnemies(dt);
  updateProjectiles(dt);

  // --- RADAR TOWERS ---
  for (const r of world.terrain.radars) {
    if (r.destroyed) continue;
    const dist = Math.hypot(r.x - sub.worldX, r.y - sub.y);
    r.cooldown = Math.max(0, r.cooldown - dt);

    // Rotation speed depends on tier
    const rotSpeed = r.tier === 1 ? 0.015 : r.tier === 2 ? 0.06 : 0.04;
    r.angle += rotSpeed * dt;

    if (sub.periscopeMode) continue;

    if (dist > r.alertRadius) continue; // Out of range

    if (r.tier === 1 && r.cooldown <= 0) {
      // Basic radar: alerts nearby ships to target the sub (makes them shoot)
      for (const e of world.enemies) {
        if (e.type === 'ship' && Math.abs(e.worldX - r.x) < 400) {
          // Ship fires a bullet toward sub
          world.missiles.push({
            worldX: e.worldX, y: e.y - 5,
            vx: (sub.worldX - e.worldX) > 0 ? 3 : -3, vy: -1.5,
            phase: 'ignite', dropTimer: 0, life: 120, trail: [],
            fromEnemy: true,
          });
        }
      }
      r.cooldown = 100; // Slow alert cycle
      SFX.explodeSmall();
    }

    if (r.tier === 2 && r.cooldown <= 0) {
      // Machine gun radar: fires burst of fast bullets toward sub
      const angle = Math.atan2(sub.y - r.y, sub.worldX - r.x);
      for (let b = 0; b < 3; b++) {
        const spread = (Math.random() - 0.5) * 0.3;
        world.missiles.push({
          worldX: r.x, y: r.y - 15,
          vx: Math.cos(angle + spread) * 5,
          vy: Math.sin(angle + spread) * 5,
          phase: 'ignite', dropTimer: 0, life: 80, trail: [],
          fromEnemy: true, bullet: true, // Small, fast
        });
      }
      r.cooldown = 25; // Fast fire rate
      SFX.torpedoLaunch();
    }

    if (r.tier === 3 && r.cooldown <= 0) {
      // SAM radar: fires surface-to-air missile that homes on sub
      const angle = Math.atan2(sub.y - r.y, sub.worldX - r.x);
      world.missiles.push({
        worldX: r.x, y: r.y - 20,
        vx: Math.cos(angle) * 2, vy: -3,
        phase: 'ignite', dropTimer: 0, life: 200, trail: [],
        fromEnemy: true, sam: true, // Homing SAM
      });
      r.cooldown = 80;
      SFX.missileLaunch();
    }
  }

  // --- Update enemy projectiles (missiles with fromEnemy flag) ---
  world.missiles = world.missiles.filter(m => {
    if (!m.fromEnemy) return true; // Player missiles handled elsewhere
    m.life -= dt;
    if (world.tick%2===0) { m.trail.push({ wx: m.worldX, y: m.y, age: 0 }); if (m.trail.length > 15) m.trail.shift(); }
    m.trail.forEach(p => p.age += dt);

    if (m.sam) {
      // SAM homes toward sub
      const dx = sub.worldX - m.worldX, dy = sub.y - m.y;
      const a = Math.atan2(dy, dx);
      m.vx += Math.cos(a) * 0.35 * dt;
      m.vy += Math.sin(a) * 0.35 * dt;
      const spd = Math.hypot(m.vx, m.vy);
      if (spd > 5) { m.vx *= 5/spd; m.vy *= 5/spd; }
    }
    m.worldX += m.vx * dt; m.y += m.vy * dt;

    // Hit sub?
    if (!sub.periscopeMode && Math.abs(m.worldX - sub.worldX) < 18 && Math.abs(m.y - sub.y) < 12) {
      const dmg = m.bullet ? 5 : m.sam ? 20 : 10;
      damageRandomPart(sub.parts, dmg);
      addExplosion(sub.worldX, sub.y, m.bullet ? 'small' : 'big');
      SFX.damage();
      return false;
    }
    // Hit ground/island?
    if (m.y > getGroundY(m.worldX) || islandHitTest(m.worldX, m.y)) {
      addExplosion(m.worldX, m.y, 'small'); return false;
    }
    return m.life > 0 && Math.abs(m.worldX - sub.worldX) < W * 2;
  });

  // --- Radar tower damage from player weapons ---
  // Torpedoes can hit radars (the way to kill tier 3)
  world.torpedoes = world.torpedoes.filter(t => {
    for (const r of world.terrain.radars) {
      if (r.destroyed) continue;
      if (Math.abs(t.worldX - r.x) < 15 && Math.abs(t.y - r.y) < 20) {
        const dmg = 25; // Torpedoes do good damage to radars
        r.hp -= dmg;
        if (r.hp <= 0) {
          r.destroyed = true;
          addExplosion(r.x, r.y, 'big');
          addParticles(r.x, r.y, 15, '#888');
          world.score += r.tier * 200;
          SFX.enemyDestroyed();
        } else {
          addExplosion(t.worldX, t.y, 'small');
          SFX.explodeSmall();
        }
        return false;
      }
    }
    return true;
  });
  // Player missiles vs radars — tier 3 can REFLECT missiles back!
  world.missiles = world.missiles.filter(m => {
    if (m.fromEnemy) return true; // Don't self-check enemy missiles
    for (const r of world.terrain.radars) {
      if (r.destroyed) continue;
      if (Math.abs(m.worldX - r.x) < 15 && Math.abs(m.y - r.y) < 20) {
        if (r.tier === 3 && Math.random() < 0.35) {
          // Tier 3 REFLECTS the missile back at you!
          m.vx = -m.vx * 1.2;
          m.vy = -m.vy * 0.8;
          m.fromEnemy = true; // Now it's hostile
          m.sam = true;       // And it homes
          m.life = 150;
          SFX.missileIgnite();
          return true; // Keep it alive — now it's coming for you
        }
        // Normal hit
        const dmg = r.tier <= 2 ? 20 : 5; // Missiles weak against tier 3
        r.hp -= dmg;
        if (r.hp <= 0) {
          r.destroyed = true;
          addExplosion(r.x, r.y, 'big');
          addParticles(r.x, r.y, 15, '#888');
          world.score += r.tier * 200;
          SFX.enemyDestroyed();
        } else {
          addExplosion(m.worldX, m.y, 'small');
          SFX.explodeSmall();
        }
        return false;
      }
    }
    return true;
  });

  // Torpedo-sub self-damage (own torpedo hitting you from behind/below)
  world.torpedoes = world.torpedoes.filter(t => {
    if (!t.fromSub) return true; // Only own torpedoes can self-hit
    if (t.phase === 'drop' && t.life > 280) return true; // Grace period right after launch
    const onSurface = sub.floating && Math.abs(sub.y - (WATER_LINE - 7)) < 6;
    if (onSurface) return true;
    if (Math.abs(t.worldX - sub.worldX) < 20 && Math.abs(t.y - sub.y) < 14) {
      damageRandomPart(sub.parts, 30);
      addExplosion(sub.worldX, sub.y, 'big');
      SFX.islandCrash(); SFX.damage();
      addParticles(sub.worldX, sub.y, 15, '#ff6b00');
      return false;
    }
    return true;
  });

  // Enemy-sub collision
  for (const e of world.enemies) {
    if (Math.abs(e.worldX - sub.worldX) < 25 && Math.abs(e.y - sub.y) < 18) {
      damageRandomPart(sub.parts, 25);
      addExplosion((e.worldX + sub.worldX) / 2, (e.y + sub.y) / 2, 'big');
      SFX.damage(); e.health = 0;
      world.enemies = world.enemies.filter(en => en.health > 0);
      break;
    }
  }

  // Cave entrance check — entering a hole in the sea floor
  for (const cave of world.terrain.caves) {
    if (Math.abs(sub.worldX - cave.x) < cave.w / 2 && Math.abs(sub.y - cave.y) < cave.h / 2) {
      // TODO v2.1: transition to cave level system (separate terrain page)
      // For now: show notification and heal slightly as a reward for finding it
      if (!cave.visited) {
        cave.visited = true;
        world.score += 500;
        // Partial ammo resupply from cave cache
        sub.torpedoAmmo = Math.min(START_TORPEDOES, sub.torpedoAmmo + 6);
        sub.missileAmmo = Math.min(START_MISSILES, sub.missileAmmo + 3);
        SFX.disembark(); // Reuse the pleasant tone
        world.caveMessage = { text: 'CAVE FOUND — Ammo resupplied! (+500)', timer: 120 };
      }
    }
  }

  // Level complete: reached end port while floating
  const ep = world.terrain.endPort;
  if (!world.levelComplete && sub.floating && Math.abs(sub.worldX - ep.x) < ep.w / 2) {
    world.levelComplete = true;
    world.score += 1000;
    SFX.disembark();
    ensureLeaderboardRecorded('MISSION COMPLETE');
  }

  // Game over: hull destroyed
  if (sub.parts.hull <= 0) {
    world.gameOver = true;
    addExplosion(sub.worldX, sub.y, 'big'); SFX.gameOver();
    ensureLeaderboardRecorded('HULL BREACH');
  }

  updateEffects(dt);
  updateAmmoStations(world, dt);
  updateChaffs(world, dt);
  updateMines(world, dt);
  updateDepthCharges(dt);
  updateTelemetry(dt, sub.vx, sub.vy, 'atmosphere');
}

function updateEnemies(dt) {
  const sub = world.sub;
  const hidden = sub.periscopeMode;
  world.enemyTimer += hidden ? dt * 0.2 : dt;
  if (!hidden && world.enemyTimer > 80) {
    world.enemyTimer = 0;
    const side = Math.random() < 0.7 ? sub.facing : -sub.facing;
    const spawnX = sub.worldX + side * (W * 0.6 + Math.random() * 200);
    // Type selection: aircraft (jet, prop, biplane) or ship
    const roll = Math.random();
    let type, ey, vx, vy, health;
    if (roll < 0.65) {
      // Fast jet fighter
      type = 'jet'; ey = 60 + Math.random() * 120;
      vx = side > 0 ? -(3 + Math.random()*1.5) : (3 + Math.random()*1.5);
      vy = (Math.random()-0.5)*0.3; health = 3;
    } else {
      // Helicopter-style threat — slower, hovers in the sky
      type = 'heli'; ey = 70 + Math.random() * 60;
      vx = side > 0 ? -(1.2 + Math.random()*0.6) : (1.2 + Math.random()*0.6);
      vy = (Math.random()-0.5)*0.25; health = 3;
    }
    world.enemies.push({ worldX: spawnX, y: ey, vx, vy, health, type });
  }
  world.enemies = world.enemies.filter(e => {
    e.worldX += e.vx * dt;
    if (e.type === 'ship') {
      // Ships stay on water surface, bob gently
      e.y = WATER_LINE - 8 + Math.sin(world.tick * 0.04 + e.worldX * 0.01) * 2;
      // Ships collide with islands — reverse direction
      const shipIsland = islandHitTest(e.worldX, e.y);
      if (shipIsland) {
        e.vx = -e.vx; // Bounce off
        e.worldX += e.vx * dt * 3; // Push away
      }
    } else {
      // Aircraft — fly in air only, never go below water
      e.y += e.vy * dt;
      e.vy += (Math.random()-0.5)*0.1;
      e.vy = Math.max(-1, Math.min(1, e.vy));
      // Ceiling
      if (e.y < 30) { e.y = 30; e.vy = Math.abs(e.vy); }
      // Aircraft cannot go below water line — pull up
      if (e.y > WATER_LINE - 20) { e.y = WATER_LINE - 20; e.vy = -Math.abs(e.vy) * 0.5; }
      // Aircraft avoid islands — bounce off
      const planeIsland = islandHitTest(e.worldX, e.y);
      if (planeIsland) {
        e.vy = -Math.abs(e.vy) - 0.5; // Push up and away
        e.y -= 5;
      }
    }
    return Math.abs(e.worldX - sub.worldX) < W * 2 && e.health > 0;
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

function updateEffects(dt) {
  world.explosions = world.explosions.filter(e => { e.age += dt; return e.age < e.duration; });
  world.particles = world.particles.filter(p => {
    p.worldX += p.vx*dt; p.y += p.vy*dt; p.vy += 0.08*dt; p.age += dt;
    return p.age < p.life;
  });
}

function addExplosion(wx, y, size) {
  world.explosions.push({ worldX: wx, y, age:0, duration: size==='big'?40:20, radius: size==='big'?30:15 });
}
function addParticles(wx, y, count, color) {
  for (let i = 0; i < count; i++)
    world.particles.push({ worldX: wx, y, vx:(Math.random()-0.5)*4, vy:(Math.random()-0.8)*3, color, age:0, life:15+Math.random()*20, size:1+Math.random()*2.5 });
}

function stripedGradient(x0, y0, x1, y1, colors) {
  const gradient = ctx.createLinearGradient(x0, y0, x1, y1);
  const last = colors.length - 1;
  colors.forEach((color, idx) => {
    const start = idx / colors.length;
    const end = (idx + 1) / colors.length;
    gradient.addColorStop(start, color);
    gradient.addColorStop(Math.min(1, end - 0.001), color);
  });
  if (last >= 0) gradient.addColorStop(1, colors[last]);
  return gradient;
}

function drawCompactLegend() {
  if (!world.settings.showLegend || world.paused) return;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.fillRect(12, H - 56, 430, 40);
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.strokeRect(12, H - 56, 430, 40);
  ctx.fillStyle = 'rgba(255,255,255,0.78)';
  ctx.font = '11px Arial';
  ctx.textAlign = 'left';
  ctx.fillText('Esc: controls  |  Tab: eject/diver  |  A: afterburner  |  Ctrl: depth charge', 22, H - 33);
  ctx.fillText('Space: torpedo  |  Shift: missile  |  P: periscope  |  [, ]: skin in pause', 22, H - 19);
}

function drawLeaderboardPanel(x, y, title) {
  const board = world.leaderboard || [];
  ctx.fillStyle = 'rgba(0,0,0,0.62)';
  ctx.fillRect(x, y, 320, 152);
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.strokeRect(x, y, 320, 152);
  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 18px Arial';
  ctx.textAlign = 'left';
  ctx.fillText(title, x + 14, y + 24);
  ctx.font = '12px Arial';
  if (board.length === 0) {
    ctx.fillStyle = '#cbd5e1';
    ctx.fillText('No runs recorded yet.', x + 14, y + 52);
    return;
  }
  board.forEach((entry, index) => {
    const rowY = y + 48 + index * 20;
    ctx.fillStyle = index === 0 ? '#fcd34d' : '#e2e8f0';
    ctx.fillText(`${index + 1}. ${entry.score} pts`, x + 14, rowY);
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(`${entry.kills} kills`, x + 118, rowY);
    ctx.fillText(entry.status || 'Run', x + 180, rowY);
  });
}

function drawSolarMiniMap() {
  const x = SOLAR_MAP_PADDING;
  const y = SOLAR_MAP_PADDING;
  ctx.fillStyle = 'rgba(3,7,18,0.85)';
  ctx.fillRect(x, y, SOLAR_MAP_SIZE, SOLAR_MAP_SIZE);
  ctx.strokeStyle = 'rgba(248,250,252,0.2)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, SOLAR_MAP_SIZE, SOLAR_MAP_SIZE);

  const centerX = x + SOLAR_MAP_SIZE / 2;
  const centerY = y + SOLAR_MAP_SIZE / 2;
  const bodies = getSolarBodies(world.tick * SOLAR_MAP_ANIMATION_SPEED);
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  for (const body of bodies) {
    if (body.id === 'sun') continue;
    const orbitRadius = Math.max(14, body.orbitRadius * SOLAR_MAP_SCALE);
    ctx.beginPath();
    ctx.arc(centerX, centerY, orbitRadius, 0, TWO_PI);
    ctx.stroke();
  }

  for (const body of bodies) {
    const radius = body.id === 'sun' ? 8 : 4;
    const px = centerX + body.x * SOLAR_MAP_SCALE;
    const py = centerY + body.y * SOLAR_MAP_SCALE;
    ctx.fillStyle = body.id === 'sun' ? '#ffd166' : body.color;
    ctx.beginPath();
    ctx.arc(px, py, radius, 0, TWO_PI);
    ctx.fill();
    if (body.id !== 'sun') {
      ctx.fillStyle = '#cbd5e1';
      ctx.font = '8px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(body.label.slice(0, 2).toUpperCase(), px, py + 12);
    }
  }

  const destination = world.currentDestination || PLANETS[world.currentPlanet];
  if (destination) {
    const body = bodies.find((b) => b.label.toLowerCase() === destination.name.toLowerCase());
    if (body) {
      const px = centerX + body.x * SOLAR_MAP_SCALE;
      const py = centerY + body.y * SOLAR_MAP_SCALE;
      ctx.strokeStyle = destination.star ? '#f97316' : '#34d399';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px, py, destination.star ? 12 : 7, 0, TWO_PI);
      ctx.stroke();
    }
  }

  ctx.fillStyle = '#e2e8f0';
  ctx.font = '10px "Courier New", monospace';
  ctx.textAlign = 'left';
  ctx.fillText(`Warp hotkeys: 1-4 = planets`, x + 8, y + SOLAR_MAP_SIZE - 32);
  ctx.fillText(`5 = Sun (hazard)`, x + 8, y + SOLAR_MAP_SIZE - 20);
  ctx.fillText(`F opens orbit menu`, x + 8, y + SOLAR_MAP_SIZE - 8);
}

function drawFlightInstruments() {
  const telemetry = world.telemetry || {};
  const speed = clamp(telemetry.speedMph || 0, 0, SPEEDOMETER_MAX_MPH);
  const accel = clamp(telemetry.accelG || 0, 0, ACCELEROMETER_MAX_G);

  const panelX = W - 226;
  const panelY = 12;
  const panelW = 214;
  const panelH = 138;
  ctx.fillStyle = 'rgba(1,4,14,0.92)';
  ctx.fillRect(panelX, panelY, panelW, panelH);
  const grad = ctx.createLinearGradient(panelX, panelY, panelX, panelY + panelH);
  grad.addColorStop(0, 'rgba(15,23,42,0.7)');
  grad.addColorStop(1, 'rgba(2,6,18,0.95)');
  ctx.fillStyle = grad;
  ctx.fillRect(panelX, panelY, panelW, panelH);
  ctx.strokeStyle = 'rgba(248,250,252,0.2)';
  ctx.lineWidth = 1;
  ctx.strokeRect(panelX, panelY, panelW, panelH);

  const centerX = panelX + panelW / 2;
  ctx.font = 'bold 38px "Courier New", monospace';
  ctx.fillStyle = '#0ea5e9';
  ctx.textAlign = 'center';
  const speedStr = `${Math.round(speed)}`.padStart(3, '0');
  ctx.fillText(speedStr, centerX, panelY + 70);
  ctx.font = '11px "Courier New", monospace';
  ctx.fillStyle = '#cbd5e1';
  const label = telemetry.mode === 'orbit' ? 'IMPULSE' : 'MPH';
  ctx.fillText(label, centerX, panelY + 90);

  const segmentCount = 10;
  const segmentWidth = (panelW - 32) / segmentCount;
  const limitColor = telemetry.launchReady ? '#f97316' : '#94a3b8';
  for (let i = 0; i < segmentCount; i++) {
    const segX = panelX + 16 + i * segmentWidth;
    const segmentActive = (speed / SPEEDOMETER_MAX_MPH) > i / segmentCount;
    ctx.fillStyle = segmentActive ? '#0ea5e9' : 'rgba(14,165,233,0.15)';
    ctx.fillRect(segX, panelY + 24, segmentWidth - 2, 6);
  }

  const accelPanelX = panelX + panelW - 48;
  const accelPanelY = panelY + 12;
  const accelPanelH = panelH - 28;
  ctx.fillStyle = 'rgba(2,6,18,0.85)';
  ctx.fillRect(accelPanelX, accelPanelY, 36, accelPanelH);
  ctx.strokeStyle = 'rgba(248,250,252,0.18)';
  ctx.strokeRect(accelPanelX, accelPanelY, 36, accelPanelH);
  const accelHeight = Math.max(6, (accel / ACCELEROMETER_MAX_G) * (accelPanelH - 12));
  ctx.fillStyle = accel > 2 ? '#ef4444' : accel > 1 ? '#f59e0b' : '#22c55e';
  ctx.fillRect(accelPanelX + 8, accelPanelY + accelPanelH - 8 - accelHeight, 20, accelHeight);
  ctx.fillStyle = '#e2e8f0';
  ctx.font = 'bold 10px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('G', accelPanelX + 18, accelPanelY + 14);
  ctx.fillText(`${accel.toFixed(2)}G`, accelPanelX + 18, accelPanelY + accelPanelH - 6);

  ctx.font = '11px "Courier New", monospace';
  ctx.textAlign = 'left';
  ctx.fillStyle = limitColor;
  ctx.fillText(telemetry.launchReady ? '88 MPH WINDOW LIVE' : 'Build for 88 MPH', panelX + 12, panelY + panelH - 26);
  ctx.fillStyle = '#f8fafc';
  ctx.fillText('KITT HUD', panelX + 12, panelY + panelH - 42);

  const destination = world.currentDestination || PLANETS[world.currentPlanet];
  if (destination) {
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '10px "Courier New", monospace';
    ctx.fillText(`DEST: ${destination.name}`, panelX + 12, panelY + panelH - 58);
    if (destination.hotkey) {
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(`HOTKEY: ${destination.hotkey}`, panelX + 12, panelY + panelH - 46);
    }
  }

  if (world.sunBurnTimer > 0) {
    ctx.fillStyle = '#f97316';
    ctx.font = 'bold 11px "Courier New", monospace';
    ctx.fillText('SUN BURN — HULL HEATING', panelX + 12, panelY + panelH - 12);
  }
}

function drawPauseOverlay() {
  const skin = resolveSubSkin(world.settings);
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#e2e8f0';
  ctx.textAlign = 'center';
  ctx.font = 'bold 40px Arial';
  ctx.fillText('PAUSED', W / 2, 70);
  ctx.font = '16px Arial';
  ctx.fillText('Esc resumes', W / 2, 98);

  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(8,15,30,0.82)';
  ctx.fillRect(58, 128, 684, 248);
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.strokeRect(58, 128, 684, 248);

  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 18px Arial';
  ctx.fillText('Controls', 84, 160);
  ctx.font = '14px Arial';
  const controls = [
    'Arrows: steer, climb, dive',
    'Space: torpedo',
    'Shift: missile',
    'Ctrl: depth charge',
    'A: afterburner',
    'P: periscope mode',
    'Tab: eject diver / re-enter',
    'Esc: pause and settings',
  ];
  controls.forEach((line, idx) => ctx.fillText(line, 84, 192 + idx * 22));

  ctx.font = 'bold 18px Arial';
  ctx.fillText('Settings', 420, 160);
  ctx.font = '14px Arial';
  ctx.fillText(`Sub skin: ${skin.label}`, 420, 194);
  ctx.fillText('Use [ and ] to cycle skins', 420, 218);
  ctx.fillText(`Custom hue: ${Math.round(world.settings.customHue)}${skin.customHue ? ' degrees' : ' (Spectrum only)'}`, 420, 242);
  ctx.fillText('Use , and . to tune hue while paused', 420, 266);
  ctx.fillText(`Legend always visible: ${world.settings.showLegend ? 'ON' : 'OFF'}`, 420, 290);
  ctx.fillText('Press L to toggle the on-screen legend', 420, 314);
  ctx.fillText(`Leaderboard entries: ${(world.leaderboard || []).length}`, 420, 338);

  drawLeaderboardPanel(240, 392, 'Top Runs');
}

function drawWarpMenu() {
  if (!world.menuOpen) return;
  const palette = getCurrentPlanetPalette();
  const nextPlanet = PLANETS[(world.currentPlanet + 1) % PLANETS.length];
  ctx.fillStyle = 'rgba(4,4,18,0.92)';
  ctx.fillRect(W/2 - 220, H/2 - 140, 440, 220);
  ctx.strokeStyle = palette.accent;
  ctx.lineWidth = 2;
  ctx.strokeRect(W/2 - 220, H/2 - 140, 440, 220);
  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 24px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('Orbit Menu', W/2, H/2 - 90);
  ctx.fillStyle = '#cbd5e1';
  ctx.font = '16px Arial';
  ctx.fillText(`Next planet: ${nextPlanet.name}`, W/2, H/2 - 54);
  ctx.font = '14px Arial';
  ctx.fillText('Press Enter to depart once you have a sustained 88 MPH climb', W/2, H/2 - 24);
  ctx.fillText('Use the arrow keys to build velocity, then aim straight up', W/2, H/2 + 4);
  ctx.fillText('Current planet colors are shown in the HUD and damage map', W/2, H/2 + 32);
  ctx.fillStyle = palette.enemy;
  ctx.fillText(`Palette accent: ${palette.name}`, W/2, H/2 + 70);
}

function drawOrbitScene() {
  const space = world.space;
  const bodies = getSolarBodies(space.time);
  ctx.fillStyle = '#020617';
  ctx.fillRect(0, 0, W, H);

  for (let i = 0; i < 90; i++) {
    const sx = (i * 83 + world.tick * 0.7) % W;
    const sy = (i * 47) % H;
    ctx.globalAlpha = 0.2 + (Math.sin(world.tick * 0.015 + i) + 1) * 0.18;
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(sx, sy, 1.5, 1.5);
  }
  ctx.globalAlpha = 1;

  ctx.save();
  ctx.translate(W / 2 - space.cameraX, H / 2 - space.cameraY);

  ctx.strokeStyle = 'rgba(148,163,184,0.18)';
  ctx.lineWidth = 1;
  for (const body of bodies) {
    if (body.id === 'sun') continue;
    ctx.beginPath();
    ctx.arc(0, 0, body.orbitRadius, 0, TWO_PI);
    ctx.stroke();
  }

  for (const point of space.trail) {
    ctx.globalAlpha = Math.max(0.08, 0.5 - point.age * 0.01);
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.arc(point.x, point.y, 1.8, 0, TWO_PI);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  for (const body of bodies) {
    ctx.save();
    ctx.translate(body.x, body.y);
    if (body.ring) {
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.5)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(0, 0, body.radius + 8, body.radius * 0.55, 0.3, 0, TWO_PI);
      ctx.stroke();
    }
    ctx.fillStyle = body.color;
    ctx.beginPath();
    ctx.arc(0, 0, body.radius, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(body.label, 0, body.radius + 16);
    ctx.restore();
  }

  ctx.save();
  ctx.translate(space.shipX, space.shipY);
  ctx.rotate(space.shipAngle);
  const skin = resolveSubSkin(world.settings);
  ctx.fillStyle = skin.pride ? stripedGradient(-18, 0, 18, 0, ['#e40303', '#ff8c00', '#ffed00', '#008026', '#24408e', '#732982'])
    : skin.rainbow ? stripedGradient(-18, 0, 18, 0, ['#ff595e', '#ffca3a', '#8ac926', '#1982c4', '#6a4c93'])
    : skin.hull;
  ctx.beginPath();
  ctx.ellipse(0, 0, 18, 8, 0, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = skin.tower || '#1f2937';
  ctx.fillRect(-2, -12, 5, 6);
  ctx.fillStyle = '#e5e7eb';
  ctx.beginPath();
  ctx.moveTo(18, 0);
  ctx.lineTo(-12, -7);
  ctx.lineTo(-7, 0);
  ctx.lineTo(-12, 7);
  ctx.closePath();
  ctx.fill();
  if (world.sub.afterburnerActive) {
    ctx.fillStyle = AFTERBURNER_COLOR;
    ctx.beginPath();
    ctx.moveTo(-17, -3);
    ctx.lineTo(-28 - Math.random() * 6, 0);
    ctx.lineTo(-17, 3);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  ctx.restore();

  drawHUD();
  drawDamageDiagram();
  drawFlightInstruments();
  drawCompactLegend();

  if (space.nearestBody) {
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(14, H - 94, 250, 52);
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '14px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(`Nearest body: ${space.nearestBody.body.label}`, 24, H - 66);
    ctx.fillText(`Range: ${Math.round(space.nearestBody.distance)} Mm`, 24, H - 46);
  }

  if (world.caveMessage && world.caveMessage.timer > 0) {
    world.caveMessage.timer--;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(W / 2 - 210, 24, 420, 34);
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(world.caveMessage.text, W / 2, 47);
  }

  if (world.paused) drawPauseOverlay();
}

// ============================================================
// DRAWING — all world coords converted via toScreen()
// ============================================================
function draw() {
  if (world.mode === 'orbit') {
    drawOrbitScene();
    return;
  }

  const cam = world.cameraX;
  const camY = world.cameraY;

  // Clear full canvas
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);

  // Apply vertical camera offset — all world Y positions shift by -camY
  ctx.save();
  ctx.translate(0, -camY);

  const palette = getCurrentPlanetPalette();
  // Sky (extends above water line, very tall to cover high flight)
  const skyTop = -200; // Allow for high flight
  const skyGrad = ctx.createLinearGradient(0, skyTop, 0, WATER_LINE);
  skyGrad.addColorStop(0, palette.sky);
  skyGrad.addColorStop(1, palette.water);
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, skyTop, W, WATER_LINE - skyTop);

  // Stars (parallax — fixed to sky)
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 30; i++) {
    const sx = ((i*137 + cam*0.05) % W);
    const sy = 20 + (i*73) % 250;
    ctx.globalAlpha = 0.3 + Math.sin(world.tick*0.02+i)*0.2;
    ctx.fillRect(sx, sy, 1.5, 1.5);
  }
  ctx.globalAlpha = 1;

  // Clouds (parallax)
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  for (let i = 0; i < 8; i++) {
    const cx = ((i*200+50 - cam*0.15) % (W+200)) - 100;
    ctx.beginPath(); ctx.ellipse(cx, 140+i*28, 40+i*5, 12, 0, 0, Math.PI*2); ctx.fill();
  }

  // Water (extends deep below surface)
  const waterBottom = SEA_FLOOR + 100;
  const wg = ctx.createLinearGradient(0,WATER_LINE,0,waterBottom);
  wg.addColorStop(0, palette.water);
  wg.addColorStop(1, palette.land);
  ctx.fillStyle = wg; ctx.fillRect(0,WATER_LINE,W,waterBottom-WATER_LINE);

  // Waves
  ctx.strokeStyle = 'rgba(100,180,255,0.4)'; ctx.lineWidth = 1.5; ctx.beginPath();
  for (let x = 0; x < W; x += 2) {
    const wy = WATER_LINE + Math.sin((x+cam)*0.03+world.tick*0.05)*3;
    x===0 ? ctx.moveTo(x,wy) : ctx.lineTo(x,wy);
  }
  ctx.stroke();

  // Ground
  ctx.fillStyle = palette.land; ctx.beginPath(); ctx.moveTo(0, H);
  for (let sx = 0; sx <= W; sx += 4) ctx.lineTo(sx, getGroundY(sx + cam));
  ctx.lineTo(W, H); ctx.closePath(); ctx.fill();

  ctx.strokeStyle = '#4a3020'; ctx.lineWidth = 2; ctx.beginPath();
  for (let sx = 0; sx <= W; sx += 4) {
    const gy = getGroundY(sx + cam);
    sx===0 ? ctx.moveTo(sx,gy) : ctx.lineTo(sx,gy);
  }
  ctx.stroke();

  // Grass
  ctx.strokeStyle = '#2ecc71'; ctx.lineWidth = 1;
  for (let sx = 0; sx < W; sx += 12) {
    const gy = getGroundY(sx + cam);
    if (gy < WATER_LINE+10) {
      ctx.beginPath(); ctx.moveTo(sx,gy); ctx.lineTo(sx-2,gy-5);
      ctx.moveTo(sx,gy); ctx.lineTo(sx+2,gy-4); ctx.stroke();
    }
  }

  // --- Islands ---
  const sub = world.sub;
  for (const isl of world.terrain.islands) {
    const sx = toScreen(isl.x);
    if (sx < -isl.baseW-20 || sx > W+isl.baseW+20) continue;
    const top = WATER_LINE - isl.h, tH = isl.topW/2, bH = isl.baseW/2;

    const ig = ctx.createLinearGradient(sx,top,sx,WATER_LINE);
    ig.addColorStop(0,'#8d6e4a'); ig.addColorStop(0.4,'#6d4c2a'); ig.addColorStop(1,'#5d4037');
    ctx.fillStyle = ig;
    ctx.beginPath(); ctx.moveTo(sx-tH,top); ctx.lineTo(sx+tH,top);
    ctx.lineTo(sx+bH,WATER_LINE); ctx.lineTo(sx-bH,WATER_LINE); ctx.closePath(); ctx.fill();

    ctx.strokeStyle = '#3e2723'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(sx-tH,top); ctx.lineTo(sx+tH,top);
    ctx.lineTo(sx+bH,WATER_LINE); ctx.lineTo(sx-bH,WATER_LINE); ctx.closePath(); ctx.stroke();

    ctx.strokeStyle = '#d4a053'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(sx-tH+3,top+1); ctx.lineTo(sx+tH-3,top+1); ctx.stroke();

    if (isl.h > 20) {
      ctx.strokeStyle='#795548'; ctx.lineWidth=3;
      ctx.beginPath(); ctx.moveTo(sx,top); ctx.lineTo(sx+2,top-22); ctx.stroke();
      ctx.fillStyle='#27ae60';
      ctx.beginPath(); ctx.ellipse(sx+2,top-25,12,6,0.3,0,Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(sx-1,top-23,10,5,-0.4,0,Math.PI*2); ctx.fill();
    }

    // Underwater rock foundation (only visible when sub is near/below water)
    if (sub.y > WATER_LINE - 50) {
      // Visibility fades in as sub approaches water
      const visAlpha = Math.min(1, Math.max(0, (sub.y - (WATER_LINE - 50)) / 50));
      ctx.globalAlpha = visAlpha * 0.7;

      // Draw rocky underwater base from rockPoints
      const rp = isl.rockPoints;
      ctx.fillStyle = '#3a2a1a';
      ctx.beginPath();
      ctx.moveTo(toScreen(rp[0].x), WATER_LINE);
      for (const pt of rp) ctx.lineTo(toScreen(pt.x), pt.y);
      ctx.lineTo(toScreen(rp[rp.length-1].x), WATER_LINE);
      ctx.closePath();
      ctx.fill();
      // Rock outline
      ctx.strokeStyle = '#2a1a0a';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < rp.length; i++) {
        const pt = rp[i];
        i === 0 ? ctx.moveTo(toScreen(pt.x), pt.y) : ctx.lineTo(toScreen(pt.x), pt.y);
      }
      ctx.stroke();

      // Draw tunnel opening if present
      if (isl.hasTunnel) {
        ctx.fillStyle = '#0b2e4a'; // Dark water colour = passable
        ctx.strokeStyle = '#1a5276';
        ctx.lineWidth = 1;
        const tw = isl.underwaterW * 0.35;
        ctx.beginPath();
        ctx.ellipse(sx, isl.tunnelY, tw, isl.tunnelH / 2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // Dock prompt
    if (sub.floating && !sub.disembarked) {
      const dx = Math.abs(sub.worldX - isl.x);
      if (dx > isl.baseW/2-5 && dx < isl.baseW/2+30 && sub.y > WATER_LINE-15) {
        ctx.fillStyle='rgba(255,255,255,0.8)'; ctx.font='bold 14px Arial'; ctx.textAlign='center';
        ctx.fillText('[E] Disembark', sx, top-8);
      }
    }

    // Pilot on island
    if (sub.disembarked && sub.disembarkIsland === isl) {
      const px = toScreen(sub.pilotX), py = sub.pilotY;
      ctx.fillStyle='#ecf0f1';
      ctx.beginPath(); ctx.arc(px,py-10,3,0,Math.PI*2); ctx.fill();
      ctx.strokeStyle='#ecf0f1'; ctx.lineWidth=2;
      ctx.beginPath(); ctx.moveTo(px,py-7); ctx.lineTo(px,py); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(px-5,py-4); ctx.lineTo(px+5,py-4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(px,py); ctx.lineTo(px-3,py+6); ctx.moveTo(px,py); ctx.lineTo(px+3,py+6); ctx.stroke();
      ctx.fillStyle='rgba(255,255,255,0.8)'; ctx.font='bold 14px Arial'; ctx.textAlign='center';
      ctx.fillText('[E] Embark', px, py-18);
    }
  }

    drawAmmoStations(world);
    drawMines(world);
    drawChaffs(world);

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
    for (const p of t.trail) {
      ctx.globalAlpha = Math.max(0,1-p.age/12)*0.3;
      ctx.fillStyle = t.phase==='drop'?'#bdc3c7':'#85c1e9';
      ctx.beginPath(); ctx.arc(toScreen(p.wx), p.y, 2, 0, Math.PI*2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.save(); ctx.translate(toScreen(t.worldX), t.y); ctx.rotate(Math.atan2(t.vy, t.vx));
    ctx.fillStyle = t.phase==='drop'?'#95a5a6':(t.rogue?'#ff9800':'#ffe66d');
    ctx.beginPath(); ctx.ellipse(0,0,8,3,0,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#e74c3c'; ctx.beginPath(); ctx.arc(7,0,2.5,-Math.PI/2,Math.PI/2); ctx.fill();
    if (t.phase!=='drop') { ctx.fillStyle='rgba(133,193,233,0.5)'; ctx.beginPath(); ctx.arc(-9,0,2,0,Math.PI*2); ctx.fill(); }
    if (t.rogue && t.phase!=='drop') {
      ctx.strokeStyle='#ff9800'; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(0,-3); ctx.lineTo(0,-7); ctx.stroke();
      ctx.fillStyle='#ff9800'; ctx.beginPath(); ctx.arc(0,-7,1.5,0,Math.PI*2); ctx.fill();
    }
    ctx.restore();
  }

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

  // Enemies
  for (const e of world.enemies) drawEnemy(e);

  // Sub
  drawSub(sub);

  if (sub.disembarked && sub.diverMode) {
    const diverX = toScreen(sub.pilotX);
    const diverY = sub.pilotY;
    ctx.fillStyle = '#f8fafc';
    ctx.beginPath(); ctx.arc(diverX, diverY - 9, 3, 0, TWO_PI); ctx.fill();
    ctx.strokeStyle = '#f8fafc'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(diverX, diverY - 6); ctx.lineTo(diverX, diverY + 4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(diverX - 5, diverY - 1); ctx.lineTo(diverX + 5, diverY - 1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(diverX, diverY + 4); ctx.lineTo(diverX - 3, diverY + 10); ctx.moveTo(diverX, diverY + 4); ctx.lineTo(diverX + 3, diverY + 10); ctx.stroke();
    ctx.strokeStyle = 'rgba(133,193,233,0.45)';
    ctx.beginPath(); ctx.moveTo(diverX, diverY - 12); ctx.lineTo(diverX, diverY - 18); ctx.stroke();
    ctx.fillStyle = 'rgba(133,193,233,0.35)';
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(diverX + (Math.random() - 0.5) * 6, diverY - 20 - i * 8, 1.5 + i * 0.4, 0, TWO_PI);
      ctx.fill();
    }
  }

  // Particles
  for (const p of world.particles) {
    ctx.globalAlpha = Math.max(0,1-p.age/p.life); ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(toScreen(p.worldX), p.y, p.size, 0, Math.PI*2); ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Explosions
  for (const exp of world.explosions) {
    const prog = exp.age/exp.duration, r = exp.radius*(0.5+prog);
    ctx.globalAlpha = 1-prog;
    ctx.fillStyle='#ff6b00'; ctx.beginPath(); ctx.arc(toScreen(exp.worldX),exp.y,r,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#ffcc00'; ctx.beginPath(); ctx.arc(toScreen(exp.worldX),exp.y,r*0.5,0,Math.PI*2); ctx.fill();
    if (exp.radius>=30 && prog<0.2) { ctx.fillStyle='#fff'; ctx.beginPath(); ctx.arc(toScreen(exp.worldX),exp.y,r*0.25,0,Math.PI*2); ctx.fill(); }
    ctx.globalAlpha = 1;
  }

  // --- Ports (start and end) ---
  for (const port of [world.terrain.startPort, world.terrain.endPort]) {
    const px = toScreen(port.x);
    if (px < -100 || px > W + 100) continue;
    // Dock platform
    ctx.fillStyle = '#5a4a3a';
    ctx.fillRect(px - port.w/2, WATER_LINE - 20, port.w, 20);
    // Pilings
    ctx.fillStyle = '#3a2a1a';
    for (let p = 0; p < 4; p++) {
      const pilX = px - port.w/2 + 8 + p * (port.w - 16) / 3;
      ctx.fillRect(pilX - 2, WATER_LINE - 5, 4, 25);
    }
    // Bollards
    ctx.fillStyle = '#888';
    ctx.beginPath(); ctx.arc(px - port.w/3, WATER_LINE - 22, 3, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(px + port.w/3, WATER_LINE - 22, 3, 0, Math.PI*2); ctx.fill();
    // Flag pole
    ctx.strokeStyle = '#aaa'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(px, WATER_LINE - 20); ctx.lineTo(px, WATER_LINE - 50); ctx.stroke();
    // Flag
    const isEnd = port === world.terrain.endPort;
    ctx.fillStyle = isEnd ? '#2ecc71' : '#3498db';
    ctx.beginPath();
    ctx.moveTo(px, WATER_LINE - 50); ctx.lineTo(px + 15, WATER_LINE - 45);
    ctx.lineTo(px, WATER_LINE - 40); ctx.fill();
    // Label
    ctx.fillStyle = '#ecf0f1'; ctx.font = 'bold 12px Arial'; ctx.textAlign = 'center';
    ctx.fillText(port.name, px, WATER_LINE - 55);
  }

  // --- RADAR TOWERS ---
  for (const r of world.terrain.radars) {
    const rx = toScreen(r.x);
    if (rx < -50 || rx > W + 50) continue;
    const ry = r.y; // World Y (on top of island)

    if (r.destroyed) {
      // Wreckage — smoking stump
      ctx.fillStyle = '#333';
      ctx.fillRect(rx - 4, ry - 6, 8, 6);
      if (world.tick % 8 < 4) {
        ctx.fillStyle = 'rgba(80,80,80,0.3)';
        ctx.beginPath(); ctx.arc(rx, ry - 10 - Math.random()*5, 3, 0, Math.PI*2); ctx.fill();
      }
      continue;
    }

    const hpPct = r.hp / r.maxHp;

    if (r.tier === 1) {
      // --- BASIC RADAR: small post + rotating dish + flashing light ---
      // Post
      ctx.fillStyle = '#777';
      ctx.fillRect(rx - 2, ry - 18, 4, 18);
      // Rotating dish (small)
      ctx.save(); ctx.translate(rx, ry - 18);
      ctx.rotate(r.angle);
      ctx.fillStyle = '#aaa';
      ctx.fillRect(-8, -2, 16, 4);
      ctx.fillStyle = '#ccc';
      ctx.beginPath(); ctx.arc(8, 0, 3, 0, Math.PI*2); ctx.fill();
      ctx.restore();
      // Flashing danger light
      if (Math.sin(world.tick * 0.1) > 0) {
        ctx.fillStyle = '#e74c3c';
        ctx.beginPath(); ctx.arc(rx, ry - 20, 2.5, 0, Math.PI*2); ctx.fill();
        // Glow
        ctx.globalAlpha = 0.2;
        ctx.beginPath(); ctx.arc(rx, ry - 20, 8, 0, Math.PI*2); ctx.fill();
        ctx.globalAlpha = 1;
      }
    } else if (r.tier === 2) {
      // --- MACHINE GUN RADAR: thicker tower + fast spinning dish + gun barrel ---
      // Tower base
      ctx.fillStyle = '#555';
      ctx.fillRect(rx - 5, ry - 10, 10, 10);
      // Tower
      ctx.fillStyle = '#666';
      ctx.fillRect(rx - 3, ry - 28, 6, 18);
      // Armour plates
      ctx.strokeStyle = '#444'; ctx.lineWidth = 1;
      ctx.strokeRect(rx - 3, ry - 28, 6, 18);
      // Rotating dish (larger, faster)
      ctx.save(); ctx.translate(rx, ry - 28);
      ctx.rotate(r.angle);
      ctx.fillStyle = '#999';
      ctx.fillRect(-12, -3, 24, 6);
      ctx.fillStyle = '#bbb';
      ctx.beginPath(); ctx.arc(12, 0, 4, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(-12, 0, 4, 0, Math.PI*2); ctx.fill();
      ctx.restore();
      // Gun barrels (pointing toward sub)
      const gunAngle = Math.atan2(sub.y - (ry - 25), sub.worldX - r.x);
      ctx.save(); ctx.translate(rx, ry - 22);
      ctx.rotate(gunAngle);
      ctx.fillStyle = '#444';
      ctx.fillRect(0, -1.5, 14, 3);
      ctx.fillRect(0, -3, 14, 1); // Twin barrel
      ctx.restore();
      // Muzzle flash when firing
      if (r.cooldown > 20) {
        ctx.fillStyle = '#ffcc00';
        ctx.globalAlpha = 0.6;
        const mfx = rx + Math.cos(gunAngle) * 16;
        const mfy = ry - 22 + Math.sin(gunAngle) * 16;
        ctx.beginPath(); ctx.arc(mfx, mfy, 4 + Math.random()*2, 0, Math.PI*2); ctx.fill();
        ctx.globalAlpha = 1;
      }
    } else if (r.tier === 3) {
      // --- SAM RADAR: large fortified base + huge dish + missile launcher ---
      // Heavy base
      ctx.fillStyle = '#3a3a3a';
      ctx.fillRect(rx - 10, ry - 8, 20, 8);
      // Armoured tower
      const towerGrad = ctx.createLinearGradient(rx - 6, ry - 40, rx + 6, ry - 40);
      towerGrad.addColorStop(0, '#4a4a4a');
      towerGrad.addColorStop(0.5, '#5a5a5a');
      towerGrad.addColorStop(1, '#4a4a4a');
      ctx.fillStyle = towerGrad;
      ctx.fillRect(rx - 6, ry - 40, 12, 32);
      // Armour bolts
      ctx.fillStyle = '#666';
      for (let b = 0; b < 4; b++) {
        ctx.beginPath(); ctx.arc(rx - 4, ry - 12 - b * 8, 1.5, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(rx + 4, ry - 12 - b * 8, 1.5, 0, Math.PI*2); ctx.fill();
      }
      // Large rotating dish
      ctx.save(); ctx.translate(rx, ry - 40);
      ctx.rotate(r.angle);
      ctx.fillStyle = '#888';
      // Parabolic dish shape
      ctx.beginPath();
      ctx.moveTo(-16, 4); ctx.quadraticCurveTo(0, -8, 16, 4);
      ctx.lineTo(16, 6); ctx.quadraticCurveTo(0, -5, -16, 6);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#aaa';
      ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI*2); ctx.fill();
      ctx.restore();
      // SAM launcher tubes (angled toward sub)
      const samAngle = Math.atan2(sub.y - (ry - 30), sub.worldX - r.x);
      ctx.save(); ctx.translate(rx, ry - 15);
      ctx.rotate(Math.min(0, Math.max(-Math.PI/3, samAngle))); // Limited arc
      ctx.fillStyle = '#444';
      ctx.fillRect(-2, -4, 18, 3); // Tube 1
      ctx.fillRect(-2, 1, 18, 3);  // Tube 2
      ctx.restore();
      // Warning stripes
      ctx.strokeStyle = '#f39c12'; ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(rx - 10, ry - 8, 20, 8);
      ctx.setLineDash([]);
    }

    // Health bar above tower
    if (hpPct < 1) {
      const barW = 24;
      const barY = ry - (r.tier === 3 ? 48 : r.tier === 2 ? 34 : 26);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(rx - barW/2, barY, barW, 4);
      ctx.fillStyle = hpPct > 0.5 ? '#2ecc71' : hpPct > 0.25 ? '#f39c12' : '#e74c3c';
      ctx.fillRect(rx - barW/2, barY, barW * hpPct, 4);
    }

    // Alert radius ring (faint, pulsing)
    if (Math.hypot(r.x - sub.worldX, r.y - sub.y) < r.alertRadius * 1.2) {
      ctx.globalAlpha = 0.08 + Math.sin(world.tick * 0.03) * 0.04;
      ctx.strokeStyle = r.tier === 3 ? '#e74c3c' : r.tier === 2 ? '#f39c12' : '#e67e22';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(rx, ry, r.alertRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  // --- Cave entrances in sea floor ---
  for (const cave of world.terrain.caves) {
    const csx = toScreen(cave.x);
    if (csx < -50 || csx > W + 50) continue;
    // Only visible when sub is deep enough
    if (world.sub.y > WATER_LINE) {
      // Dark opening in the sea floor
      ctx.fillStyle = '#0a0a0a';
      ctx.beginPath();
      ctx.ellipse(csx, cave.y, cave.w / 2, cave.h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      // Glow ring if not visited
      if (!cave.visited) {
        ctx.strokeStyle = 'rgba(100, 200, 255, 0.4)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(csx, cave.y, cave.w / 2 + 3, cave.h / 2 + 3, 0, 0, Math.PI * 2);
        ctx.stroke();
        // Pulsing glow
        const pulse = 0.3 + Math.sin(world.tick * 0.05) * 0.2;
        ctx.globalAlpha = pulse;
        ctx.fillStyle = '#1a5276';
        ctx.beginPath();
        ctx.ellipse(csx, cave.y, cave.w / 2 - 5, cave.h / 2 - 5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }

  // Restore camera transform — HUD draws in screen coords
  ctx.restore();

  // HUD (screen-space, not affected by camera)
  drawHUD();
  drawDamageDiagram();
  if (world.menuOpen) drawWarpMenu();
  drawFlightInstruments();
  drawCompactLegend();

  // Cave message notification
  if (world.caveMessage && world.caveMessage.timer > 0) {
    world.caveMessage.timer--;
    const alpha = Math.min(1, world.caveMessage.timer / 30);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(W/2 - 200, H/2 - 20, 400, 40);
    ctx.fillStyle = '#85c1e9';
    ctx.font = 'bold 18px Arial'; ctx.textAlign = 'center';
    ctx.fillText(world.caveMessage.text, W/2, H/2 + 5);
    ctx.globalAlpha = 1;
  }

  // --- Altitude / Depth gauge (right side) ---
  // Always visible — shows altitude above water OR depth below it
  {
    const subY = world.sub.y;
    const isUnderwater = subY > WATER_LINE;
    const value = isUnderwater ? Math.round(subY - WATER_LINE) : Math.round(WATER_LINE - subY);
    const label = isUnderwater ? 'DEPTH' : 'ALT';
    const maxVal = isUnderwater ? (SEA_FLOOR - WATER_LINE) : WATER_LINE;
    const pct = Math.min(1, value / maxVal);

    // Panel background
    ctx.fillStyle = isUnderwater ? 'rgba(0,40,80,0.5)' : 'rgba(20,40,60,0.5)';
    ctx.fillRect(W - 80, H/2 - 70, 65, 140);
    ctx.strokeStyle = isUnderwater ? '#1a5276' : '#2a6496';
    ctx.lineWidth = 1;
    ctx.strokeRect(W - 80, H/2 - 70, 65, 140);

    // Label
    ctx.fillStyle = isUnderwater ? '#85c1e9' : '#a0c4e8';
    ctx.font = '10px Arial'; ctx.textAlign = 'center';
    ctx.fillText(label, W - 47, H/2 - 58);

    // Value
    ctx.font = 'bold 16px Arial';
    ctx.fillText(`${value}m`, W - 47, H/2 - 40);

    // Water line marker
    ctx.strokeStyle = '#4a90b8'; ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    const waterMarkY = isUnderwater ? H/2 - 28 : H/2 - 28 + 90 * (1 - pct);
    // Bar track
    ctx.setLineDash([]);
    ctx.fillStyle = isUnderwater ? '#0b2e4a' : '#1a2a3a';
    ctx.fillRect(W - 75, H/2 - 28, 55, 90);

    // Bar fill — grows down for depth, grows up for altitude
    if (isUnderwater) {
      ctx.fillStyle = pct > 0.8 ? '#e74c3c' : pct > 0.5 ? '#f39c12' : '#1a5276';
      ctx.fillRect(W - 75, H/2 - 28, 55, 90 * pct);
    } else {
      ctx.fillStyle = pct > 0.8 ? '#85c1e9' : pct > 0.5 ? '#2a6496' : '#1a3a5c';
      ctx.fillRect(W - 75, H/2 - 28 + 90 * (1 - pct), 55, 90 * pct);
    }

    // Water line label on the bar
    ctx.fillStyle = '#4a90b8'; ctx.font = '8px Arial';
    ctx.fillText('~~~', W - 47, isUnderwater ? H/2 - 25 : H/2 + 65);

    // Surface indicator (small triangle)
    if (!isUnderwater) {
      const surfY = H/2 - 28 + 90;
      ctx.fillStyle = '#4a90b8';
      ctx.beginPath();
      ctx.moveTo(W - 78, surfY); ctx.lineTo(W - 74, surfY - 3); ctx.lineTo(W - 74, surfY + 3);
      ctx.fill();
    }
  }

  // Game over
  if (world.gameOver) {
    ctx.fillStyle='rgba(0,0,0,0.6)'; ctx.fillRect(0,0,W,H);
    ctx.fillStyle='#e74c3c'; ctx.font='bold 48px Arial'; ctx.textAlign='center';
    ctx.fillText('HULL BREACH — MISSION FAILED', W/2, H/2-30);
    ctx.fillStyle='#ecf0f1'; ctx.font='24px Arial';
    ctx.fillText(`Score: ${world.score}  |  Kills: ${world.kills}`, W/2, H/2+20);
    ctx.fillStyle='#bdc3c7'; ctx.font='18px Arial';
    ctx.fillText('Press R to restart', W/2, H/2+60);
    drawLeaderboardPanel(W / 2 - 160, H / 2 + 92, 'Leaderboard');
    if (keys['r']||keys['R']) world = initWorld();
  }

  // Level complete
  if (world.levelComplete) {
    ctx.fillStyle='rgba(0,0,0,0.5)'; ctx.fillRect(0,0,W,H);
    ctx.fillStyle='#2ecc71'; ctx.font='bold 42px Arial'; ctx.textAlign='center';
    ctx.fillText('MISSION COMPLETE', W/2, H/2-40);
    ctx.fillStyle='#ecf0f1'; ctx.font='24px Arial';
    ctx.fillText(`Score: ${world.score}  |  Kills: ${world.kills}`, W/2, H/2+5);
    const hp = overallHealth(world.sub.parts);
    ctx.fillText(`Hull integrity: ${Math.ceil(hp)}%`, W/2, H/2+35);
    ctx.fillStyle='#bdc3c7'; ctx.font='18px Arial';
    ctx.fillText('Press R to play again', W/2, H/2+70);
    drawLeaderboardPanel(W / 2 - 160, H / 2 + 96, 'Leaderboard');
    if (keys['r']||keys['R']) world = initWorld();
  }

  // Pause
  if (world && world.paused && !world.gameOver) {
    drawPauseOverlay();
  }
}

// --- Draw submarine (facing-aware) ---
function drawSub(sub) {
  const periscopeActive = sub.periscopeMode;
  const sx = toScreen(sub.worldX);
  const f = sub.facing; // 1=right, -1=left
  const skin = resolveSubSkin(world.settings);

  // Wake ripples when floating
  if (sub.floating && !sub.disembarked) {
    ctx.strokeStyle='rgba(133,193,233,0.3)'; ctx.lineWidth=1;
    for (let i = 0; i < 3; i++) {
      ctx.globalAlpha = 0.3-i*0.1;
      ctx.beginPath(); ctx.ellipse(sx, WATER_LINE+2, 25+i*12, 2+i, 0, 0, Math.PI*2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  ctx.save();
  ctx.translate(sx, sub.y);
  ctx.scale(f, 1); // Flip horizontally when facing left
  ctx.rotate(sub.angle * f);

  const inWater = sub.y > WATER_LINE - 10;
  const parts = sub.parts;

  // Hull — colour shifts with damage
  const hullPct = parts.hull / 120;
  if (skin.pride) {
    ctx.fillStyle = stripedGradient(-22, 0, 22, 0, ['#e40303', '#ff8c00', '#ffed00', '#008026', '#24408e', '#732982']);
  } else if (skin.rainbow) {
    const hueShift = (world.tick * 2) % 360;
    ctx.fillStyle = stripedGradient(
      -22,
      0,
      22,
      0,
      Array.from({ length: 6 }, (_, idx) => `hsl(${(hueShift + idx * 60) % 360} 80% 60%)`)
    );
  } else {
    ctx.fillStyle = skin.hull;
  }
  ctx.beginPath(); ctx.ellipse(0,0,22,9,0,0,Math.PI*2); ctx.fill();
  ctx.strokeStyle = skin.hullStroke || '#1a5276'; ctx.lineWidth=1.5; ctx.stroke();
  if (hullPct < 1 && !skin.pride && !skin.rainbow) {
    ctx.globalAlpha = 1 - hullPct;
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath(); ctx.ellipse(0,0,22,9,0,0,TWO_PI); ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Wings (only in air, dim if damaged)
  if (!inWater && parts.wings > 0) {
    ctx.globalAlpha = parts.wings / 60;
    ctx.fillStyle = skin.wings || '#e74c3c';
    ctx.beginPath(); ctx.moveTo(-5,-4); ctx.lineTo(-15,-18); ctx.lineTo(-2,-6); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-5,4); ctx.lineTo(-15,18); ctx.lineTo(-2,6); ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Tower (dims with damage)
  if (parts.tower > 0) {
    ctx.globalAlpha = 0.3 + 0.7 * (parts.tower / 70);
    ctx.fillStyle = skin.tower || '#34495e'; ctx.fillRect(-3,-15,6,7);
    // Periscope
    ctx.strokeStyle = skin.pride || skin.rainbow ? '#f8fafc' : '#7f8c8d'; ctx.lineWidth=2;
    ctx.beginPath(); ctx.moveTo(0,-15); ctx.lineTo(0,-20); ctx.lineTo(4,-20); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Nose (dims with damage)
  ctx.globalAlpha = 0.4 + 0.6 * (parts.nose / 100);
  ctx.fillStyle = skin.nose || '#2c3e50';
  ctx.beginPath(); ctx.arc(22,0,4,-Math.PI/2,Math.PI/2); ctx.fill();
  ctx.globalAlpha = 1;

  // Propeller (slows when engine damaged)
  if (parts.engine > 0) {
    const speed = parts.engine > 40 ? 40 : 100; // Slower spin when damaged
    const pa = Date.now() / speed;
    ctx.strokeStyle='#95a5a6'; ctx.lineWidth=2;
    ctx.beginPath(); ctx.moveTo(-22,Math.sin(pa)*6); ctx.lineTo(-22,-Math.sin(pa)*6); ctx.stroke();
  }

  // Rudder stub if damaged
  if (parts.rudder <= 0) {
    ctx.fillStyle='#555'; ctx.fillRect(-24,-2,4,4); // Broken rudder stub
  }

  // Porthole
  ctx.fillStyle = skin.porthole || '#85c1e9';
  ctx.beginPath(); ctx.arc(8,0,2.5,0,Math.PI*2); ctx.fill();

  ctx.restore();

  // Exhaust (behind the sub)
  if (keys['ArrowUp'] || keys['ArrowRight'] || keys['ArrowLeft']) {
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = inWater ? '#85c1e9' : '#bdc3c7';
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(sx - f*22 - f*Math.random()*15, sub.y+(Math.random()-0.5)*8, 1+Math.random()*2, 0, Math.PI*2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  if (sub.afterburnerActive) {
    ctx.fillStyle = AFTERBURNER_COLOR;
    ctx.beginPath();
    ctx.moveTo(sx - f * 22, sub.y - 3);
    ctx.lineTo(sx - f * (32 + Math.random() * 6), sub.y);
    ctx.lineTo(sx - f * 22, sub.y + 3);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#fcd34d';
    ctx.beginPath();
    ctx.moveTo(sx - f * 22, sub.y - 1.5);
    ctx.lineTo(sx - f * (28 + Math.random() * 3), sub.y);
    ctx.lineTo(sx - f * 22, sub.y + 1.5);
    ctx.closePath();
    ctx.fill();
  }

  if (periscopeActive) {
    drawPeriscopeRod(sub);
  }
}

function drawEnemy(e) {
  const sx = toScreen(e.worldX);
  if (sx < -40 || sx > W+40) return;
  const dir = e.vx < 0 ? 1 : -1;
  ctx.save(); ctx.translate(sx, e.y); ctx.scale(dir, 1);

  if (e.type === 'jet') {
    // Sleek jet fighter — swept wings, pointed nose
    // Fuselage
    ctx.fillStyle='#c0392b';
    ctx.beginPath(); ctx.moveTo(18,0); ctx.lineTo(12,-3); ctx.lineTo(-14,-3); ctx.lineTo(-16,0);
    ctx.lineTo(-14,3); ctx.lineTo(12,3); ctx.closePath(); ctx.fill();
    // Swept wings
    ctx.fillStyle='#a93226';
    ctx.beginPath(); ctx.moveTo(2,-3); ctx.lineTo(-6,-14); ctx.lineTo(-10,-3); ctx.fill();
    ctx.beginPath(); ctx.moveTo(2,3); ctx.lineTo(-6,14); ctx.lineTo(-10,3); ctx.fill();
    // Tail fin
    ctx.fillStyle='#922b21';
    ctx.beginPath(); ctx.moveTo(-14,-3); ctx.lineTo(-18,-9); ctx.lineTo(-16,0); ctx.fill();
    // Cockpit
    ctx.fillStyle='#85c1e9';
    ctx.beginPath(); ctx.ellipse(8,-1,4,2,0,0,Math.PI*2); ctx.fill();
    // Exhaust
    ctx.fillStyle='rgba(255,150,0,0.4)';
    ctx.beginPath(); ctx.moveTo(-16,-1.5); ctx.lineTo(-20-Math.random()*3,0); ctx.lineTo(-16,1.5); ctx.fill();

  } else if (e.type === 'prop') {
    // Propeller plane — rounded fuselage, straight wings, spinning prop
    // Fuselage
    ctx.fillStyle='#5b7553';
    ctx.beginPath(); ctx.ellipse(0,0,14,4,0,0,Math.PI*2); ctx.fill();
    // Wings (straight)
    ctx.fillStyle='#4a6340';
    ctx.fillRect(-4,-12,8,24);
    // Tail
    ctx.fillStyle='#3e5233';
    ctx.beginPath(); ctx.moveTo(-12,-2); ctx.lineTo(-18,-8); ctx.lineTo(-16,0); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-12,2); ctx.lineTo(-18,8); ctx.lineTo(-16,0); ctx.fill();
    // Propeller (spinning)
    const pa = Date.now() / 25;
    ctx.strokeStyle='#ccc'; ctx.lineWidth=2;
    ctx.beginPath(); ctx.moveTo(14, Math.sin(pa)*6); ctx.lineTo(14, -Math.sin(pa)*6); ctx.stroke();
    // Cockpit
    ctx.fillStyle='#85c1e9';
    ctx.beginPath(); ctx.ellipse(2,-2,3,1.5,0,0,Math.PI*2); ctx.fill();

  } else if (e.type === 'heli') {
    ctx.fillStyle='#16a085';
    ctx.fillRect(-12,-3,24,6);
    ctx.fillStyle='#117864';
    ctx.fillRect(-20,-2,10,4);
    ctx.fillRect(10,-3,8,2);
    ctx.strokeStyle='#bdc3c7'; ctx.lineWidth=2;
    ctx.beginPath();
    ctx.moveTo(0,-8); ctx.lineTo(0,8);
    ctx.moveTo(-8,0); ctx.lineTo(8,0);
    ctx.moveTo(0,-10); ctx.lineTo(0,-6);
    ctx.stroke();
    ctx.fillStyle='#ecf0f1';
    ctx.beginPath(); ctx.arc(-2,0,2.5,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(5,0,1.5,0,Math.PI*2); ctx.fill();

  } else if (e.type === 'biplane') {
    // Biplane — double wings, struts, slow
    // Fuselage
    ctx.fillStyle='#d4a053';
    ctx.fillRect(-10,-2,20,4);
    // Upper wing
    ctx.fillStyle='#c49040';
    ctx.fillRect(-8,-10,16,3);
    // Lower wing
    ctx.fillRect(-8,7,16,3);
    // Struts
    ctx.strokeStyle='#8b6914'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(-5,-7); ctx.lineTo(-5,7); ctx.moveTo(5,-7); ctx.lineTo(5,7); ctx.stroke();
    // Tail
    ctx.fillStyle='#b5832e';
    ctx.beginPath(); ctx.moveTo(-10,-2); ctx.lineTo(-16,-6); ctx.lineTo(-14,0); ctx.fill();
    // Propeller
    const pa2 = Date.now() / 35;
    ctx.strokeStyle='#666'; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.moveTo(10,Math.sin(pa2)*5); ctx.lineTo(10,-Math.sin(pa2)*5); ctx.stroke();

  } else if (e.type === 'ship') {
    // Naval ship — hull on water, superstructure, gun turret
    // Hull
    ctx.fillStyle='#4a4a4a';
    ctx.beginPath();
    ctx.moveTo(-25,0); ctx.lineTo(-20,6); ctx.lineTo(20,6); ctx.lineTo(25,0);
    ctx.lineTo(20,-2); ctx.lineTo(-20,-2); ctx.closePath(); ctx.fill();
    // Deck
    ctx.fillStyle='#5a5a5a';
    ctx.fillRect(-18,-2,36,2);
    // Superstructure
    ctx.fillStyle='#6a6a6a';
    ctx.fillRect(-5,-8,10,6);
    // Bridge windows
    ctx.fillStyle='#85c1e9';
    ctx.fillRect(-3,-7,6,2);
    // Mast
    ctx.strokeStyle='#888'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(0,-8); ctx.lineTo(0,-15); ctx.stroke();
    // Gun turret (front)
    ctx.fillStyle='#555';
    ctx.beginPath(); ctx.arc(12,-3,3,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle='#555'; ctx.lineWidth=2;
    ctx.beginPath(); ctx.moveTo(12,-3); ctx.lineTo(18,-4); ctx.stroke();
    // Wake
    ctx.fillStyle='rgba(255,255,255,0.2)';
    ctx.beginPath(); ctx.moveTo(-25,2); ctx.lineTo(-32,0); ctx.lineTo(-25,-1); ctx.fill();
  }

  // Damage indicator
  if (e.health < (e.type === 'ship' ? 3 : 2)) {
    ctx.fillStyle='rgba(255,0,0,0.6)'; ctx.beginPath(); ctx.arc(0,-12,3,0,Math.PI*2); ctx.fill();
    // Smoke trail for damaged enemies
    if (world.tick % 3 === 0) {
      ctx.fillStyle='rgba(80,80,80,0.3)'; ctx.beginPath();
      ctx.arc(-Math.random()*8, -5-Math.random()*5, 2+Math.random()*2, 0, Math.PI*2); ctx.fill();
    }
  }
  ctx.restore();
}

// ============================================================
// HUD — bottom info + controls hint
// ============================================================
function drawHUD() {
  drawSolarMiniMap();
  const sub = world.sub;
  const hp = overallHealth(sub.parts);
  const hudStartY = SOLAR_MAP_PADDING + SOLAR_MAP_SIZE + 6;

  // Overall health bar (bottom-left area below damage diagram)
  ctx.fillStyle='rgba(0,0,0,0.5)'; ctx.fillRect(15, hudStartY, 104, 12);
  ctx.fillStyle = hp > 50 ? '#2ecc71' : hp > 25 ? '#f39c12' : '#e74c3c';
  ctx.fillRect(17, hudStartY + 2, Math.max(0, hp), 8);
  ctx.strokeStyle='#ecf0f1'; ctx.lineWidth=1; ctx.strokeRect(15, hudStartY, 104, 12);

  ctx.fillStyle='#ecf0f1'; ctx.font='11px Arial'; ctx.textAlign='left';
  ctx.fillText(`Overall: ${Math.ceil(hp)}%`, 125, hudStartY + 10);

  // Score & kills
  ctx.font='bold 16px Arial';
  ctx.fillText(`Score: ${world.score}`, 15, hudStartY + 32);
  ctx.font='12px Arial';
  ctx.fillText(`Kills: ${world.kills}`, 15, hudStartY + 48);

  // Status
  ctx.textAlign='right'; ctx.font='13px Arial';
  const statusY = hudStartY + 10;
  if (world.mode === 'orbit' && world.space?.nearestBody) {
    ctx.fillStyle = '#c4b5fd';
    ctx.fillText(`Orbiting near ${world.space.nearestBody.body.label}`, W-15, statusY);
  } else if (sub.disembarked) {
    ctx.fillStyle='#d4a053';
    ctx.fillText(sub.diverMode ? 'DIVER DEPLOYED' : 'DISEMBARKED', W-15, statusY);
  } else if (sub.floating) {
    ctx.fillStyle='#85c1e9';
    ctx.fillText('FLOATING', W-15, statusY);
  } else {
    const alt = Math.round(WATER_LINE - sub.y);
    ctx.fillStyle='#ecf0f1';
    ctx.fillText(alt > 0 ? `Alt: ${alt}` : `Depth: ${-alt}`, W-15, statusY);
  }

  if (sub.periscopeMode) {
    ctx.fillStyle='#f1c40f'; ctx.font='11px Arial';
    ctx.fillText('PERISCOPE MODE — radar blind', W-15, 158);
  }

  // Facing indicator
  ctx.fillStyle='#bdc3c7'; ctx.font='12px Arial';
  ctx.fillText(sub.facing > 0 ? 'HEADING: >>>' : 'HEADING: <<<', W-15, hudStartY + 26);

  // Weapons + ammo
  ctx.font='12px Arial';
  const tReady = world.fireCooldown <= 0 && canFireTorpedo(sub.parts) && sub.torpedoAmmo > 0;
  const mReady = world.missileCooldown <= 0 && sub.missileAmmo > 0;
  const dReady = world.depthChargeCooldown <= 0 && sub.depthChargeAmmo > 0;
  ctx.fillStyle = sub.torpedoAmmo <= 0 ? '#555' : tReady ? '#2ecc71' : '#7f8c8d';
  ctx.fillText(`TORP x${sub.torpedoAmmo} ${sub.torpedoAmmo<=0?'EMPTY':(tReady?'RDY':(canFireTorpedo(sub.parts)?'...':'DMG'))}`, W-15, 128);
  ctx.fillStyle = sub.missileAmmo <= 0 ? '#555' : mReady ? '#e74c3c' : '#7f8c8d';
  ctx.fillText(`MSL x${sub.missileAmmo} ${sub.missileAmmo<=0?'EMPTY':(mReady?'RDY':'...')}`, W-15, 142);
  ctx.fillStyle = sub.depthChargeAmmo <= 0 ? '#555' : dReady ? DEPTH_CHARGE_COLOR : '#7f8c8d';
  ctx.fillText(`DCHG x${sub.depthChargeAmmo} ${sub.depthChargeAmmo<=0?'EMPTY':(dReady?'RDY':'...')}`, W-15, 156);
  ctx.fillStyle = sub.afterburnerCharge > 20 ? AFTERBURNER_COLOR : '#7f8c8d';
  ctx.fillText(`A/B ${Math.round(sub.afterburnerCharge)}%`, W-15, 170);

  // Controls
  ctx.font='11px Arial'; ctx.fillStyle='rgba(255,255,255,0.4)'; ctx.textAlign='center';
  if (sub.disembarked) ctx.fillText('[Tab] Re-enter  |  Diver tether active', W/2, H-10);
  else ctx.fillText('Esc: controls | Tab: eject | A: afterburner | Ctrl: depth | Space: torpedo | Shift: missile', W/2, H-10);
}

// ============================================================
// DAMAGE DIAGRAM — side-view sub schematic at top-centre
// ============================================================
function drawDamageDiagram() {
  const parts = world.sub.parts;
  const cx = W / 2;         // Centre of diagram
  const cy = 28;             // Vertical centre
  const scale = 2.2;         // Scale factor

  // Background panel
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fillRect(cx - 75, 5, 150, 48);
  ctx.strokeStyle = '#555';
  ctx.lineWidth = 1;
  ctx.strokeRect(cx - 75, 5, 150, 48);

  // Label
  ctx.fillStyle = '#888';
  ctx.font = '9px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('SYSTEMS', cx, 14);

  // Helper: colour from HP percentage
  function partColor(hp, maxHp) {
    const pct = hp / maxHp;
    if (pct > 0.6) return '#2ecc71';      // Green
    if (pct > 0.3) return '#f39c12';      // Yellow/orange
    if (pct > 0)   return '#e74c3c';      // Red
    return '#444';                         // Dead/dark
  }

  // Draw the sub schematic (nose right, propeller left)
  // Positions relative to cx, cy

  // 1. NOSE (far right)
  ctx.fillStyle = partColor(parts.nose, 100);
  ctx.beginPath();
  ctx.arc(cx + 28, cy, 5 * scale, -Math.PI/2, Math.PI/2);
  ctx.fill();

  // 2. HULL (centre, large ellipse)
  ctx.fillStyle = partColor(parts.hull, 120);
  ctx.beginPath();
  ctx.ellipse(cx, cy, 26, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#1a5276';
  ctx.lineWidth = 1;
  ctx.stroke();

  // 3. TOWER (top, small rectangle)
  ctx.fillStyle = partColor(parts.tower, 70);
  ctx.fillRect(cx - 3, cy - 14, 6, 7);
  // Periscope stub
  if (parts.tower > 0) {
    ctx.strokeStyle = partColor(parts.tower, 70);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, cy - 14);
    ctx.lineTo(cx, cy - 17);
    ctx.lineTo(cx + 3, cy - 17);
    ctx.stroke();
  }

  // 4. ENGINE (far left)
  ctx.fillStyle = partColor(parts.engine, 80);
  ctx.fillRect(cx - 30, cy - 4, 8, 8);
  // Propeller lines
  if (parts.engine > 0) {
    const pa = Date.now() / (parts.engine > 40 ? 60 : 150);
    ctx.strokeStyle = partColor(parts.engine, 80);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - 30, cy + Math.sin(pa) * 5);
    ctx.lineTo(cx - 30, cy - Math.sin(pa) * 5);
    ctx.stroke();
  }

  // 5. WINGS (top & bottom of hull, small triangles)
  ctx.fillStyle = partColor(parts.wings, 60);
  // Top wing
  ctx.beginPath();
  ctx.moveTo(cx - 6, cy - 5);
  ctx.lineTo(cx - 14, cy - 14);
  ctx.lineTo(cx - 2, cy - 6);
  ctx.fill();
  // Bottom wing
  ctx.beginPath();
  ctx.moveTo(cx - 6, cy + 5);
  ctx.lineTo(cx - 14, cy + 14);
  ctx.lineTo(cx - 2, cy + 6);
  ctx.fill();

  // 6. RUDDER (behind engine)
  ctx.fillStyle = partColor(parts.rudder, 60);
  ctx.beginPath();
  ctx.moveTo(cx - 30, cy - 2);
  ctx.lineTo(cx - 36, cy - 7);
  ctx.lineTo(cx - 30, cy + 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx - 30, cy + 2);
  ctx.lineTo(cx - 36, cy + 7);
  ctx.lineTo(cx - 30, cy - 2);
  ctx.fill();

  // Part name labels on hover would be nice but for now, tiny labels below
  ctx.fillStyle = '#777';
  ctx.font = '7px Arial';
  ctx.textAlign = 'center';
  const labels = [
    { x: cx - 33, t: 'RDR' },
    { x: cx - 26, t: 'ENG' },
    { x: cx - 10, t: 'WNG' },
    { x: cx,      t: 'HUL' },
    { x: cx + 2,  t: 'TWR' },
    { x: cx + 28, t: 'NOS' },
  ];
  // Only show labels for damaged parts
  for (const l of labels) {
    const def = SUB_PARTS.find(p => p.id === {RDR:'rudder',ENG:'engine',WNG:'wings',HUL:'hull',TWR:'tower',NOS:'nose'}[l.t]);
    if (def && parts[def.id] < def.maxHp) {
      ctx.fillStyle = partColor(parts[def.id], def.maxHp);
      ctx.fillText(l.t, l.x, cy + 22);
    }
  }
}

// Start
init().catch(console.error);
