// Bouton unique de la carte mission et de la fiche détail (MODULE 3).
//
// Règle : ce bouton n'est JAMAIS grisé ni désactivé pour cause de statut
// manquant. Quand le travailleur n'a pas encore accès aux missions
// rémunérées, il change de libellé et ouvre l'écran de déblocage — il ne
// bloque jamais l'accès sans explication.
import { T } from '@/components/ui/theme';
import type { MissionWithStructure } from '@/features/missions/missionsService';
import type { WorkerAccess } from './useWorkerAccess';

export type MissionActionVariant = 'card' | 'detail';

const VARIANT_STYLE: Record<MissionActionVariant, React.CSSProperties> = {
  card: { borderRadius: 9, padding: '10px 0', fontSize: 13 },
  detail: { borderRadius: 10, padding: '12px 0', fontSize: 14, marginBottom: 12 },
};

export function MissionActionButton({
  mission,
  access,
  busy,
  variant,
  onApply,
  onUnlock,
}: {
  mission: MissionWithStructure;
  access: WorkerAccess;
  busy: boolean;
  variant: MissionActionVariant;
  onApply: () => void;
  onUnlock: () => void;
}) {
  const base = VARIANT_STYLE[variant];
  const locked = !mission.is_solidaire && !access.canApplyToPaid;

  if (locked) {
    return (
      <button
        type="button"
        onClick={onUnlock}
        style={{
          width: '100%',
          background: T.amberBg,
          color: T.text,
          border: `1px solid ${T.amberBorder}`,
          fontWeight: 900,
          cursor: 'pointer',
          ...base,
        }}
      >
        Débloquer les missions rémunérées
      </button>
    );
  }

  const isSolidaire = mission.is_solidaire;
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onApply}
      style={{
        width: '100%',
        background: isSolidaire ? (variant === 'card' ? '#16a34a' : T.green) : '#fff',
        color: isSolidaire ? (variant === 'card' ? '#fff' : '#06100a') : '#000',
        border: 'none',
        fontWeight: 900,
        cursor: busy ? 'wait' : 'pointer',
        opacity: busy ? 0.65 : 1,
        ...base,
      }}
    >
      {busy ? 'Envoi…' : isSolidaire ? 'Participer' : 'Accepter'}
    </button>
  );
}
