import { describe, expect, it, vi } from 'vitest';
import { tinyPerson } from '../../src/lib/pixel-person/characters';
import { bridgeWalkableTops, findSafeSpawn } from '../../src/lib/pixel-person/geometry';
import { SpatialHash, stepPhysics } from '../../src/lib/pixel-person/physics';
import { smallCoverVariant } from '../../src/lib/pixel-person/record-art';
import {
  beginPixelPersonDrag,
  cancelRecordErrand,
  createPixelPerson,
  dropCarriedRecord,
  RECORD_ERRAND,
  stepPixelPerson,
  STROLL_PHYSICS_CONFIG,
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
    artistPresences: [],
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

    // Long enough to amble the whole row at the stroll gear, plus slack for the
    // acceleration ramp — derived so a future speed change doesn't break this.
    const steps =
      Math.ceil((260 - 4) / (STROLL_PHYSICS_CONFIG.walkSpeed * 0.05)) + 40;
    for (let step = 1; step <= steps; step += 1) {
      stepPixelPerson(person, world, spatial, 0.05, step * 50);
      expect(person.body.grounded).toBe(true);
      expect(person.body.vy).toBe(0);
    }

    expect(person.body.x).toBeGreaterThan(200);
    expect(person.stuckForMs).toBe(0);
  });
});

/**
 * Drives a person standing at their target tile through browse -> stoop ->
 * carrying, and returns the timestamp at which they are holding the record.
 * Times come from RECORD_ERRAND so retuning the beats cannot silently strand
 * these tests on stale constants.
 */
function completePickup(
  person: ReturnType<typeof createPixelPerson>,
  world: WorldGeometry,
  spatial: SpatialHash,
  arrivedAt: number
): number {
  stepPixelPerson(person, world, spatial, 0.05, arrivedAt);
  const stoopAt =
    arrivedAt + RECORD_ERRAND.browseMinMs + RECORD_ERRAND.browseJitterMs + 1;
  stepPixelPerson(person, world, spatial, 0.05, stoopAt);
  const carriedAt = stoopAt + RECORD_ERRAND.stoopMs + 1;
  stepPixelPerson(person, world, spatial, 0.05, carriedAt);
  return carriedAt;
}

