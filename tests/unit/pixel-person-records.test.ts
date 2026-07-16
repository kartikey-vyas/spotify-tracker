import { describe, expect, it } from 'vitest';
import { tinyPerson } from '../../src/lib/pixel-person/characters';
import { bridgeWalkableTops, findSafeSpawn } from '../../src/lib/pixel-person/geometry';
import { SpatialHash } from '../../src/lib/pixel-person/physics';
import { smallCoverVariant } from '../../src/lib/pixel-person/record-art';
import {
  beginPixelPersonDrag,
  cancelRecordErrand,
  createPixelPerson,
  dropCarriedRecord,
  stepPixelPerson,
  STUCK_RECOVERY_MS
} from '../../src/lib/pixel-person/simulation';
import type {
  Collider,
  ItemSource,
  PhysicsBody,
  PixelWorldEvent,
  WorldGeometry
} from '../../src/lib/pixel-person/types';

function body(overrides: Partial<PhysicsBody> = {}): PhysicsBody {
  return {
    x: 10,
    y: 30,
    width: 14,
    height: 30,
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

function recordSource(overrides: Partial<ItemSource> = {}): ItemSource {
  return {
    id: 'tile-1',
    kind: 'record',
    imageUrl: 'https://i.scdn.co/image/ab67616d0000b273aaaabbbbccccddddeeeeffff',
    x: 100,
    y: 60,
    width: 96,
    height: 96,
    ...overrides
  };
}

function geometry(overrides: Partial<WorldGeometry> = {}): WorldGeometry {
  return {
    colliders: [collider()],
    occluders: [],
    itemSources: [recordSource()],
    scanBounds: { x: 0, y: 0, width: 500, height: 500 },
    viewportBounds: { x: 0, y: 0, width: 500, height: 500 },
    ...overrides
  };
}

describe('walkable top bridging', () => {
  it('bridges a tile row with small gaps and slight top jitter into one strip', () => {
    const tiles = [
      collider({ id: 'a', x: 0, y: 100, width: 96 }),
      collider({ id: 'b', x: 104, y: 101, width: 96 }),
      collider({ id: 'c', x: 208, y: 100, width: 96 })
    ];

    const bridges = bridgeWalkableTops(tiles);

    expect(bridges).toHaveLength(1);
    expect(bridges[0]).toMatchObject({
      x: 0,
      y: 100,
      width: 304,
      kind: 'platform',
      edge: 'top'
    });
  });

  it('does not bridge gaps wider than a body width', () => {
    const tiles = [
      collider({ id: 'a', x: 0, width: 96 }),
      collider({ id: 'b', x: 136, width: 96 })
    ];
    expect(bridgeWalkableTops(tiles)).toEqual([]);
  });

  it('ignores narrow segments and non-walkable colliders', () => {
    const noise = [
      collider({ id: 'w1', x: 0, width: 20 }),
      collider({ id: 'w2', x: 24, width: 20 }),
      collider({ id: 'text', kind: 'text', edge: undefined, x: 60, width: 90, height: 14 })
    ];
    expect(bridgeWalkableTops(noise)).toEqual([]);
  });

  it('bridges solid tile tops so a person can walk a cover-wall row', () => {
    const tiles = [
      collider({ id: 'tile-a', kind: 'solid', edge: undefined, x: 0, y: 60, width: 96, height: 96 }),
      collider({ id: 'tile-b', kind: 'solid', edge: undefined, x: 104, y: 60, width: 96, height: 96 }),
      collider({ id: 'tile-c', kind: 'solid', edge: undefined, x: 208, y: 60, width: 96, height: 96 })
    ];
    const colliders = [...tiles, ...bridgeWalkableTops(tiles)];
    const world = geometry({ colliders, itemSources: [] });
    const spatial = new SpatialHash(colliders);
    const person = createPixelPerson(
      tinyPerson,
      body({ x: 4, supportId: 'tile-a' }),
      0
    );
    person.activity = 'wander';
    person.activityUntil = 10_000;
    person.goalX = 260;

    for (let step = 1; step <= 130; step += 1) {
      stepPixelPerson(person, world, spatial, [], 0.05, step * 50);
      expect(person.body.grounded).toBe(true);
      expect(person.body.vy).toBe(0);
    }

    expect(person.body.x).toBeGreaterThan(200);
    expect(person.stuckForMs).toBe(0);
  });
});

describe('pixel person record errands', () => {
  it('plans an errand toward a reachable cover once the cooldown elapses', () => {
    const world = geometry();
    const person = createPixelPerson(tinyPerson, body(), 0);
    person.activity = 'idle';
    person.activityUntil = 0;
    person.nextRecordAt = 0;

    stepPixelPerson(person, world, new SpatialHash(world.colliders), [], 0.05, 50);

    expect(person.activity).toBe('seek-record');
    expect(person.recordErrand?.sourceId).toBe('tile-1');
    expect(person.goalX).toBe(100 + 96 / 2 - 14 / 2);
    expect(person.nextRecordAt).toBeGreaterThan(20_000);
  });

  it('prefers a record errand over planning a climb from a solid support', () => {
    const panel = collider({
      id: 'panel',
      kind: 'solid',
      edge: undefined,
      x: 0,
      y: 60,
      width: 200,
      height: 90
    });
    const world = geometry({ colliders: [panel] });
    const person = createPixelPerson(tinyPerson, body({ supportId: 'panel' }), 0);
    person.activity = 'idle';
    person.activityUntil = 0;
    person.nextRecordAt = 0;

    stepPixelPerson(person, world, new SpatialHash([panel]), [], 0.05, 50);

    expect(person.activity).toBe('seek-record');
    expect(person.plannedClimb).toBeNull();
  });

  it('arrives, stoops with the crouch animation, and starts carrying', () => {
    const world = geometry();
    const person = createPixelPerson(tinyPerson, body({ x: 141 }), 0);
    person.activity = 'seek-record';
    person.activityUntil = 10_000;
    person.recordErrand = { sourceId: 'tile-1', imageUrl: recordSource().imageUrl };
    const spatial = new SpatialHash(world.colliders);

    stepPixelPerson(person, world, spatial, [], 0.05, 100);
    expect(person.activity).toBe('record-stoop');
    expect(person.animation).toBe('hide');
    expect(person.carrying).toBeNull();

    stepPixelPerson(person, world, spatial, [], 0.05, 700);
    expect(person.carrying?.sourceId).toBe('tile-1');
    expect(person.carrying!.putDownAt - 700).toBeGreaterThanOrEqual(20_000);
    expect(person.carrying!.putDownAt - 700).toBeLessThanOrEqual(60_000);
    expect(person.recordErrand).toBeNull();
    expect(person.activity).toBe('idle');
  });

  it('cancels the errand when a rescan removes the source tile', () => {
    const world = geometry({ itemSources: [] });
    const person = createPixelPerson(tinyPerson, body(), 0);
    person.activity = 'seek-record';
    person.activityUntil = 10_000;
    person.recordErrand = { sourceId: 'tile-1', imageUrl: recordSource().imageUrl };

    stepPixelPerson(person, world, new SpatialHash(world.colliders), [], 0.05, 50);

    expect(person.recordErrand).toBeNull();
    expect(person.activity).not.toBe('seek-record');
  });

  it('sets the record down after the carry timer and reports where it fell', () => {
    const world = geometry();
    const spatial = new SpatialHash(world.colliders);
    const events: PixelWorldEvent[] = [];
    const person = createPixelPerson(tinyPerson, body(), 0);
    person.activity = 'idle';
    person.activityUntil = 10_000;
    person.carrying = { sourceId: 'tile-1', imageUrl: recordSource().imageUrl, putDownAt: 0 };

    stepPixelPerson(person, world, spatial, [], 0.05, 100, events);
    expect(person.activity).toBe('record-stoop');

    stepPixelPerson(person, world, spatial, [], 0.05, 800, events);
    expect(person.carrying).toBeNull();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'record-dropped',
      record: {
        sourceId: 'tile-1',
        position: { x: person.body.x + person.body.width / 2, y: person.body.y + person.body.height }
      }
    });
  });

  it('completes a set-down without an events array without throwing', () => {
    const world = geometry();
    const spatial = new SpatialHash(world.colliders);
    const person = createPixelPerson(tinyPerson, body(), 0);
    person.activity = 'idle';
    person.activityUntil = 10_000;
    person.carrying = { sourceId: 'tile-1', imageUrl: recordSource().imageUrl, putDownAt: 0 };

    stepPixelPerson(person, world, spatial, [], 0.05, 100);
    stepPixelPerson(person, world, spatial, [], 0.05, 800);

    expect(person.carrying).toBeNull();
  });

  it('never hides while carrying a record', () => {
    const occluder = { id: 'panel:occluder', groupId: 'panel', x: 60, y: 30, width: 120, height: 60 };
    const world = geometry({ occluders: [occluder], itemSources: [] });
    const spatial = new SpatialHash(world.colliders);

    const carrier = createPixelPerson(tinyPerson, body(), 0);
    carrier.activityUntil = 0;
    carrier.nextHideAt = 0;
    carrier.carrying = { sourceId: 'tile-1', imageUrl: recordSource().imageUrl, putDownAt: 99_000 };
    stepPixelPerson(carrier, world, spatial, [], 0.05, 50);
    expect(carrier.activity).not.toBe('seek-hide');

    const idler = createPixelPerson(tinyPerson, body(), 0);
    idler.activityUntil = 0;
    idler.nextHideAt = 0;
    stepPixelPerson(idler, world, spatial, [], 0.05, 50);
    expect(idler.activity).toBe('seek-hide');
  });

  it('drops the carried record in place when grabbed', () => {
    const person = createPixelPerson(tinyPerson, body(), 0);
    person.carrying = { sourceId: 'tile-1', imageUrl: recordSource().imageUrl, putDownAt: 99_000 };
    person.recordErrand = { sourceId: 'tile-2', imageUrl: recordSource().imageUrl };

    const dropped = dropCarriedRecord(person);
    expect(dropped).toMatchObject({
      sourceId: 'tile-1',
      position: { x: person.body.x + person.body.width / 2, y: person.body.y + person.body.height }
    });
    expect(person.carrying).toBeNull();
    expect(dropCarriedRecord(person)).toBeNull();

    beginPixelPersonDrag(person, 7, { x: 20, y: 20 }, 10);
    expect(person.activity).toBe('drag');
    expect(person.recordErrand).toBeNull();
    expect(person.recordStoop).toBeNull();
  });

  it('cancelRecordErrand abandons the walk and clears the errand', () => {
    const person = createPixelPerson(tinyPerson, body(), 0);
    person.activity = 'seek-record';
    person.recordErrand = { sourceId: 'tile-1', imageUrl: recordSource().imageUrl };

    cancelRecordErrand(person, 500);

    expect(person.recordErrand).toBeNull();
    expect(person.activity).toBe('idle');
    expect(person.activityUntil).toBe(500);
  });
});

