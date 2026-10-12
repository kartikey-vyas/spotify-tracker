import { describe, expect, it } from 'vitest';
import {
  createDangle,
  defaultDangleConfig,
  rebaseDangleAnchor,
  releaseDangle,
  sampleDanglePointer,
  stepDangle
} from '../../src/lib/pixel-person/drag';
import { hitTestSpriteFrame, selectSpriteFrame } from '../../src/lib/pixel-person/sprite';
import type { PhysicsBody, SpriteFrame } from '../../src/lib/pixel-person/types';
import { tinyPerson } from '../../src/lib/pixel-person/characters';

function body(overrides: Partial<PhysicsBody> = {}): PhysicsBody {
  return {
    x: -7,
    y: 0,
    width: 14,
    height: 31,
    vx: 0,
    vy: 0,
    grounded: true,
    ...overrides
  };
}

describe('pixel person dangling dynamics', () => {
  it('attaches the body centre a fixed distance below the pointer', () => {
    const state = createDangle(4, { x: 50, y: 40 }, body({ x: 43 }), 15, 0);
    const result = stepDangle(state, body({ x: 43 }), 0);

    expect(result.body.x + result.body.width / 2).toBeCloseTo(50, 5);
    expect(result.body.y + result.body.height / 2).toBeCloseTo(55, 5);
    expect(result.body.grounded).toBe(false);
  });

  it('lags opposite a sharp horizontal pointer acceleration', () => {
    let state = createDangle(1, { x: 0, y: 0 }, body(), 15, 0);
    state = sampleDanglePointer(state, { x: 70, y: 0 }, 50);
    const result = stepDangle(state, body(), 1 / 60);
    const centreX = result.body.x + result.body.width / 2;

    expect(result.state.pointerAcceleration.x).toBeGreaterThan(0);
    expect(result.state.angle).toBeLessThan(-0.02);
    expect(centreX).toBeLessThan(result.state.anchor.x);
  });

  it('lags in the opposite direction for a leftward acceleration', () => {
    let state = createDangle(1, { x: 100, y: 0 }, body({ x: 93 }), 15, 0);
    state = sampleDanglePointer(state, { x: 30, y: 0 }, 50);
    const result = stepDangle(state, body(), 1 / 60);

    expect(result.state.pointerAcceleration.x).toBeLessThan(0);
    expect(result.state.angle).toBeGreaterThan(0);
  });

  it('responds proportionally instead of overreacting to gentle movement', () => {
    const resting = createDangle(1, { x: 0, y: 0 }, body(), 15, 0);
    const gentle = stepDangle(
      sampleDanglePointer(resting, { x: 4, y: 0 }, 50),
      body(),
      1 / 60
    );
    const sharp = stepDangle(
      sampleDanglePointer(resting, { x: 70, y: 0 }, 50),
      body(),
      1 / 60
    );

    expect(Math.abs(gentle.state.angle)).toBeGreaterThan(0);
    expect(Math.abs(gentle.state.angle)).toBeLessThan(Math.abs(sharp.state.angle));
  });

  it('damps a released swing back toward a natural vertical rest', () => {
    let state = {
      ...createDangle(1, { x: 0, y: 0 }, body(), 15, 0),
      angle: 0.8,
      angularVelocity: 2.2
    };
    let currentBody = body();
    for (let frame = 0; frame < 240; frame += 1) {
      const result = stepDangle(state, currentBody, 1 / 120);
      state = result.state;
      currentBody = result.body;
    }

    expect(Math.abs(state.angle)).toBeLessThan(0.01);
    expect(Math.abs(state.angularVelocity)).toBeLessThan(0.05);
  });

  it('stays finite and within a plausible arc under extreme pointer samples', () => {
    let state = createDangle(1, { x: 0, y: 0 }, body(), 15, 0);
    let currentBody = body();
    for (let sample = 1; sample <= 120; sample += 1) {
      const direction = sample % 2 === 0 ? 1 : -1;
      state = sampleDanglePointer(state, { x: direction * 10_000, y: 0 }, sample * 4);
      const result = stepDangle(state, currentBody, 1 / 120);
      state = result.state;
      currentBody = result.body;
    }

    expect(Number.isFinite(state.angle)).toBe(true);
    expect(Number.isFinite(state.angularVelocity)).toBe(true);
    expect(Math.abs(state.angle)).toBeLessThanOrEqual(defaultDangleConfig.maximumAngle);
    expect(Math.abs(state.angularVelocity)).toBeLessThanOrEqual(
      defaultDangleConfig.maximumAngularSpeed
    );
  });

  it('carries pointer and pendulum momentum into a bounded release', () => {
    const state = {
      ...createDangle(1, { x: 0, y: 0 }, body(), 15, 0),
      angle: 0.35,
      angularVelocity: 4,
      pointerVelocity: { x: 600, y: -80 }
    };
    const released = releaseDangle(state, body());

    expect(released.vx).toBeGreaterThan(0);
    expect(Math.hypot(released.vx, released.vy)).toBeLessThanOrEqual(
      defaultDangleConfig.maximumReleaseSpeed
    );
    expect(released.grounded).toBe(false);
  });

  it('forgets stale pointer velocity while held still', () => {
    let state = sampleDanglePointer(
      createDangle(1, { x: 0, y: 0 }, body(), 15, 0),
      { x: 70, y: 0 },
      50
    );
    let currentBody = body();
    for (let frame = 0; frame < 120; frame += 1) {
      const result = stepDangle(state, currentBody, 1 / 60);
      state = result.state;
      currentBody = result.body;
    }

    expect(Math.hypot(state.pointerVelocity.x, state.pointerVelocity.y)).toBeLessThan(0.001);
    expect(Math.hypot(state.pointerAcceleration.x, state.pointerAcceleration.y)).toBeLessThan(
      0.001
    );
  });

  it('rebases through document scrolling without inventing pointer acceleration', () => {
    const moving = sampleDanglePointer(
      createDangle(1, { x: 100, y: 100 }, body(), 15, 0),
      { x: 140, y: 100 },
      40
    );
    const rebased = rebaseDangleAnchor(moving, { x: 140, y: 580 }, 50);

    expect(rebased.anchor).toEqual({ x: 140, y: 580 });
    expect(rebased.pointerVelocity).toEqual(moving.pointerVelocity);
    expect(rebased.pointerAcceleration).toEqual(moving.pointerAcceleration);
    expect(rebased.lastSampleAt).toBe(50);
  });
});

