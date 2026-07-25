import { describe, expect, it } from 'vitest';
import {
  createDangle,
  defaultDangleConfig,
  rebaseDangleAnchor,
  releaseDangle,
  resolveDroppedBody,
  sampleDanglePointer,
  stepDangle
} from '../../src/lib/pixel-person/drag';
import { intersects, SpatialHash } from '../../src/lib/pixel-person/physics';
import {
  beginPixelPersonDrag,
  createPixelPerson,
  moveDraggedPixelPerson,
  releasePixelPersonDrag,
  stepPixelPerson
} from '../../src/lib/pixel-person/simulation';
import { hitTestSpriteFrame, selectSpriteFrame } from '../../src/lib/pixel-person/sprite';
import type { Collider, PhysicsBody, SpriteFrame } from '../../src/lib/pixel-person/types';
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
    supportId: 'old-floor',
    ...overrides
  };
}

function solid(overrides: Partial<Collider> = {}): Collider {
  return {
    id: 'panel',
    kind: 'solid',
    x: 30,
    y: 30,
    width: 60,
    height: 60,
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
    expect(result.body.supportId).toBeNull();
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

describe('pixel person drag lifecycle', () => {
  it('enters dangling mode, follows only its active pointer, and returns to physics', () => {
    const person = createPixelPerson(tinyPerson, body({ x: 40, y: 40 }), 0);
    const spatial = new SpatialHash([]);
    const geometry = {
      colliders: [],
      occluders: [],
      itemSources: [],
      scanBounds: { x: 0, y: 0, width: 500, height: 500 },
      viewportBounds: { x: 0, y: 0, width: 500, height: 500 }
    };

    beginPixelPersonDrag(person, 7, { x: 50, y: 30 }, 10);
    expect(person.activity).toBe('drag');
    expect(person.animation).toBe('dangle');
    expect(person.drag?.pointerId).toBe(7);
    expect(moveDraggedPixelPerson(person, 8, { x: 90, y: 30 }, 20)).toBe(false);
    expect(moveDraggedPixelPerson(person, 7, { x: 90, y: 30 }, 20)).toBe(true);

    const stepped = stepPixelPerson(person, geometry, spatial, [], 1 / 60, 36);
    expect(stepped?.body.grounded).toBe(false);
    expect(stepped?.body.x).toBeGreaterThan(40);
    expect(releasePixelPersonDrag(person, 8, spatial, 40)).toBe(false);
    expect(releasePixelPersonDrag(person, 7, spatial, 40)).toBe(true);
    expect(person.drag).toBeNull();
    expect(person.activity).toBe('idle');
    expect(person.body.grounded).toBe(false);
  });

  it('returns a crawling person to standing height while dangling', () => {
    const person = createPixelPerson(
      tinyPerson,
      body({ x: 40, y: 58, height: 12 }),
      0
    );
    person.crawling = true;
    person.animation = 'crawl';

    beginPixelPersonDrag(person, 7, { x: 50, y: 30 }, 10);

    expect(person.crawling).toBe(false);
    expect(person.body.height).toBe(31);
    expect(person.animation).toBe('dangle');
  });

  it('settles into a crawl when released beneath an overhead obstacle', () => {
    const person = createPixelPerson(tinyPerson, body({ x: 40, y: 40 }), 0);
    const ceiling = solid({ id: 'ceiling', x: 0, y: 40, width: 100, height: 2 });
    const spatial = new SpatialHash([ceiling]);
    beginPixelPersonDrag(person, 7, { x: 50, y: 30 }, 10);

    expect(releasePixelPersonDrag(person, 7, spatial, 20)).toBe(true);

    expect(person.crawling).toBe(true);
    expect(person.body.height).toBe(12);
    expect(person.body.y).toBeGreaterThanOrEqual(ceiling.y + ceiling.height);
    expect(person.animation).toBe('crawl');
  });
});

describe('pixel person dropping safety', () => {
  it('allows a deliberate drop into the clear interior of a hollow panel', () => {
    const inside = body({ x: 43, y: 33, vx: 0, vy: 0 });
    const panelFrame = [
      solid({ id: 'panel-top', x: 0, y: 0, width: 100, height: 2 }),
      solid({ id: 'panel-right', x: 98, y: 0, width: 2, height: 96 }),
      solid({ id: 'panel-bottom', x: 0, y: 94, width: 100, height: 2 }),
      solid({ id: 'panel-left', x: 0, y: 0, width: 2, height: 96 })
    ];

    expect(resolveDroppedBody(inside, panelFrame)).toEqual(inside);
  });

  it('moves a released body out of solid geometry, preferring the space above', () => {
    const panel = solid();
    const embedded = body({ x: 50, y: 50 });
    const resolved = resolveDroppedBody(embedded, [panel]);

    expect(intersects(resolved, panel)).toBe(false);
    expect(resolved.y).toBeLessThan(embedded.y);
    expect(resolved.vx).toBe(embedded.vx);
    expect(resolved.vy).toBe(embedded.vy);
  });

  it('does not disturb a clear release position', () => {
    const clear = body({ x: 0, y: 0, vx: 90, vy: -40 });
    expect(resolveDroppedBody(clear, [solid()])).toEqual(clear);
  });

  it('keeps edge releases fully inside the visible play area', () => {
    const released = body({ x: -6, y: -4 });
    const resolved = resolveDroppedBody(
      released,
      [],
      180,
      { x: 0, y: 0, width: 500, height: 300 }
    );

    expect(resolved.x).toBe(0);
    expect(resolved.y).toBe(0);
  });

  it('escapes a crowded card stack beyond the initial local radius', () => {
    const card = solid({ x: 40, y: 100, width: 100, height: 100 });
    const heading = solid({ id: 'heading', x: 20, y: 70, width: 150, height: 18 });
    const panelBorder = solid({ id: 'panel-top', x: 0, y: 50, width: 220, height: 2 });
    const embedded = body({ x: 80, y: 145 });
    const colliders = [card, heading, panelBorder];
    const resolved = resolveDroppedBody(embedded, colliders);

    expect(colliders.some((collider) => intersects(resolved, collider))).toBe(false);
    expect(resolved.y).toBeLessThanOrEqual(20);
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
