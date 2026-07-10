import { supabase } from '@/lib/supabase';
import type { ProfileRole } from '@/types/database.types';

export interface SignUpInput {
  email: string;
  password: string;
  fullName: string;
  role: ProfileRole;
  city?: string;
  phone?: string;
  structureName?: string;
  siret?: string;
  isEss?: boolean;
}

export interface SignInInput {
  email: string;
  password: string;
}

export async function signUp({ email, password, fullName, role, city, phone, structureName, siret, isEss }: SignUpInput) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
        role,
        city: city ?? null,
        phone: phone ?? null,
        structure_name: structureName ?? null,
        siret: siret ?? null,
        is_ess: isEss ?? false,
      },
    },
  });
  if (error) throw error;
  return data;
}

export async function signIn({ email, password }: SignInInput) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

// Envoie l'email de reinitialisation. L'URL /reinitialisation doit etre dans
// la liste des Redirect URLs du projet Supabase (cf. SETUP.md).
export async function requestPasswordReset(email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reinitialisation`,
  });
  if (error) throw error;
}

export async function updatePassword(newPassword: string) {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}
