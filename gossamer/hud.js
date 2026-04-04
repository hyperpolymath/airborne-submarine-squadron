// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Jonathan D.A. Jewell (hyperpolymath)
//
// hud.js — HUD, instruments, overlays, scoring, and damage diagram.
// Extracted from app_gossamer.js for modular organisation.
// Loaded via <script> tag before app_gossamer.js.
//
// Contents:
//   - Compact legend, leaderboard panel, solar minimap
//   - Flight instruments (speedometer, accelerometer, fuel, thermal)
//   - Pause overlay with settings
//   - Warp menu, orbit scene rendering
//   - Eject warning, main HUD, mission scoring screen, damage diagram

/* global world, ctx, W, H, WATER_LINE, SUB_PARTS, MISSION_TYPES,
   COMMANDER_HP, COMMANDER_MAX_HP, SPEEDOMETER_MAX_MPH, ACCELEROMETER_MAX_G,
   MPH_PER_GAME_SPEED, SPACE_MPH_PER_GAME_SPEED, AFTERBURNER_MAX_CHARGE,
   SOLAR_SYSTEM_BODIES, SOLAR_SYSTEM_BOUNDARY, PLANETS, SUN_DESTINATION,
   ORBIT_TRIGGER_SPEED_MPH, EJECT_PRIME_TIMEOUT, THERMAL_TEMPS, THERMAL_LABELS,
   SFX, toScreen, velocityToMph, overallHealth, clamp, componentConditionLabel,
   componentConditionColor, commanderStatusLabel, getThermalLayer,
   loadLeaderboard, saveLeaderboard, loadSettings, saveSettings,
   currentSubSkin, resolveSubSkin, cycleSubSkin, adjustCustomHue,
   getSupplyFrequency, cycleSupplyFrequency, loadKeybinds, saveKeybinds,
   resetKeybinds, keyLabel, keyJustPressed, stripedGradient */

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
  // Red accent in space, blue in atmosphere
  const inOrbit = world.mode === 'orbit';
  const gaugeColor = inOrbit ? '#ef4444' : '#0ea5e9';
  const gaugeColorDim = inOrbit ? 'rgba(239,68,68,0.15)' : 'rgba(14,165,233,0.15)';

  ctx.font = 'bold 38px "Courier New", monospace';
  ctx.fillStyle = gaugeColor;
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
    ctx.fillStyle = segmentActive ? gaugeColor : gaugeColorDim;
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
  ctx.fillStyle = inOrbit
    ? (accel > 2 ? '#fca5a5' : accel > 1 ? '#f87171' : '#ef4444')
    : (accel > 2 ? '#ef4444' : accel > 1 ? '#f59e0b' : '#22c55e');
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
  ctx.fillText('FLIGHT', panelX + 12, panelY + panelH - 42);

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
  ctx.fillText(`Supply crates: ${getSupplyFrequency(world.settings).label}  (C to cycle)`, 420, 308);
  ctx.fillText(`Nemesis sub: ${world.settings.nemesisSub ? 'ON' : 'OFF'}  (G to toggle)`, 420, 328);
  ctx.fillText(`Mission (M to cycle): Strike / Hostage / Escort`, 420, 348);
  ctx.fillText(`Leaderboard entries: ${(world.leaderboard || []).length}`, 420, 368);

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
  if (world.mode === 'orbit') drawSolarMiniMap();
  drawEjectPrimeWarning();
  const sub = world.sub;
  const hudStartY = world.mode === 'orbit'
    ? SOLAR_MAP_PADDING + SOLAR_MAP_SIZE + 6
    : SOLAR_MAP_PADDING;

  // Fuel gauge (afterburner charge) — top-left
  const fuelPct = sub.afterburnerCharge / AFTERBURNER_MAX_CHARGE;
  ctx.fillStyle='rgba(0,0,0,0.5)'; ctx.fillRect(15, hudStartY, 104, 12);
  ctx.fillStyle = fuelPct > 0.5 ? '#f59e0b' : fuelPct > 0.2 ? '#f97316' : '#ef4444';
  ctx.fillRect(17, hudStartY + 2, Math.max(0, fuelPct * 100), 8);
  ctx.strokeStyle='#ecf0f1'; ctx.lineWidth=1; ctx.strokeRect(15, hudStartY, 104, 12);

  ctx.fillStyle='#ecf0f1'; ctx.font='11px Arial'; ctx.textAlign='left';
  ctx.fillText(`Fuel: ${Math.ceil(fuelPct * 100)}%`, 125, hudStartY + 10);

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
  const hudUnlimited = world.settings.supplyFrequency === 'unlimited';
  const tReady = world.fireCooldown <= 0 && canFireTorpedo(sub.parts) && (sub.torpedoAmmo > 0 || hudUnlimited);
  const mReady = world.missileCooldown <= 0 && (sub.missileAmmo > 0 || hudUnlimited);
  const dReady = world.depthChargeCooldown <= 0 && (sub.depthChargeAmmo > 0 || hudUnlimited);
  const tLabel = hudUnlimited ? 'INF' : String(sub.torpedoAmmo);
  const mLabel = hudUnlimited ? 'INF' : String(sub.missileAmmo);
  const dLabel = hudUnlimited ? 'INF' : String(sub.depthChargeAmmo);
  ctx.fillStyle = (!hudUnlimited && sub.torpedoAmmo <= 0) ? '#555' : tReady ? '#2ecc71' : '#7f8c8d';
  ctx.fillText(`TORP x${tLabel} ${(!hudUnlimited&&sub.torpedoAmmo<=0)?'EMPTY':(tReady?'RDY':(canFireTorpedo(sub.parts)?'...':'DMG'))}`, W-15, 128);
  ctx.fillStyle = (!hudUnlimited && sub.missileAmmo <= 0) ? '#555' : mReady ? '#e74c3c' : '#7f8c8d';
  ctx.fillText(`MSL x${mLabel} ${(!hudUnlimited&&sub.missileAmmo<=0)?'EMPTY':(mReady?'RDY':'...')}`, W-15, 142);
  ctx.fillStyle = (!hudUnlimited && sub.depthChargeAmmo <= 0) ? '#555' : dReady ? DEPTH_CHARGE_COLOR : '#7f8c8d';
  ctx.fillText(`DCHG x${dLabel} ${(!hudUnlimited&&sub.depthChargeAmmo<=0)?'EMPTY':(dReady?'RDY':'...')}`, W-15, 156);
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

  // Commander HP (right-aligned, below weapons)
  const cmdHp = sub.commanderHp;
  const cmdColor = cmdHp >= 3 ? '#2ecc71' : cmdHp === 2 ? '#f59e0b' : cmdHp === 1 ? '#ef4444' : '#555';
  ctx.fillStyle = cmdColor;
  ctx.font = '12px Arial';
  ctx.textAlign = 'right';
  ctx.fillText(`CDR ${'♥'.repeat(Math.max(0, cmdHp))}${'♡'.repeat(Math.max(0, COMMANDER_MAX_HP - cmdHp))} ${commanderStatusLabel(cmdHp)}`, W-15, 198);

  // Controls
  ctx.font='11px Arial'; ctx.fillStyle='rgba(255,255,255,0.4)'; ctx.textAlign='center';
  if (sub.disembarked) ctx.fillText('[M] Return to sub  |  J/K: move  |  Arrows: move', W/2, H-10);
  else ctx.fillText('Esc: controls | E: disembark | A: afterburner | AltGr: depth | Ctrl: torpedo | Enter: missile', W/2, H-10);
}

