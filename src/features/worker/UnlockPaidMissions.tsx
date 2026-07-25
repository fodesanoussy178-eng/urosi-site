// Écran de déblocage des missions rémunérées (MODULE 3). C'est le point de
// conversion le plus important du parcours indépendant : c'est ici que les
// gens passent ou décrochent.
//
// Contraintes rédactionnelles, à ne pas assouplir :
//   - vocabulaire de déblocage, jamais d'interdiction ni de refus ;
//   - dire que la création est GRATUITE (idée fausse principale) ;
//   - dire honnêtement que des cotisations sociales s'appliquent, sinon la
//     personne le découvre à sa première paie et se sent trompée ;
//   - UROSI oriente, elle n'accompagne pas : ne jamais écrire « nous pouvons
//     t'aider à créer ton activité », UROSI n'a pas d'agrément ;
//   - sortie « continuer en solidaire » toujours offerte, sans culpabilisation.
import { useState } from 'react';
import { T, FONT, inp } from '@/components/ui/theme';
import { supabase } from '@/lib/supabase';
import { describeError } from '@/lib/errors';
import type { WorkerAccess } from './useWorkerAccess';

export function UnlockPaidMissions({ access, onClose }: { access: WorkerAccess; onClose: () => void }) {
  const [siret, setSiret] = useState(access.siret ?? '');
  const [feedback, setFeedback] = useState<{ kind: 'pending' | 'error' | 'ok'; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submitSiret() {
    setBusy(true);
    setFeedback(null);
    try {
      const { data, error } = await supabase.functions.invoke('verify-siret', {
        body: { siret: siret.replace(/\s/g, '') },
      });

      if (error) {
        setFeedback({ kind: 'error', message: describeError(error, 'la vérification de ton SIRET') });
        return;
      }

      if (data.status === 'verified') {
        await access.refresh();
        if (data.next_step === 'stripe_onboarding') {
          await access.startStripeOnboarding();
        }
        return;
      }

      // "pending" n'est pas une erreur : le SIRET vient d'être créé et n'est
      // pas encore propagé dans Sirene. Jamais "SIRET invalide" dans ce cas.
      setFeedback({ kind: data.status === 'pending' ? 'pending' : 'error', message: data.message });
      await access.refresh();
    } catch (cause) {
      setFeedback({ kind: 'error', message: describeError(cause, 'la vérification de ton SIRET') });
    } finally {
      setBusy(false);
    }
  }

  const remaining = access.steps.filter((s) => !s.done).length;
  const siretDigits = siret.replace(/\s/g, '');

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Débloquer les missions rémunérées"
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 2000, overflowY: 'auto' }}
      onClick={onClose}
    >
      <div style={{ width: '100%', maxWidth: 460, background: T.card, borderRadius: '20px 20px 0 0', padding: '20px 18px 28px', fontFamily: FONT, margin: 'auto 0' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
          <h2 style={{ fontSize: 17, fontWeight: 900, color: T.text, margin: 0 }}>Débloque les missions rémunérées</h2>
          <button onClick={onClose} style={{ background: T.row, border: 'none', borderRadius: 6, width: 26, height: 26, cursor: 'pointer', color: T.sub, fontSize: 14, flexShrink: 0 }}>×</button>
        </div>
        <p style={{ color: T.sub, fontSize: 12, lineHeight: 1.55, marginTop: 0 }}>
          Tu peux déjà participer aux missions solidaires et construire ton CV vivant. Pour recevoir des paiements sur
          UROSI, une activité d'indépendant est nécessaire.
        </p>

        <ol aria-label="Progression du déblocage" style={{ marginTop: 14, padding: 0, listStyle: 'none', display: 'grid', gap: 7 }}>
          {access.steps.map((step) => (
            <li key={step.key} style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 12, color: step.done ? T.sub : T.text, fontWeight: step.done ? 500 : 800 }}>
              <span aria-hidden="true">{step.done ? '✅' : '⬜'}</span>
              <span>{step.label}</span>
            </li>
          ))}
        </ol>

        <p style={{ marginTop: 12, fontSize: 12, fontWeight: 800, color: T.cyan }}>
          {remaining === 0
            ? '➡️ Tes missions rémunérées sont débloquées.'
            : remaining === 1
              ? "➡️ Plus qu'une étape et les missions rémunérées deviennent accessibles immédiatement."
              : `➡️ Encore ${remaining} étapes et les missions rémunérées deviennent accessibles immédiatement.`}
        </p>

        {access.isRegression && (
          <div style={{ marginTop: 12, background: T.amberBg, border: `1px solid ${T.amberBorder}`, borderRadius: 12, padding: 13 }}>
            <div style={{ fontWeight: 900, fontSize: 12.5, color: T.text }}>Une information complémentaire est demandée</div>
            <p style={{ marginTop: 4, fontSize: 11.5, color: T.sub, lineHeight: 1.5 }}>
              Notre prestataire de paiement a besoin d'un élément supplémentaire pour continuer à te verser tes
              missions. Tes missions et ton CV vivant sont intacts.
            </p>
            <button onClick={() => void access.startStripeOnboarding()} style={{ marginTop: 8, background: T.text, color: T.bg, border: 'none', borderRadius: 9, padding: '9px 16px', fontSize: 12, fontWeight: 900, cursor: 'pointer' }}>
              Compléter
            </button>
          </div>
        )}

        <section style={{ marginTop: 16 }}>
          <h3 style={{ fontSize: 12, fontWeight: 900, color: T.text, margin: 0 }}>Pourquoi cette étape ?</h3>
          <p style={{ marginTop: 6, fontSize: 11.5, color: T.sub, lineHeight: 1.55 }}>
            Les missions rémunérées nécessitent un statut d'indépendant pour que les paiements puissent être
            effectués légalement. On te demande cette démarche uniquement au moment où elle devient utile, pour
            éviter toute complexité inutile à l'inscription.
          </p>
        </section>

        <section style={{ marginTop: 12, background: T.row, border: `1px solid ${T.cb}`, borderRadius: 12, padding: 13 }}>
          <h3 style={{ fontSize: 12, fontWeight: 900, color: T.text, margin: 0 }}>Ce que ça coûte</h3>
          <p style={{ marginTop: 6, fontSize: 11.5, color: T.sub, lineHeight: 1.55 }}>
            Créer une micro-entreprise est <strong style={{ color: T.text }}>gratuite</strong>. Les cotisations
            sociales ne s'appliquent que sur ce que tu gagnes : sans revenu, tu ne paies rien.
          </p>
          <p style={{ marginTop: 6, fontSize: 11.5, color: T.sub, lineHeight: 1.55 }}>
            Sur une mission à 120 €, il te restera environ 95 € après cotisations sociales. UROSI ne prélève rien sur
            ta rémunération.
          </p>
          <p style={{ marginTop: 6, fontSize: 10, color: T.mu, lineHeight: 1.5 }}>
            Si tu as entre 18 et 25 ans, si tu es au RSA ou inscrit à France Travail, l'ACRE réduit tes cotisations la
            première année.
          </p>
        </section>

        {!access.siretVerified && (
          <section style={{ marginTop: 16 }}>
            <label htmlFor="siret-input" style={{ fontSize: 12, fontWeight: 900, color: T.text }}>
              Tu as déjà ton numéro SIRET ?
            </label>
            <div style={{ display: 'flex', gap: 7, marginTop: 8 }}>
              <input
                id="siret-input"
                inputMode="numeric"
                autoComplete="off"
                value={siret}
                onChange={(e) => setSiret(e.target.value)}
                placeholder="14 chiffres"
                aria-describedby={feedback ? 'siret-feedback' : undefined}
                style={{ ...inp, flex: 1 }}
              />
              <button
                type="button"
                onClick={() => void submitSiret()}
                disabled={busy || siretDigits.length !== 14}
                style={{ background: T.text, color: T.bg, border: 'none', borderRadius: 9, padding: '0 18px', fontSize: 12, fontWeight: 900, cursor: busy || siretDigits.length !== 14 ? 'not-allowed' : 'pointer', opacity: busy || siretDigits.length !== 14 ? 0.5 : 1 }}
              >
                {busy ? '…' : 'Vérifier'}
              </button>
            </div>
            {feedback && (
              <p id="siret-feedback" role="status" style={{ marginTop: 8, fontSize: 11.5, lineHeight: 1.5, color: feedback.kind === 'error' ? T.red : feedback.kind === 'pending' ? T.amber : T.green }}>
                {feedback.message}
              </p>
            )}
          </section>
        )}

        <section style={{ marginTop: 16, background: T.row, border: `1px solid ${T.cb}`, borderRadius: 12, padding: 13 }}>
          <h3 style={{ fontSize: 12, fontWeight: 900, color: T.text, margin: 0 }}>Besoin d'aide ?</h3>
          <p style={{ marginTop: 6, fontSize: 11.5, color: T.sub, lineHeight: 1.55 }}>
            Si tu es accompagné par une Mission Locale ou un autre organisme, ils peuvent t'aider gratuitement à créer
            ton activité. La BGE et l'ADIE proposent aussi cet accompagnement.
          </p>
          <a
            href="https://formalites.entreprises.gouv.fr"
            target="_blank"
            rel="noreferrer noopener"
            style={{ marginTop: 9, display: 'inline-flex', background: T.card, border: `1px solid ${T.cb}`, borderRadius: 9, padding: '9px 16px', fontSize: 12, fontWeight: 900, color: T.text, textDecoration: 'none' }}
          >
            Commencer les démarches
          </a>
        </section>

        <button
          type="button"
          onClick={onClose}
          style={{ width: '100%', marginTop: 16, background: 'none', border: 'none', color: T.sub, fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: '10px 0' }}
        >
          Continuer en solidaire
        </button>
      </div>
    </div>
  );
}
