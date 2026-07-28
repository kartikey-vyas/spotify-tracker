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

  it('outranks the generics when he is the top artist', () => {
    // Rank 1 weights 8 / (1 + 1) = 4.0 against 4 generics at 1.0 each: he owns
    // exactly the top 50% of the roll space, which is appended after the
    // generics. The boundary is asserted both sides so a different numerator
    // or divisor (weight 8 -> boundary 0.33; weight 1 -> boundary 0.8) fails.
    expect(pickCharacter([presence('Frank Ocean', 1)], () => 0.99).id).toBe('artist-frank-ocean');
    expect(pickCharacter([presence('Frank Ocean', 1)], () => 0.5).id).toBe('artist-frank-ocean');
    expect(pickCharacter([presence('Frank Ocean', 1)], () => 0.49).id).not.toBe(
      'artist-frank-ocean'
    );
  });

  it('is far less likely at rank 8 than at rank 1', () => {
    const atRankOne = pickCharacter([presence('Frank Ocean', 1)], () => 0.6);
    const atRankEight = pickCharacter([presence('Frank Ocean', 8)], () => 0.6);
    expect(atRankOne.id).toBe('artist-frank-ocean');
    expect(atRankEight.id).not.toBe('artist-frank-ocean');
    // Rank 8 weights 8 / 9 against 4.0 generic weight, so his slice is the top
    // ~18% rather than the top 50%: the boundary sits between 0.8 and 0.9.
    expect(pickCharacter([presence('Frank Ocean', 8)], () => 0.8).id).not.toBe(
      'artist-frank-ocean'
    );
    expect(pickCharacter([presence('Frank Ocean', 8)], () => 0.9).id).toBe('artist-frank-ocean');
  });

  it('counts once at his best rank when present twice', () => {
    const twice = [presence('Frank Ocean', 5), presence('Frank Ocean', 1)];
    const once = [presence('Frank Ocean', 1)];
    // Deduped at rank 1 -> weight 4.0, same as the single rank-1 case.
    expect(pickCharacter(twice, () => 0.99).id).toBe('artist-frank-ocean');
    expect(pickCharacter(twice, () => 0.4).id).not.toBe('artist-frank-ocean');
    // Sweeping the whole roll space pins both halves of the rule: counting him
    // twice moves his boundary to ~0.43 (0.45 would wrongly pick him) and
    // keeping the worse rank moves it to 0.75 (0.6 would wrongly miss him).
    for (const roll of [0, 0.2, 0.4, 0.45, 0.49, 0.5, 0.6, 0.75, 0.8, 0.9, 0.999]) {
      expect(pickCharacter(twice, () => roll).id).toBe(pickCharacter(once, () => roll).id);
    }
    expect(pickCharacter(twice, () => 0.45).id).not.toBe('artist-frank-ocean');
    expect(pickCharacter(twice, () => 0.6).id).toBe('artist-frank-ocean');
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
