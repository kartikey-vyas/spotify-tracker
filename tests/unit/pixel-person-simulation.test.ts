import { describe, expect, it } from 'vitest';
import { MUSIC } from '../../src/lib/pixel-person/activities';
import { tinyPerson } from '../../src/lib/pixel-person/characters';
import { isOverDoorway } from '../../src/lib/pixel-person/doorway';
import { lampReach, layoutRoom, walkRange } from '../../src/lib/pixel-person/room';
import { createSeats } from '../../src/lib/pixel-person/seats';
import { availableSlots, createShelf, stockShelf } from '../../src/lib/pixel-person/shelf';
import {
  arrivalAppear,
  beginDoorwayExit,
  beginPixelPersonDrag,
  createPixelPerson,
  doorOpenness,
  DOORWAY_ARRIVAL,
  enterThroughDoor,
  isUsingDoor,
  nextArrivalStart,
  currentBeat,
  moveDraggedPixelPerson,
  releasePixelPersonDrag,
  setPersonDefinition,
  settleIntoRoom,
  stepPixelPerson,
  STROLL_PHYSICS_CONFIG,
  walkBudgetMs,
  type PixelPersonRuntime,
  type RoomWorld
} from '../../src/lib/pixel-person/simulation';
import type { CharacterDefinition, RoomRecord } from '../../src/lib/pixel-person/types';

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

/** Pooled seeds: one trajectory is a die roll, eight is a behaviour. */
const TRAJECTORY_SEEDS = [1, 7, 13, 29, 43, 61, 89, 101];
const STEP_MS = 50;
const HEIGHT = 83;

function records(count: number): RoomRecord[] {
  return Array.from({ length: count }, (_, index) => ({
    imageUrl: `https://covers/${index}`,
    artistName: `artist ${index}`
  }));
}

function makeWorld(seed = 1, width = 1000, shelfRecords = records(5)): RoomWorld & {
  people: PixelPersonRuntime[];
} {
  const room = layoutRoom(width, HEIGHT, 'right');
  const shelf = createShelf(room.shelf.slots.length);
  stockShelf(shelf, shelfRecords);
  const seats = createSeats(room.seats.length);
  const lamp = { on: false, changedAt: 0 };
  return { room, shelf, seats, lamp, people: [], crate: [], random: seededRandom(seed) };
}

function addPerson(world: ReturnType<typeof makeWorld>, x: number, id = `p${world.people.length + 1}`) {
  const person = createPixelPerson(tinyPerson, x, world.room, 0, id);
  world.people.push(person);
  return person;
}

/** A clock-owning stepper, so successive runs keep moving time forward. */
function driver(world: ReturnType<typeof makeWorld>) {
  let now = 0;
  return {
    get now() {
      return now;
    },
    run(ms: number, each?: (now: number) => boolean | void): boolean {
      const until = now + ms;
      while (now < until) {
        now += STEP_MS;
        for (let index = world.people.length - 1; index >= 0; index -= 1) {
          if (!stepPixelPerson(world.people[index], world, STEP_MS / 1000, now)) {
            world.people.splice(index, 1);
          }
        }
        if (each?.(now)) return true;
      }
      return false;
    }
  };
}

function expectInsideRoom(person: PixelPersonRuntime, world: RoomWorld): void {
  expect(person.body.x).toBeGreaterThanOrEqual(-0.01);
  expect(person.body.x + person.body.width).toBeLessThanOrEqual(world.room.width + 0.01);
  expect(person.body.y + person.body.height).toBeLessThanOrEqual(world.room.floorY + 0.01);
  expect(person.body.y).toBeGreaterThanOrEqual(-0.01);
}

