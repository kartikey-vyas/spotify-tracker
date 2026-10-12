import { describe, expect, it } from 'vitest';
import {
  PURPOSEFUL_PHYSICS_CONFIG,
  STROLL_PHYSICS_CONFIG
} from '../../src/lib/pixel-person/simulation';
import {
  REFERENCE_WALK_SPEED,
  spriteTimeScale
} from '../../src/lib/pixel-person/sprite';

describe('walk cadence', () => {
  it('stretches the walk cycle when walking slower than the authored pace', () => {
    const stroll = spriteTimeScale('walk', STROLL_PHYSICS_CONFIG.walkSpeed);
    const purposeful = spriteTimeScale('walk', PURPOSEFUL_PHYSICS_CONFIG.walkSpeed);

    expect(stroll).toBeGreaterThan(purposeful);
    expect(purposeful).toBeGreaterThan(1);
    expect(spriteTimeScale('walk', REFERENCE_WALK_SPEED)).toBeCloseTo(1);
  });

  it('leaves every other animation at its authored cadence', () => {
    expect(spriteTimeScale('idle', 0)).toBe(1);
    expect(spriteTimeScale('listen', STROLL_PHYSICS_CONFIG.walkSpeed)).toBe(1);
    expect(spriteTimeScale('climb', 1)).toBe(1);
  });

  it('does not blow up as a walker slows to a stop', () => {
    expect(spriteTimeScale('walk', 0)).toBeLessThanOrEqual(2.4);
    expect(spriteTimeScale('walk', -STROLL_PHYSICS_CONFIG.walkSpeed)).toBe(
      spriteTimeScale('walk', STROLL_PHYSICS_CONFIG.walkSpeed)
    );
  });
});
