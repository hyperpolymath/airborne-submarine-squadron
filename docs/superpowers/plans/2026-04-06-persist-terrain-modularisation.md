# persist.js and terrain.js Modularisation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract localStorage/settings/keybind/leaderboard/save-game code into `gossamer/persist.js` and terrain-generation/hit-test code into `gossamer/terrain.js`, reducing `app_gossamer.js` by ~380 lines across two orthogonal concerns.

**Architecture:** Plain `<script>` tags, no bundler. New files load before `app_gossamer.js` and declare globals consumed by later scripts. Functions reference `world`, `keys`, etc. defined in `app_gossamer.js`; this works because all functions are called at runtime (after all scripts have loaded), not at definition time. `test/_extract.js` is updated to concatenate all source files so existing Deno tests keep finding the constants and functions they already test.

**Tech Stack:** Vanilla JS (browser globals), Deno + JSR std/assert for tests.

**Safe-state protocol:** Each new file is created with code duplicated in both the new file and `app_gossamer.js`. The Deno tests read the concatenated source and therefore always find what they need. Only after tests pass does the duplicate in `app_gossamer.js` get deleted.

---

## File Structure

**Create:**
- `gossamer/persist.js`
- `gossamer/terrain.js`

**Modify:**
- `gossamer/app_gossamer.js` — delete moved constants/functions (Tasks 3 and 6)
- `gossamer/index_gossamer.html` — add two `<script>` tags (Tasks 2 and 5)
- `test/_extract.js` — extend CONST_NAMES, MULTI_CONST_NAMES, FN_NAMES, SRC concat (Tasks 2 and 5)
- `test/unit_test.js` — add new unit tests (Tasks 2 and 5)

---

## Task 1: Create `gossamer/persist.js`

**Files:**
- Create: `gossamer/persist.js`

This task creates the new file. Every constant and function is duplicated between `persist.js` and `app_gossamer.js` — intentional safe state.

- [ ] **Step 1: Run the existing tests as a baseline**

```bash
deno test test/unit_test.js test/integration_test.js --allow-read 2>&1 | tail -5
```

Expected: all tests pass. If any fail, fix them before continuing.

- [ ] **Step 2: Create `gossamer/persist.js`**

Copy each function verbatim from `app_gossamer.js`. For each function, the grep command gives its start line; brace-count from the first `{` until depth returns to zero to find the end.

