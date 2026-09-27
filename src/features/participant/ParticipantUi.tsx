import { useState, type CSSProperties, type ReactNode } from 'react';
import { T } from '@/components/ui/theme';
import { categoryInfo } from '@/features/missions/categories';
import { formatDistance } from '@/lib/geo';
import { formatDay } from '@/lib/slots';
import type { FeedMission } from '@/features/missions/solidarityMissions';
import { useImpressionTracking } from './impressionTracking';

// Visuel de mission, jamais vide : photo de mission > illustration fournie
// par la source > illustration UROSI de la catégorie. Une image qui ne se
// charge pas passe automatiquement au niveau suivant.
export function MissionVisual({ mission, height = 132, radius = 12, children }: { mission: FeedMission; height?: number; radius?: number; children?: ReactNode }) {
  const candidates = [mission.imageUrl, mission.illustrationUrl].filter((u): u is string => Boolean(u));
  const [failed, setFailed] = useState(0);
  const src = candidates[failed];
  const info = categoryInfo(mission.category);
  const isIllustration = src != null && src === mission.illustrationUrl && src !== mission.imageUrl;

  return (
    <div style={{ position: 'relative', height, borderRadius: radius, overflow: 'hidden', background: `linear-gradient(135deg, ${info.from}, ${info.to})`, flexShrink: 0 }}>
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          onError={() => setFailed((n) => n + 1)}
          style={{ width: '100%', height: '100%', objectFit: isIllustration ? 'contain' : 'cover', padding: isIllustration ? 18 : 0, background: isIllustration ? 'rgba(255,255,255,.9)' : undefined }}
        />
      ) : (
        <CategoryIllustration glyph={info.glyph} />
      )}
      {children}
    </div>
  );
}

function CategoryIllustration({ glyph }: { glyph: string }) {
  return (
    <div aria-hidden="true" style={{ position: 'absolute', inset: 0 }}>
      <svg width="100%" height="100%" viewBox="0 0 320 140" preserveAspectRatio="xMidYMid slice" style={{ position: 'absolute', inset: 0 }}>
        <circle cx="270" cy="20" r="70" fill="rgba(255,255,255,.12)" />
        <circle cx="40" cy="150" r="80" fill="rgba(255,255,255,.08)" />
        <circle cx="200" cy="120" r="30" fill="rgba(255,255,255,.1)" />
        <path d="M0 110 Q80 80 160 105 T320 95 V140 H0 Z" fill="rgba(255,255,255,.1)" />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 46, filter: 'drop-shadow(0 6px 14px rgba(0,0,0,.25))' }}>{glyph}</div>
    </div>
  );
}

const AVATAR_HUES = [198, 24, 265, 150, 340, 45, 210, 110];

