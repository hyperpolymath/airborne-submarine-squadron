// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Jonathan D.A. Jewell (hyperpolymath)
//
// persist.js — Settings, keybindings, leaderboard, and save-game persistence.
// Loaded via <script> tag before app_gossamer.js.

/* global world, keys, keyJustPressed,
   PLANETS, PLANET_DESTINATIONS, COMMANDER_MAX_HP,
   initWorld, ticker,
   verisimdbSaveLeaderboard, verisimdbSaveSettings, verisimdbSaveGame */

// ── Storage keys ─────────────────────────────────────────────────────────────
const SETTINGS_KEY    = 'airborne-submarine-squadron:gossamer:settings';
const LEADERBOARD_KEY = 'airborne-submarine-squadron:gossamer:leaderboard';

// ── Sub skin palette catalogue ────────────────────────────────────────────────
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

// ── Default settings ──────────────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  subSkin: 'ocean',
  customHue: 210,
  showLegend: true,
  haloParachute: false,
  deepDiverKit: false,
  supplyFrequency: 'normal',
  nemesisSub: false,       // Toggle: nemesis mini-sub (or auto on higher levels)
};

// ── Supply frequency presets ──────────────────────────────────────────────────
// 'interval' is a multiplier applied to SUPPLY_DROP_INTERVAL — higher = fewer crates.
// 'unlimited' disables ammo consumption entirely (no crates spawn).
const SUPPLY_FREQUENCY_LEVELS = [
  { id: 'none',      label: 'None (crates off)',             interval: Infinity },
  { id: 'few',       label: 'Few crates',                    interval: 3.0 },
  { id: 'normal',    label: 'Normal crate drops',            interval: 1.6 },
  { id: 'many',      label: 'Many crates',                   interval: 1.0 },
  // "Unlimited" means infinite ammo — the resource system is disabled entirely.
  // No crates spawn because they'd be pointless. Kept above in the cycle so
  // the label (and the 'god mode' framing) is unambiguous to the player.
  { id: 'unlimited', label: 'No Limits (infinite ammo, no crates)', interval: Infinity },
];

function getSupplyFrequency(settings) {
  return SUPPLY_FREQUENCY_LEVELS.find(l => l.id === settings.supplyFrequency)
    || SUPPLY_FREQUENCY_LEVELS[2]; // fallback to 'normal'
}

function cycleSupplyFrequency(settings, direction) {
  const levels = SUPPLY_FREQUENCY_LEVELS;
  const idx = levels.findIndex(l => l.id === settings.supplyFrequency);
  const next = (idx + direction + levels.length) % levels.length;
  settings.supplyFrequency = levels[next].id;
  saveSettings(settings);
  return levels[next];
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
  // Mirror to VeriSimDB (fire-and-forget)
  if (typeof verisimdbSaveLeaderboard === 'function') verisimdbSaveLeaderboard(entries.slice(0, 5));
}

function loadSettings() {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    // Pre-game splash-menu settings (if set) override the in-game saved ones
    // for this session. This lets the splash "SETTINGS" button dictate what
    // the player actually starts with, without trampling their persisted
    // in-game tweaks on disk.
    let pregame = {};
    try {
      const rawPre = window.localStorage.getItem('ass_pregame_settings');
      if (rawPre) pregame = JSON.parse(rawPre) || {};
    } catch (_) {}
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      ...pregame,
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
  if (typeof verisimdbSaveSettings === 'function') verisimdbSaveSettings(settings);
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

// ── Keybinding storage ────────────────────────────────────────────────────────
const KEYBIND_STORAGE_KEY = 'ass_keybindings_v2';
const DEFAULT_KEYBINDS = {
  fire:         ' ',           // Spacebar fires the currently selected weapon
  stabilise:    'Shift',       // Left Shift stabilises in all environments
  weaponSlot1:  '1',           // Torpedo (sub) / Pistol (commander)
  weaponSlot2:  '2',           // Missile (sub) / Grenade (commander)
  weaponSlot3:  '3',           // Depth charge (sub)
  weaponSlot9:  '9',           // PPC — commander only, experimental
  afterburner:  'a',
  periscope:    'p',           // Manual toggle (auto-retracts in flight, extends in water)
  disembark:    'e',
  embark:       'm',
  emergencyEject: 'Tab',
  chaff:        'c',
  orbitMenu:    'f',
  swivelLeft:   'z',           // Commander on land — aim left
  swivelRight:  'x',           // Commander on land — aim right
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
        commanderHp: world.sub.commanderHp,
        parts: world.sub.parts,
      },
    };
    window.localStorage.setItem('ass_save_state', JSON.stringify(snapshot));
    if (typeof verisimdbSaveGame === 'function') verisimdbSaveGame(snapshot);
    ticker('Game saved', 60);
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
      fresh.sub.commanderHp = s.commanderHp ?? COMMANDER_MAX_HP;
      if (s.parts) fresh.sub.parts = s.parts;
    }
    world = fresh;
    ticker('Game loaded', 60);
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

// Initialise keybinds singleton on module load.
loadKeybinds();
