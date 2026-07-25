// Source unique de vérité côté client pour l'accès aux missions rémunérées
// (MODULE 3 — déblocage des missions rémunérées). Aucun composant ne
// recalcule cet état par lui-même.
//
// Rappel : ce hook pilote l'affichage. Le verrou réel est la policy RLS
// "applications: worker apply" (migration 20260725250000). L'interface
// n'est jamais le seul garde-fou — un appel API direct est refusé cote base.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { startConnectOnboarding } from '@/features/payments/stripeService';
import type { WorkerPaidStatus } from '@/types/database.types';

export type { WorkerPaidStatus as PaidStatus };

export interface UnlockStep {
  key: string;
  label: string;
  done: boolean;
}

export interface WorkerAccess {
  loading: boolean;
  paidStatus: WorkerPaidStatus;
  canApplyToPaid: boolean;
  /** Stripe redemande des pièces après un déblocage déjà obtenu. */
  isRegression: boolean;
  siret: string | null;
  siretVerified: boolean;
  siretAwaitingPropagation: boolean;
  stripeOnboardingNeeded: boolean;
  solidaireCount: number;
  steps: UnlockStep[];
  refresh: () => Promise<void>;
  startStripeOnboarding: () => Promise<void>;
}

interface AccessProfile {
  paid_status: WorkerPaidStatus;
  siret: string | null;
  siret_verified_at: string | null;
  stripe_account_id: string | null;
  stripe_payouts_enabled: boolean;
  stripe_requirements_pending: boolean;
  unlocked_at: string | null;
}

export function useWorkerAccess(): WorkerAccess {
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<AccessProfile | null>(null);
  const [solidaireCount, setSolidaireCount] = useState(0);

  const load = useCallback(async () => {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) {
      setLoading(false);
      return;
    }

    const [{ data: p }, { count }] = await Promise.all([
      supabase
        .from('profiles')
        .select(
          'paid_status, siret, siret_verified_at, stripe_account_id, ' +
            'stripe_payouts_enabled, stripe_requirements_pending, unlocked_at',
        )
        .eq('id', auth.user.id)
        .single(),
      supabase
        .from('applications')
        .select('id, missions!inner(is_solidaire)', { count: 'exact', head: true })
        .eq('worker_id', auth.user.id)
        .eq('status', 'completed')
        .eq('missions.is_solidaire', true),
    ]);

    setProfile((p as AccessProfile | null) ?? null);
    setSolidaireCount(count ?? 0);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();

    // Le déblocage arrive par webhook Stripe (account.updated), pas par une
    // action de l'utilisateur : on écoute la ligne pour que le bouton
    // bascule sans rechargement manuel.
    let channel: ReturnType<typeof supabase.channel> | null = null;
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth?.user) return;
      channel = supabase
        .channel(`profile-access:${auth.user.id}`)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${auth.user.id}` },
          () => void load(),
        )
        .subscribe();
    })();

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, [load]);

  const startStripeOnboarding = useCallback(async () => {
    const { url } = await startConnectOnboarding();
    if (url) window.location.href = url;
  }, []);

  return useMemo(() => {
    const paidStatus: WorkerPaidStatus = profile?.paid_status ?? 'solidaire_only';
    const siretVerified = Boolean(profile?.siret_verified_at);
    const stripeReady = Boolean(profile?.stripe_payouts_enabled);

    const steps: UnlockStep[] = [
      { key: 'account', label: 'Compte créé', done: true },
      {
        key: 'solidaire',
        label:
          solidaireCount > 0
            ? `${solidaireCount} mission${solidaireCount > 1 ? 's' : ''} solidaire${solidaireCount > 1 ? 's' : ''} réalisée${solidaireCount > 1 ? 's' : ''}`
            : 'Première mission solidaire',
        done: solidaireCount > 0,
      },
      { key: 'cv', label: 'CV vivant en construction', done: solidaireCount > 0 },
      { key: 'siret', label: "Activité d'indépendant créée", done: siretVerified },
      { key: 'stripe', label: 'Compte de paiement activé', done: stripeReady },
    ];

    return {
      loading,
      paidStatus,
      canApplyToPaid: paidStatus === 'paid_eligible',
      isRegression: Boolean(profile?.unlocked_at) && Boolean(profile?.stripe_requirements_pending) && !stripeReady,
      siret: profile?.siret ?? null,
      siretVerified,
      siretAwaitingPropagation: Boolean(profile?.siret) && !siretVerified,
      stripeOnboardingNeeded: siretVerified && !stripeReady,
      solidaireCount,
      steps,
      refresh: load,
      startStripeOnboarding,
    };
  }, [loading, profile, solidaireCount, load, startStripeOnboarding]);
}
