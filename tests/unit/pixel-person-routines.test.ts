import { afterEach, describe, expect, it, vi } from 'vitest';
import { tinyPerson } from '../../src/lib/pixel-person/characters';
import { SpatialHash } from '../../src/lib/pixel-person/physics';
import { spriteTimeScale, REFERENCE_WALK_SPEED } from '../../src/lib/pixel-person/sprite';
import {
  beginDoorwayExit,
  beginPixelPersonDrag,
  createPixelPerson,
  legRange,
  PURPOSEFUL_PHYSICS_CONFIG,
  RECORD_ERRAND,
  ROUTINE,
  setPersonDefinition,
  stepPixelPerson,
  STROLL_PHYSICS_CONFIG,
  walkConfigFor
} from '../../src/lib/pixel-person/simulation';
import type {
  CharacterDefinition,
  Collider,
  Occluder,
  PhysicsBody,
  WorldGeometry
} from '../../src/lib/pixel-person/types';

const largerPerson: CharacterDefinition = {
  ...tinyPerson,
  id: 'larger-person',
  pixelWidth: 48,
  pixelHeight: 64,
  body: { offsetX: 10, offsetY: 2, width: 28, height: 50 },
  dragGrip: { x: 4, y: 2 }
};

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

/**
 * Whether a person leaves a ledge in any one run is a chain of coin flips, so
 * a single unseeded trajectory makes for a flaky test. Trajectory assertions
 * below pin Math.random to this generator and pool several fixed seeds: still
 * many different paths, but the same ones every run.
 */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

const TRAJECTORY_SEEDS = [1, 7, 13, 29, 43, 61, 89, 101];

