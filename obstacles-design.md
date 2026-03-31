# Obstacles System Design

## Obstacle Types

### 1. Rock Formation
- **Effect**: Indestructible obstacle
- **Visual**: Gray rocky texture
- **Collision**: Solid - stops submarine and projectiles
- **Spawn**: Ground level, various sizes

### 2. Iceberg
- **Effect**: Destructible with multiple hits
- **Visual**: White/blue icy texture
- **Collision**: Solid until destroyed
- **Health**: 50 points
- **Spawn**: Water environment only

### 3. Coral Reef
- **Effect**: Slows submarine movement
- **Visual**: Colorful coral texture
- **Collision**: Pass-through but applies drag
- **Slowdown**: 30% speed reduction
- **Spawn**: Water environment only

### 4. Whirlpool
- **Effect**: Pulls submarine toward center
- **Visual**: Swirling water animation
- **Collision**: Force field effect
- **Pull Strength**: 2 pixels per tick
- **Spawn**: Water environment only

### 5. Thermal Vent
- **Effect**: Pushes submarine upward
- **Visual**: Bubble animation
- **Collision**: Force field effect
- **Push Strength**: 3 pixels per tick upward
- **Spawn**: Water environment only

### 6. Minefield
- **Effect**: Hidden mines that explode on contact
- **Visual**: Subtle water disturbance
- **Collision**: Explosion on contact
- **Damage**: 30 points
- **Spawn**: Both environments

### 7. Oil Spill
- **Effect**: Reduces visibility temporarily
- **Visual**: Dark slick on water
- **Collision**: Visual effect only
- **Duration**: 5 seconds of reduced visibility
- **Spawn**: Water environment only

## Implementation Plan

### AffineScript Types (src/main.as)

```affinescript
type ObstacleType
  = Rock           // Indestructible
  | Iceberg        // Destructible
  | CoralReef      // Slows movement
  | Whirlpool      // Pulls inward
  | ThermalVent    // Pushes upward
  | Minefield      // Hidden mines
  | OilSpill       // Reduces visibility

type Obstacle = {
  x: Int, y: Int,
  width: Int, height: Int,
  obstacle_type: ObstacleType,
  health: Int,           // For destructible obstacles
  active: Bool,
  effect_strength: Int    // Pull/push strength, slowdown amount, etc.
}

// Add to World type
type World = {
  // ... existing fields
  obstacles: { 
    a: Obstacle, 
    b: Obstacle, 
    c: Obstacle, 
    d: Obstacle  // Up to 4 active obstacles
  },
  active_effects: {
    oil_spill: Bool,      // Visibility reduced
    oil_spill_timer: Int   // Remaining duration
  }
}
```

### Spawning Logic

