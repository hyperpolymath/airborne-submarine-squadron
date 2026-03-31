# Enhanced Game Features for Airborne Submarine Squadron

## Current Feature Analysis

### Existing Features (✅ Working)
- [x] Basic submarine physics (velocity, position)
- [x] Environment switching (air/water)
- [x] Gravity and drag physics
- [x] Simple weapon system (ammo, cooldown)
- [x] Basic enemy spawning
- [x] Collision detection
- [x] Mission objectives (kills, time limit)
- [x] Score tracking
- [x] Deterministic simulation
- [x] WASM export

### Features Needing Enhancement (🔧 TODO)
- [ ] Advanced enemy AI patterns
- [ ] Multiple weapon types with different behaviors
- [ ] Power-ups and collectibles
- [ ] Obstacles and terrain
- [ ] Advanced mission system
- [ ] Visual effects
- [ ] Sound effects
- [ ] Save/load game state
- [ ] Difficulty levels
- [ ] Achievements system

## Step 2: Feature Enhancement Plan

### 1. Advanced Enemy AI

**Current**: Basic left-to-right movement with slight vertical drift

**Enhanced**:
```affinescript
// Enemy behavior types
type EnemyBehavior
  = Patrol        // Move back and forth in pattern
  | Chase         // Follow player
  | Ambush        // Hide and attack when player near
  | Kamikaze      // Charge directly at player
  | Boss          // Special boss behavior

// Enemy AI patterns
type AIPattern
  = SineWave      // Smooth sine wave movement
  | ZigZag        // Sharp zig-zag pattern
  | Circle        // Circular pattern
  | Spiral        // Spiral pattern
  | RandomWalk    // Unpredictable movement

// Enhanced enemy type
type Enemy = {
  x: Int, y: Int, 
  vx: Int, vy: Int,
  health: Int, 
  active: Bool,
  behavior: EnemyBehavior,
  ai_pattern: AIPattern,
  pattern_phase: Int,
  aggression: Int,  // 0-100
  score_value: Int
}
```

### 2. Enhanced Weapons System

**Current**: Single projectile type with basic cooldown

**Enhanced**:
```affinescript
type WeaponType
  = Torpedo      // Slow, high damage, water only
  | Missile      // Fast, tracking, air only
  | DepthCharge  // Area effect, water only
  | Mine         // Stationary, explodes on contact
  | Laser        // Instant hit, limited range
  | Railgun      // High damage, pierces enemies

type Weapon = {
  weapon_type: WeaponType,
  count: Int,           // Number remaining
  cooldown: Int,        // Current cooldown
  max_cooldown: Int,   // Max cooldown ticks
  damage: Int,          // Damage per hit
  speed: Int,          // Projectile speed
  range: Int,          // Maximum range
  tracking: Bool,      // Can track enemies
  piercing: Bool,      // Pierces multiple enemies
  explosion_radius: Int // Area effect radius
}

// Weapon behaviors
fn fire_torpedo(world: World, input: Input) -> World
fn fire_missile(world: World, input: Input) -> World  
fn drop_depth_charge(world: World, input: Input) -> World
fn place_mine(world: World, input: Input) -> World
fn fire_laser(world: World, input: Input) -> World
fn fire_railgun(world: World, input: Input) -> World
```

### 3. Power-ups System

```affinescript
type PowerUpType
  = HealthPack      // Restore health
  | AmmoRefill      // Refill ammunition
  | Shield          // Temporary shield
  | SpeedBoost      // Increased speed
  | RapidFire       // Faster firing
  | DoubleDamage    // Increased damage
  | Invulnerability // Temporary invulnerability
  | EnvironmentControl // Manual env switching

type PowerUp = {
  x: Int, y: Int,
  powerup_type: PowerUpType,
  active: Bool,
  duration: Int,      // How long it lasts
  spawn_tick: Int     // When it was spawned
}

fn spawn_powerup(world: World, tick: Int) -> World
fn collect_powerup(world: World, powerup: PowerUp) -> World
fn apply_powerup_effect(world: World, powerup: PowerUpType) -> World
```

### 4. Obstacles and Terrain