// ============================================================
// MISSION SCORING SCREEN — detailed end-of-mission breakdown
// ============================================================
function drawMissionScoringScreen() {
  const sub = world.sub;
  const parts = sub.parts;
  const failed = world.gameOver && !world.levelComplete;
  const cmdHp = sub.commanderHp;

  // Background overlay
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.fillRect(0, 0, W, H);

  // Panel
  const px = W / 2 - 240;
  const py = 30;
  const pw = 480;
  const ph = H - 60;
  ctx.fillStyle = 'rgba(8,15,30,0.95)';
  ctx.fillRect(px, py, pw, ph);
  ctx.strokeStyle = failed ? '#e74c3c' : '#2ecc71';
  ctx.lineWidth = 2;
  ctx.strokeRect(px, py, pw, ph);

  // Title
  ctx.textAlign = 'center';
  ctx.font = 'bold 32px Arial';
  ctx.fillStyle = failed ? '#e74c3c' : '#2ecc71';
  ctx.fillText(failed ? 'MISSION FAILED' : 'MISSION COMPLETE', W / 2, py + 40);

  // Score and kills
  ctx.font = 'bold 20px Arial';
  ctx.fillStyle = '#f8fafc';
  ctx.fillText(`Score: ${world.score}`, W / 2, py + 72);
  ctx.font = '16px Arial';
  ctx.fillStyle = '#cbd5e1';
  ctx.fillText(`Kills: ${world.kills}  |  Duration: ${Math.floor(world.tick / 60)}s`, W / 2, py + 94);

  // --- Commander Status ---
  let row = py + 126;
  ctx.textAlign = 'left';
  ctx.font = 'bold 16px Arial';
  ctx.fillStyle = '#f8fafc';
  ctx.fillText('COMMANDER', px + 24, row);
  ctx.textAlign = 'right';
  const cmdLabel = commanderStatusLabel(cmdHp);
  const cmdColor = cmdHp >= 3 ? '#2ecc71' : cmdHp === 2 ? '#f59e0b' : cmdHp === 1 ? '#ef4444' : '#555';
  ctx.fillStyle = cmdColor;
  ctx.font = 'bold 16px Arial';
  ctx.fillText(cmdLabel, px + pw - 24, row);
  // Hearts
  ctx.font = '14px Arial';
  ctx.fillText('♥'.repeat(Math.max(0, cmdHp)) + '♡'.repeat(Math.max(0, COMMANDER_MAX_HP - cmdHp)), px + pw - 24, row + 18);

  // Divider
  row += 36;
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(px + 20, row);
  ctx.lineTo(px + pw - 20, row);
  ctx.stroke();

  // --- Sub Components ---
  row += 22;
  ctx.textAlign = 'left';
  ctx.font = 'bold 16px Arial';
  ctx.fillStyle = '#f8fafc';
  ctx.fillText('SUB SYSTEMS', px + 24, row);

  row += 8;
  ctx.font = '14px Arial';
  for (const def of SUB_PARTS) {
    row += 20;
    const hp = parts[def.id];
    const label = componentConditionLabel(hp, def.maxHp);
    const color = componentConditionColor(hp, def.maxHp);

    ctx.textAlign = 'left';
    ctx.fillStyle = '#cbd5e1';
    ctx.fillText(def.name, px + 32, row);

    // Condition bar
    const barX = px + 120;
    const barW = 180;
    const barH = 10;
    const barY = row - 9;
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(barX, barY, barW, barH);
    ctx.fillStyle = color;
    ctx.fillRect(barX, barY, barW * (hp / def.maxHp), barH);
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.strokeRect(barX, barY, barW, barH);

    // Label
    ctx.textAlign = 'right';
    ctx.fillStyle = color;
    ctx.fillText(label, px + pw - 24, row);
  }

  // Overall sub condition
  row += 28;
  const overall = overallHealth(parts);
  const overallLabel = overall >= 100 ? 'Pristine' : overall > 60 ? 'Cosmetic' : overall > 25 ? 'Damaged' : overall > 0 ? 'Severely Damaged' : 'Destroyed';
  const overallColor = overall >= 100 ? '#2ecc71' : overall > 60 ? '#a3e635' : overall > 25 ? '#f59e0b' : overall > 0 ? '#ef4444' : '#555';
  ctx.textAlign = 'left';
  ctx.font = 'bold 14px Arial';
  ctx.fillStyle = '#f8fafc';
  ctx.fillText('Overall', px + 32, row);
  ctx.textAlign = 'right';
  ctx.fillStyle = overallColor;
  ctx.fillText(`${overallLabel} (${Math.ceil(overall)}%)`, px + pw - 24, row);

  // Divider
  row += 16;
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.beginPath();
  ctx.moveTo(px + 20, row);
  ctx.lineTo(px + pw - 20, row);
  ctx.stroke();

  // --- Mission Summary ---
  row += 22;
  ctx.textAlign = 'left';
  ctx.font = 'bold 16px Arial';
  ctx.fillStyle = '#f8fafc';
  ctx.fillText('MISSION SUMMARY', px + 24, row);

  row += 22;
  ctx.font = '14px Arial';
  ctx.fillStyle = '#cbd5e1';
  const summaryLines = [
    `Mode: ${world.mode === 'orbit' ? 'Space' : 'Atmosphere'}`,
    `Supply frequency: ${getSupplyFrequency(world.settings).label}`,
  ];
  if (world.currentDestination) {
    summaryLines.push(`Last destination: ${world.currentDestination.name}`);
  }
  for (const line of summaryLines) {
    ctx.fillText(line, px + 32, row);
    row += 18;
  }

  // Restart prompt
  row = py + ph - 24;
  ctx.textAlign = 'center';
  ctx.font = '18px Arial';
  ctx.fillStyle = '#bdc3c7';
  if (world.quitConfirm) {
    ctx.fillText('Press R to restart  |  Press Q to quit to desktop', W / 2, row);
  } else {
    ctx.fillText('Press R to restart  |  Press Esc then Q to quit', W / 2, row);
  }
}

