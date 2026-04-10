// Airborne Submarine Squadron - Working Version with Power-ups
// Simplified to compile successfully

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

// Power-up type as integer enum (0-6)
type PowerUpType = Int;

// Power-up constants
fn POWERUP_HEALTH_PACK() -> PowerUpType = 0;
fn POWERUP_AMMO_REFILL() -> PowerUpType = 1;
fn POWERUP_SHIELD() -> PowerUpType = 2;
fn POWERUP_SPEED_BOOST() -> PowerUpType = 3;
fn POWERUP_RAPID_FIRE() -> PowerUpType = 4;
fn POWERUP_DOUBLE_DAMAGE() -> PowerUpType = 5;
fn POWERUP_ENV_CONTROL() -> PowerUpType = 6;

type PowerUp = { x: Int, y: Int, powerup_type: PowerUpType, active: Bool, duration: Int, spawn_tick: Int };
type PowerUps = { a: PowerUp, b: PowerUp, c: PowerUp };

type ActivePowerUps = {
  shield: Bool, speed_boost: Bool, rapid_fire: Bool, double_damage: Bool, env_control: Bool,
  shield_timer: Int, speed_boost_timer: Int, rapid_fire_timer: Int, double_damage_timer: Int, env_control_timer: Int
};

type World = {
  tick: Int, env: Environment, sub: Submarine, weapons: Weapons, proj: Projectiles, 
  enemies: Enemies, powerups: PowerUps, active_powerups: ActivePowerUps, 
  score: Int, kills: Int, mission: Mission, last_input: Input
};

effect IO { fn println(s: String); }

fn env_air() -> Environment = 0;
fn env_water() -> Environment = 1;
fn is_air(env: Environment) -> Bool = env == 0;
fn world_width() -> Int = 800;
fn world_height() -> Int = 600;
fn ground_y() -> Int = 520;

fn clamp(v: Int, lo: Int, hi: Int) -> Int = if v < lo { lo } else if v > hi { hi } else { v };
fn min(a: Int, b: Int) -> Int = if a < b { a } else { b };
fn max(a: Int, b: Int) -> Int = if a > b { a } else { b };
fn abs(v: Int) -> Int = if v < 0 { -v } else { v };

fn init_submarine() -> Submarine = { x: 400, y: 200, vx: 0, vy: 0, health: 100 };
fn init_weapons() -> Weapons = { torpedoes: 4, missiles: 6, depth_charges: 3, ammo: 200, cooldown: 0 };
fn init_projectile() -> Projectile = { x: 0, y: 0, vx: 0, vy: 0, active: false };
fn init_enemy() -> Enemy = { x: 0, y: 0, health: 0, active: false };
fn zero_input() -> Input = { thrust_x: 0, thrust_y: 0, fire: false, fire_alt: false, toggle_env: false };

fn init_powerup() -> PowerUp = { x: 0, y: 0, powerup_type: 0, active: false, duration: 0, spawn_tick: 0 };

fn init_active_powerups() -> ActivePowerUps = {
  shield: false, speed_boost: false, rapid_fire: false, double_damage: false, env_control: false,
  shield_timer: 0, speed_boost_timer: 0, rapid_fire_timer: 0, double_damage_timer: 0, env_control_timer: 0
};

fn init_mission() -> Mission = { id: 1, objective: { kills_needed: 4, max_ticks: 360, completed: false, failed: false } };

fn init_world() -> World = {
  tick: 0, env: env_air(), sub: init_submarine(), weapons: init_weapons(),
  proj: { a: init_projectile(), b: init_projectile() },
  enemies: { a: init_enemy(), b: init_enemy() },
  powerups: { a: init_powerup(), b: init_powerup(), c: init_powerup() },
  active_powerups: init_active_powerups(),
  score: 0, kills: 0, mission: init_mission(), last_input: zero_input()
};

fn spawn_powerup(world: World, tick: Int) -> World = {
  if world.powerups.a.active && world.powerups.b.active && world.powerups.c.active {
    world
  } else if tick % 20 == 0 && tick % 100 < 5 {
    if !world.powerups.a.active {
      spawn_in_slot(world, "a", tick)
    } else if !world.powerups.b.active {
      spawn_in_slot(world, "b", tick)
    } else {
      spawn_in_slot(world, "c", tick)
    }
  } else {
    world
  }
};

