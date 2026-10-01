import { describe, expect, it } from 'vitest';
import { isSafePath } from './authRedirect';

describe('redirection après connexion', () => {
  it('n’accepte que des chemins internes', () => {
    expect(isSafePath('/missions')).toBe(true);
    expect(isSafePath('/missions/external%3Ae1?x=1')).toBe(true);
    expect(isSafePath('/fondateur')).toBe(true);
  });

  it('refuse toute redirection externe, y compris par barre oblique inversée', () => {
    for (const bad of ['//evil.example', '/\\evil.example', '/\\\\evil.example', '\\\\evil.example', 'https://evil.example', '/a\\b', '/\tevil', '', null, undefined]) {
      expect(isSafePath(bad as string | null)).toBe(false);
    }
  });
});
