// Couche de service Stripe côté frontend — MODE TEST.
//
// N'appelle jamais l'API Stripe directement : tout passe par les Edge
// Functions (clé secrète côté serveur). Seule la clé publishable est utilisée
// ici, pour Stripe.js / Elements. Chaque fonction relaie l'appel authentifié
// via supabase.functions.invoke (jeton utilisateur transmis automatiquement).

import type { Stripe } from '@stripe/stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { supabase } from '@/lib/supabase';
import { stripePublishableKey } from '@/lib/env';

let stripePromise: Promise<Stripe | null> | null = null;

/** Charge Stripe.js une seule fois (pour Elements / Identity). */
export function getStripe(): Promise<Stripe | null> {
  if (!stripePublishableKey) return Promise.resolve(null);
  if (!stripePromise) stripePromise = loadStripe(stripePublishableKey);
  return stripePromise;
}

async function invoke<T>(fn: string, body?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(fn, { body: body ?? {} });
  if (error) throw error;
  return data as T;
}

// ── Connect (travailleur) ─────────────────────────────────────────────────

export interface OnboardResult {
  url: string;
  account_id: string;
}

/** Démarre / reprend l'onboarding Express et renvoie l'URL hébergée Stripe. */
export function startConnectOnboarding(returnUrl?: string, refreshUrl?: string) {
  return invoke<OnboardResult>('stripe-connect-onboard', {
    return_url: returnUrl,
    refresh_url: refreshUrl,
  });
}

export interface ConnectStatus {
  onboarded: boolean;
  charges_enabled: boolean;
  payouts_enabled: boolean;
}

/** Rafraîchit l'état du compte connecté (au retour d'onboarding). */
export function refreshConnectStatus() {
  return invoke<ConnectStatus>('stripe-connect-status');
}

export interface StripeBalance {
  onboarded: boolean;
  payouts_enabled?: boolean;
  available_cents: number;
  pending_cents: number;
}

/** Solde Stripe du travailleur (à afficher à la place du wallet simulé). */
export function fetchStripeBalance() {
  return invoke<StripeBalance>('stripe-connect-balance');
}

// ── Paiement d'une mission (structure) ────────────────────────────────────

export interface MissionPaymentIntent {
  client_secret: string;
  amount: number;
  commission_cents?: number;
  reused?: boolean;
}

/** Crée le PaymentIntent de provisionnement d'une mission (montant calculé serveur). */
export function createMissionPayment(applicationId: string) {
  return invoke<MissionPaymentIntent>('stripe-create-payment', { application_id: applicationId });
}

// ── Identity (travailleur) ────────────────────────────────────────────────

export interface IdentityStart {
  client_secret?: string;
  status: string;
  already?: boolean;
}

/** Démarre une vérification d'identité Stripe Identity. */
export function startIdentityVerification() {
  return invoke<IdentityStart>('stripe-identity-start');
}
