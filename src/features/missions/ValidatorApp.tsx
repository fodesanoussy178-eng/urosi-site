import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Logo } from '@/components/ui/Logo';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { T, FONT } from '@/components/ui/theme';
import { issueMissionPin, listValidatorMissions, type ActiveMissionPin, type MissionValidationCard, type ValidationStep } from './missionValidationService';

export function ValidatorApp() {
  const [missions, setMissions] = useState<MissionValidationCard[]>([]);
  const [selected, setSelected] = useState<MissionValidationCard | null>(null);
  const [pin, setPin] = useState<ActiveMissionPin | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => { listValidatorMissions().then((items) => { setMissions(items); setSelected(items[0] ?? null); }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Accès impossible.')); }, []);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);

  async function generate(step: ValidationStep) {
    if (!selected) return;
    setError(null);
    try { const value = await issueMissionPin(selected.mission_id, step); setPin(value); if (value.state === 'not_today') setError('Le PIN est disponible uniquement le jour de la mission.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'PIN indisponible.'); }
  }
  const seconds = pin?.expires_at ? Math.max(0, Math.ceil((new Date(pin.expires_at).getTime() - now) / 1000)) : 0;

  return <main style={{ minHeight: '100dvh', background: T.bg, color: T.text, fontFamily: FONT, padding: 'calc(16px + env(safe-area-inset-top)) 16px calc(24px + env(safe-area-inset-bottom))', boxSizing: 'border-box' }}><div style={{ maxWidth: 430, margin: '0 auto' }}>
    <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}><div style={{ display: 'flex', alignItems: 'center', gap: 9 }}><Logo sz={38} /><div><div style={{ fontWeight: 900, fontSize: 14 }}>Validation présence</div><div style={{ color: T.sub, fontSize: 9.5 }}>Accès employé limité</div></div></div><ThemeToggle /></header>
    {missions.length > 1 && <select aria-label="Choisir une mission" value={selected?.mission_id} onChange={(event) => { setSelected(missions.find((item) => item.mission_id === event.target.value) ?? null); setPin(null); }} style={{ width: '100%', padding: 12, borderRadius: 10, background: T.row, border: `1px solid ${T.cb}`, color: T.text, marginBottom: 12 }}>{missions.map((mission) => <option key={mission.mission_id} value={mission.mission_id}>{mission.title} · {mission.scheduled_date}</option>)}</select>}
    {!selected ? <div style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 15, padding: 20, color: T.sub, fontSize: 12, lineHeight: 1.5 }}>Aucune mission à valider. Le responsable de la structure doit t’ajouter avec l’e-mail de ce compte.</div> : <div style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 16, padding: 16, textAlign: 'center' }}>
      <div style={{ fontSize: 15, fontWeight: 900 }}>{selected.title}</div><div style={{ fontSize: 10.5, color: T.sub, margin: '3px 0 13px' }}>{selected.structure_name} · {selected.city} · {selected.scheduled_date}</div>
      <div style={{ color: T.sub, fontSize: 11, lineHeight: 1.5, marginBottom: 13 }}>
        Le travailleur affiche son propre QR sur son téléphone — scanne-le pour confirmer sa présence. Le code ci-dessous n'est qu'un <strong>secours</strong> si le compte scannant n'est pas reconnu automatiquement.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}><button onClick={() => generate('start')} style={{ minHeight: 50, border: 0, borderRadius: 11, background: '#fff', color: '#000', fontWeight: 900 }}>Code de secours arrivée</button><button onClick={() => generate('end')} style={{ minHeight: 50, border: 0, borderRadius: 11, background: T.grad, color: '#fff', fontWeight: 900 }}>Code de secours départ</button></div>
      {pin?.state === 'active' && pin.pin && <div style={{ marginTop: 13, padding: 14, background: T.greenBg, border: `1px solid ${T.greenBorder}`, borderRadius: 12 }}><div style={{ color: T.green, fontSize: 9.5, fontWeight: 900 }}>CODE {pin.step === 'start' ? 'ARRIVÉE' : 'DÉPART'}</div><div style={{ fontSize: 36, fontWeight: 900, letterSpacing: 7 }}>{pin.pin}</div><div style={{ color: seconds ? T.sub : T.red, fontSize: 10.5 }}>{seconds ? `${seconds} secondes` : 'Expiré'}</div></div>}
    </div>}
    {error && <div role="alert" style={{ color: T.red, background: T.redBg, border: `1px solid ${T.redBorder}`, borderRadius: 10, padding: 10, fontSize: 11, marginTop: 10 }}>{error}</div>}
    <div style={{ marginTop: 14, color: T.mu, fontSize: 10, lineHeight: 1.5 }}>Cet accès ne permet pas de voir les paiements, statistiques, paramètres ni de modifier une mission.</div><Link to="/" style={{ display: 'inline-block', marginTop: 16, color: T.sub, fontSize: 10.5 }}>Quitter</Link>
  </div></main>;
}
