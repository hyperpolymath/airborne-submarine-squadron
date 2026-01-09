--  =================================================================
--  Enemies Package Implementation
--  =================================================================
--
--  Full enemy system with AI, spawning, and explosion animations
--  =================================================================

with Ada.Text_IO;

package body Enemies with
   SPARK_Mode => On
is

   --  Initialize enemy system
   function Create return Enemy_System is
      System : Enemy_System;
   begin
      return System;
   end Create;

   --  Spawn enemy at position
   procedure Spawn
      (System       : in Out Enemy_System;
       Enemy_Type_Val : Enemy_Type;
       X            : Submarine.Coordinate;
       Y            : Submarine.Coordinate)
   is
   begin
      --  Find inactive slot
      for I in Enemy_Index loop
         if System.Enemies (I).State = Inactive or
            System.Enemies (I).State = Destroyed
         then
            System.Enemies (I).State := Patrolling;
            System.Enemies (I).Enemy_Type := Enemy_Type_Val;
            System.Enemies (I).X := X;
            System.Enemies (I).Y := Y;
            System.Enemies (I).Explosion_Timer := 0;
            System.Enemies (I).Current_Frame := 0;

            --  Set initial velocity and health based on type
            case Enemy_Type_Val is
               when Fighter_Plane =>
                  System.Enemies (I).VX := -30;
                  System.Enemies (I).VY := 0;
                  System.Enemies (I).Health := Fighter_Health;

               when Enemy_Sub =>
                  System.Enemies (I).VX := -20;
                  System.Enemies (I).VY := 5;
                  System.Enemies (I).Health := Sub_Health;

               when Surface_Ship =>
                  System.Enemies (I).VX := -15;
                  System.Enemies (I).VY := 0;
                  System.Enemies (I).Health := Ship_Health;

               when Sea_Creature =>
                  System.Enemies (I).VX := -25;
                  System.Enemies (I).VY := 10;
                  System.Enemies (I).Health := Creature_Health;

               when Bomber =>
                  System.Enemies (I).VX := -20;
                  System.Enemies (I).VY := 0;
                  System.Enemies (I).Health := Bomber_Health;
            end case;

            System.Enemies (I).AI_Timer := 0;
            exit;  --  Spawned, done
         end if;
      end loop;
   end Spawn;

   --  Update all enemies
   procedure Update_All
      (System  : in Out Enemy_System;
       Delta_T : Natural)
   is
   begin
      for I in Enemy_Index loop
         case System.Enemies (I).State is
            when Inactive | Destroyed =>
               --  No updates needed
               null;

            when Exploding =>
               --  Update explosion animation
               System.Enemies (I).Explosion_Timer :=
                  System.Enemies (I).Explosion_Timer + Delta_T;

               --  Calculate current frame
               declare
                  Frame : constant Natural :=
                     System.Enemies (I).Explosion_Timer / Explosion_Frame_Duration;
               begin
                  if Frame > Explosion_Frame'Last then
                     --  Explosion complete
                     System.Enemies (I).State := Destroyed;
                     System.Enemies (I).Current_Frame := 0;
                  else
                     System.Enemies (I).Current_Frame := Frame;
                  end if;
               end;

            when Patrolling | Attacking | Fleeing =>
               --  Update position
               declare
                  New_X : constant Integer :=
                     System.Enemies (I).X + System.Enemies (I).VX;
                  New_Y : constant Integer :=
                     System.Enemies (I).Y + System.Enemies (I).VY;
               begin
                  --  Check bounds
                  if New_X in Submarine.Coordinate'Range then
                     System.Enemies (I).X := New_X;
                  else
                     --  Enemy left screen, deactivate
                     System.Enemies (I).State := Inactive;
                  end if;

                  if New_Y in Submarine.Coordinate'Range then
                     System.Enemies (I).Y := New_Y;
                  else
                     System.Enemies (I).State := Inactive;
                  end if;
               end;

               --  Simple AI: Change direction occasionally
               if System.Enemies (I).AI_Timer > 2000 then
                  System.Enemies (I).VY := -System.Enemies (I).VY;
                  System.Enemies (I).AI_Timer := 0;
               else
                  System.Enemies (I).AI_Timer :=
                     System.Enemies (I).AI_Timer + Delta_T;
               end if;
         end case;
      end loop;
   end Update_All;

   --  Get active enemy count
   function Active_Count (System : Enemy_System) return Natural is
      Count : Natural := 0;
   begin
      for I in Enemy_Index loop
         if System.Enemies (I).State = Patrolling or
            System.Enemies (I).State = Attacking or
            System.Enemies (I).State = Fleeing
         then
            Count := Count + 1;
         end if;
      end loop;
      return Count;
   end Active_Count;

   --  Get exploding enemy count
   function Exploding_Count (System : Enemy_System) return Natural is
      Count : Natural := 0;
   begin
      for I in Enemy_Index loop
         if System.Enemies (I).State = Exploding then
            Count := Count + 1;
         end if;
      end loop;
      return Count;
   end Exploding_Count;

   --  Destroy enemy (trigger explosion animation)
   procedure Destroy
      (System : in Out Enemy_System;
       Index  : Enemy_Index)
   is
      use Ada.Text_IO;
   begin
      --  Only destroy active enemies
      if System.Enemies (Index).State = Patrolling or
         System.Enemies (Index).State = Attacking or
         System.Enemies (Index).State = Fleeing
      then
         --  Start explosion animation
         System.Enemies (Index).State := Exploding;
         System.Enemies (Index).Health := 0;
         System.Enemies (Index).Explosion_Timer := 0;
         System.Enemies (Index).Current_Frame := 0;

         --  Stop movement during explosion
         System.Enemies (Index).VX := 0;
         System.Enemies (Index).VY := 0;

         Put_Line ("[ENEMY] " & System.Enemies (Index).Enemy_Type'Image &
                   " destroyed at (" &
                   System.Enemies (Index).X'Image & "," &
                   System.Enemies (Index).Y'Image & ") - EXPLODING");
      end if;
   end Destroy;

   --  Get enemy state
   function Get_State
      (System : Enemy_System;
       Index  : Enemy_Index) return Enemy_State
   is
   begin
      return System.Enemies (Index).State;
   end Get_State;

   --  Get explosion frame
   function Get_Explosion_Frame
      (System : Enemy_System;
       Index  : Enemy_Index) return Explosion_Frame
   is
   begin
      return System.Enemies (Index).Current_Frame;
   end Get_Explosion_Frame;

   --  Get enemy position
   function Get_Position
      (System : Enemy_System;
       Index  : Enemy_Index;
       X      : out Submarine.Coordinate;
       Y      : out Submarine.Coordinate) return Boolean
   is
   begin
      if System.Enemies (Index).State = Inactive or
         System.Enemies (Index).State = Destroyed
      then
         X := 0;
         Y := 0;
         return False;
      end if;

      X := System.Enemies (Index).X;
      Y := System.Enemies (Index).Y;
      return True;
   end Get_Position;

end Enemies;
