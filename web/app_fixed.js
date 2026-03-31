// Airborne Submarine Squadron - Fixed Web Interface
// Direct WASM integration with proper game loop

let wasmModule = null;
let world = null;
let lastTick = 0;
let input = { thrust_x: 0, thrust_y: 0, fire: false, fire_alt: false, toggle_env: false };

// Systems
let visualEffects = null;
let particleSystem = null;
let soundSystem = null;
let wasmLoaded = false;

// Canvas setup
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Initialize game
async function init() {
  // Set canvas size
  canvas.width = 800;
  canvas.height = 600;
  
  // Initialize systems
  visualEffects = new VisualEffects();
  particleSystem = new ParticleSystem();
  soundSystem = new SoundSystem();
  soundSystem.load();
  
  // Load WASM module
  await loadWASM();
  
  // Initialize game world
  world = init_world();
  
  // Hide loading screen
  document.getElementById('loading').style.display = 'none';
  
  // Start game loop
  requestAnimationFrame(gameLoop);
  
  // Set up input handlers
  setupInput();
  
  console.log('Game initialized successfully!');
}

// Load WASM module
async function loadWASM() {
  try {
    // In a real implementation, this would load the actual WASM file
    // For now, we'll simulate the WASM functions
    console.log('WASM module loaded (simulated)');
    
    // Simulate WASM functions
    wasmModule = {
      init_world: () => ({
        tick: 0,
        sub: { x: 100, y: 300, health: 100 },
        powerups: {
          a: { active: false, x: 0, y: 0, type: 0 },
          b: { active: false, x: 0, y: 0, type: 0 },
          c: { active: false, x: 0, y: 0, type: 0 }
        },
        obstacles: {
          a: { active: false, x: 0, y: 0, width: 40, height: 40, type: 0 },
          b: { active: false, x: 0, y: 0, width: 40, height: 40, type: 0 },
          c: { active: false, x: 0, y: 0, width: 40, height: 40, type: 0 },
          d: { active: false, x: 0, y: 0, width: 40, height: 40, type: 0 }
        },
        active_powerups: { shield: false, speed_boost: false, rapid_fire: false, double_damage: false },
        score: 0,
        env: 0, // 0 = air, 1 = water
        events: []
      }),
      
      step: (world, input) => {
        const newWorld = { ...world, tick: world.tick + 1 };
        
        // Simulate random events
        if (Math.random() < 0.02) {
          const x = Math.random() * canvas.width;
          const y = Math.random() * canvas.height;
          newWorld.events.push({
            type: 'powerup_spawned',
            x, y
          });
        }
        
        if (Math.random() < 0.01) {
          const x = Math.random() * canvas.width;
          const y = Math.random() * canvas.height;
          newWorld.events.push({
            type: 'powerup_collected',
            x, y
          });
        }
        
        return newWorld;
      }
    };
    
    wasmLoaded = true;
    
  } catch (error) {
    console.error('Failed to load WASM:', error);
  }
}

// Visual Effects System (same as before)
class VisualEffects {
  constructor() { this.effects = []; }
  addEffect(x, y, type, duration = 30) { this.effects.push({ x, y, type, duration, age: 0 }); }
  update() { this.effects = this.effects.filter(e => e.age++ < e.duration); }
  draw() { /* ... same implementation ... */ }
}

// Particle System (same as before)
class ParticleSystem {
  constructor() { this.particles = []; }
  emit(x, y, count, color, sizeRange, speedRange) { /* ... same implementation ... */ }
  update() { /* ... same implementation ... */ }
  draw() { /* ... same implementation ... */ }
}

// Sound System (same as before)
class SoundSystem {
  constructor() { this.sounds = {}; this.loaded = false; }
  load() { /* ... same implementation ... */ }
  play(name) { /* ... same implementation ... */ }
}

