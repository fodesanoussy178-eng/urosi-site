-- Corrige submit_worker_kyc : la garde n'acceptait que
-- kyc_status in ('requested', 'rejected'), en supposant que
-- request_kyc_after_acceptance() (déclenché quand une candidature passe à
-- 'accepted') ait déjà positionné 'requested' avant que le travailleur ne
-- soumette son KYC. Ce couplage implicite est fragile : toute situation où
-- ce trigger n'a pas (encore) tourné pour ce compte laisse kyc_status à sa
-- valeur par défaut 'not_started', et submit_worker_kyc échoue alors
-- systématiquement avec « Aucune demande KYC active pour ce compte » —
-- perçu côté travailleur comme un envoi impossible, sans recours.
--
-- On élargit la garde à 'not_started' : la première soumission (cas
-- nominal, largement majoritaire en base) est acceptée même si, pour une
-- raison quelconque, le trigger d'acceptation n'a pas positionné
-- 'requested' au préalable. L'invariant de sécurité réel est préservé : une
-- fois passé à 'submitted' ou 'verified', aucune re-soumission silencieuse
-- n'est possible sans repasser par le circuit de reprise du fondateur
-- (founder_set_kyc_status), qui seul peut repositionner 'requested'/'rejected'
-- après une revue.
create or replace function public.submit_worker_kyc(
  p_iban_country text,
  p_iban_last4 text,
  p_document_name text,
  p_document_path text
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles;
  v_country text := upper(btrim(coalesce(p_iban_country, '')));
  v_last4 text := upper(btrim(coalesce(p_iban_last4, '')));
  v_name text := btrim(coalesce(p_document_name, ''));
  v_path text := btrim(coalesce(p_document_path, ''));
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Authentification requise.';
  end if;
  if v_country !~ '^[A-Z]{2}$' or v_last4 !~ '^[A-Z0-9]{4}$' then
    raise exception using errcode = '22023', message = 'Informations IBAN invalides.';
  end if;
  if length(v_name) < 3 or length(v_name) > 160 then
    raise exception using errcode = '22023', message = 'Nom de document invalide.';
  end if;
  if v_path not like v_uid::text || '/%' then
    raise exception using errcode = '42501', message = 'Chemin de document invalide.';
  end if;
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'kyc-documents' and o.name = v_path
  ) then
    raise exception using errcode = '22023', message = 'Document KYC introuvable.';
  end if;

  perform set_config('app.kyc_source', 'worker_submit', true);
  update public.profiles
  set kyc_status = 'submitted',
      kyc_requested_at = coalesce(kyc_requested_at, now()),
      kyc_submitted_at = now(),
      iban_country = v_country,
      iban_last4 = v_last4,
      identity_document_name = v_name,
      identity_document_path = v_path,
      identity_document_uploaded_at = now()
  where id = v_uid
    and role = 'worker'
    and kyc_status in ('not_started', 'requested', 'rejected')
  returning * into v_profile;

  if not found then
    raise exception using errcode = '23514', message = 'Aucune demande KYC active pour ce compte.';
  end if;
  return v_profile;
end;
$$;

revoke execute on function public.submit_worker_kyc(text, text, text, text) from public, anon;
grant execute on function public.submit_worker_kyc(text, text, text, text) to authenticated;
