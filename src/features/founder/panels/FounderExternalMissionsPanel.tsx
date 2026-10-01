import { useCallback, useEffect, useState } from 'react';
import { T } from '@/components/ui/theme';
import { describeError } from '@/lib/errors';
import {
  confirmationLink,
  fetchExternalMissionsOverview,
  fetchPendingParticipations,
  issueConfirmationRequest,
  runApiEngagementImport,
  type ExternalImportRun,
  type ExternalMissionsOverview,
  type PendingParticipation,
} from '../externalMissionsAdminService';
import { founderButton, founderCard, founderDate, founderNotice } from '../founderUi';

const STATUS_LABELS: Record<ExternalImportRun['status'], { label: string; color: string }> = {
  running: { label: 'En cours', color: T.amber },
  success: { label: 'Succès', color: T.green },
  partial: { label: 'Partiel', color: T.amber },
  error: { label: 'Erreur', color: T.red },
  not_configured: { label: 'Clé non configurée', color: T.amber },
};

const SKIP_LABELS: Record<string, string> = {
  invalid: 'données invalides',
  missing_application_url: 'sans lien de candidature',
  deleted: 'supprimées',
  not_accepted: 'non acceptées',
  remote_full: '100 % à distance',
  type_excluded: 'volontariat (hors phase 0)',
  compensated: 'indemnisées',
  expired: 'expirées',
};

const APPLICATION_LABELS: Record<string, string> = {
  external_application_started: 'commencées',
  accepted_declared: 'acceptées (déclarées)',
  completed_declared: 'réalisées (déclarées)',
  verified: 'vérifiées par l’équipe (ancien, sans pastille)',
  withdrawn: 'retirées',
  not_done_declared: 'non réalisées (déclaré)',
  verified_completed: 'confirmées par la structure',
  not_confirmed: 'non confirmées',
};

function Stat({ value, label }: { value: string | number; label: string }) {
  return (
    <div style={{ ...founderCard, padding: 12, textAlign: 'center' }}>
      <div style={{ fontSize: 20, fontWeight: 900, color: T.text }}>{value}</div>
      <div style={{ fontSize: 10, color: T.mu, marginTop: 3 }}>{label}</div>
    </div>
  );
}

