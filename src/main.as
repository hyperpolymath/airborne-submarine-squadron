// Airborne Submarine Squadron (AffineScript)
// WASM-first rewrite: core model + deterministic tick + input/collision/HUD

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

type World = {
  tick: Int,
  env: Environment,
  sub: Submarine,
  weapons: Weapons,
  proj: Projectiles,
  enemies: Enemies,
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
    score: 0,
    kills: 0,
    mission: init_mission(),
    last_input: zero_input()
  };
}

fn apply_gravity(env: Environment, vy: Int) -> Int {
  if is_air(env) {
    return vy + 1;
  } else {
    return vy - 1;
  };
}

fn clamp_velocity(v: Int) -> Int {
  if v > 100 {
    return 100;
  } else if v < -100 {
    return -100;
  } else {
    return v;
  };
}

fn apply_drag(env: Environment, v: Int) -> Int {
  if is_air(env) {
    if v > 0 {
      return v - 1;
    } else if v < 0 {
      return v + 1;
    } else {
      return v;
    };
  } else {
    if v > 0 {
      return v - 2;
    } else if v < 0 {
      return v + 2;
    } else {
      return v;
    };
  };
}

fn apply_input(sub: Submarine, input: Input) -> Submarine {
  let vx2 = clamp_velocity(sub.vx + input.thrust_x);
  let vy2 = clamp_velocity(sub.vy + input.thrust_y);
  return { x: sub.x, y: sub.y, vx: vx2, vy: vy2, health: sub.health };
}

fn integrate(sub: Submarine, env: Environment) -> Submarine {
  let vy2 = clamp_velocity(apply_gravity(env, sub.vy));
  let vx2 = clamp_velocity(sub.vx);
  let vx3 = apply_drag(env, vx2);
  let vy3 = apply_drag(env, vy2);
  return { x: sub.x + vx3, y: sub.y + vy3, vx: vx3, vy: vy3, health: sub.health };
}

fn apply_bounds(sub: Submarine) -> Submarine {
  let x2 = clamp(sub.x, 0, world_width());
  let y2 = clamp(sub.y, 0, ground_y());
  return { x: x2, y: y2, vx: sub.vx, vy: sub.vy, health: sub.health };
}

fn toggle_env(env: Environment, tick: Int, requested: Bool) -> Environment {
  if requested {
    if is_air(env) {
      return env_water();
    } else {
      return env_air();
    };
  } else if tick % 120 == 0 {
    if is_air(env) {
      return env_water();
    } else {
      return env_air();
    };
  } else {
    return env;
  };
}

fn abs(v: Int) -> Int {
  if v < 0 {
    return -v;
  } else {
    return v;
  };
}

fn bool_to_int(b: Bool) -> Int {
  if b {
    return 1;
  } else {
    return 0;
  };
}

fn int_to_bool(v: Int) -> Bool {
  return v != 0;
}

fn spawn_enemy(enemy: Enemy, tick: Int, modv: Int, x: Int, y: Int) -> Enemy {
  if enemy.active {
    return enemy;
  } else if tick % modv == 1 {
    return { x: x, y: y, health: 50, active: true };
  } else {
    return enemy;
  };
}

fn enemy_drift(env: Environment, tick: Int) -> Int {
  let period = 90;
  let phase = tick % period;
  if phase < (period / 2) {
    return 1;
  } else {
    return -1;
  };
}

fn step_enemy(enemy: Enemy, env: Environment, tick: Int) -> Enemy {
  if enemy.active {
    let speed = if is_air(env) { 2; } else { 1; };
    let drift = enemy_drift(env, tick);
    let nx = enemy.x - speed;
    let ny = clamp(enemy.y + drift, 40, ground_y() - 20);
    if nx < -20 {
      return { x: nx, y: ny, health: enemy.health, active: false };
    } else {
      return { x: nx, y: ny, health: enemy.health, active: true };
    };
  } else {
    return enemy;
  };
}

