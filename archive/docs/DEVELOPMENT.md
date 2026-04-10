# Development Guide

## Project Structure

```
src/
├── main_final_working.affine  # Main game source
└── types/                # Type definitions

wasm/
└── airborne-final-working.wasm  # Compiled output

web/
├── app.js                # Basic web interface
├── app_enhanced.js       # Enhanced web interface
├── index.html            # HTML launcher
└── style.css             # CSS styling
```

## Compilation

### Requirements
- OCaml 4.14+
- Dune build system
- AffineScript compiler

### Build Steps
```bash
# Clone the repository
git clone https://github.com/your-repo/affinescript.git
cd affinescript

# Build the compiler
dune build

# Compile the game
./_build/default/bin/affinescript compile src/main_final_working.affine -o wasm/airborne-final-working.wasm
```

## Code Structure

### Type Definitions
```affinescript
enum PowerUpType {
  HealthPack,
  AmmoRefill,
  Shield,
  SpeedBoost,
  RapidFire,
  DoubleDamage,
  EnvironmentControl
}
```

### World State
```affinescript
type World = {
  tick: Int,
  env: Environment,
  sub: Submarine,
  weapons: Weapons,
  powerups: PowerUps,
  obstacles: Obstacles,
  active_effects: ActiveEffects
}
```

### Game Loop
```affinescript
fn step(world: World, input: Input) -> World {
  // 1. Spawn power-ups and obstacles
  let world = maybe_spawn_powerup(world);
  let world = maybe_spawn_obstacle(world);
  
  // 2. Apply input
  let world = apply_input(world, input);
  
  // 3. Check collisions
  let world = check_collisions(world);
  
  // 4. Apply effects
  let world = apply_effects(world);
  
  // 5. Update timers
  let world = update_timers(world);
  
  // 6. Increment tick
  return { ...world, tick: world.tick + 1 };
}
```

## Web Integration

### HTML Structure
```html
<canvas id="gameCanvas" width="800" height="600"></canvas>
<script src="app_enhanced.js"></script>
```

### JavaScript Interface
```javascript
// Initialize WASM
const wasm = await WebAssembly.instantiateStreaming(
  fetch('wasm/airborne-final-working.wasm')
);

// Set up canvas
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Game loop
function gameLoop() {
  // Render frame
  requestAnimationFrame(gameLoop);
}
```

## Testing

### Unit Tests
```bash
# Run type checker
dune exec affinescript -- check src/main_final_working.affine

# Run comprehensive tests
dune runtest
```

### Browser Testing
1. Start local server: `python3 -m http.server 8000`
2. Open: `http://localhost:8000`
3. Check console for errors

## Debugging

### Common Issues
- **Parse errors**: Check semicolon placement
- **Type errors**: Verify type annotations
- **Runtime errors**: Check WASM limits

### Debug Tools
```bash
# Lexer debug
dune exec affinescript -- lex src/main_final_working.affine

# Parser debug  
dune exec affinescript -- parse src/main_final_working.affine

# AST viewer
dune exec affinescript -- ast src/main_final_working.affine
```

## Deployment

### Web Server
```bash
# Install nginx
sudo dnf install nginx

# Configure site
sudo cp airborne-game /var/www/html/

# Start server
sudo systemctl start nginx
```

### Desktop App
```bash
# Package with Electron
npm init electron-app@latest airborne-desktop
cd airborne-desktop
cp ../airborne-game/web/* ./
cp ../airborne-game/wasm/* ./

# Build
npm run make
```

## Performance

### Optimization Tips
- Minimize struct copying
- Use integers instead of floats
- Cache repeated calculations
- Limit spawn rates

### Profiling
```bash
# WASM profiling
wasm-opt -O3 airborne-final-working.wasm -o optimized.wasm

# Browser profiling
Chrome DevTools > Performance tab
```

## Contributing

### Guidelines
- Follow existing code style
- Add type annotations
- Write documentation
- Test thoroughly

### Pull Requests
1. Fork the repository
2. Create feature branch
3. Commit changes
4. Open PR with description