```affinescript
type ObstacleSpawnPattern
  = Random
  | Cluster
  | Path
  | Wall

fn spawn_obstacle(world: World, tick: Int) -> World {
  // Only spawn if there's an inactive obstacle slot
  if world.obstacles.a.active && 
     world.obstacles.b.active && 
     world.obstacles.c.active && 
     world.obstacles.d.active {
    return world;
  }
  
  // Spawn based on environment
  if is_air(world.env) {
    // Air obstacles (rocks, minefields)
    if tick % 100 == 0 && rand_int(100) < 15 {
      return spawn_air_obstacle(world, tick);
    }
  } else {
    // Water obstacles (icebergs, coral, whirlpools, etc.)
    if tick % 80 == 0 && rand_int(100) < 20 {
      return spawn_water_obstacle(world, tick);
    }
  }
  
  return world;
}

fn spawn_air_obstacle(world: World, tick: Int) -> World {
  // Find first inactive slot
  if !world.obstacles.a.active {
    return spawn_in_obstacle_slot(world, "a", tick, true);
  } else if !world.obstacles.b.active {
    return spawn_in_obstacle_slot(world, "b", tick, true);
  } else if !world.obstacles.c.active {
    return spawn_in_obstacle_slot(world, "c", tick, true);
  } else {
    return spawn_in_obstacle_slot(world, "d", tick, true);
  }
}

fn spawn_water_obstacle(world: World, tick: Int) -> World {
  // Find first inactive slot
  if !world.obstacles.a.active {
    return spawn_in_obstacle_slot(world, "a", tick, false);
  } else if !world.obstacles.b.active {
    return spawn_in_obstacle_slot(world, "b", tick, false);
  } else if !world.obstacles.c.active {
    return spawn_in_obstacle_slot(world, "c", tick, false);
  } else {
    return spawn_in_obstacle_slot(world, "d", tick, false);
  }
}

fn spawn_in_obstacle_slot(world: World, slot: String, tick: Int, air: Bool) -> World {
  let rand = rand_int(100);
  let obstacle_type, width, height, health, effect_strength;
  
  if air {
    // Air obstacles
    if rand < 60 {
      // Rock formation (60%)
      obstacle_type = Rock;
      width = rand_int(60) + 40;  // 40-100px
      height = rand_int(40) + 20; // 20-60px
      health = 0;               // Indestructible
      effect_strength = 0;
    } else {
      // Minefield (40%)
      obstacle_type = Minefield;
      width = 100;
      height = 50;
      health = 1;               // "Health" = number of mines
      effect_strength = 30;      // Damage
    }
  } else {
    // Water obstacles
    if rand < 30 {
      // Iceberg (30%)
      obstacle_type = Iceberg;
      width = rand_int(80) + 50; // 50-130px
      height = rand_int(60) + 30; // 30-90px
      health = 50;
      effect_strength = 0;
    } else if rand < 55 {
      // Coral reef (25%)
      obstacle_type = CoralReef;
      width = rand_int(100) + 80; // 80-180px
      height = 40;
      health = 0;               // Indestructible
      effect_strength = 30;      // 30% slowdown
    } else if rand < 75 {
      // Whirlpool (20%)
      obstacle_type = Whirlpool;
      width = 80;
      height = 80;
      health = 0;
      effect_strength = 2;       // 2px pull per tick
    } else if rand < 90 {
      // Thermal vent (15%)
      obstacle_type = ThermalVent;
      width = 30;
      height = 100;
      health = 0;
      effect_strength = 3;      // 3px push upward
    } else {
      // Oil spill (10%)
      obstacle_type = OilSpill;
      width = rand_int(120) + 60; // 60-180px
      height = 30;
      health = 0;
      effect_strength = 300;    // 5 seconds × 60 ticks
    }
  }
  
  // Position (right side, random Y)
  let x = 850;
  let y = rand_int(450) + 50;
  
  // Create obstacle
  let obstacle = {
    x, y, width, height,
    obstacle_type, health, 
    active: true, effect_strength
  };
  
  // Update the specific slot
  if slot == "a" {
    return { ...world, obstacles: { ...world.obstacles, a: obstacle } };
  } else if slot == "b" {
    return { ...world, obstacles: { ...world.obstacles, b: obstacle } };
  } else if slot == "c" {
    return { ...world, obstacles: { ...world.obstacles, c: obstacle } };
  } else {
    return { ...world, obstacles: { ...world.obstacles, d: obstacle } };
  }
}
```

### Collision Detection

