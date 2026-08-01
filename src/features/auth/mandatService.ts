import { supabase } from '@/lib/supabase';
import type { ProfileRole } from '@/types/database.types';

// Doit correspondre a la colonne `version` de la migration de reference
// (supabase/migrations/20260801175646_mandat_acceptances.sql). has_active_mandat()
// cote base ignore volontairement cette valeur : changer MANDAT_VERSION ici ne
// revoque aucun mandat deja accepte, ca ne fait que dater les nouvelles acceptations.
export const MANDAT_VERSION = '2026-08-01';

export async function fetchHasActiveMandat(): Promise<boolean> {
  const { data, error } = await supabase.rpc('has_active_mandat');
  if (error) throw error;
  return Boolean(data);
}

export async function acceptMandat(role: ProfileRole): Promise<void> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  const userId = userData.user?.id;
  if (!userId) throw new Error('Authentification requise.');

  const { error } = await supabase.from('mandat_acceptances').insert({
    user_id: userId,
    role,
    version: MANDAT_VERSION,
  });
  if (error) throw error;
}
