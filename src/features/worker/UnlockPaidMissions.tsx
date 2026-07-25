// Écran de déblocage des missions rémunérées (MODULE 3). C'est le point de
// conversion le plus important du parcours indépendant : c'est ici que les
// gens passent ou décrochent.
//
// Contraintes rédactionnelles, à ne pas assouplir :
//   - vocabulaire de déblocage, jamais d'interdiction ni de refus ;
//   - dire que la création est GRATUITE (idée fausse principale) ;
//   - dire honnêtement que des cotisations s'appliquent, SANS donner de taux
//     ou de simulation nette figés (ça varie selon activité/régime/dispositifs
//     et se périme) — renvoyer vers l'information officielle à jour ;
//   - UROSI oriente, elle n'accompagne pas : ne jamais écrire « nous pouvons
//     t'aider à créer ton activité », UROSI n'a pas d'agrément ;
//   - la mission solidaire est une rampe d'accès FACULTATIVE, jamais un
//     prérequis au déblocage : ne jamais laisser entendre qu'il faut
//     travailler gratuitement avant d'avoir le droit d'être payé ;
//   - sortie « continuer avec les missions solidaires » toujours offerte,
//     sans culpabilisation.
import { useRef, useState } from 'react';
import { T, FONT, inp } from '@/components/ui/theme';
import { supabase } from '@/lib/supabase';
import { describeError } from '@/lib/errors';
import type { WorkerAccess } from './useWorkerAccess';

