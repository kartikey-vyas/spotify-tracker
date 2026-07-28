import { describe, expect, it } from 'vitest';
import { deviceStep, spriteCacheKey } from '../../src/lib/pixel-person/render';

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
