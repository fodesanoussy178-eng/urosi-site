// Comportement 5 (mission d'une plateforme partenaire) : la structure reçoit
// un lien et confirme en un geste, sans compte UROSI.
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { PublicShell } from '@/components/public/PublicShell';
import { answerParticipationRequest, fetchParticipationRequest, type ParticipationRequest } from './journeyService';
import { fullDateLabel } from './format';

export function ConfirmParticipationPage() {
  const { token = '' } = useParams();
  const [request, setRequest] = useState<ParticipationRequest | null | undefined>(undefined);
  const [answer, setAnswer] = useState<'confirmed' | 'denied' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetchParticipationRequest(token)
      .then((r) => {
        setRequest(r);
        setAnswer(r?.answer ?? null);
      })
      .catch(() => setRequest(null));
  }, [token]);

  async function respond(confirmed: boolean) {
    setBusy(true);
    setError(false);
    try {
      setAnswer(await answerParticipationRequest(token, confirmed));
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <PublicShell minimal>
      <div className="pub-wrap j-page j-confirm">
        {request === undefined && <div aria-busy="true" />}
        {request === null && (
          <div className="j-empty">
            <p>Ce lien de confirmation n’est pas valide.</p>
          </div>
        )}
        {request && (
          <div className="pub-card j-confirm-card">
            <h1 className="j-confirm-title">
              {request.participant} indique avoir réalisé la mission « {request.mission_title} »
              {request.mission_date ? ` le ${fullDateLabel(request.mission_date)}` : ''}.
            </h1>
            <p className="j-muted">{[request.organization_name, request.city].filter(Boolean).join(' · ')}</p>
            {answer ? (
              <p className="j-cta-done" role="status">
                {answer === 'confirmed' ? '✓ Merci, la participation est confirmée.' : 'Merci, c’est noté : la participation n’est pas confirmée.'}
              </p>
            ) : (
              <>
                <p className="j-confirm-question">Pouvez-vous confirmer sa participation ?</p>
                <div className="j-ask-actions">
                  <button type="button" className="pub-btn pub-btn-primary" disabled={busy} onClick={() => void respond(true)}>
                    ✓ Oui, a participé
                  </button>
                  <button type="button" className="pub-btn pub-btn-ghost" disabled={busy} onClick={() => void respond(false)}>
                    ✕ Non
                  </button>
                </div>
                {error && <p className="j-error" role="alert">Réponse impossible pour le moment. Réessayez plus tard.</p>}
              </>
            )}
          </div>
        )}
      </div>
    </PublicShell>
  );
}
