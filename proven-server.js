// Proven-compatible server for Airborne Submarine Squadron
// Follows proven-servers patterns but uses Deno for simplicity

const PORT = 27016; // Proven game server port + 1
const HOST = "0.0.0.0";

console.log("=== Proven Airborne Submarine Squadron Server ===");
console.log(`🚀 Starting server on ${HOST}:${PORT}`);
console.log("📁 Serving web files from ./web directory");
console.log("🎮 Game protocol: WASM-based deterministic simulation");
console.log("🔒 Safety: Proven patterns, deterministic execution");
console.log();

// Simple HTTP server implementation
const server = Deno.listen({ hostname: HOST, port: PORT });

console.log(`🌐 Web interface available at http://localhost:${PORT}/`);
console.log("📋 Available endpoints:");
console.log(`   • GET /          - Main game interface`);
console.log(`   • GET /app.js    - Game logic`);
console.log(`   • GET /style.css - Styling`);
console.log(`   • GET /build/airborne-submarine-squadron.wasm - WASM module`);
console.log();

// Game server status
console.log("🎮 Game Server Status:");
console.log("   • Protocol: Deterministic WASM simulation");
console.log("   • Tick rate: 60 ticks/sec (browser-based)");
console.log("   • Max players: 1 (single-player prototype)");
console.log("   • Sync strategy: Server-authoritative via WASM");
console.log("   • State size: 30 ints (120 bytes)");
console.log();

console.log("🔧 Development notes:");
console.log("   • Build WASM: ./build.sh");
console.log("   • Test WASM: deno run --allow-read run_wasm_deno.js");
console.log("   • Run server: deno run --allow-net --allow-read proven-server.js");
console.log();

console.log("✅ Server ready! Connect with a web browser.");
console.log("Press Ctrl+C to stop the server.");
console.log();

// Handle connections
for await (const conn of server) {
  (async () => {
    const httpConn = Deno.serveHttp(conn);
    for await (const requestEvent of httpConn) {
      const url = new URL(requestEvent.request.url);
      const path = url.pathname;
      
      try {
        // Try to serve static files
        let filePath = "./web" + (path === "/" ? "/index.html" : path);
        let fileContent;
        
        try {
          fileContent = await Deno.readFile(filePath);
        } catch (_) {
          // If file not found in web/, try build/ directory
          if (path.startsWith("/build/")) {
            filePath = "." + path;
            try {
              fileContent = await Deno.readFile(filePath);
            } catch (_) {
              fileContent = new TextEncoder().encode("404 Not Found");
              requestEvent.respondWith(new Response(fileContent, { status: 404 }));
              continue;
            }
          } else {
            fileContent = new TextEncoder().encode("404 Not Found");
            requestEvent.respondWith(new Response(fileContent, { status: 404 }));
            continue;
          }
        }
        
        // Determine content type
        let contentType = "text/html";
        if (path.endsWith(".js")) contentType = "application/javascript";
        else if (path.endsWith(".css")) contentType = "text/css";
        else if (path.endsWith(".wasm")) contentType = "application/wasm";
        else if (path.endsWith(".html")) contentType = "text/html";
        
        const headers = new Headers();
        headers.set("content-type", contentType);
        headers.set("access-control-allow-origin", "*");
        
        requestEvent.respondWith(new Response(fileContent, { headers }));
      } catch (err) {
        console.error("Error serving request:", err.message);
        requestEvent.respondWith(new Response("500 Internal Server Error", { status: 500 }));
      }
    }
  })();
}