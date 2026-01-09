# CLAUDE.md

## Project Overview

**airborne-submarine-squadron** is an RSR-compliant 2D flying submarine game written in Ada 2022, inspired by Sopwith. Players control a submarine that can fly in air and dive underwater, with dynamic environment transitions, sound system, enemies, weapons, and HUD.

## RSR Compliance Status

- **Type Safety**: ✅ Ada 2022 compile-time guarantees
- **Memory Safety**: ✅ SPARK formal verification, zero unsafe operations
- **Offline-First**: ✅ No network dependencies, works air-gapped
- **Documentation**: ✅ Complete README, LICENSE, SECURITY, CONTRIBUTING, CODE_OF_CONDUCT
- **Well-Known**: ✅ security.txt, ai.txt, humans.txt (RFC 9116)
- **Build System**: ✅ justfile, Nix flake, GitLab CI/CD
- **Testing**: ✅ 100% test pass rate, RSR self-verification
- **TPCF Perimeter**: ✅ Community Sandbox (Perimeter 3)

## Repository Structure

```
airborne-submarine-squadron/
├── CLAUDE.md          # This file - AI assistant guide
├── README.md          # Project documentation
├── src/               # Source code
├── tests/             # Test files
├── docs/              # Additional documentation
└── scripts/           # Utility scripts
```

## Development Guidelines

### Code Style
- Follow consistent naming conventions
- Write clear, self-documenting code
- Include comments for complex logic
- Keep functions focused and modular

### Testing
- Write tests for new features
- Ensure all tests pass before committing
- Aim for meaningful test coverage

### Git Workflow
- Use descriptive commit messages
- Keep commits atomic and focused
- Branch naming: Use `feature/`, `bugfix/`, or `claude/` prefixes
- Always work on feature branches, not directly on main

## Architecture

### Key Components
- **Core Systems**:
  - `Game` (game.ads/adb): Main game loop, state management (Menu/Playing/Paused/Game_Over)
  - `Submarine` (submarine.ads/adb): Player entity with position, velocity, health
  - `Environment` (environment.ads/adb): Air/Water/Transition zones with physics modifiers
  - `Physics` (physics.ads/adb): Gravity, drag calculations
  - `Renderer` (renderer.ads/adb): Text-based HUD rendering
  - `Sound` (sound.ads/adb): Music crossfading and sound effects
  - `Enemies` (enemies.ads/adb): Enemy AI and spawning system
  - `Weapons` (weapons.ads/adb): Torpedoes, missiles, depth charges, machine gun
  - `Missions` (missions.ads/adb): Mission objectives and progression
  - `Powerups` (powerups.ads/adb): Collectible power-ups
  - `Collision` (collision.ads/adb): AABB collision detection

- **Interfaces**: All packages expose clean public APIs via Ada specifications (.ads files)

- **Data Models**:
  - `Coordinate`: Integer range 0 .. 10,000 (world position)
  - `Velocity`: Integer range -100 .. 100 (movement speed)
  - `Health_Points`: Natural range 0 .. 100 (entity health)
  - `Game_State`: Enumeration (Menu, Playing, Paused, Game_Over)
  - `Environment_Type`: Enumeration (Air, Water, Transition)

### Design Patterns
- **Component-based architecture**: Separate packages for each system (Submarine, Enemies, Weapons)
- **Bounded arrays**: Fixed-size arrays for enemies (50), projectiles (100), powerups (20)
- **SPARK contracts**: Preconditions and postconditions on all public APIs
- **Strong typing**: Range-constrained subtypes prevent invalid values at compile time
- **State machines**: Game states, enemy states, mission states

## How Claude Can Help

### Common Tasks
1. **Code Implementation**: Writing new features or fixing bugs
2. **Refactoring**: Improving code structure and maintainability
3. **Testing**: Creating and maintaining test suites
4. **Documentation**: Writing clear docs and comments
5. **Code Review**: Analyzing code for improvements

### Project-Specific Context
- This project is in early development stages
- Focus on building solid foundations
- Prioritize code quality and maintainability
- Consider both aerial and submarine operational contexts

## Important Files

### Configuration Files
- `submarine_squadron.gpr`: GNAT project file (build configuration)
- `Justfile`: Build automation (just command runner)
- `flake.nix`: Nix flake for reproducible builds
- `.gitlab-ci.yml`: GitLab CI/CD pipeline
- `.well-known/security.txt`: Security contact (RFC 9116)

### Core Modules
- `src/main.adb`: Application entry point
- `src/game.ads/adb`: Game loop and state management
- `src/submarine.ads/adb`: Player submarine entity
- `src/enemies.ads/adb`: Enemy system (50 concurrent enemies)
- `src/weapons.ads/adb`: Weapon and projectile system (100 projectiles)
- `src/missions.ads/adb`: Mission objectives (Patrol, Destroy, Rescue, Escort, Recon)
- `src/sound.ads/adb`: Audio system with crossfading
- `tests/test_submarine.adb`: Unit test suite

## Dependencies

- **Ada Standard Library**: `Ada.Text_IO` for terminal output
- **GNAT Compiler**: Ada 2022 with SPARK support
- **GPRbuild**: Project-aware build tool
- **No external dependencies**: Fully self-contained, offline-first

## Build and Run

```bash
# Build debug version
just build

# Build release version
just build-release

# Run the game
just run

# Build and run (development mode)
just dev

# Clean build artifacts
just clean
```

## Testing

```bash
# Run all tests
just test

# Run unit tests only
just test-unit

# Run SPARK verification
just verify

# Full SPARK proof
just verify-full

# Check code style
just style
```

## Deployment

- **Source build**: `gprbuild -P submarine_squadron.gpr -XMODE=release`
- **Nix build**: `nix build` (reproducible, creates `result/bin/main`)
- **Platforms**: Linux (primary), macOS, Windows (WSL2/native GNAT), BSDs
- **Binary release**: Single static executable with no runtime dependencies

## Contributing

### Before Starting Work
1. Understand the task requirements
2. Review related code and documentation
3. Plan the implementation approach
4. Consider edge cases and testing needs

### When Making Changes
1. Write clean, readable code
2. Add appropriate tests
3. Update documentation
4. Commit with clear messages
5. Push to feature branch

## Notes for AI Assistants

- **Always explore the codebase** before making changes to understand existing patterns
- **Ask for clarification** if requirements are ambiguous
- **Test your changes** to ensure they work as expected
- **Document your changes** in code comments and commit messages
- **Follow existing conventions** in the codebase
- **Consider security** implications of all code changes
- **Think about edge cases** and error handling

## Resources

- Project Repository: https://github.com/Hyperpolymath/airborne-submarine-squadron
- Architecture Documentation: `docs/ARCHITECTURE.md`
- API Documentation: `docs/API.md`
- Ada 2022 Reference Manual: https://www.adaic.org/resources/add_content/standards/22rm/html/RM-TTL.html
- SPARK User Guide: https://docs.adacore.com/spark2014-docs/html/ug/

---

*This file is kept up-to-date with the current architecture, patterns, and guidelines.*
