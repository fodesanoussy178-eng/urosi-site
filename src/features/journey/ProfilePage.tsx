// Comportement 5 côté participant : les expériences confirmées par une
// structure forment le profil. Pastille verte = confirmée par la structure,
// jamais une simple déclaration.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PublicShell } from '@/components/public/PublicShell';
import { useAuth } from '@/features/auth/AuthContext';
import { removeAvatar, uploadAvatar } from '@/features/participant/participantService';
import { describeError } from '@/lib/errors';
import { durationLabel, fullDateLabel, todayIso, totalHoursLabel } from './format';
import { displayName, fetchMyJourney, setProfileVisibility, updateProfileCity, type JourneyItem } from './journeyService';

export function ProfileAvatar({ name, url, size = 72 }: { name: string; url: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (url && !broken) return <img className="j-avatar" src={url} alt="" width={size} height={size} onError={() => setBroken(true)} />;
  return (
    <span className="j-avatar j-avatar-initial" style={{ width: size, height: size, fontSize: size * 0.4 }} aria-hidden="true">
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

export function ExperienceRow({ title, organization, day, minutes, verified }: { title: string; organization: string; day: string | null; minutes: number | null; verified: boolean }) {
  return (
    <li className={`j-xp${verified ? ' j-xp-verified' : ''}`}>
      <span className="j-xp-dot" aria-hidden="true" />
      <div>
        <div className="j-xp-title">{title}</div>
        <div className="j-xp-org">{organization}</div>
        <div className="j-xp-meta">{[fullDateLabel(day), durationLabel(minutes)].filter(Boolean).join(' · ')}</div>
        <div className="j-xp-status">{verified ? '✓ Participation confirmée' : 'Déclarée par toi · en attente de confirmation'}</div>
      </div>
    </li>
  );
}

export function ProfileSummary({ missions, minutes }: { missions: number; minutes: number }) {
  return (
    <div className="j-summary">
      {missions} mission{missions > 1 ? 's' : ''} · {totalHoursLabel(minutes)}
    </div>
  );
}

export function ProfilePage() {
  const { session, profile, refreshProfile, signOut } = useAuth();
  const userId = session?.user.id ?? null;
  const [items, setItems] = useState<JourneyItem[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingCity, setEditingCity] = useState(false);
  const [city, setCity] = useState(profile?.city ?? '');

  const load = useCallback(async () => {
    if (!userId) return;
    setItems(await fetchMyJourney(userId, todayIso()).catch(() => []));
  }, [userId]);
  useEffect(() => {
    void load();
  }, [load]);

  const verified = useMemo(() => items.filter((i) => i.state === 'verified').sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '')), [items]);
  const declared = useMemo(() => items.filter((i) => i.state === 'declared'), [items]);
  const minutes = verified.reduce((sum, i) => sum + (i.minutes ?? 0), 0);
  const structures = [...new Set(verified.map((i) => i.organization))];
  const name = displayName(profile?.full_name, profile?.public_first_name);
  const [isPublic, setIsPublic] = useState(Boolean(profile?.public_profile));
  useEffect(() => setIsPublic(Boolean(profile?.public_profile)), [profile?.public_profile]);
  const publicUrl = userId ? `${window.location.origin}/p/${userId}` : '';

  async function run(action: () => Promise<void>, done: string) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      await refreshProfile();
      setMessage(done);
    } catch (e) {
      setMessage(describeError(e, 'cette mise à jour'));
    } finally {
      setBusy(false);
    }
  }

  if (!userId) return null;

  return (
    <PublicShell active="profil">
      <div className="pub-wrap j-page j-profile">
        <header className="j-profile-head">
          <label className="j-avatar-edit" title="Changer ma photo">
            <ProfileAvatar name={name} url={profile?.avatar_url ?? null} />
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              aria-label="Changer ma photo"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void run(async () => void (await uploadAvatar(userId, file)), 'Photo mise à jour.');
              }}
            />
          </label>
          <div>
            <h1 className="j-profile-name">{name}</h1>
            {editingCity ? (
              <form
                className="j-city-inline"
                onSubmit={(e) => {
                  e.preventDefault();
                  setEditingCity(false);
                  void run(() => updateProfileCity(userId, city.trim()), 'Ville enregistrée.');
                }}
              >
                <input className="pub-input" aria-label="Ma ville" value={city} onChange={(e) => setCity(e.target.value)} autoFocus />
                <button type="submit" className="pub-btn pub-btn-primary">OK</button>
              </form>
            ) : (
              <button type="button" className="j-where" onClick={() => setEditingCity(true)}>
                📍 {profile?.city || 'Ajouter ma ville'}
              </button>
            )}
            <ProfileSummary missions={verified.length} minutes={minutes} />
          </div>
        </header>

        <section className="j-visibility">
          <label className="j-switch">
            <input
              type="checkbox"
              checked={isPublic}
              disabled={busy}
              onChange={(e) => {
                const next = e.target.checked;
                setIsPublic(next);
                void run(async () => {
                  try {
                    await setProfileVisibility(userId, next);
                  } catch (error) {
                    setIsPublic(!next);
                    throw error;
                  }
                }, next ? 'Ton profil est public.' : 'Ton profil est privé.');
              }}
            />
            <span>Profil public</span>
          </label>
          <p className="j-muted">
            {isPublic ? 'Toute personne ayant le lien voit ton prénom, ta ville et tes expériences confirmées.' : 'Ton profil n’est visible que par toi.'}
          </p>
          {isPublic && (
            <div className="j-share">
              <Link to={`/p/${userId}`}>Voir mon profil public</Link>
              <button type="button" className="pub-btn pub-btn-quiet" onClick={() => void navigator.clipboard?.writeText(publicUrl).then(() => setMessage('Lien copié.'))}>
                Copier le lien
              </button>
            </div>
          )}
        </section>

        {message && <p className="j-muted" role="status">{message}</p>}

        <h2 className="j-h2">Expériences</h2>
        {verified.length === 0 ? (
          <p className="j-muted">Tes missions confirmées par les structures apparaîtront ici.</p>
        ) : (
          <>
            {structures.length > 0 && <p className="j-muted">Engagé·e auprès de : {structures.join(', ')}</p>}
            <ul className="j-xps">
              {verified.map((i) => (
                <ExperienceRow key={i.key} title={i.title} organization={i.organization} day={i.date} minutes={i.minutes} verified />
              ))}
            </ul>
          </>
        )}

        {declared.length > 0 && (
          <>
            <h2 className="j-h2">En attente de confirmation</h2>
            <p className="j-muted">Visible par toi seulement, jusqu’à la confirmation de la structure.</p>
            <ul className="j-xps">
              {declared.map((i) => (
                <ExperienceRow key={i.key} title={i.title} organization={i.organization} day={i.date} minutes={i.minutes} verified={false} />
              ))}
            </ul>
          </>
        )}

        <div className="j-profile-foot">
          <button type="button" className="pub-btn pub-btn-quiet" disabled={busy || !profile?.avatar_url} onClick={() => void run(() => removeAvatar(userId), 'Photo retirée.')}>
            Retirer ma photo
          </button>
          <button type="button" className="pub-btn pub-btn-quiet" onClick={() => void signOut()}>
            Se déconnecter
          </button>
        </div>
      </div>
    </PublicShell>
  );
}
