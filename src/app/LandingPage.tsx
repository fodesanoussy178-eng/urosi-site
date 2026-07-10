import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/features/auth/AuthContext';
import { Logo } from '@/components/ui/Logo';
import { Stars } from '@/components/ui/Stars';
import { PricingDetails } from '@/components/ui/PricingDetails';
import { T, FONT } from '@/components/ui/theme';
import { fetchOpenMissions, type MissionWithStructure } from '@/features/missions/missionsService';
import type { PricingBreakdown } from '@/types/database.types';
import { formatEuros, formatHours } from '@/lib/format';

function euros(cents: number): string {
  return formatEuros(cents).replace(' EUR', ' €');
}

// Vitrine "horaires variables" : mêmes règles que le moteur de rémunération.
const HORAIRES_VARIABLES: [string, string][] = [
  ['🌅 Tôt le matin (5h-8h)', '+10 %'],
  ['🌙 Soir & nuit (21h-6h)', '+25 %'],
  ['🗓 Week-end', '+20 %'],
  ['🎆 Jour férié', '+50 %'],
  ['⚡ Urgence', '+15 %'],
  ['📍 Site éloigné', '+3 €'],
];

const DEMO_BREAKDOWN: PricingBreakdown = {
  base_cents: 4200,
  adjustments: [
    { rule_id: 'demo-we', kind: 'day_of_week', label: 'Majoration week-end', amount_cents: 840 },
    { rule_id: 'demo-nuit', kind: 'time_of_day', label: 'Majoration nuit (21h-6h)', amount_cents: 1050 },
    { rule_id: 'demo-urg', kind: 'urgency', label: 'Mission urgente', amount_cents: 630 },
  ],
  total_cents: 6720,
};

// Cartes de démonstration affichées uniquement si aucune mission réelle n'est
// publiée (base vide) — clairement marquées "démo".
interface LandingMission {
  id: string;
  title: string;
  structureName: string;
  city: string;
  date: string;
  startTime: string | null;
  durationMinutes: number;
  rateCents: number;
  baseCents: number | null;
  breakdown: PricingBreakdown | null;
  isUrgent: boolean;
  isSolidaire: boolean;
  isDemo: boolean;
}

const DEMO_MISSIONS: LandingMission[] = [
  {
    id: 'demo-1',
    title: 'Renfort service du midi',
    structureName: 'Brasserie du Beffroi',
    city: 'Lille',
    date: 'demain',
    startTime: '11:30',
    durationMinutes: 240,
    rateCents: 5240,
    baseCents: 4200,
    breakdown: {
      base_cents: 4200,
      adjustments: [
        { rule_id: 'd1', kind: 'day_of_week', label: 'Majoration week-end', amount_cents: 840 },
        { rule_id: 'd2', kind: 'custom', label: 'Bonus qualité', amount_cents: 200 },
      ],
      total_cents: 5240,
    },
    isUrgent: false,
    isSolidaire: false,
    isDemo: true,
  },
  {
    id: 'demo-2',
    title: 'Inventaire de nuit',
    structureName: 'Marché de Wazemmes Logistique',
    city: 'Lille',
    date: 'ce soir',
    startTime: '22:00',
    durationMinutes: 300,
    rateCents: 6720,
    baseCents: 4200,
    breakdown: DEMO_BREAKDOWN,
    isUrgent: true,
    isSolidaire: false,
    isDemo: true,
  },
  {
    id: 'demo-3',
    title: 'Distribution alimentaire solidaire',
    structureName: 'Les Restos du Nord',
    city: 'Roubaix',
    date: 'samedi',
    startTime: '09:00',
    durationMinutes: 180,
    rateCents: 0,
    baseCents: null,
    breakdown: null,
    isUrgent: false,
    isSolidaire: true,
    isDemo: true,
  },
];

const DEMO_PROFILES = [
  { name: 'Sofia M.', city: 'Lille', missions: 23, note: 4.8, skills: ['service', 'caisse', 'événementiel'] },
  { name: 'Karim B.', city: 'Roubaix', missions: 17, note: 4.6, skills: ['manutention', 'logistique'] },
];

