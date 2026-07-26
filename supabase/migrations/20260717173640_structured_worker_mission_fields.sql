-- Donnees de mission structurees pour alimenter automatiquement le flux
-- travailleur et sa fiche complete. Les colonnes historiques sont conservees.

alter table public.missions
  add column if not exists end_time time,
  add column if not exists dress_code text,
  add column if not exists equipment text,
  add column if not exists instructions text;

-- Le prix visible par le travailleur reste derive de worker_amount : une seule
-- source de verite, sans risque de decalage avec le calcul de paiement.
alter table public.missions
  add column if not exists price_total numeric(12,2)
  generated always as (worker_amount) stored;

update public.missions
set end_time = coalesce(
  case
    when jsonb_typeof(slots) = 'array' and jsonb_array_length(slots) > 0
      then nullif(slots -> -1 ->> 'end', '')::time
    else null
  end,
  ends_at::time
)
where end_time is null;

comment on column public.missions.price_total is 'Montant total visible par le travailleur, derive automatiquement de worker_amount.';
comment on column public.missions.end_time is 'Heure de fin saisie pour la mission, distincte de la date et de la duree.';
comment on column public.missions.dress_code is 'Tenue demandee pour la mission.';
comment on column public.missions.equipment is 'Materiel fourni ou a apporter.';
comment on column public.missions.instructions is 'Consignes pratiques communiquees au travailleur.';
