--  =================================================================
--  Missions Package Implementation
--  =================================================================
--
--  Full mission system with all mission types implemented
--  =================================================================

package body Missions with
   SPARK_Mode => On
is

   --  Create new mission
   function Create_Mission
      (Mission_Type_Val : Mission_Type;
       Target_Count     : Natural := 10;
       Time_Limit       : Natural := 300000)
      return Mission_Data
   is
      Mission : Mission_Data;
   begin
      Mission.Mission_Type := Mission_Type_Val;
      Mission.Status := In_Progress;
      Mission.Target_Count := Target_Count;
      Mission.Time_Limit := Time_Limit;
      Mission.Current_Count := 0;
      Mission.Time_Elapsed := 0;
      Mission.Escort_Health := 100;  --  Full health for escort missions
      return Mission;
   end Create_Mission;

   --  Get status
   function Get_Status (Mission : Mission_Data) return Mission_Status is
      (Mission.Status);

   --  Get type
   function Get_Type (Mission : Mission_Data) return Mission_Type is
      (Mission.Mission_Type);

   --  Get progress percentage
   function Get_Progress (Mission : Mission_Data) return Natural is
   begin
      case Mission.Mission_Type is
         when Patrol =>
            --  Progress based on time survived
            if Mission.Time_Limit = 0 then
               return 100;
            end if;
            declare
               Progress : constant Natural :=
                  (Mission.Time_Elapsed * 100) / Mission.Time_Limit;
            begin
               if Progress > 100 then
                  return 100;
               else
                  return Progress;
               end if;
            end;

         when Destroy_Targets | Rescue | Reconnaissance =>
            --  Progress based on targets completed
            if Mission.Target_Count = 0 then
               return 100;
            end if;
            declare
               Progress : constant Natural :=
                  (Mission.Current_Count * 100) / Mission.Target_Count;
            begin
               if Progress > 100 then
                  return 100;
               else
                  return Progress;
               end if;
            end;

         when Escort =>
            --  Progress based on escort survival and time
            if Mission.Escort_Health = 0 then
               return 0;  --  Failed
            end if;
            if Mission.Time_Limit = 0 then
               return 100;
            end if;
            declare
               Progress : constant Natural :=
                  (Mission.Time_Elapsed * 100) / Mission.Time_Limit;
            begin
               if Progress > 100 then
                  return 100;
               else
                  return Progress;
               end if;
            end;
      end case;
   end Get_Progress;

   --  Update progress
   procedure Update_Progress
      (Mission           : in Out Mission_Data;
       Enemies_Destroyed : Natural := 0;
       Survivors_Rescued : Natural := 0;
       Waypoints_Reached : Natural := 0;
       Escort_Damaged    : Natural := 0;
       Time_Elapsed      : Natural := 0)
   is
   begin
      --  Skip if mission already ended
      if Mission.Status = Completed or Mission.Status = Failed then
         return;
      end if;

      --  Update time
      Mission.Time_Elapsed := Mission.Time_Elapsed + Time_Elapsed;

      --  Check completion/failure based on mission type
      case Mission.Mission_Type is
         when Patrol =>
            --  Survive for the time limit
            if Mission.Time_Elapsed >= Mission.Time_Limit then
               Mission.Status := Completed;
            end if;

         when Destroy_Targets =>
            --  Destroy the required number of enemies
            Mission.Current_Count := Mission.Current_Count + Enemies_Destroyed;
            if Mission.Current_Count >= Mission.Target_Count then
               Mission.Status := Completed;
            elsif Mission.Time_Elapsed >= Mission.Time_Limit then
               --  Ran out of time
               Mission.Status := Failed;
            end if;

         when Rescue =>
            --  Rescue the required number of survivors
            Mission.Current_Count := Mission.Current_Count + Survivors_Rescued;
            if Mission.Current_Count >= Mission.Target_Count then
               Mission.Status := Completed;
            elsif Mission.Time_Elapsed >= Mission.Time_Limit then
               --  Ran out of time
               Mission.Status := Failed;
            end if;

         when Escort =>
            --  Protect the friendly unit until time runs out
            --  Track damage to escort
            if Escort_Damaged > Mission.Escort_Health then
               Mission.Escort_Health := 0;
            else
               Mission.Escort_Health := Mission.Escort_Health - Escort_Damaged;
            end if;

            if Mission.Escort_Health = 0 then
               --  Escort destroyed - mission failed
               Mission.Status := Failed;
            elsif Mission.Time_Elapsed >= Mission.Time_Limit then
               --  Escort survived - mission completed
               Mission.Status := Completed;
            end if;

         when Reconnaissance =>
            --  Reach all waypoints within time limit
            Mission.Current_Count := Mission.Current_Count + Waypoints_Reached;
            if Mission.Current_Count >= Mission.Target_Count then
               Mission.Status := Completed;
            elsif Mission.Time_Elapsed >= Mission.Time_Limit then
               --  Ran out of time
               Mission.Status := Failed;
            end if;
      end case;
   end Update_Progress;

   --  Get current count
   function Get_Current_Count (Mission : Mission_Data) return Natural is
      (Mission.Current_Count);

   --  Get target count
   function Get_Target_Count (Mission : Mission_Data) return Natural is
      (Mission.Target_Count);

   --  Get time remaining
   function Get_Time_Remaining (Mission : Mission_Data) return Natural is
   begin
      if Mission.Time_Elapsed >= Mission.Time_Limit then
         return 0;
      else
         return Mission.Time_Limit - Mission.Time_Elapsed;
      end if;
   end Get_Time_Remaining;

   --  Get escort health
   function Get_Escort_Health (Mission : Mission_Data) return Natural is
   begin
      if Mission.Escort_Health > 100 then
         return 100;
      else
         return Mission.Escort_Health;
      end if;
   end Get_Escort_Health;

end Missions;
