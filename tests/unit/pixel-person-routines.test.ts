import { describe, expect, it } from 'vitest';
import { tinyPerson } from '../../src/lib/pixel-person/characters';
import { SpatialHash } from '../../src/lib/pixel-person/physics';
import { spriteTimeScale, REFERENCE_WALK_SPEED } from '../../src/lib/pixel-person/sprite';
import {
  createPixelPerson,
  PURPOSEFUL_PHYSICS_CONFIG,
  RECORD_ERRAND,
  stepPixelPerson,
  STROLL_PHYSICS_CONFIG,
  walkConfigFor
} from '../../src/lib/pixel-person/simulation';
import type {
  Collider,
  PhysicsBody,
  WorldGeometry
} from '../../src/lib/pixel-person/types';

function body(overrides: Partial<PhysicsBody> = {}): PhysicsBody {
  return {
    x: 250,
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
    // Comfortably wider than the longest leg a routine plans, so the edge
    // clamp does not become the thing under test.
    width: 2_400,
    height: 2,
    ...overrides
  };
}

/**
 * Wide open floor with nothing to climb, hide behind or pick up, so the only
 * thing driving the person is their routine.
 */
function geometry(overrides: Partial<WorldGeometry> = {}): WorldGeometry {
  return {
    colliders: [collider()],
    occluders: [],
    itemSources: [],
    artistPresences: [],
    scanBounds: { x: 0, y: 0, width: 2_400, height: 400 },
    viewportBounds: { x: 0, y: 0, width: 2_400, height: 400 },
    ...overrides
  };
}

/** An ambient wanderer with every interrupt pushed out of the way. */
function wanderer() {
  const person = createPixelPerson(tinyPerson, body(), 0);
  person.nextRecordAt = 9_000_000;
  person.nextHideAt = 9_000_000;
  person.lastClimbAt = 0;
  person.activityUntil = 0;
  return person;
}

/** A wanderer standing in the middle of the given world's floor. */
function wandererIn(world: WorldGeometry) {
  const person = wanderer();
  person.body.x = world.scanBounds.x + world.scanBounds.width / 2;
  return person;
}

const STEP_MS = 50;
const STEP_SECONDS = STEP_MS / 1000;

/**
 * A stepper that owns its clock, so successive runs against the same person
 * keep moving time forward instead of restarting it.
 */
function driver(
  person: ReturnType<typeof createPixelPerson>,
  world: WorldGeometry,
  spatial: SpatialHash
) {
  let now = 0;
  return {
    person,
    now: () => now,
    step(): void {
      now += STEP_MS;
      stepPixelPerson(person, world, spatial, STEP_SECONDS, now);
    },
    run(steps: number, onStep?: () => void): void {
      for (let step = 1; step <= steps; step += 1) {
        this.step();
        onStep?.();
      }
    },
    /** Steps until `done` or the budget runs out; true when `done` was met. */
    until(budget: number, done: () => boolean): boolean {
      for (let step = 1; step <= budget; step += 1) {
        this.step();
        if (done()) return true;
      }
      return false;
    }
  };
}

