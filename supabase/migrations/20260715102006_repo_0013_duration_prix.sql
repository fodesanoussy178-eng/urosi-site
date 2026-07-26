-- 0013 : missions de 1h a 3 jours + prix libre avec double commission
-- configurable (structure et worker).
--
-- - La structure fixe librement le brut (worker_rate_cents / base).
-- - Le systeme calcule automatiquement : brut, commission UROSI structure,
--   commission UROSI worker, net worker, cout total structure.
-- - Taux configurables dans platform_settings (commission_pct = cote
--   structure, commission_worker_pct = cote worker).

-- Duree : 1h minimum, 3 jours (4320 min) maximum — plus de plafond 5h.
alter table public.missions drop constraint if exists missions_duration_minutes_check;
alter table public.missions
  add constraint missions_duration_minutes_check
  check (duration_minutes >= 60 and duration_minutes <= 4320);

alter table public.platform_settings
  add column if not exists commission_worker_pct numeric not null default 10
  check (commission_worker_pct >= 0 and commission_worker_pct <= 40);

comment on column public.platform_settings.commission_pct is
  'Commission UROSI cote structure (% ajoutes au brut, payes par la structure).';
comment on column public.platform_settings.commission_worker_pct is
  'Commission UROSI cote worker (% retenus sur le brut avant credit wallet).';

-- process_mission_payment v2 : voir supabase/migrations (version appliquee
-- en prod via MCP le 2026-07-10). Net worker = brut - commission worker ;
-- cout structure = brut + commission structure ; le detail complet est
-- stocke dans payments.breakdown.
create or replace function public.process_mission_payment(p_application_id uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_app record;
  v_pct_structure numeric;
  v_pct_worker numeric;
  v_brut integer;
  v_comm_structure integer;
  v_comm_worker integer;
  v_net integer;
  v_total integer;
  v_bonus integer;
  v_payment_id uuid;
  v_worker_wallet uuid;
  v_owner_wallet uuid;
begin
  select a.id, a.status, a.worker_id,
         m.id as mission_id, m.title, m.worker_rate_cents, m.base_rate_cents,
         m.is_solidaire, m.pricing_breakdown, m.structure_id,
         s.owner_id, s.name as structure_name
  into v_app
  from public.applications a
  join public.missions m on m.id = a.mission_id
  join public.structures s on s.id = m.structure_id
  where a.id = p_application_id;

  if not found then
    raise exception 'Candidature introuvable.';
  end if;
  if v_app.status <> 'completed' then
    raise exception 'La mission doit être terminée avant paiement.';
  end if;
  if auth.uid() is not null and auth.uid() not in (v_app.worker_id, v_app.owner_id) then
    raise exception 'Non autorisé.';
  end if;
  if v_app.is_solidaire or v_app.worker_rate_cents <= 0 then
    return null;
  end if;

  select id into v_payment_id from public.payments where application_id = p_application_id;
  if v_payment_id is not null then
    return v_payment_id;
  end if;

  select commission_pct, commission_worker_pct
  into v_pct_structure, v_pct_worker
  from public.platform_settings where id = true;

  v_brut := v_app.worker_rate_cents;
  v_comm_structure := round(v_brut * coalesce(v_pct_structure, 15) / 100.0)::int;
  v_comm_worker := round(v_brut * coalesce(v_pct_worker, 10) / 100.0)::int;
  v_net := greatest(v_brut - v_comm_worker, 0);
  v_total := v_brut + v_comm_structure;
  v_bonus := greatest(v_brut - coalesce(v_app.base_rate_cents, v_brut), 0);

  insert into public.payments (
    application_id, amount_cents, status, structure_id, worker_id,
    worker_amount_cents, commission_cents, bonus_cents, provider, released_at, breakdown
  ) values (
    p_application_id, v_total, 'released',
    v_app.structure_id, v_app.worker_id,
    v_net, v_comm_structure + v_comm_worker, v_bonus, 'internal', now(),
    coalesce(v_app.pricing_breakdown, '{}'::jsonb) || jsonb_build_object(
      'brut_cents', v_brut,
      'commission_structure_cents', v_comm_structure,
      'commission_worker_cents', v_comm_worker,
      'net_worker_cents', v_net,
      'total_structure_cents', v_total
    )
  )
  returning id into v_payment_id;

  v_worker_wallet := public.ensure_wallet(v_app.worker_id);
  v_owner_wallet := public.ensure_wallet(v_app.owner_id);

  insert into public.wallet_transactions (wallet_id, amount_cents, kind, application_id, label)
  values
    (v_worker_wallet, v_net, 'mission_earning', p_application_id,
     'Mission « ' || v_app.title || ' » — ' || v_app.structure_name ||
     ' (brut ' || to_char(v_brut / 100.0, 'FM999990.00') || ' €, commission ' ||
     to_char(v_comm_worker / 100.0, 'FM999990.00') || ' €)'),
    (v_owner_wallet, -v_brut, 'mission_charge', p_application_id,
     'Rémunération brute « ' || v_app.title || ' »'),
    (v_owner_wallet, -v_comm_structure, 'commission', p_application_id,
     'Commission UROSI (' || coalesce(v_pct_structure, 15) || ' %) — « ' || v_app.title || ' »');

  perform public.notify(
    v_app.worker_id, 'payment',
    'Paiement reçu 💶',
    'Ton wallet est crédité de ' || to_char(v_net / 100.0, 'FM999990.00') || ' € net pour « ' || v_app.title || ' ».',
    jsonb_build_object('application_id', p_application_id, 'payment_id', v_payment_id, 'amount_cents', v_net)
  );
  perform public.notify(
    v_app.owner_id, 'payment',
    'Paiement effectué',
    to_char(v_total / 100.0, 'FM999990.00') || ' € débités pour « ' || v_app.title || ' » (brut + commission).',
    jsonb_build_object('application_id', p_application_id, 'payment_id', v_payment_id, 'amount_cents', v_total)
  );

  return v_payment_id;
end;
$$;

revoke execute on function public.process_mission_payment(uuid) from public, anon;
