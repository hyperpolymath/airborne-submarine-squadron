# Airborne Submarine Squadron

A WASM-based game built with AffineScript featuring power-ups and obstacles.

## 📁 Directory Structure

```
airborne-game/
├── wasm/                  # Compiled WASM files
│   └── airborne-final-working.wasm  # Main game WASM
├── src/                   # Source code
│   └── main_final_working.as  # AffineScript source
├── web/                   # Web interface
│   ├── app.js             # Basic web interface
│   ├── app_enhanced.js    # Enhanced web interface
│   ├── index.html         # HTML launcher
│   └── style.css          # CSS styling
├── docs/                  # Documentation
│   ├── GAMEPLAY.md        # Gameplay guide
│   ├── DEVELOPMENT.md      # Development notes
│   └── COMPILATION.md     # Compilation instructions
├── notes/                 # Development notes
│   ├── powerups.txt        # Power-up system notes
│   ├── obstacles.txt       # Obstacle system notes
│   └── todo.txt            # Future enhancements
└── README.md              # This file
```

## 🚀 Quick Start

### 1. Run the game locally
```bash
cd ~/airborne-game
python3 -m http.server 8000
```
Then open: `http://localhost:8000` in your browser

### 2. Or run with WASM runtime
```bash
wasmtime run ~/airborne-game/wasm/airborne-final-working.wasm
```

## 🎮 Game Features

### Power-ups (7 types)
- **HealthPack**: Restores health
- **AmmoRefill**: Replenishes ammunition
- **Shield**: Temporary protection
- **SpeedBoost**: Increased speed
- **RapidFire**: Faster shooting
- **DoubleDamage**: Enhanced weapons
- **EnvironmentControl**: Toggle air/water

### Obstacles (7 types)
- **Rock**: Solid obstacle
- **Iceberg**: Destructible obstacle
- **CoralReef**: Slows movement
- **Whirlpool**: Pulls submarine
- **ThermalVent**: Pushes submarine
- **Minefield**: Explosive hazard
- **OilSpill**: Reduces visibility

## 🔧 Development

### Compilation
```bash
# Requires AffineScript compiler
dune exec affinescript -- compile src/main_final_working.as -o wasm/airborne-final-working.wasm
```

### Source Structure
- **Type Definitions**: Lines 1-100
- **Initialization**: Lines 101-200
- **Utility Functions**: Lines 201-300
- **Game Logic**: Lines 301-500

## 📋 Game Controls

- **Arrow Keys**: Move submarine
- **Space**: Fire primary weapon
- **Shift**: Fire secondary weapon
- **Tab**: Toggle environment
- **Esc**: Pause game

## 🔗 Dependencies

- AffineScript compiler (for development)
- Modern web browser (for playing)
- WASM runtime (optional for CLI)

## 📝 Notes

- Game state is deterministic
- All systems use proper type safety
- Web interface uses canvas rendering
- Save games can be added via localStorage

## 🎯 Future Enhancements

- Multiplayer support
- More power-up types
- Dynamic obstacle generation
- Mission system
- High score tracking

---

**Version**: 1.0.0
**Last Updated**: 2024
**License**: Open Source
