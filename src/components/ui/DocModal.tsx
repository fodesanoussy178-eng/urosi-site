import { T, FONT } from './theme';

// Textes issus du prototype v0.5, completes par la clause de notation
// bidirectionnelle non bloquante.
const DOCS = {
  cgu: {
    titre: '📄 CGU — l’essentiel',
    blocs: [
      ['Modèle mandataire', "UROSI est une plateforme de mise en relation. Tu agis en travailleur indépendant mandataire. UROSI ne fixe pas tes conditions de travail et ne crée aucun lien de subordination."],
      ['Missions', "Tu es libre de refuser, d'ignorer ou d'annuler une mission, sans conséquence sur ton accès. L'annulation prévient la structure à titre informatif uniquement."],
      ['Présence', 'Le code QR est un journal de présence : il est validé par la structure sur place et ne conditionne pas ton accès aux missions.'],
      ['Notation', "Après chaque mission, le travailleur note la structure et la structure note le travailleur. Ces notes sont réciproques, informatives et jamais bloquantes : elles n'entrent dans aucun filtre d'accès aux missions et sont contestables (RGPD Art. 22)."],
      ['Résiliation', 'Tu peux supprimer ton compte à tout moment ; tes données sont anonymisées sous 30 jours. contact@urosi.fr'],
    ],
  },
  rgpd: {
    titre: '🔒 RGPD — l’essentiel',
    blocs: [
      ['Responsable du traitement', 'UROSI (SASU) · dpo@urosi.fr'],
      ['Données collectées', 'Identité de contact et données de missions (historique, présence, horaires, notes réciproques).'],
      ['Décisions automatisées', 'UROSI ne calcule aucun score ni classement déterminant l’accès aux missions. Le flux est trié par date. Les notes sont informatives et contestables.'],
      ['Tes droits', 'Accès, rectification, effacement, portabilité, opposition. dpo@urosi.fr · Réclamation : cnil.fr'],
    ],
  },
} as const;

export type DocKey = keyof typeof DOCS;

export function DocModal({ dk, onClose }: { dk: DocKey; onClose: () => void }) {
  const d = DOCS[dk];
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 500, padding: 16 }} onClick={onClose}>
      <div style={{ width: '100%', maxWidth: 380, maxHeight: '85vh', background: T.card, border: `1px solid ${T.cb}`, borderRadius: 16, display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: FONT }} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: '14px 16px', borderBottom: `1px solid ${T.cb}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: T.text }}>{d.titre}</span>
          <button onClick={onClose} style={{ background: T.row, border: 'none', borderRadius: 6, width: 24, height: 24, cursor: 'pointer', color: T.sub, fontSize: 13 }}>×</button>
        </div>
        <div style={{ overflowY: 'auto', padding: '14px 16px 6px' }}>
          {d.blocs.map(([h, p], i) => (
            <div key={i} style={{ marginBottom: 13 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: T.text, marginBottom: 3 }}>{h}</div>
              <div style={{ fontSize: 11, color: T.sub, lineHeight: 1.6 }}>{p}</div>
            </div>
          ))}
        </div>
        <div style={{ padding: '10px 16px 16px', borderTop: `1px solid ${T.cb}`, flexShrink: 0 }}>
          <button onClick={onClose} style={{ width: '100%', background: T.row, color: T.sub, border: 'none', borderRadius: 8, padding: '10px 0', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}

export function AideRegles({ onOpen }: { onOpen: (k: DocKey) => void }) {
  return (
    <div style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 12, padding: 13 }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: T.mu, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 9 }}>Aide & règles</div>
      {(
        [
          ['cgu', '📄 Conditions Générales (CGU)'],
          ['rgpd', '🔒 Données personnelles (RGPD)'],
        ] as [DocKey, string][]
      ).map(([k, l]) => (
        <button key={k} onClick={() => onOpen(k)} style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: T.row, border: 'none', borderRadius: 8, padding: '10px 12px', marginBottom: 6, fontSize: 12, color: T.text, fontWeight: 600, cursor: 'pointer' }}>
          <span>{l}</span>
          <span style={{ color: T.mu }}>Lire →</span>
        </button>
      ))}
    </div>
  );
}