fn spawn_in_slot(world: World, slot: String, tick: Int) -> World = {
  let x = 850;
  let y = 150;
  let powerup_type = POWERUP_HEALTH_PACK();
  let duration = 0;
  let new_powerup = { x, y, powerup_type, active: true, duration, spawn_tick: tick };
  
  if slot == "a" {
    { ...world, powerups: { ...world.powerups, a: new_powerup } }
  } else if slot == "b" {
    { ...world, powerups: { ...world.powerups, b: new_powerup } }
  } else {
    { ...world, powerups: { ...world.powerups, c: new_powerup } }
  }
};

fn check_powerup_collision(world: World, sub: Submarine) -> World = {
  let check_single = (w: World, slot: String) -> World = {
    let pu = if slot == "a" { w.powerups.a } else if slot == "b" { w.powerups.b } else { w.powerups.c };
    if !pu.active { w } else {
      let dx = abs(pu.x - sub.x);
      let dy = abs(pu.y - sub.y);
      if dx < 20 && dy < 20 {
        apply_powerup_effect(w, slot, pu.powerup_type)
      } else {
        w
      }
    }
  };
  
  world
  |> check_single("a")
  |> check_single("b")
  |> check_single("c")
};

fn apply_powerup_effect(world: World, slot: String, powerup_type: PowerUpType) -> World = {
  let deactivate = (w: World) -> World = {
    if slot == "a" {
      { ...w, powerups: { ...w.powerups, a: { ...w.powerups.a, active: false } } }
    } else if slot == "b" {
      { ...w, powerups: { ...w.powerups, b: { ...w.powerups.b, active: false } } }
    } else {
      { ...w, powerups: { ...w.powerups, c: { ...w.powerups.c, active: false } } }
    }
  };
  
  if powerup_type == POWERUP_HEALTH_PACK() {
    let new_health = min(world.sub.health + 25, 100);
    let new_sub = { ...world.sub, health: new_health };
    deactivate({ ...world, sub: new_sub })
  } else {
    deactivate(world)
  }
};

fn apply_active_powerups(world: World) -> World = {
  if world.active_powerups.speed_boost {
    let vx = world.sub.vx * 2;
    let vy = world.sub.vy * 2;
    let new_vx = clamp(vx, -20, 20);
    let new_vy = clamp(vy, -20, 20);
    let new_sub = { ...world.sub, vx: new_vx, vy: new_vy };
    { ...world, sub: new_sub }
  } else {
    world
  }
};

fn update_powerup_timers(world: World) -> World = {
  let shield = world.active_powerups.shield && world.active_powerups.shield_timer > 1;
  let new_timers = {
    shield_timer: if shield { world.active_powerups.shield_timer - 1 } else { 0 },
    speed_boost_timer: if world.active_powerups.speed_boost { world.active_powerups.speed_boost_timer - 1 } else { 0 },
    rapid_fire_timer: if world.active_powerups.rapid_fire { world.active_powerups.rapid_fire_timer - 1 } else { 0 },
    double_damage_timer: if world.active_powerups.double_damage { world.active_powerups.double_damage_timer - 1 } else { 0 },
    env_control_timer: if world.active_powerups.env_control { world.active_powerups.env_control_timer - 1 } else { 0 }
  };
  
  { ...world, active_powerups: { 
    ...world.active_powerups,
    shield: shield,
    ...new_timers
  } }
};

fn step(world: World, input: Input) -> World = {
  let t = world.tick + 1;
  
  // Game loop with power-ups
  world
  |> spawn_powerup(t)
  |> apply_active_powerups
  |> update_powerup_timers
  |> (fun w -> check_powerup_collision(w, w.sub))
  // Note: This is a simplified version focusing on power-ups
  // Full game would include environment, enemies, projectiles, etc.
  |> (fun w -> { ...w, tick: t })
};

fn main() -> Int = {
  let world = init_world();
  let world2 = step(world, zero_input());
  // Return a simple success code
  world2.tick
};