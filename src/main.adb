--  =================================================================
--  Main Entry Point - Airborne Submarine Squadron
--  =================================================================
--
--  A 2D flying submarine game written in Ada 2022
--  RSR-Compliant | Type-Safe | Memory-Safe | Offline-First
--
--  Copyright (c) 2025 Airborne Submarine Squadron Contributors
--  Licensed under MIT + Palimpsest v0.8
--  =================================================================

with Ada.Text_IO;
with Game;

procedure Main is
   use Ada.Text_IO;
begin
   Put_Line ("=================================================");
   Put_Line ("  Airborne Submarine Squadron");
   Put_Line ("  Version 0.1.0");
   Put_Line ("  RSR-Compliant | Type-Safe | Memory-Safe");
   Put_Line ("=================================================");
   New_Line;

   --  Run the game
   Game.Run;

exception
   when others =>
      Put_Line ("Fatal error occurred. See logs for details.");
      raise;
end Main;
