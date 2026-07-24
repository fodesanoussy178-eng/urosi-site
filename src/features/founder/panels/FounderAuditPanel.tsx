import { useEffect, useState } from 'react';
import { T } from '@/components/ui/theme';
import { founderAdminApi, type PlatformAuditEntry } from '../founderAdminService';
import { founderButton, founderCard, founderDate, founderInput, founderNotice } from '../founderUi';
import { describeError } from '@/lib/errors';

const PAGE = 50;

const EVENT_TYPES: Array<[string, string]> = [
  ['', 'Tous les événements'],
  ['stripe_payment', 'Paiement Stripe'],
  ['refund', 'Remboursement'],
  ['wallet_move', 'Mouvement Wallet'],
  ['qr_start', 'Pointage arrivée'],
  ['qr_end', 'Pointage départ'],
  ['mission_cancelled', 'Annulation'],
  ['worker_replaced', 'Remplacement'],
];

const ACTOR_ROLES: Array<[string, string]> = [
  ['', 'Tous les acteurs'],
  ['worker', 'Travailleur'],
  ['structure', 'Structure'],
  ['founder', 'Fondateur'],
  ['system', 'Système'],
];

const ROLE_LABEL: Record<string, string> = {
  worker: 'Travailleur',
  structure: 'Structure',
  founder: 'Fondateur',
  system: 'Système',
};

const EVENT_COLOR: Record<string, string> = {
  stripe_payment: T.green,
  refund: T.amber,
  wallet_move: T.cyan,
  qr_start: T.green,
  qr_end: T.cyan,
  mission_cancelled: T.red,
  worker_replaced: T.amber,
};

export function FounderAuditPanel() {
  const [rows, setRows] = useState<PlatformAuditEntry[]>([]);
  const [eventType, setEventType] = useState('');
  const [actorRole, setActorRole] = useState('');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [reachedEnd, setReachedEnd] = useState(false);
  const [error, setError] = useState('');

  // Recharge depuis le début à chaque changement de filtre (recherche
  // debouncée). La pagination « Charger plus » ajoute les pages suivantes.
  useEffect(() => {
    const handle = window.setTimeout(() => {
      setLoading(true);
      setError('');
      founderAdminApi
        .platformAudit({
          eventType,
          actorRole,
          search,
          from: from ? new Date(from).toISOString() : undefined,
          to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined,
          limit: PAGE,
          offset: 0,
        })
        .then((data) => {
          setRows(data);
          setOffset(PAGE);
          setReachedEnd(data.length < PAGE);
        })
        .catch((cause) => setError(describeError(cause, 'le chargement du journal')))
        .finally(() => setLoading(false));
    }, 250);
    return () => window.clearTimeout(handle);
  }, [eventType, actorRole, search, from, to]);

  function loadMore() {
    setLoading(true);
    founderAdminApi
      .platformAudit({
        eventType,
        actorRole,
        search,
        from: from ? new Date(from).toISOString() : undefined,
        to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined,
        limit: PAGE,
        offset,
      })
      .then((data) => {
        setRows((prev) => [...prev, ...data]);
        setOffset((o) => o + PAGE);
        setReachedEnd(data.length < PAGE);
      })
      .catch((cause) => setError(describeError(cause, 'le chargement du journal')))
      .finally(() => setLoading(false));
  }

  return (
    <section style={{ display: 'grid', gap: 10 }}>
      <div style={{ ...founderCard, display: 'grid', gap: 8 }}>
        <input aria-label="Rechercher dans le journal" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher (résumé, mission, utilisateur)…" style={founderInput} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <select aria-label="Type d'événement" value={eventType} onChange={(e) => setEventType(e.target.value)} style={founderInput}>
            {EVENT_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <select aria-label="Acteur" value={actorRole} onChange={(e) => setActorRole(e.target.value)} style={founderInput}>
            {ACTOR_ROLES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <label style={{ fontSize: 9, color: T.mu, display: 'grid', gap: 3 }}>Du<input type="date" aria-label="Date de début" value={from} onChange={(e) => setFrom(e.target.value)} style={founderInput} /></label>
          <label style={{ fontSize: 9, color: T.mu, display: 'grid', gap: 3 }}>Au<input type="date" aria-label="Date de fin" value={to} onChange={(e) => setTo(e.target.value)} style={founderInput} /></label>
        </div>
      </div>

      {error && <div style={{ ...founderNotice, color: T.red }}>{error}</div>}
      {!error && rows.length === 0 && !loading && <div style={founderNotice}>Aucun événement pour ces filtres.</div>}

      {rows.map((row) => (
        <article key={row.id} style={founderCard}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
            <strong style={{ fontSize: 12, color: EVENT_COLOR[row.event_type] ?? T.text }}>{row.summary}</strong>
            <span style={{ fontSize: 9, color: T.mu, whiteSpace: 'nowrap', flexShrink: 0 }}>{founderDate(row.created_at)}</span>
          </div>
          <div style={{ color: T.mu, fontSize: 10, marginTop: 4 }}>
            {ROLE_LABEL[row.actor_role] ?? row.actor_role}
            {row.actor_name ? ` · ${row.actor_name}` : ''}
            {row.subject_name ? ` · concerne ${row.subject_name}` : ''}
            {row.mission_title ? ` · ${row.mission_title}` : ''}
          </div>
        </article>
      ))}

      {loading && <div style={founderNotice}>Chargement…</div>}
      {!loading && !reachedEnd && rows.length > 0 && (
        <button onClick={loadMore} style={{ ...founderButton, width: '100%' }}>Charger plus</button>
      )}
    </section>
  );
}