fn step_projectile(proj: Projectile) -> Projectile {
  if proj.active {
    let nx = proj.x + proj.vx;
    let ny = proj.y + proj.vy;
    if nx < -20 || nx > world_width() + 20 || ny < -20 || ny > ground_y() + 40 {
      return { x: nx, y: ny, vx: proj.vx, vy: proj.vy, active: false };
    } else {
      return { x: nx, y: ny, vx: proj.vx, vy: proj.vy, active: true };
    };
  } else {
    return proj;
  };
}

fn weapons_cooldown(weapons: Weapons) -> Weapons {
  if weapons.cooldown > 0 {
    return {
      torpedoes: weapons.torpedoes,
      missiles: weapons.missiles,
      depth_charges: weapons.depth_charges,
      ammo: weapons.ammo,
      cooldown: weapons.cooldown - 1
    };
  } else {
    return weapons;
  };
}

fn try_fire(sub: Submarine, weapons: Weapons, proj: Projectile, want: Bool) -> (Weapons, Projectile) {
  if want && weapons.cooldown == 0 && weapons.ammo > 0 && !proj.active {
    let p = { x: sub.x + 10, y: sub.y, vx: 7, vy: 0, active: true };
    let w = {
      torpedoes: weapons.torpedoes,
      missiles: weapons.missiles,
      depth_charges: weapons.depth_charges,
      ammo: weapons.ammo - 1,
      cooldown: 8
    };
    return (w, p);
  } else {
    return (weapons, proj);
  };
}

fn check_collision(enemy: Enemy, proj: Projectile) -> (Enemy, Projectile) {
  let mut out_enemy = enemy;
  let mut out_proj = proj;
  if enemy.active && proj.active {
    let dx = abs(enemy.x - proj.x);
    let dy = abs(enemy.y - proj.y);
    if dx < 6 && dy < 6 {
      let new_health = enemy.health - 25;
      out_proj = { x: proj.x, y: proj.y, vx: proj.vx, vy: proj.vy, active: false };
      if new_health <= 0 {
        out_enemy = { x: enemy.x, y: enemy.y, health: 0, active: false };
      } else {
        out_enemy = { x: enemy.x, y: enemy.y, health: new_health, active: true };
      };
    };
  };
  return (out_enemy, out_proj);
}

fn check_sub_collision(enemy: Enemy, sub: Submarine) -> (Enemy, Submarine, Bool) {
  if enemy.active {
    let dx = abs(enemy.x - sub.x);
    let dy = abs(enemy.y - sub.y);
    if dx < 10 && dy < 10 {
      let new_health = sub.health - 15;
      let next_sub = { x: sub.x, y: sub.y, vx: sub.vx, vy: sub.vy, health: new_health };
      let next_enemy = { x: enemy.x, y: enemy.y, health: enemy.health, active: false };
      return (next_enemy, next_sub, true);
    } else {
      return (enemy, sub, false);
    };
  } else {
    return (enemy, sub, false);
  };
}

fn thrust_for(tick: Int, period: Int) -> Int {
  if tick % period < (period / 2) {
    return 1;
  } else {
    return -1;
  };
}

fn sample_input(tick: Int) -> Input {
  let thrust_x = thrust_for(tick, 36);
  let thrust_y = thrust_for(tick, 54);
  return {
    thrust_x: thrust_x,
    thrust_y: thrust_y,
    fire: tick % 30 == 0,
    fire_alt: tick % 45 == 0,
    toggle_env: tick % 200 == 0
  };
}

fn score_kill(prev: Enemy, next: Enemy) -> Int {
  if prev.active && !next.active && next.health <= 0 {
    return 100;
  } else {
    return 0;
  };
}

fn kill_count(prev: Enemy, next: Enemy) -> Int {
  if prev.active && !next.active && next.health <= 0 {
    return 1;
  } else {
    return 0;
  };
}

fn update_objective(obj: Objective, kills: Int, tick: Int) -> Objective {
  if obj.completed || obj.failed {
    return obj;
  } else if kills >= obj.kills_needed {
    return { kills_needed: obj.kills_needed, max_ticks: obj.max_ticks, completed: true, failed: false };
  } else if tick > obj.max_ticks {
    return { kills_needed: obj.kills_needed, max_ticks: obj.max_ticks, completed: false, failed: true };
  } else {
    return obj;
  };
}