```javascript
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
  { id: 'ocean',    label: 'Ocean Blue',         hull: '#4a6baf', hullStroke: '#1a5276', wings: '#e74c3c', tower: '#34495e', nose: '#2c3e50', porthole: '#85c1e9' },
  { id: 'red',      label: 'Retro Red',           hull: '#c0392b', hullStroke: '#7b241c', wings: '#f6b93b', tower: '#641e16', nose: '#3d0c02', porthole: '#fdebd0' },
  { id: 'amber',    label: 'Amber Gold',          hull: '#d68910', hullStroke: '#9c640c', wings: '#f8c471', tower: '#7e5109', nose: '#5d4037', porthole: '#fff2cc' },
  { id: 'emerald',  label: 'Emerald',             hull: '#1e8449', hullStroke: '#145a32', wings: '#58d68d', tower: '#0b5345', nose: '#0e6251', porthole: '#d5f5e3' },
  { id: 'violet',   label: 'Violet',              hull: '#7d3c98', hullStroke: '#512e5f', wings: '#c39bd3', tower: '#4a235a', nose: '#2e1a47', porthole: '#ebdef0' },
  { id: 'spectrum', label: 'Spectrum Custom',     customHue: true },
  { id: 'rainbow',  label: 'Rainbow',             rainbow: true,  porthole: '#ffffff', wings: '#ffffff', nose: '#1d3557', tower: '#111827' },
  { id: 'pride',    label: 'Pride Submarine',     pride: true,    porthole: '#ffffff', wings: '#ffffff', nose: '#111827', tower: '#111827' },
];

// ── Default settings object ───────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  subSkin:         'ocean',
  customHue:       210,
  showLegend:      true,
  haloParachute:   false,
  deepDiverKit:    false,
  supplyFrequency: 'normal',
  nemesisSub:      false,
};

// ── Supply frequency presets ──────────────────────────────────────────────────
// 'interval' is a multiplier applied to SUPPLY_DROP_INTERVAL — higher = fewer crates.
// 'unlimited' disables ammo consumption entirely (no crates spawn).
const SUPPLY_FREQUENCY_LEVELS = [
  { id: 'none',      label: 'None (crates off)',                    interval: Infinity },
  { id: 'few',       label: 'Few crates',                           interval: 3.0 },
  { id: 'normal',    label: 'Normal crate drops',                   interval: 1.6 },
  { id: 'many',      label: 'Many crates',                          interval: 1.0 },
  { id: 'unlimited', label: 'No Limits (infinite ammo, no crates)', interval: Infinity },
];

// grep: grep -n "^function getSupplyFrequency" gossamer/app_gossamer.js
function getSupplyFrequency(settings) {
  return SUPPLY_FREQUENCY_LEVELS.find(l => l.id === settings.supplyFrequency)
    || SUPPLY_FREQUENCY_LEVELS[2]; // fallback to 'normal'
}

// grep: grep -n "^function cycleSupplyFrequency" gossamer/app_gossamer.js
function cycleSupplyFrequency(settings, direction) {
  const levels = SUPPLY_FREQUENCY_LEVELS;
  const idx = levels.findIndex(l => l.id === settings.supplyFrequency);
  const next = (idx + direction + levels.length) % levels.length;
  settings.supplyFrequency = levels[next].id;
  saveSettings(settings);
  return levels[next];
}

// grep: grep -n "^function loadLeaderboard" gossamer/app_gossamer.js
function loadLeaderboard() {
  try {
    const raw = window.localStorage.getItem(LEADERBOARD_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.slice(0, 5) : [];
  } catch {
    return [];
  }
}

// grep: grep -n "^function saveLeaderboard" gossamer/app_gossamer.js
function saveLeaderboard(entries) {
  try {
    window.localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(entries.slice(0, 5)));
  } catch {
    // Ignore storage failures; the in-memory leaderboard still works.
  }
  if (typeof verisimdbSaveLeaderboard === 'function') verisimdbSaveLeaderboard(entries.slice(0, 5));
}

// grep: grep -n "^function loadSettings" gossamer/app_gossamer.js
function loadSettings() {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    let pregame = {};
    try {
      const rawPre = window.localStorage.getItem('ass_pregame_settings');
      if (rawPre) pregame = JSON.parse(rawPre) || {};
    } catch (_) {}
    return { ...DEFAULT_SETTINGS, ...parsed, ...pregame };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

// grep: grep -n "^function saveSettings" gossamer/app_gossamer.js
function saveSettings(settings) {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage failures and keep running.
  }
  if (typeof verisimdbSaveSettings === 'function') verisimdbSaveSettings(settings);
}

// grep: grep -n "^function currentSubSkin" gossamer/app_gossamer.js
function currentSubSkin(settings) {
  return SUB_SKINS.find((skin) => skin.id === settings.subSkin) || SUB_SKINS[0];
}

// grep: grep -n "^function resolveSubSkin" gossamer/app_gossamer.js
function resolveSubSkin(settings) {
  const skin = currentSubSkin(settings);
  if (!skin.customHue) return skin;
  const hue = ((settings.customHue ?? DEFAULT_SETTINGS.customHue) % 360 + 360) % 360;
  return {
    ...skin,
    hue,
    hull:       `hsl(${hue} 74% 54%)`,
    hullStroke: `hsl(${hue} 72% 28%)`,
    wings:      `hsl(${(hue + 30) % 360} 88% 70%)`,
    tower:      `hsl(${hue} 42% 22%)`,
    nose:       `hsl(${(hue + 10) % 360} 58% 18%)`,
    porthole:   `hsl(${(hue + 180) % 360} 95% 86%)`,
  };
}

// grep: grep -n "^function cycleSubSkin" gossamer/app_gossamer.js
function cycleSubSkin(settings, direction) {
  const index = SUB_SKINS.findIndex((skin) => skin.id === settings.subSkin);
  const nextIndex = (index + direction + SUB_SKINS.length) % SUB_SKINS.length;
  settings.subSkin = SUB_SKINS[nextIndex].id;
  saveSettings(settings);
  return currentSubSkin(settings);
}

// grep: grep -n "^function adjustCustomHue" gossamer/app_gossamer.js
function adjustCustomHue(settings, delta) {
  settings.customHue = ((settings.customHue ?? DEFAULT_SETTINGS.customHue) + delta + 360) % 360;
  saveSettings(settings);
  return resolveSubSkin(settings);
}

// ── Keybinding storage ────────────────────────────────────────────────────────
const KEYBIND_STORAGE_KEY = 'ass_keybindings_v2';
const DEFAULT_KEYBINDS = {
  fire:           ' ',
  stabilise:      'Shift',
  weaponSlot1:    '1',
  weaponSlot2:    '2',
  weaponSlot3:    '3',
  weaponSlot9:    '9',
  afterburner:    'a',
  periscope:      'p',
  disembark:      'e',
  embark:         'm',
  emergencyEject: 'Tab',
  chaff:          'c',
  orbitMenu:      'f',
  swivelLeft:     'z',
  swivelRight:    'x',
  pause:          'Escape',
  pickup:         'f',
};

// Mutable singleton — populated by loadKeybinds() at module load time.
let keybinds = { ...DEFAULT_KEYBINDS };

// grep: grep -n "^function loadKeybinds" gossamer/app_gossamer.js
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

// grep: grep -n "^function saveKeybinds" gossamer/app_gossamer.js
function saveKeybinds() {
  try {
    window.localStorage.setItem(KEYBIND_STORAGE_KEY, JSON.stringify(keybinds));
  } catch {}
}

// grep: grep -n "^function resetKeybinds" gossamer/app_gossamer.js
function resetKeybinds() {
  keybinds = { ...DEFAULT_KEYBINDS };
  saveKeybinds();
}

// grep: grep -n "^function keyMatchesAction" gossamer/app_gossamer.js
function keyMatchesAction(action) {
  const bound = keybinds[action];
  if (!bound) return false;
  return !!keys[bound] || !!keys[bound.toUpperCase()] || !!keys[bound.toLowerCase()];
}

// grep: grep -n "^function keyJustMatchesAction" gossamer/app_gossamer.js
function keyJustMatchesAction(action) {
  const bound = keybinds[action];
  if (!bound) return false;
  return !!keyJustPressed[bound] || !!keyJustPressed[bound.toUpperCase()] || !!keyJustPressed[bound.toLowerCase()];
}

// grep: grep -n "^function recordLeaderboardEntry" gossamer/app_gossamer.js
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

// grep: grep -n "^function saveGameState" gossamer/app_gossamer.js
// Copy verbatim from app_gossamer.js (lines ~2785–2817)
// Brace rule: opening `{` at function start; count depth to first `}` at depth 0.

// grep: grep -n "^function loadGameState" gossamer/app_gossamer.js
// Copy verbatim from app_gossamer.js (lines ~2819–2861)
// Brace rule: opening `{` at function start; count depth to first `}` at depth 0.

// grep: grep -n "^function hasSavedGame" gossamer/app_gossamer.js
function hasSavedGame() {
  try {
    return window.localStorage.getItem('ass_save_state') !== null;
  } catch {
    return false;
  }
}

// grep: grep -n "^function keyLabel" gossamer/app_gossamer.js
function keyLabel(key) {
  if (key === ' ')          return 'Space';
  if (key === 'AltGraph')   return 'AltGr';
  if (key === 'Control')    return 'Ctrl';
  if (key === 'ArrowUp')    return 'Up';
  if (key === 'ArrowDown')  return 'Down';
  if (key === 'ArrowLeft')  return 'Left';
  if (key === 'ArrowRight') return 'Right';
  return key.length === 1 ? key.toUpperCase() : key;
}

// Initialise keybinds singleton on module load.
loadKeybinds();
```

