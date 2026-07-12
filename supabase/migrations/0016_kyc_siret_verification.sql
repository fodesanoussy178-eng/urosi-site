-- 0016 : KYC demande apres acceptation + verification structure.
--
-- Les infos sensibles ne sont pas collectees a l'inscription worker. Elles
-- deviennent necessaires seulement apres acceptation sur une mission.
-- L'IBAN complet et les fichiers d'identite doivent rester chez le PSP /
-- stockage securise ; la table garde uniquement l'etat et les references.

alter table public.profiles add column if not exists kyc_status text not null default 'not_started';
alter table public.profiles drop constraint if exists profiles_kyc_status_check;
alter table public.profiles
  add constraint profiles_kyc_status_check
  check (kyc_status in ('not_started', 'requested', 'submitted', 'verified', 'rejected'));
alter table public.profiles add column if not exists kyc_requested_at timestamptz;
alter table public.profiles add column if not exists kyc_submitted_at timestamptz;
alter table public.profiles add column if not exists iban_country text;
alter table public.profiles add column if not exists iban_last4 text;
alter table public.profiles add column if not exists identity_document_name text;
alter table public.profiles add column if not exists identity_document_path text;
alter table public.profiles add column if not exists identity_document_uploaded_at timestamptz;

create index if not exists profiles_kyc_status_idx on public.profiles (kyc_status);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'kyc-documents',
  'kyc-documents',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "kyc owners can upload" on storage.objects;
create policy "kyc owners can upload"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'kyc-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "kyc owners can read" on storage.objects;
create policy "kyc owners can read"
on storage.objects for select to authenticated
using (
  bucket_id = 'kyc-documents'
  and ((storage.foldername(name))[1] = auth.uid()::text or public.is_founder())
);

drop policy if exists "kyc owners can replace" on storage.objects;
create policy "kyc owners can replace"
on storage.objects for update to authenticated
using (
  bucket_id = 'kyc-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'kyc-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
);

alter table public.structures add column if not exists verification_status text not null default 'pending';
alter table public.structures drop constraint if exists structures_verification_status_check;
alter table public.structures
  add constraint structures_verification_status_check
  check (verification_status in ('pending', 'verified', 'rejected', 'founder_bypass'));
alter table public.structures add column if not exists verification_method text not null default 'siret';
alter table public.structures drop constraint if exists structures_verification_method_check;
alter table public.structures
  add constraint structures_verification_method_check
  check (verification_method in ('siret', 'founder', 'manual'));
alter table public.structures add column if not exists founder_bypass boolean not null default false;
alter table public.structures add column if not exists siret_verified_at timestamptz;
alter table public.structures add column if not exists verified_at timestamptz;
alter table public.structures add column if not exists verified_by uuid references public.profiles (id) on delete set null;

create index if not exists structures_verification_status_idx on public.structures (verification_status);

update public.structures
set verification_status = 'verified',
    verification_method = 'siret',
    siret_verified_at = coalesce(siret_verified_at, now()),
    verified_at = coalesce(verified_at, now())
where siret is not null
  and btrim(siret) <> ''
  and verification_status = 'pending';
