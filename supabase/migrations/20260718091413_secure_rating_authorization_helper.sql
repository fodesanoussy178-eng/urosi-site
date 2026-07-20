-- Les missions cloturees ne sont pas lisibles par le travailleur via la RLS
-- de public.missions. Ce helper non expose effectue uniquement le controle
-- d'autorisation necessaire a la politique de notation.

create schema if not exists rls_private;
revoke all on schema rls_private from public, anon, authenticated;
grant usage on schema rls_private to authenticated;

create or replace function rls_private.can_rate_finished_application(
  p_application_id uuid,
  p_structure_id uuid,
  p_worker_id uuid,
  p_direction text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_direction = 'worker_to_structure' then exists (
      select 1
      from public.applications a
      join public.missions m on m.id = a.mission_id
      where a.id = p_application_id
        and a.worker_id = p_worker_id
        and a.worker_id = (select auth.uid())
        and m.structure_id = p_structure_id
        and (
          a.status = 'completed'
          or (
            a.attendance_status = 'end_confirmed'
            and a.actual_end_at is not null
          )
        )
    )
    when p_direction = 'structure_to_worker' then exists (
      select 1
      from public.applications a
      join public.missions m on m.id = a.mission_id
      join public.structures s on s.id = m.structure_id
      where a.id = p_application_id
        and a.worker_id = p_worker_id
        and m.structure_id = p_structure_id
        and s.owner_id = (select auth.uid())
        and (
          a.status = 'completed'
          or (
            a.attendance_status = 'end_confirmed'
            and a.actual_end_at is not null
          )
        )
    )
    else false
  end;
$$;

revoke all on function rls_private.can_rate_finished_application(uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function rls_private.can_rate_finished_application(uuid, uuid, uuid, text)
  to authenticated;

drop policy if exists "ratings: participants read own" on public.ratings;
create policy "ratings: participants read own"
  on public.ratings for select
  to authenticated
  using (
    (
      ratings.direction = 'worker_to_structure'
      and ratings.worker_id = (select auth.uid())
    )
    or (
      ratings.direction = 'structure_to_worker'
      and (
        ratings.worker_id = (select auth.uid())
        or (select rls_private.can_rate_finished_application(
          ratings.application_id,
          ratings.structure_id,
          ratings.worker_id,
          ratings.direction
        ))
      )
    )
  );

drop policy if exists "ratings: participants rate finished application" on public.ratings;
create policy "ratings: participants rate finished application"
  on public.ratings for insert
  to authenticated
  with check (
    (select rls_private.can_rate_finished_application(
      ratings.application_id,
      ratings.structure_id,
      ratings.worker_id,
      ratings.direction
    ))
  );