**Important:** `saveGameState` and `loadGameState` must be copied verbatim from `app_gossamer.js` — do not summarise. They reference `world`, `ticker`, `initWorld`, `PLANETS`, `PLANET_DESTINATIONS`, `COMMANDER_MAX_HP` as runtime globals.

- [ ] **Step 3: Syntax-check the file**

```bash
node --check gossamer/persist.js 2>&1
```

Expected: no output.

- [ ] **Step 4: Commit (safe state — duplicated)**

```bash
git add gossamer/persist.js
git commit -m "feat: create persist.js — settings, keybinds, leaderboard, save-game (safe state)"
```

---

## Task 2: Wire `persist.js` into HTML, `_extract.js`, and add unit tests

**Files:**
- Modify: `gossamer/index_gossamer.html`
- Modify: `test/_extract.js`
- Modify: `test/unit_test.js`

- [ ] **Step 1: Add `persist.js` script tag to `gossamer/index_gossamer.html`**

Find the script block (currently ending with `orbital.js` + `app_gossamer.js`). Add `persist.js` between `orbital.js` and `app_gossamer.js`:

```html
    <script src="weapons.js?v=2"></script>
    <script src="orbital.js?v=2"></script>
    <script src="persist.js?v=2"></script>
    <script src="app_gossamer.js?v=2"></script>
```

- [ ] **Step 2: Extend SRC concatenation in `test/_extract.js`**

Find the `const SRC = [...]` block (lines 13–17). Replace:

```javascript
const SRC = [
  await Deno.readTextFile(ROOT + 'gossamer/app_gossamer.js'),
  await Deno.readTextFile(ROOT + 'gossamer/weapons.js'),
  await Deno.readTextFile(ROOT + 'gossamer/orbital.js'),
  await Deno.readTextFile(ROOT + 'gossamer/persist.js'),
].join('\n');
```

