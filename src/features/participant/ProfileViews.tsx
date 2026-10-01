import type { ReactNode } from 'react';
import { T } from '@/components/ui/theme';
import { categoryInfo } from '@/features/missions/categories';
import { formatDay } from '@/lib/slots';
import { formatEngagementHours, type Experience, type Headline, type JourneySummary } from './journey';
import type { ParticipantRating } from './participantService';
import { Avatar, Badge, EmptyState, durationLabel } from './ParticipantUi';

export function FullScreen({ title, onBack, children, action }: { title: string; onBack: () => void; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="urosi-modal-layer" role="dialog" aria-modal="true" aria-label={title} style={{ background: T.bg, overflowY: 'auto', display: 'flex', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: 430, padding: 'calc(14px + env(safe-area-inset-top)) 16px 40px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <button type="button" aria-label="Retour" onClick={onBack} style={{ width: 34, height: 34, borderRadius: 10, border: `1px solid ${T.cb}`, background: T.card, color: T.text, fontSize: 16, cursor: 'pointer' }}>
            ‹
          </button>
          <div style={{ flex: 1, fontSize: 17, fontWeight: 900, color: T.text }}>{title}</div>
          {action}
        </div>
        {children}
      </div>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '4px 2px' }}>
      <div style={{ fontSize: 19, fontWeight: 900, color: T.text, lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 10, color: T.mu, marginTop: 3 }}>{label}</div>
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 12.5, fontWeight: 900, color: T.text, margin: '16px 0 8px' }}>{children}</div>;
}

export function ProfileHeader({
  name,
  city,
  avatarUrl,
  summary,
  onEdit,
}: {
  name: string;
  city: string | null;
  avatarUrl: string | null;
  summary: JourneySummary;
  onEdit: () => void;
}) {
  return (
    <div style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 18, padding: 16 }}>
      <div style={{ display: 'flex', gap: 13, alignItems: 'center' }}>
        <Avatar name={name} url={avatarUrl} size={62} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 900, color: T.text }}>{name}</div>
          {city && <div style={{ fontSize: 11.5, color: T.sub, marginTop: 2 }}>📍 {city}</div>}
          <button type="button" onClick={onEdit} style={{ background: 'none', border: 'none', padding: 0, marginTop: 4, color: T.cyan, fontSize: 11.5, fontWeight: 800, textDecoration: 'underline', cursor: 'pointer' }}>
            {avatarUrl ? 'Éditer mon profil' : 'Ajouter une photo · éditer mon profil'}
          </button>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', borderTop: `1px solid ${T.cb}`, marginTop: 14, paddingTop: 12 }}>
        <Stat value={formatEngagementHours(summary.minutes)} label="d'engagement" />
        <Stat value={String(summary.missions)} label={summary.missions > 1 ? 'missions' : 'mission'} />
        <Stat value={String(summary.structures)} label={summary.structures > 1 ? 'structures' : 'structure'} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 8, fontSize: 11, color: T.sub }}>
        {summary.reviewsReceived > 0 ? (
          <span>
            <span style={{ color: T.amber, fontWeight: 900 }}>★ {summary.averageReceived!.toFixed(1).replace('.', ',')}</span> · {summary.reviewsReceived} avis reçu{summary.reviewsReceived > 1 ? 's' : ''}
          </span>
        ) : (
          <span>Pas encore d’avis reçu</span>
        )}
      </div>
      {summary.declaredPending > 0 && (
        <div style={{ fontSize: 10.5, color: T.mu, textAlign: 'center', marginTop: 6 }}>
          + {summary.declaredPending} mission{summary.declaredPending > 1 ? 's' : ''} déclarée{summary.declaredPending > 1 ? 's' : ''}, en attente de vérification
        </div>
      )}
    </div>
  );
}

