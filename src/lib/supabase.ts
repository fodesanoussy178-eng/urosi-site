import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.types';
import { isSupabaseConfigured, supabaseAnonKey, supabaseUrl } from './env';

export const supabase = createClient<Database>(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-key',
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } },
);

export { isSupabaseConfigured };
