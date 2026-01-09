--  =================================================================
--  Submarine Package Specification
--  =================================================================
--
--  Manages submarine entity: position, velocity, health, state
--
--  Type-Safe: Strong typing with range constraints
--  Memory-Safe: SPARK-verified, no pointers
--  =================================================================

package Submarine with
   SPARK_Mode => On
is

   --  Coordinate and velocity types
   subtype Coordinate is Integer range 0 .. 10_000;
   subtype Velocity is Integer range -100 .. 100;
   subtype Health_Points is Natural range 0 .. 100;

   --  Submarine state
   type Submarine_Type is private;

   --  Create a new submarine
   function Create
      (X    : Coordinate;
       Y    : Coordinate;
       Name : String)
      return Submarine_Type
   with
      Pre => Name'Length > 0 and Name'Length <= 64;

   --  Update submarine physics
   procedure Update
      (Sub     : in out Submarine_Type;
       Delta_T : Natural)
   with
      Pre => Delta_T > 0 and Delta_T <= 1000;

   --  Position getters
   function Get_X (Sub : Submarine_Type) return Coordinate;
   function Get_Y (Sub : Submarine_Type) return Coordinate;

   --  Velocity getters
   function Get_VX (Sub : Submarine_Type) return Velocity;
   function Get_VY (Sub : Submarine_Type) return Velocity;

   --  Health
   function Get_Health (Sub : Submarine_Type) return Health_Points;

   procedure Take_Damage
      (Sub    : in out Submarine_Type;
       Amount : Health_Points);

   --  Name
   function Get_Name (Sub : Submarine_Type) return String;

   --  Environment effects
   procedure Apply_Buoyancy (Sub : in out Submarine_Type);
   procedure Apply_Aerodynamics (Sub : in out Submarine_Type);

private

   --  Fixed-size name buffer
   Max_Name_Length : constant := 64;

   type Name_Buffer is array (1 .. Max_Name_Length) of Character;

   --  Submarine implementation
   type Submarine_Type is record
      X          : Coordinate := 0;
      Y          : Coordinate := 0;
      VX         : Velocity := 0;
      VY         : Velocity := 0;
      Health     : Health_Points := 100;
      Name       : Name_Buffer := [others => ' '];
      Name_Len   : Natural := 0;
   end record
   with
      Invariant =>
         Submarine_Type.Health <= 100 and
         Submarine_Type.Name_Len <= Max_Name_Length;

end Submarine;
