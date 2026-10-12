import { describe, expect, it } from 'vitest';
import { characterRegistry, tinyPerson, withPalette } from '../../src/lib/pixel-person/characters';
import { normalizeArtistName } from '../../src/lib/pixel-person/artist-name';
import {
  artistCharacterFor,
  artistRegistry,
  defaultResident,
  hasMatchedArtist,
  pickCharacter,
  resolveCharacter
} from '../../src/lib/pixel-person/artists';
import type { ArtistPresence } from '../../src/lib/pixel-person/types';

function presence(name: string, rank?: number): ArtistPresence {
  return { name, rank };
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

  it('is not in the generic registry: he is an artist who is also the default resident', () => {
    expect(characterRegistry['artist-frank-ocean']).toBeUndefined();
  });

  it('resolves by character id for the spawn command path', () => {
    expect(resolveCharacter('artist-frank-ocean')?.id).toBe('artist-frank-ocean');
  });

  it('carries a normalised artist key for record affinity', () => {
    expect(artistCharacterFor('Frank Ocean')?.artistKey).toBe('frank ocean');
  });

  it('uses a high-density source at the established CSS footprint', () => {
    const frank = artistCharacterFor('Frank Ocean');
    expect(frank?.pixelWidth).toBe(48);
    expect(frank?.pixelHeight).toBe(64);
    expect(frank?.scale).toBe(0.5);
    expect((frank?.pixelWidth ?? 0) * (frank?.scale ?? 0)).toBe(24);
    expect((frank?.pixelHeight ?? 0) * (frank?.scale ?? 0)).toBe(32);
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
});

describe('pickCharacter', () => {
  it('is Frank Ocean by default', () => {
    expect(defaultResident.id).toBe('artist-frank-ocean');
    for (const roll of [0, 0.25, 0.5, 0.75, 0.999]) {
      expect(pickCharacter([], () => roll)).toBe(defaultResident);
    }
  });

  it('never picks a generic character', () => {
    const generics = new Set(Object.keys(characterRegistry));
    for (const roll of [0, 0.1, 0.33, 0.5, 0.7, 0.9, 0.9999]) {
      expect(generics.has(pickCharacter([presence('Nobody At All', 1)], () => roll).id)).toBe(false);
    }
  });

  it('stays the default resident when that is the only artist on the page', () => {
    for (const roll of [0, 0.5, 0.999]) {
      expect(pickCharacter([presence('Frank Ocean', 1)], () => roll)).toBe(defaultResident);
    }
  });

  describe('with a second artist in the library', () => {
    // A throwaway artist, so the rank rule is tested against the default
    // resident without depending on who else happens to be registered.
    const guest = withPalette(tinyPerson, 'artist-test-guest', { t: '#123456' });
    const entry = { match: ['test guest'], character: { ...guest, artistKey: 'test guest' } };

    /** Where the guest's slice starts: after the default resident's weight of 1. */
    function guestBoundary(rank: number): number {
      return 1 / (1 + 8 / (rank + 1));
    }

    function withGuest(check: () => void): void {
      artistRegistry.push(entry);
      try {
        check();
      } finally {
        artistRegistry.splice(artistRegistry.indexOf(entry), 1);
      }
    }

    it('outweighs the default resident as the top artist', () => {
      withGuest(() => {
        const boundary = guestBoundary(1);
        expect(boundary).toBeLessThan(0.5);
        expect(pickCharacter([presence('Test Guest', 1)], () => boundary + 0.01)).toBe(entry.character);
        expect(pickCharacter([presence('Test Guest', 1)], () => boundary - 0.01)).toBe(defaultResident);
      });
    });

    it('is far less likely at rank 8 than at rank 1', () => {
      withGuest(() => {
        const rankOne = guestBoundary(1);
        const rankEight = guestBoundary(8);
        expect(rankEight).toBeGreaterThan(rankOne);
        expect(pickCharacter([presence('Test Guest', 8)], () => rankOne + 0.01)).toBe(defaultResident);
        expect(pickCharacter([presence('Test Guest', 8)], () => rankEight + 0.01)).toBe(entry.character);
      });
    });

    it('counts once at the best rank when present twice', () => {
      withGuest(() => {
        const twice = [presence('Test Guest', 5), presence('Test Guest', 1)];
        const once = [presence('Test Guest', 1)];
        for (const roll of [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.999]) {
          expect(pickCharacter(twice, () => roll)).toBe(pickCharacter(once, () => roll));
        }
      });
    });
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
