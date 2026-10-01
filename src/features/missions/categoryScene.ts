// Illustrations UROSI par catégorie (SVG en chaîne, sans dépendance) :
// utilisées quand une mission n'a ni photo ni illustration de sa source, sur
// la landing statique comme dans l'application. Aucune photo de personne
// réelle : des silhouettes stylisées, jamais identifiables.
import type { SolidarityCategory } from './categories';

interface Palette {
  sky: string;
  skyTo: string;
  accent: string;
  accentDark: string;
  ground: string;
}

const PALETTES: Record<SolidarityCategory, Palette> = {
  aide_alimentaire: { sky: '#fff4e6', skyTo: '#ffe3c2', accent: '#f08a24', accentDark: '#c45f0c', ground: '#f5d2a8' },
  evenementiel: { sky: '#f3ecff', skyTo: '#e2d4ff', accent: '#8b5cf6', accentDark: '#6435c9', ground: '#d8c8fb' },
  soutien_scolaire: { sky: '#eaf3ff', skyTo: '#d3e6ff', accent: '#2f6fe4', accentDark: '#1d4fb3', ground: '#c4dafc' },
  environnement: { sky: '#eafaf0', skyTo: '#cff1dc', accent: '#22a55b', accentDark: '#157a40', ground: '#b9e6c9' },
  solidarite: { sky: '#fff0f1', skyTo: '#ffdadd', accent: '#e5484d', accentDark: '#b42c31', ground: '#f8c7ca' },
  sport: { sky: '#e8f7fb', skyTo: '#c9edf6', accent: '#0891b2', accentDark: '#0b6a84', ground: '#b5e2ee' },
  culture: { sky: '#fdeefa', skyTo: '#f8d5f0', accent: '#d9469a', accentDark: '#a82a72', ground: '#f2c2e3' },
  sante: { sky: '#e9faf8', skyTo: '#cbf2ec', accent: '#0f9f8f', accentDark: '#0b766a', ground: '#b3e8e0' },
  autre: { sky: '#edf3ff', skyTo: '#d8e5ff', accent: '#2563eb', accentDark: '#1e48b0', ground: '#c9d9fb' },
};

const SKIN = ['#f1c7a4', '#c98b62', '#8d5a3b', '#e6b08c', '#5b3a29'];
const HAIR = ['#2b1d16', '#4a2f1f', '#1d1a19', '#7a4a24', '#101014'];

function person(x: number, y: number, scale: number, skin: string, hair: string, shirt: string, armUp = false): string {
  const s = scale;
  return `<g transform="translate(${x} ${y}) scale(${s})">
    <path d="M-24 64 Q-24 18 0 18 Q24 18 24 64 Z" fill="${shirt}"/>
    ${armUp ? `<path d="M16 30 Q30 10 34 -6" stroke="${shirt}" stroke-width="11" stroke-linecap="round" fill="none"/><circle cx="34" cy="-8" r="6" fill="${skin}"/>` : ''}
    <rect x="-6" y="6" width="12" height="14" rx="5" fill="${skin}"/>
    <circle cx="0" cy="-4" r="15" fill="${skin}"/>
    <path d="M-15 -6 Q-14 -22 0 -21 Q14 -22 15 -6 Q8 -14 0 -13 Q-9 -14 -15 -6 Z" fill="${hair}"/>
  </g>`;
}