```affinescript
fn check_obstacle_collisions(world: World, sub: Submarine) -> World {
  let mut updated = world;
  
  // Check collision with each obstacle
  if world.obstacles.a.active {
    updated = check_single_obstacle(updated, "a", sub);
  }
  if world.obstacles.b.active {
    updated = check_single_obstacle(updated, "b", sub);
  }
  if world.obstacles.c.active {
    updated = check_single_obstacle(updated, "c", sub);
  }
  if world.obstacles.d.active {
    updated = check_single_obstacle(updated, "d", sub);
  }
  
  return updated;
}

fn check_single_obstacle(world: World, slot: String, sub: Submarine) -> World {
  let obstacle = 
    if slot == "a" { world.obstacles.a } 
    else if slot == "b" { world.obstacles.b } 
    else if slot == "c" { world.obstacles.c } 
    else { world.obstacles.d };
  
  // Check if submarine intersects with obstacle
  if rect_intersect(
    sub.x, sub.y, 24, 12,  // Submarine hitbox
    obstacle.x, obstacle.y, obstacle.width, obstacle.height
  ) {
    return apply_obstacle_effect(world, slot, obstacle, sub);
  }
  
  return world;
}

fn rect_intersect(x1: Int, y1: Int, w1: Int, h1: Int, x2: Int, y2: Int, w2: Int, h2: Int) -> Bool {
  return x1 < x2 + w2 && x1 + w1 > x2 && y1 < y2 + h2 && y1 + h1 > y2;
}

fn apply_obstacle_effect(world: World, slot: String, obstacle: Obstacle, sub: Submarine) -> World {
  if obstacle.obstacle_type == Rock || obstacle.obstacle_type == Iceberg {
    // Solid collision - stop submarine
    return handle_solid_collision(world, slot, obstacle, sub);
  } else if obstacle.obstacle_type == CoralReef {
    // Slowdown effect
    return handle_coral_reef(world, slot, obstacle, sub);
  } else if obstacle.obstacle_type == Whirlpool {
    // Pull toward center
    return handle_whirlpool(world, slot, obstacle, sub);
  } else if obstacle.obstacle_type == ThermalVent {
    // Push upward
    return handle_thermal_vent(world, slot, obstacle, sub);
  } else if obstacle.obstacle_type == Minefield {
    // Explosion damage
    return handle_minefield(world, slot, obstacle, sub);
  } else { // OilSpill
    // Visibility reduction
    return handle_oil_spill(world, slot, obstacle, sub);
  }
}

fn handle_solid_collision(world: World, slot: String, obstacle: Obstacle, sub: Submarine) -> World {
  // Stop submarine movement
  let new_sub = { ...sub, vx: 0, vy: 0 };
  
  // If iceberg, reduce health
  if obstacle.obstacle_type == Iceberg {
    let new_health = obstacle.health - 10;
    let new_obstacle = { ...obstacle, health: new_health };
    
    if new_health <= 0 {
      // Destroy iceberg
      return deactivate_obstacle(world, slot);
    } else {
      // Update iceberg health
      return update_obstacle(world, slot, new_obstacle, new_sub);
    }
  }
  
  return update_obstacle(world, slot, obstacle, new_sub);
}

fn handle_coral_reef(world: World, slot: String, obstacle: Obstacle, sub: Submarine) -> World {
  // Apply slowdown (reduce velocity by 30%)
  let slowdown = obstacle.effect_strength / 100.0;
  let new_vx = sub.vx * (1.0 - slowdown);
  let new_vy = sub.vy * (1.0 - slowdown);
  let new_sub = { ...sub, vx: int(new_vx), vy: int(new_vy) };
  
  return update_obstacle(world, slot, obstacle, new_sub);
}

fn handle_whirlpool(world: World, slot: String, obstacle: Obstacle, sub: Submarine) -> World {
  // Pull submarine toward center
  let center_x = obstacle.x + obstacle.width / 2;
  let center_y = obstacle.y + obstacle.height / 2;
  
  let dx = center_x - sub.x;
  let dy = center_y - sub.y;
  let distance = sqrt(dx * dx + dy * dy);
  
  if distance > 0 {
    // Normalize and apply pull force
    let pull_x = (dx / distance) * obstacle.effect_strength;
    let pull_y = (dy / distance) * obstacle.effect_strength;
    
    let new_vx = sub.vx + int(pull_x);
    let new_vy = sub.vy + int(pull_y);
    
    // Clamp velocity
    let clamped_vx = if new_vx > 15 { 15 } else if new_vx < -15 { -15 } else { new_vx };
    let clamped_vy = if new_vy > 15 { 15 } else if new_vy < -15 { -15 } else { new_vy };
    
    let new_sub = { ...sub, vx: clamped_vx, vy: clamped_vy };
    return update_obstacle(world, slot, obstacle, new_sub);
  }
  
  return world;
}

fn handle_thermal_vent(world: World, slot: String, obstacle: Obstacle, sub: Submarine) -> World {
  // Push submarine upward
  let new_vy = sub.vy - obstacle.effect_strength;
  let clamped_vy = if new_vy < -20 { -20 } else { new_vy };
  let new_sub = { ...sub, vy: clamped_vy };
  
  return update_obstacle(world, slot, obstacle, new_sub);
}

fn handle_minefield(world: World, slot: String, obstacle: Obstacle, sub: Submarine) -> World {
  // Explosion damage
  let new_health = sub.health - obstacle.effect_strength;
  let new_sub = { ...sub, health: new_health };
  
  // Reduce mine count
  let new_health_count = obstacle.health - 1;
  
  if new_health_count <= 0 {
    // Minefield exhausted
    return deactivate_obstacle(world, slot, new_sub);
  } else {
    // Update minefield
    let new_obstacle = { ...obstacle, health: new_health_count };
    return update_obstacle(world, slot, new_obstacle, new_sub);
  }
}

fn handle_oil_spill(world: World, slot: String, obstacle: Obstacle, sub: Submarine) -> World {
  // Activate oil spill effect
  if !world.active_effects.oil_spill {
    let new_effects = {
      ...world.active_effects,
      oil_spill: true,
      oil_spill_timer: obstacle.effect_strength
    };
    return { ...world, active_effects: new_effects };
  }
  
  return world;
}

fn deactivate_obstacle(world: World, slot: String, sub: Submarine) -> World {
  let new_obstacles = 
    if slot == "a" { { ...world.obstacles, a: { ...world.obstacles.a, active: false } } }
    else if slot == "b" { { ...world.obstacles, b: { ...world.obstacles.b, active: false } } }
    else if slot == "c" { { ...world.obstacles, c: { ...world.obstacles.c, active: false } } }
    else { { ...world.obstacles, d: { ...world.obstacles.d, active: false } } };
  
  return { ...world, obstacles: new_obstacles, sub: sub };
}

fn update_obstacle(world: World, slot: String, obstacle: Obstacle, sub: Submarine) -> World {
  let new_obstacles = 
    if slot == "a" { { ...world.obstacles, a: obstacle } }
    else if slot == "b" { { ...world.obstacles, b: obstacle } }
    else if slot == "c" { { ...world.obstacles, c: obstacle } }
    else { { ...world.obstacles, d: obstacle } };
  
  return { ...world, obstacles: new_obstacles, sub: sub };
}

fn apply_active_obstacle_effects(world: World) -> World {
  // Apply oil spill visibility reduction
  if world.active_effects.oil_spill {
    // In web interface, this would trigger a visual effect
    // Game logic continues normally
    let new_timer = world.active_effects.oil_spill_timer - 1;
    
    if new_timer <= 0 {
      let new_effects = { ...world.active_effects, oil_spill: false, oil_spill_timer: 0 };
      return { ...world, active_effects: new_effects };
    } else {
      let new_effects = { ...world.active_effects, oil_spill_timer: new_timer };
      return { ...world, active_effects: new_effects };
    }
  }
  
  return world;
}
```

