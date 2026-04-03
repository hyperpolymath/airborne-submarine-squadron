// SPDX-License-Identifier: AGPL-3.0-or-later
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
const DEPTH_CHARGE_BLAST_RADIUS = 85;
const DEPTH_CHARGE_LIFE = 180;
const DEPTH_CHARGE_COLOR = '#9b59b6';
const EJECT_PRIME_TIMEOUT = 60;
const DIVING_BELL_SPEED = 0.4;
const PARACHUTE_DESCENT_SPEED = 0.6;
const HALO_DESCENT_SPEED = 2.5;       // Fast freefall before chute opens
const HALO_OPEN_ALTITUDE = 40;        // Opens this many pixels above ground/water
const COMMANDER_HP = 3;                // Hits before commander is killed

// --- Thermal layers (asymmetric — player must notice the temperature shift) ---
const THERMAL_LAYER_1_MAX = WATER_LINE + 75;   // Warm (surface to ~495) — shallower than expected
const THERMAL_LAYER_2_MAX = WATER_LINE + 195;  // Thermocline (~495 to ~615) — wide band
// Layer 3: below ~615 to sea floor (deep cold)
const THERMAL_TEMPS = [17.4, 6.8, 1.9]; // °C — realistic-ish
const THERMAL_LABELS = ['WARM', 'THERMOCLINE', 'DEEP COLD'];
// --- Caterpillar drive ---
const CATERPILLAR_SPEED_MULT = 0.25;  // 25% speed when active

const HULL_DEEP_THRESHOLD = 0.4;      // Below 40% hull, can't enter deep layer
const HULL_DEEP_CRUSH_THRESHOLD = 0.2; // Below 20% hull while IN deep = crushed

function getThermalLayer(y) {
  if (y <= WATER_LINE) return -1; // Not in water
  if (y < THERMAL_LAYER_1_MAX) return 0;
  if (y < THERMAL_LAYER_2_MAX) return 1;
  return 2;
}

function thermallyVisible(observerY, targetY) {
  const obsL = getThermalLayer(observerY);
  const tgtL = getThermalLayer(targetY);
  // Air sees all water layers
  if (obsL < 0) return true;
  // Target in air is always visible from water (but see thermalSilhouette for rendering)
  if (tgtL < 0) return true;
  // Same or adjacent layer: fully visible
  // 2 layers apart: invisible (e.g., warm↔deep)
  return Math.abs(obsL - tgtL) < 2;
}

// Returns true if an object should be drawn as silhouette (not full detail)
// From middle layer: surface objects are silhouettes
function thermalSilhouette(observerY, targetY) {
  const obsL = getThermalLayer(observerY);
  const tgtL = getThermalLayer(targetY);
  if (obsL < 0 || tgtL < 0) return false; // Air: no silhouette
  // From thermocline (1), surface objects (0) are silhouettes
  if (obsL === 1 && tgtL === 0) return true;
  return false;
}

// --- Commander gun post ---
const GUN_POST_MG_COOLDOWN = 5;
const GUN_POST_MG_SPEED = 6;
const GUN_POST_MG_DAMAGE = 2;
const GUN_POST_MG_RANGE = 200;
const GUN_POST_BULLET_LIFE = 60;

// --- Mission timer ---
const MISSION_TYPES = {
  patrol:  { timed: false, label: 'PATROL' },
  strike:  { timed: true, duration: 6000, label: 'STRIKE' },
  hostage: { timed: true, duration: 4000, label: 'HOSTAGE RESCUE', mandatory: true },
  escort:  { timed: true, duration: 8000, label: 'ESCORT' },
};
const DIVING_BELL_RADIUS = 12;

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
const ORBITAL_TURN_RATE = 0.025;          // Was 0.06 — much less twitchy
const ORBITAL_THRUST = 0.015;             // Was 0.035 — gentler acceleration
const ORBITAL_RETRO_THRUST = 0.012;       // Was 0.025 — softer braking
const ORBITAL_AFTERBURNER_THRUST = 0.035; // Was 0.065 — still strong but manageable
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
  { id: 'pluto', label: 'Pluto', orbitRadius: 440, radius: 3, color: '#a0a0a0', period: 800, phase: 4.2, gm: 1 },
];
const SOLAR_SYSTEM_BOUNDARY = 470; // Hard boundary — cannot fly past this radius
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
  haloParachute: false,
  deepDiverKit: false,
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
    if (world.menuOpen) {
      world.menuOpen = false;
    } else {
      world.paused = !world.paused;
    }
    e.preventDefault(); return;
  }
  e.preventDefault();
});
document.addEventListener('keyup', e => { keys[e.key] = false; });
window.addEventListener('focus', () => { canvas.focus(); });

// --- Mouse tracking ---
const mouse = { x: 0, y: 0, down: false, worldX: 0 };
canvas.addEventListener('mousemove', e => {
  const rect = canvas.getBoundingClientRect();
  mouse.x = (e.clientX - rect.left) * (W / rect.width);
  mouse.y = (e.clientY - rect.top) * (H / rect.height);
  mouse.worldX = mouse.x + (world ? world.cameraX : 0);
});
canvas.addEventListener('mousedown', e => { mouse.down = true; e.preventDefault(); });
canvas.addEventListener('mouseup', e => { mouse.down = false; });
canvas.addEventListener('mouseleave', () => { mouse.down = false; });

// --- Terrain ---
function generateTerrain(length) {
  const ground = [], islands = [], caves = [];
  let y = SEA_FLOOR;
  for (let x = 0; x < length; x += 4) {
    y += (Math.random() - 0.48) * 4;
    y = Math.max(WATER_LINE + 60, Math.min(SEA_FLOOR + 40, y));
    ground.push({ x, y });
  }
  // Seabed features
  // 1. Sunken supply packages on the ocean floor
  const sunkenSupplies = [];
  for (let i = 0; i < 5; i++) {
    const sx = 600 + Math.random() * (length - 1200);
    const gIdx = Math.floor(sx / 4);
    const gy = (gIdx >= 0 && gIdx < ground.length) ? ground[gIdx].y : SEA_FLOOR;
    sunkenSupplies.push({ x: sx, y: gy - 6, collected: false });
  }

  // 2. Small diver holes (diver can enter)
  const diverHoles = [];
  for (let i = 0; i < 3; i++) {
    const dx = 500 + Math.random() * (length - 1000);
    const gIdx = Math.floor(dx / 4);
    const gy = (gIdx >= 0 && gIdx < ground.length) ? ground[gIdx].y : SEA_FLOOR;
    const isMissionTunnel = i === 0; // First diver hole is a mission tunnel
    diverHoles.push({
      x: dx, y: gy, w: 18, h: 14,
      explored: false,
      missionTunnel: isMissionTunnel,
      reward: isMissionTunnel ? 'mission' : ['ammo', 'intel', 'repair'][Math.floor(Math.random() * 3)],
    });
  }

  // 3. Large sub caves (1-3) — hiding places with periscope capability
  const subCaveCount = 1 + Math.floor(Math.random() * 3);
  for (let i = 0; i < subCaveCount; i++) {
    const cx = 800 + Math.random() * (length - 1600);
    const cw = 45 + Math.random() * 25;
    const ch = 28 + Math.random() * 12;
    const gIdx = Math.floor(cx / 4);
    const groundY = (gIdx >= 0 && gIdx < ground.length) ? ground[gIdx].y : SEA_FLOOR;
    const isLabyrinth = i === 0 && subCaveCount >= 2; // First cave is labyrinth if 2+ caves
    caves.push({
      x: cx, y: groundY, w: cw, h: ch, levelId: i,
      visited: false,
      subCave: true,
      occupied: false,
      labyrinth: isLabyrinth, // v3 mission cave
    });
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
  // Mark 1-2 islands as mission islands (Trionic SubCommando — v2)
  if (islands.length >= 4) {
    const mIdx = Math.floor(islands.length * 0.4 + Math.random() * islands.length * 0.3);
    islands[Math.min(mIdx, islands.length - 1)].missionIsland = true;
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
      wobblePhase: Math.random() * Math.PI * 2,
      wobbleRange: tier === 1 ? 8 : 0, // Tier 1 moves back/forward
      siloCount: tier === 2 ? 3 : 0,   // Tier 2 has launch silos
    });
  }
  // Destroyer — one per level, patrols mid-section
  const destroyerX = length * 0.4 + Math.random() * length * 0.3;
  const destroyer = {
    x: destroyerX,
    y: WATER_LINE - 8,
    patrolCenter: destroyerX,
    patrolDir: 1,
    hp: DESTROYER_HP,
    maxHp: DESTROYER_HP,
    destroyed: false,
    missileCooldown: DESTROYER_MISSILE_COOLDOWN * 0.5,
    aaCooldown: 0,
    depthChargeCooldown: DESTROYER_DEPTH_CHARGE_COOLDOWN * 0.7,
    torpedoCooldown: DESTROYER_TORPEDO_COOLDOWN * 0.6,
    alertLevel: 0, // 0=idle, 1=alert, 2=engaged
    wakeTrail: [],
  };

  // Start and end ports (hangars at water level)
  const startPort = {
    x: 150, w: 80, name: 'HOME PORT',
    hp: HANGAR_MAX_HP, destroyed: false,
    pointDefenseCooldown: 0, criticalTimer: 0,
  };
  const endPort = {
    x: length - 200, w: 80, name: 'DESTINATION',
    hp: HANGAR_MAX_HP, destroyed: false,
    pointDefenseCooldown: 0, criticalTimer: 0,
  };
  // Акула-Молот enemy submarine — one per level, deadly
  const akulaMolot = {
    x: length * 0.5 + (Math.random() - 0.5) * length * 0.3,
    y: WATER_LINE + 80 + Math.random() * 100,
    targetDepth: WATER_LINE + 80,
    hp: AKULA_HP,
    maxHp: AKULA_HP,
    destroyed: false,
    dir: Math.random() < 0.5 ? 1 : -1,
    samCooldown: AKULA_SAM_COOLDOWN * 0.4,
    torpedoCooldown: AKULA_TORPEDO_COOLDOWN * 0.3,
    cloakTimer: 0,
    cloaked: false,
    sonarBuoyCooldown: 0,
    sonarBuoys: [],
    diving: false,
    sonarChainDeployed: false,
    sonarChainCooldown: 0,
    sonarChainLength: 0,     // Current deployed length (grows over time)
    patrolMin: length * 0.2,
    patrolMax: length * 0.75,
  };

  // Дельфин enemy submarines — 2 per level, less dangerous
  const delfins = [];
  for (let i = 0; i < DELFIN_COUNT; i++) {
    const spawnX = length * (0.25 + i * 0.35) + (Math.random() - 0.5) * length * 0.15;
    delfins.push({
      x: spawnX,
      y: WATER_LINE + 40 + Math.random() * 60,
      dir: Math.random() < 0.5 ? 1 : -1,
      hp: DELFIN_HP,
      maxHp: DELFIN_HP,
      destroyed: false,
      bailed: false,
      surfaced: false,
      torpedoCooldown: DELFIN_TORPEDO_COOLDOWN * (0.3 + Math.random() * 0.5),
      mgCooldown: 0,
      patrolCenter: spawnX,
      patrolRange: 250 + Math.random() * 150,
      bailChecked: false,
      crew: [],  // Populated on bail-out
    });
  }

  // Interceptor boats — hide behind islands, harass the sub
  const interceptors = [];
  for (let i = 0; i < Math.min(INTERCEPTOR_COUNT, islands.length); i++) {
    const isl = islands[Math.floor(Math.random() * islands.length)];
    const side = Math.random() < 0.5 ? -1 : 1;
    interceptors.push({
      x: isl.x + side * (isl.baseW / 2 + 10),
      y: WATER_LINE - 4,
      homeIsland: isl,
      hp: INTERCEPTOR_HP,
      maxHp: INTERCEPTOR_HP,
      destroyed: false,
      state: 'hiding', // hiding, rushing, stopping, aiming, firing, retreating
      stateTimer: 100 + Math.random() * 200,
      dir: 1,
      mgCooldown: 0,
      bazookaCooldown: INTERCEPTOR_BAZOOKA_COOLDOWN * 0.5,
      aimTimer: 0,
      targetPart: null,
    });
  }

  // Passenger ship — travels between islands
  const islandXs = islands.map((i) => i.x).sort((a, b) => a - b);
  const passengerShip = islandXs.length >= 2 ? {
    x: islandXs[0],
    y: WATER_LINE - 6,
    hp: PASSENGER_SHIP_HP,
    maxHp: PASSENGER_SHIP_HP,
    destroyed: false,
    routeIslands: islandXs,
    currentStop: 0,
    dwellTimer: PASSENGER_DWELL_TIME * 0.3,
    moving: false,
    dir: 1,
    survivors: [],
  } : null;

  return { ground, islands, caves, radars, startPort, endPort, destroyer, passengerShip, interceptors, akulaMolot, delfins, sunkenSupplies, diverHoles };
}

// --- Hangar constants ---
const HANGAR_MAX_HP = 200;
const HANGAR_GREEN_THRESHOLD = 0.6;   // Above 60% = green
const HANGAR_YELLOW_THRESHOLD = 0.3;  // Above 30% = yellow
const HANGAR_RED_THRESHOLD = 0.08;    // Above 8% = red, below = purple (critical)
const HANGAR_PROTECT_RADIUS = 50;     // How close to the hangar centre = "inside"
const HANGAR_POINT_DEFENSE_RANGE = 180;
const HANGAR_POINT_DEFENSE_COOLDOWN = 35;
const HANGAR_POINT_DEFENSE_DAMAGE = 3;
const HANGAR_RED_DPS = 0.4;          // Damage per tick to sub when inside a red hangar
const HANGAR_CRITICAL_TIMER = 180;    // Ticks at purple before explosion

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
const AKULA_SPEED = 0.6;
const AKULA_DIVE_SPEED = 0.4;
const AKULA_SAM_COOLDOWN = 140;
const AKULA_TORPEDO_COOLDOWN = 180;
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

const SUPPLY_DROP_INTERVAL = 600;
const SUPPLY_DROP_FALL_SPEED = 0.8;
const SUPPLY_DROP_COLLECT_RADIUS = 28;
const SUPPLY_DROP_PUSH_SPEED = 1.8;
const SUPPLY_DROP_FLOAT_CHANCE = 0.6;
const SUPPLY_DROP_PARACHUTE_HEIGHT = 25;

function createAmmoStations() { return []; }

function spawnSupplyDrop() {
  // Drop near the sub's area (slightly ahead of camera)
  const dropX = world.cameraX + 100 + Math.random() * (W - 200);
  const floats = Math.random() < SUPPLY_DROP_FLOAT_CHANCE;
  return {
    x: dropX,
    y: -20,
    vy: SUPPLY_DROP_FALL_SPEED,
    vx: 0,
    state: 'falling', // falling, floating, landed, sunk, collected
    floats,
    age: 0,
    pulse: Math.random() * Math.PI * 2,
    landedIsland: null,
  };
}

function collectSupply(sub) {
  const refillTorpedo = 6;
  const refillMissile = 3;
  const refillDepthCharge = 2;
  sub.torpedoAmmo = Math.min(START_TORPEDOES, sub.torpedoAmmo + refillTorpedo);
  sub.missileAmmo = Math.min(START_MISSILES, sub.missileAmmo + refillMissile);
  sub.depthChargeAmmo = Math.min(START_DEPTH_CHARGES, sub.depthChargeAmmo + refillDepthCharge);
  world.caveMessage = { text: 'SUPPLY COLLECTED', timer: 80 };
  SFX.embark();
}

