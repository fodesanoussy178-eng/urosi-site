-- Defense en profondeur et documentation explicite du modele d'acces : les
-- clients passent uniquement par les RPC controles, jamais par ces tables.
drop policy if exists "mission validation keys: server only" on public.mission_validation_keys;
create policy "mission validation keys: server only"
  on public.mission_validation_keys for all to authenticated
  using (false) with check (false);
drop policy if exists "mission validation pins: server only" on public.mission_validation_pins;
create policy "mission validation pins: server only"
  on public.mission_validation_pins for all to authenticated
  using (false) with check (false);
drop policy if exists "attendance validation attempts: server only" on public.attendance_validation_attempts;
create policy "attendance validation attempts: server only"
  on public.attendance_validation_attempts for all to authenticated
  using (false) with check (false);
