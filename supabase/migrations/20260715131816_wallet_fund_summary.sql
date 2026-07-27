-- Exact wallet totals, independently from the paginated transaction history.
create or replace function public.wallet_fund_summary()
returns table (
  available_cents bigint,
  pending_cents bigint,
  blocked_cents bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    w.balance_cents as available_cents,
    coalesce(sum(t.amount_cents) filter (where t.fund_status = 'pending'), 0)::bigint as pending_cents,
    coalesce(sum(t.amount_cents) filter (where t.fund_status = 'blocked'), 0)::bigint as blocked_cents
  from public.wallets w
  left join public.wallet_transactions t on t.wallet_id = w.id
  where w.profile_id = (select auth.uid())
  group by w.id, w.balance_cents
$$;

revoke execute on function public.wallet_fund_summary() from public, anon;
grant execute on function public.wallet_fund_summary() to authenticated;
