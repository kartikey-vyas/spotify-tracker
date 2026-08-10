import { describe, expect, it } from 'vitest';
import { tinyPerson } from '../../src/lib/pixel-person/characters';
import {
  DOORWAY,
  doorwayOpacity,
  doorwayRect,
  isOverDoorway
} from '../../src/lib/pixel-person/doorway';
import { SpatialHash } from '../../src/lib/pixel-person/physics';
import {
  beginDoorwayExit,
  createPixelPerson,
  DOORWAY_EXIT,
  doorwayExitFade,
  doorwayShutProgress,
  hasDepartingPerson,
  stepPixelPerson
} from '../../src/lib/pixel-person/simulation';
import type {
  Collider,
  PhysicsBody,
  Rect,
  WorldGeometry
} from '../../src/lib/pixel-person/types';

const VIEWPORT: Rect = { x: 0, y: 0, width: 800, height: 600 };
/** Scrolled down the page, to catch anything assuming the origin. */
const SCROLLED: Rect = { x: 0, y: 2_000, width: 800, height: 600 };

function body(overrides: Partial<PhysicsBody> = {}): PhysicsBody {
  return {
    x: 100,
    y: 29,
    width: 14,
    height: 31,
    vx: 0,
    vy: 0,
    grounded: true,
    supportId: 'floor',
    ...overrides
  };
}

function geometry(overrides: Partial<WorldGeometry> = {}): WorldGeometry {
  const floor: Collider = {
    id: 'floor',
    kind: 'border',
    edge: 'top',
    x: 0,
    y: 60,
    width: 800,
    height: 2
  };
  return {
    colliders: [floor],
    occluders: [],
    itemSources: [],
    artistPresences: [],
    scanBounds: { x: 0, y: 0, width: 800, height: 600 },
    viewportBounds: VIEWPORT,
    ...overrides
  };
}

describe('where the doorway sits', () => {
  it('stands inside the bottom-right of the viewport', () => {
    const rect = doorwayRect(VIEWPORT);
    expect(rect.x + rect.width).toBeLessThan(VIEWPORT.x + VIEWPORT.width);
    expect(rect.y + rect.height).toBeLessThanOrEqual(VIEWPORT.y + VIEWPORT.height);
    expect(rect.x).toBeGreaterThan(VIEWPORT.x + VIEWPORT.width / 2);
  });

  it('follows the viewport down the page rather than sticking to the document', () => {
    // Anchored to the viewport, so it is always within reach of wherever the
    // reader is dragging — a door pinned to the top of the document would be
    // unreachable the moment they scrolled.
    const top = doorwayRect(VIEWPORT);
    const scrolled = doorwayRect(SCROLLED);
    expect(scrolled.y - top.y).toBe(SCROLLED.y - VIEWPORT.y);
    expect(scrolled.x).toBe(top.x);
  });
});

describe('what counts as dropping someone in', () => {
  it('accepts a drop on the door', () => {
    const rect = doorwayRect(VIEWPORT);
    const middle = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    expect(isOverDoorway(middle, VIEWPORT)).toBe(true);
  });

  it('accepts a near miss, because the target is small and the body swings', () => {
    const rect = doorwayRect(VIEWPORT);
    const nearMiss = {
      x: rect.x - DOORWAY.hitPadding + 2,
      y: rect.y - DOORWAY.hitPadding + 2
    };
    expect(isOverDoorway(nearMiss, VIEWPORT)).toBe(true);
  });

  it('rejects a drop nowhere near it, so ordinary drags still just land', () => {
    expect(isOverDoorway({ x: 40, y: 40 }, VIEWPORT)).toBe(false);
    const rect = doorwayRect(VIEWPORT);
    const wellClear = {
      x: rect.x - DOORWAY.hitPadding - 40,
      y: rect.y - DOORWAY.hitPadding - 40
    };
    expect(isOverDoorway(wellClear, VIEWPORT)).toBe(false);
  });

  it('tracks the viewport when the page is scrolled', () => {
    const rect = doorwayRect(SCROLLED);
    const middle = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    expect(isOverDoorway(middle, SCROLLED)).toBe(true);
    // The same document point is not the door once the reader has scrolled.
    expect(isOverDoorway(middle, VIEWPORT)).toBe(false);
  });
});

