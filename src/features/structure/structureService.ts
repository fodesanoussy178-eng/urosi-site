import { supabase } from '@/lib/supabase';
import type { Structure } from '@/features/missions/types';
import type { Database, StructureVerificationMethod, StructureVerificationStatus } from '@/types/database.types';

export async function fetchMyStructures(ownerId: string): Promise<Structure[]> {
  const { data, error } = await supabase.from('structures').select('*').eq('owner_id', ownerId).order('created_at');
  if (error) throw error;
  return data ?? [];
}

type StructureInsert = Database['public']['Tables']['structures']['Insert'];

export interface StructureVerificationOptions {
  verificationStatus?: StructureVerificationStatus;
  verificationMethod?: StructureVerificationMethod;
  founderBypass?: boolean;
}

export async function createStructure(
  ownerId: string,
  name: string,
  siret?: string,
  isEss?: boolean,
  verification?: StructureVerificationOptions,
): Promise<Structure> {
  const now = new Date().toISOString();
  const payload: StructureInsert = {
    owner_id: ownerId,
    name,
    siret: siret || null,
    is_ess: isEss ?? false,
    verification_status: verification?.verificationStatus ?? (siret ? 'verified' : 'pending'),
    verification_method: verification?.verificationMethod ?? 'siret',
    founder_bypass: verification?.founderBypass ?? false,
    siret_verified_at: siret ? now : null,
    verified_at: verification?.verificationStatus === 'verified' || verification?.verificationStatus === 'founder_bypass' || siret ? now : null,
  };

  const insert = await supabase
    .from('structures')
    .insert(payload)
    .select('*')
    .single();

  if (insert.error && /verification_|founder_bypass|verified_at|siret_verified_at/i.test(insert.error.message)) {
    const fallback = await supabase
      .from('structures')
      .insert({ owner_id: ownerId, name, siret: siret || null, is_ess: isEss ?? false })
      .select('*')
      .single();
    if (fallback.error) throw fallback.error;
    return fallback.data;
  }

  const { data, error } = insert;
  if (error) throw error;
  return data;
}

export async function updateStructureAbout(structureId: string, about: string): Promise<void> {
  const { error } = await supabase.from('structures').update({ about: about || null }).eq('id', structureId);
  if (error) throw error;
}

// Active l'abonnement de la structure (requis pour publier des missions).
// MVP : activation immediate ; le paiement recurrent passera par le PSP.
export async function subscribeStructure(structureId: string): Promise<void> {
  const { error } = await supabase.rpc('subscribe_structure', { p_structure_id: structureId });
  if (error) throw error;
}