fn update_objective_with_health(obj: Objective, sub: Submarine) -> Objective {
  if obj.completed || obj.failed {
    return obj;
  } else if sub.health <= 0 {
    return { kills_needed: obj.kills_needed, max_ticks: obj.max_ticks, completed: false, failed: true };
  } else {
    return obj;
  };
}

fn build_snapshot(
  tick: Int,
  env: Environment,
  sub_x: Int,
  sub_y: Int,
  sub_vx: Int,
  sub_vy: Int,
  sub_health: Int,
  ammo: Int,
  cooldown: Int,
  proj_a_active: Bool,
  proj_a_x: Int,
  proj_a_y: Int,
  proj_b_active: Bool,
  proj_b_x: Int,
  proj_b_y: Int,
  enemy_a_active: Bool,
  enemy_a_x: Int,
  enemy_a_y: Int,
  enemy_a_health: Int,
  enemy_b_active: Bool,
  enemy_b_x: Int,
  enemy_b_y: Int,
  enemy_b_health: Int,
  score: Int,
  kills: Int,
  mission_kills: Int,
  mission_ticks: Int,
  mission_complete: Bool,
  mission_failed: Bool
) -> Int {
  return [
    29,
    tick,
    env,
    sub_x,
    sub_y,
    sub_vx,
    sub_vy,
    sub_health,
    ammo,
    cooldown,
    bool_to_int(proj_a_active),
    proj_a_x,
    proj_a_y,
    bool_to_int(proj_b_active),
    proj_b_x,
    proj_b_y,
    bool_to_int(enemy_a_active),
    enemy_a_x,
    enemy_a_y,
    enemy_a_health,
    bool_to_int(enemy_b_active),
    enemy_b_x,
    enemy_b_y,
    enemy_b_health,
    score,
    kills,
    mission_kills,
    mission_ticks,
    bool_to_int(mission_complete),
    bool_to_int(mission_failed)
  ];
}

fn world_from_parts(
  tick: Int,
  env: Environment,
  sub_x: Int,
  sub_y: Int,
  sub_vx: Int,
  sub_vy: Int,
  sub_health: Int,
  ammo: Int,
  cooldown: Int,
  proj_a_active: Int,
  proj_a_x: Int,
  proj_a_y: Int,
  proj_b_active: Int,
  proj_b_x: Int,
  proj_b_y: Int,
  enemy_a_active: Int,
  enemy_a_x: Int,
  enemy_a_y: Int,
  enemy_a_health: Int,
  enemy_b_active: Int,
  enemy_b_x: Int,
  enemy_b_y: Int,
  enemy_b_health: Int,
  score: Int,
  kills: Int,
  mission_kills: Int,
  mission_ticks: Int,
  mission_complete: Int,
  mission_failed: Int
) -> World {
  return {
    tick: tick,
    env: env,
    sub: { x: sub_x, y: sub_y, vx: sub_vx, vy: sub_vy, health: sub_health },
    weapons: { torpedoes: 0, missiles: 0, depth_charges: 0, ammo: ammo, cooldown: cooldown },
    proj: {
      a: { x: proj_a_x, y: proj_a_y, vx: 0, vy: 0, active: int_to_bool(proj_a_active) },
      b: { x: proj_b_x, y: proj_b_y, vx: 0, vy: 0, active: int_to_bool(proj_b_active) }
    },
    enemies: {
      a: { x: enemy_a_x, y: enemy_a_y, health: enemy_a_health, active: int_to_bool(enemy_a_active) },
      b: { x: enemy_b_x, y: enemy_b_y, health: enemy_b_health, active: int_to_bool(enemy_b_active) }
    },
    score: score,
    kills: kills,
    mission: {
      id: 1,
      objective: {
        kills_needed: mission_kills,
        max_ticks: mission_ticks,
        completed: int_to_bool(mission_complete),
        failed: int_to_bool(mission_failed)
      }
    },
    last_input: zero_input()
  };
}

