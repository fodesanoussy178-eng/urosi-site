import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database.types';

export type Wallet = Database['public']['Tables']['wallets']['Row'];
export type WalletTransaction = Database['public']['Tables']['wallet_transactions']['Row'];
export type WalletFundSummary = Database['public']['Functions']['wallet_fund_summary']['Returns'][number];

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

export async function fetchWalletFundSummary(): Promise<WalletFundSummary> {
  const { data, error } = await supabase.rpc('wallet_fund_summary');
  if (error) throw error;
  return data?.[0] ?? { available_cents: 0, pending_cents: 0, blocked_cents: 0 };
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
