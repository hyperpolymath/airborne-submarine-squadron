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
  };
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
  };
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
  } catch (err) {
    scoreEl.textContent = '—';
    elapsedEl.textContent = '—';
    log(err.message || String(err));
  }
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function initWorld() {
  return {
    tick: 0,
    env: 0,
    sub: { x: 400, y: 200, vx: 0, vy: 0, health: 100 },
    weapons: { torpedoes: 4, missiles: 6, depth_charges: 3, ammo: 200, cooldown: 0 },
    proj: {
      a: { x: 0, y: 0, vx: 0, vy: 0, active: false },
      b: { x: 0, y: 0, vx: 0, vy: 0, active: false },
    },
    enemies: {
      a: { x: 0, y: 0, health: 0, active: false },
      b: { x: 0, y: 0, health: 0, active: false },
    },
    score: 0,
    kills: 0,
    mission: { id: 1, objective: { kills_needed: 4, max_ticks: 360, completed: false, failed: false } },
  };
}

function applyGravity(env, vy) {
  return env === 0 ? vy + 1 : vy - 1;
}

function clampVelocity(v) {
  return clamp(v, -100, 100);
}

function applyInput(sub, input) {
  const vx2 = clampVelocity(sub.vx + input.thrust_x);
  const vy2 = clampVelocity(sub.vy + input.thrust_y);
  return { ...sub, vx: vx2, vy: vy2 };
}

function integrate(sub, env) {
  const vy2 = clampVelocity(applyGravity(env, sub.vy));
  const vx2 = clampVelocity(sub.vx);
  return { ...sub, x: sub.x + vx2, y: sub.y + vy2, vx: vx2, vy: vy2 };
}

function applyBounds(sub) {
  return {
    ...sub,
    x: clamp(sub.x, 0, WORLD.width),
    y: clamp(sub.y, 0, WORLD.ground),
  };
}

function toggleEnv(env, tick, requested) {
  if (requested) {
    return env === 0 ? 1 : 0;
  }
  if (tick % 120 === 0) {
    return env === 0 ? 1 : 0;
  }
  return env;
}

function spawnEnemy(enemy, tick, modv, x, y) {
  if (enemy.active) return enemy;
  if (tick % modv === 1) {
    return { x, y, health: 50, active: true };
  }
  return enemy;
}

function enemyDrift(tick) {
  const period = 90;
  return (tick % period) < (period / 2) ? 1 : -1;
}

function stepEnemy(enemy, env, tick) {
  if (!enemy.active) return enemy;
  const speed = env === 0 ? 2 : 1;
  const drift = enemyDrift(tick);
  const nx = enemy.x - speed;
  const ny = clamp(enemy.y + drift, 40, WORLD.ground - 20);
  if (nx < -20) {
    return { ...enemy, x: nx, y: ny, active: false };
  }
  return { ...enemy, x: nx, y: ny };
}

function stepProjectile(proj) {
  if (!proj.active) return proj;
  const nx = proj.x + proj.vx;
  const ny = proj.y + proj.vy;
  if (nx < -20 || nx > WORLD.width + 20 || ny < -20 || ny > WORLD.ground + 40) {
    return { ...proj, x: nx, y: ny, active: false };
  }
  return { ...proj, x: nx, y: ny };
}

function weaponsCooldown(weapons) {
  if (weapons.cooldown > 0) {
    return { ...weapons, cooldown: weapons.cooldown - 1 };
  }
  return weapons;
}

function tryFire(sub, weapons, proj, want) {
  if (want && weapons.cooldown === 0 && weapons.ammo > 0 && !proj.active) {
    return {
      weapons: { ...weapons, ammo: weapons.ammo - 1, cooldown: 8 },
      proj: { x: sub.x + 10, y: sub.y, vx: 7, vy: 0, active: true },
    };
  }
  return { weapons, proj };
}

function abs(v) {
  return v < 0 ? -v : v;
}

function checkCollision(enemy, proj) {
  if (enemy.active && proj.active) {
    const dx = abs(enemy.x - proj.x);
    const dy = abs(enemy.y - proj.y);
    if (dx < 6 && dy < 6) {
      const newHealth = enemy.health - 25;
      const nextProj = { ...proj, active: false };
      if (newHealth <= 0) {
        return { enemy: { ...enemy, health: 0, active: false }, proj: nextProj, killed: true };
      }
      return { enemy: { ...enemy, health: newHealth, active: true }, proj: nextProj, killed: false };
    }
  }
  return { enemy, proj, killed: false };
}

function updateObjective(obj, kills, tick) {
  if (obj.completed || obj.failed) return obj;
  if (kills >= obj.kills_needed) return { ...obj, completed: true };
  if (tick > obj.max_ticks) return { ...obj, failed: true };
  return obj;
}

