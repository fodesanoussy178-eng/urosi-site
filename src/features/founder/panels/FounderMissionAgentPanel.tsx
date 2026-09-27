import { useCallback, useEffect, useState } from 'react';
import { T } from '@/components/ui/theme';
import { describeError } from '@/lib/errors';
import {
  authorizeImageRights,
  fetchMissionAgentOverview,
  runMissionAgentNow,
  type AgentRun,
  type MissionAgentOverview,
  type SourceRunStatus,
} from '../missionAgentAdminService';
import { founderButton, founderCard, founderDate, founderNotice } from '../founderUi';

const RUN_STATUS: Record<AgentRun['status'], { label: string; color: string }> = {
  running: { label: 'En cours', color: T.amber },
  success: { label: 'Succès', color: T.green },
  partial: { label: 'Partiel', color: T.amber },
  error: { label: 'Erreur', color: T.red },
  not_configured: { label: 'Non configuré', color: T.amber },
};

const SOURCE_STATUS: Record<SourceRunStatus, { label: string; color: string }> = {
  success: { label: 'OK', color: T.green },
  partial: { label: 'Partiel', color: T.amber },
  not_configured: { label: 'Clé absente', color: T.amber },
  blocked: { label: 'Bloquée (anti-bot / robots.txt)', color: T.red },
  error: { label: 'Erreur', color: T.red },
  skipped: { label: 'Désactivée', color: T.mu },
};

const SOURCE_TYPES: Record<string, string> = {
  api: 'API',
  open_data: 'Open data',
  rss: 'Flux RSS',
  xml: 'Flux XML',
  json: 'Flux JSON',
  authorized_page: 'Page autorisée',
};

const IMAGE_SOURCES: Record<string, string> = {
  partner_mission_image: 'photo partenaire',
  authorized_image: 'photo autorisée',
  organization_logo: 'logo organisation',
  domain_logo: 'logo domaine',
  urosi_illustration: 'illustration UROSI',
};

function Stat({ value, label, tone }: { value: string | number; label: string; tone?: string }) {
  return (
    <div style={{ ...founderCard, padding: 12 }}>
      <div style={{ fontSize: typeof value === 'number' ? 20 : 13, fontWeight: 900, color: tone ?? T.text, lineHeight: 1.25 }}>{value}</div>
      <div style={{ fontSize: 10, color: T.mu, marginTop: 4 }}>{label}</div>
    </div>
  );
}

function runSummary(run: AgentRun): string {
  return [
    `${run.fetched} lues`,
    `${run.created_count ?? 0} nouvelles`,
    `${(run.updated_count ?? 0) + (run.reactivated_count ?? 0)} mises à jour`,
    `${run.unchanged_count ?? 0} inchangées`,
    `${run.deactivated} désactivées`,
    `${run.duplicates ?? 0} doublons`,
    `${run.images_found ?? 0} images trouvées`,
    `${run.images_rejected ?? 0} refusées`,
  ].join(' · ');
}

