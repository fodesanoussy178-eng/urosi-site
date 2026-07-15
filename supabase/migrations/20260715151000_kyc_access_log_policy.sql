-- Founder-only read access for the immutable KYC document access journal.
drop policy if exists "kyc document access: founder read" on public.kyc_document_access_log;
create policy "kyc document access: founder read"
  on public.kyc_document_access_log
  for select
  to authenticated
  using ((select public.is_founder()));

grant select on table public.kyc_document_access_log to authenticated;
revoke insert, update, delete on table public.kyc_document_access_log from authenticated;
