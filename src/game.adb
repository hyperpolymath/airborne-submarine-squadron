--  =================================================================
--  Game Package Implementation
--  =================================================================

with Ada.Text_IO;
with Submarine;
with Environment;
with Renderer;

package body Game with
   SPARK_Mode => On
is

   --  Game loop implementation
   procedure Run is
      use Ada.Text_IO;
      use type Environment.Environment_Type;

      Current_State : Game_State := Menu;
      Frame_Count   : Natural := 0;
      Running       : Boolean := True;

      --  Create submarine at starting position
      Player_Sub : Submarine.Submarine_Type :=
         Submarine.Create (
            X    => Screen_Width / 2,
            Y    => Screen_Height / 2,
            Name => "USS Freedom"
         );

      --  Current environment (starts in air)
      Current_Env : Environment.Environment_Type := Environment.Air;

   begin
      Put_Line ("Initializing game systems...");
      Put_Line ("  - Submarine: Initialized");
      Put_Line ("  - Environment: Air mode");
      Put_Line ("  - Physics: Active");
      New_Line;

      Put_Line ("Starting main game loop...");
      New_Line;

      --  Main game loop
      while Running and Frame_Count < 300 loop  --  Run for ~5 seconds at 60fps
         Frame_Count := Frame_Count + 1;

         case Current_State is
            when Menu =>
               --  Menu logic
               if Frame_Count = 1 then
                  Put_Line ("[MENU] Press Enter to start (auto-starting)");
                  Current_State := Playing;
               end if;

            when Playing =>
               --  Game logic
               declare
                  --  Simulate 16ms frame time (60 FPS)
                  DT : constant Delta_Time_Ms := 16;
               begin
                  --  Update submarine
                  Submarine.Update (Player_Sub, DT);

                  --  Check environment transitions
                  if Submarine.Get_Y (Player_Sub) > Screen_Height / 2 then
                     if Current_Env /= Environment.Water then
                        Current_Env := Environment.Water;
                        Put_Line ("[ENV] Transitioned to WATER");
                        Submarine.Apply_Buoyancy (Player_Sub);
                     end if;
                  else
                     if Current_Env /= Environment.Air then
                        Current_Env := Environment.Air;
                        Put_Line ("[ENV] Transitioned to AIR");
                        Submarine.Apply_Aerodynamics (Player_Sub);
                     end if;
                  end if;

                  --  Render (text-based for now)
                  if Frame_Count mod 60 = 0 then  --  Every second
                     Renderer.Render_Status (
                        Player_Sub,
                        Current_Env,
                        Frame_Count / 60
                     );
                  end if;

                  --  Check game over conditions
                  if Submarine.Get_Health (Player_Sub) = 0 then
                     Current_State := Game_Over;
                     Put_Line ("[GAME] Submarine destroyed!");
                  end if;
               end;

            when Paused =>
               null;  --  No updates while paused

            when Game_Over =>
               if Frame_Count mod 60 = 0 then
                  Put_Line ("[GAME OVER] Final Score: " &
                           Natural'Image (Frame_Count));
               end if;
               Running := False;
         end case;

         --  Simulate frame timing (in real game, this would be actual timing)
         delay 0.016;  --  ~60 FPS

      end loop;

      New_Line;
      Put_Line ("Game loop ended.");
      Put_Line ("Total frames: " & Natural'Image (Frame_Count));
      Put_Line ("Final submarine status:");
      Renderer.Render_Status (Player_Sub, Current_Env, Frame_Count / 60);

   end Run;

end Game;