function inputFromKeys() {
  const thrust_x = (keys.has('ArrowRight') ? 2 : 0) + (keys.has('ArrowLeft') ? -2 : 0);
  const thrust_y = (keys.has('ArrowDown') ? 2 : 0) + (keys.has('ArrowUp') ? -2 : 0);
  return {
    thrust_x,
    thrust_y,
    fire: keys.has('Space'),
    fire_alt: keys.has('ShiftLeft') || keys.has('ShiftRight'),
    toggle_env: keys.has('KeyE'),
  };
}

function stepWorld(world, input) {
  const t = world.tick + 1;
  const env2 = toggleEnv(world.env, t, input.toggle_env);
  const sub1 = applyInput(world.sub, input);
  const sub2 = applyBounds(integrate(sub1, env2));
  const weapons2 = weaponsCooldown(world.weapons);

  const firedA = tryFire(sub2, weapons2, world.proj.a, input.fire);
  const firedB = tryFire(sub2, firedA.weapons, world.proj.b, input.fire_alt);

  const projA2 = stepProjectile(firedA.proj);
  const projB2 = stepProjectile(firedB.proj);

  const enemyA1 = spawnEnemy(world.enemies.a, t, 140, 760, 220);
  const enemyB1 = spawnEnemy(world.enemies.b, t, 190, 740, 280);

  const enemyA2 = stepEnemy(enemyA1, env2, t);
  const enemyB2 = stepEnemy(enemyB1, env2, t);

  const colA1 = checkCollision(enemyA2, projA2);
  const colA2 = checkCollision(colA1.enemy, projB2);

  const colB1 = checkCollision(enemyB2, colA1.proj);
  const colB2 = checkCollision(colB1.enemy, colA2.proj);

  const killsGain = (colA1.killed ? 1 : 0) + (colA2.killed ? 1 : 0) + (colB1.killed ? 1 : 0) + (colB2.killed ? 1 : 0);
  const scoreGain = killsGain * 100;
  const newKills = world.kills + killsGain;
  const newObj = updateObjective(world.mission.objective, newKills, t);

  return {
    tick: t,
    env: env2,
    sub: sub2,
    weapons: firedB.weapons,
    proj: { a: colB1.proj, b: colB2.proj },
    enemies: { a: colA2.enemy, b: colB2.enemy },
    score: world.score + scoreGain,
    kills: newKills,
    mission: { id: world.mission.id, objective: newObj },
  };
}

function drawWorld(world) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const sx = canvas.width / WORLD.width;
  const sy = canvas.height / WORLD.height;

  // ground line
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.beginPath();
  ctx.moveTo(0, WORLD.ground * sy);
  ctx.lineTo(canvas.width, WORLD.ground * sy);
  ctx.stroke();

  // submarine
  ctx.fillStyle = '#f4d35e';
  ctx.fillRect(world.sub.x * sx - 10, world.sub.y * sy - 6, 24, 12);

  // projectiles
  ctx.fillStyle = '#ff6f59';
  if (world.proj.a.active) {
    ctx.fillRect(world.proj.a.x * sx - 2, world.proj.a.y * sy - 2, 4, 4);
  }
  if (world.proj.b.active) {
    ctx.fillRect(world.proj.b.x * sx - 2, world.proj.b.y * sy - 2, 4, 4);
  }

  // enemies
  ctx.fillStyle = '#5dd39e';
  if (world.enemies.a.active) {
    ctx.beginPath();
    ctx.arc(world.enemies.a.x * sx, world.enemies.a.y * sy, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  if (world.enemies.b.active) {
    ctx.beginPath();
    ctx.arc(world.enemies.b.x * sx, world.enemies.b.y * sy, 6, 0, Math.PI * 2);
    ctx.fill();
  }

  // HUD text
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.font = '12px "IBM Plex Mono", monospace';
  ctx.fillText(`Tick: ${world.tick}`, 10, 16);
  ctx.fillText(`Score: ${world.score}`, 10, 32);
  ctx.fillText(`Kills: ${world.kills}`, 10, 48);
  ctx.fillText(`Mission: ${world.mission.objective.completed ? 'COMPLETE' : world.mission.objective.failed ? 'FAILED' : 'ACTIVE'}`, 10, 64);
  ctx.fillText(`ENV: ${world.env === 0 ? 'AIR' : 'WATER'}`, 10, 80);
}

let world = initWorld();

function animate(ts) {
  if (!simRunning) return;
  const dt = ts - lastFrame;
  if (dt > 16) {
    world = stepWorld(world, inputFromKeys());
    drawWorld(world);
    scoreEl.textContent = String(world.score);
    elapsedEl.textContent = `${world.tick} ticks`;
    lastFrame = ts;
  }
  animationId = requestAnimationFrame(animate);
}

function startSim() {
  if (simRunning) return;
  simRunning = true;
  world = initWorld();
  log('Visual sim running (JS).');
  lastFrame = performance.now();
  animationId = requestAnimationFrame(animate);
}

function stopSim() {
  simRunning = false;
  if (animationId) cancelAnimationFrame(animationId);
}

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