function updateAmmoStations(world, dt) {
  // Spawn new supply drops periodically
  if (!world.supplyDropTimer) world.supplyDropTimer = SUPPLY_DROP_INTERVAL * 0.3;
  world.supplyDropTimer -= dt;
  if (world.supplyDropTimer <= 0) {
    world.supplyDropTimer = SUPPLY_DROP_INTERVAL + Math.random() * 200;
    world.ammoStations.push(spawnSupplyDrop());
  }

  const sub = world.sub;
  for (let i = world.ammoStations.length - 1; i >= 0; i--) {
    const drop = world.ammoStations[i];
    drop.age += dt;
    drop.pulse += dt * 0.04;

    if (drop.state === 'falling') {
      drop.y += drop.vy * dt;
      drop.vy = Math.min(drop.vy + 0.01 * dt, 1.5);

      // Check if it hit an island
      const hitIsland = islandHitTest(drop.x, drop.y);
      const groundY = getGroundY(drop.x);

      if (drop.y >= WATER_LINE && !hitIsland) {
        if (drop.floats) {
          drop.state = 'floating';
          drop.y = WATER_LINE - 4;
          drop.vy = 0;
        } else {
          drop.state = 'sinking';
          drop.vy = 0.3;
        }
      } else if (hitIsland || drop.y >= groundY - 6) {
        drop.state = 'landed';
        drop.y = Math.min(drop.y, groundY - 6);
        drop.vy = 0;
      }
    } else if (drop.state === 'floating') {
      // Bob on water
      drop.y = WATER_LINE - 4 + Math.sin(world.tick * 0.05 + drop.pulse) * 2;
      drop.x += drop.vx * dt;
      drop.vx *= 0.98;

      // Sub slow contact = collect, fast = push
      if (!sub.disembarked) {
        const dist = Math.hypot(sub.worldX - drop.x, sub.y - drop.y);
        if (dist < SUPPLY_DROP_COLLECT_RADIUS) {
          const speed = Math.hypot(sub.vx, sub.vy);
          if (speed < SUPPLY_DROP_PUSH_SPEED) {
            collectSupply(sub);
            drop.state = 'collected';
          } else {
            // Push it away
            const dx = drop.x - sub.worldX;
            drop.vx += (dx > 0 ? 1 : -1) * speed * 0.3;
          }
        }
      }
    } else if (drop.state === 'sinking') {
      drop.y += drop.vy * dt;
      drop.vy *= 0.995;
      const groundY = getGroundY(drop.x);
      if (drop.y >= groundY - 6) {
        drop.state = 'sunk';
        drop.y = groundY - 6;
      }
    } else if (drop.state === 'sunk') {
      // Diver can pick it up with F
      if (sub.disembarked && sub.diverMode) {
        const dist = Math.hypot(sub.pilotX - drop.x, sub.pilotY - drop.y);
        if (dist < 30 && (keyJustPressed['f'] || keyJustPressed['F'])) {
          collectSupply(sub);
          drop.state = 'collected';
        }
      }
    } else if (drop.state === 'landed') {
      // Pilot on foot can pick up with F
      if (sub.disembarked && !sub.diverMode) {
        const dist = Math.hypot(sub.pilotX - drop.x, sub.pilotY - drop.y);
        if (dist < 30 && (keyJustPressed['f'] || keyJustPressed['F'])) {
          collectSupply(sub);
          drop.state = 'collected';
        }
      }
    }

    // Remove collected or very old drops
    if (drop.state === 'collected' || drop.age > 3000) {
      world.ammoStations.splice(i, 1);
    }
  }
}