export function FounderExternalMissionsPanel() {
  const [data, setData] = useState<ExternalMissionsOverview | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingParticipation[]>([]);

  const load = useCallback(async () => {
    fetchPendingParticipations().then(setPending).catch(() => setPending([]));
    try {
      setData(await fetchExternalMissionsOverview());
      setError('');
    } catch (cause) {
      setError(describeError(cause, 'le chargement des missions externes'));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function relaunch() {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      const run = await runApiEngagementImport();
      const status = STATUS_LABELS[run.status]?.label ?? run.status;
      setMessage(run.status === 'not_configured' ? `${status} : ${run.error_message ?? ''}` : `Import terminé (${status}) : ${run.imported ?? 0} mission(s) importée(s), ${run.skipped ?? 0} écartée(s).`);
    } catch (cause) {
      setMessage(describeError(cause, "l'import API Engagement"));
    } finally {
      setBusy(false);
      await load();
    }
  }

  const active = data?.sources.reduce((s, x) => s + x.active, 0) ?? 0;
  const lastRun = data?.runs[0] ?? null;

  return (
    <section style={{ display: 'grid', gap: 12 }}>
      <div style={{ ...founderNotice }}>
        Missions solidaires importées depuis des plateformes partenaires (API Engagement). Elles restent distinctes des missions publiées directement sur UROSI :
        la candidature se poursuit chez le partenaire et UROSI ne connaît que le clic et les déclarations du participant.
      </div>
      {error && <div style={{ ...founderNotice, color: T.red }}>{error}</div>}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" onClick={relaunch} disabled={busy} style={{ ...founderButton, background: T.grad, color: '#fff', border: 'none' }}>
          {busy ? 'Import en cours…' : "↻ Relancer l'import API Engagement"}
        </button>
        <button type="button" onClick={() => void load()} style={founderButton}>Actualiser</button>
        {message && <span role="status" style={{ fontSize: 11.5, color: T.sub }}>{message}</span>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
        <Stat value={active} label="missions externes actives" />
        <Stat value={data?.last_success ? founderDate(data.last_success.finished_at ?? data.last_success.started_at) : '—'} label="dernier sync réussi" />
        <Stat value={data?.applications.total ?? 0} label="candidatures externes commencées" />
        <Stat value={data?.applications.last_7_days ?? 0} label="dont 7 derniers jours" />
      </div>

      {data && Object.keys(data.applications.by_status).length > 0 && (
        <div style={{ ...founderCard, fontSize: 11.5, color: T.sub }}>
          {Object.entries(data.applications.by_status)
            .map(([status, n]) => `${n} ${APPLICATION_LABELS[status] ?? status}`)
            .join(' · ')}
        </div>
      )}

      <div style={founderCard}>
        <div style={{ fontSize: 12.5, fontWeight: 900, color: T.text, marginBottom: 4 }}>Participations à confirmer ({pending.length})</div>
        <div style={{ fontSize: 10.5, color: T.mu, marginBottom: 8, lineHeight: 1.5 }}>
          Le bénévole a déclaré « J’y suis allé ». Seule la structure peut confirmer. Aucun message n’est envoyé automatiquement : un lien n’est émis
          que vers un canal officiel que vous avez vérifié (jamais un email supposé).
        </div>
        {pending.length === 0 && <div style={{ fontSize: 11.5, color: T.mu }}>Aucune pour l’instant.</div>}
        {pending.map((p) => (
          <div key={p.id} style={{ borderTop: `1px solid ${T.cb}`, padding: '8px 0', fontSize: 11, display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ color: T.text, fontWeight: 800 }}>{p.participant} · {p.mission_title}</div>
              <div style={{ color: T.mu }}>
                {[p.organization_name, p.mission_date ? new Date(`${p.mission_date}T12:00:00`).toLocaleDateString('fr-FR') : null].filter(Boolean).join(' · ')}
                {p.organization_url && (
                  <>
                    {' · '}
                    <a href={p.organization_url} target="_blank" rel="noopener noreferrer" style={{ color: T.cyan }}>site de l’organisation</a>
                  </>
                )}
              </div>
              <div style={{ color: T.sub, marginTop: 2 }}>
                {p.method === 'urosi_native_confirmation'
                  ? 'Structure inscrite sur UROSI : elle confirme dans son espace.'
                  : p.method === 'partner_status'
                    ? 'Statut de la plateforme partenaire.'
                    : p.token
                      ? `Lien émis (canal : ${p.channel_note ?? '—'}) · expire le ${p.expires_at ? new Date(p.expires_at).toLocaleDateString('fr-FR') : '—'}`
                      : 'Aucun canal officiel enregistré : en attente.'}
              </div>
            </div>
            {p.method === 'structure_confirmation' && (
              p.token ? (
                <button type="button" style={{ ...founderButton, flexShrink: 0 }} onClick={() => void navigator.clipboard?.writeText(confirmationLink(p.token!)).then(() => setMessage('Lien de confirmation copié.'))}>
                  Copier le lien
                </button>
              ) : (
                <button
                  type="button"
                  style={{ ...founderButton, flexShrink: 0 }}
                  onClick={() => {
                    const channel = window.prompt('Canal officiel vérifié par lequel vous transmettrez le lien (ex. « email publié sur le site officiel de l’association ») :');
                    if (!channel || channel.trim().length < 5) return;
                    void issueConfirmationRequest(p.id, channel.trim())
                      .then((token) => navigator.clipboard?.writeText(confirmationLink(token)))
                      .then(() => setMessage('Lien émis et copié : transmettez-le par ce canal uniquement.'))
                      .catch((e) => setMessage(describeError(e, 'l’émission du lien')))
                      .finally(() => void load());
                  }}
                >
                  Émettre un lien
                </button>
              )
            )}
          </div>
        ))}
      </div>

      <div style={founderCard}>
        <div style={{ fontSize: 12.5, fontWeight: 900, color: T.text, marginBottom: 8 }}>Sources</div>
        {(data?.sources.length ?? 0) === 0 ? (
          <div style={{ fontSize: 11.5, color: T.mu }}>Aucune mission importée pour l'instant.</div>
        ) : (
          data!.sources.map((s) => (
            <div key={s.source} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: T.sub, padding: '4px 0' }}>
              <strong style={{ color: T.text }}>{s.source}</strong>
              <span>{s.active} actives · {s.inactive} désactivées · vue le {founderDate(s.last_seen_at)}</span>
            </div>
          ))
        )}
      </div>

      <div style={founderCard}>
        <div style={{ fontSize: 12.5, fontWeight: 900, color: T.text, marginBottom: 8 }}>Journal des imports {lastRun && <span style={{ color: STATUS_LABELS[lastRun.status].color, fontSize: 11 }}>· dernier : {STATUS_LABELS[lastRun.status].label}</span>}</div>
        {(data?.runs.length ?? 0) === 0 && <div style={{ fontSize: 11.5, color: T.mu }}>Aucun import lancé.</div>}
        {data?.runs.map((run) => (
          <div key={run.id} style={{ borderTop: `1px solid ${T.cb}`, padding: '8px 0', fontSize: 11 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ color: T.text, fontWeight: 800 }}>{founderDate(run.started_at)} · {run.trigger === 'manual' ? 'manuel' : 'planifié'}</span>
              <span style={{ color: STATUS_LABELS[run.status].color, fontWeight: 800 }}>{STATUS_LABELS[run.status].label}</span>
            </div>
            <div style={{ color: T.mu, marginTop: 2 }}>
              {run.fetched} reçues · {run.imported} importées · {run.skipped} écartées · {run.deactivated} désactivées
              {Object.keys(run.skip_reasons ?? {}).length > 0 &&
                ` (${Object.entries(run.skip_reasons).map(([k, n]) => `${n} ${SKIP_LABELS[k] ?? k}`).join(', ')})`}
            </div>
            {run.error_message && <div style={{ color: run.status === 'error' ? T.red : T.amber, marginTop: 2 }}>{run.error_message}</div>}
          </div>
        ))}
      </div>

      <div style={founderCard}>
        <div style={{ fontSize: 12.5, fontWeight: 900, color: T.text, marginBottom: 8 }}>Dernières missions importées</div>
        {(data?.recent_missions.length ?? 0) === 0 && <div style={{ fontSize: 11.5, color: T.mu }}>—</div>}
        {data?.recent_missions.map((m) => (
          <div key={m.id} style={{ borderTop: `1px solid ${T.cb}`, padding: '7px 0', fontSize: 11 }}>
            <div style={{ color: T.text, fontWeight: 800 }}>{m.title}</div>
            <div style={{ color: T.mu }}>
              {[m.organization_name, m.city, m.publisher_name].filter(Boolean).join(' · ')} · clientId {m.client_id ?? '—'} · {m.applications} candidature(s) · {m.is_active ? 'active' : 'désactivée'}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