- [ ] **Step 3: Extend `CONST_NAMES` in `test/_extract.js`**

Find the last line of `CONST_NAMES` (currently `'GUN_POST_MG_COOLDOWN', 'GUN_POST_MG_SPEED', 'GUN_POST_MG_RANGE',`). Add after it:

```javascript
  'SETTINGS_KEY', 'LEADERBOARD_KEY', 'KEYBIND_STORAGE_KEY',
```

- [ ] **Step 4: Extend `MULTI_CONST_NAMES` in `test/_extract.js`**

Find `const MULTI_CONST_NAMES = ['SUB_PARTS'];`. Replace with:

```javascript
const MULTI_CONST_NAMES = ['SUB_PARTS', 'SUB_SKINS', 'DEFAULT_SETTINGS', 'SUPPLY_FREQUENCY_LEVELS', 'DEFAULT_KEYBINDS'];
```

- [ ] **Step 5: Extend `FN_NAMES` in `test/_extract.js`**

Find the last entry in `FN_NAMES` (currently `'getSupplyFrequency', 'cycleSupplyFrequency',`). Add after it:

```javascript
  'currentSubSkin', 'resolveSubSkin', 'keyLabel',
```

- [ ] **Step 6: Add unit tests to `test/unit_test.js`**

Append to `test/unit_test.js`:

```javascript
// ── persist.js — keyLabel ────────────────────────────────────────────────────

Deno.test("unit: keyLabel — spacebar maps to 'Space'", () => {
  assertEquals(F.keyLabel(' '), 'Space');
});

Deno.test("unit: keyLabel — 'AltGraph' maps to 'AltGr'", () => {
  assertEquals(F.keyLabel('AltGraph'), 'AltGr');
});

Deno.test("unit: keyLabel — 'Control' maps to 'Ctrl'", () => {
  assertEquals(F.keyLabel('Control'), 'Ctrl');
});

Deno.test("unit: keyLabel — arrow keys map to short names", () => {
  assertEquals(F.keyLabel('ArrowUp'),    'Up');
  assertEquals(F.keyLabel('ArrowDown'),  'Down');
  assertEquals(F.keyLabel('ArrowLeft'),  'Left');
  assertEquals(F.keyLabel('ArrowRight'), 'Right');
});

Deno.test("unit: keyLabel — single character is uppercased", () => {
  assertEquals(F.keyLabel('a'), 'A');
  assertEquals(F.keyLabel('z'), 'Z');
});

Deno.test("unit: keyLabel — multi-char non-arrow key returned as-is", () => {
  assertEquals(F.keyLabel('Escape'), 'Escape');
  assertEquals(F.keyLabel('Shift'),  'Shift');
});

// ── persist.js — currentSubSkin ──────────────────────────────────────────────

Deno.test("unit: currentSubSkin — 'ocean' id returns ocean skin", () => {
  const skin = F.currentSubSkin({ subSkin: 'ocean' });
  assertEquals(skin.id, 'ocean');
  assert(typeof skin.hull === 'string', 'hull must be a string');
});

Deno.test("unit: currentSubSkin — unknown id falls back to first skin", () => {
  const skin = F.currentSubSkin({ subSkin: 'nonexistent' });
  assertEquals(skin.id, 'ocean');
});

Deno.test("unit: currentSubSkin — each known id resolves to itself", () => {
  const ids = ['ocean', 'red', 'amber', 'emerald', 'violet', 'spectrum', 'rainbow', 'pride'];
  for (const id of ids) {
    const skin = F.currentSubSkin({ subSkin: id });
    assertEquals(skin.id, id, `id '${id}' should resolve to itself`);
  }
});

// ── persist.js — getSupplyFrequency ──────────────────────────────────────────

Deno.test("unit: getSupplyFrequency — 'normal' resolves correctly", () => {
  const level = F.getSupplyFrequency({ supplyFrequency: 'normal' });
  assertEquals(level.id, 'normal');
  assert(isFinite(level.interval), 'normal interval must be finite');
});

Deno.test("unit: getSupplyFrequency — 'none' has Infinity interval", () => {
  const level = F.getSupplyFrequency({ supplyFrequency: 'none' });
  assertEquals(level.interval, Infinity);
});

Deno.test("unit: getSupplyFrequency — 'unlimited' has Infinity interval", () => {
  const level = F.getSupplyFrequency({ supplyFrequency: 'unlimited' });
  assertEquals(level.interval, Infinity);
});

Deno.test("unit: getSupplyFrequency — unknown id falls back to 'normal'", () => {
  const level = F.getSupplyFrequency({ supplyFrequency: 'bogus' });
  assertEquals(level.id, 'normal');
});

Deno.test("unit: getSupplyFrequency — 'few' interval greater than 'many'", () => {
  const few  = F.getSupplyFrequency({ supplyFrequency: 'few' });
  const many = F.getSupplyFrequency({ supplyFrequency: 'many' });
  assert(few.interval > many.interval, 'fewer crates = larger interval multiplier');
});
```