function toLanding(m: MissionWithStructure): LandingMission {
  return {
    id: m.id,
    title: m.title,
    structureName: m.structure?.name ?? 'Structure',
    city: m.city || 'MEL',
    date: m.scheduled_date,
    startTime: m.start_time ? m.start_time.slice(0, 5) : null,
    durationMinutes: m.duration_minutes,
    rateCents: m.worker_rate_cents,
    baseCents: m.base_rate_cents,
    breakdown: m.pricing_breakdown,
    isUrgent: m.is_urgent,
    isSolidaire: m.is_solidaire,
    isDemo: false,
  };
}

// Page d'accueil publique de urosi.fr : hero, missions réelles (Supabase),
// horaires variables, profils. Les cartes utilisent les mêmes composants et
// données que l'application ; la démo statique n'existe plus.
export function LandingPage() {
  const nav = useNavigate();
  const { session, profile } = useAuth();
  const [missions, setMissions] = useState<LandingMission[] | null>(null);

  useEffect(() => {
    let active = true;
    fetchOpenMissions()
      .then((rows) => {
        if (!active) return;
        setMissions(rows.length > 0 ? rows.slice(0, 6).map(toLanding) : DEMO_MISSIONS);
      })
      .catch(() => active && setMissions(DEMO_MISSIONS));
    return () => {
      active = false;
    };
  }, []);

  const usingDemo = missions != null && missions.some((m) => m.isDemo);
  const prenom = (profile?.full_name || '').split(' ')[0];

  function openApp() {
    nav(session ? '/app' : '/connexion');
  }

  function postuler() {
    // Non connecté : on passe par la connexion/inscription ; connecté : le
    // vrai flux de missions est dans l'app.
    nav(session ? '/app' : '/connexion');
  }

  const card = { background: T.card, border: `1px solid ${T.cb}`, borderRadius: 14 } as const;
  const h2 = { fontSize: 11, fontWeight: 800, color: T.cyan, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 } as const;

  return (
    <div style={{ minHeight: '100vh', background: T.bg, display: 'flex', justifyContent: 'center', fontFamily: FONT }}>
      <div style={{ width: '100%', maxWidth: 460, padding: '0 16px 40px' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 0 8px' }}>
          <Logo sz={38} />
          <button
            onClick={openApp}
            style={{ background: T.grad, color: '#fff', border: 'none', borderRadius: 10, padding: '9px 16px', fontSize: 12.5, fontWeight: 900, cursor: 'pointer' }}
          >
            {session ? `Ouvrir l'app${prenom ? ` — ${prenom}` : ''} →` : "Ouvrir l'app →"}
          </button>
        </div>

        {/* Hero */}
        <div style={{ padding: '26px 0 22px', textAlign: 'center' }}>
          <div style={{ fontSize: 30, fontWeight: 900, color: T.text, letterSpacing: -1.2, lineHeight: 1.15, marginBottom: 10 }}>
            Des missions courtes,
            <br />
            <span style={{ background: T.grad, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>payées au juste prix.</span>
          </div>
          <div style={{ fontSize: 13, color: T.sub, lineHeight: 1.6, marginBottom: 18 }}>
            Micro-missions de la Métropole Européenne de Lille. 5h max, rémunération
            transparente qui monte selon l'horaire, le jour et l'urgence — payée sur ton wallet dès la mission terminée.
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={openApp} style={{ background: '#fff', color: '#000', border: 'none', borderRadius: 11, padding: '13px 22px', fontSize: 14, fontWeight: 900, cursor: 'pointer' }}>
              {session ? "Reprendre l'app →" : 'Trouver une mission'}
            </button>
            {!session && (
              <button onClick={() => nav('/acces')} style={{ background: T.card, color: T.text, border: `1px solid ${T.cb}`, borderRadius: 11, padding: '13px 22px', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>
                Créer un compte
              </button>
            )}
          </div>
        </div>

        {/* Missions en direct */}
        <div style={{ marginBottom: 22 }}>
          <div style={h2}>
            {usingDemo ? 'Aperçu — missions de démonstration' : '● En ce moment sur UROSI'}
          </div>
          {missions == null && <div style={{ fontSize: 11, color: T.mu, textAlign: 'center', padding: 18 }}>Chargement des missions…</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {(missions ?? []).map((m) => (
              <div key={m.id} style={{ ...card, border: `1px solid ${m.isSolidaire ? '#14532d' : T.cb}`, overflow: 'hidden' }}>
                <div style={{ padding: '14px 15px 12px' }}>
                  {m.isSolidaire ? (
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 5 }}>
                      <span style={{ fontSize: 22, fontWeight: 900, color: T.green, letterSpacing: -1 }}>Solidaire</span>
                      <span style={{ fontSize: 14, fontWeight: 800, color: T.sub }}>0 €</span>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 5, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 29, fontWeight: 900, color: T.text, letterSpacing: -1.5, lineHeight: 1 }}>{euros(m.rateCents)}</span>
                      {m.breakdown && m.breakdown.adjustments.length > 0 && (
                        <span style={{ fontSize: 9, fontWeight: 800, color: '#facc15', background: '#42200620', border: '1px solid #713f12', borderRadius: 10, padding: '2px 7px' }}>
                          ⚡ boostée{m.baseCents != null ? ` (base ${euros(m.baseCents)})` : ''}
                        </span>
                      )}
                      {m.isUrgent && <span style={{ fontSize: 9, fontWeight: 800, color: T.amber, background: T.amberBg, borderRadius: 10, padding: '2px 7px' }}>Urgent</span>}
                      {m.isDemo && <span style={{ fontSize: 9, fontWeight: 800, color: T.mu, background: T.row, borderRadius: 10, padding: '2px 7px' }}>démo</span>}
                    </div>
                  )}
                  <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 4 }}>{m.title}</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: T.sub, marginBottom: 3 }}>{m.structureName}</div>
                  <div style={{ fontSize: 10, color: T.mu, marginBottom: m.breakdown && m.breakdown.adjustments.length > 0 ? 9 : 0 }}>
                    📍 {m.city} · {m.date}
                    {m.startTime ? ` · ${m.startTime}` : ''} · {formatHours(m.durationMinutes)}
                  </div>
                  {m.breakdown && m.breakdown.adjustments.length > 0 && <PricingDetails breakdown={m.breakdown} compact />}
                </div>
                <div style={{ padding: '0 15px 13px' }}>
                  <button
                    onClick={postuler}
                    style={{ width: '100%', background: m.isSolidaire ? '#16a34a' : '#fff', color: m.isSolidaire ? '#fff' : '#000', border: 'none', borderRadius: 9, padding: '10px 0', fontSize: 13, fontWeight: 900, cursor: 'pointer' }}
                  >
                    {session ? "Voir dans l'app →" : m.isSolidaire ? '🤝 Participer' : 'Postuler'}
                  </button>
                </div>
              </div>
            ))}
          </div>
          {!session && missions != null && (
            <div style={{ fontSize: 10, color: T.mu, textAlign: 'center', marginTop: 8 }}>
              Connecte-toi pour postuler — ton profil et ton wallet te suivent partout.
            </div>
          )}
        </div>

        {/* Horaires variables / rémunération intelligente */}
        <div style={{ ...card, padding: 16, marginBottom: 14 }}>
          <div style={h2}>⚡ Rémunération intelligente</div>
          <div style={{ fontSize: 12, color: T.sub, lineHeight: 1.6, marginBottom: 12 }}>
            Le revenu d'une mission n'est pas figé : il monte automatiquement selon l'horaire, le jour, l'urgence ou la
            difficulté. Chaque majoration est affichée noir sur blanc avant de postuler.
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 13 }}>
            {HORAIRES_VARIABLES.map(([label, boost]) => (
              <span key={label} style={{ fontSize: 10.5, fontWeight: 700, color: T.text, background: T.row, border: `1px solid ${T.cb}`, borderRadius: 20, padding: '5px 11px' }}>
                {label} <span style={{ color: T.green, fontWeight: 900 }}>{boost}</span>
              </span>
            ))}
          </div>
          <PricingDetails breakdown={DEMO_BREAKDOWN} compact />
          <div style={{ fontSize: 9.5, color: T.mu }}>Exemple : mission de nuit un samedi, publiée en urgence — 42 € de base, 67,20 € payés.</div>
        </div>

        {/* Profils / CV vivant */}
        <div style={{ ...card, padding: 16, marginBottom: 14 }}>
          <div style={h2}>👤 Des profils prouvés, pas des CV déclaratifs</div>
          <div style={{ fontSize: 12, color: T.sub, lineHeight: 1.6, marginBottom: 12 }}>
            Chaque mission terminée et notée rejoint le <strong style={{ color: T.text }}>CV vivant</strong> du
            travailleur : présence validée par QR, note de la structure, jamais bloquant.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {DEMO_PROFILES.map((p) => (
              <div key={p.name} style={{ display: 'flex', gap: 11, alignItems: 'center', background: T.row, borderRadius: 11, padding: '11px 13px' }}>
                <div style={{ width: 38, height: 38, borderRadius: 11, background: 'linear-gradient(135deg,#f97316,#dc2626)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, color: '#fff', fontSize: 15, flexShrink: 0 }}>
                  {p.name.charAt(0)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12.5, fontWeight: 800, color: T.text }}>{p.name}</span>
                    <Stars n={p.note} size={10} />
                    <span style={{ fontSize: 10, color: T.mu }}>{p.note.toFixed(1).replace('.', ',')}</span>
                  </div>
                  <div style={{ fontSize: 9.5, color: T.mu, margin: '2px 0 4px' }}>
                    {p.city} · {p.missions} missions prouvées
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {p.skills.map((s) => (
                      <span key={s} style={{ fontSize: 8.5, fontWeight: 700, color: T.cyan, background: '#22d3ee12', border: '1px solid #164e63', borderRadius: 10, padding: '1px 7px' }}>
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 9, color: T.mu, marginTop: 8 }}>Profils d'illustration — les vrais CV vivants se construisent mission après mission.</div>
        </div>

        {/* Comment ça marche */}
        <div style={{ ...card, padding: 16, marginBottom: 18 }}>
          <div style={h2}>Comment ça marche</div>
          {(
            [
              ['1', 'La structure publie', "Mission de 5h max, tarif de base + règles de majoration qu'elle configure."],
              ['2', 'Le travailleur postule', 'En un geste. La structure choisit, le fil de discussion s\'ouvre, le QR valide la présence.'],
              ['3', 'Paiement instantané', 'Mission terminée → wallet crédité, commission transparente, note au CV vivant.'],
            ] as [string, string, string][]
          ).map(([n, t, d]) => (
            <div key={n} style={{ display: 'flex', gap: 12, padding: '9px 0', alignItems: 'flex-start' }}>
              <div style={{ width: 26, height: 26, borderRadius: '50%', background: T.grad, color: '#fff', fontSize: 12, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{n}</div>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 800, color: T.text, marginBottom: 2 }}>{t}</div>
                <div style={{ fontSize: 11, color: T.sub, lineHeight: 1.5 }}>{d}</div>
              </div>
            </div>
          ))}
        </div>

        {/* CTA final */}
        <div style={{ textAlign: 'center', padding: '4px 0 10px' }}>
          <button onClick={openApp} style={{ background: T.grad, color: '#fff', border: 'none', borderRadius: 12, padding: '15px 34px', fontSize: 15, fontWeight: 900, cursor: 'pointer' }}>
            {session ? "Ouvrir l'app →" : 'Rejoindre UROSI →'}
          </button>
          <div style={{ fontSize: 9.5, color: T.mu, marginTop: 14, lineHeight: 1.6 }}>
            UROSI · micro-missions de la Métropole Européenne de Lille
            <br />
            Modèle mandataire · plafond légal 5h/mission · notes informatives, jamais bloquantes
          </div>
        </div>
      </div>
    </div>
  );
}