describe('the doorway fading in and out', () => {
  it('fades in while someone is held and out once they are let go', () => {
    expect(doorwayOpacity(true, 0, 0)).toBe(0);
    expect(doorwayOpacity(true, 0, DOORWAY.fadeMs)).toBe(1);
    expect(doorwayOpacity(false, 0, 0)).toBe(1);
    expect(doorwayOpacity(false, 0, DOORWAY.fadeMs)).toBe(0);
  });

  it('stays within bounds well past the fade', () => {
    expect(doorwayOpacity(true, 0, DOORWAY.fadeMs * 10)).toBe(1);
    expect(doorwayOpacity(false, 0, DOORWAY.fadeMs * 10)).toBe(0);
  });
});

describe('walking out through the door', () => {
  const doorX = 700;

  function leaver() {
    const person = createPixelPerson(tinyPerson, body({ x: 100 }), 0);
    person.nextRecordAt = 9_000_000;
    person.nextHideAt = 9_000_000;
    return person;
  }

  it('walks toward the door instead of vanishing on the spot', () => {
    const world = geometry();
    const spatial = new SpatialHash(world.colliders);
    const person = leaver();
    beginDoorwayExit(person, doorX, 0);

    expect(person.activity).toBe('exit');
    const startX = person.body.x;

    for (let step = 1; step <= 20; step += 1) {
      stepPixelPerson(person, world, spatial, 0.05, step * 50);
    }

    expect(person.body.x).toBeGreaterThan(startX);
    // Still solid while walking — the fade belongs on the threshold.
    expect(doorwayExitFade(person, 20 * 50)).toBe(0);
  });

  it('fades out on arrival and is then removed', () => {
    const world = geometry();
    const spatial = new SpatialHash(world.colliders);
    const person = leaver();
    beginDoorwayExit(person, doorX, 0);

    let now = 0;
    let alive: unknown = person;
    let sawPartialFade = false;
    for (let step = 1; step <= 800 && alive; step += 1) {
      now = step * 50;
      alive = stepPixelPerson(person, world, spatial, 0.05, now);
      const fade = doorwayExitFade(person, now);
      if (fade > 0 && fade < 1) sawPartialFade = true;
    }

    expect(sawPartialFade).toBe(true);
    // A null step result is how the world owner learns to drop them.
    expect(alive).toBeNull();
  });

  it('leaves anyway when it cannot reach the door', () => {
    // Walled in short of the doorway: without the timeout they would stand
    // there forever, holding a slot in a population the reader has reduced.
    const wall: Collider = {
      id: 'wall',
      kind: 'solid',
      x: 200,
      y: -200,
      width: 20,
      height: 262
    };
    const world = geometry({ colliders: [...geometry().colliders, wall] });
    const spatial = new SpatialHash(world.colliders);
    const person = leaver();
    beginDoorwayExit(person, doorX, 0);

    let alive: unknown = person;
    const budget = DOORWAY_EXIT.walkTimeoutMs + DOORWAY_EXIT.fadeMs + 2_000;
    for (let now = 50; now <= budget && alive; now += 50) {
      alive = stepPixelPerson(person, world, spatial, 0.05, now);
    }

    expect(alive).toBeNull();
  });

  it('drops whatever they were doing, so nothing pulls them back', () => {
    const person = leaver();
    person.carrying = {
      sourceId: 'tile-1',
      imageUrl: 'https://i.scdn.co/image/x',
      putDownAt: 0,
      deliverGoalX: 10
    };
    person.listen = { startedAt: 0, until: 99_000 };
    person.recordErrand = { sourceId: 'tile-1', imageUrl: 'x' };

    beginDoorwayExit(person, doorX, 0);

    expect(person.activity).toBe('exit');
    expect(person.listen).toBeNull();
    expect(person.recordErrand).toBeNull();
    expect(person.routine).toBeNull();
  });
});