- [ ] **Step 7: Run tests**

```bash
deno test test/unit_test.js test/integration_test.js --allow-read 2>&1 | tail -15
```

Expected: all tests pass including the new persist.js unit tests.

- [ ] **Step 8: Commit**

```bash
git add gossamer/index_gossamer.html test/_extract.js test/unit_test.js
git commit -m "feat: wire persist.js into HTML and _extract.js; add keyLabel/currentSubSkin/getSupplyFrequency tests"
```

---

## Task 3: Delete persist code from `app_gossamer.js`

**Files:**
- Modify: `gossamer/app_gossamer.js`

- [ ] **Step 1: Delete `SETTINGS_KEY` and `LEADERBOARD_KEY` (lines ~285–286)**

```bash
grep -n "^const SETTINGS_KEY\|^const LEADERBOARD_KEY" gossamer/app_gossamer.js
```

Delete both lines.

- [ ] **Step 2: Delete `SUB_SKINS` array (lines ~290–299)**

```bash
grep -n "^const SUB_SKINS" gossamer/app_gossamer.js
```

Delete from `const SUB_SKINS = [` through the closing `];`. Bracket rule: count `[`/`]` depth from the `[` on the `const SUB_SKINS =` line until depth returns to 0, followed by `;`.

- [ ] **Step 3: Delete `DEFAULT_SETTINGS` object (lines ~300–308)**

```bash
grep -n "^const DEFAULT_SETTINGS" gossamer/app_gossamer.js
```

Delete from `const DEFAULT_SETTINGS = {` through closing `};`.

- [ ] **Step 4: Delete `SUPPLY_FREQUENCY_LEVELS` array and its comment block (lines ~310–322)**

```bash
grep -n "^const SUPPLY_FREQUENCY_LEVELS" gossamer/app_gossamer.js
```

Delete the comment block above it (`// Supply crate frequency presets...`) and the array through its closing `];`.

- [ ] **Step 5: Delete `getSupplyFrequency` and `cycleSupplyFrequency` (lines ~324–336)**

```bash
grep -n "^function getSupplyFrequency\|^function cycleSupplyFrequency" gossamer/app_gossamer.js
```

Delete both functions entirely.

- [ ] **Step 6: Delete `loadLeaderboard`, `saveLeaderboard`, `loadSettings`, `saveSettings` (lines ~1634–1684)**

```bash
grep -n "^function loadLeaderboard\|^function saveLeaderboard\|^function loadSettings\|^function saveSettings" gossamer/app_gossamer.js
```

Delete each function body using brace-counting.

- [ ] **Step 7: Delete `currentSubSkin`, `resolveSubSkin`, `cycleSubSkin`, `adjustCustomHue` (lines ~1686–1718)**

```bash
grep -n "^function currentSubSkin\|^function resolveSubSkin\|^function cycleSubSkin\|^function adjustCustomHue" gossamer/app_gossamer.js
```

Delete each function body.

- [ ] **Step 8: Delete keybind constants and singleton (lines ~1723–1744)**

```bash
grep -n "^const KEYBIND_STORAGE_KEY\|^const DEFAULT_KEYBINDS\|^let keybinds" gossamer/app_gossamer.js
```

Delete `KEYBIND_STORAGE_KEY`, `DEFAULT_KEYBINDS` (multi-line object, brace-count to closing `};`), and `let keybinds = { ...DEFAULT_KEYBINDS };`.

- [ ] **Step 9: Delete `loadKeybinds`, `saveKeybinds`, `resetKeybinds`, `keyMatchesAction`, `keyJustMatchesAction` and the top-level `loadKeybinds();` call (lines ~1746–1783)**

```bash
grep -n "^function loadKeybinds\|^function saveKeybinds\|^function resetKeybinds\|^function keyMatchesAction\|^function keyJustMatchesAction" gossamer/app_gossamer.js
```

Delete each function. Also delete the standalone `loadKeybinds();` call line (persist.js now has this call at its own end):

```bash
grep -n "^loadKeybinds();" gossamer/app_gossamer.js
```

Delete that line.

- [ ] **Step 10: Delete `recordLeaderboardEntry` (lines ~1789–1800)**

