import { describe, expect, it } from 'vitest';
import { tinyPerson } from '../../src/lib/pixel-person/characters';
import { SpatialHash } from '../../src/lib/pixel-person/physics';
import { createPixelPerson, stepPixelPerson } from '../../src/lib/pixel-person/simulation';
import type {
  Collider,
  ItemSource,
  PhysicsBody,
  WorldGeometry
} from '../../src/lib/pixel-person/types';

function body(overrides: Partial<PhysicsBody> = {}): PhysicsBody {
  return {
    x: 10,
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
    scanBounds: { x: 0, y: 0, width: 500, height: 500 },
    viewportBounds: { x: 0, y: 0, width: 500, height: 500 },
    ...overrides
  };
}

describe('ladder climb-down rides', () => {
  const upperShelf = () => collider({ id: 'upper-shelf', x: 0, y: 60, width: 300 });
  const lowerShelf = () => collider({ id: 'lower-shelf', x: 0, y: 160, width: 300 });
  const ladder = (): Collider => ({
    id: 'ladder-1',
    kind: 'ladder',
    x: 148,
    y: 60,
    width: 4,
    height: 100
  });

  it('rides a planned ladder down and dismounts onto the shelf below', () => {
    const world = geometry({ colliders: [upperShelf(), lowerShelf(), ladder()] });
    const spatial = new SpatialHash(world.colliders);
    // Standing on the UPPER shelf, feet at y=60 (29 + body height 31), at the ladder's goal x.
    const person = createPixelPerson(
      tinyPerson,
      body({ x: 143, y: 29, supportId: 'upper-shelf' }),
      0
    );
    person.activity = 'wander';
    person.activityUntil = 99_000;
    person.goalX = 143;
    person.plannedLadder = { ladderId: 'ladder-1', goalX: 143, direction: 'down' };
    person.nextRecordAt = 999_000;
    person.nextHideAt = 999_000;

    stepPixelPerson(person, world, spatial, [], 0.05, 50);
    expect(person.activity).toBe('climb');
    expect(person.climb?.wall.id).toBe('ladder-1');
    expect(person.climb?.direction).toBe('down');
    expect(person.climb?.dismountY).toBe(160);
    expect(person.plannedLadder).toBeNull();

    let step = 2;
    while ((person.activity as string) === 'climb' && step < 200) {
      stepPixelPerson(person, world, spatial, [], 0.05, step * 50);
      step += 1;
    }
    expect(person.climb).toBeNull();

    // Physics takes over from the dismount and settles them on the shelf.
    let landing = 0;
    while (!person.body.grounded && landing < 20) {
      stepPixelPerson(person, world, spatial, [], 0.05, (step + landing) * 50);
      landing += 1;
    }

    expect(person.body.grounded).toBe(true);
    expect(person.body.y + person.body.height).toBeCloseTo(160, 0);
  });

  it('never plans a down ride on a ladder with nothing walkable at its bottom', () => {
    // Upper shelf and ladder only — the ladder dangles over nothing.
    const world = geometry({ colliders: [upperShelf(), ladder()] });
    const spatial = new SpatialHash(world.colliders);

    for (let trial = 0; trial < 60; trial += 1) {
      const person = createPixelPerson(
        tinyPerson,
        body({ x: 40, y: 29, supportId: 'upper-shelf' }),
        0
      );
      person.activityUntil = 0;
      person.nextRecordAt = 999_000;
      person.nextHideAt = 999_000;
      stepPixelPerson(person, world, spatial, [], 0.001, 50);
      expect(person.plannedLadder).toBeNull();
    }
  });

  it('refuses to start a planned descent when the walkable bottom has vanished', () => {
    const world = geometry({ colliders: [upperShelf(), ladder()] });
    const spatial = new SpatialHash(world.colliders);
    const person = createPixelPerson(
      tinyPerson,
      body({ x: 143, y: 29, supportId: 'upper-shelf' }),
      0
    );
    person.activity = 'wander';
    person.activityUntil = 99_000;
    person.goalX = 143;
    person.plannedLadder = { ladderId: 'ladder-1', goalX: 143, direction: 'down' };

    stepPixelPerson(person, world, spatial, [], 0.05, 50);

    expect(person.activity).not.toBe('climb');
    expect(person.climb).toBeNull();
    expect(person.plannedLadder).toBeNull();
  });

  it('keeps the peek-down behavior: a climb with returnY flips back up instead of dismounting', () => {
    const wall = collider({
      id: 'panel-wall',
      kind: 'border',
      edge: 'right',
      x: 200,
      y: 60,
      width: 4,
      height: 100
    });
    const world = geometry({ colliders: [wall, lowerShelf()] });
    const spatial = new SpatialHash(world.colliders);
    const person = createPixelPerson(
      tinyPerson,
      body({ x: 205, y: 60, grounded: false, supportId: null }),
      0
    );
    person.activity = 'climb';
    person.climb = { wall, top: wall, side: 'right', direction: 'down', returnY: 61 };

    stepPixelPerson(person, world, spatial, [], 0.05, 50);

    expect(person.climb).not.toBeNull();
    expect(person.climb?.direction).toBe('up');
    expect(person.climb?.returnY).toBeNull();
    expect(person.activity).toBe('climb');
  });
});

