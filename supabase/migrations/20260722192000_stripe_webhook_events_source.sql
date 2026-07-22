-- Alignement de mark_stripe_webhook_event sur la table enrichie du staging.
--
-- Le staging possède une version enrichie de stripe_webhook_events
-- (source in ('account','connect'), livemode=false imposé par contrainte,
-- suivi state/attempts). La colonne `source` étant NOT NULL sans défaut,
-- l'insert (id, type) de la RPC échouait → 500 « Erreur idempotence » sur
-- CHAQUE webhook reçu. Correctif :
--   - défaut 'account' sur source (ajoutée si absente sur un environnement
--     resté au schéma simple) ;
--   - RPC à 3 arguments (p_source optionnel) compatible avec les deux schémas,
--     le webhook Edge transmet 'connect' ou 'account' selon le secret de
--     signature qui a validé l'événement.

alter table public.stripe_webhook_events add column if not exists source text;
alter table public.stripe_webhook_events alter column source set default 'account';
update public.stripe_webhook_events set source = 'account' where source is null;

drop function if exists public.mark_stripe_webhook_event(text, text);

create or replace function public.mark_stripe_webhook_event(
  p_id text,
  p_type text,
  p_source text default 'account'
)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  v_inserted integer;
begin
  insert into public.stripe_webhook_events (id, type, source)
  values (p_id, p_type, case when p_source in ('account','connect') then p_source else 'account' end)
  on conflict (id) do nothing;
  get diagnostics v_inserted = row_count;
  return v_inserted = 1;
end;
$$;

revoke execute on function public.mark_stripe_webhook_event(text, text, text) from public, anon, authenticated;
grant execute on function public.mark_stripe_webhook_event(text, text, text) to service_role;
notify pgrst, 'reload schema';
