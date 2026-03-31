// Airborne Submarine Squadron (AffineScript) - Enhanced with Power-ups
// WASM-first rewrite: core model + deterministic tick + input/collision/HUD + power-ups

type Environment = Int;

type Submarine = { x: Int, y: Int, vx: Int, vy: Int, health: Int };

type Weapons = { torpedoes: Int, missiles: Int, depth_charges: Int, ammo: Int, cooldown: Int };

type Projectile = { x: Int, y: Int, vx: Int, vy: Int, active: Bool };

type Projectiles = { a: Projectile, b: Projectile };

type Enemy = { x: Int, y: Int, health: Int, active: Bool };

type Enemies = { a: Enemy, b: Enemy };

type Input = { thrust_x: Int, thrust_y: Int, fire: Bool, fire_alt: Bool, toggle_env: Bool };

type Objective = { kills_needed: Int, max_ticks: Int, completed: Bool, failed: Bool };

type Mission = { id: Int, objective: Objective };

// ========== POWER-UP SYSTEM ==========

type PowerUpType
  = HealthPack
  | AmmoRefill
  | Shield
  | SpeedBoost
  | RapidFire
  | DoubleDamage
  | EnvironmentControl;

type PowerUp = {
  x: Int, y: Int,
  powerup_type: PowerUpType,
  active: Bool,
  duration: Int,
  spawn_tick: Int
};

type PowerUps = { a: PowerUp, b: PowerUp, c: PowerUp };

type ActivePowerUps = {
  shield: Bool,
  speed_boost: Bool,
  rapid_fire: Bool,
  double_damage: Bool,
  environment_control: Bool,
  shield_timer: Int,
  speed_boost_timer: Int,
  rapid_fire_timer: Int,
  double_damage_timer: Int,
  environment_control_timer: Int
};

// ========== UPDATED WORLD TYPE ==========

type World = {
  tick: Int,
  env: Environment,
  sub: Submarine,
  weapons: Weapons,
  proj: Projectiles,
  enemies: Enemies,
  powerups: PowerUps,
  active_powerups: ActivePowerUps,
  score: Int,
  kills: Int,
  mission: Mission,
  last_input: Input
};

effect IO {
  fn println(s: String);
}

fn env_air() -> Environment = 0;

fn env_water() -> Environment = 1;

fn is_air(env: Environment) -> Bool {
  return env == 0;
}

fn world_width() -> Int = 800;

fn world_height() -> Int = 600;

fn ground_y() -> Int = 520;

fn clamp(v: Int, lo: Int, hi: Int) -> Int {
  if v < lo {
    return lo;
  } else if v > hi {
    return hi;
  } else {
    return v;
  };
}

fn min(a: Int, b: Int) -> Int {
  if a < b { a } else { b };
}

fn max(a: Int, b: Int) -> Int {
  if a > b { a } else { b };
}

fn abs(v: Int) -> Int {
  if v < 0 { -v } else { v };
}

fn sqrt(v: Int) -> Int {
  // Simple integer square root approximation
  if v <= 1 { return v; }
  let mut x = v;
  let mut y = (x + 1) / 2;
  while y < x {
    x = y;
    y = (x + v / x) / 2;
  };
  return x;
}

fn rand_int(max: Int) -> Int {
  // Simple pseudo-random number generator
  // In real implementation, this would use WASM's crypto RNG
  return (tick() * 1103515245 + 12345) % max;
}

fn tick() -> Int {
  // This would be replaced with actual tick counter in game loop
  return 0;
}

// ========== POWER-UP FUNCTIONS ==========

fn init_powerup() -> PowerUp {
  return { x: 0, y: 0, powerup_type: HealthPack, active: false, duration: 0, spawn_tick: 0 };
}

fn init_active_powerups() -> ActivePowerUps {
  return {
    shield: false,
    speed_boost: false,
    rapid_fire: false,
    double_damage: false,
    environment_control: false,
    shield_timer: 0,
    speed_boost_timer: 0,
    rapid_fire_timer: 0,
    double_damage_timer: 0,
    environment_control_timer: 0
  };
}

