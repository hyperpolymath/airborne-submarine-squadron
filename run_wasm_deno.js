// Deno WASM runner for Airborne Submarine Squadron
const wasmFile = Deno.args[0] || './build/airborne-submarine-squadron.wasm';
const functionName = Deno.args[1] || 'main';

async function main() {
  try {
    // Read WASM file
    const wasmBuffer = await Deno.readFile(wasmFile);
    
    // Import object with minimal WASI support
    const importObject = {
      wasi_snapshot_preview1: {
        fd_write: () => 0,
      },
    };

    // Compile and instantiate WASM
    const { instance } = await WebAssembly.instantiate(wasmBuffer, importObject);
    
    // Call the requested function
    if (instance.exports[functionName]) {
      const returnValue = instance.exports[functionName]();
      console.log(`${functionName}() returned: ${returnValue}`);
      
      // If it's init_state, read the state
      if (functionName === 'init_state') {
        const memory = instance.exports.memory;
        const state = readStateFromPtr(returnValue, memory);
        console.log('Initial state:', JSON.stringify(state, null, 2));
      }
    } else {
      console.error(`Function ${functionName} not found in exports`);
      console.log('Available exports:', Object.keys(instance.exports));
    }
  } catch (err) {
    console.error('Error:', err.message);
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