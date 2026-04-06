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

// --- Sub machine gun (default weapon, slot 1) ---
const SUB_MG_COOLDOWN = 6;
const SUB_MG_SPEED = 6;
const SUB_MG_DAMAGE = 1.5;
const SUB_MG_LIFE = 45;

// --- Bouncing bomb (slot 5, Barnes Wallis special) ---
// Must be dropped from the air at low altitude with a shallow descent angle.
// Bounces on water (losing speed each bounce), explodes on land contact.
// Physics-based: release angle, speed, and altitude all matter.
const BBOMB_COOLDOWN = 120;
const BBOMB_DAMAGE = 50;        // Massive — reward for the skill shot
const BBOMB_BLAST_RADIUS = 55;
const BBOMB_MAX_AMMO = 3;
const BBOMB_BOUNCE_LOSS = 0.55; // Speed retained per bounce (45% lost)
const BBOMB_MAX_BOUNCES = 6;
const BBOMB_LIFE = 300;
// Release window: sub must be in air, low altitude, moving forward, shallow angle
const BBOMB_MAX_ALT = 80;       // Max height above water for valid release
const BBOMB_MIN_SPEED = 2.5;    // Minimum forward speed for release
const BBOMB_MAX_ANGLE = 0.25;   // Max absolute sub.angle (radians) — nearly level

// --- Red Arrow squadron (wingmen support) ---
const SQUADRON_COUNT = 2;            // Two wingmen
const SQUADRON_HP = 3;               // Fragile — smaller subs
const SQUADRON_SPEED_AIR = 3.2;      // Slightly faster than player to keep up
const SQUADRON_SPEED_WATER = 1.8;
const SQUADRON_FIRE_COOLDOWN = 18;
const SQUADRON_BULLET_SPEED = 5;
const SQUADRON_BULLET_DAMAGE = 1;
const SQUADRON_BULLET_LIFE = 40;
const SQUADRON_FOLLOW_DIST = 60;     // Formation offset from leader
const SQUADRON_ENGAGE_RANGE = 180;   // Range at which they peel off to attack
const SQUADRON_RETURN_RANGE = 350;   // Range at which they abandon target and regroup
// Modes: 'off', 'general', 'aqua', 'aero', 'terra', 'astro'
const SQUADRON_MODES = ['off', 'general', 'aqua', 'aero', 'terra', 'astro'];

// --- Gauss Railgun (slot 9, experimental, limited ammo) ---
const RAILGUN_COOLDOWN = 90;
const RAILGUN_SPEED = 14;
const RAILGUN_DAMAGE = 35;
const RAILGUN_LIFE = 25;
const RAILGUN_MAX_AMMO = 5;
const MISSILE_SPEED = 5;
const BUOYANCY = 0.10;  // Reduced — sub has neutral buoyancy, doesn't constantly float up
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
const EJECT_PRIME_TIMEOUT = 60;
const DIVING_BELL_SPEED = 0.4;
const PARACHUTE_DESCENT_SPEED = 0.6;
const HALO_DESCENT_SPEED = 2.5;       // Fast freefall before chute opens
const HALO_OPEN_ALTITUDE = 40;        // Opens this many pixels above ground/water
const COMMANDER_HP = 3;                // Hits before commander is killed (eject + sub)
const COMMANDER_MAX_HP = 3;

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

// --- Commander gun post (legacy MG) ---
const GUN_POST_MG_COOLDOWN = 5;
const GUN_POST_MG_SPEED = 6;
const GUN_POST_MG_DAMAGE = 2;
const GUN_POST_MG_RANGE = 200;
const GUN_POST_BULLET_LIFE = 60;

// --- Trionic SubCommando weapons ---
// 1: Pistol — fast, moderate damage, infinite ammo
const CMDR_PISTOL_COOLDOWN = 12;
const CMDR_PISTOL_SPEED = 5;
const CMDR_PISTOL_DAMAGE = 1.5;
const CMDR_PISTOL_LIFE = 50;
// 2: Grenade — slow, high damage, arc trajectory, limited supply
const CMDR_GRENADE_COOLDOWN = 60;
const CMDR_GRENADE_SPEED = 3.5;
const CMDR_GRENADE_DAMAGE = 12;
const CMDR_GRENADE_BLAST_RADIUS = 40;
const CMDR_GRENADE_LIFE = 80;
const CMDR_GRENADE_MAX = 5;
// 9: Particle Projector Cannon — experimental, devastating, long cooldown
const CMDR_PPC_COOLDOWN = 180;
const CMDR_PPC_SPEED = 9;
const CMDR_PPC_DAMAGE = 40;
const CMDR_PPC_LIFE = 35;
const CMDR_PPC_AMMO = 3;  // Per life — cannot resupply

// --- Mission timer ---
const MISSION_TYPES = {
  patrol:  { timed: false, label: 'PATROL' },
  strike:  { timed: true, duration: 6000, label: 'STRIKE', killTarget: 8 },
  hostage: { timed: true, duration: 5400, label: 'HOSTAGE RESCUE', mandatory: true, hostageCount: 3 },
  escort:  { timed: true, duration: 7200, label: 'ESCORT', mandatory: true },
};
const DIVING_BELL_RADIUS = 12;
const HOSTAGE_RESCUE_RANGE = 60;         // How close sub must be to rescue
const HOSTAGE_SCORE_BONUS = 1000;        // Points per rescued hostage
const HOSTAGE_FLARE_INTERVAL = 120;      // Ticks between signal flares
const STRIKE_KILL_BONUS = 500;           // Points per kill during strike mission
const STRIKE_COMPLETE_BONUS = 3000;      // Bonus for completing all kills in time
const ESCORT_COMPLETE_BONUS = 4000;      // Bonus for surviving escort duration

const AFTERBURNER_MAX_CHARGE = 100;
const AFTERBURNER_DRAIN = 1.4;
const AFTERBURNER_RECHARGE = 0.55;
const AFTERBURNER_ACCEL = 0.24;
const AFTERBURNER_SPEED_MULT = 1.7;
const AFTERBURNER_LIFT = 0.08;
const AFTERBURNER_COLOR = '#ff7a18';
const SOLAR_GM = 3000; // Tuned for 3× scale — matches original visual orbital speed; de-orbit to Sun still requires shedding ~2.35 units of velocity at 0.003 thrust/frame (~780 frames constant burn)

const SOLAR_SYSTEM_BODIES = [
  { id: 'sun',     label: 'Sun',     orbitRadius:    0, radius:  96, color: '#ffd166', period:   1, phase: 0.0, gm: SOLAR_GM },
  { id: 'mercury', label: 'Mercury', orbitRadius:  255, radius:  12, color: '#b08968', period:  60, phase: 0.4, gm:  4, soi:  27, ecc: 0.30, peri: 1.35 },
  { id: 'venus',   label: 'Venus',   orbitRadius:  360, radius:  21, color: '#d4a373', period:  90, phase: 1.1, gm:  6, soi:  45, ecc: 0.05, peri: 2.18 },
  { id: 'earth',   label: 'Earth',   orbitRadius:  495, radius:  24, color: '#4ea8de', period: 120, phase: 2.0, gm: 10, soi:  72, ecc: 0.07, peri: 1.80 },
  { id: 'mars',    label: 'Mars',    orbitRadius:  615, radius:  18, color: '#e76f51', period: 190, phase: 2.7, gm:  5, soi:  69, ecc: 0.18, peri: 0.87 },
  { id: 'jupiter', label: 'Jupiter', orbitRadius:  780, radius:  48, color: '#d9a066', period: 320, phase: 0.8, gm: 22, soi: 159, ecc: 0.10, peri: 0.26 },
  { id: 'saturn',  label: 'Saturn',  orbitRadius:  945, radius:  42, color: '#e9c46a', period: 420, phase: 1.8, gm: 18, soi: 177, ecc: 0.09, peri: 1.62, ring: true },
  { id: 'uranus',  label: 'Uranus',  orbitRadius: 1065, radius:  33, color: '#8ecae6', period: 520, phase: 2.9, gm: 12, soi: 168, ecc: 0.07, peri: 2.98 },
  { id: 'neptune', label: 'Neptune', orbitRadius: 1185, radius:  33, color: '#4361ee', period: 620, phase: 3.6, gm: 12, soi: 189, ecc: 0.05, peri: 0.51 },
  { id: 'pluto',   label: 'Pluto',   orbitRadius: 1320, radius:   9, color: '#a0a0a0', period: 800, phase: 4.2, gm:  1, soi:  78, ecc: 0.35, peri: 3.91 },
];
const SOLAR_SYSTEM_BOUNDARY = 1410; // Hard boundary — cannot fly past this radius
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
const SOLAR_MAP_SCALE = 0.107;
const SOLAR_MAP_ANIMATION_SPEED = 0.08;
const SUN_BURN_DURATION = 260;
const SUN_BURN_DAMAGE = 3.6;
const SUN_BURN_TICK = 18;
const SAFE_DIVER_SPEED = 0.55;
const DIVER_RANGE = 140;
const DIVER_SPEED = 2.4;

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

// Sound engine is provided by sfx.js (loaded before this script in index_gossamer.html).

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


// Naval enemy constants are in enemies.js (loaded first)

const SUPPLY_DROP_INTERVAL = 600;
const SUPPLY_DROP_FALL_SPEED = 0.8;
const SUPPLY_DROP_COLLECT_RADIUS = 28;
const SUPPLY_DROP_PUSH_SPEED = 1.8;
const SUPPLY_DROP_BREAK_SPEED = 3.5;  // Hit a crate faster than this and it disintegrates
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

function collectSupply(sub, isSeabed) {
  if (isSeabed) {
    // Seabed crates yield special items — rare and valuable
    const specials = [
      { type: 'railgun', msg: 'Seabed cache: +3 RAILGUN rounds' },
      { type: 'bbomb', msg: 'Seabed cache: +2 BOUNCING BOMBS' },
      { type: 'repair', msg: 'Seabed cache: HULL REPAIR KIT' },
      { type: 'mega', msg: 'Seabed cache: FULL RESUPPLY' },
    ];
    const pick = specials[Math.floor(Math.random() * specials.length)];
    if (pick.type === 'railgun') {
      sub.railgunAmmo = Math.min(RAILGUN_MAX_AMMO, (sub.railgunAmmo || 0) + 3);
    } else if (pick.type === 'bbomb') {
      sub.bouncingBombAmmo = Math.min(BBOMB_MAX_AMMO, (sub.bouncingBombAmmo || 0) + 2);
    } else if (pick.type === 'repair') {
      // Repair all parts by 30%
      for (const key of Object.keys(sub.parts)) {
        if (sub.parts[key] && typeof sub.parts[key].hp === 'number') {
          sub.parts[key].hp = Math.min(sub.parts[key].maxHp || 100, sub.parts[key].hp + 30);
        }
      }
    } else if (pick.type === 'mega') {
      sub.torpedoAmmo = START_TORPEDOES;
      sub.missileAmmo = START_MISSILES;
      sub.depthChargeAmmo = START_DEPTH_CHARGES;
      sub.railgunAmmo = RAILGUN_MAX_AMMO;
      sub.bouncingBombAmmo = BBOMB_MAX_AMMO;
    }
    midNotice(pick.msg, 100);
  } else {
    const refillTorpedo = 6;
    const refillMissile = 3;
    const refillDepthCharge = 2;
    sub.torpedoAmmo = Math.min(START_TORPEDOES, sub.torpedoAmmo + refillTorpedo);
    sub.missileAmmo = Math.min(START_MISSILES, sub.missileAmmo + refillMissile);
    sub.depthChargeAmmo = Math.min(START_DEPTH_CHARGES, sub.depthChargeAmmo + refillDepthCharge);
    ticker('Supply collected', 50);
  }
  SFX.embark();
}

