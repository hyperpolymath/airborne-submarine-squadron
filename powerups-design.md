# Power-ups System Design

## Power-up Types

### 1. Health Pack
- **Effect**: Restores 25 health points
- **Duration**: Instant
- **Spawn Rate**: Common (20%)
- **Visual**: Red cross symbol

### 2. Ammo Refill
- **Effect**: Refills all ammunition
- **Duration**: Instant
- **Spawn Rate**: Common (20%)
- **Visual**: Ammo crate

### 3. Shield
- **Effect**: Temporary invulnerability (5 seconds)
- **Duration**: 5 seconds or until hit
- **Spawn Rate**: Rare (10%)
- **Visual**: Blue energy shield

### 4. Speed Boost
- **Effect**: Doubles submarine speed
- **Duration**: 10 seconds
- **Spawn Rate**: Uncommon (15%)
- **Visual**: Yellow lightning bolt

### 5. Rapid Fire
- **Effect**: Halves weapon cooldown
- **Duration**: 15 seconds
- **Spawn Rate**: Uncommon (15%)
- **Visual**: Red fire icon

### 6. Double Damage
- **Effect**: Doubles weapon damage
- **Duration**: 10 seconds
- **Spawn Rate**: Rare (10%)
- **Visual**: Orange explosion

### 7. Environment Control
- **Effect**: Allows manual environment switching
- **Duration**: 20 seconds
- **Spawn Rate**: Very Rare (5%)
- **Visual**: Green globe

## Implementation Plan

### AffineScript Types (src/main.affine)

```affinescript
type PowerUpType
  = HealthPack
  | AmmoRefill
  | Shield
  | SpeedBoost
  | RapidFire
  | DoubleDamage
  | EnvironmentControl

type PowerUp = {
  x: Int, y: Int,
  powerup_type: PowerUpType,
  active: Bool,
  duration: Int,
  spawn_tick: Int
}
type ActivePowerUp = {
  powerup_type: PowerUpType,
  remaining_duration: Int
}

// Add to World type
type World = {
  // ... existing fields
  powerups: { a: PowerUp, b: PowerUp, c: PowerUp },  // Up to 3 active power-ups
  active_powerups: { 
    shield: Bool, 
    speed_boost: Bool, 
    rapid_fire: Bool, 
    double_damage: Bool,
    environment_control: Bool 
  }
}
```

### Spawning Logic

```affinescript
fn spawn_powerup(world: World, tick: Int) -> World {
  // Only spawn if there's an inactive power-up slot
  if world.powerups.a.active && world.powerups.b.active && world.powerups.c.active {
    return world;
  }
  
  // Random spawn chance (e.g., 5% per tick)
  if tick % 20 == 0 && rand_int(100) < 5 {
    // Find first inactive slot
    if !world.powerups.a.active {
      return spawn_in_slot(world, "a", tick);
    } else if !world.powerups.b.active {
      return spawn_in_slot(world, "b", tick);
    } else {
      return spawn_in_slot(world, "c", tick);
    }
  }
  return world;
}

fn spawn_in_slot(world: World, slot: String, tick: Int) -> World {
  // Random position (right side of screen)
  let x = 850;
  let y = rand_int(500) + 50;
  
  // Random power-up type with weighted probability
  let rand = rand_int(100);
  let (powerup_type, duration) =
    if rand < 20 { (HealthPack, 0) }            // 20%
    else if rand < 40 { (AmmoRefill, 0) }       // 20%
    else if rand < 55 { (Shield, 300) }         // 15% (5 sec × 60 ticks)
    else if rand < 70 { (SpeedBoost, 600) }     // 15% (10 sec × 60 ticks)
    else if rand < 85 { (RapidFire, 900) }      // 15% (15 sec × 60 ticks)
    else if rand < 95 { (DoubleDamage, 600) }   // 10% (10 sec × 60 ticks)
    else { (EnvironmentControl, 1200) };        // 5% (20 sec × 60 ticks)
  
  // Update the specific slot
  if slot == "a" {
    return { 
      ...world, 
      powerups: { 
        ...world.powerups, 
        a: { x, y, powerup_type, active: true, duration, spawn_tick: tick }
      }
    };
  } else if slot == "b" {
    return { 
      ...world, 
      powerups: { 
        ...world.powerups, 
        b: { x, y, powerup_type, active: true, duration, spawn_tick: tick }
      }
    };
  } else {
    return { 
      ...world, 
      powerups: { 
        ...world.powerups, 
        c: { x, y, powerup_type, active: true, duration, spawn_tick: tick }
      }
    };
  }
}
```

### Collection Logic

