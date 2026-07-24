-- La notation est disponible des que la fin de presence est confirmee.
-- Elle reste volontairement independante du paiement, qui peut demeurer en
-- payment_pending jusqu'au traitement J+3.

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
        or exists (
          select 1
          from public.applications a
          join public.missions m on m.id = a.mission_id
          join public.structures s on s.id = m.structure_id
          where a.id = ratings.application_id
            and a.worker_id = ratings.worker_id
            and m.structure_id = ratings.structure_id
            and s.owner_id = (select auth.uid())
            and (
              a.status = 'completed'
              or (
                a.attendance_status = 'end_confirmed'
                and a.actual_end_at is not null
              )
            )
        )
      )
    )
  );

drop policy if exists "ratings: worker rates own completed application" on public.ratings;
drop policy if exists "ratings: worker rates own finished application" on public.ratings;
drop policy if exists "ratings: structure rates worker on completed application" on public.ratings;
drop policy if exists "ratings: structure rates worker on finished application" on public.ratings;
drop policy if exists "ratings: participants rate finished application" on public.ratings;
create policy "ratings: participants rate finished application"
  on public.ratings for insert
  to authenticated
  with check (
    (
      ratings.direction = 'worker_to_structure'
      and ratings.worker_id = (select auth.uid())
      and exists (
        select 1
        from public.applications a
        join public.missions m on m.id = a.mission_id
        where a.id = ratings.application_id
          and a.worker_id = (select auth.uid())
          and m.structure_id = ratings.structure_id
          and (
            a.status = 'completed'
            or (
              a.attendance_status = 'end_confirmed'
              and a.actual_end_at is not null
            )
          )
      )
    )
    or (
      ratings.direction = 'structure_to_worker'
      and exists (
        select 1
        from public.applications a
        join public.missions m on m.id = a.mission_id
        join public.structures s on s.id = m.structure_id
        where a.id = ratings.application_id
          and a.worker_id = ratings.worker_id
          and m.structure_id = ratings.structure_id
          and s.owner_id = (select auth.uid())
          and (
            a.status = 'completed'
            or (
              a.attendance_status = 'end_confirmed'
              and a.actual_end_at is not null
            )
          )
      )
    )
  );

-- Les deux participants recoivent le rappel au moment exact ou la fin est
-- confirmee, sans attendre le changement de statut financier.
create or replace function public.trg_notify_ratings_available()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_title text;
begin
  if new.attendance_status = 'end_confirmed'
     and old.attendance_status is distinct from 'end_confirmed'
     and new.actual_end_at is not null then
    select s.owner_id, m.title
      into v_owner, v_title
    from public.missions m
    join public.structures s on s.id = m.structure_id
    where m.id = new.mission_id;

    perform public.notify(
      new.worker_id,
      'rating',
      'Mission terminee - note la structure',
      'La fin de « ' || coalesce(v_title, 'ta mission') || ' » est confirmee. Tu peux maintenant donner une note de 1 a 5 etoiles.',
      jsonb_build_object('application_id', new.id, 'mission_id', new.mission_id, 'direction', 'worker_to_structure')
    );

    if v_owner is not null then
      perform public.notify(
        v_owner,
        'rating',
        'Mission terminee - note le travailleur',
        'La fin de « ' || coalesce(v_title, 'la mission') || ' » est confirmee. Vous pouvez maintenant donner une note de 1 a 5 etoiles.',
        jsonb_build_object('application_id', new.id, 'mission_id', new.mission_id, 'direction', 'structure_to_worker')
      );
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.trg_notify_ratings_available()
  from public, anon, authenticated;

drop trigger if exists applications_notify_ratings_available on public.applications;
create trigger applications_notify_ratings_available
  after update of attendance_status, actual_end_at on public.applications
  for each row execute function public.trg_notify_ratings_available();
