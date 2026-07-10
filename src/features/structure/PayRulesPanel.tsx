import { useCallback, useEffect, useState } from 'react';
import { T, inp } from '@/components/ui/theme';
import { Fld } from '@/components/ui/Fld';
import { formatEuros } from '@/lib/format';
import type { PayRuleKind } from '@/types/database.types';
import {
  RULE_KINDS,
  RULE_TEMPLATES,
  createPayRule,
  deletePayRule,
  fetchPayRules,
  ruleParamsSummary,
  togglePayRule,
  type PayRule,
  type PayRuleInsert,
} from '@/features/pricing/pricingService';

function euros(cents: number): string {
  return formatEuros(cents).replace(' EUR', ' €');
}

const DAY_NAMES: [number, string][] = [
  [1, 'Lun'],
  [2, 'Mar'],
  [3, 'Mer'],
  [4, 'Jeu'],
  [5, 'Ven'],
  [6, 'Sam'],
  [7, 'Dim'],
];

const SECTORS = ['restauration', 'vente', 'logistique', 'evenementiel', 'nettoyage', 'manutention', 'administratif', 'autre'];

// Administration des regles de remuneration intelligente : chaque regle
// ajuste automatiquement la remuneration a la publication (jour, ferie,
// horaire, duree, secteur, difficulte, urgence, distance, tension, bonus).
export function PayRulesPanel({ structureId, notif }: { structureId: string; notif: (m: string) => void }) {
  const [rules, setRules] = useState<PayRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    try {
      setRules(await fetchPayRules(structureId));
    } catch {
      notif('Impossible de charger les règles.');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structureId]);

  useEffect(() => {
    load();
  }, [load]);

  async function addTemplate(tpl: Omit<PayRuleInsert, 'structure_id'>) {
    try {
      await createPayRule({ ...tpl, structure_id: structureId });
      await load();
      notif(`✓ Règle « ${tpl.label} » activée.`);
    } catch (e) {
      notif(e instanceof Error ? e.message : 'Création impossible.');
    }
  }

  async function toggle(rule: PayRule) {
    try {
      await togglePayRule(rule.id, !rule.active);
      setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, active: !rule.active } : r)));
    } catch {
      notif('Action impossible.');
    }
  }

  async function remove(rule: PayRule) {
    try {
      await deletePayRule(rule.id);
      setRules((prev) => prev.filter((r) => r.id !== rule.id));
      notif('Règle supprimée.');
    } catch {
      notif('Suppression impossible.');
    }
  }

  const existingLabels = new Set(rules.map((r) => r.label));
  const suggestions = RULE_TEMPLATES.filter((t) => !existingLabels.has(t.label));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 10, color: T.sub, lineHeight: 1.55 }}>
        La rémunération de tes missions s'ajuste automatiquement selon ces règles. Le détail (base + majorations) est
        affiché en toute transparence au travailleur.
      </div>

      {loading && <div style={{ fontSize: 11, color: T.mu, textAlign: 'center', padding: 16 }}>Chargement…</div>}

      {!loading && rules.length === 0 && (
        <div style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 12, padding: '16px 14px', fontSize: 11, color: T.mu, textAlign: 'center', lineHeight: 1.6 }}>
          Aucune règle pour l'instant : tes missions sont publiées au tarif de base.
          <br />
          Active un modèle ci-dessous ou crée ta règle.
        </div>
      )}

      {rules.map((r) => (
        <div key={r.id} style={{ background: T.card, border: `1px solid ${r.active ? '#0e7490' : T.cb}`, borderRadius: 12, padding: '12px 14px', opacity: r.active ? 1 : 0.6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 12.5, fontWeight: 800, color: T.text }}>{r.label}</div>
              <div style={{ fontSize: 9.5, color: T.mu, marginTop: 2 }}>
                {RULE_KINDS[r.kind].label}
                {ruleParamsSummary(r.kind, r.params) ? ` · ${ruleParamsSummary(r.kind, r.params)}` : ''}
              </div>
            </div>
            <span style={{ fontSize: 13, fontWeight: 900, color: T.green, flexShrink: 0 }}>
              {r.adjust_pct !== 0 && `+${r.adjust_pct} %`}
              {r.adjust_pct !== 0 && r.adjust_cents !== 0 && ' '}
              {r.adjust_cents !== 0 && `+${euros(r.adjust_cents)}`}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 9 }}>
            <button onClick={() => toggle(r)} style={{ flex: 1, background: r.active ? T.row : T.greenBg, color: r.active ? T.sub : T.green, border: `1px solid ${r.active ? T.cb : T.greenBorder}`, borderRadius: 7, padding: '7px 0', fontSize: 10.5, fontWeight: 700, cursor: 'pointer' }}>
              {r.active ? 'Mettre en pause' : 'Réactiver'}
            </button>
            <button onClick={() => remove(r)} style={{ background: T.redBg, color: T.red, border: `1px solid ${T.redBorder}`, borderRadius: 7, padding: '7px 12px', fontSize: 10.5, fontWeight: 700, cursor: 'pointer' }}>
              Supprimer
            </button>
          </div>
        </div>
      ))}

      {suggestions.length > 0 && (
        <>
          <div style={{ fontSize: 9, fontWeight: 800, color: T.mu, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 }}>Modèles en un clic</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {suggestions.map((t) => (
              <button
                key={t.label}
                onClick={() => addTemplate(t)}
                style={{ textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, background: T.row, border: `1px dashed ${T.cb}`, borderRadius: 10, padding: '10px 13px', cursor: 'pointer' }}
              >
                <span style={{ fontSize: 11.5, fontWeight: 700, color: T.text }}>＋ {t.label}</span>
                <span style={{ fontSize: 11, fontWeight: 900, color: T.cyan, flexShrink: 0 }}>
                  {t.adjust_pct ? `+${t.adjust_pct} %` : ''}
                  {t.adjust_cents ? `+${euros(t.adjust_cents)}` : ''}
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      {showForm ? (
        <CustomRuleForm
          structureId={structureId}
          onCreated={async (label) => {
            setShowForm(false);
            await load();
            notif(`✓ Règle « ${label} » créée.`);
          }}
          onCancel={() => setShowForm(false)}
          notif={notif}
        />
      ) : (
        <button onClick={() => setShowForm(true)} style={{ width: '100%', background: 'none', border: `1px solid ${T.cb}`, borderRadius: 10, padding: '11px 0', fontSize: 12, fontWeight: 800, color: T.sub, cursor: 'pointer' }}>
          ⚙ Créer une règle personnalisée
        </button>
      )}
    </div>
  );
}

function CustomRuleForm({
  structureId,
  onCreated,
  onCancel,
  notif,
}: {
  structureId: string;
  onCreated: (label: string) => void;
  onCancel: () => void;
  notif: (m: string) => void;
}) {
  const [kind, setKind] = useState<PayRuleKind>('day_of_week');
  const [label, setLabel] = useState('');
  const [pct, setPct] = useState(10);
  const [cents, setCents] = useState(0);
  const [days, setDays] = useState<number[]>([6, 7]);
  const [from, setFrom] = useState('21:00');
  const [to, setTo] = useState('06:00');
  const [minMinutes, setMinMinutes] = useState(240);
  const [sectors, setSectors] = useState<string[]>(['restauration']);
  const [minLevel, setMinLevel] = useState(3);
  const [minKm, setMinKm] = useState(10);
  const [minRatio, setMinRatio] = useState(2);
  const [busy, setBusy] = useState(false);

  function buildParams(): Record<string, unknown> {
    switch (kind) {
      case 'day_of_week':
        return { days };
      case 'time_of_day':
        return { from, to };
      case 'duration':
        return { min_minutes: minMinutes };
      case 'sector':
        return { sectors };
      case 'difficulty':
        return { min_level: minLevel };
      case 'distance':
        return { min_km: minKm };
      case 'tension':
        return { min_ratio: minRatio };
      default:
        return {};
    }
  }

  async function save() {
    if (busy) return;
    const finalLabel = label.trim() || RULE_KINDS[kind].label;
    if (pct === 0 && cents === 0) {
      notif('Indique au moins un ajustement (% ou €).');
      return;
    }
    setBusy(true);
    try {
      await createPayRule({
        structure_id: structureId,
        kind,
        label: finalLabel,
        params: buildParams() as PayRuleInsert['params'],
        adjust_pct: pct,
        adjust_cents: cents,
      });
      onCreated(finalLabel);
    } catch (e) {
      notif(e instanceof Error ? e.message : 'Création impossible.');
    } finally {
      setBusy(false);
    }
  }

  const chip = (selected: boolean) =>
    ({
      background: selected ? '#fff' : T.row,
      color: selected ? '#000' : T.sub,
      border: `1px solid ${selected ? '#fff' : T.cb}`,
      borderRadius: 20,
      padding: '5px 11px',
      fontSize: 11,
      fontWeight: 700,
      cursor: 'pointer',
    }) as const;

  return (
    <div style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 12, padding: 14 }}>
      <div style={{ fontSize: 12.5, fontWeight: 900, color: T.text, marginBottom: 12 }}>Nouvelle règle</div>
      <Fld label="Type de règle">
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {(Object.entries(RULE_KINDS) as [PayRuleKind, { label: string }][]).map(([k, meta]) => (
            <button key={k} onClick={() => setKind(k)} style={chip(kind === k)}>
              {meta.label}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 9, color: T.mu, marginTop: 6 }}>{RULE_KINDS[kind].hint}</div>
      </Fld>
      <Fld label="Nom affiché (visible par le travailleur)">
        <input aria-label="Nom de la règle" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={RULE_KINDS[kind].label} style={inp} />
      </Fld>

      {kind === 'day_of_week' && (
        <Fld label="Jours concernés">
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {DAY_NAMES.map(([d, name]) => (
              <button key={d} onClick={() => setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]))} style={chip(days.includes(d))}>
                {name}
              </button>
            ))}
          </div>
        </Fld>
      )}
      {kind === 'time_of_day' && (
        <Fld label="Plage horaire (début de mission)">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input aria-label="De" type="time" value={from} onChange={(e) => setFrom(e.target.value)} style={{ ...inp, marginBottom: 0 }} />
            <span style={{ color: T.mu, fontSize: 12 }}>→</span>
            <input aria-label="À" type="time" value={to} onChange={(e) => setTo(e.target.value)} style={{ ...inp, marginBottom: 0 }} />
          </div>
        </Fld>
      )}
      {kind === 'duration' && (
        <Fld label="Durée minimale">
          <div style={{ display: 'flex', gap: 5 }}>
            {[120, 180, 240, 300].map((m) => (
              <button key={m} onClick={() => setMinMinutes(m)} style={chip(minMinutes === m)}>
                {m / 60} h+
              </button>
            ))}
          </div>
        </Fld>
      )}
      {kind === 'sector' && (
        <Fld label="Secteurs concernés">
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {SECTORS.map((s) => (
              <button key={s} onClick={() => setSectors((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))} style={chip(sectors.includes(s))}>
                {s}
              </button>
            ))}
          </div>
        </Fld>
      )}
      {kind === 'difficulty' && (
        <Fld label="À partir du niveau">
          <div style={{ display: 'flex', gap: 5 }}>
            {[2, 3].map((l) => (
              <button key={l} onClick={() => setMinLevel(l)} style={chip(minLevel === l)}>
                Niveau {l}+
              </button>
            ))}
          </div>
        </Fld>
      )}
      {kind === 'distance' && (
        <Fld label="À partir de (km)">
          <div style={{ display: 'flex', gap: 5 }}>
            {[5, 10, 20].map((km) => (
              <button key={km} onClick={() => setMinKm(km)} style={chip(minKm === km)}>
                {km} km+
              </button>
            ))}
          </div>
        </Fld>
      )}
      {kind === 'tension' && (
        <Fld label="Seuil de tension (missions ouvertes / candidatures)">
          <div style={{ display: 'flex', gap: 5 }}>
            {[1.5, 2, 3].map((r) => (
              <button key={r} onClick={() => setMinRatio(r)} style={chip(minRatio === r)}>
                ≥ {String(r).replace('.', ',')}
              </button>
            ))}
          </div>
        </Fld>
      )}

      <Fld label="Majoration en % de la base">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => setPct((v) => Math.max(-50, v - 5))} style={{ width: 32, height: 32, borderRadius: '50%', background: T.row, border: `1px solid ${T.cb}`, color: T.text, fontSize: 16, cursor: 'pointer' }}>−</button>
          <span style={{ fontSize: 18, fontWeight: 900, color: T.text, minWidth: 64, textAlign: 'center' }}>{pct > 0 ? '+' : ''}{pct} %</span>
          <button onClick={() => setPct((v) => Math.min(200, v + 5))} style={{ width: 32, height: 32, borderRadius: '50%', background: T.grad, border: 'none', color: '#fff', fontSize: 16, cursor: 'pointer' }}>＋</button>
        </div>
      </Fld>
      <Fld label="Bonus fixe (€)">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => setCents((v) => Math.max(0, v - 100))} style={{ width: 32, height: 32, borderRadius: '50%', background: T.row, border: `1px solid ${T.cb}`, color: T.text, fontSize: 16, cursor: 'pointer' }}>−</button>
          <span style={{ fontSize: 18, fontWeight: 900, color: T.text, minWidth: 64, textAlign: 'center' }}>{cents > 0 ? '+' : ''}{euros(cents)}</span>
          <button onClick={() => setCents((v) => Math.min(50000, v + 100))} style={{ width: 32, height: 32, borderRadius: '50%', background: T.grad, border: 'none', color: '#fff', fontSize: 16, cursor: 'pointer' }}>＋</button>
        </div>
      </Fld>

      <div style={{ display: 'flex', gap: 7 }}>
        <button onClick={save} disabled={busy} style={{ flex: 1, background: busy ? T.row : '#fff', color: busy ? T.mu : '#000', border: 'none', borderRadius: 9, padding: '11px 0', fontSize: 12.5, fontWeight: 900, cursor: 'pointer' }}>
          {busy ? '…' : 'Créer la règle'}
        </button>
        <button onClick={onCancel} style={{ flex: 1, background: T.row, color: T.sub, border: 'none', borderRadius: 9, padding: '11px 0', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
          Annuler
        </button>
      </div>
    </div>
  );
}