describe('pixel person sprite hit testing', () => {
  const frame: SpriteFrame = { rows: ['x.', '..'] };

  it('only treats opaque sprite pixels as draggable without hit slop', () => {
    expect(hitTestSpriteFrame(frame, 2, 1, 0.5, 0.5, 0)).toBe(true);
    expect(hitTestSpriteFrame(frame, 2, 1, 3, 0.5, 0)).toBe(false);
  });

  it('mirrors the opaque hit area with the character facing', () => {
    expect(hitTestSpriteFrame(frame, 2, -1, 3.5, 0.5, 0)).toBe(true);
    expect(hitTestSpriteFrame(frame, 2, -1, 0.5, 0.5, 0)).toBe(false);
  });

  it('adds a small usability margin without making the whole canvas interactive', () => {
    expect(hitTestSpriteFrame(frame, 2, 1, 2.5, 0.5)).toBe(true);
    expect(hitTestSpriteFrame(frame, 2, 1, 20, 20)).toBe(false);
  });

  it('selects looping and held animation frames deterministically', () => {
    expect(selectSpriteFrame(tinyPerson, 'dangle', 0, 250).index).toBe(1);
    expect(selectSpriteFrame(tinyPerson, 'jump', 0, 10_000).index).toBe(0);
  });
});