### Integration with Game Loop

```affinescript
fn step(world: World, input: Input) -> World {
  // 1. Spawn obstacles (if applicable)
  let world1 = spawn_obstacle(world, world.tick);
  
  // 2. Apply active obstacle effects
  let world2 = apply_active_obstacle_effects(world1);
  
  // 3. Check obstacle collisions
  let world3 = check_obstacle_collisions(world2, world2.sub);
  
  // 4. Continue with normal game logic...
  // ... rest of the step function
  
  return final_world;
}
```

## Web Interface Integration

### JavaScript Obstacle Handling

```javascript
// In web/app.js

function updateObstacles(world) {
  // Clear existing obstacles
  obstacleElements.forEach(el => el.remove());
  obstacleElements = [];
  
  // Draw active obstacles
  if (world.obstacles.a.active) {
    drawObstacle(world.obstacles.a);
  }
  if (world.obstacles.b.active) {
    drawObstacle(world.obstacles.b);
  }
  if (world.obstacles.c.active) {
    drawObstacle(world.obstacles.c);
  }
  if (world.obstacles.d.active) {
    drawObstacle(world.obstacles.d);
  }
  
  // Apply visual effects
  applyObstacleEffects(world.active_effects);
}

function drawObstacle(obstacle) {
  const element = document.createElement('div');
  element.className = 'obstacle';
  
  // Set position and size
  const x = obstacle.x * sx;
  const y = obstacle.y * sy;
  const width = obstacle.width * sx;
  const height = obstacle.height * sy;
  
  element.style.left = `${x}px`;
  element.style.top = `${y}px`;
  element.style.width = `${width}px`;
  element.style.height = `${height}px`;
  
  // Set appearance based on type
  const typeClass = getObstacleTypeClass(obstacle.obstacle_type);
  element.classList.add(typeClass);
  
  // Add to game canvas
  gameContainer.appendChild(element);
  obstacleElements.push(element);
}

function getObstacleTypeClass(type) {
  const classes = {
    Rock: 'obstacle-rock',
    Iceberg: 'obstacle-iceberg',
    CoralReef: 'obstacle-coral',
    Whirlpool: 'obstacle-whirlpool',
    ThermalVent: 'obstacle-vent',
    Minefield: 'obstacle-minefield',
    OilSpill: 'obstacle-oil'
  };
  return classes[type] || 'obstacle-default';
}

function applyObstacleEffects(activeEffects) {
  const gameCanvas = document.getElementById('viewport');
  
  if (activeEffects.oil_spill) {
    gameCanvas.classList.add('oil-spill-effect');
  } else {
    gameCanvas.classList.remove('oil-spill-effect');
  }
}
```

