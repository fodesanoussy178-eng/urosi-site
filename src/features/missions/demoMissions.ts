// MISSIONS DE DÉMONSTRATION — contenu temporaire, clairement identifié.
//
// Affichées UNIQUEMENT quand aucune mission réelle n'est disponible (API
// Engagement pas encore configurée, aucune mission native publiée), pour que
// le catalogue public ne soit jamais vide. Règles :
//   - organisations FICTIVES (aucun nom d'association réelle) ;
//   - `isDemo: true` sur chaque mission : l'interface affiche la mention
//     « Exemple » et ne propose jamais de candidature vers un site externe ;
//   - dates recalculées à partir d'aujourd'hui, jamais périmées ;
//   - désactivables d'un coup : VITE_DEMO_MISSIONS=false.
import type { FeedMission } from './solidarityMissions';
import type { SolidarityCategory } from './categories';

export const demoMissionsEnabled = (import.meta.env.VITE_DEMO_MISSIONS as string | undefined) !== 'false';

interface DemoSeed {
  id: string;
  title: string;
  organization: string;
  category: SolidarityCategory;
  city: string;
  address: string;
  lat: number;
  lng: number;
  inDays: number;
  start: string;
  end: string;
  places: number;
  description: string;
}

const SEEDS: DemoSeed[] = [
  {
    id: 'colis', title: 'Distribution de colis alimentaires', organization: 'Épicerie solidaire de Fives', category: 'aide_alimentaire',
    city: 'Lille', address: 'Quartier de Fives', lat: 50.628, lng: 3.089, inDays: 2, start: '09:00', end: '12:00', places: 8,
    description: "Aide à préparer et à distribuer des colis alimentaires aux familles du quartier. Accueil, tri des denrées et remise des colis, en équipe avec des bénévoles réguliers. Aucune expérience n'est nécessaire : on t'explique tout sur place.",
  },
  {
    id: 'festival', title: "Aide à l'organisation d'un festival de quartier", organization: 'Festival des Voisins', category: 'evenementiel',
    city: 'Lille', address: 'Parc Jean-Baptiste Lebas', lat: 50.63, lng: 3.068, inDays: 6, start: '14:00', end: '18:00', places: 12,
    description: "Accueil du public, orientation des visiteurs et aide à l'installation des stands pour une après-midi festive et gratuite ouverte à tous les habitants.",
  },
  {
    id: 'devoirs', title: 'Soutien scolaire pour des collégiens', organization: 'Réussir Ensemble Roubaix', category: 'soutien_scolaire',
    city: 'Roubaix', address: 'Centre social du Pile', lat: 50.683, lng: 3.19, inDays: 4, start: '17:00', end: '19:00', places: 4,
    description: "Accompagne des élèves de 6e et 5e dans leurs devoirs de français et de mathématiques. Patience et bonne humeur suffisent, le programme est préparé par l'équipe.",
  },
  {
    id: 'berges', title: 'Nettoyage citoyen des berges de la Deûle', organization: 'Collectif Berges Propres', category: 'environnement',
    city: 'Lambersart', address: 'Berges de la Deûle', lat: 50.648, lng: 3.028, inDays: 3, start: '10:00', end: '12:00', places: 20,
    description: 'Ramassage des déchets le long des berges, tri et pesée de la collecte. Gants et sacs fournis. Une matinée utile et conviviale au grand air.',
  },
  {
    id: 'vetements', title: 'Collecte et tri de vêtements', organization: 'Vestiaire Solidaire Tourcoing', category: 'solidarite',
    city: 'Tourcoing', address: 'Rue de Lille', lat: 50.72, lng: 3.16, inDays: 5, start: '14:00', end: '17:00', places: 6,
    description: "Réception des dons, tri par taille et par saison, mise en rayon au vestiaire solidaire. Idéal pour découvrir le fonctionnement d'une association de proximité.",
  },
  {
    id: 'seniors', title: 'Visite et accompagnement de personnes âgées', organization: 'Lien Voisins Seniors', category: 'sante',
    city: 'Villeneuve-d’Ascq', address: 'Résidence des Tilleuls', lat: 50.623, lng: 3.141, inDays: 7, start: '15:00', end: '17:00', places: 3,
    description: 'Partager un moment, discuter, jouer à un jeu de société ou faire une courte promenade avec des personnes âgées isolées. Une présence qui compte.',
  },
  {
    id: 'tournoi', title: 'Encadrement d’un tournoi de foot solidaire', organization: 'Sport pour Tous MEL', category: 'sport',
    city: 'Marcq-en-Barœul', address: 'Complexe sportif Jean Bouin', lat: 50.671, lng: 3.09, inDays: 9, start: '13:30', end: '17:30', places: 10,
    description: "Arbitrage, tenue des scores et accueil des équipes pour un tournoi ouvert aux jeunes du territoire. Bonne ambiance garantie.",
  },
  {
    id: 'lecture', title: 'Animation d’un atelier lecture pour enfants', organization: 'Bibliothèque de Rue Wazemmes', category: 'culture',
    city: 'Lille', address: 'Place de la Nouvelle Aventure', lat: 50.625, lng: 3.051, inDays: 8, start: '10:00', end: '12:00', places: 4,
    description: 'Lecture d’albums, jeux autour des histoires et prêt de livres en plein air, avec une équipe qui anime ces ateliers chaque semaine.',
  },
];

function isoDay(offset: number, now: Date): string {
  const d = new Date(now);
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

function minutes(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  return (eh! * 60 + em!) - (sh! * 60 + sm!);
}

export function demoMissions(now = new Date()): FeedMission[] {
  return SEEDS.map((s) => {
    const duration = minutes(s.start, s.end);
    return {
      key: `demo:${s.id}`,
      id: s.id,
      kind: 'urosi_solidarity_mission',
      source: 'demo',
      title: s.title,
      description: s.description,
      organization: { id: null, name: s.organization, logoUrl: null, verified: true },
      imageUrl: null,
      imageLevel: null,
      domainLogoUrl: null,
      category: s.category,
      city: s.city,
      address: s.address,
      coords: { lat: s.lat, lng: s.lng },
      date: isoDay(s.inDays, now),
      startTime: s.start,
      endTime: s.end,
      scheduleText: null,
      durationMinutes: duration,
      places: s.places,
      applicationUrl: null,
      partnerName: null,
      impressionUrl: null,
      isShort: duration <= 240,
      isDemo: true,
    };
  });
}