fn step(world: World, input: Input) -> World {
  let t = world.tick + 1;
  let env2 = toggle_env(world.env, t, input.toggle_env);
  let sub1 = apply_input(world.sub, input);
  let sub2 = apply_bounds(integrate(sub1, env2));
  let weapons2 = weapons_cooldown(world.weapons);

  let fired_a = try_fire(sub2, weapons2, world.proj.a, input.fire);
  let weapons3 = fired_a.0;
  let proj_a1 = fired_a.1;

  let fired_b = try_fire(sub2, weapons3, world.proj.b, input.fire_alt);
  let weapons4 = fired_b.0;
  let proj_b1 = fired_b.1;

  let proj_a2 = step_projectile(proj_a1);
  let proj_b2 = step_projectile(proj_b1);

  let enemy_a1 = spawn_enemy(world.enemies.a, t, 140, 760, 220);
  let enemy_b1 = spawn_enemy(world.enemies.b, t, 190, 740, 280);

  let enemy_a2 = step_enemy(enemy_a1, env2, t);
  let enemy_b2 = step_enemy(enemy_b1, env2, t);

  let col_a1 = check_collision(enemy_a2, proj_a2);
  let enemy_a3 = col_a1.0;
  let proj_a3 = col_a1.1;
  let col_a2 = check_collision(enemy_a3, proj_b2);
  let enemy_a4 = col_a2.0;
  let proj_b3 = col_a2.1;

  let col_b1 = check_collision(enemy_b2, proj_a3);
  let enemy_b3 = col_b1.0;
  let proj_a4 = col_b1.1;
  let col_b2 = check_collision(enemy_b3, proj_b3);
  let enemy_b4 = col_b2.0;
  let proj_b4 = col_b2.1;

  let sub_col_a = check_sub_collision(enemy_a4, sub2);
  let enemy_a5 = sub_col_a.0;
  let sub3 = sub_col_a.1;
  let sub_col_b = check_sub_collision(enemy_b4, sub3);
  let enemy_b5 = sub_col_b.0;
  let sub4 = sub_col_b.1;

  let kills_gain =
    kill_count(enemy_a2, enemy_a4) +
    kill_count(enemy_b2, enemy_b4) +
    (if sub_col_a.2 { 1; } else { 0; }) +
    (if sub_col_b.2 { 1; } else { 0; });

  let score_gain =
    score_kill(enemy_a2, enemy_a4) +
    score_kill(enemy_b2, enemy_b4);

  let new_kills = world.kills + kills_gain;
  let obj1 = update_objective(world.mission.objective, new_kills, t);
  let new_obj = update_objective_with_health(obj1, sub4);

  return {
    tick: t,
    env: env2,
    sub: sub4,
    weapons: weapons4,
    proj: { a: proj_a4, b: proj_b4 },
    enemies: { a: enemy_a5, b: enemy_b5 },
    score: world.score + score_gain,
    kills: new_kills,
    mission: { id: world.mission.id, objective: new_obj },
    last_input: input
  };
}

fn run_steps(world: World, remaining: Int) -> World {
  let mut w = world;
  let mut r = remaining;
  while r > 0 {
    if w.mission.objective.completed || w.mission.objective.failed {
      r = 0;
    } else {
      let input = sample_input(w.tick + 1);
      w = step(w, input);
      r = r - 1;
    };
  }
  return w;
}

fn run_mission(world: World) -> World {
  return run_steps(world, world.mission.objective.max_ticks);
}

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