describe('a resident', () => {
  it('stands on the floor from the moment they arrive', () => {
    const world = makeWorld();
    const person = addPerson(world, 400);
    expect(person.body.y + person.body.height).toBe(world.room.floorY);
    expect(person.body.grounded).toBe(true);
  });

  it('never leaves the room, across many seeds and several minutes', () => {
    for (const seed of TRAJECTORY_SEEDS) {
      const world = makeWorld(seed);
      addPerson(world, 100);
      addPerson(world, 500);
      addPerson(world, 900);
      driver(world).run(240_000, () => {
        for (const person of world.people) {
          expectInsideRoom(person, world);
          if (person.body.grounded) {
            expect(person.body.y + person.body.height).toBeCloseTo(world.room.floorY, 3);
          }
        }
      });
    }
  });

  it('spends more of its time still than walking', () => {
    let still = 0;
    let moving = 0;
    for (const seed of TRAJECTORY_SEEDS) {
      const world = makeWorld(seed);
      const person = addPerson(world, 400);
      driver(world).run(120_000, () => {
        if (Math.abs(person.body.vx) > 3) moving += 1;
        else still += 1;
      });
    }
    expect(still).toBeGreaterThan(moving);
  });

  it('allows enough time to walk the whole room at a stroll', () => {
    const room = layoutRoom(1400, HEIGHT, 'right');
    const { minX, maxX } = walkRange(room, tinyPerson.body.width);
    const needed = ((maxX - minX) / STROLL_PHYSICS_CONFIG.walkSpeed) * 1_000;
    expect(walkBudgetMs(minX, maxX, 'stroll')).toBeGreaterThan(needed);
  });
});

describe('listening to a record from the shelf', () => {
  it('takes one, listens, and puts it back where it came from', () => {
    for (const seed of TRAJECTORY_SEEDS) {
      const world = makeWorld(seed);
      const before = world.shelf.map((slot) => slot.record?.imageUrl);
      const person = addPerson(world, 200);
      const drive = driver(world);
      let tookAt = -1;
      let listened = false;
      let returned = false;

      drive.run(10 * 60_000, (now) => {
        if (person.carrying?.source === 'shelf' && tookAt < 0) {
          tookAt = now;
          expect(world.shelf.filter((slot) => slot.out === person.id)).toHaveLength(1);
        }
        if (currentBeat(person)?.kind === 'listen') {
          listened = true;
          // Feet on the floor; cross-legged on the floor, or sunk into a seat.
          expect(person.body.grounded).toBe(true);
          expect(person.animation).toBe(person.seated ? 'lounge' : 'listen');
        }
        if (tookAt >= 0 && listened && !person.carrying) {
          returned = true;
          return true;
        }
      });

      expect(tookAt).toBeGreaterThan(-1);
      expect(listened).toBe(true);
      expect(returned).toBe(true);
      expect(world.shelf.map((slot) => slot.record?.imageUrl)).toEqual(before);
      expect(world.shelf.every((slot) => slot.out === null && slot.reservedBy === null)).toBe(true);
    }
  });

  it('never lets two people hold the same record', () => {
    for (const seed of TRAJECTORY_SEEDS) {
      // Two records, four people: contention is the point.
      const world = makeWorld(seed, 1000, records(2));
      for (const x of [100, 300, 600, 800]) addPerson(world, x);
      driver(world).run(8 * 60_000, () => {
        const holders = world.people.filter((person) => person.carrying?.source === 'shelf');
        const held = holders.map((person) => world.shelf.findIndex((slot) => slot.out === person.id));
        expect(held.every((slot) => slot >= 0)).toBe(true);
        expect(new Set(held).size).toBe(held.length);
      });
    }
  });

  it('crouches at the shelf to take and to return', () => {
    const world = makeWorld(3);
    const person = addPerson(world, 200);
    const poses = new Set<string>();
    let took = false;
    driver(world).run(10 * 60_000, () => {
      if (currentBeat(person)?.kind === 'pose') poses.add(person.animation);
      if (person.carrying?.source === 'shelf') took = true;
      return took && !person.carrying;
    });
    expect(took).toBe(true);
    expect(poses).toEqual(new Set(['hide']));
  });
});

describe('listening to a record from a pocket', () => {
  it('pulls one out, listens, and puts it away, leaving the shelf alone', () => {
    const world = makeWorld(5, 1000, []);
    world.crate = records(3);
    const person = addPerson(world, 400);
    let pocketed = false;
    let listened = false;
    driver(world).run(10 * 60_000, () => {
      if (person.carrying?.source === 'pocket') pocketed = true;
      if (pocketed && currentBeat(person)?.kind === 'listen') listened = true;
      return listened && !person.carrying;
    });
    expect(pocketed).toBe(true);
    expect(listened).toBe(true);
    expect(person.carrying).toBeNull();
    expect(availableSlots(world.shelf)).toEqual([]);
  });

  it('waits for a newcomer to settle in before reaching for music', () => {
    const world = makeWorld(5, 1000, []);
    world.crate = records(3);
    const person = createPixelPerson(tinyPerson, 400, world.room, 0, 'p1', false, MUSIC.firstDelayMs);
    world.people.push(person);
    driver(world).run(MUSIC.firstDelayMs - STEP_MS, () => {
      expect(person.carrying).toBeNull();
    });
  });
});