describe('pixel person record errands', () => {
  it('plans an errand toward a reachable cover once the cooldown elapses', () => {
    // Standing on the shelf under the tile row: body overlaps the source.
    const world = geometry({ colliders: [collider({ y: 130 })] });
    const person = createPixelPerson(tinyPerson, body({ y: 99 }), 0);
    person.activity = 'idle';
    person.activityUntil = 0;
    person.nextRecordAt = 0;

    stepPixelPerson(person, world, new SpatialHash(world.colliders), 0.05, 50);

    expect(person.activity).toBe('seek-record');
    expect(person.recordErrand?.sourceId).toBe('tile-1');
    expect(person.goalX).toBe(100 + 96 / 2 - 14 / 2);
    expect(person.nextRecordAt).toBeGreaterThanOrEqual(50 + RECORD_ERRAND.cooldownMs);
  });

  it('never targets a record on the row below the walking level', () => {
    // Standing on the shelf of the y=60 row; a nearer source sits a row down.
    const sameRow = recordSource({ id: 'same-row', x: 200 });
    const rowBelow = recordSource({ id: 'row-below', x: 30, y: 150 });
    const world = geometry({
      colliders: [collider({ y: 130 })],
      itemSources: [sameRow, rowBelow]
    });
    const person = createPixelPerson(tinyPerson, body({ y: 99 }), 0);
    person.activityUntil = 0;
    person.nextRecordAt = 0;

    stepPixelPerson(person, world, new SpatialHash(world.colliders), 0.05, 50);

    expect(person.recordErrand?.sourceId).toBe('same-row');
  });

  it('cannot grab a record from a perch above its tile', () => {
    // Feet exactly at the tile top (standing above the row) — not same-row.
    const world = geometry();
    const person = createPixelPerson(tinyPerson, body(), 0);
    person.activityUntil = 0;
    person.nextRecordAt = 0;

    stepPixelPerson(person, world, new SpatialHash(world.colliders), 0.05, 50);

    expect(person.recordErrand).toBeNull();
    expect(person.activity).not.toBe('seek-record');
  });

  it('prefers a record errand over planning a climb from a solid support', () => {
    const panel = collider({
      id: 'panel',
      kind: 'solid',
      edge: undefined,
      x: 0,
      y: 130,
      width: 200,
      height: 90
    });
    const world = geometry({ colliders: [panel] });
    const person = createPixelPerson(tinyPerson, body({ y: 99, supportId: 'panel' }), 0);
    person.activity = 'idle';
    person.activityUntil = 0;
    person.nextRecordAt = 0;

    stepPixelPerson(person, world, new SpatialHash([panel]), 0.05, 50);

    expect(person.activity).toBe('seek-record');
    expect(person.plannedClimb).toBeNull();
  });

  it('arrives, browses, stoops with the crouch animation, and starts carrying', () => {
    const world = geometry({ colliders: [collider({ y: 130 })] });
    const person = createPixelPerson(tinyPerson, body({ x: 141, y: 99 }), 0);
    person.activity = 'seek-record';
    person.activityUntil = 10_000;
    person.recordErrand = { sourceId: 'tile-1', imageUrl: recordSource().imageUrl };
    const spatial = new SpatialHash(world.colliders);

    // Arrival opens on a browse beat: stood at the shelf, still empty-handed.
    stepPixelPerson(person, world, spatial, 0.05, 100);
    expect(person.activity).toBe('record-browse');
    expect(person.animation).toBe('idle');
    expect(person.body.vx).toBe(0);
    expect(person.carrying).toBeNull();

    const stoopAt = 100 + RECORD_ERRAND.browseMinMs + RECORD_ERRAND.browseJitterMs + 1;
    stepPixelPerson(person, world, spatial, 0.05, stoopAt);
    expect(person.activity).toBe('record-stoop');
    expect(person.animation).toBe('hide');
    expect(person.carrying).toBeNull();

    const carriedAt = stoopAt + RECORD_ERRAND.stoopMs + 1;
    stepPixelPerson(person, world, spatial, 0.05, carriedAt);
    expect(person.carrying?.sourceId).toBe('tile-1');
    expect(person.carrying!.putDownAt - carriedAt).toBeGreaterThanOrEqual(
      RECORD_ERRAND.carryMinMs
    );
    expect(person.carrying!.putDownAt - carriedAt).toBeLessThanOrEqual(
      RECORD_ERRAND.carryMinMs + RECORD_ERRAND.carryJitterMs
    );
    expect(Number.isFinite(person.carrying!.deliverGoalX)).toBe(true);
    expect(person.recentRecordSourceIds).toContain('tile-1');
    expect(person.recordErrand).toBeNull();
    expect(person.activity).toBe('idle');
  });

  it('cancels the errand when a rescan removes the source tile', () => {
    const world = geometry({ itemSources: [] });
    const person = createPixelPerson(tinyPerson, body(), 0);
    person.activity = 'seek-record';
    person.activityUntil = 10_000;
    person.recordErrand = { sourceId: 'tile-1', imageUrl: recordSource().imageUrl };

    stepPixelPerson(person, world, new SpatialHash(world.colliders), 0.05, 50);

    expect(person.recordErrand).toBeNull();
    expect(person.activity).not.toBe('seek-record');
  });

  it('sits down to listen after delivering, then sets the record down where it fell', () => {
    const world = geometry();
    const spatial = new SpatialHash(world.colliders);
    const events: PixelWorldEvent[] = [];
    const person = createPixelPerson(tinyPerson, body(), 0);
    person.activity = 'idle';
    person.activityUntil = 99_000;
    person.carrying = {
      sourceId: 'tile-1',
      imageUrl: recordSource().imageUrl,
      putDownAt: 0,
      deliverGoalX: 400
    };

    stepPixelPerson(person, world, spatial, 0.05, 100, events);
    expect(person.activity).toBe('listen');
    expect(person.animation).toBe('listen');
    expect(person.body.vx).toBe(0);
    expect(person.listen!.until - 100).toBeGreaterThanOrEqual(RECORD_ERRAND.listenMinMs);
    expect(person.listen!.until - 100).toBeLessThanOrEqual(
      RECORD_ERRAND.listenMinMs + RECORD_ERRAND.listenJitterMs
    );
    expect(person.carrying).not.toBeNull();

    // Still listening mid-session; nothing placed yet.
    stepPixelPerson(person, world, spatial, 0.05, 4_000, events);
    expect(person.activity).toBe('listen');
    expect(events).toHaveLength(0);

    // Session over -> stoop -> place.
    const stoopAt = 100 + RECORD_ERRAND.listenMinMs + RECORD_ERRAND.listenJitterMs + 1;
    stepPixelPerson(person, world, spatial, 0.05, stoopAt, events);
    expect(person.activity).toBe('record-stoop');

    const placedAt = stoopAt + RECORD_ERRAND.stoopMs + 1;
    stepPixelPerson(person, world, spatial, 0.05, placedAt, events);
    expect(person.carrying).toBeNull();
    expect(person.nextRecordAt - placedAt).toBeGreaterThanOrEqual(RECORD_ERRAND.returnDelayMs);
    expect(person.nextRecordAt - placedAt).toBeLessThanOrEqual(
      RECORD_ERRAND.returnDelayMs + RECORD_ERRAND.returnJitterMs
    );
    // After placing he strolls back toward the middle instead of camping.
    expect(person.activity).toBe('wander');
    expect(person.goalX).toBeGreaterThanOrEqual(150);
    expect(person.goalX).toBeLessThanOrEqual(350);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'record-dropped',
      record: {
        sourceId: 'tile-1',
        position: { x: person.body.x + person.body.width / 2, y: person.body.y + person.body.height }
      }
    });
  });

  it('completes the listen-and-place flow without an events array without throwing', () => {
    const world = geometry();
    const spatial = new SpatialHash(world.colliders);
    const person = createPixelPerson(tinyPerson, body(), 0);
    person.activity = 'idle';
    person.activityUntil = 99_000;
    person.carrying = {
      sourceId: 'tile-1',
      imageUrl: recordSource().imageUrl,
      putDownAt: 0,
      deliverGoalX: 400
    };

    const stoopAt = 100 + RECORD_ERRAND.listenMinMs + RECORD_ERRAND.listenJitterMs + 1;
    stepPixelPerson(person, world, spatial, 0.05, 100);
    stepPixelPerson(person, world, spatial, 0.05, stoopAt);
    stepPixelPerson(person, world, spatial, 0.05, stoopAt + RECORD_ERRAND.stoopMs + 1);

    expect(person.carrying).toBeNull();
  });

  it('a grab interrupts a listening session cleanly', () => {
    const person = createPixelPerson(tinyPerson, body(), 0);
    person.carrying = {
      sourceId: 'tile-1',
      imageUrl: recordSource().imageUrl,
      putDownAt: 0,
      deliverGoalX: 400
    };
    person.activity = 'listen';
    person.listen = { startedAt: 0, until: 99_000 };

    dropCarriedRecord(person);
    beginPixelPersonDrag(person, 7, { x: 20, y: 20 }, 10);

    expect(person.activity).toBe('drag');
    expect(person.listen).toBeNull();
    expect(person.carrying).toBeNull();
  });

  it('will not set a record down inside the wall; it marches toward the delivery goal', () => {
    const world = geometry();
    const spatial = new SpatialHash(world.colliders);
    // Body overlapping the wall's box, like standing on an interior shelf.
    const person = createPixelPerson(tinyPerson, body({ x: 120, y: 70 }), 0);
    person.activityUntil = 0;
    person.nextRecordAt = 99_000;
    person.carrying = {
      sourceId: 'tile-1',
      imageUrl: recordSource().imageUrl,
      putDownAt: 0,
      deliverGoalX: 460
    };

    stepPixelPerson(person, world, spatial, 0.05, 50);

    expect(person.activity).toBe('wander');
    expect(person.carrying).not.toBeNull();
    expect(person.goalX).toBe(460);
    expect(person.facing).toBe(1);
  });

  it('gives up and settles in place to listen when leaving the wall takes too long', () => {
    const world = geometry();
    const spatial = new SpatialHash(world.colliders);
    const person = createPixelPerson(tinyPerson, body({ x: 120 }), 0);
    person.activityUntil = 0;
    person.nextRecordAt = 99_000;
    person.carrying = {
      sourceId: 'tile-1',
      imageUrl: recordSource().imageUrl,
      putDownAt: -25_000,
      deliverGoalX: 460
    };

    stepPixelPerson(person, world, spatial, 0.05, 50);

    expect(person.activity).toBe('listen');
  });

  it('avoids albums fetched recently when there is a fresh alternative', () => {
    const world = geometry({
      colliders: [collider({ y: 130 })],
      itemSources: [recordSource(), recordSource({ id: 'tile-2', x: 210 })]
    });
    const person = createPixelPerson(tinyPerson, body({ y: 99 }), 0);
    person.activityUntil = 0;
    person.nextRecordAt = 0;
    person.recentRecordSourceIds = ['tile-1'];

    stepPixelPerson(person, world, new SpatialHash(world.colliders), 0.05, 50);

    expect(person.activity).toBe('seek-record');
    expect(person.recordErrand?.sourceId).toBe('tile-2');
  });

  it('falls back to a repeat when everything nearby is recent', () => {
    const world = geometry({ colliders: [collider({ y: 130 })] });
    const person = createPixelPerson(tinyPerson, body({ y: 99 }), 0);
    person.activityUntil = 0;
    person.nextRecordAt = 0;
    person.recentRecordSourceIds = ['tile-1'];

    stepPixelPerson(person, world, new SpatialHash(world.colliders), 0.05, 50);

    expect(person.recordErrand?.sourceId).toBe('tile-1');
  });

  it('caps the recent-album memory at its window size', () => {
    const world = geometry({ colliders: [collider({ y: 130 })] });
    const spatial = new SpatialHash(world.colliders);
    const person = createPixelPerson(tinyPerson, body({ x: 141, y: 99 }), 0);
    person.activity = 'seek-record';
    person.activityUntil = 99_000;
    person.recordErrand = { sourceId: 'tile-1', imageUrl: recordSource().imageUrl };
    person.recentRecordSourceIds = ['a', 'b', 'c', 'd', 'e', 'f'];

    completePickup(person, world, spatial, 100);

    expect(person.recentRecordSourceIds).toHaveLength(6);
    expect(person.recentRecordSourceIds[0]).toBe('b');
    expect(person.recentRecordSourceIds[5]).toBe('tile-1');
  });

  it('chooses delivery goals away from the viewport corners even for a full-width wall', () => {
    const wide = recordSource({ id: 'wall', x: 0, width: 500 });
    const world = geometry({ colliders: [collider({ y: 130 })], itemSources: [wide] });
    const spatial = new SpatialHash(world.colliders);
    for (let trial = 0; trial < 30; trial += 1) {
      const person = createPixelPerson(tinyPerson, body({ x: 243, y: 99 }), 0);
      person.activity = 'seek-record';
      person.activityUntil = 99_000;
      person.recordErrand = { sourceId: 'wall', imageUrl: wide.imageUrl };

      completePickup(person, world, spatial, 100);

      expect(person.carrying).not.toBeNull();
      expect(person.carrying!.deliverGoalX).toBeGreaterThanOrEqual(16);
      expect(person.carrying!.deliverGoalX).toBeLessThanOrEqual(500 - 14 - 16);
    }
  });

  it('bails out of a terminal corner pocket via stuck recovery', () => {
    const floor = collider({ id: 'pocket-floor', x: 0, y: 60, width: 60 });
    const wallLeft = collider({ id: 'pocket-left', x: -4, y: -200, width: 4, height: 260 });
    const wallRight = collider({ id: 'pocket-right', x: 60, y: -200, width: 4, height: 260 });
    const world = geometry({ colliders: [floor, wallLeft, wallRight], itemSources: [] });
    const spatial = new SpatialHash(world.colliders);
    const person = createPixelPerson(tinyPerson, body({ x: 20, supportId: floor.id }), 0);
    person.activity = 'wander';
    person.activityUntil = 4_000;
    person.goalX = 300;
    person.nextRecordAt = 999_000;
    person.nextHideAt = 999_000;

    let bailedAtMs: number | null = null;
    for (let step = 1; step <= 500; step += 1) {
      stepPixelPerson(person, world, spatial, 0.05, step * 50);
      if (person.stuckForMs >= STUCK_RECOVERY_MS) {
        bailedAtMs = step * 50;
        break;
      }
    }

    expect(bailedAtMs).not.toBeNull();
    expect(bailedAtMs!).toBeLessThanOrEqual(20_000);
  });

  it('never hides while carrying a record', () => {
    const occluder = { id: 'panel:occluder', groupId: 'panel', x: 60, y: 30, width: 120, height: 60 };
    const world = geometry({ occluders: [occluder], itemSources: [] });
    const spatial = new SpatialHash(world.colliders);

    const carrier = createPixelPerson(tinyPerson, body(), 0);
    carrier.activityUntil = 0;
    carrier.nextHideAt = 0;
    carrier.carrying = {
      sourceId: 'tile-1',
      imageUrl: recordSource().imageUrl,
      putDownAt: 99_000,
      deliverGoalX: 400
    };
    stepPixelPerson(carrier, world, spatial, 0.05, 50);
    expect(carrier.activity).not.toBe('seek-hide');

    const idler = createPixelPerson(tinyPerson, body(), 0);
    idler.activityUntil = 0;
    idler.nextHideAt = 0;
    stepPixelPerson(idler, world, spatial, 0.05, 50);
    expect(idler.activity).toBe('seek-hide');
  });

  it('drops the carried record in place when grabbed', () => {
    const person = createPixelPerson(tinyPerson, body(), 0);
    person.carrying = {
      sourceId: 'tile-1',
      imageUrl: recordSource().imageUrl,
      putDownAt: 99_000,
      deliverGoalX: 400
    };
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

    stepPixelPerson(person, world, spatial, 0.05, 50);
    expect(person.crawling).toBe(true);

    stepPixelPerson(person, world, spatial, 0.05, 5_000);
    expect(person.stuckForMs).toBeLessThan(STUCK_RECOVERY_MS);

    stepPixelPerson(person, world, spatial, 0.05, 13_000);
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
      stepPixelPerson(person, world, spatial, 0.001, 50);
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

describe('invisible ladders', () => {
  const lowerShelf = () => collider({ id: 'lower-shelf', x: 0, y: 160, width: 300 });
  const upperShelf = () => collider({ id: 'upper-shelf', x: 0, y: 60, width: 300 });
  const ladder = (): Collider => ({
    id: 'ladder-1',
    kind: 'ladder',
    x: 148,
    y: 60,
    width: 4,
    height: 100
  });

  it('never blocks horizontal movement', () => {
    const floor = collider({ id: 'floor', x: 0, y: 60, width: 400 });
    const rungs = { ...ladder(), x: 100, y: -40 };
    const result = stepPhysics(
      { x: 90, y: 30, width: 14, height: 30, vx: 42, vy: 0, grounded: true, supportId: 'floor' },
      { moveX: 1, jump: false },
      [floor, rungs],
      1 / 20
    );

    expect(result.contacts.right).toBeNull();
    expect(result.body.x).toBeGreaterThan(90);
  });

  it('climbs a planned ladder up to the shelf above', () => {
    const world = geometry({
      colliders: [lowerShelf(), upperShelf(), ladder()],
      itemSources: []
    });
    const spatial = new SpatialHash(world.colliders);
    const person = createPixelPerson(
      tinyPerson,
      body({ x: 143, y: 129, supportId: 'lower-shelf' }),
      0
    );
    person.activity = 'wander';
    person.activityUntil = 99_000;
    person.goalX = 143;
    person.plannedLadder = { ladderId: 'ladder-1', goalX: 143 };
    person.nextRecordAt = 999_000;
    person.nextHideAt = 999_000;

    stepPixelPerson(person, world, spatial, 0.05, 50);
    expect(person.activity).toBe('climb');
    expect(person.climb?.wall.id).toBe('ladder-1');

    let step = 2;
    while (
      ((person.activity as string) === 'climb' || (person.activity as string) === 'mantle') &&
      step < 200
    ) {
      stepPixelPerson(person, world, spatial, 0.05, step * 50);
      step += 1;
    }

    expect(person.body.grounded).toBe(true);
    expect(person.body.y + person.body.height).toBeCloseTo(60, 0);
  });

  it('refuses a ladder with nothing walkable at its top', () => {
    const world = geometry({ colliders: [lowerShelf(), ladder()], itemSources: [] });
    const spatial = new SpatialHash(world.colliders);
    const person = createPixelPerson(
      tinyPerson,
      body({ x: 143, y: 129, supportId: 'lower-shelf' }),
      0
    );
    person.activity = 'wander';
    person.activityUntil = 99_000;
    person.goalX = 143;
    person.plannedLadder = { ladderId: 'ladder-1', goalX: 143 };

    stepPixelPerson(person, world, spatial, 0.05, 50);

    expect(person.activity).not.toBe('climb');
    expect(person.plannedLadder).toBeNull();
  });

  it('plans ladder climbs from the ambient activity loop', () => {
    const world = geometry({
      colliders: [lowerShelf(), upperShelf(), ladder()],
      itemSources: []
    });
    const spatial = new SpatialHash(world.colliders);

    let planned = false;
    for (let trial = 0; trial < 60 && !planned; trial += 1) {
      const person = createPixelPerson(
        tinyPerson,
        body({ x: 40, y: 129, supportId: 'lower-shelf' }),
        0
      );
      person.activityUntil = 0;
      person.nextRecordAt = 999_000;
      person.nextHideAt = 999_000;
      stepPixelPerson(person, world, spatial, 0.001, 50);
      if (person.plannedLadder?.ladderId === 'ladder-1') planned = true;
    }

    expect(planned).toBe(true);
  });
});

describe('artist record affinity', () => {
  const frank = { ...tinyPerson, id: 'artist-frank-ocean', artistKey: 'frank ocean' };

  it('walks past a nearer cover to reach its own artist', () => {
    const nearOther = recordSource({ id: 'near-other', x: 60, artistName: 'Someone Else' });
    const farOwn = recordSource({ id: 'far-own', x: 220, artistName: 'Frank Ocean' });
    const world = geometry({
      colliders: [collider({ y: 130 })],
      itemSources: [nearOther, farOwn]
    });
    const person = createPixelPerson(frank, body({ y: 99 }), 0);
    person.activityUntil = 0;
    person.nextRecordAt = 0;

    stepPixelPerson(person, world, new SpatialHash(world.colliders), 0.05, 50);

    expect(person.recordErrand?.sourceId).toBe('far-own');
  });

  it('matches the artist name regardless of case and punctuation', () => {
    const own = recordSource({ id: 'own', x: 220, artistName: '  FRANK  OCEAN ' });
    const other = recordSource({ id: 'other', x: 60, artistName: 'Someone Else' });
    const world = geometry({
      colliders: [collider({ y: 130 })],
      itemSources: [other, own]
    });
    const person = createPixelPerson(frank, body({ y: 99 }), 0);
    person.activityUntil = 0;
    person.nextRecordAt = 0;

    stepPixelPerson(person, world, new SpatialHash(world.colliders), 0.05, 50);

    expect(person.recordErrand?.sourceId).toBe('own');
  });

  it('falls back to the nearest source for a character with no artist key', () => {
    // With no artistKey the `own` filter stays empty and the pool is exactly
    // what it was pre-affinity: the nearest candidates, picked at random.
    // With two candidates that pick is a coin flip, so pin it to index 0 —
    // the nearest one, since the pool is distance-sorted — to assert the
    // fallback ordering itself rather than getting lucky on the random draw.
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const nearOther = recordSource({ id: 'near-other', x: 60, artistName: 'Someone Else' });
      const farOwn = recordSource({ id: 'far-own', x: 220, artistName: 'Frank Ocean' });
      const world = geometry({
        colliders: [collider({ y: 130 })],
        itemSources: [nearOther, farOwn]
      });
      const person = createPixelPerson(tinyPerson, body({ y: 99 }), 0);
      person.activityUntil = 0;
      person.nextRecordAt = 0;

      stepPixelPerson(person, world, new SpatialHash(world.colliders), 0.05, 50);

      expect(person.recordErrand?.sourceId).toBe('near-other');
    } finally {
      random.mockRestore();
    }
  });

  it('takes someone else’s record when its own was carried recently', () => {
    const own = recordSource({ id: 'own', x: 220, artistName: 'Frank Ocean' });
    const other = recordSource({ id: 'other', x: 60, artistName: 'Someone Else' });
    const world = geometry({
      colliders: [collider({ y: 130 })],
      itemSources: [own, other]
    });
    const person = createPixelPerson(frank, body({ y: 99 }), 0);
    person.activityUntil = 0;
    person.nextRecordAt = 0;
    person.recentRecordSourceIds = ['own'];

    stepPixelPerson(person, world, new SpatialHash(world.colliders), 0.05, 50);

    expect(person.recordErrand?.sourceId).toBe('other');
  });

  it('ignores untagged sources rather than treating them as a match', () => {
    const untagged = recordSource({ id: 'untagged', x: 60 });
    const own = recordSource({ id: 'own', x: 220, artistName: 'Frank Ocean' });
    const world = geometry({
      colliders: [collider({ y: 130 })],
      itemSources: [untagged, own]
    });
    const person = createPixelPerson(frank, body({ y: 99 }), 0);
    person.activityUntil = 0;
    person.nextRecordAt = 0;

    stepPixelPerson(person, world, new SpatialHash(world.colliders), 0.05, 50);

    expect(person.recordErrand?.sourceId).toBe('own');
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