fn step_state(
  tick: Int,
  env: Int,
  sub_x: Int,
  sub_y: Int,
  sub_vx: Int,
  sub_vy: Int,
  sub_health: Int,
  ammo: Int,
  cooldown: Int,
  proj_a_active: Int,
  proj_a_x: Int,
  proj_a_y: Int,
  proj_b_active: Int,
  proj_b_x: Int,
  proj_b_y: Int,
  enemy_a_active: Int,
  enemy_a_x: Int,
  enemy_a_y: Int,
  enemy_a_health: Int,
  enemy_b_active: Int,
  enemy_b_x: Int,
  enemy_b_y: Int,
  enemy_b_health: Int,
  score: Int,
  kills: Int,
  mission_kills: Int,
  mission_ticks: Int,
  mission_complete: Int,
  mission_failed: Int,
  thrust_x: Int,
  thrust_y: Int,
  fire: Int,
  fire_alt: Int,
  toggle_env: Int
) -> Int {
  let world = world_from_parts(
    tick,
    env,
    sub_x,
    sub_y,
    sub_vx,
    sub_vy,
    sub_health,
    ammo,
    cooldown,
    proj_a_active,
    proj_a_x,
    proj_a_y,
    proj_b_active,
    proj_b_x,
    proj_b_y,
    enemy_a_active,
    enemy_a_x,
    enemy_a_y,
    enemy_a_health,
    enemy_b_active,
    enemy_b_x,
    enemy_b_y,
    enemy_b_health,
    score,
    kills,
    mission_kills,
    mission_ticks,
    mission_complete,
    mission_failed
  );
  let input = {
    thrust_x: thrust_x,
    thrust_y: thrust_y,
    fire: int_to_bool(fire),
    fire_alt: int_to_bool(fire_alt),
    toggle_env: int_to_bool(toggle_env)
  };
  let world_input = {
    thrust_x: thrust_x,
    thrust_y: thrust_y,
    fire: int_to_bool(fire),
    fire_alt: int_to_bool(fire_alt),
    toggle_env: int_to_bool(toggle_env)
  };
  let updated = step(world, world_input);
  return build_snapshot(
    updated.tick,
    updated.env,
    updated.sub.x,
    updated.sub.y,
    updated.sub.vx,
    updated.sub.vy,
    updated.sub.health,
    updated.weapons.ammo,
    updated.weapons.cooldown,
    bool_to_int(updated.proj.a.active),
    updated.proj.a.x,
    updated.proj.a.y,
    bool_to_int(updated.proj.b.active),
    updated.proj.b.x,
    updated.proj.b.y,
    bool_to_int(updated.enemies.a.active),
    updated.enemies.a.x,
    updated.enemies.a.y,
    updated.enemies.a.health,
    bool_to_int(updated.enemies.b.active),
    updated.enemies.b.x,
    updated.enemies.b.y,
    updated.enemies.b.health,
    updated.score,
    updated.kills,
    updated.mission.objective.kills_needed,
    updated.mission.objective.max_ticks,
    bool_to_int(updated.mission.objective.completed),
    bool_to_int(updated.mission.objective.failed)
  );
}

fn hud(world: World) -> () -{ IO }-> () {
  if is_air(world.env) {
    println("ENV: AIR");
  } else {
    println("ENV: WATER");
  };

  if world.enemies.a.active || world.enemies.b.active {
    println("ENEMIES: ACTIVE");
  } else {
    println("ENEMIES: NONE");
  };

  if world.proj.a.active || world.proj.b.active {
    println("PROJECTILES: ACTIVE");
  } else {
    println("PROJECTILES: NONE");
  };

  if world.mission.objective.completed {
    println("MISSION: COMPLETE");
  } else if world.mission.objective.failed {
    println("MISSION: FAILED");
  } else {
    println("MISSION: ACTIVE");
  };
}

fn debug_main() -> () -{ IO }-> () {
  println("Airborne Submarine Squadron (AffineScript)");
  println("WASM-first rewrite: core model booting...");
  let world = init_world();
  let world2 = run_steps(world, 10);
  hud(world2);
  println("OK");
}

fn main() -> Int {
  let world = init_world();
  let world2 = run_mission(world);
  let ptr = build_snapshot(
    world2.tick,
    world2.env,
    world2.sub.x,
    world2.sub.y,
    world2.sub.vx,
    world2.sub.vy,
    world2.sub.health,
    world2.weapons.ammo,
    world2.weapons.cooldown,
    world2.proj.a.active,
    world2.proj.a.x,
    world2.proj.a.y,
    world2.proj.b.active,
    world2.proj.b.x,
    world2.proj.b.y,
    world2.enemies.a.active,
    world2.enemies.a.x,
    world2.enemies.a.y,
    world2.enemies.a.health,
    world2.enemies.b.active,
    world2.enemies.b.x,
    world2.enemies.b.y,
    world2.enemies.b.health,
    world2.score,
    world2.kills,
    world2.mission.objective.kills_needed,
    world2.mission.objective.max_ticks,
    world2.mission.objective.completed,
    world2.mission.objective.failed
  );
  return ptr;
}