fn spawn_powerup(world: World, tick: Int) -> World {
  // Only spawn if there's an inactive power-up slot
  if world.powerups.a.active && world.powerups.b.active && world.powerups.c.active {
    return world;
  }
  
  // Random spawn chance (5% per tick)
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
  let new_powerup = { x, y, powerup_type, active: true, duration, spawn_tick: tick };
  
  if slot == "a" {
    return { 
      ...world, 
      powerups: { 
        ...world.powerups, 
        a: new_powerup
      }
    };
  } else if slot == "b" {
    return { 
      ...world, 
      powerups: { 
        ...world.powerups, 
        b: new_powerup
      }
    };
  } else {
    return { 
      ...world, 
      powerups: { 
        ...world.powerups, 
        c: new_powerup
      }
    };
  }
}

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
      active_powerups: { 
        ...world.active_powerups, 
        shield: true,
        shield_timer: 300  // 5 seconds × 60 ticks
      }
    };
  } else if powerup_type == SpeedBoost {
    return { 
      ...world, 
      powerups: new_powerups,
      active_powerups: { 
        ...world.active_powerups, 
        speed_boost: true,
        speed_boost_timer: 600  // 10 seconds × 60 ticks
      }
    };
  } else if powerup_type == RapidFire {
    return { 
      ...world, 
      powerups: new_powerups,
      active_powerups: { 
        ...world.active_powerups, 
        rapid_fire: true,
        rapid_fire_timer: 900  // 15 seconds × 60 ticks
      }
    };
  } else if powerup_type == DoubleDamage {
    return { 
      ...world, 
      powerups: new_powerups,
      active_powerups: { 
        ...world.active_powerups, 
        double_damage: true,
        double_damage_timer: 600  // 10 seconds × 60 ticks
      }
    };
  } else { // EnvironmentControl
    return { 
      ...world, 
      powerups: new_powerups,
      active_powerups: { 
        ...world.active_powerups, 
        environment_control: true,
        environment_control_timer: 1200  // 20 seconds × 60 ticks
      }
    };
  }
}

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
  
  let shield_timer = if shield { world.active_powerups.shield_timer - 1 } else { 0 };
  let speed_boost_timer = if speed_boost { world.active_powerups.speed_boost_timer - 1 } else { 0 };
  let rapid_fire_timer = if rapid_fire { world.active_powerups.rapid_fire_timer - 1 } else { 0 };
  let double_damage_timer = if double_damage { world.active_powerups.double_damage_timer - 1 } else { 0 };
  let environment_control_timer = if environment_control { world.active_powerups.environment_control_timer - 1 } else { 0 };
  
  return { 
    ...world, 
    active_powerups: { 
      shield, 
      speed_boost, 
      rapid_fire, 
      double_damage, 
      environment_control,
      shield_timer,
      speed_boost_timer,
      rapid_fire_timer,
      double_damage_timer,
      environment_control_timer
    }
  };
}

// ========== EXISTING FUNCTIONS (UPDATED) ==========

fn init_submarine() -> Submarine {
  return { x: 400, y: 200, vx: 0, vy: 0, health: 100 };
}

fn init_weapons() -> Weapons {
  return { torpedoes: 4, missiles: 6, depth_charges: 3, ammo: 200, cooldown: 0 };
}

fn init_projectile() -> Projectile {
  return { x: 0, y: 0, vx: 0, vy: 0, active: false };
}

fn init_enemy() -> Enemy {
  return { x: 0, y: 0, health: 0, active: false };
}

fn zero_input() -> Input {
  return { thrust_x: 0, thrust_y: 0, fire: false, fire_alt: false, toggle_env: false };
}

fn init_mission() -> Mission {
  return {
    id: 1,
    objective: { kills_needed: 4, max_ticks: 360, completed: false, failed: false }
  };
}

