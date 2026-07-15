import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260715091205_secure_platform_commission_18.sql'),
  'utf8',
).toLowerCase();

describe('migration commission UROSI 18 %', () => {
  it('conserve le taux personnalise et ne migre que l ancien 15 %', () => {
    expect(migration).toContain('alter column commission_pct set default 18');
    expect(migration).toContain('and commission_pct = 15');
  });

  it('protege la fonction financiere et sa vue analytique', () => {
    expect(migration).toContain('revoke execute on function public.process_mission_payment(uuid)');
    expect(migration).toContain('from public, anon, authenticated');
    expect(migration).toContain('grant execute on function public.process_mission_payment(uuid) to service_role');
    expect(migration).toContain('with (security_invoker = true)');
    expect(migration).toContain('using ((select public.is_founder()))');
  });

  it('cumule les trois protections idempotentes', () => {
    expect(migration).toContain('where p.application_id = p_application_id');
    expect(migration).toContain('on conflict (application_id) do nothing');
    expect(migration).toContain('wallet_transactions_financial_once');
  });

  it('distingue la simulation interne d un rapprochement externe', () => {
    expect(migration).toContain("'internal', 'simulated'");
    expect(migration).toContain("'released', 'released', 'not_connected'");
    expect(migration).toContain('vat_enabled');
    expect(migration).toContain("'vat_cents', 0");
  });
});
