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
    bio?: string | null;
    skills?: string[];
  },
) {
  const { error } = await supabase.from('profiles').update(updates).eq('id', userId);
  if (error) throw error;
}
