import { afterEach, describe, expect, it, vi } from 'vitest';
import { tinyPerson } from '../../src/lib/pixel-person/characters';
import { SpatialHash } from '../../src/lib/pixel-person/physics';
import { spriteTimeScale, REFERENCE_WALK_SPEED } from '../../src/lib/pixel-person/sprite';
import {
  createPixelPerson,
  HIDE,
  legRange,
  PURPOSEFUL_PHYSICS_CONFIG,
  RECORD_ERRAND,
  ROUTINE,
  stepPixelPerson,
  STROLL_PHYSICS_CONFIG,
  walkConfigFor
} from '../../src/lib/pixel-person/simulation';
import type {
  Collider,
  Occluder,
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
    expect(still).toBeGreaterThan(walking);
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

describe('legs stay on the platform underfoot', () => {
  // A raised ledge in a wide world. `kind: 'border'` with no groupId keeps
  // chooseClimbPlan out of it, so the planner is what is under test rather
  // than the climb branch.
  //
  // The width is chosen deliberately: wide enough that legRange will clamp to
  // it (its usable span beats ROUTINE.travelMinDistance), but narrower than
  // twice the shortest leg, so an *unclamped* goal essentially always lands
  // off the ledge. A wider ledge lets unclamped legs land on it by luck, and
  // the test stops being able to tell the two apart — which it did at 400.
  const LEDGE = { x: 1_000, y: 60, width: 150 };

  // The ground sits a hoppable distance below: deeper than the cliff sense's
  // landing window and nobody could ever step off, which would make the
  // escape-hatch test vacuous rather than passing.
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

  it('plans most legs within the span it is standing on', () => {
    let planned = 0;
    let withinLedge = 0;

    for (const seed of TRAJECTORY_SEEDS) {
      vi.spyOn(Math, 'random').mockImplementation(seededRandom(seed));
      const world = ledgeWorld();
      const person = personOnLedge();
      const drive = driver(person, world, new SpatialHash(world.colliders));
      let lastGoal = person.goalX;

      drive.run(2_000, () => {
        // Someone who wandered off stops producing ledge goals, so put them
        // back and let them plan again — the measurement is "goals chosen
        // while standing on the ledge", not "how long they stayed".
        if (person.body.supportId !== 'ledge') {
          person.body.x = LEDGE.x + LEDGE.width / 2;
          person.body.y = LEDGE.y - person.body.height;
          person.body.vx = 0;
          person.body.vy = 0;
          person.body.grounded = true;
          person.body.supportId = 'ledge';
          person.routine = null;
          person.activityUntil = 0;
          return;
        }
        if (person.activity !== 'wander' || person.goalX === lastGoal) return;
        lastGoal = person.goalX;
        planned += 1;
        if (onLedge(person.goalX, person.body.width)) withinLedge += 1;
      });
    }

    expect(planned).toBeGreaterThan(20);
    // The planner deliberately wanders off sometimes, so this is a majority
    // rule rather than an absolute one — derived from that escape hatch so
    // retuning it cannot silently invalidate the test.
    const floor = 1 - ROUTINE.leavePlatformChance * 2;
    expect(withinLedge / planned).toBeGreaterThan(floor);
  });

  it('still leaves the platform sometimes, so ledges are not cages', () => {
    let seedsThatLeft = 0;

    for (const seed of TRAJECTORY_SEEDS) {
      vi.spyOn(Math, 'random').mockImplementation(seededRandom(seed));
      const world = ledgeWorld();
      const person = personOnLedge();
      const drive = driver(person, world, new SpatialHash(world.colliders));
      let left = false;
      drive.run(4_000, () => {
        if (person.body.supportId === 'ground') left = true;
      });
      if (left) seedsThatLeft += 1;
    }

    expect(seedsThatLeft).toBeGreaterThan(0);
  });

  it('falls back to the open range when the support is too small to walk', () => {
    // A perch narrower than the shortest leg. Clamping to it would leave the
    // person shuffling on the spot, which is the behaviour being removed, so
    // the range is asserted directly rather than through a step — on a perch
    // this size the cliff sense would take over before a goal was revealing.
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

    for (let attempt = 0; attempt < 50; attempt += 1) {
      const range = legRange(person, world);
      expect(range.maxX - range.minX).toBeGreaterThan(ROUTINE.travelMinDistance);
    }
  });

  it('clamps to a support wide enough to be worth walking', () => {
    const world = ledgeWorld();
    const person = wanderer();
    person.body.x = LEDGE.x + LEDGE.width / 2;
    person.body.y = LEDGE.y - person.body.height;
    person.body.supportId = 'ledge';

    let clamped = 0;
    const attempts = 200;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const range = legRange(person, world);
      if (range.minX >= LEDGE.x && range.maxX <= LEDGE.x + LEDGE.width) clamped += 1;
    }

    // Clamped except when the escape hatch fires, so the observed share should
    // sit near its complement rather than at either extreme.
    expect(clamped / attempts).toBeGreaterThan(1 - ROUTINE.leavePlatformChance * 2);
    expect(clamped / attempts).toBeLessThan(1);
  });
});

describe('hiding is occasional', () => {
  it('spends far longer between hides than in one', () => {
    // The duty cycle is the rule: a hide plus the walk to it must be a small
    // slice of the gap before the next one, or hiding competes with record
    // errands for screen time.
    const perHide = HIDE.exitUntilMs + HIDE.seekTimeoutMs;
    expect(perHide * 4).toBeLessThan(HIDE.cooldownMs);
  });

  it('leaves the wall alone for most of a long run', () => {
    const occluder: Occluder = { id: 'panel', x: 900, y: 20, width: 200, height: 60 };
    const world = geometry({ occluders: [occluder] });
    const person = wanderer();
    person.nextHideAt = 0;
    const drive = driver(person, world, new SpatialHash(world.colliders));

    let hiding = 0;
    const steps = 12_000;
    drive.run(steps, () => {
      if (person.activity === 'seek-hide' || person.activity === 'hiding') hiding += 1;
    });

    // Derived from the cadence rather than pinned to a measurement: at most
    // one hide per cooldown window, each costing the seek plus the hide.
    const worstCaseShare = (HIDE.exitUntilMs + HIDE.seekTimeoutMs) / HIDE.cooldownMs;
    expect(hiding / steps).toBeLessThan(worstCaseShare);
  });
});
