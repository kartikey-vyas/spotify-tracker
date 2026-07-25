import { describe, expect, it, vi } from 'vitest';
import { characterRegistry, tinyPerson } from '../../src/lib/pixel-person/characters';
import { SpatialHash } from '../../src/lib/pixel-person/physics';
import { selectSpriteFrame } from '../../src/lib/pixel-person/sprite';
import {
  createPixelPerson,
  stepPixelPerson
} from '../../src/lib/pixel-person/simulation';
import {
  artistCharacterFor,
  artistCharacters,
  hasMatchedArtist,
  normalizeArtistName,
  pickCharacter,
  resolveCharacter
} from '../../src/lib/pixel-person/artists';
import type {
  ArtistPresence,
  PhysicsBody,
  WorldGeometry
} from '../../src/lib/pixel-person/types';

function presence(name: string, rank?: number): ArtistPresence {
  return { x: 0, y: 0, width: 10, height: 10, id: `p-${name}-${rank ?? 'x'}`, name, rank };
}

function groundedBody(): PhysicsBody {
  // Feet at y=60 (29 + body height 31), matching the floor collider's top.
  return { x: 10, y: 29, width: 14, height: 31, vx: 0, vy: 0, grounded: true, supportId: 'floor' };
}

function flatWorld(): WorldGeometry {
  return {
    colliders: [
      { id: 'floor', kind: 'border', edge: 'top', x: 0, y: 60, width: 400, height: 2 }
    ],
    occluders: [],
    itemSources: [],
    artistPresences: [],
    scanBounds: { x: 0, y: 0, width: 2000, height: 1000 },
    viewportBounds: { x: 0, y: 0, width: 2000, height: 1000 }
  };
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

describe('artistCharacters', () => {
  it('keys every entry by the definition its own id', () => {
    // pickCharacter re-looks-up artistCharacters[character.id]; a key/id
    // mismatch would silently drop the character from the pool, with no
    // type error to catch it.
    for (const [key, character] of Object.entries(artistCharacters)) {
      expect(character.id).toBe(key);
    }
    expect(Object.keys(artistCharacters).length).toBeGreaterThan(0);
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

  it('defines a signature pose', () => {
    expect(artistCharacterFor('Frank Ocean')?.animations.signature).toBeTruthy();
  });

  it('keeps the base rig dimensions', () => {
    const frank = artistCharacterFor('Frank Ocean');
    expect(frank?.pixelWidth).toBe(16);
    expect(frank?.pixelHeight).toBe(22);
    expect(frank?.scale).toBe(1.5);
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

describe('the latched signature idle pose', () => {
  it('falls back to idle when a character has no signature animation', () => {
    // Generics have no signature; selectSpriteFrame must not dereference undefined.
    expect(tinyPerson.animations.signature).toBeUndefined();
    const selected = selectSpriteFrame(tinyPerson, 'signature', 0, 0);
    expect(selected.frame).toBe(tinyPerson.animations.idle.frames[0]);
  });

  it('survives the locomotion pass, which forces idle on every grounded step', () => {
    const frank = artistCharacterFor('Frank Ocean');
    expect(frank).toBeTruthy();
    if (!frank) return;
    const world = flatWorld();
    const hash = new SpatialHash(world.colliders);
    const person = createPixelPerson(frank, groundedBody(), 0);
    person.activity = 'idle';
    // Far enough out that the step never rerolls the activity mid-test.
    person.activityUntil = 900_000;
    person.idlePose = 'signature';
    person.animation = 'signature';

    for (let now = 100; now <= 1_000; now += 100) {
      stepPixelPerson(person, world, hash, [], 0.05, now);
      expect(person.animation).toBe('signature');
    }
  });

  it('does not reappear while the person is in a non-idle activity', () => {
    const frank = artistCharacterFor('Frank Ocean');
    if (!frank) return;
    // 0.9 keeps chooseNextActivity out of its `Math.random() < 0.3` idle
    // branch, so the activity stays 'wander' and the assertion is not a
    // coin flip on whether a fresh pose got latched.
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.9);
    try {
      const world = flatWorld();
      const hash = new SpatialHash(world.colliders);
      const person = createPixelPerson(frank, groundedBody(), 0);
      // Several exits (listen, stoop, hide, climb) leave the activity set to
      // something other than 'idle' and call setAnimation(person, 'idle');
      // the activity gate is what stops a stale latch resurfacing there.
      person.idlePose = 'signature';
      person.animation = 'signature';
      person.activity = 'wander';
      person.activityUntil = 900_000;
      person.goalX = 300;

      // Tiny steps keep |vx| under the walk threshold, so the locomotion pass
      // takes its "grounded and slow" branch while the activity is 'wander' —
      // exactly where an ungated latch would put the pose back on screen.
      for (let now = 5; now <= 20; now += 5) {
        person.body.vx = 0;
        stepPixelPerson(person, world, hash, [], 0.005, now);
        expect(Math.abs(person.body.vx)).toBeLessThanOrEqual(3);
        expect(person.activity).toBe('wander');
        expect(person.animation).toBe('idle');
      }
    } finally {
      random.mockRestore();
    }
  });

  it('never latches a signature onto a character that has none', () => {
    const world = flatWorld();
    const hash = new SpatialHash(world.colliders);
    const person = createPixelPerson(tinyPerson, groundedBody(), 0);
    expect(person.idlePose).toBe('idle');
    for (let now = 100; now <= 40_000; now += 100) {
      stepPixelPerson(person, world, hash, [], 0.05, now);
      expect(person.animation).not.toBe('signature');
      expect(person.idlePose).toBe('idle');
    }
  });
});