function updateAmmoStations(world, dt) {
  // Spawn new supply drops based on frequency setting
  const freq = getSupplyFrequency(world.settings);
  if (freq.id !== 'none' && freq.id !== 'unlimited') {
    if (!world.supplyDropTimer) world.supplyDropTimer = SUPPLY_DROP_INTERVAL * freq.interval * 0.3;
    world.supplyDropTimer -= dt;
    if (world.supplyDropTimer <= 0) {
      world.supplyDropTimer = (SUPPLY_DROP_INTERVAL + Math.random() * 200) * freq.interval;
      world.ammoStations.push(spawnSupplyDrop());
    }
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

      // Sub slow contact = collect, medium = push, fast = disintegrate
      if (!sub.disembarked) {
        const dist = Math.hypot(sub.worldX - drop.x, sub.y - drop.y);
        if (dist < SUPPLY_DROP_COLLECT_RADIUS) {
          const speed = Math.hypot(sub.vx, sub.vy);
          if (speed >= SUPPLY_DROP_BREAK_SPEED) {
            // Too fast — crate smashes apart
            drop.state = 'collected'; // Remove it
            addParticles(drop.x, drop.y, 8, '#92400e');
            addParticles(drop.x, drop.y, 4, '#d4a053');
            ticker('Crate destroyed!', 40);
          } else if (speed < SUPPLY_DROP_PUSH_SPEED) {
            collectSupply(sub, false);
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
      // Sub can push or break sinking crates but NOT collect — diver only underwater
      if (!sub.disembarked && sub.y > WATER_LINE) {
        const dist = Math.hypot(sub.worldX - drop.x, sub.y - drop.y);
        if (dist < SUPPLY_DROP_COLLECT_RADIUS) {
          const speed = Math.hypot(sub.vx, sub.vy);
          if (speed >= SUPPLY_DROP_BREAK_SPEED) {
            // Smashed it
            drop.state = 'collected';
            addParticles(drop.x, drop.y, 8, '#92400e');
            addParticles(drop.x, drop.y, 4, '#85c1e9');
            ticker('Crate destroyed!', 40);
          } else if (speed > 0.3) {
            // Push the crate — any contact knocks it around
            const dx = drop.x - sub.worldX;
            const dy = drop.y - sub.y;
            const pushForce = speed * 0.4;
            if (!drop.vx) drop.vx = 0;
            drop.vx += (dx > 0 ? 1 : -1) * pushForce;
            drop.vy += (dy > 0 ? 0.5 : -0.3) * pushForce;
            addParticles(drop.x, drop.y, 2, '#85c1e9');
          }
        }
      }
      // Apply horizontal drift from pushes
      if (drop.vx) {
        drop.x += drop.vx * dt;
        drop.vx *= 0.96; // Water drag
      }
      const groundY = getGroundY(drop.x);
      if (drop.y >= groundY - 6) {
        drop.state = 'sunk';
        drop.y = groundY - 6;
        drop.vx = 0;
      }
    } else if (drop.state === 'sunk') {
      // Sub can push/break seabed crates but NOT collect — diver only
      if (!sub.disembarked && sub.y > WATER_LINE) {
        const dist = Math.hypot(sub.worldX - drop.x, sub.y - drop.y);
        if (dist < SUPPLY_DROP_COLLECT_RADIUS) {
          const speed = Math.hypot(sub.vx, sub.vy);
          if (speed >= SUPPLY_DROP_BREAK_SPEED) {
            drop.state = 'collected';
            addParticles(drop.x, drop.y, 10, '#b8860b');
            addParticles(drop.x, drop.y, 5, '#fcd34d');
            ticker('Seabed crate destroyed!', 50);
          } else if (speed > 0.3) {
            // Push along the seabed
            const dx = drop.x - sub.worldX;
            if (!drop.vx) drop.vx = 0;
            drop.vx += (dx > 0 ? 1 : -1) * speed * 0.3;
            addParticles(drop.x, drop.y, 1, '#85c1e9');
          }
        }
      }
      // Diver picks it up with F — seabed crates yield special items
      if (sub.disembarked && sub.diverMode) {
        const dist = Math.hypot(sub.pilotX - drop.x, sub.pilotY - drop.y);
        if (dist < 30 && (keyJustPressed['f'] || keyJustPressed['F'])) {
          collectSupply(sub, true);
          drop.state = 'collected';
        }
      }
      // Seabed drift from pushes
      if (drop.vx) {
        drop.x += drop.vx * dt;
        drop.vx *= 0.92; // Heavier drag on seabed
      }
    } else if (drop.state === 'landed') {
      // Pilot on foot can pick up with F
      if (sub.disembarked && !sub.diverMode) {
        const dist = Math.hypot(sub.pilotX - drop.x, sub.pilotY - drop.y);
        if (dist < 30 && (keyJustPressed['f'] || keyJustPressed['F'])) {
          collectSupply(sub, false);
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

    // Crate body — seabed crates glow gold (special items)
    const isSeabed = drop.state === 'sunk';
    const glow = drop.state === 'floating' ? 0.7 + 0.3 * Math.sin(world.tick * 0.08 + drop.pulse)
      : isSeabed ? 0.6 + 0.4 * Math.sin(world.tick * 0.06 + drop.pulse) : 0.8;
    ctx.globalAlpha = glow;
    if (isSeabed) {
      // Gold glow halo for seabed special crates
      ctx.fillStyle = 'rgba(251, 191, 36, 0.15)';
      ctx.beginPath(); ctx.arc(sx, sy, 14, 0, TWO_PI); ctx.fill();
    }
    ctx.fillStyle = isSeabed ? '#b8860b' : '#92400e';
    ctx.fillRect(sx - 8, sy - 6, 16, 12);
    ctx.strokeStyle = isSeabed ? '#daa520' : '#78350f';
    ctx.lineWidth = 1;
    ctx.strokeRect(sx - 8, sy - 6, 16, 12);
    // Cross strapping
    ctx.strokeStyle = isSeabed ? '#fcd34d' : '#d4a053';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx - 8, sy - 6); ctx.lineTo(sx + 8, sy + 6);
    ctx.moveTo(sx + 8, sy - 6); ctx.lineTo(sx - 8, sy + 6);
    ctx.stroke();
    // Star on seabed crates
    if (isSeabed) {
      ctx.fillStyle = '#fcd34d';
      ctx.font = '8px Arial'; ctx.textAlign = 'center';
      ctx.fillText('\u2605', sx, sy + 3);
    }
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

// ── Evel Knievel Cameratron — mini-frame popup showing close-up of his jump ──
// When Evel jumps, a small inset frame appears in the corner like a TV cameratron
// showing a zoomed view of him mid-leap. Purely cosmetic, adds drama.
function drawEvelCameratron() {
  const cam = world._evelCameratron;
  if (!cam || !cam.active) return;
  cam.timer += 1;
  if (cam.timer > cam.maxTimer) { cam.active = false; return; }
  const evel = cam.evel;
  if (!evel || (!evel.alive && !evel.swimming)) { cam.active = false; return; }

  const fadeIn = Math.min(1, cam.timer / 15);
  const fadeOut = cam.timer > cam.maxTimer - 30 ? (cam.maxTimer - cam.timer) / 30 : 1;
  const alpha = fadeIn * fadeOut;
  if (alpha <= 0) return;

  // Frame position — top-right corner
  const fw = 120, fh = 80;
  const fx = W - fw - 12, fy = 12;

  ctx.save();
  ctx.globalAlpha = alpha * 0.95;

  // Frame background
  ctx.fillStyle = '#111';
  ctx.fillRect(fx - 2, fy - 2, fw + 4, fh + 4);
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(fx, fy, fw, fh);

  // Clip to frame
  ctx.beginPath();
  ctx.rect(fx, fy, fw, fh);
  ctx.clip();

  // Zoomed view centred on Evel (3x zoom)
  const zoom = 3;
  const centerX = fx + fw / 2;
  const centerY = fy + fh / 2;

  ctx.translate(centerX, centerY);
  ctx.scale(zoom, zoom);
  ctx.translate(-evel.x * 0 - toScreen(evel.x) + toScreen(evel.x), 0);

  // Simple representation of Evel in the frame
  const evelDir = evel.vx >= 0 ? 1 : -1;
  // Sky gradient
  ctx.fillStyle = '#1a1a3a';
  ctx.fillRect(-fw, -fh, fw * 2, fh * 2);
  // Water line
  ctx.fillStyle = '#1a3a5c';
  const waterInFrame = (WATER_LINE - evel.y) || 20;
  ctx.fillRect(-fw, waterInFrame, fw * 2, fh);

  // Evel himself (zoomed)
  ctx.save();
  ctx.scale(evelDir, 1);
  // Bike
  ctx.fillStyle = '#e2e8f0';
  ctx.fillRect(-8, 2, 16, 4);
  ctx.fillStyle = '#94a3b8';
  ctx.beginPath(); ctx.arc(-6, 6, 3, 0, TWO_PI); ctx.fill();
  ctx.beginPath(); ctx.arc(6, 6, 3, 0, TWO_PI); ctx.fill();
  // Exhaust
  if (evel.jumping) {
    ctx.fillStyle = '#f97316';
    ctx.beginPath(); ctx.moveTo(-10, 3); ctx.lineTo(-16, 4); ctx.lineTo(-10, 5); ctx.fill();
  }
  // Rider
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(-2, -6, 4, 8);
  ctx.beginPath(); ctx.arc(0, -8, 3.5, 0, TWO_PI); ctx.fill();
  ctx.fillStyle = '#3b82f6';
  ctx.fillRect(1, -9, 3, 2);
  // Cape
  ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-2, -5);
  ctx.quadraticCurveTo(-8 - Math.sin(world.tick * 0.1) * 3, -8, -6 - Math.sin(world.tick * 0.15) * 4, -3);
  ctx.stroke();
  ctx.restore();

  ctx.restore(); // Undo zoom transform

  // Frame border + label
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = '#ef4444';
  ctx.lineWidth = 2;
  ctx.strokeRect(fx - 2, fy - 2, fw + 4, fh + 4);
  // "CAMERATRON" label
  ctx.fillStyle = '#ef4444';
  ctx.font = 'bold 8px Arial'; ctx.textAlign = 'center';
  ctx.fillText('CAMERATRON', fx + fw / 2, fy + fh + 10);
  // Blinking REC dot
  if (Math.floor(cam.timer / 15) % 2 === 0) {
    ctx.fillStyle = '#ef4444';
    ctx.beginPath(); ctx.arc(fx + 8, fy + 8, 3, 0, TWO_PI); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '7px Arial'; ctx.textAlign = 'left';
    ctx.fillText('REC', fx + 14, fy + 11);
  }

  ctx.restore();
}

function generateMines(terrain) {
  const mines = [];
  // Enforce reasonable spacing: no two mine floats should be nearer than this.
  // Uses 2D distance so horizontally-close mines at different heights are still
  // allowed (they form a vertical curtain instead of a flat cluster).
  const MIN_SPACING_XY = 70;
  const MAX_PLACEMENT_ATTEMPTS = 40;

  // Helper — true if a candidate (x, y) is far enough from every placed mine.
  function farEnough(candX, candY) {
    for (const m of mines) {
      const dx = m.x - candX;
      const dy = m.y - candY;
      if (dx * dx + dy * dy < MIN_SPACING_XY * MIN_SPACING_XY) return false;
    }
    return true;
  }

  const islandCount = terrain.islands.length;
  for (let i = 0; i < MINE_COUNT; i++) {
    let placed = false;
    for (let attempt = 0; attempt < MAX_PLACEMENT_ATTEMPTS && !placed; attempt++) {
      // Mix of island-anchored and open-water mines. Open-water mines spread
      // the field along the whole corridor instead of clumping near islands.
      let x;
      const openWater = Math.random() < 0.35 || islandCount === 0;
      if (openWater) {
        x = 400 + Math.random() * Math.max(800, TERRAIN_LENGTH - 800);
      } else {
        const isl = terrain.islands[Math.floor(Math.random() * islandCount)];
        const spread = Math.max(140, isl.baseW * 1.6);
        x = isl.x + (Math.random() - 0.5) * spread;
      }
      const seaFloorY = groundYFromTerrain(terrain, x);
      // Mine zone determines chain length and difficulty:
      // - Middle zone (thermocline): longer chains, easier to detach
      // - Deep zone: shorter chains anchored near floor, harder to cut
      // - Shallow: typical WW2 harbour mine
      const zoneRoll = Math.random();
      let chainLen;
      if (zoneRoll < 0.35) {
        chainLen = 100 + Math.random() * 80;  // long chains, up into thermocline
      } else if (zoneRoll < 0.65) {
        chainLen = 15 + Math.random() * 30;   // short, deep
      } else {
        chainLen = 45 + Math.random() * 55;   // standard shallow
      }
      const anchorY = seaFloorY - 4;
      const floatY = Math.max(WATER_LINE + 12, anchorY - chainLen);
      if (!farEnough(x, floatY)) continue;
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
        chainFuse: 0,  // Ticks until domino-chain detonation fires
      });
      placed = true;
    }
    // If we couldn't place this one after many attempts, the field is dense
    // enough — drop it rather than cram another overlap in.
  }
  return mines;
}

function updateMines(world, dt) {
  const sub = world.sub;
  for (const mine of world.mines) {
    if (!mine.active) continue;
    mine.pulse += dt * 0.04;
    mine.swayPhase += mine.swaySpeed * dt;

    // Chain-detonation fuse (set by triggerMine on a neighbour) — tick down
    // and cook off when it reaches zero. The flashing pulse speeds up as the
    // fuse burns so the player can see the cascade coming.
    if (mine.chainFuse > 0) {
      mine.chainFuse -= dt;
      mine.pulse += dt * 0.25; // rapid blink
      if (mine.chainFuse <= 0) {
        triggerMine(world, mine);
        continue;
      }
    }

    // --- Freed mine: floating upward ---
    if (mine.freed) {
      mine.floatVy = Math.max(-1.2, mine.floatVy - 0.02 * dt); // Accelerate upward
      mine.y += mine.floatVy * dt;
      mine.x += Math.sin(mine.swayPhase) * 0.1 * dt; // Slight lateral drift

      // Hit sub — lethal, obliterates sub + commander
      const subDist = Math.hypot(sub.worldX - mine.x, sub.y - mine.y);
      if (subDist < MINE_RADIUS + 12) {
        triggerMine(world, mine);
        obliterateSubByMine(world);
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
      obliterateSubByMine(world);
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

// Record the cause of death once. Don't overwrite — the FIRST thing that
// killed you is what gets reported on the scoring screen. (If the sub explodes
// from mine damage, we don't want a subsequent "hull destroyed" check to
// re-brand it as a boring hull breach.)
function setDeathCause(world, cause, detail) {
  if (world.deathCause) return;
  world.deathCause = { cause, detail: detail || null };
}

// A direct mine hit is catastrophic: the sub is utterly destroyed and the
// commander is killed. Used by both "chained mine" and "freed mine" collision
// paths so the end-of-mission screen consistently shows the full carnage.
function obliterateSubByMine(world) {
  setDeathCause(world, 'mine');
  const sub = world.sub;
  // Every part to zero — not just the hull — so the scoring screen shows
  // every bar empty.
  for (const def of SUB_PARTS) sub.parts[def.id] = 0;
  sub.commanderHp = 0;
  world.gameOver = true;
  world.caveMessage = { text: 'MINE — SUB AND COMMANDER LOST', timer: 240 };
  addExplosion(sub.worldX, sub.y, 'big');
  addExplosion(sub.worldX - 8, sub.y + 4, 'big');
  addExplosion(sub.worldX + 8, sub.y - 4, 'big');
  addParticles(sub.worldX, sub.y, 40, '#ef4444');
  SFX.gameOver();
}

// Domino chain radius — any other active mine within this distance of a
// detonating mine gets a short fuse and cooks off, which cascades if several
// mines were placed as a cluster. Each link in the chain adds a tiny delay
// so the blasts arrive in a rolling wave, not simultaneously.
const MINE_CHAIN_RADIUS = 80;
const MINE_CHAIN_FUSE_BASE = 6;   // ticks before neighbour lights
const MINE_CHAIN_FUSE_JITTER = 6; // random extra ticks per neighbour

function triggerMine(world, mine) {
  if (!mine.active) return;
  mine.active = false;
  addExplosion(mine.x, mine.y, 'big');
  addParticles(mine.x, mine.y, 16, '#f44336');
  damageRandomPart(world.sub.parts, MINE_DAMAGE);
  world.score += 120;

  // Domino: every nearby active mine lights its fuse. The fuse is processed
  // in updateMines so the explosion visually cascades across the cluster.
  for (const other of world.mines) {
    if (other === mine || !other.active) continue;
    if (other.chainFuse > 0) continue; // Already ticking
    const dx = other.x - mine.x;
    const dy = other.y - mine.y;
    if (dx * dx + dy * dy <= MINE_CHAIN_RADIUS * MINE_CHAIN_RADIUS) {
      other.chainFuse = MINE_CHAIN_FUSE_BASE + Math.random() * MINE_CHAIN_FUSE_JITTER;
    }
  }
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

// ── Air enemy systems extracted to enemies.js ──
// Sopwith Camel, Su-47 Berkut, Lightning, Nemesis + chaff drawing


// --- Damage system ---
function createParts() {
  const parts = {};
  for (const def of SUB_PARTS) parts[def.id] = def.maxHp;
  return parts;
}

// Deal damage to a random part (weighted). Returns the part hit.
// Heavy hits (amount >= 20) have a chance to injure the commander.
function damageRandomPart(parts, amount) {
  const totalWeight = SUB_PARTS.reduce((s, p) => s + (parts[p.id] > 0 ? p.weight : 0), 0);
  if (totalWeight <= 0) return null;
  let roll = Math.random() * totalWeight;
  for (const def of SUB_PARTS) {
    if (parts[def.id] <= 0) continue;
    roll -= def.weight;
    if (roll <= 0) {
      parts[def.id] = Math.max(0, parts[def.id] - amount);
      // Commander takes injury on heavy hits (hull or tower) or critical damage
      if (world && world.sub && world.sub.commanderHp > 0) {
        const injuryChance = amount >= 40 ? 0.5 : amount >= 20 ? 0.2 : 0;
        if ((def.id === 'hull' || def.id === 'tower') && Math.random() < injuryChance) {
          world.sub.commanderHp--;
          world.caveMessage = { text: `COMMANDER HIT — ${commanderStatusLabel(world.sub.commanderHp)}`, timer: 100 };
          SFX.damage();
          if (world.sub.commanderHp <= 0) {
            world.caveMessage = { text: 'COMMANDER KIA — MISSION OVER', timer: 200 };
            world.gameOver = true;
            setDeathCause(world, 'commander-shot');
            SFX.gameOver();
          }
        }
      }
      return def;
    }
  }
  return null;
}

// Commander status based on remaining HP
function commanderStatusLabel(hp) {
  if (hp >= COMMANDER_MAX_HP) return 'ALIVE';
  if (hp === 2) return 'INJURED';
  if (hp === 1) return 'GRIEVOUS INJURIES';
  return 'DEAD';
}

// Component condition label for scoring
function componentConditionLabel(currentHp, maxHp) {
  const pct = currentHp / maxHp;
  if (pct >= 1.0) return 'Pristine';
  if (pct > 0.6)  return 'Cosmetic';
  if (pct > 0.25) return 'Damaged';
  if (pct > 0)    return 'Severely Damaged';
  return 'Destroyed';
}

// Component condition colour for display
function componentConditionColor(currentHp, maxHp) {
  const pct = currentHp / maxHp;
  if (pct >= 1.0) return '#2ecc71';
  if (pct > 0.6)  return '#a3e635';
  if (pct > 0.25) return '#f59e0b';
  if (pct > 0)    return '#ef4444';
  return '#555';
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
function clamp(v, lo, hi)      { return Math.max(lo, Math.min(hi, v)); }

function velocityToMph(vx, vy, mode) {
  const scale = mode === 'orbit' ? SPACE_MPH_PER_GAME_SPEED : MPH_PER_GAME_SPEED;
  return Math.hypot(vx, vy) * scale;
}


function isSubStationaryForDiver(sub) {
  return Math.hypot(sub.vx, sub.vy) <= SAFE_DIVER_SPEED && !sub.liftingOff && !sub.periscopeMode;
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
  world.hasWarped = true;
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
    commanderStatus: commanderStatusLabel(world.sub.commanderHp),
    hullIntegrity: Math.ceil(overallHealth(world.sub.parts)),
    recordedAt: new Date().toISOString(),
  });
  world.leaderboardRecorded = true;
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
    completed: false,
    killTarget: def.killTarget || 0,
    killCount: 0,
    escortShipAlive: true,
  };
  const secs = Math.round((def.duration || 0) / 60);
  if (typeKey === 'hostage' && def.hostageCount) {
    world.hostages = spawnHostages(def.hostageCount);
    const count = world.hostages.length;
    world.caveMessage = { text: `MISSION: RESCUE ${count} HOSTAGES — ${secs}s`, timer: 150 };
  } else if (typeKey === 'strike') {
    world.mission.killCount = 0;
    world.mission._lastKnownKills = world.kills;
    world.caveMessage = { text: `MISSION: DESTROY ${def.killTarget} TARGETS — ${secs}s`, timer: 150 };
  } else if (typeKey === 'escort') {
    // Ensure passenger ship is alive for escort
    if (world.terrain.passengerShip) {
      world.terrain.passengerShip.hp = Math.max(world.terrain.passengerShip.hp, 30);
      world.terrain.passengerShip.destroyed = false;
    }
    world.caveMessage = { text: `MISSION: ESCORT PASSENGER SHIP — ${secs}s`, timer: 150 };
  } else if (def.timed) {
    world.caveMessage = { text: `MISSION: ${def.label} — ${secs}s`, timer: 120 };
  }
}

function updateMissionTimer(dt) {
  const m = world.mission;
  if (!m || !m.active || !m.timed) return;
  m.timer -= dt;

  // Helper: record mission result to VeriSimDB
  function finishMission(outcome) {
    if (typeof verisimdbRecordMission === 'function') {
      verisimdbRecordMission({
        type: m.type, label: m.label, outcome,
        score: world.score, kills: world.kills,
        duration: (m.timer > 0) ? ((MISSION_TYPES[m.type]?.duration || 0) - m.timer) : (MISSION_TYPES[m.type]?.duration || 0),
      });
    }
  }

  // Strike mission: check kill objective
  if (m.type === 'strike' && m.killTarget > 0 && m.killCount >= m.killTarget) {
    m.active = false;
    m.completed = true;
    world.score += STRIKE_COMPLETE_BONUS;
    world.caveMessage = { text: `STRIKE COMPLETE! +${STRIKE_COMPLETE_BONUS}pts`, timer: 150 };
    finishMission('completed');
    return;
  }

  // Escort mission: check if passenger ship was destroyed
  if (m.type === 'escort') {
    const ship = world.terrain.passengerShip;
    if (ship && ship.destroyed) {
      m.active = false;
      m.failed = true;
      world.caveMessage = { text: 'MISSION FAILED: PASSENGER SHIP DESTROYED', timer: 200 };
      world.gameOver = true;
      setDeathCause(world, 'civilian-ship');
      SFX.gameOver();
      finishMission('failed_ship_destroyed');
      return;
    }
    // Escort succeeds when timer runs out (survived the full duration)
    if (m.timer <= 0) {
      m.timer = 0;
      m.active = false;
      m.completed = true;
      world.score += ESCORT_COMPLETE_BONUS;
      world.caveMessage = { text: `ESCORT COMPLETE! Ship safe. +${ESCORT_COMPLETE_BONUS}pts`, timer: 150 };
      finishMission('completed');
      return;
    }
  }

  // General timeout
  if (m.timer <= 0) {
    m.timer = 0;
    m.failed = true;
    m.active = false;
    if (m.mandatory) {
      world.caveMessage = { text: `MISSION FAILED: ${m.label} — TIME EXPIRED`, timer: 200 };
      world.gameOver = true;
      setDeathCause(world, 'timeout', m.label);
      SFX.gameOver();
      finishMission('failed_timeout_mandatory');
    } else {
      world.caveMessage = { text: `TIME EXPIRED: ${m.label} — bonus lost`, timer: 150 };
      finishMission('failed_timeout');
    }
  }
}

// Track strike kills by watching world.kills — called every frame
function updateStrikeKills() {
  const m = world.mission;
  if (!m || !m.active || m.type !== 'strike') return;
  // Detect new kills since last check
  const prevKills = m._lastKnownKills || 0;
  const newKills = world.kills - prevKills;
  m._lastKnownKills = world.kills;
  if (newKills > 0) {
    m.killCount += newKills;
    world.score += STRIKE_KILL_BONUS * newKills;
    const remaining = m.killTarget - m.killCount;
    if (remaining > 0) {
      world.caveMessage = { text: `TARGET DOWN — ${remaining} remaining`, timer: 60 };
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
  // Show mission-specific progress
  if (m.type === 'hostage' && world.hostages && world.hostages.length > 0) {
    const rescued = world.hostages.filter(h => h.rescued).length;
    const total = world.hostages.length;
    ctx.fillText(`${m.label} — ${rescued}/${total}`, W / 2, 38);
  } else if (m.type === 'strike' && m.killTarget > 0) {
    ctx.fillText(`${m.label} — ${m.killCount}/${m.killTarget} kills`, W / 2, 38);
  } else if (m.type === 'escort') {
    const ship = world.terrain.passengerShip;
    const shipHp = ship ? Math.round((ship.hp / (ship.maxHp || 60)) * 100) : 0;
    ctx.fillText(`${m.label} — Ship: ${shipHp}%`, W / 2, 38);
  } else {
    ctx.fillText(m.label, W / 2, 38);
  }
}

// ============================================================
// HOSTAGE RESCUE SYSTEM
// Places hostages on random islands when a hostage mission starts.
// Sub must approach each island to rescue. All must be rescued
// before the timer expires or the mission fails (game over).
// ============================================================

function spawnHostages(count) {
  const islands = world.terrain.islands;
  if (islands.length === 0) return [];
  // Pick distinct islands — shuffle and take first N
  const shuffled = [...islands].sort(() => Math.random() - 0.5);
  const chosen = shuffled.slice(0, Math.min(count, shuffled.length));
  return chosen.map(isl => ({
    x: isl.x,
    y: WATER_LINE - isl.h - 6,   // Standing on top of island
    island: isl,
    rescued: false,
    rescueAnim: 0,                // Fade-out animation timer after rescue
    flareTimer: Math.random() * HOSTAGE_FLARE_INTERVAL, // Staggered flares
  }));
}

function updateHostages(dt) {
  if (!world.hostages || world.hostages.length === 0) return;
  const sub = world.sub;
  for (const h of world.hostages) {
    if (h.rescued) {
      h.rescueAnim = Math.max(0, h.rescueAnim - dt);
      continue;
    }
    // Signal flare timer
    h.flareTimer += dt;
    // Rescue proximity check. Two valid modes:
    //   (a) Sub floating at waterline alongside the island (original style)
    //   (b) Sub hovering above the hostage with the rescue ladder down — the
    //       hostage climbs up. Without the VTOL upgrade this is very hard to
    //       line up, because the sub won't hold station.
    const dx = Math.abs(sub.worldX - h.x);
    const dy = Math.abs(sub.y - h.y);
    const ladderReach = sub.ladderDeployed ? sub.ladderLength + 6 : 0;
    const ladderTipY = sub.y + ladderReach;
    const ladderAt = sub.ladderDeployed
      && Math.abs(sub.worldX - h.x) < 14
      && Math.abs(ladderTipY - h.y) < 14
      && Math.hypot(sub.vx, sub.vy) < (sub.vtolUpgrade ? 1.2 : 0.25); // stable enough?
    if ((dx < HOSTAGE_RESCUE_RANGE && dy < HOSTAGE_RESCUE_RANGE + 30 && sub.floating) || ladderAt) {
      h.rescued = true;
      h.rescueAnim = 60;
      world.score += HOSTAGE_SCORE_BONUS;
      world.caveMessage = { text: 'HOSTAGE RESCUED! +1000pts', timer: 80 };
      SFX.pickup?.() ?? SFX.damage();
      // Check if all rescued
      const remaining = world.hostages.filter(hh => !hh.rescued).length;
      if (remaining === 0) {
        world.caveMessage = { text: 'ALL HOSTAGES RESCUED — MISSION COMPLETE!', timer: 150 };
        world.mission.active = false;
        world.mission.completed = true;
        world.score += HOSTAGE_SCORE_BONUS * 2; // Completion bonus
        if (typeof verisimdbRecordMission === 'function') {
          verisimdbRecordMission({ type: 'hostage', outcome: 'completed', score: world.score, kills: world.kills });
        }
      } else {
        world.caveMessage = { text: `HOSTAGE RESCUED — ${remaining} REMAINING`, timer: 80 };
      }
    }
  }
}

function drawHostages() {
  if (!world.hostages || world.hostages.length === 0) return;
  for (const h of world.hostages) {
    const sx = toScreen(h.x);
    if (sx < -40 || sx > W + 40) continue;
    if (h.rescued) {
      // Fade-out "+RESCUED" text
      if (h.rescueAnim > 0) {
        const alpha = h.rescueAnim / 60;
        ctx.fillStyle = `rgba(46, 204, 113, ${alpha})`;
        ctx.font = 'bold 10px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('RESCUED', sx, h.y - 15 - (60 - h.rescueAnim) * 0.3);
      }
      continue;
    }
    // Draw hostage figure (small person waving)
    const bobY = Math.sin(world.tick * 0.06 + h.x) * 1.5;
    const hy = h.y + bobY;
    // Body
    ctx.fillStyle = '#f39c12';
    ctx.fillRect(sx - 2, hy - 8, 4, 8);
    // Head
    ctx.fillStyle = '#ffeaa7';
    ctx.beginPath();
    ctx.arc(sx, hy - 11, 3, 0, Math.PI * 2);
    ctx.fill();
    // Waving arm
    const armAngle = Math.sin(world.tick * 0.12 + h.x) * 0.6;
    ctx.strokeStyle = '#f39c12';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(sx + 2, hy - 6);
    ctx.lineTo(sx + 2 + Math.cos(armAngle - 1) * 6, hy - 6 + Math.sin(armAngle - 1) * 6);
    ctx.stroke();
    // Signal flare (periodic red glow above head)
    if (h.flareTimer % HOSTAGE_FLARE_INTERVAL < 30) {
      const flareAlpha = 1 - (h.flareTimer % HOSTAGE_FLARE_INTERVAL) / 30;
      const flareY = hy - 18 - (h.flareTimer % HOSTAGE_FLARE_INTERVAL) * 0.5;
      ctx.fillStyle = `rgba(255, 60, 60, ${flareAlpha * 0.8})`;
      ctx.beginPath();
      ctx.arc(sx, flareY, 3 + flareAlpha * 2, 0, Math.PI * 2);
      ctx.fill();
    }
    // "HELP" label
    ctx.fillStyle = '#e74c3c';
    ctx.font = 'bold 8px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('HELP', sx, hy - 18);
  }
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


// ── Naval enemy systems extracted to enemies.js ──
// Destroyer, Interceptor boats, Akula-Molot, Delfin, Passenger ship



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
    lastSolarBodyId: 'earth',
    currentPlanet: 0,
    planetPalette: PLANETS[0],
    currentDestination: PLANET_DESTINATIONS[0],
    sunBurnTimer: 0,
    sunBurnTick: 0,
    sub: {
      worldX: terrain.startPort.x, // Start inside home port hangar
      y: WATER_LINE - 15,          // Sitting on hangar dock (above waterline)
      vx: 0, vy: 0,
      angle: 0,
      facing: 1,        // 1 = right, -1 = left
      parts: createParts(),
      wasInWater: false,
      floating: true,    // On dock = floating state
      liftingOff: false,
      disembarked: false,
      disembarkIsland: null,
      diverMode: false,
      pilotX: 0, pilotY: 0,
      pilotVx: 0,
      pilotVy: 0,
      pilotOnGround: true,
      diving: false,
      periscopeMode: false,   // Starts retracted in hangar; auto-extends on water
      periscopeDepth: 0,
      _periscopeManualCooldown: 60, // Brief cooldown so auto-extend doesn't trigger immediately in hangar
      torpedoAmmo: START_TORPEDOES,
      missileAmmo: START_MISSILES,
      depthChargeAmmo: START_DEPTH_CHARGES,
      railgunAmmo: RAILGUN_MAX_AMMO,
      bouncingBombAmmo: BBOMB_MAX_AMMO,
      afterburnerCharge: AFTERBURNER_MAX_CHARGE,
      afterburnerActive: false,
      caterpillarDrive: false,
      commanderHp: COMMANDER_MAX_HP,
      commanderAimAngle: 0,       // Swivel angle for disembarked aiming (z/x)
      commanderGrenades: CMDR_GRENADE_MAX,
      commanderPpcAmmo: CMDR_PPC_AMMO,
      // Rescue ladder — toggled with CapsLock. Drops from the sub's belly
      // and can pluck hostages / Evel off islands without disembarking.
      // Effectively useless without the VTOL upgrade because you can't hold
      // position steady enough to line up the winch.
      ladderDeployed: false,
      ladderLength: 0,            // Current extended length (animates)
      vtolUpgrade: false,         // Unlocked later — lets sub hover stable
      ladderPassenger: null,      // {kind, ref} if something is clinging on
      ladderShakeAccum: 0,        // Builds up while player swings erratically
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
    sopwith: createSopwith(terrain),
    airSupremacy: null,        // Spawns mid-game — Su-47 Berkut
    airInterceptors: [],       // Lightning squadrons
    airInterceptorTimer: 0,
    nemesis: null,             // Mini airborne-sub, toggle/higher levels
    // Red Arrow squadron — two smaller wingmen subs
    squadron: createSquadron(),
    squadronMode: 'off',       // off by default; Q to cycle: general, aqua, aero, terra, astro
    _evelCameratron: null,     // Cameratron popup state for Evel Knievel jumps
    score: 0,
    kills: 0,
    // Weapon selection: 1 = torpedo/pistol, 2 = missile/grenade, 3 = depth charge, 9 = PPC
    selectedWeapon: 1,
    commanderWeapon: 1,
    fireCooldown: 0,
    missileCooldown: 0,
    depthChargeCooldown: 0,
    commanderFireCooldown: 0,
    enemyTimer: 0,
    gameOver: false,
    deathCause: null,  // { cause, detail } set when gameOver is triggered
    // Game mode chosen on the splash menu. Currently only 'airborne' is
    // playable; 'subcommando' is reserved for v2.
    gameMode: (typeof window !== 'undefined' && window.__chosenGameMode) || 'airborne',
    quitConfirm: false,
    paused: false,
    menuOpen: false,
    thrustSoundTimer: 0,
    ejectPrimeTimer: 0,
    disembarkPrimeTimer: 0,
    divingBell: null,
    airEject: null,
    gunPost: null,
    gunPostBullets: [],
    subMgBullets: [],       // Sub machine gun projectiles
    railgunShots: [],       // Gauss railgun projectiles
    bouncingBombs: [],      // Barnes Wallis bouncing bombs
    commanderBullets: [],   // Pistol/grenade/PPC projectiles from disembarked commander
    subInCave: null,     // Reference to cave the sub is hiding in
    mission: { type: 'patrol', timer: 0, active: false, failed: false, completed: false },
    hostages: [],
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
  // markReady() is guaranteed to fire via the finally block so the splash
  // screen always becomes dismissable, even if something in world init throws.
  try {
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

    requestAnimationFrame(gameLoop);
  } catch (e) {
    // World init failed — attempt a bare-minimum fallback world so the game
    // loop at least has something to render, then let the splash clear.
    console.error('[ASS] init() failed:', e);
    if (!world) {
      try { world = initWorld(); } catch (e2) {
        console.error('[ASS] Fallback initWorld() also failed:', e2);
      }
    }
    if (world) requestAnimationFrame(gameLoop);
  } finally {
    // Always unblock the splash screen regardless of init outcome.
    const splash = window.__gossamerSplash;
    if (splash && typeof splash.markReady === 'function') splash.markReady();
  }
}

let lastTime = 0;
let _splashCleared = false;
function gameLoop(ts) {
  const dt = Math.min(ts - lastTime, 32);
  lastTime = ts;

  // Don't process game input while the splash screen is still covering the canvas.
  // Keys pressed to dismiss the splash would otherwise register as game thrust/fire,
  // launching the sub uncontrollably on the first visible frame.
  const splashEl = document.getElementById('loading');
  const splashActive = splashEl && splashEl.style.display !== 'none'
                     && !splashEl.classList.contains('splash-complete');
  if (!splashActive && !_splashCleared) {
    // Splash just finished — flush all key state so nothing from the
    // dismiss interaction bleeds into the game.
    _splashCleared = true;
    for (const k in keys) delete keys[k];
    for (const k in keyJustPressed) delete keyJustPressed[k];
  }

  if (!splashActive && !world.gameOver && !world.paused) update(dt / 16);
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

// Rebind state: null = normal pause, string = waiting for key for that action
let rebindAction = null;
const REBIND_ACTIONS = ['fire', 'stabilise', 'afterburner', 'periscope', 'disembark', 'embark', 'emergencyEject', 'chaff', 'swivelLeft', 'swivelRight'];


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
  if (keyJustPressed['c'] || keyJustPressed['C']) {
    cycleSupplyFrequency(world.settings, 1);
  }
  if (keyJustPressed['n'] || keyJustPressed['N']) {
    // N is also "new game" below — only toggle nemesis when not in rebind mode
    // Use G for nemesis toggle instead to avoid conflict
  }
  if (keyJustPressed['g'] || keyJustPressed['G']) {
    world.settings.nemesisSub = !world.settings.nemesisSub;
    saveSettings(world.settings);
  }
  // Q: cycle squadron mode (off → general → aqua → aero → terra → astro → off)
  if (keyJustPressed['q'] || keyJustPressed['Q']) {
    const curIdx = SQUADRON_MODES.indexOf(world.squadronMode);
    const nextIdx = (curIdx + 1) % SQUADRON_MODES.length;
    world.squadronMode = SQUADRON_MODES[nextIdx];
    const label = world.squadronMode === 'off' ? 'SQUADRON: OFF' :
                  world.squadronMode === 'astro' ? 'SQUADRON: ASTRO (COMING SOON)' :
                  `SQUADRON: ${world.squadronMode.toUpperCase()}`;
    ticker(label, 50);
  }
  // Cycle through missions (M key) — only if no mission active
  if ((keyJustPressed['m'] || keyJustPressed['M']) && (!world.mission || !world.mission.active)) {
    const missionCycle = ['strike', 'hostage', 'escort'];
    const lastType = world.mission ? world.mission.type : 'patrol';
    const idx = missionCycle.indexOf(lastType);
    const nextType = missionCycle[(idx + 1) % missionCycle.length];
    startMission(nextType);
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
  // Quit — two-stage: first Q shows quit confirm, second Q closes to desktop
  if (keyJustPressed['q'] || keyJustPressed['Q']) {
    if (world.quitConfirm) {
      // Second Q — close to desktop with clean port release
      try { navigator.sendBeacon('/shutdown', ''); } catch {}
      try { window.close(); } catch {}
      // If window.close() is blocked (not opened by script), show message
      world.caveMessage = { text: 'Close this browser tab to exit', timer: 300 };
    } else {
      // First Q — show scoring screen and confirm prompt
      ensureLeaderboardRecorded('QUIT');
      world.quitConfirm = true;
      world.gameOver = true;
      setDeathCause(world, 'quit');
    }
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
  // Tick down the disembark confirmation timer (separate from eject prime)
  if (world.disembarkPrimeTimer > 0) world.disembarkPrimeTimer--;

  const wantsE = !!keyJustPressed['e'] || !!keyJustPressed['E'];
  if (!wantsE || sub.disembarked || world.divingBell) return;

  // Double-press E to confirm disembark — no eject warning
  if (world.disembarkPrimeTimer <= 0) {
    world.disembarkPrimeTimer = EJECT_PRIME_TIMEOUT;
    world.caveMessage = { text: 'PRESS E AGAIN TO DISEMBARK', timer: EJECT_PRIME_TIMEOUT };
    return;
  }

  // Second press within timeout — execute disembark
  world.disembarkPrimeTimer = 0;

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
      // Sub is now uncrewed — damaged from eject, will crash and sink
      sub.disembarked = false; // Sub is NOT docked — it's flying uncrewed
      sub._wrecked = true;     // Mark as wrecked — physics will make it crash and sink
      sub._wreckTimer = 0;     // Timer for wreck sequence
      // Eject blast damages the sub
      for (const key of Object.keys(sub.parts)) {
        if (sub.parts[key] && typeof sub.parts[key].hp === 'number') {
          sub.parts[key].hp = Math.max(1, sub.parts[key].hp - 20);
        }
      }
      midNotice(halo ? 'HALO EJECT — CHUTE DEPLOYS LOW' : 'EMERGENCY EJECT — SUB ABANDONED', 150);
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
  // Sub hits water — wrecked subs sink to the ocean floor
  if (sub.y >= WATER_LINE && sub.vy > 0) {
    addParticles(sub.worldX, WATER_LINE, 10, '#85c1e9');
    SFX.waterSplash();
    if (sub._wrecked) {
      // Wrecked sub sinks — slow descent with bubbles
      sub.vy = 0.5; // Steady sink rate
      sub.vx *= 0.3; // Water slows horizontal
      sub._sinking = true;
    } else {
      sub.vy *= 0.3;
    }
  }
  // Sinking wreck continues to the ocean floor
  if (sub._sinking) {
    sub.vy = Math.min(sub.vy + 0.02 * dt, 0.8); // Accelerate slowly
    sub.vx *= 0.97; // Water drag
    sub.angle += 0.003 * dt; // Slow tumble
    sub.worldX += sub.vx * dt;
    sub.y += sub.vy * dt;
    // Bubble trail as it sinks
    if (world.tick % 8 === 0) {
      addParticles(sub.worldX, sub.y - 5, 2, '#85c1e9');
    }
    // Hit the seabed
    const groundY = getGroundY(sub.worldX);
    if (sub.y >= groundY - 8) {
      sub.y = groundY - 8;
      sub.vy = 0; sub.vx = 0;
      sub._sinking = false;
      addParticles(sub.worldX, sub.y, 8, '#5d4037');
      ticker('Your sub hit the ocean floor', 80);
    }
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
    setDeathCause(world, 'eject-water');
  } else if (ej.pilotY >= pilotGroundY - 4) {
    ej.pilotY = pilotGroundY - 4;
    ej.landed = true;
    ej.pilotVy = 0;
    world.caveMessage = { text: 'COMMANDER LANDED — GAME OVER', timer: 200 };
    world.gameOver = true;
    setDeathCause(world, 'eject-ground');
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
        setDeathCause(world, 'eject-shot');
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
  // In orbit, use F+number for warp destinations (number keys alone are weapons now)
  const directWarpKey = ['4', '5'].find((k) => keyJustPressed[k]); // 4/5 don't conflict
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

  // --- Camera: smooth follow sub (or pilot when disembarked) ---
  const camFollowX = sub.disembarked ? sub.pilotX : sub.worldX;
  const camFollowY = sub.disembarked ? sub.pilotY : sub.y;
  const targetCamX = camFollowX - W * 0.4;
  world.cameraX += (targetCamX - world.cameraX) * CAMERA_SMOOTH * dt * 4;
  world.cameraX = Math.max(0, Math.min(TERRAIN_LENGTH - W, world.cameraX));

  // Vertical camera: follow sub (or pilot), keeping roughly in the middle
  const targetCamY = camFollowY - H * 0.45;
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
      // Gun post toggle with G (legacy MG emplacement)
      if ((keyJustPressed['g'] || keyJustPressed['G']) && !world.gunPost) {
        setupGunPost(sub);
      }
      if (world.gunPost) {
        updateGunPost(dt);
        // Don't return — world must keep updating (enemies, effects, etc.)
      } else {
      const dock = sub.disembarkIsland;
      const leftLimit = dock.x - dock.baseW / 2 + 4;
      const rightLimit = dock.x + dock.baseW / 2 - 4;
      // Movement: arrow keys or j/k
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

      // ── Trionic SubCommando weapons & z/x swivel ──
      // Z/X swivel aim (commander aims in a direction for shooting)
      const swivelSpeed = 0.04;
      if (keys['z'] || keys['Z']) sub.commanderAimAngle -= swivelSpeed * dt;
      if (keys['x'] || keys['X']) sub.commanderAimAngle += swivelSpeed * dt;
      sub.commanderAimAngle = Math.max(-Math.PI * 0.7, Math.min(Math.PI * 0.7, sub.commanderAimAngle));

      // Weapon selection: 1=pistol, 2=grenade, 9=PPC
      if (keyJustPressed['1']) { world.commanderWeapon = 1; ticker('Pistol selected', 35); }
      if (keyJustPressed['2']) { world.commanderWeapon = 2; ticker('Grenade selected', 35); }
      if (keyJustPressed['9']) { world.commanderWeapon = 9; ticker('PPC selected', 35); }

      // Spacebar fires selected commander weapon
      world.commanderFireCooldown = Math.max(0, world.commanderFireCooldown - dt);
      const cmdFire = keys[' '] || keys[keybinds.fire];
      const aimCos = Math.cos(sub.commanderAimAngle);
      const aimSin = Math.sin(sub.commanderAimAngle);

      if (cmdFire && world.commanderFireCooldown <= 0) {
        if (world.commanderWeapon === 1) {
          // Pistol — fast, infinite ammo
          world.commanderBullets.push({
            worldX: sub.pilotX, y: sub.pilotY - 4,
            vx: aimCos * CMDR_PISTOL_SPEED, vy: aimSin * CMDR_PISTOL_SPEED,
            life: CMDR_PISTOL_LIFE, damage: CMDR_PISTOL_DAMAGE, type: 'pistol',
          });
          world.commanderFireCooldown = CMDR_PISTOL_COOLDOWN;
        } else if (world.commanderWeapon === 2 && sub.commanderGrenades > 0) {
          // Grenade — arced trajectory, explodes on contact or timeout
          sub.commanderGrenades--;
          world.commanderBullets.push({
            worldX: sub.pilotX, y: sub.pilotY - 6,
            vx: aimCos * CMDR_GRENADE_SPEED, vy: aimSin * CMDR_GRENADE_SPEED - 1.5,
            life: CMDR_GRENADE_LIFE, damage: CMDR_GRENADE_DAMAGE, type: 'grenade',
            blastRadius: CMDR_GRENADE_BLAST_RADIUS,
          });
          world.commanderFireCooldown = CMDR_GRENADE_COOLDOWN;
          world.caveMessage = { text: `${sub.commanderGrenades} GRENADES LEFT`, timer: 40 };
        } else if (world.commanderWeapon === 9 && sub.commanderPpcAmmo > 0) {
          // PPC — devastating beam, long cooldown
          sub.commanderPpcAmmo--;
          world.commanderBullets.push({
            worldX: sub.pilotX, y: sub.pilotY - 4,
            vx: aimCos * CMDR_PPC_SPEED, vy: aimSin * CMDR_PPC_SPEED,
            life: CMDR_PPC_LIFE, damage: CMDR_PPC_DAMAGE, type: 'ppc',
          });
          world.commanderFireCooldown = CMDR_PPC_COOLDOWN;
          addParticles(sub.pilotX, sub.pilotY - 4, 12, '#ff00ff');
          SFX.explodeBig();
          world.caveMessage = { text: `PPC FIRED — ${sub.commanderPpcAmmo} CHARGES LEFT`, timer: 60 };
        }
      }
      } // Close the else block for gun post vs island movement
    }
    updateEnemies(dt);
    updateProjectiles(dt);
    updateNewProjectiles(dt);
    updateEffects(dt);
    updateTelemetry(dt, sub.vx, sub.vy, 'atmosphere');
    return;
  }

  if (world.chaffCooldown > 0) world.chaffCooldown = Math.max(0, world.chaffCooldown - dt);

  // ── Periscope system ──
  // Two modes toggled by Shift+P:
  //   AUTO periscope: extends when settled on water (stealth from air/radar), retracts in flight
  //   MANUAL periscope: never auto-extends — player has full control with P
  // P always toggles periscope on/off regardless of mode.
  // Flight always retracts (can't fly with periscope out).
  if (world.autoPeriscope === undefined) world.autoPeriscope = false; // Default: manual
  const inFlight = sub.y < WATER_LINE - 10 && !sub.floating;

  // Shift+P toggles auto/manual mode
  if ((keyJustPressed['p'] || keyJustPressed['P']) && keys['Shift']) {
    world.autoPeriscope = !world.autoPeriscope;
    ticker(world.autoPeriscope ? 'Auto periscope: ON — hides from air/radar' : 'Auto periscope: OFF — manual only', 60);
  } else {
    // P alone: manual toggle
    const periscopeToggle = keyJustPressed['p'] || keyJustPressed['P'];
    if (!sub.disembarked && periscopeToggle) {
      if (sub.periscopeMode) {
        exitPeriscopeMode(sub);
      } else if (sub.floating || sub.y > WATER_LINE) {
        enterPeriscopeMode(sub);
      }
    }
  }

  // Flight always retracts — can't fly with periscope deployed
  if (inFlight && sub.periscopeMode) {
    exitPeriscopeMode(sub);
    ticker('Periscope retracted — airborne', 35);
  }

  // Auto-extend when in AUTO mode and settled on water surface
  if (world.autoPeriscope && !sub.periscopeMode && !inFlight) {
    if (!sub._periscopeSettleTimer) sub._periscopeSettleTimer = 0;
    const settledOnSurface = sub.floating
      && sub.y >= WATER_LINE - 12 && sub.y <= WATER_LINE + 3
      && Math.abs(sub.vy) < 0.3 && Math.abs(sub.vx) < 1.5
      && !sub.liftingOff && !sub.diving;
    if (settledOnSurface) {
      sub._periscopeSettleTimer += dt;
    } else {
      sub._periscopeSettleTimer = 0;
    }
    if (sub._periscopeSettleTimer > 30) {
      enterPeriscopeMode(sub);
    }
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

    // Left Shift: stabiliser in all environments.
    // Air: horizontal stabilisation; wings hit → slight descent; tower red → disabled.
    // Water: flat stabilisation on both axes; hull hit → slight sinking; tower red → disabled.
    const wantStabilise = keys['Shift'] || keys[keybinds.stabilise];
    if (wantStabilise && !sub.disembarked) {
      const towerPct = sub.parts.tower / 70;
      const towerRed = towerPct <= 0.08;
      if (towerRed) {
        // Control area red/destroyed — stabiliser offline
      } else if (sub.y < WATER_LINE - 5 && !sub.floating) {
        // ── AIR: level out horizontally ──
        const wingPct = sub.parts.wings / 60;
        const eff = towerPct * (0.5 + wingPct * 0.5);
        sub.angle *= 1 - (0.2 * eff);
        sub.vy *= 1 - (0.08 * eff);
        sub.vx *= 1 - (0.02 * eff);
        if (wingPct < 0.5) sub.vy += 0.04 * (1 - wingPct) * dt;
      } else if (sub.y > WATER_LINE || sub.floating) {
        // ── WATER: strong stabilise — brings sub to near-stop ──
        const hullPct = sub.parts.hull / 120;
        const eff = towerPct * (0.5 + hullPct * 0.5);
        sub.vx *= 1 - (0.18 * eff);  // Much stronger than before
        sub.vy *= 1 - (0.18 * eff);  // Strong vertical damping
        sub.angle *= 1 - (0.25 * eff);
        if (hullPct < 0.5) sub.vy += 0.02 * (1 - hullPct) * dt;
      }
    }

    // S key: air brake / aqua brake — rapid deceleration
    // In air: deploys flaps, heavy drag on both axes, nose pitches up slightly
    // In water: reverse thrust, heavy drag, comes to near stop quickly
    // Engine must be functional to brake (no engine = no brake authority)
    if ((keys['s'] || keys['S']) && !sub.disembarked && sub.parts.engine > 0) {
      const enginePct = sub.parts.engine / 80;
      const brakeForce = 0.15 * enginePct;
      if (sub.y < WATER_LINE - 5 && !sub.floating) {
        // Air brake — flaps out, heavy drag
        sub.vx *= 1 - (brakeForce * dt);
        sub.vy *= 1 - (brakeForce * 0.6 * dt); // Less vertical damping in air
        sub.angle *= 1 - (0.05 * dt); // Nose levels slightly
        // Air brake particles (flap turbulence)
        if (world.tick % 4 === 0 && Math.abs(sub.vx) > 0.5) {
          addParticles(sub.worldX - sub.facing * 12, sub.y - 4, 1, '#94a3b8');
          addParticles(sub.worldX - sub.facing * 12, sub.y + 4, 1, '#94a3b8');
        }
      } else if (sub.y > WATER_LINE || sub.floating) {
        // Aqua brake — reverse thrust, heavy drag on all axes
        sub.vx *= 1 - (brakeForce * 1.2 * dt); // Stronger in water (more resistance)
        sub.vy *= 1 - (brakeForce * 1.0 * dt);
        // Bubble particles
        if (world.tick % 3 === 0 && Math.hypot(sub.vx, sub.vy) > 0.3) {
          addParticles(sub.worldX - sub.facing * 10, sub.y, 2, '#85c1e9');
        }
      }
    }

    // Gravity
    if (!sub.floating) sub.vy += GRAVITY * dt;
    sub.vy = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, sub.vy));

    // ── STALL MECHANIC ──
    // In air, if forward speed drops too low the sub loses lift and enters a stall:
    // nose drops, controls become sluggish, and gravity takes over until speed recovers.
    // Wings must be functional; no wings = permanent stall state (already handled by damage).
    const inAir = sub.y < WATER_LINE - 5 && !sub.floating && !sub.liftingOff;
    const STALL_SPEED = 1.0;          // Below this forward speed → stall warning
    const STALL_CRITICAL = 0.5;       // Below this → full stall, nose drops hard
    const fwdSpeedAbs = Math.abs(sub.vx);
    if (inAir && sub.parts.wings > 0) {
      if (fwdSpeedAbs < STALL_CRITICAL) {
        // Full stall — nose drops, controls barely respond
        sub.angle += (sub.angle < 0.3 ? 0.04 : 0.01) * dt; // Force nose down
        sub.vy += 0.06 * dt; // Extra gravity (stall sink)
        // Stall buffet — slight random wobble
        sub.vx += (Math.random() - 0.5) * 0.04 * dt;
        sub.angle += (Math.random() - 0.5) * 0.02 * dt;
        if (world.tick % 30 === 0) {
          actionIcon('2b07Fe0f', 30, '#ef4444'); hudFlash('STALL — INCREASE SPEED', 30);
        }
      } else if (fwdSpeedAbs < STALL_SPEED) {
        // Stall warning — sluggish, slight nose drop tendency
        sub.angle += 0.01 * dt;
        sub.vy += 0.02 * dt;
        if (world.tick % 60 === 0) {
          hudFlash('STALL WARNING — LOW AIRSPEED', 25, '#f59e0b');
        }
      }
    }

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

  // --- Surface-skim spray effect ---
  // When the sub hedgehops along the water with its propeller dipping into
  // the surface, kick up a spray trail. Rewards careful low-altitude flight.
  // Conditions: airborne, very low alt (prop in the water), moving forward.
  {
    const propY = sub.y + 4;          // propeller sits a bit below sub centre
    const propInWater = propY > WATER_LINE - 2 && propY < WATER_LINE + 6;
    const airborne = !sub.floating && !sub.periscopeMode && sub.y < WATER_LINE - 2;
    const fwdSpeed = Math.abs(sub.vx);
    if (airborne && propInWater && fwdSpeed > 1.0 && world.tick % 2 === 0) {
      // Spray behind the sub — a short curling arc of water droplets.
      const rearX = sub.worldX - Math.sign(sub.vx || sub.facing || 1) * 16;
      const intensity = Math.min(1, (fwdSpeed - 1.0) / 3.0); // 0..1 by speed
      const count = 2 + Math.floor(intensity * 3);
      for (let k = 0; k < count; k++) {
        const jx = (Math.random() - 0.5) * 8;
        const jy = (Math.random() - 0.2) * 4;
        addParticles(rearX + jx, WATER_LINE + jy, 1, '#bfe6ff');
      }
      // Occasional bigger droplet for visual punch
      if (Math.random() < 0.25) {
        addParticles(rearX - Math.sign(sub.vx) * 6, WATER_LINE - 2, 1, '#85c1e9');
      }
    }
  }

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
      } else if (spd > 3.0) {
        // High-speed bad angle entry (belly flop, sideways) — DAMAGE
        // Only punish genuinely fast impacts, not lazy drifts into water
        const impactForce = (spd - 2.5) * (1 - entryAngle); // Worse when flat + fast
        const dmg = Math.max(2, impactForce * 4);
        damageRandomPart(sub.parts, dmg);
        SFX.islandCrash();
        addExplosion(sub.worldX, WATER_LINE, 'small');
        addParticles(sub.worldX, WATER_LINE, 12, '#85c1e9');
        sub.floating = false;
        sub.vx *= 0.7;
        sub.vy *= 0.5;
        actionIcon('D83dDca5', 45, '#ef4444'); ticker('BELLYFLOP!', 50);
      } else {
        // Slow or medium entry at a bad angle — no damage, just enter water
        sub.floating = false;
        sub.vx *= 0.85;
        sub.vy *= 0.6;
        addParticles(sub.worldX, WATER_LINE, 6, '#85c1e9');
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
        const buoyFactor = sub.diving ? 0.15 : 0.5;
        sub.vy -= BUOYANCY * buoyFactor * dt * (1 + depth * 0.01);
      }
        sub.vx *= WATER_DRAG;
        sub.vy *= SURFACE_DAMPING;
        // Natural vertical stabilisation underwater — sub tends toward neutral buoyancy.
        // Without active input, vy damps toward zero (sub holds depth).
        if (!keys['ArrowUp'] && !keys['ArrowDown'] && !sub.diving) {
          sub.vy *= 0.96; // Gentle auto-damp when no vertical input
        }
        if (!wantsDive && sub.y <= WATER_LINE - 5 && Math.abs(sub.vy) < 0.3) {
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

  // ── Orbit entry — Back to the Future style ──
  // Requirements: 88+ MPH, afterburner ON, mid-screen altitude band, sharp pull-up
  const currentSpeedMph = velocityToMph(sub.vx, sub.vy, 'atmosphere');
  const ORBIT_MIN_ALT = 100;  // Must be above this Y (not too low)
  const ORBIT_MAX_ALT = 350;  // Must be below this Y (not too high — mid-screen)
  const altOk = sub.y > ORBIT_MIN_ALT && sub.y < ORBIT_MAX_ALT;
  const speedOk = currentSpeedMph >= ORBIT_TRIGGER_SPEED_MPH;
  const burnerOn = sub.afterburnerActive;
  const inAirFlight = !sub.floating && !sub.periscopeMode;

  // ── "Flux capacitor" ready state — flashing sub at 88+ with afterburner + right altitude ──
  const fluxReady = speedOk && burnerOn && altOk && inAirFlight;
  if (!world._fluxFlashTimer) world._fluxFlashTimer = 0;
  if (fluxReady) {
    world._fluxFlashTimer += dt;
    // Flash the sub body (rendered in drawSub via world._fluxReady)
    world._fluxReady = true;
    // Periodic message
    if (world._fluxFlashTimer > 0 && world._fluxFlashTimer < 3) {
      hudFlash('88 MPH — PULL UP TO LAUNCH!', 20, '#f97316');
    }
  } else {
    world._fluxReady = false;
    world._fluxFlashTimer = 0;
  }

  // Actual orbit entry: flux ready initiates, then latches until entry completes.
  // Once the ascent starts, altitude band no longer matters — you're committed.
  if (!world._ascentLatch) world._ascentLatch = false;
  const sharpPullUp = keys['ArrowUp'] && sub.angle <= SHARP_ASCENT_ANGLE && sub.vy <= SHARP_ASCENT_VY;
  if (fluxReady && sharpPullUp) world._ascentLatch = true;
  if (world._ascentLatch && (!keys['ArrowUp'] || sub.floating)) world._ascentLatch = false; // Released — abort
  const sharpAscent = world._ascentLatch;
  if (sharpAscent) {
    sub.vy -= STARLIFT_ACCEL * dt;
    if (sub.y <= SPACE_ENTRY_ALTITUDE) {
      world._ascentLatch = false;
      // ── FREEZE FRAME — burning tracks into the sky ──
      // Store the trail origin for the fire-trail effect
      world._orbitTrail = {
        x: sub.worldX, y: sub.y,
        startTick: world.tick,
        fadeLife: 120, // ~2 seconds of burning trail
      };
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
    if (sub.caterpillarDrive) { sub.caterpillarDrive = false; hudFlash('STEALTH BROKEN — COLLISION', 50, '#f97316'); }
  }

  // --- Caterpillar drive toggle (underwater only, requires engine) ---
  if (keyJustPressed['Backspace'] && sub.y > WATER_LINE) {
    if (isEngineCritical(sub.parts)) {
      world.caveMessage = { text: 'ENGINE CRITICAL — CATERPILLAR DRIVE OFFLINE', timer: 80 };
    } else {
      sub.caterpillarDrive = !sub.caterpillarDrive;
      ticker(sub.caterpillarDrive ? 'Caterpillar drive engaged — silent running' : 'Caterpillar drive disengaged', 60);
    }
  }
  // Auto-disengage caterpillar when engine goes critical or leaving water
  if (sub.caterpillarDrive && (sub.y <= WATER_LINE || isEngineCritical(sub.parts))) {
    sub.caterpillarDrive = false;
  }

  // --- Rescue ladder toggle (CapsLock) ---
  // Drops a rope ladder from the sub's belly. Used to winch up hostages
  // (and very occasionally Evel) WITHOUT disembarking. Without the VTOL
  // upgrade the sub can't hold station, so the ladder swings uselessly.
  // CANNOT retract while something is clinging on.
  if (keyJustPressed['CapsLock']) {
    if (sub.ladderPassenger) {
      ticker('Can\'t retract — passenger on the ladder!', 60);
    } else {
      sub.ladderDeployed = !sub.ladderDeployed;
      ticker(sub.ladderDeployed
        ? (sub.vtolUpgrade ? 'Rescue ladder deployed' : 'Ladder deployed — hover unstable without VTOL')
        : 'Rescue ladder retracted', 80);
    }
  }
  // Extend/retract ladder smoothly — forced deployed while someone clings.
  {
    const targetLen = (sub.ladderDeployed || sub.ladderPassenger) ? 50 : 0;
    sub.ladderLength += (targetLen - sub.ladderLength) * 0.15 * dt;
  }

  // --- Ladder passenger physics ---
  // A clinging passenger drags on the sub: extra vx damping + slight downward
  // pull. Shake-off requires violent velocity swings (best done by skimming
  // the water erratically) OR crushing on a land/island surface.
  if (sub.ladderPassenger) {
    const p = sub.ladderPassenger;
    // Drag penalty — feels like carrying a sack of trouble
    sub.vx *= 0.985;
    sub.vy += 0.04 * dt;
    // Erratic-swing shake-off: accumulate based on lateral jerk
    const prevVx = sub._prevVxForShake || 0;
    const jerk = Math.abs(sub.vx - prevVx);
    sub._prevVxForShake = sub.vx;
    // Only counts while the ladder tip is in the water (drag-through-water)
    const tipY = sub.y + sub.ladderLength;
    if (tipY > WATER_LINE) {
      sub.ladderShakeAccum += jerk * 8 * dt;
    } else {
      sub.ladderShakeAccum *= 0.98; // leaks when airborne
    }
    if (sub.ladderShakeAccum > 14) {
      // Shaken loose — flings them into the water
      ticker('Shook him loose!', 80);
      if (p.ref) {
        p.ref.swimming = true;
        p.ref.alive = true;
        p.ref.swimTarget = null;
        p.ref.y = WATER_LINE + 2;
      }
      sub.ladderPassenger = null;
      sub.ladderShakeAccum = 0;
      SFX.waterSplash && SFX.waterSplash();
    }
    // Crush on land/island: if the ladder tip hits terrain while moving fast
    const groundY = getGroundY(sub.worldX);
    const islandHit = islandHitTest(sub.worldX, tipY);
    if ((tipY >= groundY - 2 || islandHit) && Math.hypot(sub.vx, sub.vy) > 1.0) {
      midNotice('PASSENGER CRUSHED ON LAND', 100);
      if (p.ref) { p.ref.alive = false; }
      addParticles(sub.worldX, tipY, 10, '#b91c1c');
      SFX.islandCrash && SFX.islandCrash();
      sub.ladderPassenger = null;
      sub.ladderShakeAccum = 0;
    }
  } else {
    sub.ladderShakeAccum = Math.max(0, sub.ladderShakeAccum - 0.05 * dt);
  }

  // --- Weapon selection (1=MG, 2=torpedo, 3=missile, 4=depth charge, 9=railgun) ---
  if (keyJustPressed['1']) { world.selectedWeapon = 1; ticker('Machine gun selected', 40); }
  if (keyJustPressed['2']) { world.selectedWeapon = 2; ticker('Torpedo selected', 40); }
  if (keyJustPressed['3']) { world.selectedWeapon = 3; ticker('Missile selected', 40); }
  if (keyJustPressed['4']) { world.selectedWeapon = 4; ticker('Depth charge selected', 40); }
  if (keyJustPressed['5']) { world.selectedWeapon = 5; ticker('Bouncing bomb selected — level flight, low alt', 60); }
  if (keyJustPressed['9']) { world.selectedWeapon = 9; ticker('Gauss railgun selected', 40); }

  // --- Firing (Spacebar fires selected weapon) ---
  // Each weapon has its OWN cooldown so switching weapons doesn't block firing.
  if (!world._wpnCooldown) world._wpnCooldown = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 9: 0 };
  const wc = world._wpnCooldown;
  for (const k in wc) wc[k] = Math.max(0, wc[k] - dt);
  world.depthChargeCooldown = Math.max(0, world.depthChargeCooldown - dt);

  const unlimitedAmmo = world.settings.supplyFrequency === 'unlimited';
  const wantFire = keys[' '] || keys[keybinds.fire];

  function breakStealth() {
    if (sub.caterpillarDrive) { sub.caterpillarDrive = false; hudFlash('STEALTH BROKEN', 50, '#f97316'); }
  }

  // SLOT 1: Machine gun — default, infinite ammo, rapid fire
  if (wantFire && world.selectedWeapon === 1 && wc[1] <= 0) {
    const spread = (Math.random() - 0.5) * 0.12;
    const aimAngle = sub.angle + spread;
    world.subMgBullets.push({
      worldX: sub.worldX + sub.facing * 16, y: sub.y,
      vx: Math.cos(aimAngle) * SUB_MG_SPEED * sub.facing + sub.vx * 0.3,
      vy: Math.sin(aimAngle) * SUB_MG_SPEED + sub.vy * 0.2,
      life: SUB_MG_LIFE, damage: SUB_MG_DAMAGE,
    });
    wc[1] = SUB_MG_COOLDOWN; breakStealth();
  }

  // SLOT 2: Torpedo (including LGT and rogue variants)
  if (wantFire && world.selectedWeapon === 2 && wc[2] <= 0 && canFireTorpedo(sub.parts) && (sub.torpedoAmmo > 0 || unlimitedAmmo)) {
    if (!unlimitedAmmo) sub.torpedoAmmo--;
    const isLGT = Math.random() < 0.05;
    const isRogue = !isLGT && Math.random() < 0.1;
    world.torpedoes.push({
      worldX: sub.worldX + sub.facing * 15, y: sub.y + 5,
      vx: sub.vx * 0.5 + sub.facing * 1, vy: isLGT ? 0 : 1.5,
      phase: isLGT ? 'lgt' : 'drop',
      life: isLGT ? 600 : 180,
      trail: [], rogue: isRogue,
      fromSub: true, active: true,
      lgt: isLGT, lgtTarget: null, lgtOrbitAngle: 0, lgtJumpTimer: 0,
    });
    wc[2] = FIRE_COOLDOWN; SFX.torpedoLaunch(); breakStealth();
    if (isLGT) ticker('LGT torpedo deployed', 40);
  }

  // SLOT 3: Missile (air or surface — not underwater or periscope)
  const canLaunchMissile = !sub.periscopeMode && sub.y < WATER_LINE + 5;
  if (wantFire && world.selectedWeapon === 3 && wc[3] <= 0 && (sub.missileAmmo > 0 || unlimitedAmmo) && canLaunchMissile) {
    if (!unlimitedAmmo) sub.missileAmmo--;
    world.missiles.push({
      worldX: sub.worldX + sub.facing * 10, y: sub.y - 5,
      vx: 0, vy: -2.2,
      phase: 'drop', dropTimer: 12, life: 250, trail: [],
      surfaceLaunch: true,
    });
    wc[3] = FIRE_COOLDOWN * 1.5; SFX.missileLaunch(); breakStealth();
  }

  // SLOT 4: Depth charge
  if (wantFire && world.selectedWeapon === 4 && world.depthChargeCooldown <= 0 && (sub.depthChargeAmmo > 0 || unlimitedAmmo)) {
    if (!unlimitedAmmo) sub.depthChargeAmmo--;
    world.depthCharges.push({
      worldX: sub.worldX - sub.facing * 4, y: sub.y + 10,
      vx: sub.vx * 0.35, vy: Math.max(sub.vy, 0) + 1.2,
      life: DEPTH_CHARGE_LIFE, trail: [],
    });
    world.depthChargeCooldown = DEPTH_CHARGE_COOLDOWN;
    addParticles(sub.worldX, sub.y + 10, 6, DEPTH_CHARGE_COLOR); breakStealth();
  }

  // SLOT 5: Bouncing bomb — Barnes Wallis inspired, physics-based skill shot.
  // Must be airborne, low altitude, moving forward, nearly level.
  // Bounces on water, explodes on land. Angle/speed must be precise.
  if (wantFire && world.selectedWeapon === 5 && wc[5] <= 0 && sub.bouncingBombAmmo > 0) {
    const altAboveWater = WATER_LINE - sub.y;
    const fwdSpeed = Math.abs(sub.vx);
    const absAngle = Math.abs(sub.angle);
    const inAir = sub.y < WATER_LINE - 5 && !sub.floating;

    if (!inAir) {
      hudFlash('BOMB: MUST BE AIRBORNE', 50, '#f59e0b');
    } else if (altAboveWater > BBOMB_MAX_ALT) {
      world.caveMessage = { text: 'TOO HIGH — DESCEND BELOW ' + BBOMB_MAX_ALT + ' METRES', timer: 60 };
    } else if (fwdSpeed < BBOMB_MIN_SPEED) {
      world.caveMessage = { text: 'TOO SLOW — NEED FORWARD SPEED > ' + BBOMB_MIN_SPEED.toFixed(1), timer: 60 };
    } else if (absAngle > BBOMB_MAX_ANGLE) {
      world.caveMessage = { text: 'ANGLE TOO STEEP — LEVEL OUT BEFORE RELEASE', timer: 60 };
    } else {
      // Valid release — bomb inherits sub momentum plus a slight downward arc
      sub.bouncingBombAmmo--;
      world.bouncingBombs.push({
        worldX: sub.worldX + sub.facing * 12, y: sub.y + 8,
        vx: sub.vx * 0.9 + sub.facing * 0.5,
        vy: Math.max(sub.vy, 0.3) + 0.5, // Slight downward
        bounces: 0,
        life: BBOMB_LIFE,
        spin: 0, // Visual rotation
      });
      wc[5] = BBOMB_COOLDOWN; breakStealth();
      world.caveMessage = { text: `BOMB AWAY — ${sub.bouncingBombAmmo} LEFT`, timer: 50 };
      SFX.torpedoLaunch();
    }
  }

  // SLOT 9: Gauss Railgun — devastating, limited ammo, long cooldown
  if (wantFire && world.selectedWeapon === 9 && wc[9] <= 0 && sub.railgunAmmo > 0) {
    sub.railgunAmmo--;
    const aimAngle = sub.angle;
    world.railgunShots.push({
      worldX: sub.worldX + sub.facing * 20, y: sub.y,
      vx: Math.cos(aimAngle) * RAILGUN_SPEED * sub.facing,
      vy: Math.sin(aimAngle) * RAILGUN_SPEED,
      life: RAILGUN_LIFE, damage: RAILGUN_DAMAGE,
      trail: [],
    });
    wc[9] = RAILGUN_COOLDOWN;
    // Massive recoil — the whole sub kicks backward and nose lifts
    sub.vx -= sub.facing * 4.0;
    sub.vy -= 0.8;  // Nose lifts from the force
    sub.angle -= sub.facing * 0.12; // Barrel kick
    // Muzzle flash + shockwave particles
    addParticles(sub.worldX + sub.facing * 22, sub.y, 14, '#7df9ff');
    addParticles(sub.worldX + sub.facing * 18, sub.y - 3, 6, '#fff');
    addParticles(sub.worldX + sub.facing * 18, sub.y + 3, 6, '#fff');
    addExplosion(sub.worldX + sub.facing * 22, sub.y, 'small'); // Muzzle flash
    SFX.explodeBig(); breakStealth();
    // Brief screen shake effect
    world._screenShake = 12;
    ticker(`Railgun fired — ${sub.railgunAmmo} rounds left`, 60);
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
  updateNewProjectiles(dt);

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
        sourceRadar: r,      // For aggro attribution (e.g. Red Baron retaliation)
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
    // Sopwith / Red Baron ram collision — not in world.enemies so needs its
    // own check. Ramming him hurts the sub but he takes big structural damage.
    const sw = world.sopwith;
    if (sw && sw.alive
        && Math.abs(sw.x - sub.worldX) < 22
        && Math.abs(sw.y - sub.y) < 16) {
      damageRandomPart(sub.parts, 20);
      sw.hp -= 6; // Ramming does big damage — biplanes are fragile
      sw.lastHitTick = world.tick;
      sw.timesHit++;
      // A ram counts as the sub attacking him — aggro snaps to sub
      sw.target = sub;
      sw.targetKind = 'sub';
      if (!sw.angered) {
        sw.angered = true;
        sw.manoeuvre = 'immelmann';
        sw.acrobatTimer = 0;
        midNotice('THE RED BARON AWAKENS!', 120);
      }
      addExplosion((sw.x + sub.worldX) / 2, (sw.y + sub.y) / 2, 'big');
      SFX.damage();
      // Knock the sub back so you don't stick to him
      const knockDir = sub.worldX < sw.x ? -1 : 1;
      sub.vx += knockDir * 1.5;
      sub.vy -= 0.6;
    }

    // Nemesis lair rock wall — the cave mouth is passable but the surrounding
    // rock face is solid. Ramming the rock damages the sub and bounces it off.
    const lair = world.terrain.nemesisLair;
    if (lair) {
      const lhw = lair.w / 2;
      const lhh = lair.h / 2;
      const dx = sub.worldX - lair.x;
      const dy = sub.y - lair.y;
      // Outer rock bounds (matches the rock polygon in drawNemesisLair)
      const outerHW = lhw + 28;
      const outerTop = -(lhh + 20);
      const outerBot = lhh + 28;
      const insideOuter = Math.abs(dx) < outerHW && dy > outerTop && dy < outerBot;
      if (insideOuter) {
        // Mouth opening (passable ellipse) — same as the void gradient ellipse
        const mouthRX = lhw * 0.72;
        const mouthRY = lhh * 0.62;
        const nx = dx / mouthRX, ny = dy / mouthRY;
        const insideMouth = (nx * nx + ny * ny) < 1;
        if (!insideMouth) {
          // Hit rock — damage scales with impact speed
          const spd = Math.hypot(sub.vx, sub.vy);
          const dmg = Math.max(6, Math.min(30, spd * 6));
          damageRandomPart(sub.parts, dmg);
          addExplosion(sub.worldX, sub.y, 'small'); SFX.islandCrash();
          // Bounce the sub away from the lair centre
          const bx = Math.sign(dx) || 1;
          const by = Math.sign(dy) || 1;
          sub.vx = bx * Math.max(1.2, Math.abs(sub.vx) * 0.6);
          sub.vy = by * Math.max(0.8, Math.abs(sub.vy) * 0.5);
        }
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

    // Deep layer with damaged hull — progressive pressure damage + warnings
    if (inDeep && hullPct < HULL_DEEP_THRESHOLD && hullPct > 0) {
      if (hullPct < HULL_DEEP_CRUSH_THRESHOLD) {
        // Below 20% — crushed
        sub.parts.hull = 0;
        addExplosion(sub.worldX, sub.y, 'big');
        addParticles(sub.worldX, sub.y, 20, '#1a5276');
        world.caveMessage = { text: 'HULL CRUSHED BY DEEP WATER PRESSURE', timer: 200 };
        SFX.explodeBig();
      } else {
        // 20-40% hull — pressure damage ticks, warnings
        if (world.tick % 30 === 0) {
          sub.parts.hull = Math.max(0, sub.parts.hull - 2);
          addParticles(sub.worldX, sub.y, 3, '#1a5276');
        }
        if (world.tick % 60 < 2) {
          world.caveMessage = { text: '⚠ PRESSURE WARNING — HULL INTEGRITY CRITICAL', timer: 55 };
        }
      }
    }
    // Entering deep with damaged hull — show initial warning
    if (enteringDeep && hullPct < HULL_DEEP_THRESHOLD && !inDeep && hullPct > 0) {
      world.caveMessage = { text: '⚠ PRESSURE WARNING — HULL DAMAGE WILL INCREASE AT DEPTH', timer: 100 };
    }
  }

  // Game over: hull destroyed
  if (sub.parts.hull <= 0) {
    world.gameOver = true;
    setDeathCause(world, 'hull');
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
  updateStrikeKills();
  updateHostages(dt);
  updatePassengerShip(dt);
  updateInterceptors(dt);
  updateAkulaMolot(dt);
  updateDelfins(dt);
  updateSopwith(dt);
  updateAirSupremacy(dt);
  updateAirInterceptors(dt);
  updateNemesis(dt);
  updateMotorcyclists(dt);
  updateSquadron(dt);
  updateTelemetry(dt, sub.vx, sub.vy, 'atmosphere');

  // ── Dynamic music: detect on-screen bosses and set appropriate track ──
  // Priority: nemesis > berkut > akula > lightning > ambient
  if (typeof SFX !== 'undefined' && SFX.music) {
    const nm = world.nemesis;
    const bk = world.airSupremacy;
    const ak = world.terrain.akulaMolot;
    const liAlive = world.airInterceptors.some(l => l.alive);
    const onScreen = (x) => Math.abs(x - sub.worldX) < W * 1.2;

    if (nm && nm.alive && onScreen(nm.x)) {
      SFX.music.set('nemesis');
    } else if (bk && bk.alive && onScreen(bk.x)) {
      SFX.music.set('berkut');
    } else if (ak && !ak.destroyed && onScreen(ak.x)) {
      SFX.music.set('akula');
    } else if (liAlive && world.airInterceptors.some(l => l.alive && onScreen(l.x))) {
      SFX.music.set('lightning');
    } else {
      SFX.music.set('ambient');
    }
  }
}

// ============================================================
// RED ARROW SQUADRON — Two smaller wingmen subs that follow
// the player and provide support fire. Visual: Red Arrows style
// (red body with white chevron, smaller than player).
// ============================================================
function createSquadron() {
  const squad = [];
  for (let i = 0; i < SQUADRON_COUNT; i++) {
    squad.push({
      x: 150 + (i + 1) * 40,  // Start near home port
      y: WATER_LINE - 30,
      vx: 0, vy: 0,
      hp: SQUADRON_HP,
      alive: true,
      fireCooldown: 30 + i * 10,
      bullets: [],
      inWater: false,
      targetEnemy: null,
      formOffset: (i === 0 ? -1 : 1), // Left or right of leader
    });
  }
  return squad;
}

function updateSquadron(dt) {
  const mode = world.squadronMode;
  if (mode === 'off') return;
  const sub = world.sub;

  for (let idx = 0; idx < world.squadron.length; idx++) {
    const w = world.squadron[idx];
    if (!w.alive) continue;

    w.fireCooldown = Math.max(0, w.fireCooldown - dt);
    w.inWater = w.y > WATER_LINE;
    const speed = w.inWater ? SQUADRON_SPEED_WATER : SQUADRON_SPEED_AIR;

    // ── Update bullets ──
    for (let i = w.bullets.length - 1; i >= 0; i--) {
      const b = w.bullets[i];
      b.worldX += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      if (b.life <= 0) { w.bullets.splice(i, 1); continue; }
      // Hit enemies
      for (let j = world.enemies.length - 1; j >= 0; j--) {
        const e = world.enemies[j];
        if (Math.abs(b.worldX - e.worldX) < 12 && Math.abs(b.y - e.y) < 10) {
          e.health -= b.damage;
          if (e.health <= 0) {
            addExplosion(e.worldX, e.y, 'small'); world.score += 80; world.kills++;
            world.enemies.splice(j, 1); SFX.enemyDestroyed();
          }
          w.bullets.splice(i, 1); break;
        }
      }
    }

    // ── Take damage from enemy projectiles ──
    for (let i = world.enemies.length - 1; i >= 0; i--) {
      const e = world.enemies[i];
      if (Math.abs(e.worldX - w.x) < 14 && Math.abs(e.y - w.y) < 10) {
        w.hp -= 1;
        if (w.hp <= 0) {
          w.alive = false;
          addExplosion(w.x, w.y, 'small'); addParticles(w.x, w.y, 10, '#ef4444');
          SFX.explodeSmall();
          world.caveMessage = { text: 'WINGMAN DOWN', timer: 80 };
        }
        break;
      }
    }
    if (!w.alive) continue;

    // ── Find appropriate target based on mode ──
    w.targetEnemy = null;
    let bestDist = SQUADRON_ENGAGE_RANGE;
    const candidates = world.enemies;
    for (const e of candidates) {
      const d = Math.hypot(e.worldX - w.x, e.y - w.y);
      if (d >= bestDist) continue;
      const eInWater = e.y > WATER_LINE;
      const eOnLand = e.y < WATER_LINE && e.worldX !== undefined; // rough check
      // Mode filtering
      if (mode === 'aqua' && !eInWater) continue;           // Only sea targets
      if (mode === 'aero' && eInWater) continue;             // Only air targets
      if (mode === 'terra' && !e.isLandTarget) continue;     // Only land targets
      if (mode === 'astro') continue;                        // Coming soon
      // 'general' targets anything nearby
      bestDist = d;
      w.targetEnemy = e;
    }

    // Also target nemesis, sopwith, berkut, etc. if in range
    const specialTargets = [];
    if (world.sopwith?.alive && world.sopwith.angered) specialTargets.push({ worldX: world.sopwith.x, y: world.sopwith.y, obj: world.sopwith });
    if (world.airSupremacy?.alive) specialTargets.push({ worldX: world.airSupremacy.x, y: world.airSupremacy.y, obj: world.airSupremacy });
    if (world.nemesis?.alive) specialTargets.push({ worldX: world.nemesis.x, y: world.nemesis.y, obj: world.nemesis });
    for (const t of specialTargets) {
      const d = Math.hypot(t.worldX - w.x, t.y - w.y);
      if (d < bestDist) {
        const tInWater = t.y > WATER_LINE;
        if (mode === 'aqua' && !tInWater) continue;
        if (mode === 'aero' && tInWater) continue;
        bestDist = d;
        w.targetEnemy = t;
      }
    }

    // ── Movement AI ──
    if (w.targetEnemy && bestDist < SQUADRON_ENGAGE_RANGE) {
      // Peel off and engage — strafe run
      const te = w.targetEnemy;
      const tx = te.worldX || te.x;
      const ty = te.y;
      const angleToTarget = Math.atan2(ty - w.y, tx - w.x);
      const distToTarget = Math.hypot(tx - w.x, ty - w.y);
      w.vx += Math.cos(angleToTarget) * 0.12 * dt;
      w.vy += Math.sin(angleToTarget) * 0.08 * dt;
      // Pull up after close pass
      if (distToTarget < 30) {
        w.vy -= 0.12 * dt;
        w.vx += (w.vx > 0 ? 0.06 : -0.06) * dt;
      }
      // Fire
      if (w.fireCooldown <= 0 && distToTarget < SQUADRON_ENGAGE_RANGE) {
        const spread = (Math.random() - 0.5) * 0.1;
        w.bullets.push({
          worldX: w.x, y: w.y,
          vx: Math.cos(angleToTarget + spread) * SQUADRON_BULLET_SPEED,
          vy: Math.sin(angleToTarget + spread) * SQUADRON_BULLET_SPEED,
          life: SQUADRON_BULLET_LIFE, damage: SQUADRON_BULLET_DAMAGE,
        });
        w.fireCooldown = SQUADRON_FIRE_COOLDOWN;
      }
      // Return to leader if too far from target (give up)
      if (Math.hypot(sub.worldX - w.x, sub.y - w.y) > SQUADRON_RETURN_RANGE) {
        w.targetEnemy = null; // Regroup next frame
      }
    } else {
      // Formation: follow the player with offset
      const formX = sub.worldX + w.formOffset * SQUADRON_FOLLOW_DIST - sub.facing * 30;
      const formY = sub.y + w.formOffset * 15;
      const dx = formX - w.x;
      const dy = formY - w.y;
      const formAngle = Math.atan2(dy, dx);
      const formDist = Math.hypot(dx, dy);
      // Smooth pull that scales with distance — no hard snap
      const pull = Math.min(0.25, formDist * 0.002 + 0.02);
      w.vx += Math.cos(formAngle) * pull * dt;
      w.vy += Math.sin(formAngle) * pull * dt;
      // Soft catch-up: if far behind, blend position toward target (no hard teleport)
      if (formDist > 200) {
        const blend = Math.min(0.05, (formDist - 200) * 0.0003) * dt;
        w.x += dx * blend;
        w.y += dy * blend;
        w.vx = w.vx * 0.9 + sub.vx * 0.1;
        w.vy = w.vy * 0.9 + sub.vy * 0.1;
      }
    }

    // Speed cap
    const spd = Math.hypot(w.vx, w.vy);
    if (spd > speed) { w.vx *= speed / spd; w.vy *= speed / spd; }
    w.x += w.vx * dt;
    w.y += w.vy * dt;
    w.y = clamp(w.y, 20, SEA_FLOOR - 10);
  }
}

function drawSquadron() {
  if (world.squadronMode === 'off') return;

  for (const w of world.squadron) {
    if (!w.alive) continue;
    const sx = toScreen(w.x);
    // Wider cull so they don't pop in/out at screen edges
    if (sx < -80 || sx > W + 80) continue;
    const dir = w.vx >= 0 ? 1 : -1;
    const hpPct = w.hp / SQUADRON_HP;

    // ── Damage smoke trail (yellow < 60%, red < 30%, purple flashing < 15%) ──
    if (hpPct < 0.6 && world.tick % (hpPct < 0.15 ? 2 : hpPct < 0.3 ? 3 : 5) === 0) {
      const smokeColor = hpPct < 0.15 ? '#9b59b6' : hpPct < 0.3 ? '#333' : '#555';
      addParticles(w.x - dir * 14, w.y, 1, smokeColor);
    }

    ctx.save();
    ctx.translate(sx, w.y);
    ctx.scale(dir, 1);

    // ── Purple flash when critical (<15% HP) ──
    if (hpPct < 0.15 && world.tick % 10 < 5) {
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = '#9b59b6';
      ctx.beginPath(); ctx.ellipse(0, 0, 16, 8, 0, 0, TWO_PI); ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Smaller sub body — Red Arrows livery (red + white chevron)
    ctx.fillStyle = hpPct < 0.3 ? '#7f1d1d' : '#dc2626';
    ctx.beginPath(); ctx.ellipse(0, 0, 12, 4.5, 0, 0, TWO_PI); ctx.fill();
    ctx.strokeStyle = '#991b1b'; ctx.lineWidth = 0.8; ctx.stroke();
    // White chevron on hull
    ctx.strokeStyle = '#f8fafc'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(-4, -3); ctx.lineTo(2, 0); ctx.lineTo(-4, 3); ctx.stroke();
    // Tower
    ctx.fillStyle = '#b91c1c';
    ctx.fillRect(-1.5, -7, 3, 3);
    // Wings
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.moveTo(-2, -3.5); ctx.lineTo(-6, -8); ctx.lineTo(-3, -8); ctx.lineTo(1, -3.5);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-2, 3.5); ctx.lineTo(-6, 8); ctx.lineTo(-3, 8); ctx.lineTo(1, 3.5);
    ctx.closePath(); ctx.fill();
    // Nose
    ctx.fillStyle = '#fca5a5';
    ctx.beginPath(); ctx.arc(12, 0, 2.5, -Math.PI / 2, Math.PI / 2); ctx.fill();
    // Engine
    ctx.fillStyle = '#7f1d1d';
    ctx.fillRect(-14, -2, 4, 4);
    // Propeller / bubble trail
    if (!w.inWater) {
      const pa = Date.now() / 35;
      ctx.strokeStyle = '#fca5a5'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-14, Math.sin(pa) * 3.5); ctx.lineTo(-14, -Math.sin(pa) * 3.5); ctx.stroke();
    } else {
      ctx.fillStyle = 'rgba(133,193,233,0.25)';
      for (let b = 0; b < 2; b++) {
        ctx.beginPath();
        ctx.arc(-16 - b * 4 + Math.random() * 2, (Math.random() - 0.5) * 3, 1.5, 0, TWO_PI);
        ctx.fill();
      }
    }

    ctx.restore();

    // Bullets
    ctx.fillStyle = '#fca5a5';
    for (const b of w.bullets) {
      const bsx = toScreen(b.worldX);
      if (bsx < -5 || bsx > W + 5) continue;
      ctx.beginPath(); ctx.arc(bsx, b.y, 1.2, 0, TWO_PI); ctx.fill();
    }
  }

  // ── Squadron status boxes (top-right) — tiny, minimal ──
  if (world.squadronMode !== 'off') {
    const modeColors = { general: '#94a3b8', aqua: '#38bdf8', aero: '#a78bfa', terra: '#4ade80', astro: '#fbbf24' };
    const modeColor = modeColors[world.squadronMode] || '#94a3b8';

    // Mode label
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(W - 110, 6, 104, 14);
    ctx.fillStyle = modeColor;
    ctx.font = 'bold 9px Arial'; ctx.textAlign = 'right';
    ctx.fillText(`SQN: ${world.squadronMode.toUpperCase()}`, W - 10, 16);

    // Per-wingman status pip — tiny coloured box per wingman
    for (let i = 0; i < world.squadron.length; i++) {
      const w = world.squadron[i];
      const bx = W - 110 + i * 50;
      const by = 22;

      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(bx, by, 46, 12);

      if (!w.alive) {
        // Dead — grey with X
        ctx.fillStyle = '#4a4a4a';
        ctx.fillRect(bx + 1, by + 1, 44, 10);
        ctx.fillStyle = '#888'; ctx.font = '8px Arial'; ctx.textAlign = 'center';
        ctx.fillText('DOWN', bx + 23, by + 10);
      } else {
        const hpPct = w.hp / SQUADRON_HP;
        let statusColor, label;
        if (hpPct > 0.6) { statusColor = '#22c55e'; label = 'OK'; }
        else if (hpPct > 0.3) { statusColor = '#eab308'; label = 'DMG'; }
        else if (hpPct > 0.15) { statusColor = '#ef4444'; label = 'CRIT'; }
        else {
          // Flashing purple — critical warning
          statusColor = world.tick % 8 < 4 ? '#9b59b6' : '#1a1a2e';
          label = 'WARN';
        }
        ctx.fillStyle = statusColor;
        ctx.fillRect(bx + 1, by + 1, 44, 10);
        ctx.fillStyle = '#fff'; ctx.font = 'bold 8px Arial'; ctx.textAlign = 'center';
        ctx.fillText(`W${i + 1} ${label}`, bx + 23, by + 10);
      }
    }
  }
}

function updateEnemies(dt) {
  const sub = world.sub;
  const hidden = sub.periscopeMode;
  // Generic filler enemies (random jets/helis) DISABLED — the named enemy systems
  // (Sopwith, Berkut, Lightning, Nemesis, Akula, Delfin, Destroyer, Interceptors)
  // provide all the combat variety needed without random clutter.
  // The array is kept alive for any legacy enemies that might still exist.
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


// --- Update sub MG bullets, railgun shots, and commander bullets ---
function updateNewProjectiles(dt) {
  const sub = world.sub;

  // Sub MG bullets — damage enemies on contact
  for (let i = world.subMgBullets.length - 1; i >= 0; i--) {
    const b = world.subMgBullets[i];
    b.worldX += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
    if (b.life <= 0) { world.subMgBullets.splice(i, 1); continue; }
    for (let j = world.enemies.length - 1; j >= 0; j--) {
      const e = world.enemies[j];
      if (Math.abs(b.worldX - e.worldX) < 14 && Math.abs(b.y - e.y) < 10) {
        e.health -= b.damage;
        if (e.health <= 0) {
          addExplosion(e.worldX, e.y, 'small'); world.score += 100; world.kills++;
          world.enemies.splice(j, 1); SFX.enemyDestroyed();
        }
        world.subMgBullets.splice(i, 1); break;
      }
    }
  }

  // Railgun shots — pierce through enemies, massive damage, trail effect
  for (let i = world.railgunShots.length - 1; i >= 0; i--) {
    const r = world.railgunShots[i];
    r.worldX += r.vx * dt; r.y += r.vy * dt; r.life -= dt;
    if (r.life % 2 < 1) r.trail.push({ wx: r.worldX, y: r.y, age: 0 });
    if (r.trail.length > 12) r.trail.shift();
    r.trail.forEach(t => t.age += dt);
    if (r.life <= 0) { world.railgunShots.splice(i, 1); continue; }
    // Railgun pierces — damages ALL enemies in path, doesn't stop
    for (let j = world.enemies.length - 1; j >= 0; j--) {
      const e = world.enemies[j];
      if (Math.abs(r.worldX - e.worldX) < 16 && Math.abs(r.y - e.y) < 12) {
        e.health -= r.damage;
        addExplosion(e.worldX, e.y, 'big'); SFX.explodeBig();
        if (e.health <= 0) {
          addParticles(e.worldX, e.y, 20, '#7df9ff');
          world.score += 500; world.kills++; world.enemies.splice(j, 1); SFX.enemyDestroyed();
        }
      }
    }
  }

  // Bouncing bombs — gravity in air, bounce off water, explode on land
  for (let i = world.bouncingBombs.length - 1; i >= 0; i--) {
    const bb = world.bouncingBombs[i];
    // Gravity
    bb.vy += GRAVITY * 0.8 * dt;
    bb.worldX += bb.vx * dt;
    bb.y += bb.vy * dt;
    bb.life -= dt;
    bb.spin += bb.vx * 0.05 * dt; // Visual backspin

    if (bb.life <= 0) { world.bouncingBombs.splice(i, 1); continue; }

    // Water surface bounce
    if (bb.y >= WATER_LINE && bb.vy > 0) {
      bb.bounces++;
      if (bb.bounces > BBOMB_MAX_BOUNCES || Math.abs(bb.vx) < 0.5) {
        // Out of bounces or too slow — sinks (dud)
        addParticles(bb.worldX, WATER_LINE, 8, '#85c1e9');
        SFX.waterSplash();
        world.bouncingBombs.splice(i, 1);
        ticker('Bomb sank — dud', 40);
        continue;
      }
      // Bounce: reflect vy, lose energy — big water plume each bounce
      bb.vy = -Math.abs(bb.vy) * BBOMB_BOUNCE_LOSS;
      bb.vx *= (BBOMB_BOUNCE_LOSS + 0.15);
      bb.y = WATER_LINE - 2;
      // Dramatic water plume — bigger on earlier bounces
      const plumeSize = Math.max(6, 16 - bb.bounces * 2);
      addParticles(bb.worldX, WATER_LINE, plumeSize, '#85c1e9');
      addParticles(bb.worldX - 8, WATER_LINE - 4, 3, '#bfe6ff');
      addParticles(bb.worldX + 8, WATER_LINE - 4, 3, '#bfe6ff');
      SFX.waterSplash();
      world._screenShake = Math.max(world._screenShake || 0, 4); // Slight shake on impact
    }

    // Ship contact — a bouncing bomb skipping across the water is supposed
    // to smash into surface ships (that's the whole Barnes Wallis point).
    // Check every surface vessel along the bomb's path and detonate on hit.
    let hitShip = null;
    const bbY = bb.y;
    // Bombs only interact with ships while roughly at surface level (bomb is
    // arcing between bounces or cruising low). Ships sit at WATER_LINE - ~6
    // to - ~8, so anything within ~50px vertically counts as a hull strike.
    // Use a generous vertical window so a bomb mid-arc still hits a tall hull.
    if (bbY > WATER_LINE - 60 && bbY < WATER_LINE + 25) {
      const dest = world.terrain.destroyer;
      if (dest && !dest.destroyed && Math.abs(bb.worldX - dest.x) < 55) {
        hitShip = { obj: dest, kind: 'destroyer', score: 2000, civilian: false };
      }
      if (!hitShip) {
        const pass = world.terrain.passengerShip;
        if (pass && !pass.destroyed && Math.abs(bb.worldX - pass.x) < 45) {
          hitShip = { obj: pass, kind: 'passenger', score: 0, civilian: true };
        }
      }
      if (!hitShip) {
        for (const boat of (world.terrain.interceptors || [])) {
          if (boat.destroyed) continue;
          if (Math.abs(bb.worldX - boat.x) < 32) {
            hitShip = { obj: boat, kind: 'interceptor', score: 400, civilian: false };
            break;
          }
        }
      }
    }
    if (hitShip) {
      addExplosion(bb.worldX, bb.y, 'big');
      addExplosion(bb.worldX - 12, bb.y - 4, 'big');
      addParticles(bb.worldX, bb.y, 20, '#ff6b00');
      SFX.explodeBig();
      hitShip.obj.hp = 0;
      hitShip.obj.destroyed = true;
      if (hitShip.civilian) {
        world.score = 0;
        world.caveMessage = { text: 'BOUNCING BOMB HIT CIVILIAN SHIP — SCORE ZERO', timer: 250 };
        SFX.gameOver();
      } else {
        world.score += hitShip.score;
        world.kills++;
        midNotice(`BOUNCING BOMB — ${hitShip.kind.toUpperCase()} SUNK!`, 80);
      }
      world.bouncingBombs.splice(i, 1);
      continue;
    }

    // Land/island contact — EXPLODE
    const groundY = getGroundY(bb.worldX);
    const hitIsland = islandHitTest(bb.worldX, bb.y);
    if (bb.y >= groundY || hitIsland) {
      // Massive explosion
      addExplosion(bb.worldX, bb.y, 'big');
      addExplosion(bb.worldX - 15, bb.y - 5, 'big');
      addExplosion(bb.worldX + 15, bb.y + 5, 'big');
      addParticles(bb.worldX, bb.y, 25, '#ff6b00');
      SFX.explodeBig();
      // Area damage to all enemies in blast radius
      for (let j = world.enemies.length - 1; j >= 0; j--) {
        const e = world.enemies[j];
        if (Math.hypot(bb.worldX - e.worldX, bb.y - e.y) < BBOMB_BLAST_RADIUS) {
          e.health -= BBOMB_DAMAGE;
          if (e.health <= 0) {
            addExplosion(e.worldX, e.y, 'big');
            world.score += 600; world.kills++;
            world.enemies.splice(j, 1); SFX.enemyDestroyed();
          }
        }
      }
      // Damage radar towers in radius
      for (const r of world.terrain.radars) {
        if (!r.destroyed && Math.hypot(bb.worldX - r.x, bb.y - r.y) < BBOMB_BLAST_RADIUS) {
          r.destroyed = true; r.hp = 0;
          addExplosion(r.x, r.y, 'big'); world.score += 400;
        }
      }
      world.bouncingBombs.splice(i, 1);
      midNotice('BOUNCING BOMB — DIRECT HIT!', 80);
      continue;
    }
  }

  // Commander bullets (pistol / grenade / PPC)
  for (let i = world.commanderBullets.length - 1; i >= 0; i--) {
    const b = world.commanderBullets[i];
    b.worldX += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
    // Grenades have gravity
    if (b.type === 'grenade') b.vy += GRAVITY * 0.7 * dt;
    if (b.life <= 0) {
      // Grenade explodes on timeout
      if (b.type === 'grenade' && b.blastRadius) {
        addExplosion(b.worldX, b.y, 'big'); SFX.explodeBig();
        for (let j = world.enemies.length - 1; j >= 0; j--) {
          const e = world.enemies[j];
          if (Math.hypot(b.worldX - e.worldX, b.y - e.y) < b.blastRadius) {
            e.health -= b.damage;
            if (e.health <= 0) {
              addExplosion(e.worldX, e.y, 'big'); world.score += 200; world.kills++;
              world.enemies.splice(j, 1); SFX.enemyDestroyed();
            }
          }
        }
      }
      world.commanderBullets.splice(i, 1); continue;
    }
    // Contact damage for pistol/PPC
    if (b.type !== 'grenade') {
      for (let j = world.enemies.length - 1; j >= 0; j--) {
        const e = world.enemies[j];
        if (Math.abs(b.worldX - e.worldX) < 14 && Math.abs(b.y - e.y) < 10) {
          e.health -= b.damage;
          if (b.type === 'ppc') { addExplosion(e.worldX, e.y, 'big'); SFX.explodeBig(); }
          else { addExplosion(e.worldX, e.y, 'small'); }
          if (e.health <= 0) {
            addParticles(e.worldX, e.y, 10, b.type === 'ppc' ? '#ff00ff' : '#ffd166');
            world.score += b.type === 'ppc' ? 400 : 150; world.kills++;
            world.enemies.splice(j, 1); SFX.enemyDestroyed();
          }
          if (b.type !== 'ppc') { world.commanderBullets.splice(i, 1); break; } // PPC pierces
        }
      }
    }
  }
}

function updateEffects(dt) {
  world.explosions = world.explosions.filter(e => { e.age += dt; return e.age < e.duration; });
  world.particles = world.particles.filter(p => {
    p.worldX += p.vx*dt; p.y += p.vy*dt; p.vy += 0.08*dt; p.age += dt;
    return p.age < p.life;
  });
}

// ── Notification helpers — four tiers ──
// midNotice(text, timer)   — big centre-screen banner for critical events
// hudFlash(text, timer, color) — pulsing warning in bottom-left HUD
// ticker(text, timer)      — small scrolling text at bottom
// actionIcon(symbol, timer, color) — floating symbol near the sub
function midNotice(text, timer) {
  world.caveMessage = { text, timer: timer || 120, tier: 'mid' };
}
function hudFlash(text, timer, color) {
  if (!world._notifications) world._notifications = { ticker: [], hudFlash: null, actionIcon: null };
  world._notifications.hudFlash = { text, timer: timer || 80, color: color || '#ef4444' };
}
function ticker(text, timer) {
  if (!world._notifications) world._notifications = { ticker: [], hudFlash: null, actionIcon: null };
  world._notifications.ticker.push({ text, timer: timer || 60 });
  if (world._notifications.ticker.length > 5) world._notifications.ticker.shift();
}
function actionIcon(symbol, timer, color, offsetX, offsetY) {
  if (!world._notifications) world._notifications = { ticker: [], hudFlash: null, actionIcon: null };
  const maxT = timer || 40;
  world._notifications.actionIcon = { symbol, timer: maxT, maxTimer: maxT, color: color || '#fbbf24', offsetX: offsetX || 0, offsetY: offsetY || 0 };
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


// ── HUD/overlay/scoring functions extracted to hud.js ──
// Compact legend, leaderboard, solar minimap, flight instruments,
// pause overlay, warp menu, orbit scene, HUD, scoring, damage diagram



// ============================================================
// DRAWING — all world coords converted via toScreen()
// ============================================================
function draw() {
  // ── Burning fire trail into the sky (Back to the Future moment) ──
  // Renders on top of the orbit scene for the first ~2 seconds after transition
  if (world._orbitTrail) {
    const trail = world._orbitTrail;
    const age = world.tick - trail.startTick;
    if (age > trail.fadeLife) {
      world._orbitTrail = null;
    } else {
      const alpha = Math.max(0, 1 - age / trail.fadeLife);
      const trailSx = trail.x - world.cameraX;
      // Draw the fire streak from the launch point upward to the top of the screen
      ctx.save();
      for (let i = 0; i < 3; i++) {
        const streak = ctx.createLinearGradient(trailSx + (i - 1) * 6, H, trailSx + (i - 1) * 6, -50);
        streak.addColorStop(0, `rgba(255,140,0,${alpha * 0.05})`);
        streak.addColorStop(0.3, `rgba(255,80,0,${alpha * 0.4})`);
        streak.addColorStop(0.6, `rgba(255,200,50,${alpha * 0.6})`);
        streak.addColorStop(0.85, `rgba(200,230,255,${alpha * 0.3})`);
        streak.addColorStop(1, `rgba(255,255,255,0)`);
        ctx.fillStyle = streak;
        const wobble = Math.sin(world.tick * 0.3 + i * 2) * (3 + i * 2);
        ctx.fillRect(trailSx - 4 + wobble + (i - 1) * 6, -50, 8 - i, H + 50);
      }
      // Bright flash at the launch point (fading)
      if (age < 20) {
        const flashAlpha = (1 - age / 20) * 0.7;
        ctx.globalAlpha = flashAlpha;
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(trailSx, trail.y, 40 - age, 0, TWO_PI); ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }
  }

  if (world.mode === 'orbit') {
    drawOrbitScene();
    return;
  }

  const cam = world.cameraX;
  const camY = world.cameraY;

  // Clear full canvas
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);

  // Screen shake (railgun recoil, big explosions)
  let shakeX = 0, shakeY = 0;
  if (world._screenShake > 0) {
    world._screenShake -= 1;
    const intensity = world._screenShake * 0.6;
    shakeX = (Math.random() - 0.5) * intensity;
    shakeY = (Math.random() - 0.5) * intensity;
  }

  // Apply vertical camera offset + screen shake
  ctx.save();
  ctx.translate(shakeX, -camY + shakeY);

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

    // Island colour based on type
    const isType = isl.type || 'residential';
    const ig = ctx.createLinearGradient(sx,top,sx,WATER_LINE);
    if (isType === 'military') {
      ig.addColorStop(0,'#5a6a4a'); ig.addColorStop(0.4,'#4a5a3a'); ig.addColorStop(1,'#3a4a2a');
    } else if (isType === 'industrial') {
      ig.addColorStop(0,'#7a7a6a'); ig.addColorStop(0.4,'#6a6a5a'); ig.addColorStop(1,'#5a5a4a');
    } else {
      ig.addColorStop(0,'#8d6e4a'); ig.addColorStop(0.4,'#6d4c2a'); ig.addColorStop(1,'#5d4037');
    }
    ctx.fillStyle = ig;
    ctx.beginPath(); ctx.moveTo(sx-tH,top); ctx.lineTo(sx+tH,top);
    ctx.lineTo(sx+bH,WATER_LINE); ctx.lineTo(sx-bH,WATER_LINE); ctx.closePath(); ctx.fill();

    ctx.strokeStyle = isType === 'military' ? '#2a3a1a' : '#3e2723'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(sx-tH,top); ctx.lineTo(sx+tH,top);
    ctx.lineTo(sx+bH,WATER_LINE); ctx.lineTo(sx-bH,WATER_LINE); ctx.closePath(); ctx.stroke();

    ctx.strokeStyle = '#d4a053'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(sx-tH+3,top+1); ctx.lineTo(sx+tH-3,top+1); ctx.stroke();

    // Island decorations based on type
    if (isType === 'residential') {
      // Small houses — cute coloured rectangles with triangular roofs
      if (isl.h > 15) {
        const houseCount = Math.min(3, Math.floor(isl.topW / 15));
        const houseColors = ['#c0392b', '#2980b9', '#f39c12', '#27ae60'];
        for (let h = 0; h < houseCount; h++) {
          const hx = sx - tH + 8 + h * (isl.topW / (houseCount + 1));
          ctx.fillStyle = houseColors[h % houseColors.length];
          ctx.fillRect(hx - 3, top - 7, 6, 7);
          ctx.fillStyle = '#5d4037';
          ctx.beginPath(); ctx.moveTo(hx - 4, top - 7); ctx.lineTo(hx, top - 12); ctx.lineTo(hx + 4, top - 7); ctx.fill();
          // Window
          ctx.fillStyle = '#fcd34d';
          ctx.fillRect(hx - 1, top - 5, 2, 2);
        }
        // Tree
        ctx.strokeStyle = '#795548'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(sx + tH - 8, top); ctx.lineTo(sx + tH - 7, top - 14); ctx.stroke();
        ctx.fillStyle = '#27ae60';
        ctx.beginPath(); ctx.ellipse(sx + tH - 7, top - 16, 7, 5, 0, 0, TWO_PI); ctx.fill();
      }
    } else if (isType === 'industrial') {
      // Cranes and factory buildings
      if (isl.h > 12) {
        // Factory building
        ctx.fillStyle = '#6b7280';
        ctx.fillRect(sx - 6, top - 12, 12, 12);
        // Smokestack
        ctx.fillStyle = '#4b5563';
        ctx.fillRect(sx + 2, top - 20, 3, 10);
        // Smoke puffs
        if (world.tick % 12 < 6) {
          ctx.fillStyle = 'rgba(150,150,150,0.3)';
          ctx.beginPath(); ctx.arc(sx + 4, top - 22 - Math.sin(world.tick * 0.03) * 3, 3, 0, TWO_PI); ctx.fill();
        }
        // Crane arm
        if (isl.topW > 25) {
          ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(sx - tH + 6, top); ctx.lineTo(sx - tH + 6, top - 18);
          ctx.lineTo(sx - tH + 18, top - 18); ctx.stroke();
          // Hanging cable
          ctx.strokeStyle = '#888'; ctx.lineWidth = 0.5;
          ctx.beginPath(); ctx.moveTo(sx - tH + 14, top - 18); ctx.lineTo(sx - tH + 14, top - 8); ctx.stroke();
        }
      }
    } else if (isType === 'military') {
      // Bunkers and gun emplacements
      if (isl.h > 12) {
        // Bunker — low concrete block
        ctx.fillStyle = '#5a5a4a';
        ctx.fillRect(sx - 8, top - 5, 16, 5);
        ctx.fillStyle = '#4a4a3a';
        ctx.fillRect(sx - 7, top - 5, 3, 2); // Gun slit
        // Sandbag wall
        ctx.fillStyle = '#8b7d6b';
        for (let s = 0; s < 3; s++) {
          ctx.beginPath(); ctx.ellipse(sx + tH - 8 - s * 5, top - 2, 3, 2, 0, 0, TWO_PI); ctx.fill();
        }
        // Flag pole
        ctx.strokeStyle = '#666'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(sx - tH + 5, top); ctx.lineTo(sx - tH + 5, top - 16); ctx.stroke();
        ctx.fillStyle = '#cc2200';
        ctx.fillRect(sx - tH + 5, top - 16, 8, 5);
      }
    } else if (isl.h > 20) {
      // Fallback — palm tree for untyped islands
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
    drawHostages();
    drawDestroyer();
    drawPassengerShip();
    drawInterceptors();
    drawAkulaMolot();
    drawDelfins();

  // --- Depth charges, torpedoes, missiles (drawn by weapons.js) ---
  drawDepthCharges();
  drawTorpedoes();
  drawMissiles();

  // Enemies
  for (const e of world.enemies) drawEnemy(e);
  drawSopwith();
  drawAirSupremacy();
  drawBerkutDrones();
  drawAirInterceptors();
  drawNemesis();
  drawMotorcyclists();
  drawEvelCameratron();
  drawSquadron();

  // ── New projectile rendering (MG, railgun, bouncing bombs, commander) ──
  // Sub MG bullets — small yellow dots
  ctx.fillStyle = '#fde68a';
  for (const b of world.subMgBullets) {
    const bsx = toScreen(b.worldX);
    if (bsx < -5 || bsx > W + 5) continue;
    ctx.beginPath(); ctx.arc(bsx, b.y, 1.5, 0, TWO_PI); ctx.fill();
  }
  // Railgun shots — thick superheated beam with expanding shockwave and ionisation trail
  for (const r of world.railgunShots) {
    const rsx = toScreen(r.worldX);
    if (rsx < -40 || rsx > W + 40) continue;

    // Ionisation trail — thick glowing line from each trail point
    if (r.trail.length > 1) {
      for (let i = 1; i < r.trail.length; i++) {
        const t0 = r.trail[i - 1], t1 = r.trail[i];
        const age = t1.age;
        const alpha = Math.max(0, 0.6 - age * 0.04);
        const width = Math.max(1, 6 - age * 0.3);
        // Outer glow
        ctx.strokeStyle = `rgba(125,249,255,${alpha * 0.3})`;
        ctx.lineWidth = width + 4;
        ctx.beginPath(); ctx.moveTo(toScreen(t0.wx), t0.y); ctx.lineTo(toScreen(t1.wx), t1.y); ctx.stroke();
        // Core beam
        ctx.strokeStyle = `rgba(200,240,255,${alpha})`;
        ctx.lineWidth = width;
        ctx.beginPath(); ctx.moveTo(toScreen(t0.wx), t0.y); ctx.lineTo(toScreen(t1.wx), t1.y); ctx.stroke();
      }
    }

    // Expanding shockwave ring at the projectile tip
    const ringAge = RAILGUN_LIFE - r.life;
    if (ringAge < 15) {
      const ringR = ringAge * 2.5;
      const ringAlpha = Math.max(0, 0.5 - ringAge / 20);
      ctx.strokeStyle = `rgba(125,249,255,${ringAlpha})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(rsx, r.y, ringR, 0, TWO_PI); ctx.stroke();
    }

    // Core projectile — bright white/cyan with heavy glow
    ctx.shadowColor = '#7df9ff'; ctx.shadowBlur = 16;
    ctx.fillStyle = '#e0f7ff';
    ctx.beginPath(); ctx.arc(rsx, r.y, 4, 0, TWO_PI); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(rsx, r.y, 2, 0, TWO_PI); ctx.fill();
    ctx.shadowBlur = 0;
  }
  // Bouncing bombs — cylindrical barrel with backspin, rivets, and water plumes
  for (const bb of world.bouncingBombs) {
    const bbsx = toScreen(bb.worldX);
    if (bbsx < -15 || bbsx > W + 15) continue;

    ctx.save();
    ctx.translate(bbsx, bb.y);
    ctx.rotate(bb.spin); // Backspin rotation

    // Barrel body (cylinder seen from the side — rounded rectangle)
    ctx.fillStyle = '#1a1a2e';
    ctx.beginPath();
    ctx.moveTo(-8, -5); ctx.lineTo(8, -5);
    ctx.arc(8, 0, 5, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(-8, 5);
    ctx.arc(-8, 0, 5, Math.PI / 2, -Math.PI / 2);
    ctx.closePath();
    ctx.fill();
    // Metal bands
    ctx.strokeStyle = '#475569'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(-4, -5); ctx.lineTo(-4, 5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(4, -5); ctx.lineTo(4, 5); ctx.stroke();
    // Highlight (sheen on top)
    ctx.strokeStyle = 'rgba(148,163,184,0.4)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-6, -4); ctx.lineTo(6, -4); ctx.stroke();
    // Rivets (small dots)
    ctx.fillStyle = '#64748b';
    ctx.beginPath(); ctx.arc(-6, 0, 1, 0, TWO_PI); ctx.fill();
    ctx.beginPath(); ctx.arc(0, 0, 1, 0, TWO_PI); ctx.fill();
    ctx.beginPath(); ctx.arc(6, 0, 1, 0, TWO_PI); ctx.fill();
    // Fuse cap on the end
    ctx.fillStyle = '#ef4444';
    ctx.beginPath(); ctx.arc(9, 0, 2.5, 0, TWO_PI); ctx.fill();

    ctx.restore();

    // Water plume at surface level when near the waterline (just bounced or about to)
    if (Math.abs(bb.y - WATER_LINE) < 12 && bb.bounces > 0) {
      const plumeAlpha = Math.max(0, 0.5 - Math.abs(bb.y - WATER_LINE) / 20);
      ctx.fillStyle = `rgba(133,193,233,${plumeAlpha})`;
      // V-shaped spray
      for (let s = 0; s < 5; s++) {
        const spread = (s - 2) * 6;
        const height = 8 + Math.random() * 6;
        ctx.fillRect(bbsx + spread - 1, WATER_LINE - height, 2, height);
      }
    }
  }
  // Commander bullets (pistol=yellow, grenade=green arc, PPC=magenta beam)
  for (const b of world.commanderBullets) {
    const bsx = toScreen(b.worldX);
    if (bsx < -10 || bsx > W + 10) continue;
    if (b.type === 'ppc') {
      ctx.fillStyle = '#ff00ff';
      ctx.shadowColor = '#ff00ff'; ctx.shadowBlur = 6;
      ctx.beginPath(); ctx.arc(bsx, b.y, 3, 0, TWO_PI); ctx.fill();
      ctx.shadowBlur = 0;
    } else if (b.type === 'grenade') {
      ctx.fillStyle = '#166534';
      ctx.beginPath(); ctx.arc(bsx, b.y, 3.5, 0, TWO_PI); ctx.fill();
      ctx.strokeStyle = '#4ade80'; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.arc(bsx, b.y, 3.5, 0, TWO_PI); ctx.stroke();
    } else {
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath(); ctx.arc(bsx, b.y, 1.3, 0, TWO_PI); ctx.fill();
    }
  }

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

  // --- NEMESIS LAIR ---
  drawNemesisLair();

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

    // Tier 1 wobble offset (tick-driven — draw() has no dt)
    const wobblePhase = world.tick * 0.008 + r.x * 0.1;
    const wobbleX = r.wobbleRange ? Math.sin(wobblePhase) * r.wobbleRange : 0;
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
          const smokeAge = Math.max(0, (25 - r.cooldown + p * 3) * 0.4);
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

  // --- DEBUG OVERLAY — only when launched with --debug ---
  // Shows camera/sub/pilot state; cache-busted so every reload picks up latest JS.
  if (typeof window !== 'undefined' && window.DEBUG_MODE) {
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#ff00ff';
    ctx.fillRect(W/2 - 220, 10, 440, 128);
    ctx.strokeStyle = '#ffff00'; ctx.lineWidth = 3;
    ctx.strokeRect(W/2 - 220, 10, 440, 128);
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'left';
    const _s = world.sub;
    const _hx = 420 - 20 - world.cameraY;
    const _sx = _s.y - world.cameraY;
    const _x0 = W/2 - 210;
    ctx.fillText('DEBUG MODE ACTIVE', _x0, 30);
    ctx.fillText('sub.y       = ' + _s.y.toFixed(1), _x0, 48);
    ctx.fillText('cameraY     = ' + world.cameraY.toFixed(1), _x0, 66);
    ctx.fillText('disembarked = ' + _s.disembarked, _x0, 84);
    ctx.fillText('pilotY      = ' + (_s.pilotY != null ? _s.pilotY.toFixed(1) : 'n/a'), _x0, 102);
    ctx.fillText('hangar scrY = ' + _hx.toFixed(1) + ' (want 0-600)', _x0, 120);
    ctx.fillText('sub scrY    = ' + _sx.toFixed(1) + ' (want ~270)', _x0, 136);
    ctx.restore();
  }

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

  // End-of-mission scoring screen (game over or level complete)
  if (world.gameOver || world.levelComplete) {
    drawMissionScoringScreen();
    if (keyJustPressed['r']||keyJustPressed['R']) world = initWorld();
    // Q from scoring screen → quit to desktop
    if ((keyJustPressed['q']||keyJustPressed['Q']) && world.quitConfirm) {
      try { navigator.sendBeacon('/shutdown', ''); } catch {}
      try { window.close(); } catch {}
    } else if (keyJustPressed['q']||keyJustPressed['Q']) {
      world.quitConfirm = true;
    }
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

  // --- Rescue ladder ---
  // Rendered BEFORE the sub body so the rope appears to come out of the belly.
  if (sub.ladderLength > 1) {
    const len = sub.ladderLength;
    const swingAmp = sub.vtolUpgrade ? 2 : 7;
    const swing = Math.sin(world.tick * 0.12) * swingAmp;
    const ladderTopY = sub.y + 4;
    const ladderBotY = ladderTopY + len;
    const ladderBotX = sx + swing;
    // Two rails
    ctx.strokeStyle = '#8a6a3a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(sx - 3, ladderTopY); ctx.lineTo(ladderBotX - 3, ladderBotY);
    ctx.moveTo(sx + 3, ladderTopY); ctx.lineTo(ladderBotX + 3, ladderBotY);
    ctx.stroke();
    // Rungs
    ctx.lineWidth = 1;
    const rungCount = Math.floor(len / 8);
    for (let r = 0; r < rungCount; r++) {
      const t = (r + 1) / (rungCount + 1);
      const rx = sx + swing * t;
      const ry = ladderTopY + len * t;
      ctx.beginPath();
      ctx.moveTo(rx - 3, ry); ctx.lineTo(rx + 3, ry);
      ctx.stroke();
    }
    // Passenger clinging to the bottom
    if (sub.ladderPassenger) {
      ctx.fillStyle = '#f8fafc';
      ctx.beginPath(); ctx.arc(ladderBotX, ladderBotY + 2, 3, 0, TWO_PI); ctx.fill();
      ctx.fillStyle = '#3b82f6'; // blue visor = Evel
      ctx.fillRect(ladderBotX - 2, ladderBotY + 1, 4, 1.5);
      // Legs dangling
      ctx.strokeStyle = '#f8fafc'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(ladderBotX - 1, ladderBotY + 4); ctx.lineTo(ladderBotX - 2, ladderBotY + 9);
      ctx.moveTo(ladderBotX + 1, ladderBotY + 4); ctx.lineTo(ladderBotX + 2, ladderBotY + 9);
      ctx.stroke();
    }
  }

  // Wake ripples when floating
  if (sub.floating && !sub.disembarked) {
    ctx.strokeStyle='rgba(133,193,233,0.3)'; ctx.lineWidth=1;
    for (let i = 0; i < 3; i++) {
      ctx.globalAlpha = 0.3-i*0.1;
      ctx.beginPath(); ctx.ellipse(sx, WATER_LINE+2, 25+i*12, 2+i, 0, 0, Math.PI*2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // ── Flux capacitor flash — Back to the Future style when at 88 MPH + burner + right altitude ──
  if (world._fluxReady && world.tick % 4 < 2) {
    // Bright white/blue flash aura around the sub
    ctx.save();
    ctx.globalAlpha = 0.4 + Math.sin(world.tick * 0.5) * 0.2;
    const flashGrad = ctx.createRadialGradient(sx, sub.y, 5, sx, sub.y, 35);
    flashGrad.addColorStop(0, 'rgba(120,200,255,0.8)');
    flashGrad.addColorStop(0.5, 'rgba(200,230,255,0.3)');
    flashGrad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = flashGrad;
    ctx.beginPath(); ctx.ellipse(sx, sub.y, 40, 18, sub.angle * f, 0, TWO_PI); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();
    // Sparks trailing behind
    if (world.tick % 3 === 0) {
      addParticles(sub.worldX - f * 20, sub.y, 2, '#7df9ff');
      addParticles(sub.worldX - f * 16, sub.y + (Math.random() - 0.5) * 8, 1, '#fff');
    }
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

  // Exhaust / propulsion trail
  if (sub.caterpillarDrive) {
    // Magnetohydrodynamic drive — no propeller, no bubbles.
    // Water is pulled through the hull and ejected aft as a faint current distortion.
    const moving = Math.abs(sub.vx) > 0.1 || Math.abs(sub.vy) > 0.1;
    if (moving) {
      const speed = Math.hypot(sub.vx, sub.vy);
      // Water distortion lines — faint, wide, shimmer effect
      const lineCount = Math.min(6, Math.floor(speed * 3) + 1);
      for (let i = 0; i < lineCount; i++) {
        const age = (world.tick * 0.08 + i * 2.1) % 4;
        const lx = sx - f * (20 + age * 12);
        const ly = sub.y + Math.sin(world.tick * 0.04 + i * 1.5) * (3 + age * 2);
        const len = 4 + age * 3;
        ctx.globalAlpha = 0.08 + (1 - age / 4) * 0.12;
        ctx.strokeStyle = '#4a9ade';
        ctx.lineWidth = 1.5 - age * 0.3;
        ctx.beginPath();
        ctx.moveTo(lx, ly);
        ctx.lineTo(lx - f * len, ly + Math.sin(world.tick * 0.06 + i) * 1.5);
        ctx.stroke();
      }
      // Faint thermal shimmer at the water intake (forward) — barely visible
      if (speed > 0.5) {
        ctx.globalAlpha = 0.06;
        ctx.strokeStyle = '#85c1e9';
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.moveTo(sx + f * 14, sub.y - 3);
        ctx.quadraticCurveTo(sx + f * 18, sub.y, sx + f * 14, sub.y + 3);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  } else if (inWater) {
    // Standard propeller — bubble stream behind the sub
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


// ── HUD + scoring + damage diagram extracted to hud.js ──


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
    // Mirror to VeriSimDB
    if (typeof verisimdbLogCrash === 'function') verisimdbLogCrash(entry);
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

  window.ASS_downloadCrashLog = function () {
    const logs = getCrashLogs();
    const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `ass-crash-log-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  window.ASS_clearCrashLog = function () {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    console.info('[ASS] Crash log cleared.');
  };
}());

// ─────────────────────────────────────────────────────────────────────────────
// STARTUP — kick off the async init() once the DOM is ready.
// document.currentScript is captured at parse time (inside init) so WASM URL
// resolution works correctly regardless of how the page is served.
// ─────────────────────────────────────────────────────────────────────────────
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => init());
} else {
  init();
}