function prop(category: SolidarityCategory, p: Palette): string {
  switch (category) {
    case 'aide_alimentaire':
      return `<g transform="translate(140 108)">
        <rect x="0" y="0" width="54" height="40" rx="4" fill="#d9a066"/><path d="M0 12 H54" stroke="#b8823f" stroke-width="3"/>
        <path d="M27 20 c-4 -6 -12 -2 -8 4 l8 8 l8 -8 c4 -6 -4 -10 -8 -4z" fill="${p.accent}"/>
        <rect x="58" y="10" width="44" height="30" rx="4" fill="#e7b57d"/><path d="M58 20 H102" stroke="#c38f4f" stroke-width="3"/>
        <circle cx="70" cy="4" r="7" fill="#e5484d"/><rect x="80" y="-6" width="9" height="16" rx="3" fill="#22a55b"/></g>`;
    case 'evenementiel':
      return `<path d="M20 34 Q160 70 300 30" stroke="${p.accentDark}" stroke-width="2" fill="none"/>
        ${[40, 80, 120, 160, 200, 240, 280].map((x, i) => `<path d="M${x} ${38 + Math.sin(i) * 6} l10 20 l10 -18 z" fill="${['#f08a24', p.accent, '#22a55b', '#2f6fe4', '#e5484d'][i % 5]}"/>`).join('')}
        <path d="M150 150 L185 98 L220 150 Z" fill="${p.accent}"/><path d="M185 98 L185 150" stroke="#fff" stroke-width="3"/>`;
    case 'soutien_scolaire':
      return `<g transform="translate(138 116)"><path d="M0 8 Q22 0 44 8 L44 40 Q22 32 0 40 Z" fill="#fff" stroke="${p.accentDark}" stroke-width="2"/>
        <path d="M44 8 Q66 0 88 8 L88 40 Q66 32 44 40 Z" fill="#fff" stroke="${p.accentDark}" stroke-width="2"/>
        ${[14, 20, 26].map((y) => `<path d="M8 ${y} H36 M52 ${y} H80" stroke="${p.accent}" stroke-width="2"/>`).join('')}</g>
        <rect x="236" y="36" width="54" height="36" rx="4" fill="#1f3b2f"/><path d="M246 50 H274 M246 60 H266" stroke="#fff" stroke-width="2"/>`;
    case 'environnement':
      return `<rect x="252" y="80" width="8" height="60" fill="#8a5a33"/><circle cx="256" cy="72" r="28" fill="${p.accent}"/><circle cx="238" cy="88" r="16" fill="#2fbf6b"/>
        <path d="M150 150 q18 -34 36 0 z" fill="#1f2937" opacity=".85"/><circle cx="130" cy="146" r="5" fill="${p.accentDark}"/>
        <path d="M60 40 q10 -14 22 -2 q-8 12 -22 2z" fill="${p.accent}"/><path d="M90 30 q8 -12 18 -2 q-6 10 -18 2z" fill="#2fbf6b"/>`;
    case 'solidarite':
      return `<path d="M160 70 c-12 -18 -40 -6 -28 16 l28 26 l28 -26 c12 -22 -16 -34 -28 -16z" fill="${p.accent}"/>
        <path d="M150 150 q10 -26 30 -26 q20 0 30 26" fill="${p.accentDark}" opacity=".25"/>`;
    case 'sport':
      return `<circle cx="160" cy="132" r="18" fill="#fff" stroke="#1f2937" stroke-width="2"/><path d="M160 116 l8 10 l-3 12 h-10 l-3 -12z" fill="#1f2937"/>
        <path d="M230 150 l10 -30 l10 30z" fill="#f08a24"/><path d="M262 150 l10 -30 l10 30z" fill="#f08a24"/>`;
    case 'culture':
      return `<g transform="translate(140 60)"><path d="M0 0 h40 v26 q0 22 -20 22 q-20 0 -20 -22z" fill="#fff" stroke="${p.accentDark}" stroke-width="2"/>
        <circle cx="12" cy="16" r="3" fill="${p.accentDark}"/><circle cx="28" cy="16" r="3" fill="${p.accentDark}"/><path d="M11 30 q9 8 18 0" stroke="${p.accentDark}" stroke-width="2" fill="none"/></g>
        <g transform="translate(190 76)"><path d="M0 0 h40 v26 q0 22 -20 22 q-20 0 -20 -22z" fill="${p.accent}"/>
        <circle cx="12" cy="16" r="3" fill="#fff"/><circle cx="28" cy="16" r="3" fill="#fff"/><path d="M11 34 q9 -8 18 0" stroke="#fff" stroke-width="2" fill="none"/></g>`;
    case 'sante':
      return `<rect x="146" y="58" width="44" height="44" rx="10" fill="#fff" stroke="${p.accent}" stroke-width="3"/><path d="M168 68 v24 M156 80 h24" stroke="${p.accent}" stroke-width="6" stroke-linecap="round"/>
        <path d="M210 90 h16 l6 -12 l8 24 l6 -12 h20" stroke="${p.accentDark}" stroke-width="3" fill="none"/>`;
    default:
      return `<path d="M168 60 l7 16 l17 2 l-13 11 l4 17 l-15 -9 l-15 9 l4 -17 l-13 -11 l17 -2z" fill="${p.accent}"/>`;
  }
}

function hash(seed: string): number {
  let h = 7;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

// `seed` varie légèrement les personnages d'une mission à l'autre.
export function sceneSvg(category: SolidarityCategory, seed = ''): string {
  const p = PALETTES[category] ?? PALETTES.autre;
  const h = hash(seed + category);
  const a = h % SKIN.length;
  const b = (h >> 3) % SKIN.length;
  const gid = `g${h.toString(36)}`;
  const leftShirt = ['#1e3a8a', p.accentDark, '#0f766e', '#334155'][h % 4] as string;
  return `<svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" width="100%" height="100%">
  <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.sky}"/><stop offset="1" stop-color="${p.skyTo}"/></linearGradient></defs>
  <rect width="320" height="180" fill="url(#${gid})"/>
  <circle cx="270" cy="38" r="22" fill="#fff" opacity=".7"/>
  <path d="M0 132 Q80 112 160 128 T320 120 V180 H0 Z" fill="${p.ground}"/>
  <path d="M0 150 Q90 138 170 150 T320 146 V180 H0 Z" fill="#fff" opacity=".45"/>
  ${prop(category, p)}
  ${person(84, 104, 1, SKIN[a] as string, HAIR[a] as string, leftShirt, h % 3 === 0)}
  ${person(254, 110, 0.92, SKIN[b] as string, HAIR[b] as string, p.accent)}
</svg>`;
}

export function sceneDataUri(category: SolidarityCategory, seed = ''): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sceneSvg(category, seed))}`;
}
