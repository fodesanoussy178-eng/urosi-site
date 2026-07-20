-- Sécurité (audit go-live) : compute_mission_pricing est SECURITY DEFINER et
-- lit public.pay_rules d'un structure_id arbitraire, contournant la RLS
-- « pay_rules: owner all ». Sans garde interne, tout utilisateur authentifié
-- pouvait lire la stratégie tarifaire d'une autre structure.
--
-- Correctif : on n'autorise le calcul que pour le propriétaire de la structure
-- (ou le fondateur). Le contexte backend (auth.uid() nul : trigger de
-- publication missions_apply_pricing, tâches service_role) reste autorisé.
-- Corps de la fonction inchangé par ailleurs.

create or replace function public.compute_mission_pricing(
  p_structure_id uuid,
  p_base_cents integer,
  p_date date,
  p_start_time time without time zone default null::time without time zone,
  p_duration_minutes integer default 0,
  p_sector text default 'autre'::text,
  p_difficulty integer default 1,
  p_urgent boolean default false,
  p_distance_km numeric default null::numeric
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  r record;
  v_base integer := greatest(coalesce(p_base_cents, 0), 0);
  v_adjustments jsonb := '[]'::jsonb;
  v_total integer;
  v_amount integer;
  v_applies boolean;
  v_from time;
  v_to time;
  v_open bigint;
  v_apps bigint;
begin
  -- Garde d'autorisation : seul le propriétaire (ou le fondateur) peut calculer
  -- le tarif d'une structure. auth.uid() nul = contexte serveur/backend, permis.
  if auth.uid() is not null
     and not public.is_structure_owner(p_structure_id)
     and not public.is_founder() then
    raise exception using errcode = '42501', message = 'Non autorisé.';
  end if;

  v_total := v_base;

  for r in
    select * from public.pay_rules
    where structure_id = p_structure_id and active
    order by priority, created_at
  loop
    v_applies := false;

    case r.kind
      when 'day_of_week' then
        -- params.days : jours ISO (1 = lundi … 7 = dimanche)
        v_applies := coalesce(r.params -> 'days', '[]'::jsonb) @> to_jsonb(extract(isodow from p_date)::int);
      when 'holiday' then
        v_applies := public.is_french_holiday(p_date);
      when 'time_of_day' then
        if p_start_time is not null then
          v_from := coalesce(nullif(r.params ->> 'from', '')::time, time '21:00');
          v_to := coalesce(nullif(r.params ->> 'to', '')::time, time '06:00');
          if v_from <= v_to then
            v_applies := p_start_time >= v_from and p_start_time < v_to;
          else
            -- plage passant minuit (ex. 21:00 -> 06:00)
            v_applies := p_start_time >= v_from or p_start_time < v_to;
          end if;
        end if;
      when 'duration' then
        v_applies := coalesce(p_duration_minutes, 0) >= coalesce(nullif(r.params ->> 'min_minutes', '')::int, 240);
      when 'sector' then
        v_applies := coalesce(r.params -> 'sectors', '[]'::jsonb) @> to_jsonb(coalesce(p_sector, 'autre'));
      when 'difficulty' then
        v_applies := coalesce(p_difficulty, 1) >= coalesce(nullif(r.params ->> 'min_level', '')::int, 3);
      when 'urgency' then
        v_applies := coalesce(p_urgent, false);
      when 'distance' then
        v_applies := p_distance_km is not null
          and p_distance_km >= coalesce(nullif(r.params ->> 'min_km', '')::numeric, 10);
      when 'tension' then
        -- tension offre/demande : missions ouvertes du secteur vs candidatures
        select count(*) into v_open
        from public.missions m
        where m.status = 'open' and m.sector = coalesce(p_sector, 'autre') and m.scheduled_date >= current_date;
        select count(*) into v_apps
        from public.applications a
        join public.missions m on m.id = a.mission_id
        where m.status = 'open' and m.sector = coalesce(p_sector, 'autre') and m.scheduled_date >= current_date;
        v_applies := v_open > 0
          and (v_open::numeric / greatest(v_apps, 1)) >= coalesce(nullif(r.params ->> 'min_ratio', '')::numeric, 2);
      when 'custom' then
        v_applies := true;
      else
        v_applies := false;
    end case;

    if v_applies then
      v_amount := round(v_base * coalesce(r.adjust_pct, 0) / 100.0)::int + coalesce(r.adjust_cents, 0);
      if v_amount <> 0 then
        v_adjustments := v_adjustments || jsonb_build_object(
          'rule_id', r.id,
          'kind', r.kind,
          'label', r.label,
          'amount_cents', v_amount
        );
        v_total := v_total + v_amount;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'base_cents', v_base,
    'adjustments', v_adjustments,
    'total_cents', greatest(v_total, 0)
  );
end;
$function$;