export function UnlockPaidMissions({ access, onClose }: { access: WorkerAccess; onClose: () => void }) {
  const [siret, setSiret] = useState(access.siret ?? '');
  const [feedback, setFeedback] = useState<{ kind: 'pending' | 'error' | 'ok'; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const siretInputRef = useRef<HTMLInputElement>(null);

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

  function handlePrimaryCta() {
    if (access.stripeOnboardingNeeded) {
      void access.startStripeOnboarding();
      return;
    }
    siretInputRef.current?.focus();
    siretInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  const primaryLabel = access.stripeOnboardingNeeded ? 'Continuer le déblocage' : 'Commencer le déblocage';
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
          Tu peux utiliser UROSI et participer aux missions solidaires sans créer immédiatement une activité
          indépendante. Pour accepter une mission rémunérée et recevoir un paiement, tu dois disposer d'un statut
          professionnel compatible et terminer la vérification des paiements.
        </p>

        <div style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 900, color: T.text, marginBottom: 6 }}>
            <span>Déblocage des missions rémunérées</span>
            <span>{access.progressPercent} %</span>
          </div>
          <div role="progressbar" aria-valuenow={access.progressPercent} aria-valuemin={0} aria-valuemax={100} style={{ height: 8, borderRadius: 999, background: T.row, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${access.progressPercent}%`, background: T.green, transition: 'width .3s', borderRadius: 999 }} />
          </div>
          <ol aria-label="Étapes nécessaires au déblocage" style={{ marginTop: 10, padding: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
            {access.steps.map((step) => (
              <li key={step.key} style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 12, color: step.done ? T.sub : T.text, fontWeight: step.done ? 500 : 800 }}>
                <span aria-hidden="true" style={{ color: step.done ? T.green : T.mu }}>{step.done ? '✓' : '○'}</span>
                <span>{step.label}</span>
              </li>
            ))}
          </ol>
        </div>

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

        {access.canApplyToPaid ? (
          <div style={{ marginTop: 14, background: T.greenBg, border: `1px solid ${T.greenBorder}`, borderRadius: 12, padding: 13 }}>
            <div style={{ fontWeight: 900, fontSize: 12.5, color: T.text }}>Missions rémunérées débloquées</div>
            <p style={{ marginTop: 4, fontSize: 11.5, color: T.sub, lineHeight: 1.5 }}>
              Tu peux maintenant postuler aux missions rémunérées, en plus des missions solidaires.
            </p>
            <button onClick={onClose} style={{ marginTop: 8, background: T.text, color: T.bg, border: 'none', borderRadius: 9, padding: '9px 16px', fontSize: 12, fontWeight: 900, cursor: 'pointer' }}>
              Fermer
            </button>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 8, marginTop: 14 }}>
            <button
              type="button"
              onClick={handlePrimaryCta}
              style={{ width: '100%', background: T.text, color: T.bg, border: 'none', borderRadius: 10, padding: '12px 0', fontSize: 13.5, fontWeight: 900, cursor: 'pointer' }}
            >
              {primaryLabel}
            </button>
            <button
              type="button"
              onClick={onClose}
              style={{ width: '100%', background: 'none', border: 'none', color: T.sub, fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: '4px 0' }}
            >
              Continuer avec les missions solidaires
            </button>
          </div>
        )}

        <section style={{ marginTop: 16 }}>
          <h3 style={{ fontSize: 12, fontWeight: 900, color: T.text, margin: 0 }}>Pourquoi cette étape ?</h3>
          <p style={{ marginTop: 6, fontSize: 11.5, color: T.sub, lineHeight: 1.55 }}>
            Les missions rémunérées impliquent des obligations administratives et sociales. UROSI ne te demande ces
            démarches qu'au moment où elles deviennent réellement utiles.
          </p>
        </section>

        <section style={{ marginTop: 12 }}>
          <h3 style={{ fontSize: 12, fontWeight: 900, color: T.text, margin: 0 }}>Missions solidaires</h3>
          <p style={{ marginTop: 6, fontSize: 11.5, color: T.sub, lineHeight: 1.55 }}>
            Les missions solidaires te permettent, si tu le souhaites, de découvrir UROSI, développer ton CV vivant et
            obtenir tes premières expériences. Elles ne sont pas obligatoires pour débloquer les missions rémunérées.
          </p>
          {access.solidaireCount > 0 && (
            <p style={{ marginTop: 6, fontSize: 11.5, fontWeight: 800, color: T.green }}>
              Tu as déjà réalisé {access.solidaireCount} mission{access.solidaireCount > 1 ? 's' : ''} solidaire
              {access.solidaireCount > 1 ? 's' : ''}.
            </p>
          )}
        </section>

        <section style={{ marginTop: 12, background: T.row, border: `1px solid ${T.cb}`, borderRadius: 12, padding: 13 }}>
          <h3 style={{ fontSize: 12, fontWeight: 900, color: T.text, margin: 0 }}>Ce que ça coûte</h3>
          <p style={{ marginTop: 6, fontSize: 11.5, color: T.sub, lineHeight: 1.55 }}>
            Créer une micro-entreprise est <strong style={{ color: T.text }}>gratuite</strong>.
          </p>
          <p style={{ marginTop: 6, fontSize: 11.5, color: T.sub, lineHeight: 1.55 }}>
            Des cotisations sociales et, selon ta situation, d'autres prélèvements peuvent s'appliquer sur les sommes
            encaissées. Leur montant dépend de ton activité et de ton régime.
          </p>
          <a
            href="https://www.autoentrepreneur.urssaf.fr"
            target="_blank"
            rel="noreferrer noopener"
            style={{ marginTop: 8, display: 'inline-flex', background: T.card, border: `1px solid ${T.cb}`, borderRadius: 9, padding: '8px 14px', fontSize: 11.5, fontWeight: 900, color: T.text, textDecoration: 'none' }}
          >
            Consulter les informations officielles
          </a>
        </section>

        {!access.siretVerified && (
          <section style={{ marginTop: 16 }}>
            <label htmlFor="siret-input" style={{ fontSize: 12, fontWeight: 900, color: T.text }}>
              Tu as déjà ton numéro SIRET ?
            </label>
            <div style={{ display: 'flex', gap: 7, marginTop: 8 }}>
              <input
                id="siret-input"
                ref={siretInputRef}
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
          <h3 style={{ fontSize: 12, fontWeight: 900, color: T.text, margin: 0 }}>Besoin d'être orienté ?</h3>
          <p style={{ marginTop: 6, fontSize: 11.5, color: T.sub, lineHeight: 1.55 }}>
            Tu peux te rapprocher de ta Mission Locale, de la BGE, de l'ADIE ou du guichet unique des formalités pour
            obtenir des informations sur la création de ton activité.
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
      </div>
    </div>
  );
}
