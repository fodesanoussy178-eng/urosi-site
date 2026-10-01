import { useNavigate } from 'react-router-dom';
import { PublicShell } from '@/components/public/PublicShell';
import { Icon } from '@/components/public/icons';
import { sceneSvg } from '@/features/missions/categoryScene';
import { features } from '@/lib/features';

// Choix du rôle (maquette phase 0) : deux grandes cartes illustrées.
function RoleCard({
  icon,
  title,
  text,
  scene,
  onClick,
}: {
  icon: 'user' | 'building';
  title: [string, string];
  text: string;
  scene: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="pub-role" onClick={onClick} aria-label={`${title[0]} ${title[1]}`}>
      <div className="pub-role-text">
        <span className="pub-role-icon"><Icon name={icon} size={22} color="#1d5fe6" /></span>
        <h2>
          {title[0]}
          <br />
          {title[1]}
        </h2>
        <p>{text}</p>
      </div>
      {/* Illustration statique générée par UROSI. */}
      <div className="pub-role-art" aria-hidden="true" dangerouslySetInnerHTML={{ __html: scene }} />
      <span className="pub-role-go" aria-hidden="true"><Icon name="arrowRight" size={20} color="#fff" /></span>
    </button>
  );
}

export function EntryPage() {
  const nav = useNavigate();
  return (
    <PublicShell minimal>
      <div className="pub-wrap" style={{ maxWidth: 980, paddingTop: 44, paddingBottom: 20 }}>
        <div style={{ textAlign: 'center', marginBottom: 30 }}>
          <span className="pub-kicker">Missions solidaires · Métropole de Lille</span>
          <h1 className="pub-h1">Comment souhaitez-vous utiliser UROSI ?</h1>
          <p className="pub-lede">Deux espaces, un même objectif : plus d’engagement, plus d’impact près de chez vous.</p>
        </div>
        <div className="pub-roles">
          <RoleCard
            icon="user"
            title={['Je cherche', 'des missions']}
            text="Découvrir des missions solidaires près de chez moi et construire mon parcours."
            scene={sceneSvg('soutien_scolaire', 'role-participant')}
            onClick={() => nav('/inscription/participant')}
          />
          <RoleCard
            icon="building"
            title={['Je cherche', 'des bénévoles']}
            text="Publier des missions solidaires et rencontrer des personnes motivées pour agir sur le terrain."
            scene={sceneSvg('aide_alimentaire', 'role-structure')}
            onClick={() => nav('/inscription/structure')}
          />
        </div>
        <div style={{ textAlign: 'center', marginTop: 26, display: 'grid', gap: 10, justifyItems: 'center' }}>
          <button type="button" className="pub-btn pub-btn-quiet" onClick={() => nav('/connexion')} style={{ color: '#1d5fe6' }}>
            Déjà un compte ? <strong style={{ textDecoration: 'underline' }}>Se connecter</strong>
          </button>
          <div style={{ display: 'flex', gap: 18, fontSize: 13.5, color: '#4a5a72', flexWrap: 'wrap', justifyContent: 'center' }}>
            <button type="button" onClick={() => nav('/missions')} style={{ background: 'none', border: 'none', color: 'inherit', font: 'inherit', fontWeight: 700, cursor: 'pointer' }}>
              Voir les missions sans compte →
            </button>
            {features.paidLayer && (
              <button type="button" onClick={() => nav('/demo?role=worker')} style={{ background: 'none', border: 'none', color: 'inherit', font: 'inherit', fontWeight: 700, cursor: 'pointer' }}>
                Voir la démo
              </button>
            )}
          </div>
        </div>
      </div>
    </PublicShell>
  );
}
