import { describe, expect, it } from 'vitest';
import { characterRegistry, tinyPerson } from '../../src/lib/pixel-person/characters';
import { normalizeArtistName } from '../../src/lib/pixel-person/artist-name';
import {
  artistCharacterFor,
  artistRegistry,
  hasMatchedArtist,
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

describe('artistRegistry', () => {
  it('declares every artistKey already normalized, and resolvable back to its character', () => {
    // isOwnArtistSource compares a normalized source name against
    // `definition.artistKey`, so an un-normalized artistKey (e.g. 'Sigur Rós'
    // instead of 'sigur ros') would spawn and walk correctly but silently
    // never match its own records — no type error, no failing test, just a
    // character that never seeks its own covers. This asserts the convention
    // every future artist entry must follow, and round-trips the key through
    // the real lookup rather than re-deriving it.
    expect(artistRegistry.length).toBeGreaterThan(0);
    for (const entry of artistRegistry) {
      const key = entry.character.artistKey;
      expect(key).toBeTruthy();
      if (!key) continue;
      expect(key).toBe(normalizeArtistName(key));
      expect(artistCharacterFor(key)).toBe(entry.character);
    }
  });

  it('normalizes match names once at registration', () => {
    // artistEntry() normalizes on the way in so artistCharacterFor can compare
    // directly instead of re-normalizing static strings on every lookup.
    for (const entry of artistRegistry) {
      for (const name of entry.match) {
        expect(name).toBe(normalizeArtistName(name));
      }
    }
  });
});

describe('Frank Ocean', () => {
  it('is registered under his name, case and spacing insensitively', () => {
    expect(artistCharacterFor('Frank Ocean')?.id).toBe('artist-frank-ocean');
    expect(artistCharacterFor('  frank   ocean ')?.id).toBe('artist-frank-ocean');
  });

  it('is not in the generic registry, so he never spawns unprompted', () => {
    expect(characterRegistry['artist-frank-ocean']).toBeUndefined();
  });

  it('resolves by character id for the spawn command path', () => {
    expect(resolveCharacter('artist-frank-ocean')?.id).toBe('artist-frank-ocean');
  });

  it('carries a normalised artist key for record affinity', () => {
    expect(artistCharacterFor('Frank Ocean')?.artistKey).toBe('frank ocean');
  });

  it('keeps the base rig dimensions', () => {
    const frank = artistCharacterFor('Frank Ocean');
    expect(frank?.pixelWidth).toBe(24);
    expect(frank?.pixelHeight).toBe(32);
    expect(frank?.scale).toBe(1);
  });

  it('has every frame at the declared dimensions with a resolvable palette', () => {
    const frank = artistCharacterFor('Frank Ocean');
    expect(frank).toBeTruthy();
    if (!frank) return;
    for (const animation of Object.values(frank.animations)) {
      for (const frame of animation.frames) {
        expect(frame.rows).toHaveLength(frank.pixelHeight);
        expect(frame.rows.every((row) => row.length === frank.pixelWidth)).toBe(true);
        for (const row of frame.rows) {
          for (const key of row) {
            if (key === '.') continue;
            expect(frank.palette[key]).toBeTruthy();
          }
        }
      }
    }
  });

  /**
   * Where Frank's slice of the roll space starts. Generics weigh 1 each and go
   * into the pool first; he is appended weighing `8 / (rank + 1)`. Derived from
   * the registry rather than hardcoded, so adding or dropping a generic
   * character does not turn these into false failures — the rule is what is
   * under test, not today's population count.
   */
  function frankBoundary(rank: number): number {
    const generics = Object.keys(characterRegistry).length;
    return generics / (generics + 8 / (rank + 1));
  }

  it('outranks the generics when he is the top artist', () => {
    const boundary = frankBoundary(1);
    // Asserted both sides of the boundary, so a different numerator or divisor
    // moves it and fails: weight 8 and weight 1 both land elsewhere.
    expect(pickCharacter([presence('Frank Ocean', 1)], () => 0.999).id).toBe('artist-frank-ocean');
    expect(pickCharacter([presence('Frank Ocean', 1)], () => boundary + 0.01).id).toBe(
      'artist-frank-ocean'
    );
    expect(pickCharacter([presence('Frank Ocean', 1)], () => boundary - 0.01).id).not.toBe(
      'artist-frank-ocean'
    );
    // A top artist is more likely than not: his slice is the larger half.
    expect(boundary).toBeLessThan(0.5);
  });

  it('is far less likely at rank 8 than at rank 1', () => {
    const rankOne = frankBoundary(1);
    const rankEight = frankBoundary(8);
    // The whole point of the curve: a #8 artist has to clear a far higher roll.
    expect(rankEight).toBeGreaterThan(rankOne);

    expect(pickCharacter([presence('Frank Ocean', 1)], () => rankOne + 0.01).id).toBe(
      'artist-frank-ocean'
    );
    expect(pickCharacter([presence('Frank Ocean', 8)], () => rankOne + 0.01).id).not.toBe(
      'artist-frank-ocean'
    );
    expect(pickCharacter([presence('Frank Ocean', 8)], () => rankEight - 0.01).id).not.toBe(
      'artist-frank-ocean'
    );
    expect(pickCharacter([presence('Frank Ocean', 8)], () => rankEight + 0.01).id).toBe(
      'artist-frank-ocean'
    );
  });

  it('counts once at his best rank when present twice', () => {
    const twice = [presence('Frank Ocean', 5), presence('Frank Ocean', 1)];
    const once = [presence('Frank Ocean', 1)];
    const boundary = frankBoundary(1);

    // Deduped at rank 1 -> identical to the single rank-1 case on both sides.
    expect(pickCharacter(twice, () => boundary + 0.01).id).toBe('artist-frank-ocean');
    expect(pickCharacter(twice, () => boundary - 0.01).id).not.toBe('artist-frank-ocean');
    // Sweeping the whole space pins both halves of the rule: counting him twice
    // would widen his slice, and keeping the worse rank would narrow it.
    for (const roll of [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.999]) {
      expect(pickCharacter(twice, () => roll).id).toBe(pickCharacter(once, () => roll).id);
    }
    // Had dedup kept the worse rank, his slice would start at frankBoundary(5)
    // instead; a roll just under that still picks him only because rank 1 won.
    expect(frankBoundary(5)).toBeGreaterThan(boundary);
    expect(pickCharacter(twice, () => frankBoundary(5) - 0.01).id).toBe('artist-frank-ocean');
  });
});

describe('hasMatchedArtist', () => {
  it('is false for an empty presence list', () => {
    expect(hasMatchedArtist([])).toBe(false);
  });

  it('is false when no presence maps to a registered artist', () => {
    expect(hasMatchedArtist([presence('Nobody At All', 1)])).toBe(false);
  });

  it('is true when any presence maps to a registered artist', () => {
    expect(hasMatchedArtist([presence('Nobody At All', 1), presence('Frank Ocean', 4)])).toBe(true);
  });

  it('matches case- and spacing-insensitively, like artistCharacterFor', () => {
    expect(hasMatchedArtist([presence('  FRANK  OCEAN ', 2)])).toBe(true);
  });
});
