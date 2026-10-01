// Hiérarchie des visuels appliquée à une mission affichée. La règle est
// partagée avec l'agent de découverte (supabase/functions/_shared/missionVisual.ts).
import { visualChain, type ResolvedVisual } from '../../../supabase/functions/_shared/missionVisual';
import type { FeedMission } from './solidarityMissions';

export type { ResolvedVisual };

export type VisualSource = Pick<FeedMission, 'imageUrl' | 'imageLevel' | 'organization' | 'domainLogoUrl'>;

// Les droits de la photo ont été vérifiés en amont (base de données et
// agent) : seule une photo publiable arrive jusqu'ici.
export function visualChainFor(m: VisualSource): ResolvedVisual[] {
  const photo = m.imageUrl ? { url: m.imageUrl, rightsStatus: 'authorized' as const } : null;
  return visualChain({
    nativePhoto: m.imageLevel === 'native_photo' ? photo : null,
    partnerMissionImage: m.imageLevel === 'partner_mission_image' ? photo : null,
    authorizedImage: m.imageLevel === 'authorized_image' ? photo : null,
    organizationLogo: { url: m.organization.logoUrl },
    domainLogo: { url: m.domainLogoUrl },
  });
}
