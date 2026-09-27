import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MissionCard } from './MissionCard';

describe('carte mission', () => {
  it('montre uniquement photo, titre, structure, distance, date et durée', () => {
    const { container } = render(
      <MissionCard
        distance={0.8}
        onOpen={vi.fn()}
        mission={{
          key: 'external:1', id: '1', kind: 'external_solidarity_mission', source: 'api_engagement', title: 'Distribution alimentaire', description: 'x',
          organization: { id: null, name: 'Banque Alimentaire', logoUrl: null, verified: false }, imageUrl: null, imageLevel: null, domainLogoUrl: null,
          category: 'aide_alimentaire', city: 'Lille', address: null, coords: null, date: null, startTime: null, endTime: null, scheduleText: null,
          durationMinutes: 180, places: 8, applicationUrl: 'https://example.org', partnerName: 'JeVeuxAider.gouv.fr', impressionUrl: null, isShort: true,
        }}
      />,
    );
    expect(screen.getByText('Distribution alimentaire')).toBeInTheDocument();
    expect(screen.getByText('Banque Alimentaire')).toBeInTheDocument();
    expect(screen.getByText('📍 800 m')).toBeInTheDocument();
    expect(screen.getByText('3 h')).toBeInTheDocument();
    expect(container.querySelector('.m-art')).not.toBeNull();
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/Solidaire|Mission courte|JeVeuxAider|API|places|favori/i);
  });
});
