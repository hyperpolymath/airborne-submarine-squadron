// Run full mission with detailed monitoring
async function main() {
  try {
    console.log("=== Airborne Submarine Squadron - Full Mission ===");
    console.log("🚀 Starting mission execution...\n");
    
    // Load WASM
    const wasmBuffer = await Deno.readFile('./build/airborne-submarine-squadron.wasm');
    const importObject = { wasi_snapshot_preview1: { fd_write: () => 0 } };
    const { instance } = await WebAssembly.instantiate(wasmBuffer, importObject);
    
    console.log("✓ WASM module loaded");
    
    // Initialize game
    const memory = instance.exports.memory;
    const initPtr = instance.exports.init_state();
    const initialState = readStateFromPtr(initPtr, memory);
    
    console.log("📋 Initial Mission Parameters:");
    console.log(`   • Environment: ${initialState.env === 0 ? 'AIR' : 'WATER'}`);
    console.log(`   • Submarine: (${initialState.sub.x}, ${initialState.sub.y}) health=${initialState.sub.health}`);
    console.log(`   • Mission: ${initialState.mission.kills_needed} kills needed, ${initialState.mission.max_ticks} ticks max`);
    console.log(`   • Starting score: ${initialState.score}\n`);
    
    // Run mission
    console.log("🎮 Running mission simulation...");
    const missionStart = performance.now();
    const finalPtr = instance.exports.main();
    const missionTime = performance.now() - missionStart;
    
    const finalState = readStateFromPtr(finalPtr, memory);
    
    console.log("🏁 Mission Complete!");
    console.log(`   • Execution time: ${missionTime.toFixed(2)}ms`);
    console.log(`   • Final tick: ${finalState.tick}`);
    console.log(`   • Final score: ${finalState.score}`);
    console.log(`   • Total kills: ${finalState.kills}`);
    console.log(`   • Submarine health: ${finalState.sub.health}`);
    console.log(`   • Mission status: ${finalState.mission.completed ? '🎉 COMPLETED' : finalState.mission.failed ? '❌ FAILED' : '⏳ ACTIVE'}`);
    
    if (finalState.mission.completed) {
      console.log("\n🏆 VICTORY! Mission objectives achieved!");
    } else if (finalState.mission.failed) {
      console.log("\n💥 MISSION FAILED! Try again.");
    } else {
      console.log("\n⏸️  Mission still in progress.");
    }
    
    console.log(`\n📊 Final Statistics:`);
    console.log(`   • Environment: ${finalState.env === 0 ? 'AIR' : 'WATER'}`);
    console.log(`   • Submarine position: (${finalState.sub.x}, ${finalState.sub.y})`);
    console.log(`   • Submarine velocity: (${finalState.sub.vx}, ${finalState.sub.vy})`);
    console.log(`   • Weapons: ammo=${finalState.weapons.ammo}, cooldown=${finalState.weapons.cooldown}`);
    console.log(`   • Projectile A: ${finalState.projA.active ? 'ACTIVE' : 'INACTIVE'} at (${finalState.projA.x}, ${finalState.projA.y})`);
    console.log(`   • Projectile B: ${finalState.projB.active ? 'ACTIVE' : 'INACTIVE'} at (${finalState.projB.x}, ${finalState.projB.y})`);
    console.log(`   • Enemy A: ${finalState.enemyA.active ? 'ACTIVE' : 'INACTIVE'} health=${finalState.enemyA.health}`);
    console.log(`   • Enemy B: ${finalState.enemyB.active ? 'ACTIVE' : 'INACTIVE'} health=${finalState.enemyB.health}`);
    
    console.log("\n🎉 Mission execution complete!");
    
  } catch (err) {
    console.error('❌ Mission failed:', err.message);
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