describe('being picked up', () => {
  function listeningWorld(seed: number) {
    const world = makeWorld(seed);
    const person = addPerson(world, 200);
    const drive = driver(world);
    drive.run(10 * 60_000, () => currentBeat(person)?.kind === 'listen');
    return { world, person, drive };
  }

  it('puts a shelf record straight back when someone is grabbed mid-listen', () => {
    const { world, person, drive } = listeningWorld(11);
    expect(person.carrying?.source).toBe('shelf');
    beginPixelPersonDrag(person, world, 1, { x: person.body.x, y: 10 }, drive.now);
    expect(person.carrying).toBeNull();
    expect(world.shelf.every((slot) => slot.out === null && slot.reservedBy === null)).toBe(true);
    expect(person.animation).toBe('dangle');
  });

  it('follows only its own pointer while held', () => {
    const world = makeWorld();
    const person = addPerson(world, 200);
    beginPixelPersonDrag(person, world, 7, { x: 200, y: 10 }, 0);
    expect(moveDraggedPixelPerson(person, 8, { x: 300, y: 10 }, 16)).toBe(false);
    expect(moveDraggedPixelPerson(person, 7, { x: 300, y: 10 }, 16)).toBe(true);
    expect(person.drag?.anchor.x).toBe(300);
  });

  it('falls back to the floor, inside the room, when let go', () => {
    for (const seed of TRAJECTORY_SEEDS) {
      const world = makeWorld(seed);
      const person = addPerson(world, 500);
      const drive = driver(world);
      beginPixelPersonDrag(person, world, 1, { x: 500, y: 10 }, drive.now);
      // A hard fling toward the wall.
      for (let step = 1; step <= 6; step += 1) {
        moveDraggedPixelPerson(person, 1, { x: 500 + step * 80, y: 4 }, drive.now + step * 16);
      }
      drive.run(200);
      releasePixelPersonDrag(person, world.room, 1, drive.now);
      expectInsideRoom(person, world);
      drive.run(3_000, () => {
        expectInsideRoom(person, world);
      });
      expect(person.body.grounded).toBe(true);
      expect(person.body.y + person.body.height).toBeCloseTo(world.room.floorY, 3);
      // And gets on with their day after landing.
      drive.run(30_000);
      expect(person.plan).not.toBeNull();
    }
  });

  it('is set down inside the room even when held past a wall', () => {
    const world = makeWorld();
    const person = addPerson(world, 900);
    beginPixelPersonDrag(person, world, 1, { x: 900, y: 10 }, 0);
    moveDraggedPixelPerson(person, 1, { x: world.room.width + 60, y: -30 }, 16);
    stepPixelPerson(person, world, 0.016, 16);
    expect(person.body.x + person.body.width).toBeGreaterThan(world.room.width);
    releasePixelPersonDrag(person, world.room, 1, 32);
    expectInsideRoom(person, world);
  });

  it('ignores a release from a different pointer', () => {
    const world = makeWorld();
    const person = addPerson(world, 200);
    beginPixelPersonDrag(person, world, 1, { x: 200, y: 10 }, 0);
    expect(releasePixelPersonDrag(person, world.room, 2, 10)).toBe(false);
    expect(person.drag).not.toBeNull();
  });
});

describe('leaving through the door', () => {
  it('walks in and is removed once the door has shut', () => {
    for (const shelfSide of ['left', 'right'] as const) {
      const world = makeWorld();
      world.room = layoutRoom(1000, HEIGHT, shelfSide);
      const person = addPerson(world, 500);
      const door = world.room.door;
      expect(isOverDoorway({ x: door.x + 4, y: door.y + 4 }, world.room)).toBe(true);
      beginDoorwayExit(person, world.room, 0);
      const drive = driver(world);
      const left = drive.run(10_000, () => world.people.length === 0);
      expect(left).toBe(true);
    }
  });
});

