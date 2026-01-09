--  =================================================================
--  Sound Package Specification
--  =================================================================
--
--  Sound system: music, sound effects, crossfading, volume control
--
--  Type-Safe: Enumeration-based sound types with strong contracts
--  Memory-Safe: SPARK-verified, bounded data structures
--  =================================================================

package Sound with
   SPARK_Mode => On
is

   --  Volume range (0-100%)
   subtype Volume_Level is Natural range 0 .. 100;

   --  Music tracks
   type Music_Type is (
      Air_Theme,
      Water_Theme,
      Menu_Theme,
      Victory_Theme,
      Game_Over_Theme
   );

   --  Sound effects
   type Sound_Effect_Type is (
      Torpedo_Fire,
      Missile_Launch,
      Explosion,
      Splash,
      Engine,
      Sonar_Ping,
      Alarm
   );

   --  Sound effect queue capacity
   Max_Sound_Queue : constant := 8;

   --  Sound system state
   type Sound_System is private;

   --  Initialize sound system
   function Create return Sound_System;

   --  Play music with crossfade
   procedure Play_Music
      (System    : in out Sound_System;
       Track     : Music_Type;
       Fade_Time : Natural := 1000)  --  Milliseconds
   with
      Pre => Fade_Time <= 10000;

   --  Play sound effect (queued if system busy)
   procedure Play_Sound
      (System : in out Sound_System;
       Effect : Sound_Effect_Type);

   --  Update sound system (for crossfading and effect processing)
   procedure Update
      (System  : in Out Sound_System;
       Delta_T : Natural)
   with
      Pre => Delta_T > 0 and Delta_T <= 1000;

   --  Volume control
   procedure Set_Music_Volume
      (System : in Out Sound_System;
       Volume : Volume_Level);

   procedure Set_Effects_Volume
      (System : in Out Sound_System;
       Volume : Volume_Level);

   function Get_Music_Volume (System : Sound_System) return Volume_Level;
   function Get_Effects_Volume (System : Sound_System) return Volume_Level;

   --  Mute/unmute
   procedure Set_Muted
      (System : in Out Sound_System;
       Muted  : Boolean);

   function Is_Muted (System : Sound_System) return Boolean;

   --  Status queries
   function Get_Current_Music (System : Sound_System) return Music_Type;
   function Is_Crossfading (System : Sound_System) return Boolean;
   function Get_Crossfade_Progress (System : Sound_System) return Natural
   with
      Post => Get_Crossfade_Progress'Result in 0 .. 100;

   --  Stop all sounds
   procedure Stop_All (System : in Out Sound_System);

private

   --  Sound effect queue entry
   type Sound_Queue_Entry is record
      Effect   : Sound_Effect_Type := Torpedo_Fire;
      Active   : Boolean := False;
      Duration : Natural := 0;  --  Remaining playback time (ms)
   end record;

   --  Sound effect queue
   type Sound_Queue_Index is range 1 .. Max_Sound_Queue;
   type Sound_Queue_Array is array (Sound_Queue_Index) of Sound_Queue_Entry;

   --  Crossfade state
   type Crossfade_State is (None, Fading_Out, Fading_In);

   --  Sound system implementation
   type Sound_System is record
      --  Music state
      Current_Music       : Music_Type := Menu_Theme;
      Target_Music        : Music_Type := Menu_Theme;
      Music_Volume        : Volume_Level := 80;
      Current_Music_Vol   : Volume_Level := 80;  --  During crossfade

      --  Crossfade state
      Crossfade_State_Val : Crossfade_State := None;
      Crossfade_Duration  : Natural := 0;
      Crossfade_Remaining : Natural := 0;

      --  Sound effects
      Effects_Volume      : Volume_Level := 100;
      Sound_Queue         : Sound_Queue_Array;

      --  Global state
      Muted               : Boolean := False;
      Initialized         : Boolean := True;
   end record;

end Sound;
