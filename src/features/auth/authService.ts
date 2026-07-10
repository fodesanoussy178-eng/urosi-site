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

// Les erreurs Supabase Auth arrivent en anglais : on les traduit pour
// l'utilisateur final au lieu d'afficher le message brut.
function frenchAuthError(error: { message?: string; status?: number }): Error {
  const m = (error.message || '').toLowerCase();
  if (m.includes('invalid login credentials')) return new Error('Email ou mot de passe incorrect.');
  if (m.includes('email not confirmed')) return new Error("Confirme d'abord ton adresse : un lien t'a été envoyé par email.");
  if (m.includes('already registered') || m.includes('already exists')) {
    return new Error('Un compte existe déjà avec cet email — connecte-toi (ou « Mot de passe oublié »).');
  }
  if (m.includes('password should be at least')) return new Error('Mot de passe trop court : 6 caractères minimum.');
  if (m.includes('rate limit') || error.status === 429) return new Error('Trop de tentatives. Réessaie dans une minute.');
  if (m.includes('network') || m.includes('fetch')) return new Error('Connexion impossible. Vérifie ton réseau puis réessaie.');
  return new Error(error.message || 'Une erreur est survenue. Réessaie.');
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
  if (error) throw frenchAuthError(error);
  return data;
}

export async function signIn({ email, password }: SignInInput) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw frenchAuthError(error);
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
