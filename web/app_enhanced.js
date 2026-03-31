// Enhanced Web Interface for Airborne Submarine Squadron
// Adds power-up and obstacle visualization

const runButton = document.querySelector('#run');
const simButton = document.querySelector('#sim');
const rebuildButton = document.querySelector('#rebuild');
const scoreEl = document.querySelector('#score');
const elapsedEl = document.querySelector('#elapsed');
const logEl = document.querySelector('#log');
const canvas = document.querySelector('#viewport');
const ctx = canvas.getContext('2d');

const WASM_PATH = '../build/airborne-submarine-squadron.wasm';

const WORLD = {
  width: 800,
  height: 600,
  ground: 520,
};

let animationId = null;
let simRunning = false;
let lastFrame = 0;
let wasmInstance = null;
let statePtr = 0;

const keys = new Set();
let powerupElements = [];
let obstacleElements = [];

function log(line) {
  logEl.textContent = line;
}

function readStateFromPtr(ptr, memory) {
  const view = new Int32Array(memory.buffer);
  const base = ptr >> 2;
  const len = view[base];
  const read = (idx) => view[base + 1 + idx] | 0;
  return {
    len,
    tick: read(0),
    env: read(1),
    sub: { x: read(2), y: read(3), vx: read(4), vy: read(5), health: read(6) },
    weapons: { ammo: read(7), cooldown: read(8) },
    projA: { active: read(9), x: read(10), y: read(11) },
    projB: { active: read(12), x: read(13), y: read(14) },
    enemyA: { active: read(15), x: read(16), y: read(17), health: read(18) },
    enemyB: { active: read(19), x: read(20), y: read(21), health: read(22) },
    score: read(23),
    kills: read(24),
    mission: {
      kills_needed: read(25),
      max_ticks: read(26),
      completed: read(27),
      failed: read(28),
    },
    // Power-ups (added)
    powerups: {
      a: { active: read(29), x: read(30), y: read(31), type: read(32) },
      b: { active: read(33), x: read(34), y: read(35), type: read(36) },
      c: { active: read(37), x: read(38), y: read(39), type: read(40) }
    },
    // Obstacles (added)
    obstacles: {
      a: { active: read(41), x: read(42), y: read(43), width: read(44), height: read(45), type: read(46) },
      b: { active: read(47), x: read(48), y: read(49), width: read(50), height: read(51), type: read(52) },
      c: { active: read(53), x: read(54), y: read(55), width: read(56), height: read(57), type: read(58) },
      d: { active: read(59), x: read(60), y: read(61), width: read(62), height: read(63), type: read(64) }
    }
  };
}

function drawSubmarine(sub, env) {
  ctx.fillStyle = env === 0 ? '#f4d35e' : '#4d94ff';
  ctx.fillRect(sub.x - 10, sub.y - 6, 24, 12);
  
  // Draw health bar
  ctx.fillStyle = 'rgba(255, 0, 0, 0.7)';
  ctx.fillRect(sub.x - 10, sub.y - 12, sub.health / 4, 4);
}

