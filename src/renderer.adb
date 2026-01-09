--  =================================================================
--  Renderer Package Implementation
--  =================================================================

with Ada.Text_IO;

package body Renderer with
   SPARK_Mode => On
is

   procedure Render_Status
      (Sub     : Submarine.Submarine_Type;
       Env     : Environment.Environment_Type;
       Seconds : Natural)
   is
      use Ada.Text_IO;
   begin
      Put_Line ("+------------------------------------------+");
      Put_Line ("| Airborne Submarine Squadron - Status HUD |");
      Put_Line ("+------------------------------------------+");
      Put ("║  Time: ");
      Put (Natural'Image (Seconds));
      Put_Line ("s");
      Put ("║  Submarine: ");
      Put (Submarine.Get_Name (Sub));
      New_Line;
      Put ("║  Position: (");
      Put (Submarine.Coordinate'Image (Submarine.Get_X (Sub)));
      Put (", ");
      Put (Submarine.Coordinate'Image (Submarine.Get_Y (Sub)));
      Put_Line (")");
      Put ("║  Velocity: (");
      Put (Submarine.Velocity'Image (Submarine.Get_VX (Sub)));
      Put (", ");
      Put (Submarine.Velocity'Image (Submarine.Get_VY (Sub)));
      Put_Line (")");
      Put ("║  Health: ");
      Put (Submarine.Health_Points'Image (Submarine.Get_Health (Sub)));
      Put_Line ("/100");
      Put ("║  Environment: ");
      Put (Environment.To_String (Env));
      New_Line;
      Put_Line ("+------------------------------------------+");
      New_Line;
   end Render_Status;

end Renderer;
