--  =================================================================
--  Enemies Package Specification
--  =================================================================
--
--  Manages enemy entities: aircraft, submarines, ships, creatures
--
--  Type-Safe: Enumeration-based enemy types
--  Memory-Safe: Bounded arrays, SPARK-verified
--  =================================================================

with Submarine;

package Enemies with
   SPARK_Mode => On
is

   --  Maximum concurrent enemies
   Max_Enemies : constant := 50;

   --  Enemy types
   type Enemy_Type is (
      Fighter_Plane,    --  Air enemy
      Enemy_Sub,        --  Underwater enemy
      Surface_Ship,     --  Surface vessel
      Sea_Creature,     --  Underwater creature
      Bomber            --  Heavy air enemy
   );

   --  Enemy state (includes Exploding for explosion animation)
   type Enemy_State is (Inactive, Patrolling, Attacking, Fleeing, Exploding, Destroyed);

   --  Explosion animation frame (for visual feedback)
   subtype Explosion_Frame is Natural range 0 .. 5;

   --  Enemy entity (private)
   type Enemy_Entity is private;

   --  Enemy array
   type Enemy_Index is range 1 .. Max_Enemies;
   type Enemy_Array is array (Enemy_Index) of Enemy_Entity;

   --  Enemy management system
   type Enemy_System is private;

   --  Initialize enemy system
   function Create return Enemy_System;

   --  Spawn enemy at position
   procedure Spawn
      (System       : in Out Enemy_System;
       Enemy_Type_Val : Enemy_Type;
       X            : Submarine.Coordinate;
       Y            : Submarine.Coordinate);

   --  Update all enemies (including explosion animations)
   procedure Update_All
      (System  : in Out Enemy_System;
       Delta_T : Natural)
   with
      Pre => Delta_T > 0 and Delta_T <= 1000;

   --  Get active enemy count (excludes exploding/destroyed)
   function Active_Count (System : Enemy_System) return Natural;

   --  Get exploding enemy count (for sound/visual effects)
   function Exploding_Count (System : Enemy_System) return Natural;

   --  Destroy enemy at index (triggers explosion animation)
   procedure Destroy
      (System : in Out Enemy_System;
       Index  : Enemy_Index);

   --  Get enemy state at index
   function Get_State
      (System : Enemy_System;
       Index  : Enemy_Index) return Enemy_State;

   --  Get explosion frame for enemy (for rendering)
   function Get_Explosion_Frame
      (System : Enemy_System;
       Index  : Enemy_Index) return Explosion_Frame;

   --  Check if enemy position is valid (for collision detection)
   function Get_Position
      (System : Enemy_System;
       Index  : Enemy_Index;
       X      : out Submarine.Coordinate;
       Y      : out Submarine.Coordinate) return Boolean;

private

   --  Enemy health by type
   Fighter_Health   : constant := 25;
   Sub_Health       : constant := 50;
   Ship_Health      : constant := 75;
   Creature_Health  : constant := 30;
   Bomber_Health    : constant := 60;

   --  Explosion duration per frame (milliseconds)
   Explosion_Frame_Duration : constant := 100;

   --  Enemy implementation
   type Enemy_Entity is record
      State            : Enemy_State := Inactive;
      Enemy_Type       : Enemy_Type := Fighter_Plane;
      X                : Submarine.Coordinate := 0;
      Y                : Submarine.Coordinate := 0;
      VX               : Submarine.Velocity := 0;
      VY               : Submarine.Velocity := 0;
      Health           : Submarine.Health_Points := 100;
      AI_Timer         : Natural := 0;  --  AI decision timer
      Explosion_Timer  : Natural := 0;  --  Time in explosion state (ms)
      Current_Frame    : Explosion_Frame := 0;  --  Current explosion frame
   end record;

   --  Enemy system implementation
   type Enemy_System is record
      Enemies : Enemy_Array;
   end record;

end Enemies;
