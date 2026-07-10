import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database.types';

export type Wallet = Database['public']['Tables']['wallets']['Row'];
export type WalletTransaction = Database['public']['Tables']['wallet_transactions']['Row'];

export async function fetchWallet(profileId: string): Promise<Wallet | null> {
  const { data, error } = await supabase.from('wallets').select('*').eq('profile_id', profileId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchWalletTransactions(walletId: string, limit = 30): Promise<WalletTransaction[]> {
  const { data, error } = await supabase
    .from('wallet_transactions')
    .select('*')
    .eq('wallet_id', walletId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

// Provisionnement / retrait via l'Edge Function `psp` (abstraction du
// prestataire de paiement : simulation aujourd'hui, Lemonway/Stripe demain).
export async function walletDeposit(amountCents: number): Promise<number> {
  const { data, error } = await supabase.functions.invoke('psp', {
    body: { action: 'deposit', amount_cents: amountCents },
  });
  if (error) throw new Error("Provisionnement impossible pour l'instant.");
  if (data?.error) throw new Error(String(data.error));
  return Number(data.balance_cents);
}

export async function walletWithdraw(amountCents: number): Promise<number> {
  const { data, error } = await supabase.functions.invoke('psp', {
    body: { action: 'withdraw', amount_cents: amountCents },
  });
  if (error) throw new Error("Retrait impossible pour l'instant.");
  if (data?.error) throw new Error(String(data.error));
  return Number(data.balance_cents);
}

export const TX_KIND_LABELS: Record<WalletTransaction['kind'], string> = {
  mission_earning: 'Mission payée',
  bonus: 'Bonus',
  mission_charge: 'Rémunération versée',
  commission: 'Commission UROSI',
  deposit: 'Provisionnement',
  withdrawal: 'Retrait',
  adjustment: 'Ajustement',
};