```affinescript
fn check_powerup_collision(world: World, sub: Submarine) -> World {
  let mut updated = world;
  
  // Check collision with each power-up
  if world.powerups.a.active {
    updated = check_single_powerup(updated, "a", sub);
  }
  if world.powerups.b.active {
    updated = check_single_powerup(updated, "b", sub);
  }
  if world.powerups.c.active {
    updated = check_single_powerup(updated, "c", sub);
  }
  
  return updated;
}

fn check_single_powerup(world: World, slot: String, sub: Submarine) -> World {
  let powerup = 
    if slot == "a" { world.powerups.a } 
    else if slot == "b" { world.powerups.b } 
    else { world.powerups.c };
  
  // Simple distance-based collision (15px radius)
  let dx = abs(powerup.x - sub.x);
  let dy = abs(powerup.y - sub.y);
  
  if dx < 15 && dy < 15 {
    // Collect the power-up
    return apply_powerup_effect(world, slot, powerup.powerup_type);
  }
  
  return world;
}

fn apply_powerup_effect(world: World, slot: String, powerup_type: PowerUpType) -> World {
  // Deactivate the power-up
  let new_powerups = 
    if slot == "a" { { ...world.powerups, a: { ...world.powerups.a, active: false } } }
    else if slot == "b" { { ...world.powerups, b: { ...world.powerups.b, active: false } } }
    else { { ...world.powerups, c: { ...world.powerups.c, active: false } } };
  
  // Apply the effect based on type
  if powerup_type == HealthPack {
    let new_health = min(world.sub.health + 25, 100);
    let new_sub = { ...world.sub, health: new_health };
    return { ...world, powerups: new_powerups, sub: new_sub };
  } else if powerup_type == AmmoRefill {
    let new_weapons = { ...world.weapons, ammo: 200 };
    return { ...world, powerups: new_powerups, weapons: new_weapons };
  } else if powerup_type == Shield {
    return { 
      ...world, 
      powerups: new_powerups,
      active_powerups: { ...world.active_powerups, shield: true }
    };
  } else if powerup_type == SpeedBoost {
    return { 
      ...world, 
      powerups: new_powerups,
      active_powerups: { ...world.active_powerups, speed_boost: true }
    };
  } else if powerup_type == RapidFire {
    return { 
      ...world, 
      powerups: new_powerups,
      active_powerups: { ...world.active_powerups, rapid_fire: true }
    };
  } else if powerup_type == DoubleDamage {
    return { 
      ...world, 
      powerups: new_powerups,
      active_powerups: { ...world.active_powerups, double_damage: true }
    };
  } else { // EnvironmentControl
    return { 
      ...world, 
      powerups: new_powerups,
      active_powerups: { ...world.active_powerups, environment_control: true }
    };
  }
}
```

### Power-up Effects Application

```affinescript
fn apply_active_powerups(world: World) -> World {
  let mut updated = world;
  
  // Apply speed boost (double velocity)
  if world.active_powerups.speed_boost {
    let vx = world.sub.vx * 2;
    let vy = world.sub.vy * 2;
    // Clamp to prevent excessive speed
    let clamped_vx = if vx > 20 { 20 } else if vx < -20 { -20 } else { vx };
    let clamped_vy = if vy > 20 { 20 } else if vy < -20 { -20 } else { vy };
    let new_sub = { ...world.sub, vx: clamped_vx, vy: clamped_vy };
    updated = { ...updated, sub: new_sub };
  }
  
  // Rapid fire (halve cooldown)
  if world.active_powerups.rapid_fire {
    let cooldown = world.weapons.cooldown / 2;
    let new_weapons = { ...world.weapons, cooldown: max(cooldown, 0) };
    updated = { ...updated, weapons: new_weapons };
  }
  
  return updated;
}

fn update_powerup_timers(world: World) -> World {
  // Decrement timers for active power-ups
  let shield = if world.active_powerups.shield {
    let new_timer = world.active_powerups.shield_timer - 1;
    if new_timer <= 0 { false } else { true }
  } else { false };
  
  let speed_boost = if world.active_powerups.speed_boost {
    let new_timer = world.active_powerups.speed_boost_timer - 1;
    if new_timer <= 0 { false } else { true }
  } else { false };
  
  let rapid_fire = if world.active_powerups.rapid_fire {
    let new_timer = world.active_powerups.rapid_fire_timer - 1;
    if new_timer <= 0 { false } else { true }
  } else { false };
  
  let double_damage = if world.active_powerups.double_damage {
    let new_timer = world.active_powerups.double_damage_timer - 1;
    if new_timer <= 0 { false } else { true }
  } else { false };
  
  let environment_control = if world.active_powerups.environment_control {
    let new_timer = world.active_powerups.environment_control_timer - 1;
    if new_timer <= 0 { false } else { true }
  } else { false };
  
  return { 
    ...world, 
    active_powerups: { 
      shield, 
      speed_boost, 
      rapid_fire, 
      double_damage, 
      environment_control
    }
  };
}
```