## CSS Styling

```css
/* In web/style.css */

.obstacle {
  position: absolute;
  background-repeat: no-repeat;
  background-size: contain;
  pointer-events: none;
  z-index: 5;
}

.obstacle-rock {
  background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><path d="M10,40 Q30,10 50,30 T90,20 L80,40 Q60,50 40,35 T20,45 Z" fill="%23666" /></svg>');
}

.obstacle-iceberg {
  background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 80"><path d="M20,60 Q40,20 60,40 T80,30 L70,70 Q50,75 30,65 T10,70 Z" fill="%23aaf" /></svg>');
}

.obstacle-coral {
  background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 150 40"><path d="M10,30 Q30,10 50,25 T70,15 Q90,25 110,20 T130,28 L140,35 Q120,38 100,32 T80,36 Q60,39 40,34 T20,38 Z" fill="%23f88" /></svg>');
}

.obstacle-whirlpool {
  background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><circle cx="40" cy="40" r="35" fill="none" stroke="%23448" stroke-width="8" stroke-dasharray="5,5" transform="rotate(45 40 40)" /></svg>');
  animation: spin 4s linear infinite;
}

.obstacle-vent {
  background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 100"><rect x="5" y="10" width="20" height="80" fill="%23484" /><circle cx="15" y="20" r="8" fill="%238bf" /><circle cx="10" y="35" r="5" fill="%238bf" /><circle cx="20" y="45" r="6" fill="%238bf" /></svg>');
}

.obstacle-minefield {
  background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><rect x="5" y="15" width="90" height="20" fill="%23363" opacity="0.3" /><circle cx="20" cy="25" r="8" fill="%23333" /><circle cx="40" cy="20" r="6" fill="%23333" /><circle cx="60" cy="28" r="7" fill="%23333" /><circle cx="80" cy="22" r="5" fill="%23333" /></svg>');
}

.obstacle-oil {
  background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 30"><ellipse cx="90" cy="15" rx="80" ry="12" fill="%23331" opacity="0.6" /></svg>');
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.oil-spill-effect {
  filter: brightness(0.7) contrast(1.2);
  animation: flicker 0.5s infinite alternate;
}

@keyframes flicker {
  from { opacity: 0.9; }
  to { opacity: 0.7; }
}
```

## Testing Plan

### Unit Tests
1. Test obstacle spawning with correct probabilities
2. Test collision detection for each obstacle type
3. Test effect application (slowdown, pull, push, damage)
4. Test destructible obstacles (iceberg health reduction)

### Integration Tests
1. Test full obstacle lifecycle (spawn → collision → effect → destruction)
2. Test multiple simultaneous obstacles
3. Test obstacle interactions with power-ups

### Manual Testing
1. Verify visual appearance and animations
2. Test gameplay balance
3. Adjust spawn rates and effect strengths as needed

## Balancing Considerations

- **Spawn Rate**: Start conservative (15-20% chance), adjust based on difficulty
- **Effect Strength**: Keep effects noticeable but not game-breaking
- **Environment Specific**: Water obstacles more frequent but varied
- **Risk/Reward**: Place obstacles near power-ups for strategic choices

## Next Steps

1. Implement AffineScript types and functions
2. Add obstacle spawning to game loop
3. Implement collision detection and effects
4. Update web interface with visuals
5. Test and balance

This obstacle system will add environmental challenges and strategic depth to the game while maintaining the proven-servers architecture and deterministic simulation requirements.