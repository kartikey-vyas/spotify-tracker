import { afterEach, describe, expect, it, vi } from 'vitest';
import { tinyPerson } from '../../src/lib/pixel-person/characters';
import { bridgeWalkableTops } from '../../src/lib/pixel-person/geometry';
import { resolveDroppedBody } from '../../src/lib/pixel-person/drag';
import { SpatialHash } from '../../src/lib/pixel-person/physics';
import {
  clearRecordArtCache,
  requestRecordArt
} from '../../src/lib/pixel-person/record-art';
import {
  PLACED_RECORD_HOLD_MS,
  placedRecordHitTest
} from '../../src/lib/pixel-person/render';
import {
  createPixelPerson,
  stepPixelPerson,
  STUCK_RECOVERY_MS
} from '../../src/lib/pixel-person/simulation';
import type {
  Collider,
  PhysicsBody,
  WorldGeometry
} from '../../src/lib/pixel-person/types';

function body(overrides: Partial<PhysicsBody> = {}): PhysicsBody {
  return {
    x: 10,
    // Feet at y=60 (29 + body height 31), matching the default floor collider's top.
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

function collider(overrides: Partial<Collider> = {}): Collider {
  return {
    id: 'floor',
    kind: 'border',
    edge: 'top',
    x: 0,
    y: 60,
    width: 400,
    height: 2,
    ...overrides
  };
}

function geometry(overrides: Partial<WorldGeometry> = {}): WorldGeometry {
  return {
    colliders: [collider()],
    occluders: [],
    itemSources: [],
    artistPresences: [],
    scanBounds: { x: 0, y: 0, width: 2000, height: 1000 },
    viewportBounds: { x: 0, y: 0, width: 2000, height: 1000 },
    ...overrides
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('stale collider hardening', () => {
  it('aborts a climb into a fall when the wall moved after a rescan', () => {
    const floor = collider({ id: 'floor', y: 80, width: 200 });
    const wallBefore = collider({ id: 'wall', edge: undefined, x: 30, y: 0, width: 2, height: 80 });
    const wallAfter = { ...wallBefore, x: 300 };
    const worldAfter = geometry({ colliders: [floor, wallAfter] });
    const person = createPixelPerson(tinyPerson, body({ x: 15, y: 50 }), 0);
    person.activity = 'climb';
    person.climb = { wall: wallBefore, top: wallBefore, side: 'left', direction: 'up', returnY: null };

    stepPixelPerson(person, worldAfter, new SpatialHash(worldAfter.colliders), 0.05, 50);

    expect(person.climb).toBeNull();
    expect(person.activity).toBe('idle');
    expect(person.body.grounded).toBe(false);
    // Never pinned against the phantom wall's old position mid-air.
    expect(person.body.x).toBe(15);
  });

  it('lands a mantle as a fall when the support vanished mid-lerp', () => {
    const person = createPixelPerson(tinyPerson, body({ x: 0, grounded: false, supportId: null }), 0);
    const world = geometry({ colliders: [] });
    person.activity = 'mantle';
    person.mantle = {
      start: { x: 0, y: 60 },
      end: { x: 20, y: 30 },
      startedAt: 0,
      supportId: 'gone-collider'
    };

    stepPixelPerson(person, world, new SpatialHash([]), 0.05, 5_000);

    expect(person.mantle).toBeNull();
    expect(person.body.grounded).toBe(false);
    expect(person.body.supportId).toBeNull();
  });
});

describe('ladder mantle landing', () => {
  it('mantles onto the shelf that qualified the ladder, not the ladder top', () => {
    // The shelf sits 8px above the ladder's top — the maximum topSlack.
    const lowerShelf = collider({ id: 'lower-shelf', x: 0, y: 200, width: 300 });
    const shelf = collider({ id: 'shelf', x: 100, y: 92, width: 200 });
    const ladder: Collider = { id: 'ladder-1', kind: 'ladder', x: 148, y: 100, width: 4, height: 100 };
    const world = geometry({ colliders: [lowerShelf, shelf, ladder] });
    const spatial = new SpatialHash(world.colliders);
    const person = createPixelPerson(
      tinyPerson,
      body({ x: 143, y: 169, supportId: 'lower-shelf' }),
      0
    );
    person.activity = 'wander';
    person.activityUntil = 99_000;
    person.goalX = 143;
    person.plannedLadder = { ladderId: 'ladder-1', goalX: 143 };
    person.nextRecordAt = 999_000;
    person.nextHideAt = 999_000;

    let step = 1;
    while (step < 300) {
      stepPixelPerson(person, world, spatial, 0.05, step * 50);
      step += 1;
      if (
        (person.activity as string) !== 'climb' &&
        (person.activity as string) !== 'mantle' &&
        person.body.grounded
      ) {
        break;
      }
    }

    expect(person.body.grounded).toBe(true);
    expect(person.body.supportId).toBe('shelf');
    expect(person.body.y + person.body.height).toBe(92);
  });
});

describe('confinement requires thwarted movement', () => {
  it('never flags a person who simply idles in place', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.1);
    const world = geometry();
    const spatial = new SpatialHash(world.colliders);
    const person = createPixelPerson(tinyPerson, body({ x: 500 }), 0);
    person.nextRecordAt = 999_000;
    person.nextHideAt = 999_000;

    for (let now = 100; now <= 17_000; now += 100) {
      stepPixelPerson(person, world, spatial, 0.1, now);
    }

    expect(person.stuckForMs).toBeLessThan(STUCK_RECOVERY_MS);
  });
});

describe('drop resolution distance cap', () => {
  it('does not teleport onto a tall blocker top beyond the cap', () => {
    const tall: Collider = { id: 'tall', kind: 'solid', x: 40, y: 100, width: 60, height: 400 };
    const source = body({ x: 50, y: 470, grounded: false, supportId: null });

    const resolved = resolveDroppedBody(source, [tall], 180, {
      x: 0,
      y: 0,
      width: 500,
      height: 600
    });

    expect(Math.abs(resolved.y - source.y)).toBeLessThanOrEqual(180);
    expect(Math.abs(resolved.x - source.x)).toBeLessThanOrEqual(180);
  });
});

describe('bridging is grid-relative', () => {
  it('does not bridge two unrelated narrow solids across a proportionally huge gap', () => {
    const buttons = [
      collider({ id: 'a', kind: 'solid', edge: undefined, x: 0, y: 100, width: 30, height: 30 }),
      collider({ id: 'b', kind: 'solid', edge: undefined, x: 47, y: 100, width: 30, height: 30 })
    ];
    expect(bridgeWalkableTops(buttons)).toEqual([]);
  });

  it('still bridges wide grid tiles across their small gaps', () => {
    const tiles = [
      collider({ id: 'a', kind: 'solid', edge: undefined, x: 0, y: 100, width: 96, height: 96 }),
      collider({ id: 'b', kind: 'solid', edge: undefined, x: 104, y: 100, width: 96, height: 96 })
    ];
    expect(bridgeWalkableTops(tiles)).toHaveLength(1);
  });
});

describe('crawl transition hygiene', () => {
  it('clears a planned ladder ride when a crawl begins', () => {
    const floor = collider({ id: 'floor', x: 0, y: 60, width: 120 });
    const ceiling = collider({ id: 'ceiling', x: 20, y: 46, width: 50 });
    const world = geometry({ colliders: [floor, ceiling] });
    const person = createPixelPerson(
      tinyPerson,
      body({ x: 4, supportId: 'floor' }),
      0
    );
    person.activity = 'wander';
    person.activityUntil = 10_000;
    person.goalX = 100;
    person.plannedLadder = { ladderId: 'somewhere', goalX: 400 };

    stepPixelPerson(person, world, new SpatialHash(world.colliders), 0.05, 50);

    expect(person.crawling).toBe(true);
    expect(person.plannedLadder).toBeNull();
  });
});

describe('cliff sense at walkable edges', () => {
  const shelf = () => collider({ id: 'shelf', x: 0, y: 60, width: 100 });

  function walker(overrides: Partial<PhysicsBody> = {}) {
    const person = createPixelPerson(
      tinyPerson,
      body({ x: 10, supportId: 'shelf', ...overrides }),
      0
    );
    person.activity = 'wander';
    person.activityUntil = 99_000;
    person.goalX = 300;
    person.nextRecordAt = 999_000;
    person.nextHideAt = 999_000;
    return person;
  }

  it('turns back from an edge with nothing to land on below', () => {
    const world = geometry({ colliders: [shelf()] });
    const spatial = new SpatialHash(world.colliders);
    const person = walker();

    for (let step = 1; step <= 120; step += 1) {
      stepPixelPerson(person, world, spatial, 0.05, step * 50);
      expect(person.body.grounded).toBe(true);
      // Never leaves the shelf: some part of the body always overlaps it.
      expect(person.body.x).toBeLessThan(100);
      expect(person.body.x + person.body.width).toBeGreaterThan(0);
    }
  });

  it('still hops off when a landing exists within the drop window', () => {
    const lower = collider({ id: 'lower', x: 96, y: 160, width: 200 });
    const world = geometry({ colliders: [shelf(), lower] });
    const spatial = new SpatialHash(world.colliders);
    const person = walker();

    let wentAirborne = false;
    for (let step = 1; step <= 200; step += 1) {
      stepPixelPerson(person, world, spatial, 0.05, step * 50);
      if (!person.body.grounded) wentAirborne = true;
      if (wentAirborne && person.body.grounded) break;
    }

    expect(wentAirborne).toBe(true);
    expect(person.body.supportId).toBe('lower');
  });

  it('a carrier committed to a delivery walks off the edge anyway', () => {
    const world = geometry({ colliders: [shelf()] });
    const spatial = new SpatialHash(world.colliders);
    const person = walker();
    person.carrying = {
      sourceId: 'tile-1',
      imageUrl: 'https://i.scdn.co/image/x',
      putDownAt: 99_000,
      deliverGoalX: 300
    };

    let wentAirborne = false;
    for (let step = 1; step <= 120 && !wentAirborne; step += 1) {
      stepPixelPerson(person, world, spatial, 0.05, step * 50);
      if (!person.body.grounded) wentAirborne = true;
    }

    expect(wentAirborne).toBe(true);
  });
});

describe('placed record hit testing', () => {
  const record = (overrides = {}) => ({
    id: 1,
    imageUrl: 'https://i.scdn.co/image/x',
    position: { x: 100, y: 200 },
    placedAt: 1_000,
    ...overrides
  });

  it('hits inside the bottom-centered 24px art box and misses outside', () => {
    const records = [record()];
    // Art spans x 88..112, y 176..200 (bottom-centered on position).
    expect(placedRecordHitTest(records, { x: 100, y: 190 }, 2_000)?.id).toBe(1);
    expect(placedRecordHitTest(records, { x: 89, y: 177 }, 2_000)?.id).toBe(1);
    expect(placedRecordHitTest(records, { x: 100, y: 210 }, 2_000)).toBeNull();
    expect(placedRecordHitTest(records, { x: 130, y: 190 }, 2_000)).toBeNull();
  });

  it('ignores records that are already fading and prefers the topmost', () => {
    const fading = record({ id: 1, placedAt: 1_000 });
    const fresh = record({ id: 2, placedAt: 5_000 });
    const now = 1_000 + PLACED_RECORD_HOLD_MS + 500;
    expect(placedRecordHitTest([fading], { x: 100, y: 190 }, now)).toBeNull();
    expect(placedRecordHitTest([fading, fresh], { x: 100, y: 190 }, now)?.id).toBe(2);
  });

  it('a dismissed record is no longer clickable', () => {
    const dismissed = record({ id: 1, placedAt: 1_000, dismissedAt: 1_500 });
    expect(placedRecordHitTest([dismissed], { x: 100, y: 190 }, 2_000)).toBeNull();
  });
});

describe('record art failure retry', () => {
  it('retries a failed fetch after the backoff instead of poisoning the source', async () => {
    clearRecordArtCache();
    const failingFetch = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', failingFetch);

    const entry = requestRecordArt('https://example.com/cover.jpg');
    await vi.waitFor(() => expect(entry.status).toBe('failed'));
    expect(entry.failedAt).toBeDefined();
    const fetchesAfterFailure = failingFetch.mock.calls.length;

    // Within the backoff: no new fetch.
    requestRecordArt('https://example.com/cover.jpg');
    expect(failingFetch.mock.calls.length).toBe(fetchesAfterFailure);

    // Past the backoff: retried.
    entry.failedAt = Date.now() - 61_000;
    const retried = requestRecordArt('https://example.com/cover.jpg');
    expect(retried.status).toBe('loading');
    await vi.waitFor(() =>
      expect(failingFetch.mock.calls.length).toBeGreaterThan(fetchesAfterFailure)
    );
    clearRecordArtCache();
  });
});