```bash
grep -n "^function recordLeaderboardEntry" gossamer/app_gossamer.js
```

Delete the entire function.

- [ ] **Step 11: Delete `saveGameState`, `loadGameState`, `hasSavedGame` (lines ~2785–2869)**

```bash
grep -n "^function saveGameState\|^function loadGameState\|^function hasSavedGame" gossamer/app_gossamer.js
```

Delete each function using brace-counting. `loadGameState` is ~43 lines; brace-count carefully.

- [ ] **Step 12: Delete `keyLabel` (lines ~2875–2884)**

```bash
grep -n "^function keyLabel" gossamer/app_gossamer.js
```

Delete the entire function.

- [ ] **Step 13: Verify no persist definitions remain**

```bash
grep -n "^const SETTINGS_KEY\|^const LEADERBOARD_KEY\|^const KEYBIND_STORAGE_KEY\|^const DEFAULT_KEYBINDS\|^const SUPPLY_FREQUENCY_LEVELS\|^const DEFAULT_SETTINGS\|^const SUB_SKINS\b\|^let keybinds\|^function loadLeaderboard\|^function saveLeaderboard\|^function loadSettings\|^function saveSettings\|^function currentSubSkin\|^function resolveSubSkin\|^function cycleSubSkin\|^function adjustCustomHue\|^function loadKeybinds\|^function saveKeybinds\|^function resetKeybinds\|^function keyMatchesAction\|^function keyJustMatchesAction\|^function recordLeaderboardEntry\|^function saveGameState\|^function loadGameState\|^function hasSavedGame\|^function keyLabel\|^function getSupplyFrequency\|^function cycleSupplyFrequency" gossamer/app_gossamer.js
```

Expected: no output.

- [ ] **Step 14: Syntax-check and run tests**

```bash
node --check gossamer/app_gossamer.js 2>&1
deno test test/unit_test.js test/integration_test.js --allow-read 2>&1 | tail -10
```

Expected: no syntax errors; all tests pass.

- [ ] **Step 15: Commit**

```bash
git add gossamer/app_gossamer.js
git commit -m "refactor: remove persist constants and functions moved to persist.js"
```

---

## Task 4: Create `gossamer/terrain.js`

**Files:**
- Create: `gossamer/terrain.js`

- [ ] **Step 1: Find `generateTerrain` start and end in `app_gossamer.js`**

```bash
grep -n "^function generateTerrain" gossamer/app_gossamer.js
```

The function is ~312 lines. Brace rule: opening `{` on the `function generateTerrain(` line; count `{`/`}` depth until depth returns to 0. The end is the `}` just before `// --- Hangar constants ---`.

- [ ] **Step 2: Create `gossamer/terrain.js`**

```javascript
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

// grep: grep -n "^function generateTerrain" gossamer/app_gossamer.js
// Copy verbatim from app_gossamer.js — the function starts at the matched line
// and ends at the first `}` that returns brace depth to 0 (~312 lines).
// The function references DESTROYER_HP, AKULA_HP, DELFIN_COUNT, INTERCEPTOR_COUNT,
// MOTORCYCLE_SPEED, EVEL_SPEED, PASSENGER_SHIP_HP, HANGAR_MAX_HP, and more
// as runtime globals. All are available at call time.
[PASTE generateTerrain VERBATIM FROM app_gossamer.js]

// grep: grep -n "^function groundYFromTerrain" gossamer/app_gossamer.js
function groundYFromTerrain(terrain, worldX) {
  const t = terrain.ground;
  const idx = Math.floor(worldX / 4);
  if (idx < 0 || idx >= t.length - 1) return SEA_FLOOR;
  const t0 = t[idx], t1 = t[idx + 1];
  return t0.y + (t1.y - t0.y) * ((worldX / 4) - idx);
}

// grep: grep -n "^function islandHitTest" gossamer/app_gossamer.js
function islandHitTest(worldX, screenY) {
  for (const isl of world.terrain.islands) {
    const top = WATER_LINE - isl.h;
    if (screenY <= WATER_LINE && screenY >= top - 2) {
      const t = Math.max(0, Math.min(1, (screenY - top) / isl.h));
      const halfW = (isl.topW / 2) + t * ((isl.baseW - isl.topW) / 2);
      if (Math.abs(worldX - isl.x) <= halfW) return { island: isl };
    }
    if (screenY > WATER_LINE && screenY < WATER_LINE + isl.underwaterDepth + 10) {
      const dx = Math.abs(worldX - isl.x);
      if (dx > isl.underwaterW / 2) continue;
      const frac = (worldX - (isl.x - isl.underwaterW/2)) / isl.underwaterW;
      const depthAtX = WATER_LINE + isl.underwaterDepth * Math.sin(Math.max(0, Math.min(1, frac)) * Math.PI);
      if (screenY < depthAtX) {
        if (isl.hasTunnel && screenY > isl.tunnelY - isl.tunnelH/2 && screenY < isl.tunnelY + isl.tunnelH/2
            && dx < isl.underwaterW * 0.35) {
          continue;
        }
        return { island: isl, underwater: true };
      }
    }
  }
  return null;
}

// grep: grep -n "^function nearbyIslandForDocking" gossamer/app_gossamer.js
function nearbyIslandForDocking(worldX, screenY) {
  for (const isl of world.terrain.islands) {
    const dx = Math.abs(worldX - isl.x);
    if (dx > isl.baseW/2 - 5 && dx < isl.baseW/2 + 30 && screenY > WATER_LINE - 15 && screenY < WATER_LINE + 15)
      return isl;
  }
  return null;
}

// grep: grep -n "^function getGroundY" gossamer/app_gossamer.js
function getGroundY(worldX) {
  const t = world.terrain.ground, idx = Math.floor(worldX / 4);
  if (idx < 0 || idx >= t.length - 1) return GROUND_BASE;
  const t0 = t[idx], t1 = t[idx + 1];
  return t0.y + (t1.y - t0.y) * ((worldX / 4) - idx);
}
```

