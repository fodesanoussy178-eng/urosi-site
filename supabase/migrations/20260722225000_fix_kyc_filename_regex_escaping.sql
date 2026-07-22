-- Corrige validate_kyc_storage_object() : le motif utilisait '\\.' au lieu de
-- '\.' devant l'extension. Dans une chaîne '...' classique (non E'...'),
-- avec standard_conforming_strings=on (défaut Postgres), '\\' produit deux
-- caractères backslash littéraux dans le motif. En regex POSIX, cela se lit
-- comme « un backslash échappé » suivi d'un « . » NON échappé (qui matche
-- n'importe quel caractère) — la séquence attendue « backslash + point
-- littéral » ne correspondait donc JAMAIS à un vrai chemin de fichier
-- (aucun backslash n'apparaît dans un chemin Storage). Résultat : CHAQUE
-- soumission KYC, quel que soit l'état du compte ou la conformité réelle du
-- fichier, était rejetée par ce garde avec « Nom de fichier KYC non
-- securise. » — un blocage total et systématique, découvert uniquement en
-- rejouant l'upload + la RPC de bout en bout avec un vrai nom de fichier
-- UUID conforme à ce que produit crypto.randomUUID() côté client.
create or replace function public.validate_kyc_storage_object(
  p_profile_id uuid,
  p_document_path text
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_metadata jsonb;
  v_mime text;
  v_size bigint;
begin
  if p_document_path !~ ('^' || p_profile_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|pdf)$') then
    raise exception using errcode = '22023', message = 'Nom de fichier KYC non securise.';
  end if;

  select o.metadata into v_metadata
  from storage.objects o
  where o.bucket_id = 'kyc-documents' and o.name = p_document_path;
  if not found then
    raise exception using errcode = '22023', message = 'Document KYC introuvable.';
  end if;

  v_mime := lower(coalesce(v_metadata ->> 'mimetype', ''));
  if v_mime not in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf') then
    raise exception using errcode = '22023', message = 'Format de document KYC interdit.';
  end if;
  if coalesce(v_metadata ->> 'size', '') !~ '^[0-9]+$' then
    raise exception using errcode = '22023', message = 'Taille du document KYC introuvable.';
  end if;
  v_size := (v_metadata ->> 'size')::bigint;
  if v_size < 1 or v_size > 10485760 then
    raise exception using errcode = '22023', message = 'Document KYC trop volumineux.';
  end if;
end;
$$;

revoke execute on function public.validate_kyc_storage_object(uuid, text)
  from public, anon, authenticated;
