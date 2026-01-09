--  =================================================================
--  Game Package Specification
--  =================================================================
--
--  Core game engine and main game loop
--
--  Type-Safe: All operations use strong Ada typing
--  Memory-Safe: No unsafe operations, SPARK-verified
--  Offline-First: No network dependencies
--  =================================================================

package Game with
   SPARK_Mode => On
is

   --  Game configuration constants
   Screen_Width  : constant := 800;
   Screen_Height : constant := 600;
   Target_FPS    : constant := 60;

   --  Game state type
   type Game_State is (Menu, Playing, Paused, Game_Over);

   --  Initialize and run the game
   procedure Run with
      Global => null,
      Depends => null;

private

   --  Frame delta time in milliseconds
   subtype Delta_Time_Ms is Natural range 0 .. 1000;

end Game;