The `[PASTE generateTerrain VERBATIM FROM app_gossamer.js]` placeholder must be replaced with the exact lines from `app_gossamer.js`.

- [ ] **Step 3: Syntax-check**

```bash
node --check gossamer/terrain.js 2>&1
```

Expected: no output.

- [ ] **Step 4: Commit (safe state)**

```bash
git add gossamer/terrain.js
git commit -m "feat: create terrain.js — generateTerrain, groundYFromTerrain, island hit tests, getGroundY (safe state)"
```

---

## Task 5: Wire `terrain.js` into HTML, `_extract.js`, and add unit tests

**Files:**
- Modify: `gossamer/index_gossamer.html`
- Modify: `test/_extract.js`
- Modify: `test/unit_test.js`

- [ ] **Step 1: Add `terrain.js` script tag to `gossamer/index_gossamer.html`**

Find the block updated in Task 2. Add `terrain.js` between `persist.js` and `app_gossamer.js`:

```html
    <script src="persist.js?v=2"></script>
    <script src="terrain.js?v=2"></script>
    <script src="app_gossamer.js?v=2"></script>
```

- [ ] **Step 2: Extend SRC concatenation in `test/_extract.js`**

Replace the `const SRC = [...]` block with:

```javascript
const SRC = [
  await Deno.readTextFile(ROOT + 'gossamer/app_gossamer.js'),
  await Deno.readTextFile(ROOT + 'gossamer/weapons.js'),
  await Deno.readTextFile(ROOT + 'gossamer/orbital.js'),
  await Deno.readTextFile(ROOT + 'gossamer/persist.js'),
  await Deno.readTextFile(ROOT + 'gossamer/terrain.js'),
].join('\n');
```

- [ ] **Step 3: Add `groundYFromTerrain` to `FN_NAMES` in `test/_extract.js`**

Find the last entry in `FN_NAMES` (currently `'currentSubSkin', 'resolveSubSkin', 'keyLabel',`). Add:

```javascript
  'groundYFromTerrain',
```

- [ ] **Step 4: Add unit tests to `test/unit_test.js`**

Append to `test/unit_test.js`:

```javascript
// ── terrain.js — groundYFromTerrain ──────────────────────────────────────────

Deno.test("unit: groundYFromTerrain — returns SEA_FLOOR for negative worldX", () => {
  const terrain = { ground: [{ x: 0, y: 500 }, { x: 4, y: 502 }] };
  assertEquals(F.groundYFromTerrain(terrain, -1), C.SEA_FLOOR);
});

Deno.test("unit: groundYFromTerrain — returns SEA_FLOOR for worldX past end", () => {
  // idx = floor(100/4) = 25, but ground.length-1 = 1 → out of range
  const terrain = { ground: [{ x: 0, y: 500 }, { x: 4, y: 502 }] };
  assertEquals(F.groundYFromTerrain(terrain, 100), C.SEA_FLOOR);
});

Deno.test("unit: groundYFromTerrain — interpolation at exact midpoint", () => {
  // y=400 at x=0, y=500 at x=4 → worldX=2 → idx=0, frac=0.5 → y=450
  const terrain = { ground: [{ x: 0, y: 400 }, { x: 4, y: 500 }] };
  assertEquals(F.groundYFromTerrain(terrain, 2), 450);
});

Deno.test("unit: groundYFromTerrain — at worldX=0 returns first point y exactly", () => {
  const terrain = { ground: [{ x: 0, y: 600 }, { x: 4, y: 610 }] };
  assertEquals(F.groundYFromTerrain(terrain, 0), 600);
});

Deno.test("unit: groundYFromTerrain — monotone between ascending points", () => {
  const terrain = { ground: [{ x: 0, y: 500 }, { x: 4, y: 520 }] };
  const y1 = F.groundYFromTerrain(terrain, 1);
  const y2 = F.groundYFromTerrain(terrain, 2);
  const y3 = F.groundYFromTerrain(terrain, 3);
  assert(y1 < y2 && y2 < y3, 'interpolated y should increase monotonically');
});
```

