// Profil public (/p/:id) : visible seulement si la personne l'a choisi, et
// uniquement ses expériences confirmées par une structure.
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PublicShell } from '@/components/public/PublicShell';
import { fetchPublicProfile, type PublicProfile } from './journeyService';
import { ExperienceRow, ProfileAvatar, ProfileSummary } from './ProfilePage';

export function PublicProfilePage() {
  const { id = '' } = useParams();
  const [profile, setProfile] = useState<PublicProfile | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    fetchPublicProfile(id)
      .then((p) => alive && setProfile(p))
      .catch(() => alive && setProfile(null));
    return () => {
      alive = false;
    };
  }, [id]);

  if (profile === undefined) {
    return (
      <PublicShell>
        <div className="pub-wrap j-page" aria-busy="true" />
      </PublicShell>
    );
  }

  if (!profile) {
    return (
      <PublicShell>
        <div className="pub-wrap j-page">
          <div className="j-empty">
            <p>Ce profil n’est pas public.</p>
            <Link className="pub-btn pub-btn-primary" to="/missions">Voir les missions</Link>
          </div>
        </div>
      </PublicShell>
    );
  }

  const structures = [...new Set(profile.experiences.map((x) => x.organization))];
  return (
    <PublicShell>
      <div className="pub-wrap j-page j-profile">
        <header className="j-profile-head">
          <ProfileAvatar name={profile.name} url={profile.avatar_url} />
          <div>
            <h1 className="j-profile-name">{profile.name}</h1>
            {profile.city && <div className="j-muted">📍 {profile.city}</div>}
            <ProfileSummary missions={profile.missions} minutes={profile.minutes} />
          </div>
        </header>
        {structures.length > 0 && <p className="j-muted">Engagé·e auprès de : {structures.join(', ')}</p>}
        <h2 className="j-h2">Expériences</h2>
        {profile.experiences.length === 0 ? (
          <p className="j-muted">Aucune expérience confirmée pour l’instant.</p>
        ) : (
          <ul className="j-xps">
            {profile.experiences.map((x, i) => (
              <ExperienceRow key={i} title={x.title} organization={x.organization} day={x.day} minutes={x.minutes} verified />
            ))}
          </ul>
        )}
        <p className="j-muted j-legend">🟢 La structure a confirmé que cette personne a réalisé cette mission à cette date.</p>
      </div>
    </PublicShell>
  );
}
