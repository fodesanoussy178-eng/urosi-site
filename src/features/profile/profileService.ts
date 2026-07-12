import { supabase } from '@/lib/supabase';
import type { Database, ProfileKycStatus } from '@/types/database.types';

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
    bio?: string | null;
    skills?: string[];
    kyc_status?: ProfileKycStatus;
    kyc_requested_at?: string | null;
    kyc_submitted_at?: string | null;
    iban_country?: string | null;
    iban_last4?: string | null;
    identity_document_name?: string | null;
    identity_document_path?: string | null;
    identity_document_uploaded_at?: string | null;
  },
) {
  const { error } = await supabase.from('profiles').update(updates).eq('id', userId);
  if (error) throw error;
}

export async function uploadIdentityDocument(userId: string, file: File): Promise<{ path: string; name: string }> {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-90) || 'identity-document';
  const path = `${userId}/${Date.now()}-${safeName}`;
  const { error } = await supabase.storage.from('kyc-documents').upload(path, file, {
    contentType: file.type || undefined,
    upsert: false,
  });
  if (error) throw error;
  return { path, name: file.name };
}