function drawProjectile(proj) {
  if (proj.active) {
    ctx.fillStyle = '#ff6f59';
    ctx.beginPath();
    ctx.arc(proj.x, proj.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawEnemy(enemy) {
  if (enemy.active) {
    ctx.fillStyle = '#5dd39e';
    ctx.beginPath();
    ctx.arc(enemy.x, enemy.y, 8, 0, Math.PI * 2);
    ctx.fill();
    
    // Health bar
    ctx.fillStyle = 'rgba(0, 200, 0, 0.7)';
    ctx.fillRect(enemy.x - 8, enemy.y - 12, enemy.health / 6.25, 4);
  }
}

function drawPowerup(powerup) {
  if (!powerup.active) return;
  
  const icons = ['❤️', '🔫', '🛡️', '⚡', '🔥', '💥', '🌍'];
  const icon = icons[powerup.type] || '❓';
  
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.font = '20px "IBM Plex Mono", monospace';
  ctx.fillText(icon, powerup.x - 10, powerup.y + 7);
}

function drawObstacle(obstacle) {
  if (!obstacle.active) return;
  
  ctx.fillStyle = getObstacleColor(obstacle.type);
  ctx.fillRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height);
  
  // Add visual indicators
  if (obstacle.type === 2) { // CoralReef
    ctx.fillStyle = 'rgba(255, 100, 100, 0.3)';
    ctx.fillRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height);
  }
}

function getObstacleColor(type) {
  const colors = [
    'rgba(100, 100, 100, 0.6)',    // Rock
    'rgba(170, 200, 255, 0.7)',   // Iceberg
    'rgba(255, 100, 100, 0.3)',    // CoralReef
    'rgba(68, 136, 204, 0.5)',     // Whirlpool
    'rgba(72, 136, 44, 0.6)',      // ThermalVent
    'rgba(51, 51, 51, 0.4)',       // Minefield
    'rgba(51, 51, 17, 0.5)'        // OilSpill
  ];
  return colors[type] || 'rgba(200, 200, 200, 0.5)';
}

function drawHUD(world) {
  // Clear HUD area
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.fillRect(10, 10, 200, 100);
  
  // Draw stats
  ctx.fillStyle = 'white';
  ctx.font = '12px "IBM Plex Mono", monospace';
  ctx.fillText(`Tick: ${world.tick}`, 20, 25);
  ctx.fillText(`Score: ${world.score}`, 20, 40);
  ctx.fillText(`Kills: ${world.kills}`, 20, 55);
  ctx.fillText(`Health: ${world.sub.health}`, 20, 70);
  ctx.fillText(`Ammo: ${world.weapons.ammo}`, 20, 85);
  
  // Environment indicator
  ctx.fillStyle = world.env === 0 ? '#f4d35e' : '#4d94ff';
  ctx.fillText(world.env === 0 ? 'ENV: AIR' : 'ENV: WATER', 20, 100);
}

function drawWorld(world) {
  // Clear canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  // Draw ground
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.beginPath();
  ctx.moveTo(0, WORLD.ground);
  ctx.lineTo(canvas.width, WORLD.ground);
  ctx.stroke();
  
  // Draw submarine
  drawSubmarine(world.sub, world.env);
  
  // Draw projectiles
  drawProjectile(world.projA);
  drawProjectile(world.projB);
  
  // Draw enemies
  drawEnemy(world.enemies.a);
  drawEnemy(world.enemies.b);
  
  // Draw power-ups (NEW)
  drawPowerup(world.powerups.a);
  drawPowerup(world.powerups.b);
  drawPowerup(world.powerups.c);
  
  // Draw obstacles (NEW)
  drawObstacle(world.obstacles.a);
  drawObstacle(world.obstacles.b);
  drawObstacle(world.obstacles.c);
  drawObstacle(world.obstacles.d);
  
  // Draw HUD
  drawHUD(world);
}

async function loadWasm() {
  const response = await fetch(WASM_PATH, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error('WASM not found. Run ./build.sh first.');
  }
  
  const buffer = await response.arrayBuffer();
  const imports = {
    wasi_snapshot_preview1: {
      fd_write: () => 0,
    },
  };
  
  const { instance } = await WebAssembly.instantiate(buffer, imports);
  return instance;
}

async function runSimulation() {
  scoreEl.textContent = '…';
  elapsedEl.textContent = '…';
  log('Loading WASM…');
  
  try {
    wasmInstance = await loadWasm();
    if (!wasmInstance.exports.init_state) {
      throw new Error('Missing init_state export.');
    }
    if (!wasmInstance.exports.memory) {
      throw new Error('Missing WASM memory export.');
    }
    
    const start = performance.now();
    statePtr = wasmInstance.exports.init_state();
    const elapsed = performance.now() - start;
    
    const state = readStateFromPtr(statePtr, wasmInstance.exports.memory);
    scoreEl.textContent = String(state.score);
    elapsedEl.textContent = `${elapsed.toFixed(2)} ms`;
    log(`WASM run complete. Kills=${state.kills}, Mission=${state.mission.completed ? 'COMPLETE' : state.mission.failed ? 'FAILED' : 'ACTIVE'}.`);
    
    // Start visual simulation
    startSim();
  } catch (err) {
    scoreEl.textContent = '—';
    elapsedEl.textContent = '—';
    log(err.message || String(err));
  }
}

function startSim() {
  if (simRunning) return;
  simRunning = true;
  log('Visual sim running (JS).');
  lastFrame = performance.now();
  animationId = requestAnimationFrame(animate);
}

function stopSim() {
  simRunning = false;
  if (animationId) cancelAnimationFrame(animationId);
  animationId = null;
}

function animate(ts) {
  if (!simRunning) return;
  const dt = ts - lastFrame;
  if (dt > 16) {
    if (wasmInstance && statePtr) {
      const state = readStateFromPtr(statePtr, wasmInstance.exports.memory);
      drawWorld(state);
      scoreEl.textContent = String(state.score);
      elapsedEl.textContent = `${state.tick} ticks`;
    }
    lastFrame = ts;
  }
  animationId = requestAnimationFrame(animate);
}

// Initialize
runButton.addEventListener('click', runSimulation);

simButton.addEventListener('click', () => {
  if (simRunning) {
    stopSim();
    simButton.textContent = 'Start Visual Sim';
    log('Visual sim stopped.');
  } else {
    startSim();
    simButton.textContent = 'Stop Visual Sim';
  }
});

rebuildButton.addEventListener('click', () => {
  log('Run ./build.sh in the repo root, then refresh.');
});

window.addEventListener('keydown', (e) => {
  keys.add(e.code);
});

window.addEventListener('keyup', (e) => {
  keys.delete(e.code);
});

log('Airborne Submarine Squadron - Enhanced Web Interface Ready');
log('Click "Run WASM" to test the game logic.');