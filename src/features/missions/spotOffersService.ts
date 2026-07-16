import { supabase } from '@/lib/supabase';

// Offres de place (liste d'attente) : la table mission_spot_offers est
// deny-all, tout passe par les RPC de la migration 20260716140000. Les RPC
// ne sont pas dans les types generes : cast local, comme founderAdminService.
const rpc = supabase.rpc.bind(supabase) as unknown as (
  name: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

export interface SpotOffer {
  id: string;
  mission_id: string;
  application_id: string;
  expires_at: string;
  mission_title: string;
  city: string | null;
  scheduled_date: string | null;
  start_time: string | null;
}

export type SpotOfferResponseState =
  | 'accepted'
  | 'declined'
  | 'expired'
  | 'already_handled'
  | 'application_not_pending'
  | 'capacity_full'
  | 'not_found';

export async function fetchMySpotOffers(): Promise<SpotOffer[]> {
  const { data, error } = await rpc('list_my_spot_offers');
  if (error) throw new Error(error.message);
  return (data ?? []) as SpotOffer[];
}

export async function respondToSpotOffer(offerId: string, accept: boolean): Promise<SpotOfferResponseState> {
  const { data, error } = await rpc('respond_to_spot_offer', { p_offer_id: offerId, p_accept: accept });
  if (error) throw new Error(error.message);
  return ((data as { state?: string } | null)?.state ?? 'not_found') as SpotOfferResponseState;
}
