// Comportement 4 : après la date, « Alors, ta mission ? » — deux choix, rien de plus.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { fullDateLabel } from './format';

export interface AfterMissionQuestion {
  key: string;
  title: string;
  organization: string;
  date: string | null;
}

export function AfterMissionCard({
  question,
  anonymous,
  onAnswer,
}: {
  question: AfterMissionQuestion;
  anonymous: boolean;
  onAnswer: (went: boolean) => Promise<void>;
}) {
  const [state, setState] = useState<'ask' | 'busy' | 'went' | 'error'>('ask');

  async function answer(went: boolean) {
    setState('busy');
    try {
      await onAnswer(went);
      setState(went ? 'went' : 'ask');
    } catch {
      setState('error');
    }
  }

  if (state === 'went') {
    return (
      <section className="j-ask" aria-live="polite">
        <div className="j-ask-title">Merci !</div>
        {anonymous ? (
          <>
            <p className="j-ask-sub">Crée ton profil pour que cette mission rejoigne ton parcours une fois confirmée par {question.organization}.</p>
            <Link className="pub-btn pub-btn-primary" to="/inscription/participant">Créer mon profil</Link>
          </>
        ) : (
          <p className="j-ask-sub">En attente de confirmation par {question.organization}.</p>
        )}
      </section>
    );
  }

  return (
    <section className="j-ask" aria-label="Alors, ta mission ?">
      <div className="j-ask-title">Alors, ta mission avec {question.organization} ?</div>
      <p className="j-ask-sub">
        {question.title}
        {question.date ? ` · ${fullDateLabel(question.date)}` : ''}
      </p>
      <div className="j-ask-actions">
        <button type="button" className="pub-btn pub-btn-primary" disabled={state === 'busy'} onClick={() => void answer(true)}>
          ✓ J’y suis allé
        </button>
        <button type="button" className="pub-btn pub-btn-ghost" disabled={state === 'busy'} onClick={() => void answer(false)}>
          ✕ Je n’y suis pas allé
        </button>
      </div>
      {state === 'error' && <p className="j-ask-sub" role="alert">Impossible d’enregistrer ta réponse pour le moment. Réessaie plus tard.</p>}
    </section>
  );
}
