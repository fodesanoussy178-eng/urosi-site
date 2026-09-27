import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MissionArt } from './MissionArt';

const base = {
  key: 'external:1',
  title: 'Distribution de colis',
  category: 'aide_alimentaire' as const,
  imageUrl: null,
  imageLevel: null,
  domainLogoUrl: null,
  organization: { id: null, name: 'Banque Alimentaire', logoUrl: null, verified: false },
};

function level(container: HTMLElement) {
  return container.querySelector('.m-art')?.getAttribute('data-visual');
}

describe('visuel de mission', () => {
  it('affiche la photo native en couverture', () => {
    const { container } = render(<MissionArt mission={{ ...base, imageUrl: 'https://cdn.example.org/p.jpg', imageLevel: 'native_photo' }} />);
    expect(level(container)).toBe('native_photo');
    expect(container.querySelector('img.m-photo')).not.toBeNull();
  });

  it('affiche le logo de l’organisation en médaillon, jamais comme une photo', () => {
    const { container } = render(<MissionArt mission={{ ...base, organization: { ...base.organization, logoUrl: 'https://cdn.example.org/logo.png' }, domainLogoUrl: 'https://cdn.example.org/d.png' }} />);
    expect(level(container)).toBe('organization_logo');
    expect(container.querySelector('.m-logo-tile img')).not.toBeNull();
    expect(container.querySelector('img.m-photo')).toBeNull();
    expect(container.querySelector('.m-scene')).not.toBeNull();
  });

  it('passe au niveau suivant si une image ne se charge pas, jusqu’à l’illustration UROSI', () => {
    const { container } = render(
      <MissionArt mission={{ ...base, imageUrl: 'https://cdn.example.org/cassee.jpg', imageLevel: 'partner_mission_image', domainLogoUrl: 'https://cdn.example.org/d.png' }} />,
    );
    expect(level(container)).toBe('partner_mission_image');
    fireEvent.error(container.querySelector('img')!);
    expect(level(container)).toBe('domain_logo');
    fireEvent.error(container.querySelector('img')!);
    expect(level(container)).toBe('urosi_illustration');
    expect(container.querySelector('.m-scene svg')).not.toBeNull();
  });

  it('sans aucune image : illustration de la catégorie, jamais de zone vide', () => {
    const { container } = render(<MissionArt mission={base} />);
    expect(level(container)).toBe('urosi_illustration');
    expect(container.querySelector('.m-scene svg')).not.toBeNull();
  });
});