describe('moving between rooms', () => {
  it('keeps the same person at the same relative spot on the new floor', () => {
    const world = makeWorld();
    const person = addPerson(world, 500);
    person.carrying = { record: records(1)[0], source: 'pocket', takenAt: 0, stowingAt: null };
    const narrow = layoutRoom(400, 71, 'left');
    expect(settleIntoRoom(person, 1000, narrow, 10)).toBe(true);
    expect(person.id).toBe('p1');
    expect(person.body.x).toBeCloseTo(200, 0);
    expect(person.body.y + person.body.height).toBe(narrow.floorY);
    expect(person.carrying).toBeNull();
  });

  it('clamps someone into a narrower room', () => {
    const world = makeWorld();
    const person = addPerson(world, 980);
    const narrow = layoutRoom(300, HEIGHT, 'left');
    settleIntoRoom(person, 300 * 10, narrow, 0);
    const { minX, maxX } = walkRange(narrow, person.body.width);
    expect(person.body.x).toBeGreaterThanOrEqual(minX);
    expect(person.body.x).toBeLessThanOrEqual(maxX);
  });

  it('does not bring along someone who was on their way out', () => {
    const world = makeWorld();
    const person = addPerson(world, 500);
    beginDoorwayExit(person, world.room, 0);
    expect(settleIntoRoom(person, 1000, world.room, 10)).toBe(false);
  });
});

describe('swapping a character', () => {
  const larger: CharacterDefinition = {
    ...tinyPerson,
    id: 'larger-person',
    body: { offsetX: 10, offsetY: 2, width: 28, height: 50 }
  };

  it('keeps their feet and horizontal centre', () => {
    const world = makeWorld();
    const person = addPerson(world, 400);
    const centre = person.body.x + person.body.width / 2;
    const feet = person.body.y + person.body.height;
    setPersonDefinition(person, larger);
    expect(person.body.width).toBe(28);
    expect(person.body.x + person.body.width / 2).toBeCloseTo(centre);
    expect(person.body.y + person.body.height).toBeCloseTo(feet);
  });
});

describe('the lounge', () => {
  it('sits people on the couch and never two to a seat', () => {
    for (const seed of TRAJECTORY_SEEDS) {
      const world = makeWorld(seed);
      for (const x of [100, 300, 600, 800]) addPerson(world, x);
      let sat = 0;
      driver(world).run(5 * 60_000, () => {
        const occupied = world.people.filter((person) => person.seated).map((person) => person.seated!.seat);
        sat += occupied.length;
        expect(new Set(occupied).size).toBe(occupied.length);
        for (const person of world.people) {
          if (!person.seated) continue;
          expect(world.seats[person.seated.seat].occupant).toBe(person.id);
          // Seated people's feet stay on the floor in front of their seat.
          const centre = person.body.x + person.body.width / 2;
          expect(Math.abs(centre - world.room.seats[person.seated.seat].x)).toBeLessThan(4);
          expect(person.animation).toBe('lounge');
          expect(person.body.y + person.body.height).toBeCloseTo(world.room.floorY, 3);
          expect(person.facing).toBe(world.room.seats[person.seated.seat].facing);
        }
      });
      expect(sat).toBeGreaterThan(0);
    }
  });

  it('never sits with headphones and nothing to play', () => {
    for (const seed of TRAJECTORY_SEEDS) {
      const world = makeWorld(seed);
      world.crate = records(3);
      for (const x of [100, 500, 900]) addPerson(world, x);
      driver(world).run(5 * 60_000, () => {
        for (const person of world.people) {
          if (!person.seated) continue;
          // The record is only absent while it is coming out of, or going
          // back into, a pocket.
          const beat = currentBeat(person)?.kind;
          if (beat === 'take-from-pocket' || beat === 'stow') continue;
          expect(person.carrying).not.toBeNull();
        }
      });
    }
  });

  it('frees the seat when someone is picked up off it', () => {
    const world = makeWorld(2);
    const person = addPerson(world, 500);
    const drive = driver(world);
    drive.run(10 * 60_000, () => person.seated !== null);
    expect(person.seated).not.toBeNull();
    beginPixelPersonDrag(person, world, 1, { x: person.body.x, y: 10 }, drive.now);
    expect(person.seated).toBeNull();
    expect(world.seats.every((seat) => seat.occupant === null && seat.reservedBy === null)).toBe(true);
  });

  it('never leaves a seat claimed by someone who is not using it', () => {
    for (const seed of TRAJECTORY_SEEDS) {
      const world = makeWorld(seed);
      for (const x of [100, 500, 900]) addPerson(world, x);
      driver(world).run(5 * 60_000, () => {
        world.seats.forEach((seat, index) => {
          if (seat.occupant) {
            const sitter = world.people.find((person) => person.id === seat.occupant);
            expect(sitter?.seated?.seat).toBe(index);
          }
          if (seat.reservedBy) {
            const walker = world.people.find((person) => person.id === seat.reservedBy);
            expect(walker?.seated).toBeNull();
            expect(walker?.plan?.beats.some((beat) => beat.kind === 'sit' && beat.seat === index)).toBe(true);
          }
        });
      });
    }
  });
});

