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
  mergeStripeConfig,
  plausibleEnvValue,
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

describe('plausibleEnvValue / mergeStripeConfig', () => {
  const testEnv = { STRIPE_TEST_MODE: 'true' };

  it('refuse une valeur de la mauvaise famille (erreurs de collage réelles)', () => {
    // Secret webhook collé dans la clé API
    expect(plausibleEnvValue('STRIPE_SECRET_KEY', 'whsec_abc123', testEnv)).toBeUndefined();
    // Commande shell collée à la place du secret cron
    expect(plausibleEnvValue('STRIPE_CRON_SECRET', 'openssl rand -hex 24', testEnv)).toBeUndefined();
    // Clé API collée dans un secret webhook
    expect(plausibleEnvValue('STRIPE_ACCOUNT_WEBHOOK_SECRET', 'sk_test_faux', testEnv)).toBeUndefined();
    // Secret trop court
    expect(plausibleEnvValue('STRIPE_CRON_SECRET', 'court', testEnv)).toBeUndefined();
  });

  it('accepte les valeurs bien formées (avec trim)', () => {
    expect(plausibleEnvValue('STRIPE_SECRET_KEY', ' sk_test_faux123 ', testEnv)).toBe('sk_test_faux123');
    expect(plausibleEnvValue('STRIPE_CONNECT_WEBHOOK_SECRET', 'whsec_faux', testEnv)).toBe('whsec_faux');
    expect(plausibleEnvValue('STRIPE_CRON_SECRET', 'a1b2c3d4e5f6a7b8c9d0', testEnv)).toBe('a1b2c3d4e5f6a7b8c9d0');
  });

  it('refuse une clé live en mode test, l’accepte hors mode test', () => {
    expect(plausibleEnvValue('STRIPE_SECRET_KEY', 'sk_live_faux', testEnv)).toBeUndefined();
    expect(plausibleEnvValue('STRIPE_SECRET_KEY', 'sk_live_faux', { STRIPE_TEST_MODE: 'false' })).toBe('sk_live_faux');
  });

  it('fusionne par clé : env plausible prioritaire, DB en secours', () => {
    const env = {
      STRIPE_TEST_MODE: 'true',
      STRIPE_SECRET_KEY: 'whsec_collé_par_erreur',
      STRIPE_CONNECT_WEBHOOK_SECRET: 'whsec_env_ok',
      STRIPE_CRON_SECRET: 'openssl rand -hex 24',
    };
    const db = {
      STRIPE_SECRET_KEY: 'sk_test_db',
      STRIPE_CONNECT_WEBHOOK_SECRET: 'whsec_db_connect',
      STRIPE_ACCOUNT_WEBHOOK_SECRET: 'whsec_db_account',
      STRIPE_CRON_SECRET: 'secret-cron-db-0123456789',
    };
    const merged = mergeStripeConfig(env, db);
    expect(merged.STRIPE_SECRET_KEY).toBe('sk_test_db'); // env invalide → DB
    expect(merged.STRIPE_CONNECT_WEBHOOK_SECRET).toBe('whsec_env_ok'); // env valide conservée
    expect(merged.STRIPE_ACCOUNT_WEBHOOK_SECRET).toBe('whsec_db_account'); // absent env → DB
    expect(merged.STRIPE_CRON_SECRET).toBe('secret-cron-db-0123456789'); // env invalide → DB
  });
});
