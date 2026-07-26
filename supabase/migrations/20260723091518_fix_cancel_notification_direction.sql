-- Bug reel decouvert en testant la nouvelle annulation de mission cote
-- structure (cancelMission cascade sur les candidatures actives) :
-- trg_notify_application_status supposait que toute transition vers
-- 'cancelled' venait du TRAVAILLEUR qui se desiste, et notifiait donc la
-- structure ("Un travailleur s'est desiste") — meme quand c'est la structure
-- elle-meme qui annule la mission. Le travailleur concerne ne recevait alors
-- AUCUNE notification, contrairement a l'exigence produit ("le travailleur
-- est notifie via le trigger de statut deja en place, sans sanction
-- automatique de son cote").
--
-- Distingue les deux cas via auth.uid() : le travailleur annulant sa propre
-- candidature (worker_id = auth.uid()) notifie toujours la structure comme
-- avant ; toute autre origine (la structure annule la mission) notifie
-- desormais le travailleur, sans mention de faute de sa part.
create or replace function public.trg_notify_application_status()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_owner uuid;
  v_title text;
begin
  if new.status = old.status then
    return new;
  end if;

  select s.owner_id, m.title into v_owner, v_title
  from public.missions m
  join public.structures s on s.id = m.structure_id
  where m.id = new.mission_id;

  if new.status = 'accepted' then
    perform public.notify(
      new.worker_id, 'application_accepted',
      'Candidature acceptée 🎉',
      'Tu es retenu·e pour « ' || v_title || ' ». Le fil de discussion est ouvert.',
      jsonb_build_object('application_id', new.id, 'mission_id', new.mission_id)
    );
  elsif new.status = 'rejected' then
    perform public.notify(
      new.worker_id, 'application_rejected',
      'Candidature non retenue',
      'La structure a choisi un autre profil pour « ' || v_title || ' ».',
      jsonb_build_object('application_id', new.id, 'mission_id', new.mission_id)
    );
  elsif new.status = 'completed' then
    perform public.notify(
      v_owner, 'mission_completed',
      'Mission terminée',
      '« ' || v_title || ' » est marquée terminée. Pense à noter le travailleur.',
      jsonb_build_object('application_id', new.id, 'mission_id', new.mission_id)
    );
  elsif new.status = 'cancelled' then
    if auth.uid() = new.worker_id then
      perform public.notify(
        v_owner, 'application_cancelled',
        'Candidature annulée',
        'Un travailleur s''est désisté sur « ' || v_title || ' ».',
        jsonb_build_object('application_id', new.id, 'mission_id', new.mission_id)
      );
    else
      perform public.notify(
        new.worker_id, 'mission_cancelled_by_structure',
        'Mission annulée',
        'La structure a annulé « ' || v_title || ' ». Aucune sanction de ton côté.',
        jsonb_build_object('application_id', new.id, 'mission_id', new.mission_id)
      );
    end if;
  end if;
  return new;
end;
$$;
