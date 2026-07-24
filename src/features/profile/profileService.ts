import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database.types';

export type Profile = Database['public']['Tables']['profiles']['Row'];

export async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateProfile(
  userId: string,
  updates: {
    full_name?: string;
    is_micro_entrepreneur?: boolean;
    city?: string | null;
    phone?: string | null;
    address?: string | null;
    bio?: string | null;
    skills?: string[];
    public_first_name?: string | null;
    show_last_name?: boolean;
  },
) {
  const { error } = await supabase.from('profiles').update(updates).eq('id', userId);
  if (error) throw error;
}

// File d'attente simple : aucune suppression automatique, juste
// l'enregistrement horodaté de la demande pour traitement manuel.
export async function requestAccountDeletion(reason?: string) {
  const { data, error } = await supabase.rpc('request_account_deletion', { p_reason: reason ?? null });
  if (error) throw error;
  return data;
}

const KYC_MAX_FILE_SIZE = 10 * 1024 * 1024;
const KYC_FILE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

export async function uploadIdentityDocument(userId: string, file: File): Promise<{ path: string; name: string }> {
  const extension = KYC_FILE_EXTENSIONS[file.type];
  if (!extension) throw new Error('Format refusé : utilise JPG, PNG, WebP ou PDF.');
  if (file.size <= 0 || file.size > KYC_MAX_FILE_SIZE) throw new Error('Le document doit faire moins de 10 Mo.');

  // Le nom original n'est jamais utilise dans le chemin Storage : il peut
  // contenir des informations personnelles et n'est pas une source fiable.
  const path = `${userId}/${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage.from('kyc-documents').upload(path, file, {
    contentType: file.type,
    upsert: false,
  });
  if (error) {
    // Erreur brute Storage (StorageApiError/StorageUnknownError) : loguée ici
    // pour le diagnostic, propagée telle quelle à l'appelant (jamais remplacée
    // par un message générique).
    console.error('uploadIdentityDocument: storage.upload() a échoué', { path, error });
    throw error;
  }
  return { path, name: file.name.slice(0, 160) };
}

export async function submitWorkerKyc(input: {
  ibanCountry: string;
  ibanLast4: string;
  documentName: string;
  documentPath: string;
}): Promise<Profile> {
  const { data, error } = await supabase.rpc('submit_worker_kyc', {
    p_iban_country: input.ibanCountry,
    p_iban_last4: input.ibanLast4,
    p_document_name: input.documentName,
    p_document_path: input.documentPath,
  });
  if (error) throw error;
  return data as Profile;
}
