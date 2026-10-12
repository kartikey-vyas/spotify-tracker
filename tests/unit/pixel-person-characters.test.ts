import { describe, expect, it } from 'vitest';
import {
  characterRegistry,
  frameOfSize,
  promenadePerson,
  tinyPerson,
  withPalette
} from '../../src/lib/pixel-person/characters';

describe('pixel person character registry', () => {
  it('routes the compatibility character through the high-density default', () => {
    expect(characterRegistry[tinyPerson.id]).toBe(tinyPerson);
    expect(tinyPerson).toBe(promenadePerson);
    expect(tinyPerson.pixelWidth).toBe(48);
    expect(tinyPerson.pixelHeight).toBe(64);
    expect(tinyPerson.scale).toBe(0.5);
    expect(tinyPerson.pixelWidth * tinyPerson.scale).toBe(24);
    expect(tinyPerson.pixelHeight * tinyPerson.scale).toBe(32);
    expect(tinyPerson.body.width).toBe(14);
    expect(tinyPerson.body.height).toBe(31);
  });

  it('every registered character is complete and consistently sized', () => {
    const characters = Object.values(characterRegistry);
    expect(characters.length).toBeGreaterThanOrEqual(2);
    for (const character of characters) {
      expect(characterRegistry[character.id]).toBe(character);
      expect(Object.keys(character.animations).sort()).toEqual([
        'climb',
        'crawl',
        'dangle',
        'fall',
        'hide',
        'idle',
        'jump',
        'listen',
        'lounge',
        'mantle',
        'reach',
        'walk'
      ]);
      for (const animation of Object.values(character.animations)) {
        for (const frame of animation.frames) {
          expect(frame.rows).toHaveLength(character.pixelHeight);
          expect(frame.rows.every((row) => row.length === character.pixelWidth)).toBe(true);
        }
      }
      // Every palette key used by any frame must resolve to a color.
      for (const animation of Object.values(character.animations)) {
        for (const frame of animation.frames) {
          for (const row of frame.rows) {
            for (const key of row) {
              if (key === '.') continue;
              expect(character.palette[key]).toBeTruthy();
            }
          }
        }
      }
    }
  });

  it('registers genuinely authored 48x64 promenade art at the established CSS footprint', () => {
    expect(characterRegistry[promenadePerson.id]).toBe(promenadePerson);
    expect(promenadePerson.pixelWidth).toBe(48);
    expect(promenadePerson.pixelHeight).toBe(64);
    expect(promenadePerson.scale).toBe(0.5);
    expect(promenadePerson.pixelWidth * promenadePerson.scale).toBe(24);
    expect(promenadePerson.pixelHeight * promenadePerson.scale).toBe(32);
    expect(promenadePerson.dragGrip.x * promenadePerson.scale).toBe(2);
    expect(promenadePerson.dragGrip.y * promenadePerson.scale).toBe(1);
    expect(promenadePerson.animations.walk.frames).toHaveLength(6);
    expect(promenadePerson.animations.listen.frames).toHaveLength(6);

    // A mechanically doubled 24x32 image has one value in every aligned 2x2
    // cell. Odd-width details in the new face and clothes must break that rule.
    const frame = promenadePerson.animations.idle.frames[0];
    const hasRawPixelDetail = frame.rows.some((row, y) => {
      if (y % 2 !== 0) return false;
      return [...row].some((_key, x) => {
        if (x % 2 !== 0) return false;
        return new Set([
          frame.rows[y][x],
          frame.rows[y][x + 1],
          frame.rows[y + 1][x],
          frame.rows[y + 1][x + 1]
        ]).size > 1;
      });
    });
    expect(hasRawPixelDetail).toBe(true);
  });

  it('validates frames against their explicitly requested dimensions', () => {
    expect(frameOfSize(3, 2, ['...', '...']).rows).toEqual(['...', '...']);
    expect(() => frameOfSize(3, 2, ['...'])).toThrow(/3x2/);
    expect(() => frameOfSize(3, 2, ['...', '..'])).toThrow(/3x2/);
  });

  it('withPalette derives recolored variants that share frames', () => {
    const variant = withPalette(tinyPerson, 'test-variant', { t: '#ff0000' });
    expect(variant.id).toBe('test-variant');
    expect(variant.palette.t).toBe('#ff0000');
    expect(variant.palette.h).toBe(tinyPerson.palette.h);
    expect(variant.animations).toBe(tinyPerson.animations);
    expect(tinyPerson.palette.t).not.toBe('#ff0000');
  });
});