describe('errand-driven ladder routing', () => {
  const upperShelf = () => collider({ id: 'upper-shelf', x: 0, y: 60, width: 300 });
  const lowerShelf = () => collider({ id: 'lower-shelf', x: 0, y: 160, width: 300 });
  const ladder = (): Collider => ({
    id: 'ladder-1',
    kind: 'ladder',
    x: 148,
    y: 60,
    width: 4,
    height: 100
  });
  // Level-reachable from feet at y=60 (top within arrival slack) but not from
  // feet at y=160 — a record only the upper shelf can reach.
  const highSource = (): ItemSource => ({
    id: 'high-source',
    kind: 'record',
    imageUrl: 'high.png',
    x: 60,
    y: 20,
    width: 36,
    height: 36
  });
  // The mirror: level-reachable from feet at y=160 but not from y=60.
  const lowSource = (): ItemSource => ({
    id: 'low-source',
    kind: 'record',
    imageUrl: 'low.png',
    x: 60,
    y: 150,
    width: 36,
    height: 36
  });

  function errandPerson(overrides: Partial<PhysicsBody>) {
    const person = createPixelPerson(tinyPerson, body(overrides), 0);
    person.activityUntil = 0;
    person.nextRecordAt = 0;
    person.nextHideAt = 999_000;
    // Keeps the ambient ladder-ride chance on cooldown at now=50, so any
    // planned ladder must come from the deliberate errand route.
    person.lastClimbAt = 0;
    return person;
  }

  it('plans an up ride toward a source only reachable from the shelf above', () => {
    const world = geometry({
      colliders: [upperShelf(), lowerShelf(), ladder()],
      itemSources: [highSource()]
    });
    const spatial = new SpatialHash(world.colliders);
    // On the LOWER shelf, feet at y=160.
    const person = errandPerson({ x: 40, y: 129, supportId: 'lower-shelf' });

    stepPixelPerson(person, world, spatial, [], 0.05, 50);

    expect(person.activity).not.toBe('seek-record');
    expect(person.recordErrand).toBeNull();
    expect(person.plannedLadder?.ladderId).toBe('ladder-1');
    expect(person.plannedLadder?.direction).toBe('up');
    expect(person.nextRecordAt - 50).toBe(2_000);
  });

  it('plans a down ride toward a source only reachable from the shelf below', () => {
    const world = geometry({
      colliders: [upperShelf(), lowerShelf(), ladder()],
      itemSources: [lowSource()]
    });
    const spatial = new SpatialHash(world.colliders);
    // On the UPPER shelf, feet at y=60.
    const person = errandPerson({ x: 40, y: 29, supportId: 'upper-shelf' });

    stepPixelPerson(person, world, spatial, [], 0.05, 50);

    expect(person.plannedLadder?.ladderId).toBe('ladder-1');
    expect(person.plannedLadder?.direction).toBe('down');
    expect(person.nextRecordAt - 50).toBe(2_000);
  });

  it('falls back to the plain retry when no ladder connects to the source', () => {
    const world = geometry({
      colliders: [upperShelf(), lowerShelf()],
      itemSources: [highSource()]
    });
    const spatial = new SpatialHash(world.colliders);
    const person = errandPerson({ x: 40, y: 129, supportId: 'lower-shelf' });

    stepPixelPerson(person, world, spatial, [], 0.05, 50);

    expect(person.plannedLadder).toBeNull();
    expect(person.nextRecordAt - 50).toBe(6_000);
  });

  it('prefers a level-reachable source over routing toward an off-level one', () => {
    const world = geometry({
      colliders: [upperShelf(), lowerShelf(), ladder()],
      itemSources: [highSource(), lowSource()]
    });
    const spatial = new SpatialHash(world.colliders);
    const person = errandPerson({ x: 40, y: 129, supportId: 'lower-shelf' });

    stepPixelPerson(person, world, spatial, [], 0.05, 50);

    expect(person.activity).toBe('seek-record');
    expect(person.recordErrand?.sourceId).toBe('low-source');
    expect(person.plannedLadder).toBeNull();
  });

  it('rides the ladder up and ends up carrying the off-level record', () => {
    const world = geometry({
      colliders: [upperShelf(), lowerShelf(), ladder()],
      itemSources: [highSource()]
    });
    const spatial = new SpatialHash(world.colliders);
    const person = errandPerson({ x: 40, y: 129, supportId: 'lower-shelf' });

    // Route -> walk -> ride -> re-plan on the upper shelf -> seek -> stoop.
    const allowed = ['wander', 'idle', 'climb', 'mantle', 'seek-record', 'record-stoop'];
    let step = 1;
    while (!person.carrying && step <= 400) {
      stepPixelPerson(person, world, spatial, [], 0.05, step * 50);
      expect(allowed).toContain(person.activity as string);
      step += 1;
    }

    expect(person.carrying?.sourceId).toBe('high-source');
  });
});
