// Hiérarchie unique des visuels d'une mission, partagée par l'agent de
// découverte (Deno) et l'interface (Vite). Module pur.
//
//   1. native_photo           photo fournie par la structure UROSI ;
//   2. partner_mission_image  photo de mission fournie par la source
//      authorized_image       partenaire, ou trouvée sur une source dont
//                             l'usage est autorisé — droits connus ;
//   3. organization_logo      logo de l'organisation (organizationLogo) ;
//   4. domain_logo            logo du domaine d'action (domainLogo) ;
//   5. urosi_illustration     illustration UROSI de la catégorie.
//
// Un logo n'est JAMAIS présenté comme une photo de mission : `kind` indique
// à l'interface s'il faut l'afficher en couverture ('photo') ou en médaillon
// sur l'illustration de catégorie ('logo').
// Une image aux droits inconnus n'est jamais retenue.

export type RightsStatus = 'source_provided' | 'licensed' | 'authorized' | 'unknown';

export type VisualLevel =
  | 'native_photo'
  | 'partner_mission_image'
  | 'authorized_image'
  | 'organization_logo'
  | 'domain_logo'
  | 'urosi_illustration';

export interface VisualCandidate {
  url: string | null | undefined;
  rightsStatus?: RightsStatus | null;
}

export interface VisualInput {
  nativePhoto?: VisualCandidate | null;
  partnerMissionImage?: VisualCandidate | null;
  authorizedImage?: VisualCandidate | null;
  organizationLogo?: VisualCandidate | null;
  domainLogo?: VisualCandidate | null;
}

export interface ResolvedVisual {
  level: VisualLevel;
  kind: 'photo' | 'logo' | 'illustration';
  url: string | null;
  rightsStatus: RightsStatus | null;
}

const ORDER: Array<[keyof VisualInput, VisualLevel, ResolvedVisual['kind']]> = [
  ['nativePhoto', 'native_photo', 'photo'],
  ['partnerMissionImage', 'partner_mission_image', 'photo'],
  ['authorizedImage', 'authorized_image', 'photo'],
  ['organizationLogo', 'organization_logo', 'logo'],
  ['domainLogo', 'domain_logo', 'logo'],
];

export function isPublishableRights(status: RightsStatus | null | undefined): boolean {
  return status === 'source_provided' || status === 'licensed' || status === 'authorized';
}

export function isHttpsUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

// Tous les niveaux utilisables, dans l'ordre : l'interface passe au suivant
// si une image ne se charge pas.
export function visualChain(input: VisualInput): ResolvedVisual[] {
  const chain: ResolvedVisual[] = [];
  for (const [field, level, kind] of ORDER) {
    const candidate = input[field];
    if (!candidate || !isHttpsUrl(candidate.url)) continue;
    // Les logos d'une source autorisée sont « fournis par la source » par défaut.
    const rights = candidate.rightsStatus ?? (kind === 'logo' ? 'source_provided' : null);
    if (!isPublishableRights(rights)) continue;
    chain.push({ level, kind, url: candidate.url, rightsStatus: rights });
  }
  chain.push({ level: 'urosi_illustration', kind: 'illustration', url: null, rightsStatus: null });
  return chain;
}

export function resolveMissionVisual(input: VisualInput): ResolvedVisual {
  return visualChain(input)[0]!;
}
