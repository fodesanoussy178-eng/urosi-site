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
  // Un SIRET au format valide n'est jamais une preuve d'existence : hors
  // bypass fondateur, la structure reste 'pending' (valeur par defaut en
  // base) jusqu'a la verification officielle (requestStructureVerification).
  const isFounderBypass = verification?.verificationStatus === 'founder_bypass';
  const payload: StructureInsert = {
    owner_id: ownerId,
    name,
    siret: siret || null,
    is_ess: isEss ?? false,
    ...(isFounderBypass
      ? {
          verification_status: 'founder_bypass' as const,
          verification_method: 'founder' as const,
          founder_bypass: true,
          verified_at: new Date().toISOString(),
        }
      : {}),
  };

  const { data, error } = await supabase.from('structures').insert(payload).select('*').single();
  if (error) throw error;
  return data;
}

export async function updateStructureAbout(structureId: string, about: string): Promise<void> {
  const { error } = await supabase.from('structures').update({ about: about || null }).eq('id', structureId);
  if (error) throw error;
}

// Presentation librement modifiable par le proprietaire : jamais issue du
// registre officiel (contrairement a name/siret/adresse officielle...).
export async function updateStructurePresentation(
  structureId: string,
  updates: { trade_name?: string | null; logo_url?: string | null },
): Promise<void> {
  const { error } = await supabase.from('structures').update(updates).eq('id', structureId);
  if (error) throw error;
}

// (Re)soumission d'un SIRET par le proprietaire : le format (Luhn) n'est
// qu'un pre-filtre cote serveur, jamais une preuve d'existence. Repasse la
// structure en 'pending' — il faut ensuite appeler requestStructureVerification.
export async function submitStructureSiret(structureId: string, siret: string): Promise<Structure> {
  const { data, error } = await supabase.rpc('resubmit_structure_siret', { p_structure_id: structureId, p_siret: siret });
  if (error) throw error;
  return data as Structure;
}

export interface StructureVerificationResult {
  status: 'verified' | 'pending' | 'closed' | 'not_found';
  message: string;
}

// Appelle l'edge function verify-structure : l'appel au registre officiel se
// fait UNIQUEMENT cote serveur, jamais directement depuis le navigateur.
export async function requestStructureVerification(structureId: string): Promise<StructureVerificationResult> {
  const { data, error } = await supabase.functions.invoke('verify-structure', { body: { structureId } });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data as StructureVerificationResult;
}