### Integration with Game Loop

```affinescript
fn step(world: World, input: Input) -> World {
  // 1. Spawn power-ups (if applicable)
  let world1 = spawn_powerup(world, world.tick);
  
  // 2. Apply active power-up effects
  let world2 = apply_active_powerups(world1);
  
  // 3. Update power-up timers
  let world3 = update_powerup_timers(world2);
  
  // 4. Check power-up collisions
  let world4 = check_powerup_collision(world3, world3.sub);
  
  // 5. Continue with normal game logic...
  // ... rest of the step function
  
  return final_world;
}
```

## Web Interface Integration

### JavaScript Power-up Handling

```javascript
// In web/app.js

function updatePowerups(world) {
  // Clear existing power-ups
  powerupElements.forEach(el => el.remove());
  powerupElements = [];
  
  // Draw active power-ups
  if (world.powerups.a.active) {
    drawPowerup(world.powerups.a);
  }
  if (world.powerups.b.active) {
    drawPowerup(world.powerups.b);
  }
  if (world.powerups.c.active) {
    drawPowerup(world.powerups.c);
  }
  
  // Show active effects in HUD
  updatePowerupHUD(world.active_powerups);
}

function drawPowerup(powerup) {
  const element = document.createElement('div');
  element.className = 'powerup';
  
  // Set position
  const x = powerup.x * sx;
  const y = powerup.y * sy;
  element.style.left = `${x}px`;
  element.style.top = `${y}px`;
  
  // Set icon based on type
  const icon = getPowerupIcon(powerup.powerup_type);
  element.innerHTML = icon;
  
  // Add to game canvas
  gameContainer.appendChild(element);
  powerupElements.push(element);
}

function getPowerupIcon(type) {
  const icons = {
    HealthPack: '❤️',
    AmmoRefill: '🔫',
    Shield: '🛡️',
    SpeedBoost: '⚡',
    RapidFire: '🔥',
    DoubleDamage: '💥',
    EnvironmentControl: '🌍'
  };
  return icons[type] || '❓';
}

function updatePowerupHUD(activePowerups) {
  const hud = document.getElementById('powerup-hud');
  hud.innerHTML = '';
  
  if (activePowerups.shield) {
    hud.innerHTML += '<div class="powerup-active">🛡️ Shield</div>';
  }
  if (activePowerups.speed_boost) {
    hud.innerHTML += '<div class="powerup-active">⚡ Speed</div>';
  }
  if (activePowerups.rapid_fire) {
    hud.innerHTML += '<div class="powerup-active">🔥 Rapid Fire</div>';
  }
  if (activePowerups.double_damage) {
    hud.innerHTML += '<div class="powerup-active">💥 2x Damage</div>';
  }
  if (activePowerups.environment_control) {
    hud.innerHTML += '<div class="powerup-active">🌍 Env Control</div>';
  }
}
```

## CSS Styling

```css
/* In web/style.css */

.powerup {
  position: absolute;
  width: 24px;
  height: 24px;
  font-size: 20px;
  text-align: center;
  line-height: 24px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 50%;
  color: gold;
  text-shadow: 1px 1px 2px black;
  pointer-events: none;
  z-index: 10;
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0% { transform: scale(1); }
  50% { transform: scale(1.1); }
  100% { transform: scale(1); }
}

#powerup-hud {
  position: absolute;
  bottom: 20px;
  right: 20px;
  display: flex;
  gap: 10px;
  z-index: 20;
}

.powerup-active {
  background: rgba(0, 0, 0, 0.5);
  padding: 5px 10px;
  border-radius: 5px;
  color: white;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 12px;
}
```

## Testing Plan

### Unit Tests
1. Test power-up spawning with correct probabilities
2. Test collision detection
3. Test effect application
4. Test timer decrement

### Integration Tests
1. Test full power-up lifecycle (spawn → collect → apply → expire)
2. Test multiple simultaneous power-ups
3. Test power-up interactions (e.g., shield + speed boost)

### Manual Testing
1. Verify visual appearance
2. Test gameplay balance
3. Adjust spawn rates as needed

## Balancing Considerations

- **Spawn Rate**: Start with 5% chance per tick, adjust based on testing
- **Duration**: Keep durations short (5-20 seconds) for dynamic gameplay
- **Rarity**: Common power-ups (health, ammo) vs rare (environment control)
- **Impact**: Ensure no single power-up is game-breaking

## Next Steps

1. Implement AffineScript types and functions
2. Add power-up spawning to game loop
3. Implement collision detection
4. Add effect application logic
5. Update web interface
6. Test and balance

This power-up system will add significant depth and replayability to the game while maintaining the proven-servers architecture and deterministic simulation requirements.