describe('the landing beat', () => {
  const doorX = 700;

  it('falls and settles before walking anywhere', () => {
    // Dropped in mid-air above the floor. Without a landing beat they set off
    // horizontally from wherever the pointer let go, which reads as gliding
    // rather than being put down beside a door.
    const world = geometry();
    const spatial = new SpatialHash(world.colliders);
    const person = createPixelPerson(
      tinyPerson,
      body({ x: 100, y: -120, grounded: false, supportId: null }),
      0
    );
    beginDoorwayExit(person, doorX, 0);
    const startX = person.body.x;

    // Early on they are still coming down, not heading for the door.
    let now = 0;
    for (let step = 1; step <= 3; step += 1) {
      now = step * 50;
      stepPixelPerson(person, world, spatial, 0.05, now);
    }
    expect(person.body.grounded).toBe(false);
    expect(person.body.x).toBe(startX);

    // Once they are down they get on with it.
    for (let step = 4; step <= 80; step += 1) {
      now = step * 50;
      stepPixelPerson(person, world, spatial, 0.05, now);
      if (person.body.grounded && person.body.x > startX) break;
    }
    expect(person.body.grounded).toBe(true);
    expect(person.body.x).toBeGreaterThan(startX);
  });

  it('gives up waiting to land rather than hanging forever', () => {
    // No floor at all: nothing to settle onto.
    const world = geometry({ colliders: [] });
    const spatial = new SpatialHash([]);
    const person = createPixelPerson(
      tinyPerson,
      body({ x: 100, grounded: false, supportId: null }),
      0
    );
    beginDoorwayExit(person, doorX, 0);

    let alive: unknown = person;
    const budget =
      DOORWAY_EXIT.landingTimeoutMs + DOORWAY_EXIT.walkTimeoutMs + DOORWAY_EXIT.fadeMs + 2_000;
    for (let now = 50; now <= budget && alive; now += 50) {
      alive = stepPixelPerson(person, world, spatial, 0.05, now);
    }
    expect(alive).toBeNull();
  });
});

describe('the door shutting behind them', () => {
  const doorX = 200;

  it('is not shutting while nobody is leaving', () => {
    const person = createPixelPerson(tinyPerson, body(), 0);
    expect(hasDepartingPerson([person])).toBe(false);
    expect(doorwayShutProgress([person], 1_000)).toBe(0);
  });

  it('stays open while they are still walking to it', () => {
    const world = geometry();
    const spatial = new SpatialHash(world.colliders);
    const person = createPixelPerson(tinyPerson, body({ x: 20 }), 0);
    beginDoorwayExit(person, doorX, 0);

    stepPixelPerson(person, world, spatial, 0.05, 50);

    expect(hasDepartingPerson([person])).toBe(true);
    // Walking, not yet through — the door has no business closing yet.
    expect(doorwayShutProgress([person], 50)).toBe(0);
  });

  it('swings shut as they step through, finishing with them', () => {
    const world = geometry();
    const spatial = new SpatialHash(world.colliders);
    const person = createPixelPerson(tinyPerson, body({ x: doorX }), 0);
    beginDoorwayExit(person, doorX, 0);

    // First step lands and arrives, so the entrance begins.
    let now = 50;
    stepPixelPerson(person, world, spatial, 0.05, now);
    stepPixelPerson(person, world, spatial, 0.05, (now += 50));

    const partway = doorwayShutProgress([person], now + DOORWAY_EXIT.fadeMs / 2);
    expect(partway).toBeGreaterThan(0);
    expect(partway).toBeLessThan(1);
    expect(doorwayShutProgress([person], now + DOORWAY_EXIT.fadeMs)).toBe(1);
  });
});
