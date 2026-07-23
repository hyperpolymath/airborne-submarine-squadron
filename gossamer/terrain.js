// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Jonathan D.A. Jewell (hyperpolymath)
//
// terrain.js — World terrain generation and spatial query helpers.
// Loaded via <script> tag before app_gossamer.js.

/* global world,
   SEA_FLOOR, WATER_LINE, HANGAR_MAX_HP, GROUND_BASE,
   DESTROYER_HP, DESTROYER_MISSILE_COOLDOWN, DESTROYER_DEPTH_CHARGE_COOLDOWN, DESTROYER_TORPEDO_COOLDOWN,
   AKULA_HP, AKULA_SAM_COOLDOWN, AKULA_TORPEDO_COOLDOWN,
   DELFIN_COUNT, DELFIN_HP, DELFIN_TORPEDO_COOLDOWN,
   INTERCEPTOR_COUNT, INTERCEPTOR_HP, INTERCEPTOR_BAZOOKA_COOLDOWN,
   MOTORCYCLE_HP, MOTORCYCLE_SPEED,
   EVEL_HP, EVEL_SPEED,
   PASSENGER_SHIP_HP, PASSENGER_DWELL_TIME */

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

  // Nemesis underwater lair — hidden deep in the thermocline, far from the player's hangar.
  // Placed at ~68% of terrain length so it feels distant and discoverable.
  const nemesisLair = {
    x: Math.round(length * 0.68 + (Math.random() - 0.5) * length * 0.06),
    y: WATER_LINE + 145,   // Deep in thermocline — THERMAL_LAYER_2_MAX is WATER_LINE+195
    w: 110,                // Width of the cave mouth
    h: 52,                 // Height of the cavern opening
    revealed: false,       // Flips true once the player gets close enough to see it
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

  // Island variety — assign types for different visuals and defences
  // Types: residential (houses, few defenders), industrial (cranes, moderate),
  //        military (bunkers, heavy defenders, radar priority)
  for (const isl of islands) {
    const roll = Math.random();
    if (isl.missionIsland) {
      isl.type = 'military'; // Mission islands are always military
    } else if (roll < 0.4) {
      isl.type = 'residential';
    } else if (roll < 0.7) {
      isl.type = 'industrial';
    } else {
      isl.type = 'military';
    }
  }

  // Motorcyclists — sparse: only military islands get bikes (1 each), occasional industrial (30% chance)
  const motorcyclists = [];
  for (const isl of islands) {
    if (isl.h < 15) continue; // Need enough surface to ride on
    // Only military and some industrial islands have motorcyclists
    if (isl.type === 'residential') continue;
    if (isl.type === 'industrial' && Math.random() > 0.3) continue;
    // One bike per island, no more
    motorcyclists.push({
      x: isl.x + (Math.random() - 0.5) * isl.topW * 0.6,
      y: WATER_LINE - isl.h - 4,
      vx: (Math.random() < 0.5 ? 1 : -1) * MOTORCYCLE_SPEED,
      hp: MOTORCYCLE_HP,
      alive: true,
      island: isl,
      isEvel: false,
      mgCooldown: 20 + Math.random() * 30,
      bullets: [],
      jumping: false,
      jumpVy: 0,
      jumpTrail: [],
    });
  }
  // Evel Knievel — one per level. Starts on a military island near a mission island.
  // High initial cooldown so he doesn't jump immediately on startup.
  if (islands.length >= 2) {
    // Prefer an island near (but not on) a mission island
    const missionIslands = islands.filter(i => i.missionIsland);
    let evelIsland;
    if (missionIslands.length > 0) {
      const mi = missionIslands[0];
      // Find nearest non-mission island to the mission island
      let bestDist = Infinity;
      for (const isl of islands) {
        if (isl === mi || isl.h < 15) continue;
        const d = Math.abs(isl.x - mi.x);
        if (d < bestDist && d > 100) { bestDist = d; evelIsland = isl; }
      }
    }
    if (!evelIsland) evelIsland = islands[Math.floor(Math.random() * islands.length)];
    motorcyclists.push({
      x: evelIsland.x,
      y: WATER_LINE - evelIsland.h - 4,
      vx: EVEL_SPEED,
      hp: EVEL_HP,
      alive: true,
      island: evelIsland,
      isEvel: true,
      mgCooldown: 15,
      bullets: [],
      jumping: false,
      jumpVy: 0,
      jumpTrail: [],        // Matrix trail positions for slow-mo effect
      jumpCooldown: 600,    // HIGH initial cooldown — no immediate jump on startup
      targetIsland: null,
      swimming: false,       // True when in water after missed jump
      swimTarget: null,      // Island swimming toward
      captured: false,       // True if player captured him (hostage rescue style)
      capturedBy: null,      // Reference to captor
    });
  }

  return { ground, islands, caves, radars, startPort, endPort, nemesisLair, destroyer, passengerShip, interceptors, akulaMolot, delfins, sunkenSupplies, diverHoles, motorcyclists };
}

function groundYFromTerrain(terrain, worldX) {
  const t = terrain.ground;
  const idx = Math.floor(worldX / 4);
  if (idx < 0 || idx >= t.length - 1) return SEA_FLOOR;
  const t0 = t[idx], t1 = t[idx + 1];
  return t0.y + (t1.y - t0.y) * ((worldX / 4) - idx);
}

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

function getGroundY(worldX) {
  const t = world.terrain.ground, idx = Math.floor(worldX / 4);
  if (idx < 0 || idx >= t.length - 1) return GROUND_BASE;
  const t0 = t[idx], t1 = t[idx + 1];
  return t0.y + (t1.y - t0.y) * ((worldX / 4) - idx);
}
