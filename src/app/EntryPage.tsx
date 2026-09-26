import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Logo } from '@/components/ui/Logo';
import { FONT } from '@/components/ui/theme';
import { features } from '@/lib/features';

// Choix du rôle (maquette phase 0). Visuels dessinés en CSS/SVG : aucune
// photo de personne réelle n'est utilisée.
function RoleCard({
  emoji,
  title,
  text,
  accent,
  onClick,
  children,
}: {
  emoji: string;
  title: ReactNode;
  text: string;
  accent: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="role-choice-card"
      style={{
        position: 'relative',
        overflow: 'hidden',
        textAlign: 'left',
        border: accent ? 'none' : '1px solid rgba(255,255,255,.14)',
        borderRadius: 18,
        padding: '18px 18px 0',
        cursor: 'pointer',
        color: '#fff',
        background: accent ? 'linear-gradient(160deg, #0891b2 0%, #1d4ed8 100%)' : 'linear-gradient(160deg, #13233a 0%, #0b1424 100%)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 270,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <span aria-hidden="true" style={{ fontSize: 24 }}>{emoji}</span>
        <span aria-hidden="true" style={{ width: 32, height: 32, borderRadius: '50%', background: accent ? '#fff' : 'rgba(255,255,255,.12)', color: accent ? '#0891b2' : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900 }}>→</span>
      </div>
      <div style={{ fontSize: 20, fontWeight: 900, lineHeight: 1.15, margin: '12px 0 8px' }}>{title}</div>
      <div style={{ fontSize: 12.5, lineHeight: 1.55, color: accent ? '#e0f7fb' : '#b7c3d3', maxWidth: 260 }}>{text}</div>
      <div style={{ marginTop: 'auto' }}>{children}</div>
    </button>
  );
}

function Skyline() {
  return (
    <svg viewBox="0 0 300 90" width="100%" height="90" aria-hidden="true" style={{ display: 'block', marginTop: 16 }}>
      <path d="M0 90 V62 H22 V48 H34 V62 H52 V40 H62 V30 H66 V40 H76 V62 H98 V52 H118 V62 H138 V18 L144 6 L150 18 V62 H170 V46 H192 V62 H214 V36 H232 V62 H254 V50 H276 V62 H300 V90 Z" fill="rgba(255,255,255,.18)" />
      <path d="M0 90 V74 H40 V68 H80 V76 H130 V70 H190 V78 H240 V70 H300 V90 Z" fill="rgba(255,255,255,.12)" />
    </svg>
  );
}

function People() {
  return (
    <svg viewBox="0 0 300 90" width="100%" height="90" aria-hidden="true" style={{ display: 'block', marginTop: 16 }}>
      {[40, 95, 150, 205, 260].map((x, i) => (
        <g key={x} fill={i % 2 ? 'rgba(255,255,255,.22)' : 'rgba(34,211,238,.35)'}>
          <circle cx={x} cy={38 - (i % 2) * 6} r={12} />
          <path d={`M${x - 20} 90 Q${x - 20} ${56 - (i % 2) * 6} ${x} ${56 - (i % 2) * 6} Q${x + 20} ${56 - (i % 2) * 6} ${x + 20} 90 Z`} />
        </g>
      ))}
    </svg>
  );
}

export function EntryPage() {
  const nav = useNavigate();
  return (
    <div style={{ minHeight: '100vh', background: 'radial-gradient(circle at 20% 0%, #12304a 0%, #0a0f1c 55%)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT, padding: '28px 16px' }}>
      <div style={{ width: '100%', maxWidth: 640, textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 6 }}>
          <Logo sz={64} />
        </div>
        <div style={{ fontSize: 12.5, color: '#9fb0c4', marginBottom: 24 }}>Missions solidaires · Métropole de Lille</div>
        <div className="role-choice-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
          <RoleCard
            emoji="🙋"
            title={<>Je cherche<br />des missions</>}
            text="Découvrir des missions solidaires près de chez moi et construire mon parcours."
            accent={false}
            onClick={() => nav('/inscription/participant')}
          >
            <People />
          </RoleCard>
          <RoleCard
            emoji="🏢"
            title={<>Je cherche<br />des bénévoles</>}
            text="Publier des missions et rencontrer des personnes motivées pour agir sur le terrain."
            accent
            onClick={() => nav('/inscription/structure')}
          >
            <Skyline />
          </RoleCard>
        </div>
        <button type="button" onClick={() => nav('/connexion')} style={{ marginTop: 22, background: 'none', border: 'none', cursor: 'pointer', fontSize: 12.5, color: '#67e8f9', textDecoration: 'underline', fontWeight: 800 }}>
          Déjà un compte ? Se connecter
        </button>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginTop: 10 }}>
          <button type="button" onClick={() => nav('/missions')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11.5, color: '#9fb0c4', fontWeight: 700 }}>
            Voir les missions sans compte
          </button>
          {features.paidLayer && (
            <button type="button" onClick={() => nav('/demo?role=worker')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11.5, color: '#9fb0c4', fontWeight: 700 }}>
              Voir la démo
            </button>
          )}
        </div>
        <button type="button" onClick={() => window.location.assign('/')} style={{ marginTop: 10, background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#7f8ea3', fontWeight: 600 }}>
          ← Retour à l'accueil
        </button>
      </div>
    </div>
  );
}
