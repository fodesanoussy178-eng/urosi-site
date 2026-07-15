import { useEffect, useState } from 'react';
import { T } from '@/components/ui/theme';
import { founderAdminApi, type FounderAuditEntry } from '../founderAdminService';
import { founderCard, founderDate, founderNotice } from '../founderUi';

export function FounderAuditPanel() {
  const [rows, setRows] = useState<FounderAuditEntry[]>([]);
  const [error, setError] = useState('');
  useEffect(() => { founderAdminApi.auditLog().then(setRows).catch((cause) => setError(cause instanceof Error ? cause.message : 'Chargement impossible.')); }, []);
  if (error) return <div style={{ ...founderNotice, color: T.red }}>{error}</div>;
  return (
    <section style={{ display: 'grid', gap: 8 }}>
      {rows.length === 0 && <div style={founderNotice}>Aucune action Fondateur enregistrée.</div>}
      {rows.map((row) => (
        <article key={row.id} style={founderCard}>
          <strong style={{ fontSize: 12 }}>{row.action}</strong>
          <div style={{ color: T.mu, fontSize: 10, marginTop: 4 }}>{founderDate(row.created_at)} · {row.actor_name} · {row.target_type} {row.target_label ?? ''}</div>
        </article>
      ))}
    </section>
  );
}