describe('crawl bail-out', () => {
  it('flags a crawler as stuck when it never finds a stand-up spot', () => {
    const floor = collider({ id: 'floor', x: 0, y: 60, width: 120 });
    const ceiling = collider({ id: 'ceiling', x: 0, y: 46, width: 120 });
    const world = geometry({ colliders: [floor, ceiling], itemSources: [] });
    const spatial = new SpatialHash(world.colliders);
    const person = createPixelPerson(
      tinyPerson,
      body({ x: 4, supportId: floor.id }),
      0
    );
    person.activity = 'wander';
    person.activityUntil = 99_000;
    person.nextRecordAt = 99_000;
    person.goalX = 100;

    stepPixelPerson(person, world, spatial, [], 0.05, 50);
    expect(person.crawling).toBe(true);

    stepPixelPerson(person, world, spatial, [], 0.05, 5_000);
    expect(person.stuckForMs).toBeLessThan(STUCK_RECOVERY_MS);

    stepPixelPerson(person, world, spatial, [], 0.05, 13_000);
    expect(person.stuckForMs).toBeGreaterThanOrEqual(STUCK_RECOVERY_MS);
  });
});

describe('record discoverability', () => {
  it('drifts wander goals toward an off-level source when the cooldown is ripe', () => {
    // Source is far below the walking plane (not level-reachable), to the right.
    const source = recordSource({ x: 380, y: 400 });
    const world = geometry({ itemSources: [source] });
    const spatial = new SpatialHash(world.colliders);

    let wanders = 0;
    let toward = 0;
    for (let trial = 0; trial < 600; trial += 1) {
      const person = createPixelPerson(tinyPerson, body({ x: 40 }), 0);
      person.activityUntil = 0;
      person.nextRecordAt = 0;
      stepPixelPerson(person, world, spatial, [], 0.001, 50);
      expect(person.activity).not.toBe('seek-record');
      if (person.activity === 'wander') {
        wanders += 1;
        if (person.goalX > 40) toward += 1;
      }
    }
    // Unbiased wandering points toward the source 50% of the time; the 35%
    // drift bias lifts the expected share to ~67.5%.
    expect(wanders).toBeGreaterThan(300);
    expect(toward / wanders).toBeGreaterThan(0.58);
  });

  it('spawns prefer supports near item sources over equivalent ones elsewhere', () => {
    const left = collider({ id: 'plain', x: 0, y: 300, width: 200 });
    const right = collider({ id: 'near-wall', x: 300, y: 300, width: 200 });
    const world = geometry({
      colliders: [left, right],
      itemSources: [recordSource({ x: 320, y: 300, width: 96, height: 96 })]
    });

    const spawn = findSafeSpawn(world, tinyPerson, 0);
    expect(spawn.supportId).toBe('near-wall');
  });
});

describe('record artwork URLs', () => {
  it('rewrites the stored 640px cover hash to the 64px variant', () => {
    expect(smallCoverVariant('https://i.scdn.co/image/ab67616d0000b273ff9ca10b')).toBe(
      'https://i.scdn.co/image/ab67616d00004851ff9ca10b'
    );
  });

  it('leaves unknown urls untouched', () => {
    expect(smallCoverVariant('https://example.com/cover.jpg')).toBe(
      'https://example.com/cover.jpg'
    );
  });
});
