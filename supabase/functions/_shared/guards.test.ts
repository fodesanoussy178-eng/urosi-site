// Tests des gardes « mode test » Stripe (module pur, exécuté par Vitest).
//
// Les clés utilisées ici sont des FAUX identifiants de forme valide : aucun
// secret réel n'apparaît dans ce fichier.

import { describe, expect, it } from 'vitest';
import {
  assertNotLiveObject,
  assertTestModeKey,
  isAllowedOrigin,
  isAuthorizedCron,
  isLiveSecretKey,
  isTestMode,
  isTestSecretKey,
  webhookSecrets,
} from './guards.ts';

// Construites dynamiquement pour ne pas déclencher le secret-scanning GitHub :
// ce sont des zéros, pas des clés.
const FAKE_TEST_KEY = ['sk', 'test', '0'.repeat(24)].join('_');
const FAKE_LIVE_KEY = ['sk', 'live', '0'.repeat(24)].join('_');

describe('isTestMode', () => {
  it('est actif par défaut (fail-safe)', () => {
    expect(isTestMode({})).toBe(true);
    expect(isTestMode({ STRIPE_TEST_MODE: 'true' })).toBe(true);
    expect(isTestMode({ STRIPE_TEST_MODE: 'TRUE' })).toBe(true);
    expect(isTestMode({ STRIPE_TEST_MODE: 'garbage' })).toBe(true);
  });

  it("ne se désactive que sur demande explicite", () => {
    expect(isTestMode({ STRIPE_TEST_MODE: 'false' })).toBe(false);
    expect(isTestMode({ STRIPE_TEST_MODE: 'live' })).toBe(false);
    expect(isTestMode({ STRIPE_TEST_MODE: '0' })).toBe(false);
  });
});

describe('détection des clés', () => {
  it('reconnaît les clés live et test', () => {
    expect(isLiveSecretKey(FAKE_LIVE_KEY)).toBe(true);
    expect(isLiveSecretKey('rk_live_x')).toBe(true);
    expect(isLiveSecretKey(FAKE_TEST_KEY)).toBe(false);
    expect(isTestSecretKey(FAKE_TEST_KEY)).toBe(true);
    expect(isTestSecretKey(FAKE_LIVE_KEY)).toBe(false);
  });
});

describe('assertTestModeKey', () => {
  it('refuse une clé live en mode test', () => {
    expect(() =>
      assertTestModeKey({ STRIPE_SECRET_KEY: FAKE_LIVE_KEY, STRIPE_TEST_MODE: 'true' }),
    ).toThrow(/live/i);
  });

  it('refuse une clé de forme inconnue en mode test', () => {
    expect(() =>
      assertTestModeKey({ STRIPE_SECRET_KEY: 'not_a_key', STRIPE_TEST_MODE: 'true' }),
    ).toThrow(/sk_test/);
  });

  it('refuse une clé absente', () => {
    expect(() => assertTestModeKey({})).toThrow(/absent/i);
  });

  it('accepte une clé test en mode test', () => {
    expect(() =>
      assertTestModeKey({ STRIPE_SECRET_KEY: FAKE_TEST_KEY }),
    ).not.toThrow();
  });

  it('accepte une clé live seulement si le mode live est explicitement activé (phase 2)', () => {
    expect(() =>
      assertTestModeKey({ STRIPE_SECRET_KEY: FAKE_LIVE_KEY, STRIPE_TEST_MODE: 'false' }),
    ).not.toThrow();
  });
});

describe('assertNotLiveObject', () => {
  it('refuse livemode=true en mode test', () => {
    expect(() => assertNotLiveObject(true, {})).toThrow(/livemode/i);
  });

  it('accepte livemode=false en mode test', () => {
    expect(() => assertNotLiveObject(false, {})).not.toThrow();
    expect(() => assertNotLiveObject(undefined, {})).not.toThrow();
  });

  it('laisse passer livemode=true quand le mode live est explicitement actif', () => {
    expect(() => assertNotLiveObject(true, { STRIPE_TEST_MODE: 'false' })).not.toThrow();
  });
});

describe('isAllowedOrigin', () => {
  it('accepte les origines UROSI connues', () => {
    expect(isAllowedOrigin('https://urosi.fr', {})).toBe(true);
    expect(isAllowedOrigin('https://app.urosi.fr', {})).toBe(true);
    expect(isAllowedOrigin('http://localhost:5173', {})).toBe(true);
  });

  it("refuse une origine inconnue ou absente", () => {
    expect(isAllowedOrigin('https://evil.example.com', {})).toBe(false);
    expect(isAllowedOrigin(null, {})).toBe(false);
    expect(isAllowedOrigin('https://urosi.fr.evil.com', {})).toBe(false);
  });

  it('accepte la preview configurée via STRIPE_PREVIEW_ORIGIN', () => {
    const env = { STRIPE_PREVIEW_ORIGIN: 'https://urosi-site-git-stripe.vercel.app' };
    expect(isAllowedOrigin('https://urosi-site-git-stripe.vercel.app', env)).toBe(true);
  });

  it('accepte les previews *.vercel.app uniquement en mode test', () => {
    expect(isAllowedOrigin('https://une-preview.vercel.app', {})).toBe(true);
    expect(
      isAllowedOrigin('https://une-preview.vercel.app', { STRIPE_TEST_MODE: 'false' }),
    ).toBe(false);
    // Un sous-domaine forgé ne matche pas le motif strict.
    expect(isAllowedOrigin('https://x.vercel.app.evil.com', {})).toBe(false);
  });
});

describe('webhookSecrets', () => {
  it('renvoie les deux secrets Connect/Compte + le legacy, dans cet ordre', () => {
    expect(
      webhookSecrets({
        STRIPE_CONNECT_WEBHOOK_SECRET: 'whsec_a',
        STRIPE_ACCOUNT_WEBHOOK_SECRET: 'whsec_b',
        STRIPE_WEBHOOK_SECRET: 'whsec_c',
      }),
    ).toEqual(['whsec_a', 'whsec_b', 'whsec_c']);
  });

  it('ignore les secrets absents ou vides', () => {
    expect(webhookSecrets({ STRIPE_WEBHOOK_SECRET: 'whsec_c' })).toEqual(['whsec_c']);
    expect(webhookSecrets({})).toEqual([]);
    expect(webhookSecrets({ STRIPE_CONNECT_WEBHOOK_SECRET: '' })).toEqual([]);
  });
});

describe('isAuthorizedCron', () => {
  const env = { SUPABASE_SERVICE_ROLE_KEY: 'service-role-xyz', STRIPE_CRON_SECRET: 'cron-abc' };

  it('accepte la clé service_role et le secret cron dédié', () => {
    expect(isAuthorizedCron('Bearer service-role-xyz', env)).toBe(true);
    expect(isAuthorizedCron('Bearer cron-abc', env)).toBe(true);
    expect(isAuthorizedCron('cron-abc', env)).toBe(true);
  });

  it('refuse un mauvais secret, un secret vide ou une en-tête absente', () => {
    expect(isAuthorizedCron('Bearer mauvais-secret', env)).toBe(false);
    expect(isAuthorizedCron('', env)).toBe(false);
    expect(isAuthorizedCron(null, env)).toBe(false);
  });

  it("refuse tout quand aucun secret n'est configuré (pas de laissez-passer)", () => {
    expect(isAuthorizedCron('Bearer nimporte', {})).toBe(false);
    expect(isAuthorizedCron('Bearer ', { STRIPE_CRON_SECRET: '' })).toBe(false);
  });
});