// ============================================================
// DAMAGE DIAGRAM — side-view sub schematic at top-centre
// ============================================================
function drawDamageDiagram() {
  const parts = world.sub.parts;
  const cx = W / 2;         // Centre of diagram
  const cy = 28;             // Vertical centre
  const scale = 2.2;         // Scale factor

  // Background panel (includes graded HP bar below schematic)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fillRect(cx - 75, 5, 150, 66);
  ctx.strokeStyle = '#555';
  ctx.lineWidth = 1;
  ctx.strokeRect(cx - 75, 5, 150, 66);

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

  // 5. WINGS (top & bottom of hull — swept-back, larger and clearer)
  ctx.fillStyle = partColor(parts.wings, 60);
  ctx.strokeStyle = partColor(parts.wings, 60);
  ctx.lineWidth = 1;
  // Top wing — wider sweep
  ctx.beginPath();
  ctx.moveTo(cx - 4, cy - 6);
  ctx.lineTo(cx - 16, cy - 17);
  ctx.lineTo(cx - 8, cy - 17);
  ctx.lineTo(cx + 2, cy - 7);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Bottom wing — mirror
  ctx.beginPath();
  ctx.moveTo(cx - 4, cy + 6);
  ctx.lineTo(cx - 16, cy + 17);
  ctx.lineTo(cx - 8, cy + 17);
  ctx.lineTo(cx + 2, cy + 7);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // 6. RUDDER / TAIL FIN (V-tail behind engine — clearly separate from wings)
  ctx.fillStyle = partColor(parts.rudder, 60);
  ctx.strokeStyle = partColor(parts.rudder, 60);
  ctx.lineWidth = 1;
  // Upper tail fin
  ctx.beginPath();
  ctx.moveTo(cx - 28, cy - 3);
  ctx.lineTo(cx - 40, cy - 12);
  ctx.lineTo(cx - 36, cy - 12);
  ctx.lineTo(cx - 28, cy - 1);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Lower tail fin
  ctx.beginPath();
  ctx.moveTo(cx - 28, cy + 3);
  ctx.lineTo(cx - 40, cy + 12);
  ctx.lineTo(cx - 36, cy + 12);
  ctx.lineTo(cx - 28, cy + 1);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

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

  // Graded overall HP bar below diagram
  const barY = 56;
  const barX = cx - 60;
  const barW = 120;
  const barH = 8;
  const hp = overallHealth(parts);
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(barX - 2, barY - 1, barW + 4, barH + 2);
  // Draw graded segments: green > yellow > orange > red from left to right
  const segW = barW / 4;
  const gradColors = ['#2ecc71', '#f1c40f', '#f39c12', '#e74c3c'];
  for (let i = 0; i < 4; i++) {
    const segStart = i * 25;    // 0, 25, 50, 75
    const segEnd = (i + 1) * 25;
    const fillFrac = clamp((hp - segStart) / 25, 0, 1);
    if (fillFrac > 0) {
      ctx.fillStyle = gradColors[3 - i]; // red at low HP end, green at high
      ctx.fillRect(barX + i * segW, barY, segW * fillFrac, barH);
    }
  }
  ctx.strokeStyle = '#555';
  ctx.lineWidth = 1;
  ctx.strokeRect(barX - 2, barY - 1, barW + 4, barH + 2);
  // Segment dividers
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  for (let i = 1; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(barX + i * segW, barY);
    ctx.lineTo(barX + i * segW, barY + barH);
    ctx.stroke();
  }
  ctx.fillStyle = '#ccc';
  ctx.font = '8px Arial';
  ctx.textAlign = 'center';
  ctx.fillText(`${Math.ceil(hp)}%`, cx, barY + barH + 9);
}