export function ExperienceItem({ experience, detailed = false }: { experience: Experience; detailed?: boolean }) {
  const info = categoryInfo(experience.category);
  const duration = durationLabel(experience.minutes);
  return (
    <div style={{ display: 'flex', gap: 11, background: T.card, border: `1px solid ${T.cb}`, borderRadius: 14, padding: 11 }}>
      <div aria-hidden="true" style={{ width: 46, height: 46, borderRadius: 11, flexShrink: 0, background: `linear-gradient(135deg, ${info.from}, ${info.to})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 21 }}>
        {info.glyph}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 12.5, fontWeight: 900, color: T.text, lineHeight: 1.3 }}>{experience.title}</div>
          {experience.verified ? (
            <span title="Expérience vérifiée" style={{ flexShrink: 0, width: 20, height: 20, borderRadius: '50%', background: '#0891b2', color: '#fff', fontSize: 11, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✓</span>
          ) : (
            <Badge tone="neutral">déclarée</Badge>
          )}
        </div>
        <div style={{ fontSize: 11, color: T.sub, marginTop: 2 }}>{experience.organization}</div>
        <div style={{ fontSize: 10.5, color: T.mu, marginTop: 3 }}>
          {[experience.date ? formatDay(experience.date) : null, duration, experience.city].filter(Boolean).join(' · ')}
        </div>
        {detailed && (
          <>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 7 }}>
              {experience.skills.map((s) => (
                <Badge key={s} tone="neutral">{s}</Badge>
              ))}
            </div>
            {experience.structureComment && (
              <div style={{ marginTop: 8, fontSize: 11, color: T.sub, lineHeight: 1.5, fontStyle: 'italic', borderLeft: `3px solid ${T.cb}`, paddingLeft: 8 }}>
                « {experience.structureComment} »
                {experience.structureScore != null && <span style={{ fontStyle: 'normal', color: T.amber, fontWeight: 900 }}> · ★ {experience.structureScore}/5</span>}
              </div>
            )}
            <div style={{ marginTop: 7 }}>
              {experience.verified ? <Badge tone="cyan">✓ Expérience vérifiée</Badge> : <Badge tone="amber">Déclarée — en attente de vérification</Badge>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function SkillsAndDomains({ summary }: { summary: JourneySummary }) {
  return (
    <>
      <SectionLabel>Mes compétences</SectionLabel>
      {summary.skills.length === 0 ? (
        <div style={{ fontSize: 11.5, color: T.mu }}>Elles apparaîtront avec tes premières missions vérifiées (ou ajoute-les dans Paramètres).</div>
      ) : (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {summary.skills.map((s) => (
            <Badge key={s} tone="neutral">{s}</Badge>
          ))}
        </div>
      )}
      {summary.domains.length > 0 && (
        <>
          <SectionLabel>Domaines explorés</SectionLabel>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {summary.domains.map((d) => (
              <Badge key={d.category} tone="violet">
                {categoryInfo(d.category).glyph} {d.label} · {d.count}
              </Badge>
            ))}
          </div>
        </>
      )}
    </>
  );
}

export function ParcoursView({ experiences, summary }: { experiences: Experience[]; summary: JourneySummary }) {
  if (experiences.length === 0) {
    return (
      <EmptyState icon="🌱" title="Ton parcours commence ici">
        Chaque mission réalisée rejoint ton parcours. Les expériences vérifiées par la structure ou par UROSI portent le badge ✓.
      </EmptyState>
    );
  }
  const byYear = new Map<string, Experience[]>();
  for (const e of experiences) {
    const year = e.date?.slice(0, 4) ?? 'Sans date';
    byYear.set(year, [...(byYear.get(year) ?? []), e]);
  }
  return (
    <div>
      <div style={{ fontSize: 11.5, color: T.sub, lineHeight: 1.55, marginBottom: 6 }}>
        {summary.missions} expérience{summary.missions > 1 ? 's' : ''} vérifiée{summary.missions > 1 ? 's' : ''} · {formatEngagementHours(summary.minutes)} d’engagement vérifié
        {summary.declaredPending > 0 ? ` · ${summary.declaredPending} déclarée${summary.declaredPending > 1 ? 's' : ''}` : ''}
      </div>
      {[...byYear.entries()].map(([year, list]) => (
        <div key={year}>
          <SectionLabel>{year}</SectionLabel>
          <div style={{ display: 'grid', gap: 8 }}>
            {list.map((e) => (
              <ExperienceItem key={e.key} experience={e} detailed />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ReviewsView({
  ratings,
  missionTitle,
  pendingToGive,
}: {
  ratings: ParticipantRating[];
  missionTitle: (applicationId: string) => string;
  pendingToGive: Array<{ applicationId: string; title: string; onRate: () => void }>;
}) {
  const received = ratings.filter((r) => r.direction === 'structure_to_worker' && r.status === 'published');
  const given = ratings.filter((r) => r.direction === 'worker_to_structure');
  const average = received.length ? received.reduce((s, r) => s + r.score, 0) / received.length : null;

  return (
    <div>
      <div style={{ fontSize: 11.5, color: T.sub, lineHeight: 1.55 }}>
        Après une mission réalisée sur UROSI, la structure et toi pouvez laisser un avis. Les deux avis deviennent visibles en même temps (ou après quelques jours).
      </div>

      {pendingToGive.length > 0 && (
        <>
          <SectionLabel>À donner</SectionLabel>
          <div style={{ display: 'grid', gap: 8 }}>
            {pendingToGive.map((p) => (
              <button key={p.applicationId} type="button" onClick={p.onRate} style={{ textAlign: 'left', background: T.amberBg, border: `1px solid ${T.amberBorder}`, borderRadius: 12, padding: '11px 13px', color: T.text, fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
                ★ Donner mon avis sur « {p.title} »
              </button>
            ))}
          </div>
        </>
      )}

      <SectionLabel>
        Avis reçus {average != null && <span style={{ color: T.amber }}>· ★ {average.toFixed(1).replace('.', ',')}</span>}
      </SectionLabel>
      {received.length === 0 ? (
        <div style={{ fontSize: 11.5, color: T.mu }}>Aucun avis reçu pour l’instant.</div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {received.map((r) => (
            <ReviewCard key={`r-${r.application_id}`} rating={r} title={missionTitle(r.application_id)} />
          ))}
        </div>
      )}

      <SectionLabel>Avis donnés</SectionLabel>
      {given.length === 0 ? (
        <div style={{ fontSize: 11.5, color: T.mu }}>Tu n’as pas encore donné d’avis.</div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {given.map((r) => (
            <ReviewCard key={`g-${r.application_id}`} rating={r} title={missionTitle(r.application_id)} pending={r.status === 'pending'} />
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewCard({ rating, title, pending = false }: { rating: ParticipantRating; title: string; pending?: boolean }) {
  return (
    <div style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 12, padding: '10px 12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: T.text }}>{title}</span>
        <span style={{ color: T.amber, fontSize: 12, fontWeight: 900, flexShrink: 0 }}>{'★'.repeat(rating.score)}</span>
      </div>
      {rating.comment && <div style={{ fontSize: 11.5, color: T.sub, marginTop: 4, lineHeight: 1.5 }}>{rating.comment}</div>}
      {pending && <div style={{ fontSize: 10, color: T.mu, marginTop: 4 }}>Visible dès que la structure aura répondu (ou après quelques jours).</div>}
    </div>
  );
}

const TONE_BADGE: Record<Headline['tone'], 'green' | 'cyan' | 'amber' | 'neutral' | 'violet'> = {
  info: 'violet',
  waiting: 'amber',
  success: 'green',
  verified: 'cyan',
  neutral: 'neutral',
  danger: 'amber',
};

export function ApplicationRow({ title, subtitle, headline, onOpen }: { title: string; subtitle: string; headline: Headline; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10, background: T.card, border: `1px solid ${T.cb}`, borderRadius: 14, padding: '11px 13px', cursor: 'pointer' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 900, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
        <div style={{ fontSize: 10.5, color: T.mu, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{subtitle}</div>
      </div>
      <Badge tone={TONE_BADGE[headline.tone]}>{headline.label}</Badge>
      <span aria-hidden="true" style={{ color: T.mu }}>›</span>
    </button>
  );
}

export function MenuRow({ icon, label, hint, onClick }: { icon: string; label: string; hint?: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 11, background: 'transparent', border: 'none', borderTop: `1px solid ${T.cb}`, padding: '13px 4px', cursor: 'pointer', textAlign: 'left' }}>
      <span aria-hidden="true" style={{ fontSize: 16, width: 22, textAlign: 'center' }}>{icon}</span>
      <span style={{ flex: 1, fontSize: 13, fontWeight: 800, color: T.text }}>{label}</span>
      {hint && <span style={{ fontSize: 11, color: T.mu }}>{hint}</span>}
      <span aria-hidden="true" style={{ color: T.mu }}>›</span>
    </button>
  );
}
