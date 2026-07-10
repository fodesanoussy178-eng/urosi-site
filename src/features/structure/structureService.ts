import { supabase } from '@/lib/supabase';
import type { Structure } from '@/features/missions/types';

export async function fetchMyStructures(ownerId: string): Promise<Structure[]> {
  const { data, error } = await supabase.from('structures').select('*').eq('owner_id', ownerId).order('created_at');
  if (error) throw error;
  return data ?? [];
}

export async function createStructure(ownerId: string, name: string, siret?: string, isEss?: boolean): Promise<Structure> {
  const { data, error } = await supabase
    .from('structures')
    .insert({ owner_id: ownerId, name, siret: siret || null, is_ess: isEss ?? false })
    .select('*')
    .single();
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
