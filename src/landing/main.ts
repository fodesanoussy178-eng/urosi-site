// Landing statique (index.html) : remplit le téléphone de démonstration avec
// les mêmes missions d'exemple et illustrations que le catalogue /missions,
// pour une façade cohérente même avant l'import des missions réelles.
import { sceneSvg } from '@/features/missions/categoryScene';
import { demoMissions } from '@/features/missions/demoMissions';

const PHONE_IDS = ['colis', 'festival', 'devoirs', 'vetements', 'berges'];
const DAY = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

function card(m: ReturnType<typeof demoMissions>[number], distance: string): string {
  const d = m.date ? DAY.format(new Date(`${m.date}T12:00:00`)).replace('.', '') : '';
  const hours = m.durationMinutes ? `${Math.round(m.durationMinutes / 60)} h` : '';
  return `<article class="ph-card">
    <div class="ph-visual">${sceneSvg(m.category, m.key)}</div>
    <div class="ph-body">
      <div class="ph-title">${escapeHtml(m.title)}</div>
      <div class="ph-org">${escapeHtml(m.organization.name)}</div>
      <div class="ph-meta">📍 ${escapeHtml(distance)} · ${escapeHtml([d, hours].filter(Boolean).join(' · '))}</div>
    </div>
  </article>`;
}

function renderPhone(): void {
  const list = document.getElementById('phone-feed');
  if (!list) return;
  const all = demoMissions();
  const picked = PHONE_IDS.map((id) => all.find((m) => m.id === id)).filter((m): m is NonNullable<typeof m> => Boolean(m));
  const distances = ['2,1 km', '5,4 km', '3,5 km', '2,7 km', '1,8 km'];
  const html = picked.map((m, i) => card(m, distances[i] ?? '')).join('');
  // Deux fois la liste : défilement continu sans saut.
  list.innerHTML = `<div class="ph-track">${html}${html}</div>`;
}

function renderIllustrations(): void {
  document.querySelectorAll<HTMLElement>('[data-scene]').forEach((el) => {
    const category = el.dataset.scene as Parameters<typeof sceneSvg>[0];
    el.innerHTML = sceneSvg(category, el.dataset.seed ?? category);
  });
}

function revealOnScroll(): void {
  const els = document.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window)) {
    els.forEach((el) => el.classList.add('in'));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add('in');
          io.unobserve(e.target);
        }
      });
    },
    { threshold: 0.1 },
  );
  els.forEach((el) => io.observe(el));
  // Filet de sécurité : jamais de section invisible (impression, capture,
  // navigateur qui ne déclenche pas l'observer, ancre #comment…).
  window.setTimeout(() => els.forEach((el) => el.classList.add('in')), 1500);
}

renderPhone();
renderIllustrations();
revealOnScroll();
