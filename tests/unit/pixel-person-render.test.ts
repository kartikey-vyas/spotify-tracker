import { describe, expect, it } from 'vitest';
import { tinyPerson } from '../../src/lib/pixel-person/characters';
import { layoutRoom, LOUNGE, SHELF } from '../../src/lib/pixel-person/room';
import { createPixelPerson } from '../../src/lib/pixel-person/simulation';
import {
  carriedRecordPlacement,
  deviceStep,
  LAMP_GLOW,
  lampGlow,
  luminance,
  spriteCacheKey,
  withAlpha
} from '../../src/lib/pixel-person/render';

describe('deviceStep', () => {
  it('keeps integer scales exact on a retina display', () => {
    expect(deviceStep(2, 2)).toBe(4);
    expect(deviceStep(2, 1)).toBe(2);
  });

  it('makes a fractional scale integral against a retina dpr', () => {
    // 1.5 * 2 = 3 device pixels per sprite pixel — exactly crisp.
    expect(deviceStep(1.5, 2)).toBe(3);
  });

  it('rounds to the nearest whole device pixel when the product is fractional', () => {
    // dpr 1 cannot represent 1.5 device pixels; round rather than blur.
    expect(deviceStep(1.5, 1)).toBe(2);
  });

  it('never returns a step below one pixel', () => {
    expect(deviceStep(0.25, 1)).toBe(1);
    expect(deviceStep(1.5, 0)).toBe(1);
  });
});

describe('spriteCacheKey', () => {
  it('varies with the device step so zoom cannot serve a stale bitmap', () => {
    expect(spriteCacheKey('tiny-person:idle:0', '#111', 3)).not.toBe(
      spriteCacheKey('tiny-person:idle:0', '#111', 4)
    );
  });

  it('varies with the theme outline', () => {
    expect(spriteCacheKey('tiny-person:idle:0', '#111', 3)).not.toBe(
      spriteCacheKey('tiny-person:idle:0', '#f4f4f4', 3)
    );
  });

  it('is stable for identical inputs', () => {
    expect(spriteCacheKey('tiny-person:idle:0', '#111', 3)).toBe(
      spriteCacheKey('tiny-person:idle:0', '#111', 3)
    );
  });
});

describe('lamp glow', () => {
  it('fades in after switching on and out after switching off', () => {
    const on = { on: true, changedAt: 1_000 };
    expect(lampGlow(on, 1_000)).toBe(0);
    expect(lampGlow(on, 1_000 + LAMP_GLOW.fadeMs / 2)).toBeCloseTo(0.5);
    expect(lampGlow(on, 1_000 + LAMP_GLOW.fadeMs)).toBe(1);
    const off = { on: false, changedAt: 1_000 };
    expect(lampGlow(off, 1_000)).toBe(1);
    expect(lampGlow(off, 1_000 + LAMP_GLOW.fadeMs)).toBe(0);
  });

  it('starts settled when the lamp has never been touched', () => {
    expect(lampGlow({ on: true, changedAt: Number.NEGATIVE_INFINITY }, 0)).toBe(1);
    expect(lampGlow({ on: false, changedAt: Number.NEGATIVE_INFINITY }, 0)).toBe(0);
  });

  it('adds alpha to hex and rgb colours alike', () => {
    expect(withAlpha('#dfb36c', 0.5)).toBe('rgba(223, 179, 108, 0.5)');
    expect(withAlpha('#abc', 1)).toBe('rgba(170, 187, 204, 1)');
    expect(withAlpha('rgb(1, 2, 3)', 0.25)).toBe('rgba(1, 2, 3, 0.25)');
    expect(withAlpha('#000000', 2)).toBe('rgba(0, 0, 0, 1)');
  });
});

describe('lamplight', () => {
  it('is a warm yellow in both registers, whatever the theme accent', () => {
    for (const register of [LAMP_GLOW.dark, LAMP_GLOW.light]) {
      for (const colour of [register.shade, register.glow]) {
        const [red, green, blue] = withAlpha(colour, 1).match(/\d+/g)!.map(Number);
        // Warm: red leads, then green, blue well behind.
        expect(red).toBeGreaterThanOrEqual(green);
        expect(green).toBeGreaterThan(blue + 60);
      }
    }
  });

  it('tells light page grounds from dark ones', () => {
    expect(luminance('#eee4d3')).toBeGreaterThan(0.5);
    expect(luminance('#fdeef3')).toBeGreaterThan(0.5);
    expect(luminance('#17120f')).toBeLessThan(0.5);
    expect(luminance('rgb(31, 31, 40)')).toBeLessThan(0.5);
  });
});

describe('where a carried record is drawn', () => {
  const room = layoutRoom(1000, 83, 'right');
  const record = { imageUrl: 'https://covers/1' };

  function holder(facing: 1 | -1 = 1) {
    const person = createPixelPerson(tinyPerson, 500, room, 0, 'p1');
    person.carrying = { record, source: 'shelf', takenAt: 0, stowingAt: null };
    person.facing = facing;
    return person;
  }

  it('rests on the cushion the moment they sit, before the listen starts', () => {
    const person = holder();
    person.seated = { seat: 0 };
    person.animation = 'lounge';
    const placed = carriedRecordPlacement(person, room, 0);
    expect(placed.y + SHELF.recordSize).toBe(room.floorY - LOUNGE.cushionHeight);
    expect(placed.behind).toBe(true);
  });

  it('is in hand, in front, while standing', () => {
    const person = holder();
    const placed = carriedRecordPlacement(person, room, 0);
    expect(placed.behind).toBe(false);
    expect(placed.y + SHELF.recordSize).toBeLessThan(room.floorY);
    // On the side they face.
    expect(placed.x).toBeGreaterThan(person.body.x);
  });

  it('moves to the other hand while reaching for the lamp', () => {
    for (const facing of [1, -1] as const) {
      const person = holder(facing);
      const held = carriedRecordPlacement(person, room, 0);
      person.animation = 'reach';
      const reaching = carriedRecordPlacement(person, room, 0);
      const centre = person.body.x + person.body.width / 2;
      // Away from the lamp (they face it), at the same height.
      expect(Math.sign(reaching.x + SHELF.recordSize / 2 - centre)).toBe(-facing);
      expect(Math.sign(held.x + SHELF.recordSize / 2 - centre)).toBe(facing);
      expect(reaching.y).toBe(held.y);
    }
  });

  it('leans on the floor beside a cross-legged listener', () => {
    const person = holder();
    person.animation = 'listen';
    const placed = carriedRecordPlacement(person, room, 0);
    expect(placed.y + SHELF.recordSize).toBe(room.floorY);
    expect(placed.behind).toBe(true);
  });
});