```affinescript
type ObstacleType
  = Rock           // Indestructible rock
  | Iceberg        // Can be destroyed
  | CoralReef      // Slows movement
  | Whirlpool      // Pulls submarine in
  | Minefield      // Hidden mines
  | ThermalVent    // Pushes submarine up
  | OilSpill       // Reduces visibility

type Obstacle = {
  x: Int, y: Int,
  width: Int, height: Int,
  obstacle_type: ObstacleType,
  health: Int,     // For destructible obstacles
  effect_strength: Int
}

fn check_obstacle_collision(world: World, obstacle: Obstacle) -> World
fn apply_obstacle_effect(world: World, obstacle: Obstacle) -> World
```

### 5. Enhanced Mission System

```affinescript
type MissionObjective
  = KillEnemies(count: Int)              // Kill X enemies
  | SurviveTime(ticks: Int)              // Survive for X ticks
  | CollectItems(count: Int, item_type: PowerUpType) // Collect X items
  | DestroyObstacles(count: Int)         // Destroy X obstacles
  | ReachLocation(x: Int, y: Int)        // Reach specific location
  | EscortTarget(x: Int, y: Int)        // Escort to location
  | BossBattle(boss_health: Int)        // Defeat boss
  | ScoreTarget(score: Int)             // Reach score target
  | NoDamageFor(ticks: Int)            // Survive without damage
  | UseEnvironmentSwitches(count: Int)  // Switch environments X times

type Mission = {
  id: Int,
  name: String,
  description: String,
  objectives: List MissionObjective,
  current_objective: Int,
  difficulty: Int,           // 1-10
  reward: Int,               // Score bonus
  time_limit: Int,           // Total time limit
  environment_restrictions: List Environment // Allowed environments
}

fn check_mission_progress(world: World) -> World
fn mission_completed(world: World) -> Bool
fn mission_failed(world: World) -> Bool
```

### 6. Visual Effects System

```affinescript
type VisualEffectType
  = Explosion
  | SmokeTrail
  | BubbleTrail
  | Splash
  | Lightning
  | Shockwave
  | Fire
  | Steam

type VisualEffect = {
  x: Int, y: Int,
  effect_type: VisualEffectType,
  age: Int,              // Current age
  lifetime: Int,         // Total lifetime
  size: Int,            // Size of effect
  intensity: Int        // Brightness/intensity
}

fn create_explosion(world: World, x: Int, y: Int) -> World
fn create_splash(world: World, x: Int, y: Int) -> World
fn update_visual_effects(world: World) -> World
```

### 7. Difficulty System

```affinescript
type DifficultySetting = Easy | Normal | Hard | Expert | Custom
type DifficultyParams = {
  enemy_health_multiplier: Float,
  enemy_damage_multiplier: Float,
  enemy_spawn_rate: Float,
  player_damage_multiplier: Float,
  weapon_cooldown_multiplier: Float,
  mission_time_multiplier: Float,
  powerup_spawn_rate: Float,
  obstacle_density: Float
}

fn set_difficulty(world: World, difficulty: DifficultySetting) -> World
fn adjust_difficulty_params(params: DifficultyParams, difficulty: DifficultySetting) -> DifficultyParams
fn dynamic_difficulty_adjustment(world: World) -> World
```

## Implementation Priority

1. **Enemy AI Enhancement** (Highest priority - makes game more challenging)
2. **Weapons System** (Adds gameplay variety)
3. **Mission System** (Improves replayability)
4. **Power-ups** (Adds strategy)
5. **Obstacles** (Enhances environment)
6. **Visual Effects** (Improves polish)
7. **Difficulty System** (Accessibility)

## Backward Compatibility

All enhancements will maintain backward compatibility with existing:
- WASM export format
- State serialisation
- Proven-gameserver protocol
- Web interface

## Testing Requirements

Each feature will include:
- Unit tests for core functionality
- Integration tests with game loop
- Performance impact analysis
- Memory usage verification

## Next Steps

1. Implement enemy AI patterns
2. Add weapon variety
3. Create mission system
4. Add power-ups
5. Test and balance
6. Integrate with web interface
7. Update documentation

This enhancement plan will transform the game from a basic prototype to a fully-featured, engaging experience while maintaining the proven-servers integration and deterministic simulation requirements.