--  =================================================================
--  Submarine Package Implementation
--  =================================================================

package body Submarine with
   SPARK_Mode => On
is

   --  Create a new submarine
   function Create
      (X    : Coordinate;
       Y    : Coordinate;
       Name : String)
      return Submarine_Type
   is
      Sub : Submarine_Type;
   begin
      Sub.X := X;
      Sub.Y := Y;
      Sub.VX := 0;
      Sub.VY := 0;
      Sub.Health := 100;
      Sub.Name_Len := Name'Length;

      --  Copy name to buffer
      for I in 1 .. Name'Length loop
         Sub.Name (I) := Name (Name'First + I - 1);
      end loop;

      return Sub;
   end Create;

   --  Update submarine physics
   procedure Update
      (Sub     : in out Submarine_Type;
       Delta_T : Natural)
   is
      --  Scale factor for delta time (16ms = 1.0)
      DT_Scale : constant Float := Float (Delta_T) / 16.0;

      --  Calculate new positions
      New_X : constant Integer := Sub.X + Integer (Float (Sub.VX) * DT_Scale);
      New_Y : constant Integer := Sub.Y + Integer (Float (Sub.VY) * DT_Scale);
   begin
      --  Update position with bounds checking
      if New_X in Coordinate'Range then
         Sub.X := New_X;
      end if;

      if New_Y in Coordinate'Range then
         Sub.Y := New_Y;
      end if;

      --  Apply simple gravity (positive Y is down)
      if Sub.VY < Velocity'Last then
         Sub.VY := Sub.VY + 1;
      end if;
   end Update;

   --  Position getters
   function Get_X (Sub : Submarine_Type) return Coordinate is (Sub.X);
   function Get_Y (Sub : Submarine_Type) return Coordinate is (Sub.Y);

   --  Velocity getters
   function Get_VX (Sub : Submarine_Type) return Velocity is (Sub.VX);
   function Get_VY (Sub : Submarine_Type) return Velocity is (Sub.VY);

   --  Health
   function Get_Health (Sub : Submarine_Type) return Health_Points is (Sub.Health);

   procedure Take_Damage
      (Sub    : in out Submarine_Type;
       Amount : Health_Points)
   is
   begin
      if Sub.Health > Amount then
         Sub.Health := Sub.Health - Amount;
      else
         Sub.Health := 0;
      end if;
   end Take_Damage;

   --  Name
   function Get_Name (Sub : Submarine_Type) return String is
      (String (Sub.Name (1 .. Sub.Name_Len)));

   --  Apply buoyancy (water environment)
   procedure Apply_Buoyancy (Sub : in out Submarine_Type) is
   begin
      --  Slow down vertical velocity (buoyancy effect)
      if Sub.VY > 0 then
         Sub.VY := Sub.VY / 2;
      end if;
   end Apply_Buoyancy;

   --  Apply aerodynamics (air environment)
   procedure Apply_Aerodynamics (Sub : in out Submarine_Type) is
   begin
      --  Apply air drag to horizontal velocity (reduces speed over time)
      --  Air has less drag than water, so the effect is subtle
      if Sub.VX > 1 then
         Sub.VX := Sub.VX - 1;  --  Gradual slowdown
      elsif Sub.VX < -1 then
         Sub.VX := Sub.VX + 1;  --  Gradual slowdown
      end if;

      --  In air, gravity accelerates faster than in water
      --  Add extra gravity effect (complements Update's gravity)
      if Sub.VY < Velocity'Last - 1 then
         Sub.VY := Sub.VY + 1;  --  Extra gravity in air
      end if;
   end Apply_Aerodynamics;

end Submarine;
