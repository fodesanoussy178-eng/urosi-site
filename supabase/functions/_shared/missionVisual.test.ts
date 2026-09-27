import { describe, expect, it } from 'vitest';
import { resolveMissionVisual, visualChain } from './missionVisual';

const PHOTO = 'https://cdn.example.org/photo.jpg';
const PARTNER = 'https://cdn.example.org/partner.jpg';
const ORG = 'https://cdn.example.org/org-logo.png';
const DOMAIN = 'https://cdn.example.org/domain.png';

describe('hiérarchie des visuels', () => {
  it('suit l’ordre photo native > image partenaire > logo organisation > logo domaine > illustration', () => {
    const all = {
      nativePhoto: { url: PHOTO, rightsStatus: 'authorized' as const },
      partnerMissionImage: { url: PARTNER, rightsStatus: 'source_provided' as const },
      organizationLogo: { url: ORG },
      domainLogo: { url: DOMAIN },
    };
    expect(visualChain(all).map((v) => v.level)).toEqual([
      'native_photo', 'partner_mission_image', 'organization_logo', 'domain_logo', 'urosi_illustration',
    ]);
    expect(resolveMissionVisual({ ...all, nativePhoto: null }).level).toBe('partner_mission_image');
    expect(resolveMissionVisual({ organizationLogo: { url: ORG }, domainLogo: { url: DOMAIN } }).level).toBe('organization_logo');
    expect(resolveMissionVisual({ domainLogo: { url: DOMAIN } }).level).toBe('domain_logo');
    expect(resolveMissionVisual({})).toEqual({ level: 'urosi_illustration', kind: 'illustration', url: null, rightsStatus: null });
  });

  it('présente un logo comme un logo, jamais comme une photo', () => {
    const v = resolveMissionVisual({ organizationLogo: { url: ORG } });
    expect(v.kind).toBe('logo');
    expect(resolveMissionVisual({ partnerMissionImage: { url: PARTNER, rightsStatus: 'licensed' } }).kind).toBe('photo');
  });

  it('ne publie jamais une image aux droits inconnus ou non renseignés', () => {
    expect(resolveMissionVisual({ partnerMissionImage: { url: PARTNER, rightsStatus: 'unknown' }, domainLogo: { url: DOMAIN } }).level).toBe('domain_logo');
    expect(resolveMissionVisual({ partnerMissionImage: { url: PARTNER } }).level).toBe('urosi_illustration');
  });

  it('ignore les adresses non https', () => {
    expect(resolveMissionVisual({ organizationLogo: { url: 'http://insecure.example.org/logo.png' } }).level).toBe('urosi_illustration');
    expect(resolveMissionVisual({ organizationLogo: { url: 'pas une url' } }).level).toBe('urosi_illustration');
  });
});