describe('arriving through the door', () => {
  function arriving(seed = 1) {
    const world = makeWorld(seed);
    const person = addPerson(world, 500);
    enterThroughDoor(person, world.room, 0);
    return { world, person, drive: driver(world) };
  }

  it('starts standing in the doorway, hidden, with the door shut', () => {
    const { world, person } = arriving();
    const centre = person.body.x + person.body.width / 2;
    expect(centre).toBeCloseTo(world.room.door.x + world.room.door.width / 2);
    expect(arrivalAppear(person, 0)).toBe(0);
    expect(doorOpenness(person, 0)).toBe(0);
  });

  it('waits behind the door until it has opened, then fades up on the threshold', () => {
    const { person, drive } = arriving();
    const startX = person.body.x;
    let opened = false;
    drive.run(DOORWAY_ARRIVAL.openAtMs + DOORWAY_ARRIVAL.openMs, (now) => {
      // Nobody steps through, or shows in, a door that is still opening.
      expect(person.body.x).toBe(startX);
      if (now <= DOORWAY_ARRIVAL.openAtMs + DOORWAY_ARRIVAL.openMs) {
        expect(arrivalAppear(person, now)).toBe(0);
      }
      if (doorOpenness(person, now) === 1) opened = true;
    });
    expect(opened).toBe(true);
    drive.run(DOORWAY_ARRIVAL.appearMs);
    expect(arrivalAppear(person, drive.now)).toBe(1);
  });

  it('steps clear and the door shuts behind them', () => {
    for (const shelfSide of ['left', 'centre', 'right'] as const) {
      const world = makeWorld();
      world.room = layoutRoom(1000, HEIGHT, shelfSide);
      const person = addPerson(world, 500);
      enterThroughDoor(person, world.room, 0);
      const drive = driver(world);
      expect(drive.run(60_000, () => person.arrival === null)).toBe(true);
      expect(doorOpenness(person, drive.now)).toBeNull();
      const door = world.room.door;
      const clear =
        person.body.x >= door.x + door.width || person.body.x + person.body.width <= door.x;
      expect(clear).toBe(true);
    }
  });

  it('first takes a record off the shelf, puts the lamp on, then sits to listen', () => {
    for (const seed of TRAJECTORY_SEEDS) {
      const { world, person, drive } = arriving(seed);
      const order: string[] = [];
      drive.run(3 * 60_000, () => {
        // Each milestone once, in the order it first happens.
        const note = (event: string) => {
          if (!order.includes(event)) order.push(event);
        };
        if (person.carrying?.source === 'shelf') note('record');
        if (world.lamp.on) note('lamp');
        if (person.seated) note('seat');
        if (currentBeat(person)?.kind === 'listen') note('listen');
        return order.includes('listen');
      });
      expect(order.slice(0, 4)).toEqual(['record', 'lamp', 'seat', 'listen']);
    }
  });

  it('never wanders off first: the first plan is the settle-in', () => {
    const { person, drive } = arriving();
    drive.run(5_000, () => person.plan !== null);
    expect(person.plan?.activity).toBe('settle-in');
  });

  it('pulls a record from a pocket when the shelf is bare', () => {
    const world = makeWorld(3, 1000, []);
    world.crate = records(2);
    const person = addPerson(world, 500);
    enterThroughDoor(person, world.room, 0);
    let pocketed = false;
    driver(world).run(60_000, () => {
      if (person.carrying?.source === 'pocket' && person.seated) pocketed = true;
      return pocketed;
    });
    expect(pocketed).toBe(true);
    expect(world.lamp.on).toBe(true);
  });

  it('queues a second arrival behind the first', () => {
    const world = makeWorld();
    const first = addPerson(world, 500);
    enterThroughDoor(first, world.room, 1_000);
    expect(nextArrivalStart(world.people, 1_000)).toBe(1_000 + DOORWAY_ARRIVAL.queueMs);
    expect(nextArrivalStart([], 1_000)).toBe(1_000);
  });

  it('can be picked up mid-arrival without leaving the door waiting on them', () => {
    const { world, person, drive } = arriving();
    drive.run(DOORWAY_ARRIVAL.openAtMs + DOORWAY_ARRIVAL.openMs + DOORWAY_ARRIVAL.appearMs + 200);
    beginPixelPersonDrag(person, world, 1, { x: person.body.x + 20, y: 10 }, drive.now);
    expect(person.arrival).toBeNull();
    expect(isUsingDoor(world.people)).toBe(false);
  });
});