fn init_world() -> World {
  return {
    tick: 0,
    env: env_air(),
    sub: init_submarine(),
    weapons: init_weapons(),
    proj: { a: init_projectile(), b: init_projectile() },
    enemies: { a: init_enemy(), b: init_enemy() },
    powerups: { a: init_powerup(), b: init_powerup(), c: init_powerup() },
    active_powerups: init_active_powerups(),
    score: 0,
    kills: 0,
    mission: init_mission(),
    last_input: zero_input()
  };
}

// ========== UPDATED GAME LOOP ==========

fn step(world: World, input: Input) -> World {
  let t = world.tick + 1;
  
  // 1. Spawn power-ups
  let world1 = spawn_powerup(world, t);
  
  // 2. Apply active power-up effects
  let world2 = apply_active_powerups(world1);
  
  // 3. Update power-up timers
  let world3 = update_powerup_timers(world2);
  
  // 4. Check power-up collisions
  let world4 = check_powerup_collision(world3, world3.sub);
  
  // 5. Continue with existing game logic...
  let env2 = toggle_env(world4.env, t, input.toggle_env);
  let sub1 = apply_input(world4.sub, input);
  let sub2 = apply_bounds(integrate(sub1, env2));
  let weapons2 = weapons_cooldown(world4.weapons);
  
  // ... rest of the existing step function
  
  // Note: This is a simplified version - the full step function
  // would continue with projectiles, enemies, collisions, etc.
  
  return {
    ...world4,
    tick: t,
    env: env2,
    sub: sub2,
    weapons: weapons2
    // Other fields would be updated by the full step function
  };
}

// ========== EXPORT FOR WASM ==========

fn init_state() -> Int {
  let world = init_world();
  return build_snapshot(
    world.tick,
    world.env,
    world.sub.x,
    world.sub.y,
    world.sub.vx,
    world.sub.vy,
    world.sub.health,
    world.weapons.ammo,
    world.weapons.cooldown,
    bool_to_int(world.proj.a.active),
    world.proj.a.x,
    world.proj.a.y,
    bool_to_int(world.proj.b.active),
    world.proj.b.x,
    world.proj.b.y,
    bool_to_int(world.enemies.a.active),
    world.enemies.a.x,
    world.enemies.a.y,
    world.enemies.a.health,
    bool_to_int(world.enemies.b.active),
    world.enemies.b.x,
    world.enemies.b.y,
    world.enemies.b.health,
    world.score,
    world.kills,
    world.mission.objective.kills_needed,
    world.mission.objective.max_ticks,
    bool_to_int(world.mission.objective.completed),
    bool_to_int(world.mission.objective.failed)
  );
}

// Note: The full implementation would include all the existing functions
// (apply_gravity, integrate, apply_input, etc.) plus the new power-up functions

fn main() -> Int {
  let world = init_world();
  let world2 = step(world, zero_input());
  return build_snapshot(
    world2.tick,
    world2.env,
    world2.sub.x,
    world2.sub.y,
    world2.sub.vx,
    world2.sub.vy,
    world2.sub.health,
    world2.weapons.ammo,
    world2.weapons.cooldown,
    bool_to_int(world2.proj.a.active),
    world2.proj.a.x,
    world2.proj.a.y,
    bool_to_int(world2.proj.b.active),
    world2.proj.b.x,
    world2.proj.b.y,
    bool_to_int(world2.enemies.a.active),
    world2.enemies.a.x,
    world2.enemies.a.y,
    world2.enemies.a.health,
    bool_to_int(world2.enemies.b.active),
    world2.enemies.b.x,
    world2.enemies.b.y,
    world2.enemies.b.health,
    world2.score,
    world2.kills,
    world2.mission.objective.kills_needed,
    world2.mission.objective.max_ticks,
    bool_to_int(world2.mission.objective.completed),
    bool_to_int(world2.mission.objective.failed)
  );
}