import { useEffect, useMemo, useState } from 'react';
import { T, FONT, inp } from '@/components/ui/theme';
import { useBodyScrollLock } from '@/components/ui/useBodyScrollLock';
import {
  addStructureValidator,
  getMissionValidationCard,
  issueMissionPin,
  listStructureValidators,
  removeStructureValidator,
  type ActiveMissionPin,
  type MissionValidationCard,
  type StructureValidator,
  type ValidationStep,
} from './missionValidationService';

export function MissionValidationPanel({ missionId, structureId, onClose }: { missionId: string; structureId: string; onClose: () => void }) {
  useBodyScrollLock(true);
  const [card, setCard] = useState<MissionValidationCard | null>(null);
  const [pin, setPin] = useState<ActiveMissionPin | null>(null);
  const [validators, setValidators] = useState<StructureValidator[]>([]);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    Promise.all([getMissionValidationCard(missionId), listStructureValidators(structureId)])
      .then(([nextCard, nextValidators]) => { setCard(nextCard); setValidators(nextValidators); })
      .catch((error: unknown) => setMessage(error instanceof Error ? error.message : 'Chargement impossible.'));
  }, [missionId, structureId]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const seconds = useMemo(() => pin?.expires_at ? Math.max(0, Math.ceil((new Date(pin.expires_at).getTime() - now) / 1000)) : 0, [pin?.expires_at, now]);

  async function generate(step: ValidationStep) {
    setBusy(true); setMessage(null);
    try {
      const next = await issueMissionPin(missionId, step);
      setPin(next);
      if (next.state === 'not_today') setMessage(`Le PIN sera disponible le jour de la mission (${next.first_day}).`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'PIN indisponible.');
    } finally { setBusy(false); }
  }

  async function addValidator() {
    if (!email.trim()) return;
    setBusy(true); setMessage(null);
    try {
      const result = await addStructureValidator(structureId, email.trim());
      if (result.state === 'account_not_found') setMessage('Ce salarié doit d’abord créer son compte UROSI avec cet e-mail.');
      else {
        setEmail('');
        setValidators(await listStructureValidators(structureId));
        setMessage('Employé validateur ajouté.');
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Ajout impossible.'); }
    finally { setBusy(false); }
  }

  return (
    <div className="urosi-modal-layer urosi-bottom-sheet-layer" role="dialog" aria-modal="true" aria-label="QR et PIN de la mission" style={{ background: 'rgba(0,0,0,.82)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', fontFamily: FONT }} onClick={onClose}>
      <div className="urosi-bottom-sheet" style={{ width: '100%', maxWidth: 430, background: T.card, borderRadius: '20px 20px 0 0', padding: '18px 16px calc(24px + env(safe-area-inset-bottom))' }} onClick={(event) => event.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
          <div><div style={{ color: T.text, fontSize: 16, fontWeight: 900 }}>Code de secours</div><div style={{ color: T.sub, fontSize: 11, marginTop: 3 }}>{card?.title ?? 'Chargement…'}</div></div>
          <button aria-label="Fermer" onClick={onClose} style={{ width: 32, height: 32, border: 0, borderRadius: 9, background: T.row, color: T.text, cursor: 'pointer' }}>×</button>
        </div>

        {card && <>
          <div style={{ color: T.sub, fontSize: 11, lineHeight: 1.55, marginBottom: 14 }}>
            Le travailleur affiche son propre QR — un responsable de la structure le scanne pour confirmer sa présence. Génère un code ci-dessous uniquement si le compte qui scanne n'est pas automatiquement reconnu.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <button disabled={busy} onClick={() => generate('start')} style={{ minHeight: 48, border: 0, borderRadius: 11, background: '#fff', color: '#000', fontWeight: 900, cursor: 'pointer' }}>Code arrivée</button>
            <button disabled={busy} onClick={() => generate('end')} style={{ minHeight: 48, border: 0, borderRadius: 11, background: T.grad, color: '#fff', fontWeight: 900, cursor: 'pointer' }}>Code départ</button>
          </div>
        </>}

        {pin?.state === 'active' && pin.pin && (
          <div aria-live="polite" style={{ marginTop: 12, padding: 16, borderRadius: 13, background: T.greenBg, border: `1px solid ${T.greenBorder}`, textAlign: 'center' }}>
            <div style={{ color: T.green, fontSize: 10, fontWeight: 900, textTransform: 'uppercase' }}>Code {pin.step === 'start' ? 'arrivée' : 'départ'}</div>
            <div style={{ color: T.text, fontSize: 36, fontWeight: 900, letterSpacing: 8, margin: '4px 0' }}>{pin.pin}</div>
            <div style={{ color: seconds ? T.sub : T.red, fontSize: 11 }}>{seconds ? `Expire dans ${seconds} s` : 'Code expiré · génère-en un nouveau'}</div>
          </div>
        )}

        {message && <div role="status" style={{ color: message.includes('ajouté') ? T.green : T.amber, fontSize: 11, lineHeight: 1.45, marginTop: 10 }}>{message}</div>}

        <a href="/validation" style={{ display: 'block', marginTop: 14, minHeight: 44, lineHeight: '44px', textAlign: 'center', borderRadius: 10, border: `1px solid ${T.cb}`, background: T.row, color: T.text, fontSize: 11.5, fontWeight: 800, textDecoration: 'none' }}>
          Ouvrir l’accès Employé validateur
        </a>

        <details style={{ marginTop: 18, borderTop: `1px solid ${T.cb}`, paddingTop: 14 }}>
          <summary style={{ color: T.text, fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>Employés validateurs ({validators.length})</summary>
          <p style={{ color: T.sub, fontSize: 10.5, lineHeight: 1.5 }}>Ils voient uniquement ce QR et les PIN. Aucun paiement, statistique ou réglage.</p>
          <div style={{ display: 'flex', gap: 7 }}><input aria-label="E-mail de l’employé" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="employe@structure.fr" style={{ ...inp, margin: 0 }} /><button disabled={busy} onClick={addValidator} style={{ border: 0, borderRadius: 9, padding: '0 13px', background: '#fff', color: '#000', fontWeight: 900 }}>Ajouter</button></div>
          {validators.map((validator) => <div key={validator.user_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '9px 0', borderBottom: `1px solid ${T.cb}` }}><div style={{ minWidth: 0 }}><div style={{ color: T.text, fontSize: 11.5, fontWeight: 800 }}>{validator.full_name || 'Employé'}</div><div style={{ color: T.mu, fontSize: 9.5, overflow: 'hidden', textOverflow: 'ellipsis' }}>{validator.email}</div></div><button onClick={async () => { await removeStructureValidator(structureId, validator.user_id); setValidators((all) => all.filter((item) => item.user_id !== validator.user_id)); }} style={{ border: 0, background: T.redBg, color: T.red, borderRadius: 8, padding: '6px 9px', cursor: 'pointer' }}>Retirer</button></div>)}
        </details>
      </div>
    </div>
  );
}
