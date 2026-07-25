import { describe, expect, it } from 'vitest';
import { characterRegistry, tinyPerson } from '../../src/lib/pixel-person/characters';
import {
  artistCharacterFor,
  normalizeArtistName,
  pickCharacter,
  resolveCharacter
} from '../../src/lib/pixel-person/artists';
import type { ArtistPresence } from '../../src/lib/pixel-person/types';

function presence(name: string, rank?: number): ArtistPresence {
  return { x: 0, y: 0, width: 10, height: 10, id: `p-${name}-${rank ?? 'x'}`, name, rank };
}

describe('normalizeArtistName', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normalizeArtistName('  Frank   OCEAN ')).toBe('frank ocean');
  });

  it('strips diacritics', () => {
    expect(normalizeArtistName('Sigur Rós')).toBe('sigur ros');
  });

  it('strips punctuation', () => {
    expect(normalizeArtistName('Tyler, The Creator')).toBe('tyler the creator');
  });

  it('is idempotent', () => {
    const once = normalizeArtistName('Frank Ocean');
    expect(normalizeArtistName(once)).toBe(once);
  });
});

describe('artistCharacterFor', () => {
  it('returns null for an unregistered artist', () => {
    expect(artistCharacterFor('Nobody At All')).toBeNull();
  });
});

describe('resolveCharacter', () => {
  it('falls back to the base character for an unknown id', () => {
    expect(resolveCharacter('does-not-exist')).toBe(tinyPerson);
  });

  it('resolves generic characters by id', () => {
    expect(resolveCharacter(tinyPerson.id)).toBe(tinyPerson);
  });
});

describe('pickCharacter', () => {
  it('returns only generic characters when no artists are present', () => {
    const generics = new Set(Object.keys(characterRegistry));
    for (const roll of [0, 0.25, 0.5, 0.75, 0.999]) {
      expect(generics.has(pickCharacter([], () => roll).id)).toBe(true);
    }
  });

  it('still returns a generic when present artists are unregistered', () => {
    const generics = new Set(Object.keys(characterRegistry));
    const picked = pickCharacter([presence('Nobody At All', 1)], () => 0.5);
    expect(generics.has(picked.id)).toBe(true);
  });

  it('always returns a character for any roll in range', () => {
    for (const roll of [0, 0.1, 0.33, 0.5, 0.7, 0.9, 0.9999]) {
      expect(pickCharacter([], () => roll)).toBeTruthy();
    }
  });
});
