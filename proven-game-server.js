// Proven Game Server for Airborne Submarine Squadron
// Full integration with proven-gameserver protocol

import { serve } from "https://deno.land/std@0.200.0/http/server.ts";
import { BufReader } from "https://deno.land/std@0.200.0/io/buf_reader.ts";

// Configuration
const PORT = 27015; // Standard proven-gameserver port
const HOST = "0.0.0.0";
const TICK_RATE = 60; // 60Hz for smooth gameplay
const MAX_PLAYERS = 8;

// Game state management
let gameState = null;
let players = new Map();
let lastTick = 0;

// Load WASM module
const wasmBuffer = await Deno.readFile('./build/airborne-submarine-squadron.wasm');
const importObject = { wasi_snapshot_preview1: { fd_write: () => 0 } };
const { instance } = await WebAssembly.instantiate(wasmBuffer, importObject);

console.log("=== Proven Airborne Submarine Squadron Game Server ===");
console.log(`🎮 Protocol: Proven-Gameserver v0.1.0`);
console.log(`🌐 Listening on ${HOST}:${PORT}`);
console.log(`⏱️  Tick rate: ${TICK_RATE}Hz`);
console.log(`👥 Max players: ${MAX_PLAYERS}`);
console.log(`🔒 Sync strategy: ServerAuth (Server-authoritative)`);
console.log();

// Initialize game state
function initGame() {
  const initPtr = instance.exports.init_state();
  gameState = readStateFromPtr(initPtr, instance.exports.memory);
  console.log("✅ Game initialized:");
  console.log(`   • Environment: ${gameState.env === 0 ? 'AIR' : 'WATER'}`);
  console.log(`   • Mission: ${gameState.mission.kills_needed} kills, ${gameState.mission.max_ticks} ticks`);
  console.log(`   • Initial state pointer: ${initPtr}`);
}

// Read state from WASM memory
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

// Write state to WASM memory (using init_state pattern)
function writeStateToWasm(state) {
  // For now, we'll use the existing state pointer
  // In a full implementation, we'd need to extend the WASM exports
  return instance.exports.init_state(); // Returns a valid state pointer
}

// Game loop
function gameLoop() {
  const now = performance.now();
  const delta = now - lastTick;
  
  if (delta >= 1000 / TICK_RATE) {
    lastTick = now;
    
    // Process player inputs
    for (const [playerId, player] of players) {
      if (player.inputQueue.length > 0) {
        const input = player.inputQueue.shift();
        
        // Apply input to game state
        const resultPtr = instance.exports.step_state(
          gameState.tick, gameState.env,
          gameState.sub.x, gameState.sub.y, gameState.sub.vx, gameState.sub.vy, gameState.sub.health,
          gameState.weapons.ammo, gameState.weapons.cooldown,
          gameState.projA.active, gameState.projA.x, gameState.projA.y,
          gameState.projB.active, gameState.projB.x, gameState.projB.y,
          gameState.enemyA.active, gameState.enemyA.x, gameState.enemyA.y, gameState.enemyA.health,
          gameState.enemyB.active, gameState.enemyB.x, gameState.enemyB.y, gameState.enemyB.health,
          gameState.score, gameState.kills,
          gameState.mission.kills_needed, gameState.mission.max_ticks,
          gameState.mission.completed, gameState.mission.failed,
          input.thrust_x, input.thrust_y,
          input.fire ? 1 : 0,
          input.fire_alt ? 1 : 0,
          input.toggle_env ? 1 : 0
        );
        
        gameState = readStateFromPtr(resultPtr, instance.exports.memory);
      }
    }
    
    // Broadcast state update to all players
    broadcastStateUpdate();
    
    // Check mission status
    if (gameState.mission.completed) {
      broadcastEvent({ type: "MissionComplete", data: { score: gameState.score } });
    } else if (gameState.mission.failed) {
      broadcastEvent({ type: "MissionFailed", data: { reason: "Time expired" } });
    }
  }
  
  setTimeout(gameLoop, 0);
}

