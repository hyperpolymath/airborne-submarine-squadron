// Test file to isolate type definition issues
type Environment = Int;

type Submarine = { x: Int, y: Int, vx: Int, vy: Int, health: Int };

// Test simple type
type SimpleType = A | B | C;

// Test the power-up type
type PowerUpType = HealthPack | AmmoRefill | Shield | SpeedBoost | RapidFire | DoubleDamage | EnvironmentControl;

type PowerUp = {
  x: Int, y: Int,
  powerup_type: PowerUpType,
  active: Bool,
  duration: Int,
  spawn_tick: Int
};

fn init_world() -> Int {
  return 42;
}

fn main() -> Int {
  return init_world();
}