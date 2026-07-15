import { supabase } from '@/lib/supabase';
import type { ProfileKycStatus } from '@/types/database.types';

export interface KycSubmission {
  profile_id: string;
  full_name: string;
  kyc_status: ProfileKycStatus;
  kyc_requested_at: string | null;
  kyc_submitted_at: string | null;
  iban_country: string | null;
  iban_last4: string | null;
  identity_document_name: string | null;
  identity_document_path: string | null;
  identity_document_uploaded_at: string | null;
}

export interface KycHistoryEntry {
  id: number;
  previous_status: ProfileKycStatus | null;
  new_status: ProfileKycStatus;
  reason: string | null;
  source: string;
  created_at: string;
}

export async function fetchKycSubmissions(): Promise<KycSubmission[]> {
  const { data, error } = await supabase.rpc('founder_list_kyc_submissions');
  if (error) throw error;
  return (data ?? []) as KycSubmission[];
}

export async function fetchKycHistory(profileId: string): Promise<KycHistoryEntry[]> {
  const { data, error } = await supabase
    .from('kyc_status_history')
    .select('id,previous_status,new_status,reason,source,created_at')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as KycHistoryEntry[];
}

export async function createKycDocumentUrl(profileId: string, path: string): Promise<string> {
  const { error: logError } = await supabase.rpc('log_kyc_document_access', {
    p_profile_id: profileId,
    p_document_path: path,
    p_purpose: 'manual_review',
  });
  if (logError) throw logError;
  const { data, error } = await supabase.storage.from('kyc-documents').createSignedUrl(path, 60);
  if (error) throw error;
  return data.signedUrl;
}

export async function decideKyc(profileId: string, status: 'verified' | 'rejected', reason?: string) {
  const { error } = await supabase.rpc('founder_set_kyc_status', {
    p_profile_id: profileId,
    p_status: status,
    p_reason: reason ?? null,
  });
  if (error) throw error;
}
