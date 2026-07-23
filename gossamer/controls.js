// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Jonathan D.A. Jewell (hyperpolymath)
//
// controls.js — Keybinding storage, input state, rebinding, and legend.
// Extracted from persist.js and app_gossamer.js for modular organisation.
// Loaded via <script> tag before persist.js.

/* global world */

// ── Input state ──────────────────────────────────────────────────────
const keys = {};
const keyJustPressed = {};

// ── Keybinding storage ──────────────────────────────────────────────
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

// ── Rebind infrastructure ───────────────────────────────────────────
let rebindAction = null;
const REBIND_ACTIONS = [
  'fire', 'stabilise', 'afterburner', 'periscope', 'disembark',
  'embark', 'emergencyEject', 'chaff', 'swivelLeft', 'swivelRight',
];

// ── Persistence ─────────────────────────────────────────────────────
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

// ── Key matching ────────────────────────────────────────────────────
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

// ── Display helpers ─────────────────────────────────────────────────
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

// ── Control scheme description (for legend / docs) ──────────────────
const CONTROL_SCHEME = {
  flight: [
    { key: 'Arrows', action: 'Steer / climb / dive' },
    { key: 'Space',  action: 'Fire selected weapon' },
    { key: 'Shift',  action: 'Stabilise (all modes)' },
    { key: 'S',      action: 'Air/aqua brake' },
    { key: 'A',      action: 'Afterburner' },
    { key: 'P',      action: 'Periscope (Shift+P auto)' },
    { key: 'E / M',  action: 'Disembark / embark' },
    { key: 'Tab',    action: 'Emergency eject' },
    { key: 'Z / X',  action: 'Aim swivel (on land)' },
  ],
  weapons: [
    { slot: 1, name: 'MG' },
    { slot: 2, name: 'Torpedo' },
    { slot: 3, name: 'Missile' },
    { slot: 4, name: 'Depth Charge' },
    { slot: 5, name: 'Bouncing Bomb' },
    { slot: 9, name: 'Railgun' },
  ],
};

// ── Event listeners ─────────────────────────────────────────────────
// NOTE: The main keydown/keyup listeners remain in app_gossamer.js
// because they are tightly coupled to world state (pause, fullscreen,
// menu). This module provides the keys/keyJustPressed objects that
// those listeners populate.

// Initialise keybinds singleton on module load.
loadKeybinds();
