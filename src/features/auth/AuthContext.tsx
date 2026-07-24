import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { fetchProfile, type Profile } from '@/features/profile/profileService';
import { describeError } from '@/lib/errors';

interface AuthContextValue {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  // Le profil a été cherché avec succès mais n'existe pas (compte supprimé
  // côté serveur, ligne jamais créée par le trigger…) — distinct d'une simple
  // erreur réseau/RLS, pour ne jamais confondre les deux à l'écran.
  profileMissing: boolean;
  // Message métier prêt à afficher si la dernière tentative de chargement du
  // profil a échoué (le détail technique part toujours en console).
  profileError: string | null;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// Aucun écran de chargement ne doit rester bloqué indéfiniment : au-delà de
// ce délai, une requête qui ne répond pas est traitée comme une erreur.
const PROFILE_LOAD_TIMEOUT_MS = 12000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Le serveur met trop de temps à répondre.')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileMissing, setProfileMissing] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  async function loadProfile(userId: string) {
    setProfileMissing(false);
    setProfileError(null);
    try {
      let prof = await withTimeout(fetchProfile(userId), PROFILE_LOAD_TIMEOUT_MS);
      if (!prof) {
        // Juste apres l'inscription, la ligne creee par le trigger peut mettre
        // un instant a etre visible : une seconde tentative suffit.
        await new Promise((resolve) => setTimeout(resolve, 800));
        prof = await withTimeout(fetchProfile(userId), PROFILE_LOAD_TIMEOUT_MS);
      }
      setProfile(prof);
      if (!prof) setProfileMissing(true);
    } catch (e) {
      setProfile(null);
      setProfileError(describeError(e, 'le chargement de ton profil'));
    }
  }

  async function bootstrapSession() {
    // getSession() ne fait que relire le stockage local, sans verifier aupres
    // du serveur : un compte supprime ou une session revoquee peut y laisser
    // un jeton perime, indetectable autrement. getUser() force cette
    // verification serveur.
    let userId: string | null = null;
    try {
      const { data, error } = await withTimeout(supabase.auth.getUser(), PROFILE_LOAD_TIMEOUT_MS);
      if (error || !data.user) {
        if (error) console.error('AuthContext: session invalide, déconnexion', error);
        await supabase.auth.signOut().catch((e) => console.error('AuthContext: échec de la déconnexion', e));
        setSession(null);
        setProfile(null);
        return;
      }
      userId = data.user.id;
    } catch (e) {
      console.error('AuthContext: impossible de vérifier la session, déconnexion par précaution', e);
      await supabase.auth.signOut().catch(() => {});
      setSession(null);
      setProfile(null);
      return;
    }

    const { data: sessionData } = await supabase.auth.getSession();
    setSession(sessionData.session ?? null);
    if (sessionData.session) await loadProfile(userId);
  }

  useEffect(() => {
    let active = true;

    bootstrapSession().finally(() => {
      if (active) setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession ?? null);
      if (nextSession) {
        // supabase-js tient un verrou interne pendant ce callback : toute
        // requete lancee ici se bloque (deadlock connu). setTimeout la fait
        // partir apres la liberation du verrou.
        setTimeout(() => {
          if (active) loadProfile(nextSession.user.id);
        }, 0);
      } else {
        setProfile(null);
        setProfileMissing(false);
        setProfileError(null);
      }
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function refreshProfile() {
    if (session) await loadProfile(session.user.id);
  }

  async function signOut() {
    await supabase.auth.signOut().catch((e) => console.error('AuthContext: échec de la déconnexion', e));
    setSession(null);
    setProfile(null);
    setProfileMissing(false);
    setProfileError(null);
  }

  return (
    <AuthContext.Provider value={{ session, profile, loading, profileMissing, profileError, refreshProfile, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