function drawAmmoStations(world) {
  for (const drop of world.ammoStations) {
    if (drop.state === 'collected') continue;
    const sx = toScreen(drop.x);
    const sy = drop.y;
    ctx.save();

    // Parachute (while falling)
    if (drop.state === 'falling') {
      ctx.strokeStyle = '#ecf0f1';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(sx, sy - 6);
      ctx.lineTo(sx - 12, sy - SUPPLY_DROP_PARACHUTE_HEIGHT);
      ctx.lineTo(sx + 12, sy - SUPPLY_DROP_PARACHUTE_HEIGHT);
      ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.fill();
      // Canopy arc
      ctx.beginPath();
      ctx.arc(sx, sy - SUPPLY_DROP_PARACHUTE_HEIGHT, 14, Math.PI, 0);
      ctx.fillStyle = 'rgba(220, 38, 38, 0.5)';
      ctx.fill();
      ctx.strokeStyle = '#dc2626';
      ctx.stroke();
    }

    // Crate body
    const glow = drop.state === 'floating' ? 0.7 + 0.3 * Math.sin(world.tick * 0.08 + drop.pulse) : 0.8;
    ctx.globalAlpha = glow;
    ctx.fillStyle = '#92400e';
    ctx.fillRect(sx - 8, sy - 6, 16, 12);
    ctx.strokeStyle = '#78350f';
    ctx.lineWidth = 1;
    ctx.strokeRect(sx - 8, sy - 6, 16, 12);
    // Cross strapping
    ctx.strokeStyle = '#d4a053';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx - 8, sy - 6); ctx.lineTo(sx + 8, sy + 6);
    ctx.moveTo(sx + 8, sy - 6); ctx.lineTo(sx - 8, sy + 6);
    ctx.stroke();
    // Pickup hint when in range
    if ((drop.state === 'landed' || drop.state === 'sunk') && world.sub.disembarked) {
      const dist = Math.hypot(world.sub.pilotX - drop.x, world.sub.pilotY - drop.y);
      if (dist < 40) {
        ctx.fillStyle = '#fcd34d';
        ctx.font = '10px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('[F] PICKUP', sx, sy - 14);
      }
    }

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
    const seaFloorY = groundYFromTerrain(terrain, x);
    // Chain length varies — mines float at different depths
    const chainLen = 30 + Math.random() * 80;
    const anchorY = seaFloorY - 4;
    const floatY = Math.max(WATER_LINE + 12, anchorY - chainLen);
    mines.push({
      x, y: floatY,
      anchorY,
      chainLength: chainLen,
      swayPhase: Math.random() * Math.PI * 2,
      swaySpeed: 0.015 + Math.random() * 0.015,
      swayAmplitude: 3 + Math.random() * 5,
      active: true,
      pulse: Math.random() * Math.PI * 2,
      chainCut: false,
      freed: false,
      floatVy: 0,
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
    mine.swayPhase += mine.swaySpeed * dt;

    // --- Freed mine: floating upward ---
    if (mine.freed) {
      mine.floatVy = Math.max(-1.2, mine.floatVy - 0.02 * dt); // Accelerate upward
      mine.y += mine.floatVy * dt;
      mine.x += Math.sin(mine.swayPhase) * 0.1 * dt; // Slight lateral drift

      // Hit sub — lethal
      const subDist = Math.hypot(sub.worldX - mine.x, sub.y - mine.y);
      if (subDist < MINE_RADIUS + 12) {
        triggerMine(world, mine);
        sub.parts.hull = 0; // Instant kill
        world.caveMessage = { text: 'MINE IMPACT — HULL DESTROYED', timer: 200 };
        continue;
      }

      // Reached surface — check for ships and islands
      if (mine.y <= WATER_LINE + 2) {
        mine.y = WATER_LINE + 2;
        let hitSomething = false;

        // Hit destroyer
        const dest = world.terrain.destroyer;
        if (dest && !dest.destroyed && Math.abs(mine.x - dest.x) < 50) {
          dest.hp = 0; dest.destroyed = true;
          addExplosion(dest.x, dest.y, 'big');
          addExplosion(dest.x + 20, dest.y - 5, 'big');
          addParticles(dest.x, dest.y, 30, '#e74c3c');
          world.score += 2000; world.kills++;
          world.caveMessage = { text: 'MINE DESTROYED THE DESTROYER!', timer: 150 };
          SFX.enemyDestroyed();
          hitSomething = true;
        }

        // Hit passenger ship
        const pass = world.terrain.passengerShip;
        if (!hitSomething && pass && !pass.destroyed && Math.abs(mine.x - pass.x) < 40) {
          pass.hp = 0; pass.destroyed = true;
          addExplosion(pass.x, pass.y, 'big');
          addParticles(pass.x, pass.y, 20, '#ecf0f1');
          world.score = 0;
          world.caveMessage = { text: 'FREED MINE HIT CIVILIAN SHIP — SCORE ZERO', timer: 250 };
          SFX.gameOver();
          hitSomething = true;
        }

        // Hit interceptor boats
        if (!hitSomething) {
          for (const boat of (world.terrain.interceptors || [])) {
            if (boat.destroyed) continue;
            if (Math.abs(mine.x - boat.x) < 25) {
              boat.hp = 0; boat.destroyed = true;
              addExplosion(boat.x, boat.y, 'big');
              addParticles(boat.x, boat.y, 15, '#556b2f');
              world.score += 400; world.kills++;
              SFX.enemyDestroyed();
              hitSomething = true;
              break;
            }
          }
        }

        // Hit island (explodes against it)
        if (!hitSomething && islandHitTest(mine.x, mine.y - 5)) {
          hitSomething = true;
          world.caveMessage = { text: 'MINE DETONATED AGAINST ISLAND', timer: 80 };
        }

        // Detonate at surface regardless
        triggerMine(world, mine);
        continue;
      }
      continue; // Skip normal mine logic for freed mines
    }

    // --- Chain cutting: torpedoes can hit the chain in the thermocline ---
    if (!mine.chainCut) {
      for (const torp of world.torpedoes) {
        if (!torp.fromSub || !torp.active) continue;
        // Chain runs from mine.y down to mine.anchorY
        // Check if torpedo is near the chain's x position and between mine.y and anchorY
        if (Math.abs(torp.worldX - mine.x) < 8
            && torp.y > mine.y + MINE_RADIUS
            && torp.y < mine.anchorY - 5) {
          // Cut the chain!
          mine.chainCut = true;
          mine.freed = true;
          mine.floatVy = -0.3;
          torp.life = 0;
          addParticles(mine.x, torp.y, 8, '#888');
          world.caveMessage = { text: 'MINE CHAIN CUT — MINE RISING!', timer: 100 };
          SFX.explodeSmall();
          break;
        }
      }
    }

    // --- Normal mine behaviour (still chained) ---
    const dist = Math.hypot(sub.worldX - mine.x, sub.y - mine.y);
    if (dist < MINE_RADIUS + 12 && thermallyVisible(sub.y, mine.y)) {
      triggerMine(world, mine);
      sub.parts.hull = 0; // Mines are lethal
      world.caveMessage = { text: 'MINE IMPACT — HULL DESTROYED', timer: 200 };
      continue;
    }
    // Torpedoes hitting the mine body directly
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
    // Thermal layer visibility
    if (!thermallyVisible(world.sub.y, mine.y)) continue;
    const swayOffset = Math.sin(mine.swayPhase) * mine.swayAmplitude;
    const sx = toScreen(mine.x) + swayOffset;
    const sy = mine.y;
    const anchorSx = toScreen(mine.x);
    const anchorSy = mine.anchorY;
    ctx.save();

    if (!mine.chainCut) {
      // Chain links from anchor to mine
      ctx.strokeStyle = '#555';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(anchorSx, anchorSy);
      ctx.quadraticCurveTo(anchorSx + swayOffset * 0.5, (anchorSy + sy) / 2, sx, sy + MINE_RADIUS);
      ctx.stroke();
      ctx.setLineDash([]);

      // Anchor weight on seafloor
      ctx.fillStyle = '#444';
      ctx.fillRect(anchorSx - 4, anchorSy - 2, 8, 4);
    } else {
      // Dangling chain stub from mine
      ctx.strokeStyle = '#555';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(sx, sy + MINE_RADIUS);
      ctx.lineTo(sx + Math.sin(world.tick * 0.04) * 3, sy + MINE_RADIUS + 15);
      ctx.stroke();
      ctx.setLineDash([]);
      // Rising bubbles
      if (mine.freed) {
        ctx.fillStyle = 'rgba(133, 193, 233, 0.3)';
        for (let b = 0; b < 3; b++) {
          ctx.beginPath();
          ctx.arc(sx + (Math.random() - 0.5) * 8, sy + MINE_RADIUS + 5 + b * 6, 1.5, 0, TWO_PI);
          ctx.fill();
        }
      }
    }

    // Mine body — dark spherical with spikes
    ctx.fillStyle = MINE_COLOR;
    ctx.beginPath();
    ctx.arc(sx, sy, MINE_RADIUS, 0, TWO_PI);
    ctx.fill();
    ctx.strokeStyle = '#4a0808';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Contact horns (spikes)
    ctx.fillStyle = '#aa2222';
    for (let h = 0; h < 6; h++) {
      const ha = h * Math.PI / 3 + mine.pulse * 0.1;
      const hx = sx + Math.cos(ha) * (MINE_RADIUS + 4);
      const hy = sy + Math.sin(ha) * (MINE_RADIUS + 4);
      ctx.beginPath();
      ctx.arc(hx, hy, 3, 0, TWO_PI);
      ctx.fill();
    }

    // Pulsing danger glow
    ctx.globalAlpha = 0.2 + 0.15 * Math.sin(world.tick * 0.03 + mine.pulse);
    ctx.strokeStyle = '#ff3333';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sx, sy, MINE_RADIUS + 6 + Math.sin(world.tick * 0.05 + mine.pulse) * 3, 0, TWO_PI);
    ctx.stroke();

    ctx.restore();
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
function getSpeedMult(parts)   {
  if (parts.engine <= 0) return 0.4;
  if (isPartCritical(parts, 'engine')) return 0.55; // Extra slowdown at critical
  return 1;
}
function getThrustMult(parts)  { return parts.wings > 0 ? 1 : 0.5; }
function getTurnMult(parts)    { return parts.rudder > 0 ? 1 : 0.3; }

function isPartCritical(parts, partId) {
  const def = SUB_PARTS.find((p) => p.id === partId);
  if (!def) return false;
  return parts[partId] > 0 && parts[partId] / def.maxHp < 0.05;
}

function isPartRed(parts, partId) {
  const def = SUB_PARTS.find((p) => p.id === partId);
  if (!def) return false;
  return parts[partId] > 0 && parts[partId] / def.maxHp < 0.25;
}

function anyPartCritical(parts) {
  return SUB_PARTS.some((def) => parts[def.id] > 0 && parts[def.id] / def.maxHp < 0.05);
}

function anyPartRed(parts) {
  return SUB_PARTS.some((def) => parts[def.id] > 0 && parts[def.id] / def.maxHp < 0.25);
}

function isEngineCritical(parts) { return isPartCritical(parts, 'engine'); }
function isHullCritical(parts) { return isPartCritical(parts, 'hull'); }
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

// ============================================================
// KEY BINDINGS — configurable, saved to localStorage
// ============================================================
const KEYBIND_STORAGE_KEY = 'ass_keybindings';
const DEFAULT_KEYBINDS = {
  torpedo:      'Control',
  missile:      'Enter',
  depthCharge:  'AltGraph',
  afterburner:  'a',
  periscope:    'p',
  disembark:    'e',
  embark:       'm',
  emergencyEject: 'Tab',
  chaff:        'c',
  orbitMenu:    'f',
  cruise:       ' ',
  pause:        'Escape',
  pickup:       'f',
};

let keybinds = { ...DEFAULT_KEYBINDS };

function loadKeybinds() {
  try {
    const raw = window.localStorage.getItem(KEYBIND_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      keybinds = { ...DEFAULT_KEYBINDS, ...parsed };
    }
  } catch {
    keybinds = { ...DEFAULT_KEYBINDS };
  }
}

function saveKeybinds() {
  try {
    window.localStorage.setItem(KEYBIND_STORAGE_KEY, JSON.stringify(keybinds));
  } catch {
    // Ignore storage failures
  }
}

function resetKeybinds() {
  keybinds = { ...DEFAULT_KEYBINDS };
  saveKeybinds();
}

function keyMatchesAction(action) {
  const bound = keybinds[action];
  if (!bound) return false;
  return !!keys[bound] || !!keys[bound.toUpperCase()] || !!keys[bound.toLowerCase()];
}

function keyJustMatchesAction(action) {
  const bound = keybinds[action];
  if (!bound) return false;
  return !!keyJustPressed[bound] || !!keyJustPressed[bound.toUpperCase()] || !!keyJustPressed[bound.toLowerCase()];
}

loadKeybinds();

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
  // Space tourist ship — travels between planets
  const touristFromIdx = Math.floor(Math.random() * (SOLAR_SYSTEM_BODIES.length - 1)) + 1;
  let touristToIdx = touristFromIdx;
  while (touristToIdx === touristFromIdx) touristToIdx = Math.floor(Math.random() * (SOLAR_SYSTEM_BODIES.length - 1)) + 1;
  const fromBody = solarBodyPosition(SOLAR_SYSTEM_BODIES[touristFromIdx], 0);
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
    autopilotTarget: null,
    touristShip: {
      x: fromBody.x, y: fromBody.y,
      fromPlanetIdx: touristFromIdx,
      toPlanetIdx: touristToIdx,
      progress: 0,       // 0 to 1 along route
      speed: 0.0008,
      visible: true,
      dwellTimer: 0,
    },
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

// ============================================================
// HANGAR SYSTEM
// ============================================================
function hangarHealthLevel(port) {
  if (port.destroyed) return 'destroyed';
  const pct = port.hp / HANGAR_MAX_HP;
  if (pct > HANGAR_GREEN_THRESHOLD) return 'green';
  if (pct > HANGAR_YELLOW_THRESHOLD) return 'yellow';
  if (pct > HANGAR_RED_THRESHOLD) return 'red';
  return 'purple';
}

function isSubInsideHangar(sub, port) {
  if (port.destroyed) return false;
  return Math.abs(sub.worldX - port.x) < HANGAR_PROTECT_RADIUS
    && sub.y > WATER_LINE - 30 && sub.y < WATER_LINE + 10;
}

// ============================================================
// MISSION TIMER
// ============================================================
function startMission(typeKey) {
  const def = MISSION_TYPES[typeKey] || MISSION_TYPES.patrol;
  world.mission = {
    type: typeKey,
    label: def.label,
    timed: def.timed || false,
    mandatory: def.mandatory || false,
    timer: def.duration || 0,
    active: true,
    failed: false,
  };
  if (def.timed) {
    world.caveMessage = { text: `MISSION: ${def.label} — ${Math.round(def.duration / 60)}s`, timer: 120 };
  }
}

function updateMissionTimer(dt) {
  const m = world.mission;
  if (!m || !m.active || !m.timed) return;
  m.timer -= dt;
  if (m.timer <= 0) {
    m.timer = 0;
    m.failed = true;
    m.active = false;
    if (m.mandatory) {
      world.caveMessage = { text: `MISSION FAILED: ${m.label} — TIME EXPIRED`, timer: 200 };
      world.gameOver = true;
      SFX.gameOver();
    } else {
      world.caveMessage = { text: `TIME EXPIRED: ${m.label} — bonus lost`, timer: 150 };
    }
  }
}

function drawMissionTimer() {
  const m = world.mission;
  if (!m || !m.active || !m.timed) return;
  const secs = Math.ceil(m.timer / 60);
  const mins = Math.floor(secs / 60);
  const s = secs % 60;
  const timeStr = `${mins}:${s < 10 ? '0' : ''}${s}`;
  const urgent = secs <= 30;

  ctx.fillStyle = urgent ? 'rgba(180,0,0,0.7)' : 'rgba(0,0,0,0.5)';
  ctx.fillRect(W / 2 - 60, 6, 120, 28);
  ctx.strokeStyle = urgent ? '#ff4444' : 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 1;
  ctx.strokeRect(W / 2 - 60, 6, 120, 28);

  ctx.fillStyle = urgent ? (world.tick % 12 < 6 ? '#ff4444' : '#ff8888') : '#ecf0f1';
  ctx.font = 'bold 16px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.fillText(timeStr, W / 2, 26);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '9px Arial';
  ctx.fillText(m.label, W / 2, 38);
}

// ============================================================
// COMMANDER GUN POST
// ============================================================
function setupGunPost(sub) {
  world.gunPost = {
    x: sub.pilotX,
    y: sub.pilotY,
    mgCooldown: 0,
  };
  world.caveMessage = { text: 'GUN POST ESTABLISHED — MOUSE TO AIM, CLICK TO FIRE', timer: 100 };
}

function dismantleGunPost() {
  world.gunPost = null;
  world.caveMessage = { text: 'GUN POST DISMANTLED', timer: 60 };
}

function updateGunPost(dt) {
  const gp = world.gunPost;
  if (!gp) return;
  const sub = world.sub;

  // Commander stays at the gun post
  sub.pilotX = gp.x;
  sub.pilotVx = 0;

  gp.mgCooldown = Math.max(0, gp.mgCooldown - dt);

  // Fire on mouse click
  if (mouse.down && gp.mgCooldown <= 0) {
    const angle = Math.atan2(
      mouse.y + world.cameraY - gp.y,
      mouse.worldX - gp.x
    );
    world.gunPostBullets.push({
      x: gp.x + Math.cos(angle) * 8,
      y: gp.y - 4 + Math.sin(angle) * 8,
      vx: Math.cos(angle) * GUN_POST_MG_SPEED,
      vy: Math.sin(angle) * GUN_POST_MG_SPEED,
      life: GUN_POST_BULLET_LIFE,
    });
    gp.mgCooldown = GUN_POST_MG_COOLDOWN;
    SFX.torpedoLaunch();
  }

  // Dismantle with G again
  if (keyJustPressed['g'] || keyJustPressed['G']) {
    dismantleGunPost();
    return;
  }

  // Update bullets
  world.gunPostBullets = world.gunPostBullets.filter((b) => {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.vy += GRAVITY * 0.15 * dt; // Slight drop
    b.life -= dt;

    // Hit enemies
    for (let i = world.enemies.length - 1; i >= 0; i--) {
      const e = world.enemies[i];
      if (Math.abs(b.x - e.worldX) < 15 && Math.abs(b.y - e.y) < 12) {
        e.health -= GUN_POST_MG_DAMAGE;
        addParticles(e.worldX, e.y, 2, '#fbbf24');
        if (e.health <= 0) {
          addExplosion(e.worldX, e.y, 'big');
          world.score += 180;
          world.kills++;
          world.enemies.splice(i, 1);
          SFX.enemyDestroyed();
        }
        return false;
      }
    }

    // Hit interceptor boats
    for (const boat of (world.terrain.interceptors || [])) {
      if (boat.destroyed) continue;
      if (Math.abs(b.x - boat.x) < 15 && Math.abs(b.y - boat.y) < 10) {
        boat.hp -= GUN_POST_MG_DAMAGE;
        if (boat.hp <= 0) {
          boat.destroyed = true;
          addExplosion(boat.x, boat.y, 'big');
          world.score += 400;
          world.kills++;
          SFX.enemyDestroyed();
        }
        return false;
      }
    }

    return b.life > 0 && Math.abs(b.x - world.cameraX) < W * 2;
  });
}

function drawGunPost() {
  const gp = world.gunPost;
  if (!gp) return;
  const gpx = toScreen(gp.x);
  const gpy = gp.y;

  ctx.save();

  // Sandbag base
  ctx.fillStyle = '#8b7355';
  ctx.beginPath();
  ctx.ellipse(gpx, gpy + 2, 10, 5, 0, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = '#7a6548';
  ctx.beginPath();
  ctx.ellipse(gpx, gpy, 8, 4, 0, 0, Math.PI);
  ctx.fill();

  // MG tripod
  ctx.strokeStyle = '#555';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(gpx - 5, gpy); ctx.lineTo(gpx - 8, gpy + 5); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(gpx + 5, gpy); ctx.lineTo(gpx + 8, gpy + 5); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(gpx, gpy); ctx.lineTo(gpx, gpy + 4); ctx.stroke();

  // Gun barrel — aims toward mouse
  const angle = Math.atan2(
    mouse.y + world.cameraY - gpy,
    mouse.worldX - gp.x
  );
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(gpx, gpy - 2);
  ctx.lineTo(gpx + Math.cos(angle) * 14, gpy - 2 + Math.sin(angle) * 14);
  ctx.stroke();

  // Muzzle flash
  if (gp.mgCooldown > GUN_POST_MG_COOLDOWN * 0.5) {
    ctx.fillStyle = '#fbbf24';
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.arc(gpx + Math.cos(angle) * 16, gpy - 2 + Math.sin(angle) * 16, 3, 0, TWO_PI);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  ctx.restore();

  // Draw bullets
  ctx.fillStyle = '#fbbf24';
  for (const b of world.gunPostBullets) {
    const bx = toScreen(b.x);
    ctx.beginPath(); ctx.arc(bx, b.y, 1.5, 0, TWO_PI); ctx.fill();
  }

  // Crosshair at mouse position
  ctx.strokeStyle = 'rgba(255,200,50,0.5)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(mouse.x - 8, mouse.y); ctx.lineTo(mouse.x + 8, mouse.y);
  ctx.moveTo(mouse.x, mouse.y - 8); ctx.lineTo(mouse.x, mouse.y + 8);
  ctx.stroke();
  ctx.beginPath(); ctx.arc(mouse.x, mouse.y, 6, 0, TWO_PI); ctx.stroke();
}

function updateHangars(dt) {
  const sub = world.sub;
  const hangars = [world.terrain.startPort, world.terrain.endPort];

  for (const port of hangars) {
    if (port.destroyed) continue;

    const level = hangarHealthLevel(port);

    // Enemies that get close damage the hangar
    for (const enemy of world.enemies) {
      const dist = Math.hypot(enemy.worldX - port.x, enemy.y - WATER_LINE);
      if (dist < 120) {
        port.hp = Math.max(0, port.hp - 0.15 * dt);
      }
    }

    // Enemy missiles/torpedoes damage hangar
    for (const torp of world.torpedoes) {
      if (torp.fromSub) continue;
      const dist = Math.hypot(torp.worldX - port.x, torp.y - WATER_LINE);
      if (dist < 40) {
        port.hp = Math.max(0, port.hp - 8);
        torp.life = 0;
        addExplosion(torp.worldX, torp.y, 'small');
      }
    }

    // Point defense (green only): auto-shoot at nearby enemies
    if (level === 'green') {
      port.pointDefenseCooldown = Math.max(0, port.pointDefenseCooldown - dt);
      if (port.pointDefenseCooldown <= 0) {
        for (let i = world.enemies.length - 1; i >= 0; i--) {
          const enemy = world.enemies[i];
          const dist = Math.hypot(enemy.worldX - port.x, enemy.y - WATER_LINE);
          if (dist < HANGAR_POINT_DEFENSE_RANGE) {
            enemy.health -= HANGAR_POINT_DEFENSE_DAMAGE;
            addParticles(enemy.worldX, enemy.y, 3, '#fbbf24');
            if (enemy.health <= 0) {
              addExplosion(enemy.worldX, enemy.y, 'big');
              world.score += 150;
              world.kills++;
              world.enemies.splice(i, 1);
              SFX.enemyDestroyed();
            }
            port.pointDefenseCooldown = HANGAR_POINT_DEFENSE_COOLDOWN;
            break;
          }
        }
      }
    }

    // Sub protection / damage based on hangar health
    if (isSubInsideHangar(sub, port)) {
      if (level === 'green' || level === 'yellow') {
        // Protected: zero out all incoming damage by blocking enemy collision
        // (handled in collision code by checking isSubProtected)
      } else if (level === 'red') {
        // Sub takes environmental damage from failing hangar
        damageRandomPart(sub.parts, HANGAR_RED_DPS * dt);
      }
    }

    // Purple critical: countdown to explosion
    if (level === 'purple') {
      port.criticalTimer += dt;
      if (port.criticalTimer >= HANGAR_CRITICAL_TIMER) {
        port.destroyed = true;
        addExplosion(port.x, WATER_LINE - 10, 'big');
        addExplosion(port.x - 20, WATER_LINE, 'big');
        addExplosion(port.x + 20, WATER_LINE - 5, 'big');
        addParticles(port.x, WATER_LINE - 10, 30, '#ff4444');
        SFX.explodeBig();
        world.caveMessage = { text: `${port.name} DESTROYED`, timer: 150 };
        // Damage sub if inside during explosion
        if (isSubInsideHangar(sub, { ...port, destroyed: false })) {
          damageRandomPart(sub.parts, 60);
          SFX.damage();
        }
      }
    } else {
      port.criticalTimer = 0;
    }
  }
}

function isSubProtected() {
  const sub = world.sub;
  const hangars = [world.terrain.startPort, world.terrain.endPort];
  for (const port of hangars) {
    if (port.destroyed) continue;
    const level = hangarHealthLevel(port);
    if ((level === 'green' || level === 'yellow') && isSubInsideHangar(sub, port)) {
      return true;
    }
  }
  return false;
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
  if (ak.samCooldown <= 0 && sub.y < WATER_LINE - 10 && distToSub < 350 && akulaCanDetect) {
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
  if (ak.torpedoCooldown <= 0 && sub.y > WATER_LINE && distToSub < 300 && akulaCanDetect) {
    const dir = sub.worldX > ak.x ? 1 : -1;
    world.torpedoes.push({
      worldX: ak.x + dir * 20, y: ak.y,
      vx: dir * TORPEDO_SPEED * 0.7, vy: (sub.y - ak.y) * 0.005,
      phase: 'skim', life: 250, trail: [],
      rogue: false, fromSub: false, active: false,
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
      caterpillarDrive: false,
    },
    torpedoes: [],       // All positions in world coords
    missiles: [],
    depthCharges: [],
    enemies: [],
    explosions: [],
    particles: [],
    terrain,
    ammoStations: [],
    supplyDropTimer: SUPPLY_DROP_INTERVAL * 0.3,
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
    menuOpen: false,
    thrustSoundTimer: 0,
    ejectPrimeTimer: 0,
    divingBell: null,
    airEject: null,
    gunPost: null,
    gunPostBullets: [],
    subInCave: null,     // Reference to cave the sub is hiding in
    mission: { type: 'patrol', timer: 0, active: false, failed: false },
    // WASM co-processor (AffineScript physics kernel, airborne-final-working.wasm).
    // Populated asynchronously by init() after the module loads.
    wasm: null,
    wasmState: null,    // 29-element flat snapshot from last step_state call
    wasmTick: undefined,
    wasmScore: undefined,
    wasmKills: undefined,
  };
}

let world = null;

async function init() {
  canvas.width = W; canvas.height = H; canvas.focus();
  world = initWorld();

  // --- Load AffineScript WASM physics co-processor ---
  // The WASM exports init_state() and step_state(...34 args) which model a
  // simplified version of the game world (sub, weapons, 2 projectiles, 2 enemies).
  // We run it in lockstep with the JS simulation as a verified frame counter
  // and secondary score tracker.  Resolve the path relative to this script
  // file so the fetch works whether the page is served from repo root
  // (index.html → gossamer/app_gossamer.js) or from gossamer/ directly.
  const _wasmUrl = (() => {
    const scriptSrc = document.currentScript && document.currentScript.src;
    if (scriptSrc) {
      // script is at <repo>/gossamer/app_gossamer.js; WASM is at <repo>/build/
      return new URL('../build/airborne-final-working.wasm', scriptSrc).href;
    }
    return '../build/airborne-final-working.wasm'; // fallback (direct open)
  })();
  try {
    const resp = await fetch(_wasmUrl);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const buf = await resp.arrayBuffer();
    const { instance } = await WebAssembly.instantiate(buf, {
      // Provide a no-op fd_write stub — the WASM only uses it for println().
      wasi_snapshot_preview1: { fd_write: () => 0 },
    });
    world.wasm = instance.exports;
    // init_state() returns a pointer to a [tag, len=29, ...fields] array in
    // WASM linear memory.  Slice off the two-word header to get 29 state fields.
    const ptr = world.wasm.init_state();
    const view = new DataView(world.wasm.memory.buffer);
    world.wasmState = Array.from({ length: 31 }, (_, i) => view.getInt32(ptr + i * 4, true)).slice(2);
    console.info('[ASS] WASM co-processor ready — init_state ptr:', ptr);
  } catch (e) {
    world.wasm = null;
    console.warn('[ASS] WASM co-processor unavailable:', e.message);
  }

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

function saveGameState() {
  try {
    const snapshot = {
      version: 1,
      timestamp: Date.now(),
      mode: world.mode,
      currentPlanet: world.currentPlanet,
      score: world.score,
      kills: world.kills,
      sub: {
        worldX: world.sub.worldX,
        y: world.sub.y,
        vx: world.sub.vx,
        vy: world.sub.vy,
        angle: world.sub.angle,
        facing: world.sub.facing,
        torpedoAmmo: world.sub.torpedoAmmo,
        missileAmmo: world.sub.missileAmmo,
        depthChargeAmmo: world.sub.depthChargeAmmo,
        afterburnerCharge: world.sub.afterburnerCharge,
        parts: world.sub.parts,
      },
    };
    window.localStorage.setItem('ass_save_state', JSON.stringify(snapshot));
    world.caveMessage = { text: 'Game saved', timer: 90 };
    return true;
  } catch {
    world.caveMessage = { text: 'Save failed — storage unavailable', timer: 120 };
    return false;
  }
}

function loadGameState() {
  try {
    const raw = window.localStorage.getItem('ass_save_state');
    if (!raw) {
      world.caveMessage = { text: 'No saved game found', timer: 90 };
      return false;
    }
    const snapshot = JSON.parse(raw);
    if (!snapshot || snapshot.version !== 1) {
      world.caveMessage = { text: 'Save data incompatible', timer: 90 };
      return false;
    }
    // Restore into a fresh world to avoid stale references
    const fresh = initWorld();
    fresh.mode = snapshot.mode || 'atmosphere';
    fresh.currentPlanet = snapshot.currentPlanet || 0;
    fresh.planetPalette = PLANETS[fresh.currentPlanet];
    fresh.currentDestination = PLANET_DESTINATIONS[fresh.currentPlanet];
    fresh.score = snapshot.score || 0;
    fresh.kills = snapshot.kills || 0;
    const s = snapshot.sub;
    if (s) {
      fresh.sub.worldX = s.worldX;
      fresh.sub.y = s.y;
      fresh.sub.vx = s.vx;
      fresh.sub.vy = s.vy;
      fresh.sub.angle = s.angle;
      fresh.sub.facing = s.facing;
      fresh.sub.torpedoAmmo = s.torpedoAmmo;
      fresh.sub.missileAmmo = s.missileAmmo;
      fresh.sub.depthChargeAmmo = s.depthChargeAmmo;
      fresh.sub.afterburnerCharge = s.afterburnerCharge;
      if (s.parts) fresh.sub.parts = s.parts;
    }
    world = fresh;
    world.caveMessage = { text: 'Game loaded', timer: 90 };
    return true;
  } catch {
    world.caveMessage = { text: 'Load failed — corrupt save data', timer: 120 };
    return false;
  }
}

function hasSavedGame() {
  try {
    return window.localStorage.getItem('ass_save_state') !== null;
  } catch {
    return false;
  }
}

// Rebind state: null = normal pause, string = waiting for key for that action
let rebindAction = null;
const REBIND_ACTIONS = ['torpedo', 'missile', 'depthCharge', 'afterburner', 'periscope', 'disembark', 'embark', 'emergencyEject', 'chaff', 'cruise'];

function keyLabel(key) {
  if (key === ' ') return 'Space';
  if (key === 'AltGraph') return 'AltGr';
  if (key === 'Control') return 'Ctrl';
  if (key === 'ArrowUp') return 'Up';
  if (key === 'ArrowDown') return 'Down';
  if (key === 'ArrowLeft') return 'Left';
  if (key === 'ArrowRight') return 'Right';
  return key.length === 1 ? key.toUpperCase() : key;
}

function updatePauseMenu() {
  if (!world) return;

  // Rebind mode: next keypress assigns to the action
  if (rebindAction) {
    for (const k in keyJustPressed) {
      if (k === 'Escape') { rebindAction = null; return; }
      keybinds[rebindAction] = k;
      saveKeybinds();
      rebindAction = null;
      return;
    }
    return; // Absorb all input while waiting
  }

  if (keyJustPressed['[']) cycleSubSkin(world.settings, -1);
  if (keyJustPressed[']']) cycleSubSkin(world.settings, 1);
  if (keyJustPressed[',']) adjustCustomHue(world.settings, -12);
  if (keyJustPressed['.']) adjustCustomHue(world.settings, 12);
  if (keyJustPressed['l'] || keyJustPressed['L']) {
    world.settings.showLegend = !world.settings.showLegend;
    saveSettings(world.settings);
  }
  if (keyJustPressed['h'] || keyJustPressed['H']) {
    world.settings.haloParachute = !world.settings.haloParachute;
    saveSettings(world.settings);
  }
  if (keyJustPressed['d'] || keyJustPressed['D']) {
    world.settings.deepDiverKit = !world.settings.deepDiverKit;
    saveSettings(world.settings);
  }
  // Save game
  if (keyJustPressed['s'] || keyJustPressed['S']) {
    saveGameState();
  }
  // Load game
  if (keyJustPressed['o'] || keyJustPressed['O']) {
    if (loadGameState()) {
      world.paused = false;
    }
  }
  // Restart (new game)
  if (keyJustPressed['n'] || keyJustPressed['N']) {
    world = initWorld();
  }
  // Quit / return to splash
  if (keyJustPressed['q'] || keyJustPressed['Q']) {
    world = initWorld();
    world.paused = true;
    world.gameOver = true;
  }
  // Enter rebind mode: press R then a number
  if (keyJustPressed['r'] || keyJustPressed['R']) {
    world.caveMessage = { text: 'REBIND: press 0-9 to select action, then new key', timer: 180 };
  }
  // Number keys select action to rebind (while in pause)
  for (let i = 0; i < REBIND_ACTIONS.length; i++) {
    if (keyJustPressed[String(i)]) {
      rebindAction = REBIND_ACTIONS[i];
      return;
    }
  }
  // Reset all bindings
  if (keyJustPressed['Backspace'] || keyJustPressed['Delete']) {
    resetKeybinds();
    world.caveMessage = { text: 'Key bindings reset to defaults', timer: 90 };
  }
}

function embarkSub(sub) {
  sub.disembarked = false;
  sub.disembarkIsland = null;
  sub.diverMode = false;
  sub.pilotVx = 0;
  sub.pilotVy = 0;
  sub.pilotOnGround = false;
  // Dismantle gun post if active
  if (world.gunPost) {
    world.gunPost = null;
    world.gunPostBullets = [];
  }
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

function attemptDisembark(sub) {
  // Tick down the eject prime timer
  if (world.ejectPrimeTimer > 0) world.ejectPrimeTimer--;

  const wantsE = !!keyJustPressed['e'] || !!keyJustPressed['E'];
  if (!wantsE || sub.disembarked || world.divingBell) return;

  // Double-press: first press primes, second press executes
  if (world.ejectPrimeTimer <= 0) {
    // First press — prime the ejection
    world.ejectPrimeTimer = EJECT_PRIME_TIMEOUT;
    return;
  }

  // Second press within timeout — execute disembark
  world.ejectPrimeTimer = 0;

  if (!isSubStationaryForDiver(sub)) {
    world.caveMessage = { text: 'STABILISE THE SUB TO DEPLOY THE DIVER', timer: 100 };
    return;
  }

  const dock = nearbyIslandForDocking(sub.worldX, sub.y);
  if (dock && sub.floating) {
    deployDockPilot(sub, dock);
    return;
  }

  if (sub.y > WATER_LINE + 8) {
    deployDiver(sub);
    return;
  }

  world.caveMessage = { text: 'DIVER DEPLOYMENT REQUIRES WATER COVER', timer: 100 };
}

function attemptEmbark(sub) {
  const wantsM = !!keyJustPressed['m'] || !!keyJustPressed['M'];
  if (!wantsM || !sub.disembarked) return;
  if (world.divingBell) return; // Cannot return to sub from diving bell
  embarkSub(sub);
}

function emergencyEject(sub) {
  if (!!keyJustPressed['Tab'] && !sub.disembarked && !world.divingBell) {
    if (sub.y > WATER_LINE + 5) {
      // Underwater: deploy diving bell
      // If in deep layer, bell immediately ascends to thermocline
      const inDeepLayer = getThermalLayer(sub.y) === 2;
      const bellStartY = inDeepLayer ? THERMAL_LAYER_2_MAX - 20 : sub.y - 10;
      world.divingBell = {
        x: sub.worldX,
        y: bellStartY,
        vx: 0,
        vy: -0.3,
        age: 0,
      };
      // Sub is abandoned — it sinks and breaks up
      sub.disembarked = true;
      sub.diverMode = false;
      sub.disembarkIsland = null;
      sub.pilotX = sub.worldX;
      sub.pilotY = bellStartY;
      sub.pilotVx = 0;
      sub.pilotVy = 0;
      const msg = inDeepLayer
        ? 'EMERGENCY ASCENT — BELL RISING TO SAFE DEPTH'
        : 'DIVING BELL DEPLOYED — SUB ABANDONED';
      world.caveMessage = { text: msg, timer: 150 };
      SFX.disembark();
    } else {
      // In air: eject commander — sub continues under physics
      const halo = world.settings.haloParachute || false;
      world.airEject = {
        pilotX: sub.worldX,
        pilotY: sub.y - 15,
        pilotVx: sub.vx * 0.2,
        pilotVy: -2.5, // Initial upward ejection burst
        chuteOpen: !halo, // Standard chute opens immediately
        halo,
        hp: COMMANDER_HP,
        landed: false,
        dead: false,
      };
      // Sub is now uncrewed — it will fly on under physics until it crashes
      // Don't set disembarked — the sub physics loop still runs, just no input
      sub.disembarked = false; // Sub is NOT docked — it's flying uncrewed
      world.caveMessage = {
        text: halo ? 'HALO EJECT — CHUTE DEPLOYS LOW' : 'EMERGENCY EJECT — COMMANDER AWAY',
        timer: 150,
      };
      SFX.disembark();
    }
  }
}

function updateAirEject(dt) {
  const ej = world.airEject;
  if (!ej || ej.dead || ej.landed) return;
  const sub = world.sub;

  // Sub continues uncrewed — apply gravity, drag, no input
  // (The normal flight physics still run because disembarked is false,
  //  but we need to suppress input. We do this by checking airEject in input sections.)
  // For now, just apply basic physics to sub as fallback:
  sub.vy += GRAVITY * dt;
  sub.worldX += sub.vx * dt;
  sub.y += sub.vy * dt;
  sub.vx *= 0.998; // Slight air drag
  sub.angle = Math.atan2(sub.vy, Math.abs(sub.vx)) * 0.5; // Nose follows trajectory

  // Sub crash detection
  const groundY = getGroundY(sub.worldX);
  if (sub.y >= groundY - 8) {
    sub.y = groundY - 8;
    // Sub crashes
    sub.parts.hull = 0; sub.parts.engine = 0;
    sub.parts.nose = 0; sub.parts.tail = 0;
    sub.parts.tower = 0; sub.parts.wings = 0; sub.parts.rudder = 0;
    addExplosion(sub.worldX, sub.y, 'big');
    addExplosion(sub.worldX + 15, sub.y - 5, 'big');
    addParticles(sub.worldX, sub.y, 25, '#e74c3c');
    SFX.explodeBig();
  }
  // Sub hits water
  if (sub.y >= WATER_LINE && sub.vy > 0) {
    addParticles(sub.worldX, WATER_LINE, 10, '#85c1e9');
    sub.vy *= 0.3;
  }

  // --- Commander descent ---
  ej.pilotX += ej.pilotVx * dt;
  ej.pilotVx *= 0.995; // Wind drag

  if (ej.halo && !ej.chuteOpen) {
    // HALO: freefall fast
    ej.pilotVy += GRAVITY * 0.6 * dt;
    ej.pilotVy = Math.min(HALO_DESCENT_SPEED, ej.pilotVy);
    // Check if close enough to ground/water to open chute
    const gY = Math.min(WATER_LINE, getGroundY(ej.pilotX));
    if (gY - ej.pilotY < HALO_OPEN_ALTITUDE) {
      ej.chuteOpen = true;
      ej.pilotVy = PARACHUTE_DESCENT_SPEED * 0.5; // Sudden decel
      addParticles(ej.pilotX, ej.pilotY - 10, 4, '#ecf0f1');
    }
  } else {
    // Standard chute or HALO chute now open — gentle descent
    ej.pilotVy = Math.min(ej.pilotVy + 0.02 * dt, PARACHUTE_DESCENT_SPEED);
  }
  ej.pilotY += ej.pilotVy * dt;

  // Landing check
  const pilotGroundY = getGroundY(ej.pilotX);
  if (ej.pilotY >= WATER_LINE - 2) {
    ej.pilotY = WATER_LINE - 2;
    ej.landed = true;
    ej.pilotVy = 0;
    world.caveMessage = { text: 'COMMANDER IN THE WATER — GAME OVER', timer: 200 };
    // Trigger game over after a delay
    world.gameOver = true;
  } else if (ej.pilotY >= pilotGroundY - 4) {
    ej.pilotY = pilotGroundY - 4;
    ej.landed = true;
    ej.pilotVy = 0;
    world.caveMessage = { text: 'COMMANDER LANDED — GAME OVER', timer: 200 };
    world.gameOver = true;
  }

  // Enemy fire can kill the commander during descent
  for (const enemy of world.enemies) {
    const dist = Math.hypot(enemy.worldX - ej.pilotX, enemy.y - ej.pilotY);
    // Enemies take potshots at the descending commander
    if (dist < 120 && !ej.dead && Math.random() < (ej.chuteOpen ? 0.008 : 0.002) * dt) {
      ej.hp--;
      addParticles(ej.pilotX, ej.pilotY, 3, '#e74c3c');
      if (ej.hp <= 0) {
        ej.dead = true;
        world.caveMessage = { text: 'COMMANDER KIA', timer: 200 };
        world.gameOver = true;
        SFX.damage();
      }
    }
  }

  // Camera follows commander
  const targetCamX = ej.pilotX - W * 0.4;
  world.cameraX += (targetCamX - world.cameraX) * 0.05 * dt;
}

function drawAirEject() {
  const ej = world.airEject;
  if (!ej) return;
  if (ej.dead) {
    // Dead commander marker
    const px = toScreen(ej.pilotX);
    ctx.fillStyle = '#e74c3c';
    ctx.font = '10px Arial'; ctx.textAlign = 'center';
    ctx.fillText('X', px, ej.pilotY - 5);
    return;
  }
  if (ej.landed) return;

  const px = toScreen(ej.pilotX);
  const py = ej.pilotY;

  ctx.save();

  // Parachute canopy (when open)
  if (ej.chuteOpen) {
    const canopyW = ej.halo ? 14 : 20; // HALO chute is smaller
    const canopyH = ej.halo ? 8 : 14;
    const lineLen = ej.halo ? 12 : 18;
    // Canopy
    ctx.fillStyle = ej.halo ? 'rgba(30,30,30,0.7)' : 'rgba(255,255,255,0.65)';
    ctx.beginPath();
    ctx.arc(px, py - lineLen - canopyH / 2, canopyW / 2, Math.PI, 0);
    ctx.fill();
    // HALO canopy has a dark tactical colour
    if (!ej.halo) {
      // Standard chute: red/white panels
      ctx.strokeStyle = '#dc2626';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px, py - lineLen - canopyH); ctx.lineTo(px, py - lineLen);
      ctx.stroke();
    }
    // Lines
    ctx.strokeStyle = '#aaa';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(px - canopyW / 2, py - lineLen); ctx.lineTo(px, py - 4);
    ctx.moveTo(px + canopyW / 2, py - lineLen); ctx.lineTo(px, py - 4);
    ctx.moveTo(px, py - lineLen - canopyH / 2); ctx.lineTo(px, py - 4);
    ctx.stroke();
  } else {
    // Freefall — no chute, just the commander tumbling
    // Small motion lines
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1;
    for (let l = 0; l < 3; l++) {
      ctx.beginPath();
      ctx.moveTo(px + (Math.random() - 0.5) * 8, py - 8 - l * 5);
      ctx.lineTo(px + (Math.random() - 0.5) * 8, py - 12 - l * 5);
      ctx.stroke();
    }
  }

  // Commander body
  // Head
  ctx.fillStyle = '#f0c8a0';
  ctx.beginPath(); ctx.arc(px, py - 8, 3, 0, TWO_PI); ctx.fill();
  // Helmet
  ctx.fillStyle = '#2d5a27';
  ctx.beginPath(); ctx.arc(px, py - 9, 3, Math.PI, 0); ctx.fill();
  // Body (flight suit)
  ctx.fillStyle = '#3a5a34';
  ctx.fillRect(px - 3, py - 5, 6, 8);
  // Arms (spread if chute open, tucked if freefall)
  ctx.strokeStyle = '#3a5a34';
  ctx.lineWidth = 2;
  if (ej.chuteOpen) {
    ctx.beginPath(); ctx.moveTo(px - 3, py - 3); ctx.lineTo(px - 8, py - 6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(px + 3, py - 3); ctx.lineTo(px + 8, py - 6); ctx.stroke();
  } else {
    ctx.beginPath(); ctx.moveTo(px - 3, py - 2); ctx.lineTo(px - 6, py + 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(px + 3, py - 2); ctx.lineTo(px + 6, py + 2); ctx.stroke();
  }
  // Legs
  ctx.beginPath(); ctx.moveTo(px - 2, py + 3); ctx.lineTo(px - 3, py + 9); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(px + 2, py + 3); ctx.lineTo(px + 3, py + 9); ctx.stroke();

  // HP indicator (small dots)
  for (let h = 0; h < ej.hp; h++) {
    ctx.fillStyle = '#2ecc71';
    ctx.beginPath(); ctx.arc(px - 5 + h * 5, py - 15, 2, 0, TWO_PI); ctx.fill();
  }

  ctx.restore();
}

function updateDivingBell(dt) {
  const bell = world.divingBell;
  if (!bell) return;
  bell.age += dt;

  // Slow rise then stabilise
  const moveX = (keys['ArrowRight'] ? 1 : 0) - (keys['ArrowLeft'] ? 1 : 0);
  const moveY = (keys['ArrowDown'] ? 1 : 0) - (keys['ArrowUp'] ? 1 : 0);
  bell.vx = moveX * DIVING_BELL_SPEED;
  bell.vy = moveY * DIVING_BELL_SPEED;
  bell.x += bell.vx * dt;
  bell.y += bell.vy * dt;
  // Keep in water — deep layer restricted without kit
  const bellMaxDepth = world.settings.deepDiverKit
    ? getGroundY(bell.x) - 15
    : Math.min(getGroundY(bell.x) - 15, THERMAL_LAYER_2_MAX - 5);
  bell.y = Math.max(WATER_LINE + 5, Math.min(bellMaxDepth, bell.y));

  // Update pilot position to match bell
  world.sub.pilotX = bell.x;
  world.sub.pilotY = bell.y;

  // Sub sinks and snaps
  const sub = world.sub;
  if (!sub.floating) {
    sub.y += 0.5 * dt; // Sinking
    const groundY = getGroundY(sub.worldX);
    if (sub.y >= groundY - 10) {
      // Hit the bottom — snap in half
      sub.y = groundY - 10;
      if (overallHealth(sub.parts) > 0) {
        sub.parts.hull = 0;
        sub.parts.engine = 0;
        sub.parts.nose = 0;
        sub.parts.tail = 0;
        sub.parts.tower = 0;
        addExplosion(sub.worldX, sub.y, 'big');
        addParticles(sub.worldX, sub.y, 24, '#5d4037');
        world.caveMessage = { text: 'SUB DESTROYED ON IMPACT', timer: 120 };
      }
    }
  }
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

  // Deep layer restriction — needs deep sea diver kit
  const maxDiverDepth = world.settings.deepDiverKit
    ? getGroundY(sub.pilotX) - 10
    : Math.min(getGroundY(sub.pilotX) - 10, THERMAL_LAYER_2_MAX - 5);
  sub.pilotY = clamp(sub.pilotY, WATER_LINE + 14, maxDiverDepth);

  if (!world.settings.deepDiverKit && sub.pilotY >= THERMAL_LAYER_2_MAX - 8
      && moveY > 0 && world.tick % 90 < 2) {
    world.caveMessage = { text: 'DEEP SEA DIVER KIT REQUIRED FOR DEEP WATER', timer: 80 };
  }
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

  // Space bar: immediate full stop
  if (keys[' ']) {
    space.shipVx *= Math.pow(0.85, dt);
    space.shipVy *= Math.pow(0.85, dt);
    if (Math.hypot(space.shipVx, space.shipVy) < 0.01) {
      space.shipVx = 0;
      space.shipVy = 0;
    }
  }

  // Boundary enforcement — cannot fly past Pluto's orbit
  const distFromSun = Math.hypot(space.shipX, space.shipY);
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

  // --- Advance WASM physics co-processor ---
  // Map the current JS key state onto the WASM Input type and call step_state.
  // step_state takes 34 i32 args: 29 state fields (from the previous snapshot)
  // followed by 5 input fields (thrust_x, thrust_y, fire, fire_alt, toggle_env).
  // The return value is a pointer to the updated snapshot in WASM linear memory.
  if (world.wasm && world.wasmState) {
    try {
      const s = world.wasmState;
      const thrustX    = keys['ArrowRight'] ? 1 : keys['ArrowLeft'] ? -1 : 0;
      const thrustY    = keys['ArrowDown']  ? 1 : keys['ArrowUp']   ? -1 : 0;
      const fire       = (keys['Control'] ? 1 : 0);
      const fireAlt    = (keys['Enter']   ? 1 : 0);
      const ptr = world.wasm.step_state(
        ...s,              // 29 state fields
        thrustX, thrustY, fire, fireAlt, 0  // 5 input fields (toggle_env always 0)
      );
      const view = new DataView(world.wasm.memory.buffer);
      world.wasmState  = Array.from({ length: 31 }, (_, i) => view.getInt32(ptr + i * 4, true)).slice(2);
      world.wasmTick   = world.wasmState[0];   // tick counter
      world.wasmScore  = world.wasmState[23];  // score
      world.wasmKills  = world.wasmState[24];  // kills
    } catch (_) { /* non-fatal: JS game continues unaffected */ }
  }

  handleSunBurn(dt);
  const directWarpKey = ['1', '2', '3', '4', '5'].find((k) => keyJustPressed[k]);
  if (directWarpKey && world.mode === 'orbit' && !world.paused) {
    const dest = PLANET_HOTKEY_MAP[directWarpKey];
    startPlanetWarp(dest);
  }
  if ((keyJustPressed['f'] || keyJustPressed['F']) && !world.paused && world.mode === 'orbit') {
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
    if (keyJustPressed['m'] || keyJustPressed['M']) {
      embarkSub(sub);
    }
    if (sub.diverMode) {
      updateDiverMode(sub, dt);
    } else if (sub.disembarkIsland) {
      // Gun post toggle with G
      if ((keyJustPressed['g'] || keyJustPressed['G']) && !world.gunPost) {
        setupGunPost(sub);
      }
      if (world.gunPost) {
        updateGunPost(dt);
        return; // Commander is manning the gun post, skip normal island movement
      }
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
      if (keyJustPressed['ArrowUp'] && sub.pilotOnGround) {
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
  const dropChaff = (keyJustPressed['c'] || keyJustPressed['C']) && !sub.disembarked && !isHullCritical(sub.parts);
  if (dropChaff && world.chaffCooldown <= 0) {
    world.chaffs.push({ x: sub.worldX, y: sub.y - 6, age: 0 });
    world.chaffCooldown = CHAFF_COOLDOWN;
    SFX.waterBob();
  }

  // --- Facing & movement ---
  // When air-ejected, sub flies uncrewed — skip all player input
  if (world.airEject && !world.airEject.landed && !world.airEject.dead) {
    // Sub continues under its own momentum + gravity (handled in updateAirEject)
    // Skip to firing section
  } else if (!sub.periscopeMode) {
    const baseSpdMult = getSpeedMult(sub.parts);
    const spdMult = sub.caterpillarDrive ? baseSpdMult * CATERPILLAR_SPEED_MULT : baseSpdMult;
    const thrMult = getThrustMult(sub.parts);
    const turnMult = getTurnMult(sub.parts);
    const diveInput = keys['ArrowDown'];
    const afterburnerHeld = (keys['a'] || keys['A']) && sub.afterburnerCharge > 0 && sub.y < WATER_LINE - 6 && !isEngineCritical(sub.parts);

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

    // Space bar: cruise (air) / stabilise (water)
    if (keys[' '] && !sub.disembarked) {
      if (sub.y < WATER_LINE - 5 && !sub.floating) {
        // In air: cruise mode — level out angle, hold altitude
        sub.angle *= 0.8;
        sub.vy *= 0.9;
      } else if (sub.y > WATER_LINE || sub.floating) {
        // Underwater / on surface: stabilise — damp all velocity
        sub.vx *= 0.92;
        sub.vy *= 0.92;
        sub.angle *= 0.85;
      }
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
        // Docking is handled by attemptDisembark (E key)
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

  attemptDisembark(sub);
  attemptEmbark(sub);
  emergencyEject(sub);
  updateDivingBell(dt);
  updateAirEject(dt);

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
    if (sub.caterpillarDrive) { sub.caterpillarDrive = false; world.caveMessage = { text: 'STEALTH BROKEN — COLLISION', timer: 60 }; }
  }

  // --- Caterpillar drive toggle (underwater only, requires engine) ---
  if (keyJustPressed['Backspace'] && sub.y > WATER_LINE) {
    if (isEngineCritical(sub.parts)) {
      world.caveMessage = { text: 'ENGINE CRITICAL — CATERPILLAR DRIVE OFFLINE', timer: 80 };
    } else {
      sub.caterpillarDrive = !sub.caterpillarDrive;
      world.caveMessage = {
        text: sub.caterpillarDrive ? 'CATERPILLAR DRIVE ENGAGED — SILENT RUNNING' : 'CATERPILLAR DRIVE DISENGAGED',
        timer: 80,
      };
    }
  }
  // Auto-disengage caterpillar when engine goes critical or leaving water
  if (sub.caterpillarDrive && (sub.y <= WATER_LINE || isEngineCritical(sub.parts))) {
    sub.caterpillarDrive = false;
  }

  // --- Firing ---
  world.fireCooldown = Math.max(0, world.fireCooldown - dt);
  world.missileCooldown = Math.max(0, world.missileCooldown - dt);

  if (keys['Control'] && world.fireCooldown <= 0 && canFireTorpedo(sub.parts) && sub.torpedoAmmo > 0) {
    sub.torpedoAmmo--;
    const isLGT = Math.random() < 0.05;
    const isRogue = !isLGT && Math.random() < 0.1;
    world.torpedoes.push({
      worldX: sub.worldX + sub.facing * 15, y: sub.y + 5,
      vx: sub.vx * 0.5 + sub.facing * 1, vy: isLGT ? 0 : 1.5,
      phase: isLGT ? 'lgt' : 'drop',
      life: isLGT ? 600 : 180,
      trail: [], rogue: isRogue,
      fromSub: true, active: true,
      lgt: isLGT,
      lgtTarget: null,
      lgtOrbitAngle: 0,
      lgtJumpTimer: 0,
    });
    world.fireCooldown = FIRE_COOLDOWN; SFX.torpedoLaunch();
    if (sub.caterpillarDrive) { sub.caterpillarDrive = false; world.caveMessage = { text: 'STEALTH BROKEN — WEAPON FIRED', timer: 60 }; }
    if (isLGT) world.caveMessage = { text: 'LGT TORPEDO DEPLOYED', timer: 50 };
  }

  const surfaceLaunch = sub.floating && !sub.periscopeMode;
  if (keys['Enter'] && world.missileCooldown <= 0 && sub.missileAmmo > 0 && surfaceLaunch) {
    sub.missileAmmo--;
    world.missiles.push({
      worldX: sub.worldX + sub.facing * 10, y: sub.y - 5,
      vx: 0, vy: -2.2,
      phase: 'drop', dropTimer: 12, life: 250, trail: [],
      surfaceLaunch: true,
    });
    world.missileCooldown = FIRE_COOLDOWN * 1.5; SFX.missileLaunch();
    if (sub.caterpillarDrive) { sub.caterpillarDrive = false; world.caveMessage = { text: 'STEALTH BROKEN — WEAPON FIRED', timer: 60 }; }
  }

  if (keyJustPressed['AltGraph'] && world.depthChargeCooldown <= 0 && sub.depthChargeAmmo > 0) {
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
    if (sub.caterpillarDrive) { sub.caterpillarDrive = false; world.caveMessage = { text: 'STEALTH BROKEN — WEAPON FIRED', timer: 60 }; }
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
    if (t.phase === 'lgt') {
      // LGT: surface-skimming torpedo that circles under aircraft
      // Stay on the water surface
      t.y = WATER_LINE - 3 + Math.sin(world.tick * 0.25 + t.worldX * 0.1) * 2;

      // Check for ship hits (destroyer, passenger, interceptor)
      const ships = [];
      const dest = world.terrain.destroyer;
      if (dest && !dest.destroyed) ships.push({ x: dest.x, y: dest.y, ref: dest, type: 'destroyer' });
      const pass = world.terrain.passengerShip;
      if (pass && !pass.destroyed) ships.push({ x: pass.x, y: pass.y, ref: pass, type: 'passenger' });
      for (const boat of (world.terrain.interceptors || [])) {
        if (!boat.destroyed) ships.push({ x: boat.x, y: boat.y, ref: boat, type: 'interceptor' });
      }
      let hitShip = false;
      for (const s of ships) {
        if (Math.abs(t.worldX - s.x) < 30 && Math.abs(t.y - s.y) < 15) {
          addExplosion(t.worldX, t.y, 'big');
          SFX.explodeBig();
          if (s.type === 'destroyer') s.ref.hp -= 25;
          else if (s.type === 'interceptor') s.ref.hp -= 25;
          else if (s.type === 'passenger') s.ref.hp -= 20;
          hitShip = true;
          break;
        }
      }
      if (hitShip) return false;

      // Find nearest air enemy to circle under
      const airTarget = findNearestEnemy(t.worldX, WATER_LINE - 100, 500, e => e.y < WATER_LINE - 20);
      if (airTarget) {
        t.lgtTarget = airTarget;
        // Circle under the aircraft
        t.lgtOrbitAngle += 0.06 * dt;
        const orbitR = 35;
        const targetX = airTarget.worldX + Math.cos(t.lgtOrbitAngle) * orbitR;
        const dx = targetX - t.worldX;
        t.vx += Math.sign(dx) * 0.4 * dt;
        t.vx = Math.max(-TORPEDO_SPEED * 1.3, Math.min(TORPEDO_SPEED * 1.3, t.vx));

        // Jump attempt when aircraft is close overhead
        t.lgtJumpTimer = Math.max(0, t.lgtJumpTimer - dt);
        const distToAir = Math.hypot(airTarget.worldX - t.worldX, airTarget.y - t.y);
        if (distToAir < 60 && t.lgtJumpTimer <= 0) {
          // JUMP! Leap out of water toward aircraft
          t.vy = -3.5;
          t.lgtJumpTimer = 30; // Cooldown between jumps
          addParticles(t.worldX, WATER_LINE, 6, '#85c1e9');
        }

        // When jumping (above water), check for hit
        if (t.y < WATER_LINE - 5) {
          t.vy += GRAVITY * 0.8 * dt; // Arc back down
          if (Math.abs(t.worldX - airTarget.worldX) < 18 && Math.abs(t.y - airTarget.y) < 15) {
            airTarget.health -= 3;
            addExplosion(t.worldX, t.y, 'small');
            SFX.explodeSmall();
            if (airTarget.health <= 0) {
              addExplosion(airTarget.worldX, airTarget.y, 'big');
              world.score += 300;
              world.kills++;
              SFX.enemyDestroyed();
            }
            return false;
          }
          t.worldX += t.vx * dt;
          t.y += t.vy * dt;
          // Fall back to surface
          if (t.y >= WATER_LINE - 3) {
            t.y = WATER_LINE - 3;
            t.vy = 0;
          }
        } else {
          // On surface, just move horizontally
          t.worldX += t.vx * dt;
        }
      } else {
        // No air target — just skim forward hoping to hit something
        t.worldX += t.vx * dt;
        t.vx *= 0.995; // Slight drag
        if (Math.abs(t.vx) < 0.3) t.vx = sub.facing * 0.5; // Keep moving
      }

      // Spray particles while skimming
      if (world.tick % 4 === 0) {
        addParticles(t.worldX, WATER_LINE, 1, '#85c1e9');
      }
    }
    if (t.phase === 'active') {
      // Enemy torpedoes and bazooka rounds — simple ballistic
      t.worldX += t.vx * dt;
      t.y += t.vy * dt;
      if (t.bazooka) t.vy += GRAVITY * 0.5 * dt; // Parabolic arc for bazooka
      // Hit sub check
      if (Math.abs(t.worldX - sub.worldX) < 20 && Math.abs(t.y - sub.y) < 15) {
        damageRandomPart(sub.parts, t.bazooka ? 18 : 12);
        addExplosion(t.worldX, t.y, 'small');
        SFX.damage();
        return false;
      }
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
      // Multi-launch silo: fires salvo of unguided rockets at sub, targets hull
      const angle = Math.atan2(sub.y - r.y, sub.worldX - r.x);
      const rocketCount = 2 + Math.floor(Math.random() * 2); // 2-3 rockets
      for (let b = 0; b < rocketCount; b++) {
        const spread = (b - (rocketCount - 1) / 2) * 0.12;
        world.missiles.push({
          worldX: r.x - 8 + b * 8, y: r.y - 20,
          vx: Math.cos(angle + spread) * 4.5,
          vy: Math.sin(angle + spread) * 4.5,
          phase: 'ignite', dropTimer: 0, life: 120, trail: [],
          fromEnemy: true, rocket: true, // Unguided, targets hull
          targetPart: 'hull',
        });
      }
      r.cooldown = 50; // Slower than MG but more damaging
      SFX.missileLaunch();
    }

    if (r.tier === 3 && r.cooldown <= 0) {
      // Heavy SAM: guided missile that specifically targets cockpit/tower
      const angle = Math.atan2(sub.y - r.y, sub.worldX - r.x);
      world.missiles.push({
        worldX: r.x, y: r.y - 20,
        vx: Math.cos(angle) * 2, vy: -3,
        phase: 'ignite', dropTimer: 0, life: 200, trail: [],
        fromEnemy: true, sam: true,
        targetPart: 'tower', // Specifically targets cockpit
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
      const dmg = m.bullet ? 5 : m.sam ? 15 : m.rocket ? 12 : 10;
      if (m.targetPart && sub.parts[m.targetPart] !== undefined) {
        damageSpecificPart(sub.parts, m.targetPart, dmg);
      } else {
        damageRandomPart(sub.parts, dmg);
      }
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

  // Enemy-sub collision (skip if sub is inside a protected hangar)
  if (!isSubProtected() && !world.subInCave) {
    for (const e of world.enemies) {
      if (Math.abs(e.worldX - sub.worldX) < 25 && Math.abs(e.y - sub.y) < 18) {
        damageRandomPart(sub.parts, 25);
        addExplosion((e.worldX + sub.worldX) / 2, (e.y + sub.y) / 2, 'big');
        SFX.damage(); e.health = 0;
        world.enemies = world.enemies.filter(en => en.health > 0);
        break;
      }
    }
  }

  // Sub cave entrance — enter to hide, periscope from inside
  if (!world.subInCave) {
    for (const cave of world.terrain.caves) {
      if (!cave.subCave) continue;
      if (Math.abs(sub.worldX - cave.x) < cave.w / 2 && Math.abs(sub.y - cave.y) < cave.h / 2
          && Math.hypot(sub.vx, sub.vy) < 1.5) {
        // Labyrinth caves are v3 — can't enter yet
        if (cave.labyrinth) {
          if (world.tick % 120 < 2) {
            world.caveMessage = { text: 'SUBTERRANEAN LABYRINTH — COMING IN v3', timer: 120 };
          }
          continue;
        }
        // Enter the cave
        world.subInCave = cave;
        cave.occupied = true;
        sub.vx = 0; sub.vy = 0;
        sub.y = cave.y + 15; // Below the seabed
        sub.floating = false;
        if (!cave.visited) {
          cave.visited = true;
          world.score += 300;
        }
        world.caveMessage = { text: 'SUB HIDDEN IN SEABED CAVE — Space to stabilise, P for periscope', timer: 150 };
        SFX.disembark();
        break;
      }
    }
  } else {
    // Inside a cave — sub is hidden, immune to detection
    const cave = world.subInCave;
    sub.worldX = cave.x;
    sub.y = cave.y + 15;
    sub.vx = 0; sub.vy = 0;

    // Exit cave with ArrowUp
    if (keys['ArrowUp']) {
      world.subInCave = null;
      cave.occupied = false;
      sub.y = cave.y - cave.h / 2 - 5;
      sub.vy = -1;
      world.caveMessage = { text: 'EXITING CAVE', timer: 60 };
    }
  }

  // Sunken supply packages — diver collects with F
  if (sub.disembarked && sub.diverMode) {
    for (const pkg of world.terrain.sunkenSupplies) {
      if (pkg.collected) continue;
      if (Math.hypot(sub.pilotX - pkg.x, sub.pilotY - pkg.y) < 25
          && (keyJustPressed['f'] || keyJustPressed['F'])) {
        pkg.collected = true;
        collectSupply(sub);
        world.score += 100;
      }
    }

    // Small diver holes — enter with ArrowDown when directly above
    for (const hole of world.terrain.diverHoles) {
      if (hole.explored) continue;
      if (Math.abs(sub.pilotX - hole.x) < 12 && Math.abs(sub.pilotY - hole.y) < 15
          && keys['ArrowDown']) {
        hole.explored = true;
        if (hole.reward === 'mission') {
          hole.explored = false; // Don't consume mission tunnels
          world.caveMessage = { text: 'TRIONIC SUBCOMMANDO — COMING IN v2', timer: 150 };
        } else if (hole.reward === 'ammo') {
          collectSupply(sub);
          world.caveMessage = { text: 'DIVER HOLE: SUPPLY CACHE FOUND', timer: 100 };
        } else if (hole.reward === 'intel') {
          world.score += 400;
          world.caveMessage = { text: 'DIVER HOLE: INTEL RECOVERED (+400)', timer: 100 };
        } else if (hole.reward === 'repair') {
          // Partial hull repair
          sub.parts.hull = Math.min(120, sub.parts.hull + 20);
          world.caveMessage = { text: 'DIVER HOLE: REPAIR KIT FOUND (+20 HULL)', timer: 100 };
        }
        SFX.embark();
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

  // Deep layer hull restriction
  if (!sub.disembarked && !world.airEject) {
    const hullPct = sub.parts.hull / 120;
    const inDeep = getThermalLayer(sub.y) === 2;
    const enteringDeep = sub.y > THERMAL_LAYER_2_MAX - 5 && sub.vy > 0;

    // Block entry to deep layer if hull is too damaged
    if (enteringDeep && hullPct < HULL_DEEP_THRESHOLD && !inDeep) {
      sub.y = THERMAL_LAYER_2_MAX - 6;
      sub.vy = 0;
      if (world.tick % 60 < 2) {
        world.caveMessage = { text: 'HULL TOO DAMAGED FOR DEEP WATER — PRESSURE WARNING', timer: 90 };
      }
    }

    // Crushed if hull drops below threshold while already deep
    if (inDeep && hullPct < HULL_DEEP_CRUSH_THRESHOLD && hullPct > 0) {
      sub.parts.hull = 0;
      addExplosion(sub.worldX, sub.y, 'big');
      addParticles(sub.worldX, sub.y, 20, '#1a5276');
      world.caveMessage = { text: 'HULL CRUSHED BY DEEP WATER PRESSURE', timer: 200 };
      SFX.explodeBig();
    }
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
  updateHangars(dt);
  updateDestroyer(dt);
  updateMissionTimer(dt);
  updatePassengerShip(dt);
  updateInterceptors(dt);
  updateAkulaMolot(dt);
  updateDelfins(dt);
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
  ctx.fillText('Esc: controls  |  E: disembark  |  M: embark  |  A: afterburner  |  P: periscope', 22, H - 33);
  ctx.fillText('Ctrl: torpedo  |  Enter: missile  |  AltGr: depth charge  |  Space: cruise/stabilise', 22, H - 19);
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
  ctx.fillText('PAUSED', W / 2, 56);
  ctx.font = '16px Arial';
  ctx.fillText('Esc resumes', W / 2, 82);

  // --- Controls column ---
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(8,15,30,0.82)';
  ctx.fillRect(58, 100, 320, 260);
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.strokeRect(58, 100, 320, 260);

  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 18px Arial';
  ctx.fillText('Controls', 84, 128);
  ctx.font = '14px Arial';
  const controls = [
    'Arrows: steer, climb, dive',
    'Ctrl: torpedo',
    'Enter: missile (surface only)',
    'AltGr: depth charge',
    'Space: cruise / stabilise / stop',
    'A: afterburner',
    'P: periscope mode',
    'E: disembark  |  M: embark',
    'Tab: emergency eject (diving bell)',
    'Esc: pause and settings',
  ];
  controls.forEach((line, idx) => ctx.fillText(line, 84, 156 + idx * 20));

  // --- Settings column ---
  ctx.fillStyle = 'rgba(8,15,30,0.82)';
  ctx.fillRect(400, 100, 342, 260);
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.strokeRect(400, 100, 342, 260);

  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 18px Arial';
  ctx.fillText('Settings', 420, 128);
  ctx.font = '14px Arial';
  ctx.fillText(`Sub skin: ${skin.label}`, 420, 156);
  ctx.fillText('Use [ and ] to cycle skins', 420, 176);
  ctx.fillText(`Custom hue: ${Math.round(world.settings.customHue)}${skin.customHue ? ' degrees' : ' (Spectrum only)'}`, 420, 200);
  ctx.fillText('Use , and . to tune hue', 420, 220);
  ctx.fillText(`Legend: ${world.settings.showLegend ? 'ON' : 'OFF'}  (L to toggle)`, 420, 248);
  ctx.fillText(`HALO chute: ${world.settings.haloParachute ? 'ON' : 'OFF'}  (H to toggle)`, 420, 268);
  ctx.fillText(`Deep diver kit: ${world.settings.deepDiverKit ? 'ON' : 'OFF'}  (D to toggle)`, 420, 288);
  ctx.fillText(`Leaderboard entries: ${(world.leaderboard || []).length}`, 420, 308);

  // --- Game actions panel ---
  ctx.fillStyle = 'rgba(8,15,30,0.82)';
  ctx.fillRect(58, 374, 684, 76);
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.strokeRect(58, 374, 684, 76);

  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 18px Arial';
  ctx.fillText('Game', 84, 402);
  ctx.font = '14px Arial';
  const savedTag = hasSavedGame() ? '  (save exists)' : '';
  ctx.fillText(`S: save game   O: load game${savedTag}   N: new game   Q: quit`, 84, 430);

  // --- Key bindings panel ---
  ctx.fillStyle = 'rgba(8,15,30,0.82)';
  ctx.fillRect(58, 454, 684, 126);
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.strokeRect(58, 454, 684, 126);
  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 14px Arial';
  ctx.textAlign = 'left';
  ctx.fillText('Key Bindings (press number to rebind, Backspace to reset all)', 78, 472);
  ctx.font = '12px Arial';
  const bindCols = 2;
  const colW = 330;
  for (let i = 0; i < REBIND_ACTIONS.length; i++) {
    const action = REBIND_ACTIONS[i];
    const col = i < 5 ? 0 : 1;
    const row = i < 5 ? i : i - 5;
    const bx = 84 + col * colW;
    const by = 490 + row * 18;
    const isRebinding = rebindAction === action;
    ctx.fillStyle = isRebinding ? '#ff4444' : '#cbd5e1';
    ctx.fillText(`${i}: ${action}`, bx, by);
    ctx.fillStyle = isRebinding ? '#ff8888' : '#94a3b8';
    ctx.fillText(isRebinding ? '[ press new key... ]' : `= ${keyLabel(keybinds[action])}`, bx + 140, by);
  }
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
  ctx.fillText(`Palette accent: ${palette.name}`, W/2, H/2 + 58);
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.font = '12px Arial';
  ctx.fillText('Press F or Esc to close this menu', W/2, H/2 + 78);
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
  ctx.restore(); // End sub transform

  // Space tourist ship
  const tourist = space.touristShip;
  if (tourist && tourist.visible) {
    ctx.save();
    ctx.translate(tourist.x, tourist.y);
    const tAngle = Math.atan2(
      solarBodyPosition(SOLAR_SYSTEM_BODIES[tourist.toPlanetIdx], space.time).y - tourist.y,
      solarBodyPosition(SOLAR_SYSTEM_BODIES[tourist.toPlanetIdx], space.time).x - tourist.x
    );
    ctx.rotate(tAngle);
    // White civilian cruise ship
    ctx.fillStyle = '#f0f0f0';
    ctx.beginPath(); ctx.ellipse(0, 0, 12, 5, 0, 0, TWO_PI); ctx.fill();
    ctx.strokeStyle = '#ccc'; ctx.lineWidth = 0.5; ctx.stroke();
    // Windows
    ctx.fillStyle = '#60a5fa';
    for (let w = -2; w <= 2; w++) ctx.fillRect(w * 4 - 1, -2, 2, 1.5);
    // Label
    ctx.rotate(-tAngle); // Undo rotation for text
    ctx.fillStyle = '#94a3b8'; ctx.font = '7px Arial'; ctx.textAlign = 'center';
    ctx.fillText('TOURIST', 0, -10);
    if (tourist.dwellTimer > 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.fillText('DOCKED', 0, 10);
    }
    ctx.restore();
  }

  ctx.restore(); // End camera transform

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

    // Mission island indicator (Trionic SubCommando — coming in v2)
    if (isl.missionIsland) {
      // Beacon tower
      ctx.fillStyle = '#d97706';
      ctx.fillRect(sx + tH - 8, top - 18, 4, 18);
      // Glowing beacon
      const beaconPulse = 0.5 + 0.5 * Math.sin(world.tick * 0.06);
      ctx.fillStyle = `rgba(251, 191, 36, ${beaconPulse})`;
      ctx.beginPath(); ctx.arc(sx + tH - 6, top - 22, 4, 0, TWO_PI); ctx.fill();
      ctx.globalAlpha = beaconPulse * 0.3;
      ctx.beginPath(); ctx.arc(sx + tH - 6, top - 22, 10, 0, TWO_PI); ctx.fill();
      ctx.globalAlpha = 1;
      // Banner
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(sx - 35, top - 42, 70, 16);
      ctx.fillStyle = '#fbbf24';
      ctx.font = 'bold 8px Arial'; ctx.textAlign = 'center';
      ctx.fillText('MISSION ISLAND', sx, top - 32);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '7px Arial';
      ctx.fillText('TRIONIC SUBCOMMANDO v2', sx, top - 24);

      // Show message when commander is on this island
      if (sub.disembarked && sub.disembarkIsland === isl && world.tick % 300 < 5) {
        world.caveMessage = { text: 'TRIONIC SUBCOMMANDO — COMING IN v2', timer: 120 };
      }
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
    drawDestroyer();
    drawPassengerShip();
    drawInterceptors();
    drawAkulaMolot();
    drawDelfins();

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

  // Diving bell
  if (world.divingBell) {
    const bell = world.divingBell;
    const bx = toScreen(bell.x);
    const by = bell.y;
    // Glass dome
    ctx.strokeStyle = 'rgba(133, 193, 233, 0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(bx, by, DIVING_BELL_RADIUS, 0, TWO_PI);
    ctx.stroke();
    // Fill with semi-transparent blue
    ctx.fillStyle = 'rgba(30, 80, 140, 0.35)';
    ctx.beginPath();
    ctx.arc(bx, by, DIVING_BELL_RADIUS, 0, TWO_PI);
    ctx.fill();
    // Porthole
    ctx.fillStyle = 'rgba(200, 230, 255, 0.5)';
    ctx.beginPath();
    ctx.arc(bx, by - 2, 4, 0, TWO_PI);
    ctx.fill();
    // Rivets
    ctx.fillStyle = '#7f8c8d';
    for (let a = 0; a < 6; a++) {
      const ra = a * Math.PI / 3;
      ctx.beginPath();
      ctx.arc(bx + Math.cos(ra) * (DIVING_BELL_RADIUS - 2), by + Math.sin(ra) * (DIVING_BELL_RADIUS - 2), 1, 0, TWO_PI);
      ctx.fill();
    }
    // Bubbles rising from bell
    ctx.fillStyle = 'rgba(133, 193, 233, 0.3)';
    for (let i = 0; i < 3; i++) {
      const bAge = (world.tick * 0.06 + i * 2.1) % 4;
      ctx.beginPath();
      ctx.arc(bx + Math.sin(world.tick * 0.03 + i) * 4, by - DIVING_BELL_RADIUS - bAge * 8, 1.5 - bAge * 0.2, 0, TWO_PI);
      ctx.fill();
    }
  }

  // Air eject commander
  drawAirEject();

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

  // --- Hangars (start and end) ---
  for (const port of [world.terrain.startPort, world.terrain.endPort]) {
    const px = toScreen(port.x);
    if (px < -100 || px > W + 100) continue;

    if (port.destroyed) {
      // Wreckage
      ctx.fillStyle = '#2a1a0a';
      ctx.fillRect(px - port.w/2, WATER_LINE - 8, port.w, 8);
      ctx.fillStyle = 'rgba(80,40,10,0.5)';
      for (let d = 0; d < 5; d++) {
        ctx.fillRect(px - 30 + d * 14, WATER_LINE - 4 - Math.random() * 6, 8, 4);
      }
      if (world.tick % 12 < 6) {
        ctx.fillStyle = 'rgba(100,50,10,0.25)';
        ctx.beginPath(); ctx.arc(px + Math.sin(world.tick * 0.03) * 10, WATER_LINE - 12, 4, 0, TWO_PI); ctx.fill();
      }
      continue;
    }

    const level = hangarHealthLevel(port);

    // Dock platform
    ctx.fillStyle = '#5a4a3a';
    ctx.fillRect(px - port.w/2, WATER_LINE - 20, port.w, 20);
    // Hangar roof structure
    ctx.fillStyle = '#4a3a2e';
    ctx.beginPath();
    ctx.moveTo(px - port.w/2 - 5, WATER_LINE - 20);
    ctx.lineTo(px, WATER_LINE - 42);
    ctx.lineTo(px + port.w/2 + 5, WATER_LINE - 20);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#3a2a1e';
    ctx.lineWidth = 1;
    ctx.stroke();
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

    // Point defense turret (visible when green)
    if (level === 'green') {
      ctx.fillStyle = '#666';
      ctx.fillRect(px - 3, WATER_LINE - 46, 6, 4);
      ctx.strokeStyle = '#888';
      ctx.lineWidth = 2;
      const gunAngle = Math.sin(world.tick * 0.02) * 0.4 - 0.3;
      ctx.save(); ctx.translate(px, WATER_LINE - 46);
      ctx.rotate(gunAngle);
      ctx.fillStyle = '#555';
      ctx.fillRect(0, -1.5, 12, 3);
      ctx.restore();
    }

    // --- Hangar health indicator ---
    const barW = 50;
    const barH = 6;
    const barX = px - barW / 2;
    const barY = WATER_LINE - 62;
    const pct = port.hp / HANGAR_MAX_HP;

    // Background
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(barX - 1, barY - 1, barW + 2, barH + 2);

    // Health bar color by level
    let barColor;
    if (level === 'purple') {
      // Flashing purple
      barColor = (world.tick % 10 < 5) ? '#9b59b6' : '#e74c3c';
    } else if (level === 'red') {
      barColor = '#e74c3c';
    } else if (level === 'yellow') {
      barColor = '#f1c40f';
    } else {
      barColor = '#2ecc71';
    }
    ctx.fillStyle = barColor;
    ctx.fillRect(barX, barY, barW * pct, barH);

    // Border
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(barX - 1, barY - 1, barW + 2, barH + 2);

    // Label
    ctx.fillStyle = barColor;
    ctx.font = '9px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('HANGAR', px, barY - 3);

    // Flashing critical warning
    if (level === 'purple' && world.tick % 16 < 8) {
      ctx.fillStyle = 'rgba(155, 89, 182, 0.25)';
      ctx.beginPath();
      ctx.arc(px, WATER_LINE - 30, 45 + Math.sin(world.tick * 0.1) * 5, 0, TWO_PI);
      ctx.fill();
    }

    // Port name
    ctx.fillStyle = '#ecf0f1'; ctx.font = 'bold 11px Arial'; ctx.textAlign = 'center';
    ctx.fillText(port.name, px, barY - 12);
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

    // Tier 1 wobble offset
    r.wobblePhase += 0.008 * dt;
    const wobbleX = r.wobbleRange ? Math.sin(r.wobblePhase) * r.wobbleRange : 0;
    const wrx = rx + wobbleX;

    if (r.tier === 1) {
      // --- CATAPULT/TREBUCHET with radar dish, on wheels ---
      // Wheels
      ctx.fillStyle = '#555';
      ctx.beginPath(); ctx.arc(wrx - 8, ry, 4, 0, TWO_PI); ctx.fill();
      ctx.beginPath(); ctx.arc(wrx + 8, ry, 4, 0, TWO_PI); ctx.fill();
      ctx.strokeStyle = '#444'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(wrx - 8, ry, 4, 0, TWO_PI); ctx.stroke();
      ctx.beginPath(); ctx.arc(wrx + 8, ry, 4, 0, TWO_PI); ctx.stroke();
      // Wheel spokes
      const spokeAngle = world.tick * 0.02 + wobbleX * 0.05;
      ctx.strokeStyle = '#666'; ctx.lineWidth = 1;
      for (let s = 0; s < 4; s++) {
        const sa = spokeAngle + s * Math.PI / 2;
        for (const wx of [wrx - 8, wrx + 8]) {
          ctx.beginPath();
          ctx.moveTo(wx + Math.cos(sa) * 1, ry + Math.sin(sa) * 1);
          ctx.lineTo(wx + Math.cos(sa) * 3.5, ry + Math.sin(sa) * 3.5);
          ctx.stroke();
        }
      }
      // Axle/chassis
      ctx.fillStyle = '#5a4a38';
      ctx.fillRect(wrx - 10, ry - 4, 20, 4);
      // Trebuchet arm (pivots up from base)
      const armAngle = -0.6 + Math.sin(r.angle * 0.3) * 0.15;
      ctx.save(); ctx.translate(wrx, ry - 4);
      ctx.rotate(armAngle);
      ctx.fillStyle = '#6b5b4a';
      ctx.fillRect(-2, -22, 4, 22);
      // Counterweight
      ctx.fillStyle = '#444';
      ctx.fillRect(-4, -2, 8, 5);
      // Dish at top of arm
      ctx.save(); ctx.translate(0, -22);
      ctx.rotate(r.angle);
      ctx.fillStyle = '#aaa';
      ctx.fillRect(-7, -2, 14, 3);
      ctx.fillStyle = '#ccc';
      ctx.beginPath(); ctx.arc(7, 0, 2.5, 0, TWO_PI); ctx.fill();
      ctx.restore();
      ctx.restore();
      // Danger light on chassis
      if (Math.sin(world.tick * 0.1) > 0) {
        ctx.fillStyle = '#e74c3c';
        ctx.beginPath(); ctx.arc(wrx, ry - 6, 2, 0, TWO_PI); ctx.fill();
        ctx.globalAlpha = 0.15;
        ctx.beginPath(); ctx.arc(wrx, ry - 6, 7, 0, TWO_PI); ctx.fill();
        ctx.globalAlpha = 1;
      }
    } else if (r.tier === 2) {
      // --- MULTI-LAUNCH SILO PLATFORM ---
      // Concrete base platform
      ctx.fillStyle = '#4a4a4a';
      ctx.fillRect(rx - 14, ry - 6, 28, 6);
      ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
      ctx.strokeRect(rx - 14, ry - 6, 28, 6);
      // Silo tubes (3 angled launch tubes)
      const siloAngle = Math.atan2(sub.y - (ry - 12), sub.worldX - r.x);
      const clampedAngle = Math.max(-Math.PI * 0.4, Math.min(0.1, siloAngle));
      for (let s = 0; s < 3; s++) {
        const sx2 = rx - 8 + s * 8;
        ctx.save(); ctx.translate(sx2, ry - 6);
        ctx.rotate(clampedAngle - 0.1 + s * 0.1);
        // Tube body
        ctx.fillStyle = '#555';
        ctx.fillRect(-2.5, -18, 5, 18);
        ctx.strokeStyle = '#444'; ctx.lineWidth = 0.5;
        ctx.strokeRect(-2.5, -18, 5, 18);
        // Tube cap (darker)
        ctx.fillStyle = '#333';
        ctx.fillRect(-3, -19, 6, 2);
        ctx.restore();
      }
      // Control box on side
      ctx.fillStyle = '#3a3a3a';
      ctx.fillRect(rx + 14, ry - 12, 6, 8);
      ctx.fillStyle = '#2ecc71';
      ctx.fillRect(rx + 15, ry - 11, 2, 2); // Status LED
      // Radar dish (smaller, on control box)
      ctx.save(); ctx.translate(rx + 17, ry - 14);
      ctx.rotate(r.angle);
      ctx.fillStyle = '#888';
      ctx.fillRect(-5, -1.5, 10, 3);
      ctx.restore();
      // Exhaust/smoke when recently fired
      if (r.cooldown > 15) {
        ctx.globalAlpha = 0.4;
        ctx.fillStyle = '#aaa';
        for (let p = 0; p < 3; p++) {
          const smokeAge = (25 - r.cooldown + p * 3) * 0.4;
          ctx.beginPath();
          ctx.arc(rx - 8 + p * 8, ry - 22 - smokeAge * 3, 2 + smokeAge, 0, TWO_PI);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
    } else if (r.tier === 3) {
      // --- HEAVY SAM: fortified base + huge tracking dish + missile launcher ---
      // Reinforced concrete base with hazard stripes
      ctx.fillStyle = '#3a3a3a';
      ctx.fillRect(rx - 14, ry - 8, 28, 8);
      ctx.strokeStyle = '#f39c12'; ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(rx - 14, ry - 8, 28, 8);
      ctx.setLineDash([]);
      // Heavy armoured pedestal
      ctx.fillStyle = '#4a4a4a';
      ctx.fillRect(rx - 5, ry - 30, 10, 22);
      ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
      ctx.strokeRect(rx - 5, ry - 30, 10, 22);
      // Armour bolts
      ctx.fillStyle = '#666';
      for (let b = 0; b < 3; b++) {
        ctx.beginPath(); ctx.arc(rx - 3, ry - 14 - b * 7, 1.5, 0, TWO_PI); ctx.fill();
        ctx.beginPath(); ctx.arc(rx + 3, ry - 14 - b * 7, 1.5, 0, TWO_PI); ctx.fill();
      }
      // Huge parabolic dish — SWIVELS toward the sub
      const trackAngle = Math.atan2(sub.y - (ry - 35), sub.worldX - r.x);
      ctx.save(); ctx.translate(rx, ry - 32);
      ctx.rotate(trackAngle * 0.4); // Dish tracks sub direction (damped)
      // Dish frame
      ctx.fillStyle = '#777';
      ctx.beginPath();
      ctx.moveTo(-22, 6); ctx.quadraticCurveTo(0, -14, 22, 6);
      ctx.lineTo(22, 9); ctx.quadraticCurveTo(0, -10, -22, 9);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#555'; ctx.lineWidth = 1; ctx.stroke();
      // Inner dish (lighter, concave look)
      ctx.fillStyle = '#999';
      ctx.beginPath();
      ctx.moveTo(-16, 5); ctx.quadraticCurveTo(0, -8, 16, 5);
      ctx.lineTo(16, 7); ctx.quadraticCurveTo(0, -5, -16, 7);
      ctx.closePath(); ctx.fill();
      // Feed horn (centre of dish)
      ctx.fillStyle = '#aaa';
      ctx.beginPath(); ctx.arc(0, -1, 3, 0, TWO_PI); ctx.fill();
      ctx.fillStyle = '#e74c3c';
      ctx.beginPath(); ctx.arc(0, -1, 1.5, 0, TWO_PI); ctx.fill();
      // Support struts
      ctx.strokeStyle = '#666'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-14, 5); ctx.lineTo(0, -1); ctx.lineTo(14, 5); ctx.stroke();
      ctx.restore();
      // SAM launcher (twin tubes, angled toward sub)
      const samAngle = Math.atan2(sub.y - (ry - 20), sub.worldX - r.x);
      ctx.save(); ctx.translate(rx, ry - 15);
      ctx.rotate(Math.min(0.1, Math.max(-Math.PI / 3, samAngle)));
      ctx.fillStyle = '#444';
      ctx.fillRect(-2, -4.5, 20, 3);
      ctx.fillRect(-2, 1.5, 20, 3);
      // Missile tips (if loaded)
      if (r.cooldown <= 10) {
        ctx.fillStyle = '#e74c3c';
        ctx.beginPath(); ctx.arc(18, -3, 2, 0, TWO_PI); ctx.fill();
        ctx.beginPath(); ctx.arc(18, 3, 2, 0, TWO_PI); ctx.fill();
      }
      ctx.restore();
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
      // Labyrinth mission cave indicator
      if (cave.labyrinth) {
        const beaconPulse = 0.5 + 0.5 * Math.sin(world.tick * 0.06);
        ctx.fillStyle = `rgba(168, 85, 247, ${beaconPulse})`;
        ctx.beginPath(); ctx.arc(csx, cave.y - cave.h / 2 - 8, 4, 0, TWO_PI); ctx.fill();
        ctx.globalAlpha = beaconPulse * 0.2;
        ctx.beginPath(); ctx.arc(csx, cave.y - cave.h / 2 - 8, 12, 0, TWO_PI); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(csx - 55, cave.y - 40, 110, 20);
        ctx.fillStyle = '#a855f7';
        ctx.font = 'bold 8px Arial'; ctx.textAlign = 'center';
        ctx.fillText('SUBTERRANEAN LABYRINTH', csx, cave.y - 30);
        ctx.fillStyle = '#94a3b8';
        ctx.font = '7px Arial';
        ctx.fillText('COMING IN v3', csx, cave.y - 22);
      }
      }
    }
  }

  // Sunken supply packages on the seabed
  if (sub.y > WATER_LINE) {
    for (const pkg of world.terrain.sunkenSupplies) {
      if (pkg.collected) continue;
      const psx = toScreen(pkg.x);
      if (psx < -20 || psx > W + 20) continue;
      if (!thermallyVisible(sub.y, pkg.y)) continue;
      ctx.fillStyle = '#6b5b3a';
      ctx.fillRect(psx - 6, pkg.y - 5, 12, 10);
      ctx.strokeStyle = '#8b7355';
      ctx.lineWidth = 1;
      ctx.strokeRect(psx - 6, pkg.y - 5, 12, 10);
      // Cross
      ctx.strokeStyle = '#d4a053';
      ctx.beginPath();
      ctx.moveTo(psx - 6, pkg.y - 5); ctx.lineTo(psx + 6, pkg.y + 5);
      ctx.moveTo(psx + 6, pkg.y - 5); ctx.lineTo(psx - 6, pkg.y + 5);
      ctx.stroke();
      // Pickup hint
      if (sub.disembarked && sub.diverMode && Math.hypot(sub.pilotX - pkg.x, sub.pilotY - pkg.y) < 35) {
        ctx.fillStyle = '#fcd34d';
        ctx.font = '9px Arial'; ctx.textAlign = 'center';
        ctx.fillText('[F] SALVAGE', psx, pkg.y - 12);
      }
    }

    // Small diver holes
    for (const hole of world.terrain.diverHoles) {
      if (hole.explored) continue;
      const hsx = toScreen(hole.x);
      if (hsx < -20 || hsx > W + 20) continue;
      if (!thermallyVisible(sub.y, hole.y)) continue;
      ctx.fillStyle = '#080808';
      ctx.beginPath();
      ctx.ellipse(hsx, hole.y, hole.w / 2, hole.h / 2, 0, 0, TWO_PI);
      ctx.fill();
      // Subtle glow
      ctx.strokeStyle = 'rgba(160, 200, 255, 0.3)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(hsx, hole.y, hole.w / 2 + 2, hole.h / 2 + 2, 0, 0, TWO_PI);
      ctx.stroke();
      if (hole.missionTunnel) {
        // Mission tunnel beacon
        const beaconPulse = 0.5 + 0.5 * Math.sin(world.tick * 0.07);
        ctx.fillStyle = `rgba(251, 191, 36, ${beaconPulse})`;
        ctx.beginPath(); ctx.arc(hsx, hole.y - hole.h / 2 - 6, 3, 0, TWO_PI); ctx.fill();
        ctx.globalAlpha = beaconPulse * 0.25;
        ctx.beginPath(); ctx.arc(hsx, hole.y - hole.h / 2 - 6, 8, 0, TWO_PI); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        ctx.fillRect(hsx - 45, hole.y - 34, 90, 18);
        ctx.fillStyle = '#fbbf24';
        ctx.font = 'bold 7px Arial'; ctx.textAlign = 'center';
        ctx.fillText('MISSION TUNNEL', hsx, hole.y - 24);
        ctx.fillStyle = '#94a3b8';
        ctx.font = '6px Arial';
        ctx.fillText('TRIONIC SUBCOMMANDO v2', hsx, hole.y - 17);
      } else {
        ctx.fillStyle = 'rgba(160, 200, 255, 0.5)';
        ctx.font = '7px Arial'; ctx.textAlign = 'center';
        ctx.fillText('DIVER HOLE', hsx, hole.y - 12);
      }
    }
  }

  // Sub in cave indicator
  if (world.subInCave) {
    const cave = world.subInCave;
    const ccx = toScreen(cave.x);
    // Show "HIDDEN" label and periscope hint
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(ccx - 50, cave.y + 20, 100, 22);
    ctx.fillStyle = '#85c1e9';
    ctx.font = '10px Arial'; ctx.textAlign = 'center';
    ctx.fillText('SUB HIDDEN — ↑ to exit, P periscope', ccx, cave.y + 34);
  }

  // Restore camera transform — HUD draws in screen coords
  ctx.restore();

  // HUD (screen-space, not affected by camera)
  drawHUD();
  drawDamageDiagram();
  if (world.menuOpen) drawWarpMenu();
  drawFlightInstruments();
  drawCompactLegend();
  drawGunPost();
  drawMissionTimer();

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

    // Temperature indicator (next to depth gauge)
    if (isUnderwater) {
      const layer = getThermalLayer(subY);
      const temp = THERMAL_TEMPS[layer] || 0;
      const layerLabel = THERMAL_LABELS[layer] || '';
      const tempColor = layer === 0 ? '#f59e0b' : layer === 1 ? '#60a5fa' : '#818cf8';
      ctx.fillStyle = 'rgba(0,20,40,0.6)';
      ctx.fillRect(W - 80, H/2 + 72, 65, 32);
      ctx.strokeStyle = tempColor;
      ctx.lineWidth = 1;
      ctx.strokeRect(W - 80, H/2 + 72, 65, 32);
      ctx.fillStyle = tempColor;
      ctx.font = 'bold 14px "Courier New", monospace'; ctx.textAlign = 'center';
      ctx.fillText(`${temp.toFixed(1)}°`, W - 47, H/2 + 88);
      ctx.font = '7px Arial';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(layerLabel, W - 47, H/2 + 100);
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
    if (keyJustPressed['r']||keyJustPressed['R']) world = initWorld();
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
    if (keyJustPressed['r']||keyJustPressed['R']) world = initWorld();
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

  // Exhaust / propeller trail
  if (sub.caterpillarDrive) {
    // Silent running — no visible exhaust at all
  } else if (inWater) {
    // Underwater propeller bubble stream
    const moving = Math.abs(sub.vx) > 0.2 || Math.abs(sub.vy) > 0.2;
    if (moving) {
      const speed = Math.hypot(sub.vx, sub.vy);
      const bubbleCount = Math.min(8, Math.floor(speed * 2) + 2);
      for (let i = 0; i < bubbleCount; i++) {
        const age = (world.tick * 0.15 + i * 1.7) % 3;
        const bx = sx - f * (22 + age * 8 + Math.random() * 4);
        const by = sub.y + (Math.random() - 0.5) * 6 - age * 2;
        const radius = 1 + (1 - age / 3) * 1.5;
        ctx.globalAlpha = 0.15 + (1 - age / 3) * 0.25;
        ctx.fillStyle = '#85c1e9';
        ctx.beginPath();
        ctx.arc(bx, by, radius, 0, TWO_PI);
        ctx.fill();
      }
      // Occasional larger bubble
      if (world.tick % 6 === 0) {
        ctx.globalAlpha = 0.2;
        ctx.strokeStyle = '#a0d4f0';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.arc(sx - f * (24 + Math.random() * 8), sub.y + (Math.random() - 0.5) * 4, 2.5 + Math.random(), 0, TWO_PI);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  } else if (keys['ArrowUp'] || keys['ArrowRight'] || keys['ArrowLeft']) {
    // In air — engine exhaust puffs
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = '#bdc3c7';
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(sx - f*22 - f*Math.random()*15, sub.y+(Math.random()-0.5)*8, 1+Math.random()*2, 0, TWO_PI);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Damage smoke trail
  const critical = anyPartCritical(sub.parts);
  const red = !critical && anyPartRed(sub.parts);
  if (critical || red) {
    const smokeCount = critical ? 8 : 3;
    const smokeAlpha = critical ? 0.6 : 0.25;
    const smokeColor = critical ? '#222' : '#666';
    const smokeSpread = critical ? 12 : 6;
    for (let s = 0; s < smokeCount; s++) {
      const age = (world.tick * 0.1 + s * 2.3) % 4;
      const smX = sx - f * (10 + age * 10 + Math.random() * 5);
      const smY = sub.y - age * 4 - Math.random() * smokeSpread;
      const smR = 2 + age * (critical ? 2.5 : 1.2);
      ctx.globalAlpha = Math.max(0, smokeAlpha * (1 - age / 4));
      ctx.fillStyle = smokeColor;
      ctx.beginPath(); ctx.arc(smX, smY, smR, 0, TWO_PI); ctx.fill();
    }
    // Occasional ember/spark for critical
    if (critical && world.tick % 4 < 2) {
      ctx.fillStyle = '#ff6b00';
      ctx.globalAlpha = 0.5 + Math.random() * 0.3;
      ctx.beginPath();
      ctx.arc(sx - f * (15 + Math.random() * 10), sub.y + (Math.random() - 0.5) * 8, 1 + Math.random(), 0, TWO_PI);
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
function drawEjectPrimeWarning() {
  if (world.ejectPrimeTimer <= 0) return;
  const flash = Math.sin(world.tick * 0.4) > 0;
  if (!flash) return;
  ctx.fillStyle = 'rgba(180, 0, 0, 0.85)';
  ctx.fillRect(12, 8, 200, 28);
  ctx.strokeStyle = '#ff3333';
  ctx.lineWidth = 2;
  ctx.strokeRect(12, 8, 200, 28);
  ctx.fillStyle = '#ff4444';
  ctx.font = 'bold 16px Arial';
  ctx.textAlign = 'left';
  ctx.fillText('EJECTION PRIMING', 22, 28);
}

function drawHUD() {
  drawSolarMiniMap();
  drawEjectPrimeWarning();
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

  // WASM co-processor status badge
  if (world.wasmTick !== undefined) {
    ctx.font = '9px Arial';
    ctx.fillStyle = '#34d399';
    ctx.fillText(`WASM \u2713 t:${world.wasmTick}`, 15, hudStartY + 62);
  } else if (world.wasm === null) {
    ctx.font = '9px Arial';
    ctx.fillStyle = '#9ca3af';
    ctx.fillText('WASM offline', 15, hudStartY + 62);
  }

  // Status
  ctx.textAlign='right'; ctx.font='13px Arial';
  const statusY = hudStartY + 10;
  if (world.mode === 'orbit' && world.space?.nearestBody) {
    ctx.fillStyle = '#c4b5fd';
    ctx.fillText(`Orbiting near ${world.space.nearestBody.body.label}`, W-15, statusY);
    // Autopilot indicator
    if (world.space.autopilotTarget) {
      const targetDef = SOLAR_SYSTEM_BODIES.find((b) => b.id === world.space.autopilotTarget);
      ctx.fillStyle = '#34d399';
      ctx.fillText(`AUTOPILOT: ${targetDef ? targetDef.label : world.space.autopilotTarget}`, W-15, statusY + 16);
    }
  } else if (sub.disembarked) {
    ctx.fillStyle='#d4a053';
    ctx.fillText(world.divingBell ? 'DIVING BELL — NO RETURN' : sub.diverMode ? 'DIVER DEPLOYED' : 'DISEMBARKED', W-15, statusY);
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
  // Caterpillar drive indicator
  if (sub.caterpillarDrive) {
    ctx.fillStyle = '#22d3ee';
    ctx.fillText('CAT DRIVE  ON', W-15, 184);
  } else if (sub.y > WATER_LINE) {
    ctx.fillStyle = '#555';
    ctx.fillText('CAT DRIVE OFF', W-15, 184);
  }

  // Controls
  ctx.font='11px Arial'; ctx.fillStyle='rgba(255,255,255,0.4)'; ctx.textAlign='center';
  if (sub.disembarked) ctx.fillText('[M] Return to sub  |  J/K: move  |  Arrows: move', W/2, H-10);
  else ctx.fillText('Esc: controls | E: disembark | A: afterburner | AltGr: depth | Ctrl: torpedo | Enter: missile', W/2, H-10);
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

// ─────────────────────────────────────────────────────────────────────────────
// CRASH LOGGING — captures unhandled errors and promise rejections.
// Stores up to 20 entries in localStorage under 'ass_crash_logs'.
// Also POSTs to /crash-report when the Deno dev server is running so
// reports are written to the on-disk logs/ folder.
// Console helpers: ASS_dumpCrashLog(), ASS_downloadCrashLog(), ASS_clearCrashLog()
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  'use strict';
  const STORAGE_KEY  = 'ass_crash_logs';
  const MAX_ENTRIES  = 20;

  function getCrashLogs() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
  }

  function saveCrashLog(entry) {
    try {
      const logs = getCrashLogs();
      logs.unshift(entry);
      if (logs.length > MAX_ENTRIES) logs.length = MAX_ENTRIES;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
    } catch { /* storage unavailable */ }
    // Best-effort POST to Deno dev server crash-report endpoint
    try {
      fetch('/crash-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
        keepalive: true,
      }).catch(() => {});
    } catch { /* server not running */ }
  }

  function worldSnapshot() {
    try {
      if (!world) return null;
      return {
        tick:     world.tick,
        score:    world.score,
        kills:    world.kills,
        mode:     world.mode,
        gameOver: world.gameOver,
        paused:   world.paused,
        subX:     world.sub && world.sub.worldX,
        subY:     world.sub && world.sub.y,
      };
    } catch { return null; }
  }

  function buildEntry(msg, source, lineno, colno, error) {
    return {
      timestamp:     new Date().toISOString(),
      message:       String(msg),
      source:        source || 'unknown',
      lineno:        lineno || 0,
      colno:         colno  || 0,
      stack:         error && error.stack ? error.stack : null,
      worldSnapshot: worldSnapshot(),
      userAgent:     navigator.userAgent,
    };
  }

  window.onerror = function (msg, source, lineno, colno, error) {
    saveCrashLog(buildEntry(msg, source, lineno, colno, error));
    return false; // preserve default browser error handling
  };

  window.onunhandledrejection = function (event) {
    const err = event.reason;
    saveCrashLog(buildEntry(
      err instanceof Error ? err.message : String(err),
      'unhandled-promise', 0, 0,
      err instanceof Error ? err : null
    ));
  };

  /** Print stored crash logs to the browser console. */
  window.ASS_dumpCrashLog = function () {
    const logs = getCrashLogs();
    if (logs.length === 0) { console.info('[ASS] No crash logs stored.'); return logs; }
    console.group(`[ASS] Crash logs (${logs.length} entries)`);
    logs.forEach((l, i) => console.info(`[${i}] ${l.timestamp} — ${l.message}`, l));
    console.groupEnd();
    return logs;
  };

  /** Download stored crash logs as a JSON file. */
  window.ASS_downloadCrashLog = function () {
    const logs = getCrashLogs();
    const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = `ass-crash-log-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  };

  /** Clear stored crash logs from localStorage. */
  window.ASS_clearCrashLog = function () {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    console.info('[ASS] Crash logs cleared.');
  };
})();

// Start
init().catch(console.error);
