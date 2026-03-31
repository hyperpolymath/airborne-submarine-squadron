// Monitor game startup and early ticks
import { delay } from "https://deno.land/std@0.200.0/async/delay.ts";

async function main() {
  try {
    console.log("=== Airborne Submarine Squadron - Startup Monitor ===");
    console.log("Loading WASM module...");
    
    // Read WASM file
    const wasmBuffer = await Deno.readFile('./build/airborne-submarine-squadron.wasm');
    
    // Import object with minimal WASI support
    const importObject = {
      wasi_snapshot_preview1: {
        fd_write: () => 0,
      },
    };

    console.log("Compiling WASM...");
    const { instance } = await WebAssembly.instantiate(wasmBuffer, importObject);
    
    console.log("WASM module loaded successfully!");
    console.log("Available exports:", Object.keys(instance.exports).slice(0, 10).join(", ") + "...");
    
    // Initialize game state
    console.log("\n=== Initializing Game State ===");
    const initStart = performance.now();
    const initPtr = instance.exports.init_state();
    const initTime = performance.now() - initStart;
    
    console.log(`✓ init_state() returned pointer: ${initPtr}`);
    console.log(`✓ Initialization time: ${initTime.toFixed(2)}ms`);
    
    // Read initial state
    const memory = instance.exports.memory;
    const initialState = readStateFromPtr(initPtr, memory);
    
    console.log("\n=== Initial Game State ===");
    console.log(`Environment: ${initialState.env === 0 ? 'AIR' : 'WATER'}`);
    console.log(`Submarine position: (${initialState.sub.x}, ${initialState.sub.y})`);
    console.log(`Submarine health: ${initialState.sub.health}`);
    console.log(`Weapons: ammo=${initialState.weapons.ammo}, cooldown=${initialState.weapons.cooldown}`);
    console.log(`Mission: ${initialState.mission.kills_needed} kills needed, ${initialState.mission.max_ticks} ticks max`);
    
    // Run a few simulation steps
    console.log("\n=== Running Early Simulation Ticks ===");
    
    for (let i = 0; i < 5; i++) {
      console.log(`\nTick ${i + 1}:`);
      
      // Create sample input (alternating thrust pattern)
      const thrust_x = i % 2 === 0 ? 1 : -1;
      const thrust_y = i % 3 === 0 ? 1 : 0;
      const fire = i === 2 || i === 4;
      
      console.log(`  Input: thrust_x=${thrust_x}, thrust_y=${thrust_y}, fire=${fire}`);
      
      // Call step_state function
      const resultPtr = instance.exports.step_state(
        initialState.tick + i,      // tick
        initialState.env,           // env
        initialState.sub.x,         // sub_x
        initialState.sub.y,         // sub_y
        initialState.sub.vx,        // sub_vx
        initialState.sub.vy,        // sub_vy
        initialState.sub.health,    // sub_health
        initialState.weapons.ammo,  // ammo
        initialState.weapons.cooldown, // cooldown
        initialState.projA.active,   // proj_a_active
        initialState.projA.x,       // proj_a_x
        initialState.projA.y,       // proj_a_y
        initialState.projB.active,   // proj_b_active
        initialState.projB.x,       // proj_b_x
        initialState.projB.y,       // proj_b_y
        initialState.enemyA.active,  // enemy_a_active
        initialState.enemyA.x,      // enemy_a_x
        initialState.enemyA.y,      // enemy_a_y
        initialState.enemyA.health, // enemy_a_health
        initialState.enemyB.active,  // enemy_b_active
        initialState.enemyB.x,      // enemy_b_x
        initialState.enemyB.y,      // enemy_b_y
        initialState.enemyB.health, // enemy_b_health
        initialState.score,         // score
        initialState.kills,         // kills
        initialState.mission.kills_needed, // mission_kills
        initialState.mission.max_ticks,    // mission_ticks
        initialState.mission.completed,    // mission_complete
        initialState.mission.failed,       // mission_failed
        thrust_x,                    // thrust_x
        thrust_y,                    // thrust_y
        fire ? 1 : 0,                // fire
        0,                           // fire_alt
        0                            // toggle_env
      );
      
      // Read the new state
      const newState = readStateFromPtr(resultPtr, memory);
      console.log(`  Submarine: (${newState.sub.x}, ${newState.sub.y}) vel(${newState.sub.vx}, ${newState.sub.vy}) health=${newState.sub.health}`);
      console.log(`  Score: ${newState.score}, Kills: ${newState.kills}`);
      console.log(`  Mission: ${newState.mission.completed ? 'COMPLETE' : newState.mission.failed ? 'FAILED' : 'ACTIVE'}`);
      
      // Update state for next iteration
      Object.assign(initialState, newState);
      
      await delay(100); // Small delay for readability
    }
    
    console.log("\n=== Startup Monitoring Complete ===");
    console.log("Game is ready for full mission execution!");
    
  } catch (err) {
    console.error('Error:', err.message);
    console.error(err.stack);
    Deno.exit(1);
  }
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

if (import.meta.main) {
  main();
}