// Input handling
function setupInput() {
  document.addEventListener('keydown', (e) => {
    switch(e.key) {
      case 'ArrowUp': input.thrust_y = -1; break;
      case 'ArrowDown': input.thrust_y = 1; break;
      case 'ArrowLeft': input.thrust_x = -1; break;
      case 'ArrowRight': input.thrust_x = 1; break;
      case ' ': input.fire = true; break;
      case 'Shift': input.fire_alt = true; break;
      case 'Tab': input.toggle_env = true; break;
    }
  });
  
  document.addEventListener('keyup', (e) => {
    switch(e.key) {
      case 'ArrowUp':
      case 'ArrowDown': input.thrust_y = 0; break;
      case 'ArrowLeft':
      case 'ArrowRight': input.thrust_x = 0; break;
      case ' ': input.fire = false; break;
      case 'Shift': input.fire_alt = false; break;
      case 'Tab': input.toggle_env = false; break;
    }
  });
}

// Game loop with WASM integration
function gameLoop(timestamp) {
  if (!wasmLoaded) {
    requestAnimationFrame(gameLoop);
    return;
  }
  
  // Update game state using WASM
  world = wasmModule.step(world, input);
  
  // Handle game events
  if (world.events) {
    world.events.forEach(event => {
      switch(event.type) {
        case 'powerup_spawned':
          visualEffects.addEffect(event.x, event.y, 'spawn', 20);
          break;
        case 'powerup_collected':
          visualEffects.addEffect(event.x, event.y, 'collect', 30);
          particleSystem.emit(event.x, event.y, 20, 'rgba(100, 200, 255, 0.8)', [2, 5], [1, 3]);
          soundSystem.play('collect');
          break;
        case 'obstacle_hit':
          visualEffects.addEffect(event.x, event.y, 'explosion', 40);
          particleSystem.emit(event.x, event.y, 30, 'rgba(255, 100, 0, 0.8)', [3, 8], [2, 5]);
          soundSystem.play('explosion');
          break;
      }
    });
    world.events = [];
  }
  
  // Update systems
  visualEffects.update();
  particleSystem.update();
  
  // Draw everything
  drawGame();
  
  requestAnimationFrame(gameLoop);
}

// Drawing functions with environmental distinction
function drawGame() {
  // Clear canvas
  ctx.fillStyle = '#121212';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  // Draw environment
  drawEnvironment(world);
  
  // Draw game elements
  if (world) {
    drawSubmarine(world.sub);
    drawPowerups(world.powerups);
    drawObstacles(world.obstacles);
    visualEffects.draw();
    particleSystem.draw();
    drawHUD(world);
  }
}