- [ ] **Step 5: Run tests**

```bash
deno test test/unit_test.js test/integration_test.js --allow-read 2>&1 | tail -15
```

Expected: all tests pass including the new `groundYFromTerrain` tests.

- [ ] **Step 6: Commit**

```bash
git add gossamer/index_gossamer.html test/_extract.js test/unit_test.js
git commit -m "feat: wire terrain.js into HTML and _extract.js; add groundYFromTerrain unit tests"
```

---

## Task 6: Delete terrain code from `app_gossamer.js`

**Files:**
- Modify: `gossamer/app_gossamer.js`

- [ ] **Step 1: Delete `generateTerrain` (~lines 390–703)**

```bash
grep -n "^function generateTerrain" gossamer/app_gossamer.js
```

Delete the `// --- Terrain ---` comment line immediately above, and the function through its closing `}` at depth 0. Brace rule: opening `{` at the `function generateTerrain(` line; scan forward counting depth; first `}` at depth 0 ends it.

Verify:
```bash
grep -n "^function generateTerrain" gossamer/app_gossamer.js
```
Expected: no output.

- [ ] **Step 2: Delete `groundYFromTerrain` (~lines 1190–1196)**

```bash
grep -n "^function groundYFromTerrain" gossamer/app_gossamer.js
```

Delete the entire 6-line function.

Verify:
```bash
grep -n "^function groundYFromTerrain" gossamer/app_gossamer.js
```
Expected: no output.

- [ ] **Step 3: Delete `islandHitTest` and its comment (~lines 1472–1499)**

```bash
grep -n "^function islandHitTest" gossamer/app_gossamer.js
```

Delete the comment block immediately above (`// --- Island hit test ...`) and the function through its closing `}` at depth 0.

Verify:
```bash
grep -n "^function islandHitTest" gossamer/app_gossamer.js
```
Expected: no output.

- [ ] **Step 4: Delete `nearbyIslandForDocking` (~lines 1502–1509)**

```bash
grep -n "^function nearbyIslandForDocking" gossamer/app_gossamer.js
```

Delete the entire function.

Verify:
```bash
grep -n "^function nearbyIslandForDocking" gossamer/app_gossamer.js
```
Expected: no output.

- [ ] **Step 5: Delete `getGroundY` (~lines 2713–2718)**

```bash
grep -n "^function getGroundY" gossamer/app_gossamer.js
```

Delete the entire 5-line function.

Verify:
```bash
grep -n "^function getGroundY" gossamer/app_gossamer.js
```
Expected: no output.

- [ ] **Step 6: Final verification**

```bash
grep -n "^function generateTerrain\|^function groundYFromTerrain\|^function islandHitTest\|^function nearbyIslandForDocking\|^function getGroundY" gossamer/app_gossamer.js
```

Expected: no output.

```bash
node --check gossamer/app_gossamer.js 2>&1
deno test test/unit_test.js test/integration_test.js --allow-read 2>&1 | tail -10
```

Expected: no syntax errors; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add gossamer/app_gossamer.js
git commit -m "refactor: remove terrain functions moved to terrain.js"
```

---

## Final check

```bash
deno test test/unit_test.js test/integration_test.js --allow-read 2>&1 | tail -5
wc -l gossamer/app_gossamer.js gossamer/persist.js gossamer/terrain.js
```

Expected line counts (approximate):
- `app_gossamer.js`: ~6768 lines (down from 7148)
- `persist.js`: ~195 lines
- `terrain.js`: ~330 lines

Final load order in `index_gossamer.html`:
```html
<script src="sfx.js?v=2"></script>
<script src="verisimdb.js?v=2"></script>
<script src="enemies.js?v=2"></script>
<script src="hud.js?v=2"></script>
<script src="weapons.js?v=2"></script>
<script src="orbital.js?v=2"></script>
<script src="persist.js?v=2"></script>
<script src="terrain.js?v=2"></script>
<script src="app_gossamer.js?v=2"></script>
```
