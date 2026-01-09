--  =================================================================
--  Sound Package Implementation
--  =================================================================
--
--  Full sound system with crossfading, queued effects, volume control
--  Uses Ada.Text_IO for debug output (real audio via SDL_Mixer future)
--  =================================================================

with Ada.Text_IO;

package body Sound with
   SPARK_Mode => On
is

   --  Sound effect durations (milliseconds)
   function Get_Effect_Duration (Effect : Sound_Effect_Type) return Natural is
   begin
      case Effect is
         when Torpedo_Fire   => return 500;
         when Missile_Launch => return 600;
         when Explosion      => return 800;
         when Splash         => return 400;
         when Engine         => return 200;
         when Sonar_Ping     => return 1000;
         when Alarm          => return 300;
      end case;
   end Get_Effect_Duration;

   --  Initialize sound system
   function Create return Sound_System is
      System : Sound_System;
   begin
      --  Default values set via record defaults
      return System;
   end Create;

   --  Play music with crossfade
   procedure Play_Music
      (System    : in Out Sound_System;
       Track     : Music_Type;
       Fade_Time : Natural := 1000)
   is
      use Ada.Text_IO;
   begin
      --  Skip if already playing this track
      if System.Current_Music = Track and
         System.Crossfade_State_Val = None
      then
         return;
      end if;

      --  Start crossfade
      System.Target_Music := Track;
      System.Crossfade_Duration := Fade_Time;
      System.Crossfade_Remaining := Fade_Time;

      if Fade_Time = 0 then
         --  Instant switch
         System.Current_Music := Track;
         System.Current_Music_Vol := System.Music_Volume;
         System.Crossfade_State_Val := None;
      else
         --  Begin fade out of current track
         System.Crossfade_State_Val := Fading_Out;
      end if;

      if not System.Muted then
         Put_Line ("[SOUND] Music: " & System.Current_Music'Image &
                   " -> " & Track'Image &
                   " (fade: " & Fade_Time'Image & "ms)");
      end if;
   end Play_Music;

   --  Play sound effect (queued if system busy)
   procedure Play_Sound
      (System : in Out Sound_System;
       Effect : Sound_Effect_Type)
   is
      use Ada.Text_IO;
      Duration : constant Natural := Get_Effect_Duration (Effect);
   begin
      --  Find empty slot in queue
      for I in Sound_Queue_Index loop
         if not System.Sound_Queue (I).Active then
            System.Sound_Queue (I).Effect := Effect;
            System.Sound_Queue (I).Active := True;
            System.Sound_Queue (I).Duration := Duration;

            if not System.Muted then
               Put_Line ("[SOUND] SFX: " & Effect'Image &
                         " (duration: " & Duration'Image & "ms)");
            end if;

            exit;
         end if;
      end loop;
      --  If no slot found, effect is dropped (queue full)
   end Play_Sound;

   --  Update sound system (for crossfading and effect processing)
   procedure Update
      (System  : in Out Sound_System;
       Delta_T : Natural)
   is
      Half_Fade : Natural;
   begin
      --  Update crossfade
      if System.Crossfade_State_Val /= None then
         if System.Crossfade_Remaining > Delta_T then
            System.Crossfade_Remaining := System.Crossfade_Remaining - Delta_T;

            --  Calculate volume during fade
            Half_Fade := System.Crossfade_Duration / 2;
            if Half_Fade = 0 then
               Half_Fade := 1;
            end if;

            if System.Crossfade_State_Val = Fading_Out then
               --  Fade out current track
               if System.Crossfade_Remaining <= Half_Fade then
                  --  Switch to fading in new track
                  System.Crossfade_State_Val := Fading_In;
                  System.Current_Music := System.Target_Music;
                  System.Current_Music_Vol := 0;
               else
                  --  Continue fading out
                  System.Current_Music_Vol :=
                     (System.Music_Volume * (System.Crossfade_Remaining - Half_Fade)) / Half_Fade;
               end if;
            else  --  Fading_In
               --  Fade in new track
               declare
                  Fade_Progress : constant Natural := Half_Fade - System.Crossfade_Remaining;
               begin
                  if Fade_Progress >= Half_Fade then
                     System.Current_Music_Vol := System.Music_Volume;
                  else
                     System.Current_Music_Vol :=
                        (System.Music_Volume * Fade_Progress) / Half_Fade;
                  end if;
               end;
            end if;
         else
            --  Crossfade complete
            System.Crossfade_Remaining := 0;
            System.Crossfade_State_Val := None;
            System.Current_Music := System.Target_Music;
            System.Current_Music_Vol := System.Music_Volume;
         end if;
      end if;

      --  Update sound effect queue
      for I in Sound_Queue_Index loop
         if System.Sound_Queue (I).Active then
            if System.Sound_Queue (I).Duration > Delta_T then
               System.Sound_Queue (I).Duration :=
                  System.Sound_Queue (I).Duration - Delta_T;
            else
               --  Effect finished
               System.Sound_Queue (I).Duration := 0;
               System.Sound_Queue (I).Active := False;
            end if;
         end if;
      end loop;
   end Update;

   --  Set music volume
   procedure Set_Music_Volume
      (System : in Out Sound_System;
       Volume : Volume_Level)
   is
   begin
      System.Music_Volume := Volume;
      --  Update current volume if not crossfading
      if System.Crossfade_State_Val = None then
         System.Current_Music_Vol := Volume;
      end if;
   end Set_Music_Volume;

   --  Set effects volume
   procedure Set_Effects_Volume
      (System : in Out Sound_System;
       Volume : Volume_Level)
   is
   begin
      System.Effects_Volume := Volume;
   end Set_Effects_Volume;

   --  Get music volume
   function Get_Music_Volume (System : Sound_System) return Volume_Level is
      (System.Music_Volume);

   --  Get effects volume
   function Get_Effects_Volume (System : Sound_System) return Volume_Level is
      (System.Effects_Volume);

   --  Set muted
   procedure Set_Muted
      (System : in Out Sound_System;
       Muted  : Boolean)
   is
      use Ada.Text_IO;
   begin
      System.Muted := Muted;
      if Muted then
         Put_Line ("[SOUND] Audio muted");
      else
         Put_Line ("[SOUND] Audio unmuted");
      end if;
   end Set_Muted;

   --  Check muted
   function Is_Muted (System : Sound_System) return Boolean is
      (System.Muted);

   --  Get current music track
   function Get_Current_Music (System : Sound_System) return Music_Type is
      (System.Current_Music);

   --  Check if crossfading
   function Is_Crossfading (System : Sound_System) return Boolean is
      (System.Crossfade_State_Val /= None);

   --  Get crossfade progress (0-100)
   function Get_Crossfade_Progress (System : Sound_System) return Natural is
   begin
      if System.Crossfade_Duration = 0 or System.Crossfade_State_Val = None then
         return 100;
      end if;

      return ((System.Crossfade_Duration - System.Crossfade_Remaining) * 100) /
             System.Crossfade_Duration;
   end Get_Crossfade_Progress;

   --  Stop all sounds
   procedure Stop_All (System : in Out Sound_System)
   is
      use Ada.Text_IO;
   begin
      --  Clear crossfade
      System.Crossfade_State_Val := None;
      System.Crossfade_Remaining := 0;
      System.Current_Music_Vol := 0;

      --  Clear sound queue
      for I in Sound_Queue_Index loop
         System.Sound_Queue (I).Active := False;
         System.Sound_Queue (I).Duration := 0;
      end loop;

      Put_Line ("[SOUND] All sounds stopped");
   end Stop_All;

end Sound;