describe('the door for someone leaving', () => {
  it('stays open while they walk to it, and shuts as they step through', () => {
    const world = makeWorld();
    const person = addPerson(world, 500);
    beginDoorwayExit(person, world.room, 0);
    const drive = driver(world);
    expect(doorOpenness(person, 0)).toBe(1);
    let lastOpen = 1;
    drive.run(10_000, (now) => {
      if (world.people.length === 0) return true;
      const open = doorOpenness(person, now)!;
      if (person.exit?.enteredAt != null) {
        expect(open).toBeLessThanOrEqual(lastOpen);
        lastOpen = open;
      } else {
        expect(open).toBe(1);
      }
    });
    expect(world.people).toHaveLength(0);
  });
});

describe('the lamp', () => {
  it('gets switched on by someone before long, reaching up to do it', () => {
    for (const seed of TRAJECTORY_SEEDS) {
      const world = makeWorld(seed);
      const person = addPerson(world, 300);
      let reached = false;
      const lit = driver(world).run(10 * 60_000, () => {
        if (currentBeat(person)?.kind === 'pose' && person.animation === 'reach') reached = true;
        return world.lamp.on;
      });
      expect(lit).toBe(true);
      expect(reached).toBe(true);
      // Beside the pole, facing it, when it came on — not under the shade.
      const reach = lampReach(world.room, person.body.width)!;
      expect(Math.abs(person.body.x - reach.standX)).toBeLessThan(3);
      expect(person.facing).toBe(reach.facing);
    }
  });

  it('does not restart the glow when it is already in the asked-for state', () => {
    const world = makeWorld();
    world.lamp.on = true;
    world.lamp.changedAt = 5;
    const person = addPerson(world, 300);
    person.plan = { activity: 'lamp', beats: [{ kind: 'set-lamp', on: true }], index: 0, started: false, beatStartedAt: 0, beatUntil: 0, lookFlipAt: 0 };
    stepPixelPerson(person, world, 0.05, 100);
    expect(world.lamp).toEqual({ on: true, changedAt: 5 });
  });
});

describe('listening time', () => {
  it('stays sat with a record for at least 30 seconds', () => {
    expect(MUSIC.listenMinMs).toBeGreaterThanOrEqual(30_000);
    for (const seed of TRAJECTORY_SEEDS) {
      const world = makeWorld(seed);
      const person = addPerson(world, 500);
      enterThroughDoor(person, world.room, 0);
      const drive = driver(world);
      let started = -1;
      let ended = -1;
      drive.run(5 * 60_000, (now) => {
        const listening = currentBeat(person)?.kind === 'listen';
        if (listening && started < 0) started = now;
        if (!listening && started >= 0) {
          ended = now;
          return true;
        }
      });
      expect(started).toBeGreaterThan(-1);
      expect(ended - started).toBeGreaterThanOrEqual(MUSIC.listenMinMs);
      expect(ended - started).toBeLessThanOrEqual(MUSIC.listenMinMs + MUSIC.listenJitterMs + 100);
    }
  });
});