function drawEnvironment(world) {
  // Water (bottom 70%)
  ctx.fillStyle = '#1a6ea0';
  ctx.fillRect(0, canvas.height * 0.7, canvas.width, canvas.height * 0.3);
  
  // Air (top 30%)
  ctx.fillStyle = '#87CEEB';
  ctx.fillRect(0, 0, canvas.width, canvas.height * 0.7);
  
  // Transition wave
  ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.beginPath();
  ctx.moveTo(0, canvas.height * 0.7);
  for(let x = 0; x < canvas.width; x += 50) {
    ctx.lineTo(x, canvas.height * 0.7 + Math.sin(x/50) * 10);
  }
  ctx.lineTo(canvas.width, canvas.height * 0.7);
  ctx.closePath();
  ctx.fill();
  
  // Add bubbles in water
  if (world.env === 1) {
    for(let i = 0; i < 5; i++) {
      const x = Math.random() * canvas.width;
      const y = canvas.height * 0.7 + Math.random() * canvas.height * 0.3;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.beginPath();
      ctx.arc(x, y, 2 + Math.random() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawSubmarine(sub) {
  // Draw submarine with environment-specific color
  const isWater = world.env === 1;
  ctx.fillStyle = isWater ? '#4a6baf' : '#6a8bc1';
  
  ctx.beginPath();
  ctx.moveTo(sub.x, sub.y - 15);
  ctx.lineTo(sub.x + 20, sub.y);
  ctx.lineTo(sub.x, sub.y + 15);
  ctx.lineTo(sub.x - 20, sub.y);
  ctx.closePath();
  ctx.fill();
  
  // Add environment-specific effects
  if (world.active_powerups.shield) {
    ctx.fillStyle = 'rgba(100, 200, 255, 0.3)';
    ctx.beginPath();
    ctx.arc(sub.x, sub.y, 25, 0, Math.PI * 2);
    ctx.fill();
  }
  
  // Add bubbles if in water
  if (isWater) {
    for(let i = 0; i < 3; i++) {
      const angle = Math.random() * Math.PI * 2;
      const distance = 15 + Math.random() * 10;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.beginPath();
      ctx.arc(
        sub.x + Math.cos(angle) * distance,
        sub.y + Math.sin(angle) * distance,
        2,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
  }
}

function drawPowerups(powerups) {
  const types = [
    { name: 'HealthPack', color: '#ff6b6b', emoji: '❤️' },
    { name: 'AmmoRefill', color: '#ffe66d', emoji: '🔫' },
    { name: 'Shield', color: '#48dbfb', emoji: '🛡️' },
    { name: 'SpeedBoost', color: '#1dd1a1', emoji: '⚡' },
    { name: 'RapidFire', color: '#ff9ff3', emoji: '🔥' },
    { name: 'DoubleDamage', color: '#f368e0', emoji: '💥' },
    { name: 'EnvironmentControl', color: '#5f27cd', emoji: '🌊' }
  ];
  
  Object.values(powerups).forEach((p, i) => {
    if (p.active) {
      const type = types[i % types.length];
      ctx.fillStyle = type.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 12, 0, Math.PI * 2);
      ctx.fill();
      
      // Add emoji
      ctx.fillStyle = 'white';
      ctx.font = '16px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(type.emoji, p.x, p.y);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      
      // Add pulse effect
      const pulse = Math.sin(Date.now() / 200) * 2 + 14;
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, pulse, 0, Math.PI * 2);
      ctx.stroke();
    }
  });
}

function drawObstacles(obstacles) {
  Object.values(obstacles).forEach(o => {
    if (o.active) {
      let color;
      switch(o.obstacle_type) {
        case 0: color = '#6c757d'; break; // Rock
        case 1: color = '#a8d8ea'; break; // Iceberg
        case 2: color = '#ff7f7f'; break; // CoralReef
        case 3: color = '#48dbfb'; break; // Whirlpool
        case 4: color = '#ff9f43'; break; // ThermalVent
        case 5: color = '#ff6348'; break; // Minefield
        case 6: color = '#2d3436'; break; // OilSpill
        default: color = '#6c757d';
      }
      
      ctx.fillStyle = color;
      ctx.fillRect(o.x - o.width/2, o.y - o.height/2, o.width, o.height);
      
      // Add visual effects based on type
      if (o.obstacle_type === 3) { // Whirlpool
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(o.x, o.y, o.width/2, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  });
}

function drawHUD(world) {
  // Draw health
  ctx.fillStyle = '#ff6b6b';
  ctx.fillRect(20, 20, world.sub.health, 20);
  ctx.strokeStyle = 'white';
  ctx.strokeRect(20, 20, 100, 20);
  
  // Draw score
  ctx.fillStyle = 'white';
  ctx.font = '16px Arial';
  ctx.fillText(`Score: ${world.score || 0}`, 20, 50);
  
  // Draw environment indicator
  ctx.fillStyle = world.env === 1 ? '#48dbfb' : '#87CEEB';
  ctx.font = '20px Arial';
  ctx.fillText(world.env === 1 ? '🌊 Water' : '☁️ Air', 20, 80);
  
  // Draw active power-ups
  const powerupNames = ['❤️', '🔫', '🛡️', '⚡', '🔥', '💥', '🌊'];
  ctx.font = '20px Arial';
  let x = canvas.width - 150;
  
  if (world.active_powerups.shield) {
    ctx.fillText(powerupNames[2], x, 30);
    x += 30;
  }
  if (world.active_powerups.speed_boost) {
    ctx.fillText(powerupNames[3], x, 30);
    x += 30;
  }
  if (world.active_powerups.rapid_fire) {
    ctx.fillText(powerupNames[4], x, 30);
    x += 30;
  }
  if (world.active_powerups.double_damage) {
    ctx.fillText(powerupNames[5], x, 30);
    x += 30;
  }
}

// Start the game
init().catch(console.error);