export function Avatar({ name, url, size = 44 }: { name: string; url?: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  const initialsText = name.split(/\s+/).filter(Boolean).map((p) => p.charAt(0)).join('').slice(0, 2).toUpperCase() || 'U';
  const hue = AVATAR_HUES[[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % AVATAR_HUES.length] ?? 198;
  const style: CSSProperties = { width: size, height: size, borderRadius: '50%', flexShrink: 0, overflow: 'hidden' };
  if (url && !broken) {
    return <img src={url} alt="" onError={() => setBroken(true)} style={{ ...style, objectFit: 'cover' }} />;
  }
  return (
    <div aria-hidden="true" style={{ ...style, background: `linear-gradient(135deg, hsl(${hue} 70% 55%), hsl(${(hue + 40) % 360} 65% 42%))`, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: Math.round(size * 0.38) }}>
      {initialsText}
    </div>
  );
}

export function OrgLogo({ name, url, size = 18 }: { name: string; url: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (url && !broken) {
    return <img src={url} alt="" onError={() => setBroken(true)} style={{ width: size, height: size, borderRadius: 5, objectFit: 'contain', background: '#fff', flexShrink: 0 }} />;
  }
  return (
    <span aria-hidden="true" style={{ width: size, height: size, borderRadius: 5, background: T.grad, color: '#fff', fontSize: Math.round(size * 0.55), fontWeight: 900, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

type BadgeTone = 'green' | 'cyan' | 'violet' | 'amber' | 'neutral';

const BADGE_STYLES: Record<BadgeTone, CSSProperties> = {
  green: { color: T.green, background: T.greenBg, border: `1px solid ${T.greenBorder}` },
  cyan: { color: T.cyan, background: 'rgba(34,211,238,.1)', border: '1px solid rgba(34,211,238,.35)' },
  violet: { color: '#a78bfa', background: 'rgba(167,139,250,.12)', border: '1px solid rgba(167,139,250,.35)' },
  amber: { color: T.amber, background: T.amberBg, border: `1px solid ${T.amberBorder}` },
  neutral: { color: T.sub, background: T.row, border: `1px solid ${T.cb}` },
};

export function Badge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return <span style={{ ...BADGE_STYLES[tone], display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 800, borderRadius: 999, padding: '3px 9px', whiteSpace: 'nowrap' }}>{children}</span>;
}

export function MissionBadges({ mission }: { mission: FeedMission }) {
  const info = categoryInfo(mission.category);
  return (
    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
      <Badge tone="green">Solidaire</Badge>
      {mission.isShort && <Badge tone="cyan">Mission courte</Badge>}
      {/* Distinction explicite : mission importée d'une plateforme partenaire
          (candidature sur son site) ou publiée directement sur UROSI. */}
      {mission.kind === 'external_solidarity_mission' ? (
        <Badge tone="neutral">↗ Via {mission.partnerName ?? 'un partenaire'}</Badge>
      ) : (
        <Badge tone="neutral">Publiée sur UROSI</Badge>
      )}
      {info.key !== 'autre' && <Badge tone="violet">{info.label}</Badge>}
    </div>
  );
}

export function HeartButton({ active, onToggle, label }: { active: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={active ? `Retirer ${label} des favoris` : `Ajouter ${label} aux favoris`}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,.94)', color: active ? '#e11d48' : '#334155', fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(0,0,0,.18)' }}
    >
      {active ? '♥' : '♡'}
    </button>
  );
}

export function whenLabel(mission: FeedMission): string {
  const parts: string[] = [];
  if (mission.date) parts.push(formatDay(mission.date));
  if (mission.startTime && mission.endTime) parts.push(`${mission.startTime}–${mission.endTime}`);
  else if (mission.startTime) parts.push(mission.startTime);
  if (!mission.date && mission.scheduleText) parts.push(mission.scheduleText);
  return parts.join(' · ') || 'Dates à convenir';
}

export function durationLabel(minutes: number | null): string | null {
  if (!minutes) return null;
  const h = minutes / 60;
  if (h < 1) return `${minutes} min`;
  return Number.isInteger(h) ? `${h} h` : `${h.toFixed(1).replace('.', ',')} h`;
}

export function FeedMissionCard({
  mission,
  distance,
  favorite,
  onToggleFavorite,
  onOpen,
  compact = false,
}: {
  mission: FeedMission;
  distance: number | null;
  favorite: boolean;
  onToggleFavorite: () => void;
  onOpen: () => void;
  compact?: boolean;
}) {
  const duration = durationLabel(mission.durationMinutes);
  const impressionRef = useImpressionTracking<HTMLElement>(mission.impressionUrl);
  return (
    <article ref={impressionRef} data-mission-kind={mission.kind} style={{ position: 'relative', background: T.card, border: `1px solid ${T.cb}`, borderRadius: 16, overflow: 'hidden', boxShadow: '0 6px 18px rgba(15,23,42,.06)' }}>
      <button type="button" onClick={onOpen} aria-label={`Voir la mission ${mission.title}`} style={{ position: 'absolute', inset: 0, zIndex: 1, background: 'transparent', border: 0, cursor: 'pointer' }} />
      <MissionVisual mission={mission} height={compact ? 110 : 138} radius={0}>
        {distance != null && (
          <span style={{ position: 'absolute', left: 10, bottom: 10, background: 'rgba(15,23,42,.72)', color: '#fff', fontSize: 10.5, fontWeight: 800, borderRadius: 999, padding: '4px 9px' }}>📍 {formatDistance(distance)}</span>
        )}
      </MissionVisual>
      <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 2 }}>
        <HeartButton active={favorite} onToggle={onToggleFavorite} label={mission.title} />
      </div>
      <div style={{ padding: '11px 13px 13px', display: 'grid', gap: 6 }}>
        <div style={{ fontSize: 14.5, fontWeight: 900, color: T.text, lineHeight: 1.25 }}>{mission.title}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <OrgLogo name={mission.organization.name} url={mission.organization.logoUrl} />
          <span style={{ fontSize: 11.5, fontWeight: 700, color: T.sub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{mission.organization.name}</span>
          {mission.organization.verified && <span title="Structure vérifiée" style={{ color: T.green, fontSize: 11, fontWeight: 900 }}>✓</span>}
        </div>
        <div style={{ fontSize: 11, color: T.mu, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <span>📅 {whenLabel(mission)}</span>
          {duration && <span>⏱ {duration}</span>}
          {mission.city && <span>📍 {mission.city}</span>}
          {mission.places != null && mission.places > 0 && <span>👥 {mission.places} place{mission.places > 1 ? 's' : ''}</span>}
        </div>
        <MissionBadges mission={mission} />
      </div>
    </article>
  );
}

export function EmptyState({ icon, title, children }: { icon: string; title: string; children?: ReactNode }) {
  return (
    <div style={{ background: T.card, border: `1px dashed ${T.cb}`, borderRadius: 16, padding: '26px 18px', textAlign: 'center' }}>
      <div style={{ fontSize: 28, marginBottom: 8 }}>{icon}</div>
      <div style={{ fontSize: 13.5, fontWeight: 900, color: T.text, marginBottom: 6 }}>{title}</div>
      {children && <div style={{ fontSize: 11.5, color: T.sub, lineHeight: 1.55 }}>{children}</div>}
    </div>
  );
}