export function FounderMissionAgentPanel() {
  const [data, setData] = useState<MissionAgentOverview | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await fetchMissionAgentOverview());
      setError('');
    } catch (cause) {
      setError(describeError(cause, "le chargement de l'agent missions"));
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
      const run = await runMissionAgentNow();
      const status = RUN_STATUS[run.status]?.label ?? run.status;
      setMessage(
        run.status === 'not_configured'
          ? `${status} : ${run.error_message ?? 'aucune source configurée.'}`
          : `Exécution terminée (${status}) : ${runSummary(run)}.`,
      );
    } catch (cause) {
      setMessage(describeError(cause, "l'exécution de l'agent missions"));
    } finally {
      setBusy(false);
      await load();
    }
  }

  async function authorize(imageId: string) {
    const note = window.prompt('Droits vérifiés : précisez la preuve (licence, accord écrit, lien…)');
    if (!note || !note.trim()) return;
    try {
      await authorizeImageRights(imageId, note.trim());
      await load();
    } catch (cause) {
      setMessage(describeError(cause, "l'autorisation de l'image"));
    }
  }

  const last = data?.last_run ?? null;
  const enabledSources = data?.sources.filter((s) => s.enabled) ?? [];
  const lastErrors = last?.errors ?? [];
  const scheduleText = data?.schedule
    ? `${data.schedule.active ? 'Active' : 'En pause'} · « ${data.schedule.schedule} » (UTC)`
    : 'Pas encore planifiée : en attente de la clé API Engagement et des sources.';

  return (
    <section style={{ display: 'grid', gap: 12 }}>
      <div style={{ ...founderNotice }}>
        L’agent missions interroge les sources autorisées (API Engagement, puis les sources ajoutées au registre), importe les
        nouvelles missions, met à jour celles qui changent, désactive — sans jamais les supprimer — celles qui disparaissent ou
        expirent, et choisit leur visuel. Une image aux droits inconnus n’est jamais publiée. Prévu toutes les 3 heures.
      </div>
      {error && <div style={{ ...founderNotice, color: T.red }}>{error}</div>}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" onClick={relaunch} disabled={busy} style={{ ...founderButton, background: T.grad, color: '#fff', border: 'none' }}>
          {busy ? 'Exécution en cours…' : '↻ Relancer maintenant'}
        </button>
        <button type="button" onClick={() => void load()} style={founderButton}>Actualiser</button>
        {message && <span role="status" style={{ fontSize: 11.5, color: T.sub }}>{message}</span>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
        <Stat
          value={last ? `${founderDate(last.finished_at ?? last.started_at)} · ${RUN_STATUS[last.status]?.label ?? last.status}` : 'Jamais exécuté'}
          label="dernière exécution"
          tone={last ? RUN_STATUS[last.status]?.color : T.mu}
        />
        <Stat value={data?.next_run_at ? founderDate(data.next_run_at) : 'Non planifiée'} label="prochaine exécution" tone={data?.next_run_at ? T.text : T.mu} />
        <Stat value={`${enabledSources.length} / ${data?.sources.length ?? 0}`} label="sources vérifiées et actives" />
        <Stat value={last?.created_count ?? 0} label="nouvelles missions" />
        <Stat value={(last?.updated_count ?? 0) + (last?.reactivated_count ?? 0)} label="missions mises à jour" />
        <Stat value={last?.deactivated ?? 0} label="missions désactivées" />
        <Stat value={data?.catalog.duplicates ?? 0} label="doublons masqués" />
        <Stat value={data?.catalog.without_image ?? 0} label="missions sans image (illustration)" />
        <Stat value={data?.catalog.images_found ?? 0} label="images trouvées (droits connus)" />
        <Stat value={data?.catalog.images_rejected ?? 0} label="images refusées (droits inconnus)" tone={(data?.catalog.images_rejected ?? 0) > 0 ? T.amber : T.text} />
        <Stat value={lastErrors.length} label="erreurs (dernière exécution)" tone={lastErrors.length > 0 ? T.red : T.text} />
      </div>

      <div style={{ ...founderCard, fontSize: 11.5, color: T.sub, lineHeight: 1.55 }}>
        <strong style={{ color: T.text }}>Planification :</strong> {scheduleText}
        {data && Object.keys(data.catalog.by_image_source).length > 0 && (
          <div style={{ marginTop: 4 }}>
            <strong style={{ color: T.text }}>Visuels du catalogue :</strong>{' '}
            {Object.entries(data.catalog.by_image_source)
              .map(([k, n]) => `${n} ${IMAGE_SOURCES[k] ?? k}`)
              .join(' · ')}
            {data.catalog.native_without_photo > 0 && ` · ${data.catalog.native_without_photo} mission(s) UROSI sans photo`}
          </div>
        )}
      </div>

      {lastErrors.length > 0 && (
        <div style={{ ...founderCard, borderColor: T.redBorder }}>
          <div style={{ fontSize: 12.5, fontWeight: 900, color: T.red, marginBottom: 6 }}>Erreurs de la dernière exécution</div>
          {lastErrors.map((e, i) => (
            <div key={i} style={{ fontSize: 11.5, color: T.sub, padding: '3px 0' }}>
              <strong style={{ color: T.text }}>{e.source}</strong> — {e.message}
            </div>
          ))}
        </div>
      )}

      <div style={founderCard}>
        <div style={{ fontSize: 12.5, fontWeight: 900, color: T.text, marginBottom: 8 }}>Sources</div>
        {(data?.sources.length ?? 0) === 0 && <div style={{ fontSize: 11.5, color: T.mu }}>Aucune source enregistrée.</div>}
        {data?.sources.map((s) => {
          const report = last?.sources_report?.find((r) => r.source === s.id);
          const status = report ? SOURCE_STATUS[report.status] : null;
          return (
            <div key={s.id} style={{ borderTop: `1px solid ${T.cb}`, padding: '8px 0', fontSize: 11 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ color: T.text, fontWeight: 800 }}>
                  {s.name} <span style={{ color: T.mu, fontWeight: 600 }}>· {SOURCE_TYPES[s.source_type] ?? s.source_type}</span>
                </span>
                <span style={{ color: s.enabled ? T.green : T.mu, fontWeight: 800 }}>
                  {s.enabled ? `Vérifiée le ${founderDate(s.verified_at)}` : 'Non activée'}
                </span>
              </div>
              <div style={{ color: T.mu, marginTop: 2 }}>
                {s.active} actives · {s.inactive} désactivées · dernier contrôle {founderDate(s.last_checked_at)} · logos {s.logos_reusable ? 'diffusables' : 'non utilisés'} · photos{' '}
                {s.mission_images_reusable ? 'réutilisables' : 'non fournies / non réutilisables'}
              </div>
              {s.reuse_basis && <div style={{ color: T.mu, marginTop: 2 }}>Base d’utilisation : {s.reuse_basis}</div>}
              {status && (
                <div style={{ color: status.color, marginTop: 2, fontWeight: 700 }}>
                  Dernier passage : {status.label}
                  {report?.message ? ` — ${report.message}` : ''}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={founderCard}>
        <div style={{ fontSize: 12.5, fontWeight: 900, color: T.text, marginBottom: 8 }}>Journal de synchronisation</div>
        {(data?.runs.length ?? 0) === 0 && <div style={{ fontSize: 11.5, color: T.mu }}>Aucune exécution pour l’instant.</div>}
        {data?.runs.map((run) => (
          <div key={run.id} style={{ borderTop: `1px solid ${T.cb}`, padding: '8px 0', fontSize: 11 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ color: T.text, fontWeight: 800 }}>{founderDate(run.started_at)} · {run.trigger === 'manual' ? 'manuel' : 'planifié'}</span>
              <span style={{ color: RUN_STATUS[run.status]?.color, fontWeight: 800 }}>{RUN_STATUS[run.status]?.label ?? run.status}</span>
            </div>
            <div style={{ color: T.mu, marginTop: 2 }}>{runSummary(run)}</div>
            {run.error_message && <div style={{ color: run.status === 'error' ? T.red : T.amber, marginTop: 2 }}>{run.error_message}</div>}
          </div>
        ))}
      </div>

      <div style={founderCard}>
        <div style={{ fontSize: 12.5, fontWeight: 900, color: T.text, marginBottom: 4 }}>Images refusées (droits inconnus)</div>
        <div style={{ fontSize: 10.5, color: T.mu, marginBottom: 8 }}>
          Jamais publiées automatiquement. Ne les autorisez qu’avec une preuve écrite (licence, accord de l’auteur).
        </div>
        {(data?.rejected_images.length ?? 0) === 0 && <div style={{ fontSize: 11.5, color: T.mu }}>Aucune.</div>}
        {data?.rejected_images.map((img) => (
          <div key={img.id} style={{ borderTop: `1px solid ${T.cb}`, padding: '7px 0', fontSize: 11, display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ color: T.text, fontWeight: 800 }}>{img.mission_title ?? 'Mission'}</div>
              <div style={{ color: T.mu, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {img.source_url ? (
                  <a href={img.source_url} target="_blank" rel="noopener noreferrer" style={{ color: T.cyan }}>
                    {img.source_url}
                  </a>
                ) : (
                  img.image_url
                )}
                {img.rights_note ? ` · ${img.rights_note}` : ''}
              </div>
            </div>
            <button type="button" onClick={() => void authorize(img.id)} style={{ ...founderButton, flexShrink: 0 }}>
              Droits vérifiés
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
