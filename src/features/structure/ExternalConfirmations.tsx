// Missions publiées par la structure sur une plateforme partenaire (même
// SIREN) : les bénévoles qui déclarent y être allés attendent une réponse.
// Confirmation en un clic, directement dans UROSI. Rien n'est affiché s'il
// n'y a aucune demande.
import { useCallback, useEffect, useState } from 'react';
import { T } from '@/components/ui/theme';
import { supabase } from '@/lib/supabase';

interface Pending {
  id: string;
  participant: string;
  mission_title: string;
  mission_date: string | null;
}

export function ExternalConfirmations({ onDone }: { onDone: (message: string) => void }) {
  const [items, setItems] = useState<Pending[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('structure_pending_external_confirmations');
    setItems(error ? [] : ((data as unknown as Pending[]) ?? []));
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function answer(item: Pending, confirmed: boolean) {
    setBusy(item.id);
    const { error } = await supabase.rpc('structure_answer_external_participation', { p_application_id: item.id, p_confirmed: confirmed });
    setBusy(null);
    onDone(error ? 'Réponse impossible pour le moment.' : confirmed ? 'Participation confirmée.' : 'C’est noté.');
    await load();
  }

  if (items.length === 0) return null;
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {items.map((item) => (
        <div key={item.id} role="note" style={{ background: T.greenBg, border: `1px solid ${T.greenBorder}`, borderRadius: 10, padding: '10px 12px', fontSize: 11.5, color: T.text, lineHeight: 1.5 }}>
          <strong>{item.participant}</strong> indique avoir réalisé la mission « {item.mission_title} »
          {item.mission_date ? ` le ${new Date(`${item.mission_date}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}` : ''}. Pouvez-vous confirmer sa participation ?
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 8 }}>
            <button disabled={busy === item.id} onClick={() => void answer(item, true)} style={{ background: T.green, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 0', fontSize: 11.5, fontWeight: 800, cursor: 'pointer' }}>
              ✓ Oui, a participé
            </button>
            <button disabled={busy === item.id} onClick={() => void answer(item, false)} style={{ background: T.card, color: T.red, border: `1px solid ${T.redBorder}`, borderRadius: 8, padding: '9px 0', fontSize: 11.5, fontWeight: 800, cursor: 'pointer' }}>
              ✕ Non
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