afterEach(() => {
  vi.restoreAllMocks();
});

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
    expect(still).toBeGreaterThan(walking * 3);
  });

  it('never doubles back without standing still first', () => {
    // This is the complaint routines exist to fix. Not that people turn
    // around — that they used to do it mid-stride, on the spot, over and over.
    // On open floor with nothing to bump into, a change of heading must always
    // come out of a pause beat, never out of a walk already in progress.
    let flips = 0;
    let flipsFromAStandingStart = 0;

    // Pooled across fixed seeds. Unseeded, how many times a wanderer happens
    // to turn around in one run varies enough that the "did we observe
    // anything" guard below failed outright on some runs.
    for (const seed of TRAJECTORY_SEEDS) {
      vi.spyOn(Math, 'random').mockImplementation(seededRandom(seed));
      const world = geometry();
      const drive = driver(wandererIn(world), world, new SpatialHash(world.colliders));
      const person = drive.person;
      let heading = 0;
      let stillSinceLastMove = true;

      drive.run(3_000, () => {
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
    }

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

describe('promenade legs stay on the platform underfoot', () => {
  // A raised ledge in a wide world. The planner is what is under test rather
  // than an obstacle or viewport boundary.
  //
  // The width is chosen deliberately: wide enough that legRange will clamp to
  // it (its usable span beats ROUTINE.travelMinDistance), but narrower than
  // twice the shortest leg, so an *unclamped* goal essentially always lands
  // off the ledge. A wider ledge lets unclamped legs land on it by luck, and
  // the test stops being able to tell the two apart — which it did at 400.
  const LEDGE = { x: 1_000, y: 60, width: 150 };

  // Ground below makes an accidental departure observable as a support change.
  function ledgeWorld(): WorldGeometry {
    return geometry({
      colliders: [
        collider({ id: 'ledge', x: LEDGE.x, y: LEDGE.y, width: LEDGE.width, height: 2 }),
        collider({ id: 'ground', x: 0, y: 190, width: 2_400, height: 2 })
      ]
    });
  }

  function onLedge(goalX: number, bodyWidth: number): boolean {
    return goalX >= LEDGE.x - 1 && goalX <= LEDGE.x + LEDGE.width - bodyWidth + 1;
  }

  function personOnLedge() {
    const person = wanderer();
    person.body.x = LEDGE.x + LEDGE.width / 2;
    person.body.y = LEDGE.y - person.body.height;
    person.body.supportId = 'ledge';
    return person;
  }

  it('plans every leg within the span it is standing on', () => {
    let planned = 0;
    let withinLedge = 0;

    for (const seed of TRAJECTORY_SEEDS) {
      vi.spyOn(Math, 'random').mockImplementation(seededRandom(seed));
      const world = ledgeWorld();
      const person = personOnLedge();
      const drive = driver(person, world, new SpatialHash(world.colliders));
      let lastGoal = person.goalX;

      drive.run(2_000, () => {
        if (person.activity !== 'wander' || person.goalX === lastGoal) return;
        lastGoal = person.goalX;
        planned += 1;
        if (onLedge(person.goalX, person.body.width)) withinLedge += 1;
      });
    }

    expect(planned).toBeGreaterThan(20);
    expect(withinLedge).toBe(planned);
  });

  it('never leaves its authored platform during ambient routines', () => {
    for (const seed of TRAJECTORY_SEEDS) {
      vi.spyOn(Math, 'random').mockImplementation(seededRandom(seed));
      const world = ledgeWorld();
      const person = personOnLedge();
      const drive = driver(person, world, new SpatialHash(world.colliders));
      drive.run(4_000, () => {
        expect(person.plannedClimb).toBeNull();
        expect(person.plannedLadder).toBeNull();
        expect(person.activity).not.toBe('climb');
        expect(person.activity).not.toBe('seek-hide');
        expect(person.activity).not.toBe('hiding');
        expect(person.body.supportId).toBe('ledge');
      });
    }
  });

  it('treats a support too small to walk as a resting place', () => {
    const world = geometry({
      colliders: [
        collider({ id: 'perch', x: 1_200, y: 60, width: 20, height: 2 }),
        collider({ id: 'ground', x: 0, y: 190, width: 2_400, height: 2 })
      ]
    });
    const person = wanderer();
    person.body.x = 1_202;
    person.body.y = 60 - person.body.height;
    person.body.supportId = 'perch';

    const range = legRange(person, world);
    expect(range).toEqual({ minX: 1_200, maxX: 1_206 });

    const drive = driver(person, world, new SpatialHash(world.colliders));
    drive.run(2_000);
    expect(person.body.supportId).toBe('perch');
    expect(person.body.x).toBeGreaterThanOrEqual(range.minX);
    expect(person.body.x).toBeLessThanOrEqual(range.maxX);
  });

  it('clamps to a support wide enough to be worth walking', () => {
    const world = ledgeWorld();
    const person = wanderer();
    person.body.x = LEDGE.x + LEDGE.width / 2;
    person.body.y = LEDGE.y - person.body.height;
    person.body.supportId = 'ledge';

    const attempts = 200;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const range = legRange(person, world);
      expect(range.minX).toBeGreaterThanOrEqual(LEDGE.x);
      expect(range.maxX).toBeLessThanOrEqual(LEDGE.x + LEDGE.width - person.body.width);
    }
  });
});

describe('ambient routines ignore UI obstacles', () => {
  it('never turns an occluder into a hiding interrupt', () => {
    const occluder: Occluder = { id: 'panel', x: 900, y: 20, width: 200, height: 60 };
    const world = geometry({ occluders: [occluder] });
    const person = wanderer();
    person.nextHideAt = 0;
    const drive = driver(person, world, new SpatialHash(world.colliders));

    const steps = 12_000;
    drive.run(steps, () => {
      expect(person.activity).not.toBe('seek-hide');
      expect(person.activity).not.toBe('hiding');
      expect(person.hide).toBeNull();
    });
  });
});

describe('mixed-size definition swaps', () => {
  it('preserves the feet and horizontal centre while resizing the body', () => {
    const person = createPixelPerson(tinyPerson, body({ x: 100, y: 200 }), 0);
    const centerX = person.body.x + person.body.width / 2;
    const feetY = person.body.y + person.body.height;

    setPersonDefinition(person, largerPerson);

    expect(person.definition).toBe(largerPerson);
    expect(person.body).toMatchObject({ width: 28, height: 50 });
    expect(person.body.x + person.body.width / 2).toBe(centerX);
    expect(person.body.y + person.body.height).toBe(feetY);
  });

  it('clears geometry-bound motion planned for the old body box', () => {
    const wall = collider({ id: 'wall', edge: 'right' });
    const person = createPixelPerson(tinyPerson, body(), 0);
    person.activity = 'climb';
    person.climb = { wall, top: wall, side: 'right', direction: 'up' };
    person.plannedLadder = { ladderId: 'ladder', goalX: 300 };

    setPersonDefinition(person, largerPerson);

    expect(person.activity).toBe('idle');
    expect(person.climb).toBeNull();
    expect(person.plannedLadder).toBeNull();
  });

  it('keeps active dragging and doorway exits intact', () => {
    const dragged = createPixelPerson(tinyPerson, body(), 0);
    beginPixelPersonDrag(dragged, 7, { x: 260, y: 20 }, 10);
    setPersonDefinition(dragged, largerPerson);
    expect(dragged.activity).toBe('drag');
    expect(dragged.drag?.pointerId).toBe(7);

    const departing = createPixelPerson(tinyPerson, body(), 0);
    beginDoorwayExit(departing, 300, 10);
    setPersonDefinition(departing, largerPerson);
    expect(departing.activity).toBe('exit');
    expect(departing.exit?.doorX).toBe(300);
  });
});
