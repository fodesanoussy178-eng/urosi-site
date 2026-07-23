import { describe, expect, it } from 'vitest';
import { extractScanToken } from './StructureQrScanSheet';

const token = 'a'.repeat(64);

describe('extractScanToken', () => {
  it('extrait le jeton depuis une URL de scan complete', () => {
    expect(extractScanToken(`https://urosi.fr/scan/${token}`)).toBe(token);
  });

  it('ignore le protocole et le domaine (www, preview Vercel...)', () => {
    expect(extractScanToken(`https://www.urosi.fr/scan/${token}`)).toBe(token);
    expect(extractScanToken(`http://localhost:5183/scan/${token}`)).toBe(token);
  });

  it('accepte un jeton hexadecimal nu (ex. colle depuis un autre canal)', () => {
    expect(extractScanToken(token)).toBe(token);
  });

  it("rejette un contenu de QR qui n'est ni une URL de scan ni un jeton hexadecimal", () => {
    expect(extractScanToken('https://example.com/phishing')).toBeNull();
    expect(extractScanToken('n’importe quoi scanne par erreur')).toBeNull();
    expect(extractScanToken('')).toBeNull();
    expect(extractScanToken('short')).toBeNull();
  });

  it('ignore les query params et fragments apres le jeton', () => {
    expect(extractScanToken(`https://urosi.fr/scan/${token}?ref=qr#x`)).toBe(token);
  });
});