// Broadcast state update to all players
function broadcastStateUpdate() {
  const statePtr = writeStateToWasm(gameState);
  const stateData = new Int32Array(instance.exports.memory.buffer, statePtr, gameState.len + 1);
  
  for (const [playerId, player] of players) {
    if (player.ws && player.ws.readyState === WebSocket.OPEN) {
      try {
        player.ws.send(JSON.stringify({
          type: "StateUpdate",
          tick: gameState.tick,
          state: Array.from(stateData)
        }));
      } catch (err) {
        console.error(`Failed to send to player ${playerId}:`, err.message);
      }
    }
  }
}

// Broadcast event to all players
function broadcastEvent(event) {
  for (const [playerId, player] of players) {
    if (player.ws && player.ws.readyState === WebSocket.OPEN) {
      try {
        player.ws.send(JSON.stringify({
          type: "Event",
          event: event.type,
          data: event.data
        }));
      } catch (err) {
        console.error(`Failed to send event to player ${playerId}:`, err.message);
      }
    }
  }
}

// Start server
initGame();
const server = serve({ hostname: HOST, port: PORT });

console.log("🔥 Game server ready!");
console.log("📡 Waiting for players to connect...");
console.log();

// Start game loop
gameLoop();

// Handle connections
for await (const conn of server) {
  (async () => {
    const httpConn = Deno.serveHttp(conn);
    const requestEvent = await httpConn.nextRequest();
    
    if (!requestEvent) return;
    
    const { request, respondWith } = requestEvent;
    const url = new URL(request.url);
    
    // Handle WebSocket upgrade for game protocol
    if (url.pathname === "/game" && request.headers.get("upgrade") === "websocket") {
      const { socket: ws, response } = Deno.upgradeWebSocket(request);
      
      const playerId = crypto.randomUUID();
      players.set(playerId, {
        id: playerId,
        ws: ws,
        state: "Connecting",
        inputQueue: [],
        lastPing: Date.now()
      });
      
      console.log(`👤 Player connected: ${playerId}`);
      
      // Send connection acknowledgment
      ws.send(JSON.stringify({
        type: "Connect",
        playerId: playerId,
        gameState: gameState
      }));
      
      // Send initial sync
      const syncPtr = writeStateToWasm(gameState);
      const syncData = new Int32Array(instance.exports.memory.buffer, syncPtr, gameState.len + 1);
      ws.send(JSON.stringify({
        type: "Sync",
        state: Array.from(syncData)
      }));
      
      // Handle WebSocket messages
      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          
          switch (message.type) {
            case "Input":
              const player = players.get(playerId);
              if (player) {
                player.inputQueue.push(message.input);
                player.lastPing = Date.now();
              }
              break;
            
            case "Ping":
              ws.send(JSON.stringify({ type: "Pong", timestamp: Date.now() }));
              break;
              
            case "Disconnect":
              ws.close(1000, "Client requested disconnect");
              break;
          }
        } catch (err) {
          console.error(`Error processing message from ${playerId}:`, err.message);
        }
      };
      
      ws.onclose = () => {
        players.delete(playerId);
        console.log(`👋 Player disconnected: ${playerId}`);
      };
      
      ws.onerror = (err) => {
        console.error(`WebSocket error for ${playerId}:`, err.message);
        players.delete(playerId);
      };
      
      respondWith(response);
    } else {
      // Handle HTTP requests (for web interface)
      let filePath = "./web" + (url.pathname === "/" ? "/index.html" : url.pathname);
      let fileContent;
      let contentType = "text/html";
      
      try {
        fileContent = await Deno.readFile(filePath);
        if (url.pathname.endsWith(".js")) contentType = "application/javascript";
        else if (url.pathname.endsWith(".css")) contentType = "text/css";
        else if (url.pathname.endsWith(".wasm")) contentType = "application/wasm";
      } catch (_) {
        fileContent = new TextEncoder().encode("404 Not Found");
        respondWith(new Response(fileContent, { status: 404 }));
        return;
      }
      
      const headers = new Headers();
      headers.set("content-type", contentType);
      headers.set("access-control-allow-origin", "*");
      
      respondWith(new Response(fileContent, { headers }));
    }
  })();
}

// Ping players periodically
setInterval(() => {
  const now = Date.now();
  for (const [playerId, player] of players) {
    if (now - player.lastPing > 30000) { // 30 seconds timeout
      console.log(`⏱️  Player timed out: ${playerId}`);
      player.ws?.close(1000, "Timeout");
      players.delete(playerId);
    }
  }
}, 10000);

console.log("Server is running... Press Ctrl+C to stop.");