describe('routine commitment', () => {
  it('holds a travel goal for the whole leg instead of re-rolling it', () => {
    const world = geometry();
    const drive = driver(wandererIn(world), world, new SpatialHash(world.colliders));
    const person = drive.person;

    // First step plans the routine and applies its opening travel beat.
    drive.step();
    expect(person.activity).toBe('wander');
    const committedGoal = person.goalX;
    const startX = person.body.x;
    expect(Math.abs(committedGoal - startX)).toBeGreaterThan(0);

    // Walk most of the way there; the goal must not move under them.
    const stepsToArrive = Math.floor(
      Math.abs(committedGoal - startX) / (STROLL_PHYSICS_CONFIG.walkSpeed * STEP_SECONDS)
    );
    let changed = false;
    drive.run(Math.max(1, stepsToArrive - 3), () => {
      if (person.goalX !== committedGoal) changed = true;
    });

    expect(changed).toBe(false);
    expect(person.activity).toBe('wander');
  });

  it('pauses on arrival rather than immediately setting off again', () => {
    const world = geometry();
    const drive = driver(wandererIn(world), world, new SpatialHash(world.colliders));
    const person = drive.person;

    drive.step();
    const distance = Math.abs(person.goalX - person.body.x);
    // Generous budget: the whole leg plus the acceleration ramp.
    const budget =
      Math.ceil(distance / (STROLL_PHYSICS_CONFIG.walkSpeed * STEP_SECONDS)) + 60;

    expect(drive.until(budget, () => person.activity === 'idle')).toBe(true);
    expect(person.goalX).toBe(person.body.x);

    // The pause is a real beat, not a single frame of stillness: a second
    // later they are still standing there, stopped, in the idle animation.
    drive.run(20);
    expect(person.activity).toBe('idle');
    expect(person.animation).toBe('idle');
    expect(Math.abs(person.body.vx)).toBeLessThan(1);
  });

  it('spends more of its time still than walking', () => {
    const world = geometry();
    const drive = driver(wandererIn(world), world, new SpatialHash(world.colliders));
    const person = drive.person;

    let still = 0;
    let walking = 0;
    // Ten minutes of simulated time — dozens of routines — so the ratio
    // reflects the beat mix rather than whichever beat happened to open.
    const steps = 12_000;
    drive.run(steps, () => {
      if (person.activity === 'idle') still += 1;
      else walking += 1;
    });

    expect(still + walking).toBe(steps);
    expect(still).toBeGreaterThan(walking);
  });

  it('never doubles back without standing still first', () => {
    // This is the complaint routines exist to fix. Not that people turn
    // around — that they used to do it mid-stride, on the spot, over and over.
    // On open floor with nothing to bump into, a change of heading must always
    // come out of a pause beat, never out of a walk already in progress.
    const world = geometry();
    const drive = driver(wandererIn(world), world, new SpatialHash(world.colliders));
    const person = drive.person;

    let heading = 0;
    let stillSinceLastMove = true;
    let flips = 0;
    let flipsFromAStandingStart = 0;

    drive.run(6_000, () => {
      if (person.activity === 'idle') stillSinceLastMove = true;
      // Same threshold the walk animation uses, so deceleration drift around
      // zero is not mistaken for a change of heart.
      if (Math.abs(person.body.vx) <= 3) return;
      const direction = person.body.vx > 0 ? 1 : -1;
      if (heading !== 0 && direction !== heading) {
        flips += 1;
        if (stillSinceLastMove) flipsFromAStandingStart += 1;
      }
      heading = direction;
      stillSinceLastMove = false;
    });

    expect(flips).toBeGreaterThan(5);
    expect(flipsFromAStandingStart).toBe(flips);
  });
});

describe('walking gears', () => {
  it('walks purposefully on an errand and ambles otherwise', () => {
    const person = wanderer();

    expect(walkConfigFor(person)).toBe(STROLL_PHYSICS_CONFIG);

    person.activity = 'seek-record';
    expect(walkConfigFor(person)).toBe(PURPOSEFUL_PHYSICS_CONFIG);

    person.activity = 'wander';
    person.carrying = {
      sourceId: 'tile-1',
      imageUrl: 'https://i.scdn.co/image/x',
      putDownAt: 99_000,
      deliverGoalX: 300
    };
    expect(walkConfigFor(person)).toBe(PURPOSEFUL_PHYSICS_CONFIG);
  });

  it('keeps the committed gear while airborne so hops still clear gaps', () => {
    const person = wanderer();
    person.body.grounded = false;

    expect(walkConfigFor(person)).toBe(PURPOSEFUL_PHYSICS_CONFIG);
  });

  it('ambles slower than it walks with intent', () => {
    expect(STROLL_PHYSICS_CONFIG.walkSpeed).toBeLessThan(
      PURPOSEFUL_PHYSICS_CONFIG.walkSpeed
    );
  });

  it('never walks a body further than its gear allows', () => {
    const world = geometry();
    const drive = driver(wandererIn(world), world, new SpatialHash(world.colliders));
    const person = drive.person;

    let fastest = 0;
    drive.run(1_500, () => {
      if (person.body.grounded) fastest = Math.max(fastest, Math.abs(person.body.vx));
    });

    expect(fastest).toBeGreaterThan(0);
    expect(fastest).toBeLessThanOrEqual(PURPOSEFUL_PHYSICS_CONFIG.walkSpeed);
  });
});

describe('errand timing invariants', () => {
  // The failure this guards against is silent: shrink the walk speed without
  // touching the timeouts and people abandon errands mid-walk instead of
  // arriving, which reads as flakiness rather than a bug.
  it('allows enough time to walk the longest errand it will plan', () => {
    const seconds = RECORD_ERRAND.maxTravelDistance / PURPOSEFUL_PHYSICS_CONFIG.walkSpeed;
    expect(RECORD_ERRAND.travelTimeoutMs).toBeGreaterThan(seconds * 1_000 * 1.2);
  });

  it('allows enough time to carry a record clear of the widest wall', () => {
    const seconds = RECORD_ERRAND.maxTravelDistance / PURPOSEFUL_PHYSICS_CONFIG.walkSpeed;
    expect(RECORD_ERRAND.deliverTimeoutMs).toBeGreaterThan(seconds * 1_000 * 1.2);
  });

  it('finishes browsing and stooping well inside the delivery window', () => {
    const pickup =
      RECORD_ERRAND.browseMinMs + RECORD_ERRAND.browseJitterMs + RECORD_ERRAND.stoopMs;
    expect(pickup).toBeLessThan(RECORD_ERRAND.carryMinMs);
  });
});

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
