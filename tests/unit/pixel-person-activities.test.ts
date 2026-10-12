import { describe, expect, it } from 'vitest';
import {
  ACTIVITIES,
  chooseActivity,
  claimNearestSeat,
  lampSwitch,
  choosePocketRecord,
  chooseShelfSlot,
  MUSIC,
  pocketListen,
  shelfListen,
  stroll,
  type Activity
} from '../../src/lib/pixel-person/activities';
import { artistCharacterFor } from '../../src/lib/pixel-person/artists';
import { pickOne, weightedPick } from '../../src/lib/pixel-person/random';
import { tinyPerson } from '../../src/lib/pixel-person/characters';
import { layoutRoom, walkRange } from '../../src/lib/pixel-person/room';
import { createSeats, takeSeat } from '../../src/lib/pixel-person/seats';
import { createShelf, stockShelf, takeFromShelf } from '../../src/lib/pixel-person/shelf';
import {
  createPixelPerson,
  type Beat,
  type PixelPersonRuntime,
  type RoomWorld
} from '../../src/lib/pixel-person/simulation';
import type { RoomRecord } from '../../src/lib/pixel-person/types';

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

const SEEDS = [1, 7, 13, 29, 43, 61, 89, 101];

function records(...artists: string[]): RoomRecord[] {
  return artists.map((artist, index) => ({
    imageUrl: `https://covers/${index}-${artist}`,
    artistName: artist
  }));
}

function world(overrides: Partial<RoomWorld> = {}, shelfRecords = records('a', 'b', 'c')): RoomWorld {
  const room = layoutRoom(1000, 83, 'right');
  const shelf = createShelf(room.shelf.slots.length);
  stockShelf(shelf, shelfRecords);
  const seats = createSeats(room.seats.length);
  const lamp = { on: false, changedAt: 0 };
  return { room, shelf, seats, lamp, people: [], crate: [], random: seededRandom(1), ...overrides };
}

function person(at = 300, definition = tinyPerson): PixelPersonRuntime {
  return createPixelPerson(definition, at, layoutRoom(1000, 83, 'right'), 0, 'p1');
}

function beatKinds(beats: Beat[] | null): string[] {
  return (beats ?? []).map((beat) => beat.kind);
}

describe('choosing what to do', () => {
  it('only strolls while music is on cooldown', () => {
    const someone = person();
    someone.nextMusicAt = 60_000;
    for (const seed of SEEDS) {
      const choice = chooseActivity(someone, world({ random: seededRandom(seed) }), 1_000);
      expect(choice.activity).toBe(stroll.id);
    }
  });

  it('reaches for music once it is off cooldown', () => {
    // Sweep the roll rather than trusting seeds: a small-seed LCG's first draw
    // is nearly the same for every seed.
    const chosen = new Set<string>();
    for (let roll = 0.025; roll < 1; roll += 0.05) {
      const choice = chooseActivity(person(), world({ random: () => roll, crate: records('x') }), 1_000);
      chosen.add(choice.activity);
    }
    expect(chosen).toEqual(new Set(ACTIVITIES.map((activity) => activity.id)));
  });

  it('strikes off an activity whose plan turns out impossible', () => {
    const impossible: Activity = { id: 'impossible', weight: () => 1_000, plan: () => null };
    const choice = chooseActivity(person(), world(), 0, [impossible, stroll]);
    expect(choice.activity).toBe(stroll.id);
  });

  it('still returns something when every activity is impossible', () => {
    const impossible: Activity = { id: 'impossible', weight: () => 1, plan: () => null };
    const choice = chooseActivity(person(), world(), 0, [impossible]);
    expect(choice.beats.length).toBeGreaterThan(0);
  });

  it('registers every activity once', () => {
    const ids = ACTIVITIES.map((activity) => activity.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('strolling', () => {
  it('only ever plans walks inside the room', () => {
    const shared = world();
    const { minX, maxX } = walkRange(shared.room, tinyPerson.body.width);
    for (const seed of SEEDS) {
      for (const start of [minX, 500, maxX]) {
        const beats = stroll.plan(person(start), { ...shared, random: seededRandom(seed) }, 0);
        for (const beat of beats ?? []) {
          if (beat.kind !== 'walk') continue;
          expect(beat.toX).toBeGreaterThanOrEqual(minX);
          expect(beat.toX).toBeLessThanOrEqual(maxX);
        }
      }
    }
  });

  it('always ends on a pause, so nobody sets off again on arrival', () => {
    for (const seed of SEEDS) {
      const beats = stroll.plan(person(), world({ random: seededRandom(seed) }), 0)!;
      expect(beats.at(-1)?.kind).toBe('pause');
    }
  });
});

describe('listening to a shelf record', () => {
  it('needs a record on the shelf', () => {
    const empty = world({}, []);
    expect(shelfListen.weight(person(), empty, 0)).toBe(0);
  });

  it('reserves the slot, takes the record, listens, and puts it back', () => {
    const shared = world();
    const someone = person();
    const beats = shelfListen.plan(someone, shared, 0);
    const kinds = beatKinds(beats);
    const take = kinds.indexOf('take-from-shelf');
    const listen = kinds.indexOf('listen');
    const put = kinds.indexOf('return-to-shelf');
    expect(take).toBeGreaterThan(-1);
    expect(listen).toBeGreaterThan(take);
    expect(put).toBeGreaterThan(listen);
    expect(shared.shelf.some((slot) => slot.reservedBy === someone.id)).toBe(true);
  });

  it('starts the music cooldown when it is planned', () => {
    const someone = person();
    shelfListen.plan(someone, world(), 5_000);
    expect(someone.nextMusicAt).toBeGreaterThanOrEqual(5_000 + MUSIC.cooldownMs);
  });

  it('takes a record to a spot away from the shelf before listening', () => {
    const shared = world();
    const beats = shelfListen.plan(person(), shared, 0)!;
    const listen = beats.findIndex((beat) => beat.kind === 'listen');
    const walk = beats.slice(0, listen).filter((beat) => beat.kind === 'walk').at(-1);
    expect(walk?.kind).toBe('walk');
    if (walk?.kind !== 'walk') return;
    const { shelf } = shared.room;
    const right = walk.toX + tinyPerson.body.width;
    expect(right <= shelf.x || walk.toX >= shelf.x + shelf.width).toBe(true);
  });
});

describe('picking a record', () => {
  it('prefers something not played recently', () => {
    const shared = world();
    const someone = person();
    someone.recentRecords = shared.shelf.slice(0, 2).map((slot) => slot.record!.imageUrl);
    for (const seed of SEEDS) {
      expect(chooseShelfSlot(someone, { ...shared, random: seededRandom(seed) })).toBe(2);
    }
  });

  it('falls back to a repeat when everything is recent', () => {
    const shared = world();
    const someone = person();
    someone.recentRecords = shared.shelf.flatMap((slot) => (slot.record ? [slot.record.imageUrl] : []));
    expect(chooseShelfSlot(someone, shared)).not.toBeNull();
  });

  it('skips records someone else already has', () => {
    const shared = world({}, records('a', 'b'));
    takeFromShelf(shared.shelf, 0, 'someone-else');
    for (const seed of SEEDS) {
      expect(chooseShelfSlot(person(), { ...shared, random: seededRandom(seed) })).toBe(1);
    }
  });

  it('sends an artist to their own record on the shelf', () => {
    const frank = artistCharacterFor('Frank Ocean')!;
    const shared = world({}, records('a', 'b', 'Frank Ocean', 'c'));
    for (const seed of SEEDS) {
      const slot = chooseShelfSlot(person(300, frank), { ...shared, random: seededRandom(seed) });
      expect(shared.shelf[slot!].record?.artistName).toBe('Frank Ocean');
    }
  });

  it('pulls an artist’s own record out of their pocket', () => {
    const frank = artistCharacterFor('Frank Ocean')!;
    const crate = records('a', 'FRANK OCEAN', 'b');
    for (const seed of SEEDS) {
      expect(choosePocketRecord(person(300, frank), crate, seededRandom(seed))?.artistName).toBe(
        'FRANK OCEAN'
      );
    }
  });

  it('has nothing to pull out of an empty pocket', () => {
    expect(choosePocketRecord(person(), [], Math.random)).toBeNull();
    expect(pocketListen.weight(person(), world({ crate: [] }), 0)).toBe(0);
  });

  it('weighs a pocket record higher for an artist with their own to hand', () => {
    const frank = artistCharacterFor('Frank Ocean')!;
    const crate = records('a', 'Frank Ocean');
    expect(pocketListen.weight(person(300, frank), world({ crate }), 0)).toBeGreaterThan(
      pocketListen.weight(person(), world({ crate }), 0)
    );
  });
});

describe('listening in the lounge', () => {
  it('goes to the nearest free seat, not a random one', () => {
    const shared = world();
    const someone = person(shared.room.seats[0].x);
    expect(claimNearestSeat(someone, shared, someone.body.x)).toBe(0);
  });

  it('sits down to play a pocket record, and puts it away before getting up', () => {
    const shared = world({ random: () => 0, crate: records('x') });
    const kinds = beatKinds(pocketListen.plan(person(), shared, 0));
    const sit = kinds.indexOf('sit');
    expect(sit).toBeGreaterThan(-1);
    expect(kinds.indexOf('take-from-pocket')).toBe(sit + 1);
    expect(kinds.indexOf('stand')).toBe(kinds.indexOf('stow') + 1);
  });

  it('listens to a shelf record on a free seat, and standing when the lounge is full', () => {
    const open = world({ random: () => 0 });
    expect(beatKinds(shelfListen.plan(person(), open, 0))).toContain('sit');
    const full = world({ random: () => 0 });
    full.seats.forEach((_, index) => takeSeat(full.seats, index, `other-${index}`));
    const kinds = beatKinds(shelfListen.plan(person(), full, 0));
    expect(kinds).not.toContain('sit');
    expect(kinds).toContain('listen');
  });

  it('never plans a sit without a record to play', () => {
    for (const activity of ACTIVITIES) {
      for (let roll = 0.025; roll < 1; roll += 0.05) {
        const shared = world({ random: () => roll, crate: records('x') });
        const beats = activity.plan(person(), shared, 0) ?? [];
        const sit = beats.findIndex((beat) => beat.kind === 'sit');
        if (sit < 0) continue;
        const before = beatKinds(beats.slice(0, sit));
        const after = beatKinds(beats.slice(sit + 1));
        const recordInHand = before.includes('take-from-shelf') || after[0] === 'take-from-pocket';
        expect(recordInHand).toBe(true);
      }
    }
  });
});

describe('the lamp', () => {
  it('walks to the lamp, reaches up, and switches it', () => {
    const shared = world();
    const beats = lampSwitch.plan(person(), shared, 0)!;
    const kinds = beatKinds(beats);
    expect(kinds[0]).toBe('walk');
    const reach = beats.findIndex((beat) => beat.kind === 'pose' && beat.animation === 'reach');
    const flick = beats.findIndex((beat) => beat.kind === 'set-lamp');
    expect(reach).toBeGreaterThan(0);
    expect(flick).toBe(reach + 1);
    expect(beats[flick]).toEqual({ kind: 'set-lamp', on: true });
  });

  it('switches it off again when it is on', () => {
    const shared = world();
    shared.lamp.on = true;
    const flick = lampSwitch.plan(person(), shared, 0)!.find((beat) => beat.kind === 'set-lamp');
    expect(flick).toEqual({ kind: 'set-lamp', on: false });
  });

  it('wants the lamp on more than off', () => {
    const off = world();
    const on = world();
    on.lamp.on = true;
    expect(lampSwitch.weight(person(), off, 0)).toBeGreaterThan(lampSwitch.weight(person(), on, 0));
  });

  it('leaves it to whoever is already on their way to it', () => {
    const shared = world();
    const other = createPixelPerson(tinyPerson, 600, shared.room, 0, 'p2');
    other.plan = { activity: 'lamp', beats: lampSwitch.plan(other, shared, 0)!, index: 0, started: false, beatStartedAt: 0, beatUntil: 0, lookFlipAt: 0 };
    expect(lampSwitch.weight(person(), { ...shared, people: [other] }, 0)).toBe(0);
  });

  it('is not an option in a room without a lamp', () => {
    const shared = world();
    const room = { ...shared.room, furniture: shared.room.furniture.filter((piece) => piece.kind !== 'lamp') };
    expect(lampSwitch.weight(person(), { ...shared, room }, 0)).toBe(0);
    expect(lampSwitch.plan(person(), { ...shared, room }, 0)).toBeNull();
  });

  it('puts the lamp on before settling down with a record, when it is off', () => {
    const shared = world({ random: () => 0 });
    const kinds = beatKinds(shelfListen.plan(person(), shared, 0));
    expect(kinds.indexOf('set-lamp')).toBeGreaterThan(kinds.indexOf('take-from-shelf'));
    expect(kinds.indexOf('set-lamp')).toBeLessThan(kinds.indexOf('sit'));
  });
});

describe('a newcomer', () => {
  it('settles in first, whatever the roll', () => {
    for (let roll = 0.025; roll < 1; roll += 0.05) {
      const someone = person();
      someone.settlingIn = true;
      const choice = chooseActivity(someone, world({ random: () => roll }), 0);
      expect(choice.activity).toBe('settle-in');
      expect(someone.settlingIn).toBe(false);
    }
  });

  it('falls back to the usual roll when there is no music to settle in with', () => {
    const someone = person();
    someone.settlingIn = true;
    expect(chooseActivity(someone, world({}, []), 0).activity).not.toBe('settle-in');
  });
});

describe('random helpers', () => {
  it('picks by weight and never picks a zero weight', () => {
    const pool = [['a', 1], ['b', 0], ['c', 3]] as const;
    expect(weightedPick(pool, () => 0)).toBe('a');
    expect(weightedPick(pool, () => 0.26)).toBe('c');
    expect(weightedPick(pool, () => 0.9999)).toBe('c');
    for (let roll = 0; roll < 1; roll += 0.01) expect(weightedPick(pool, () => roll)).not.toBe('b');
  });

  it('picks uniformly by index', () => {
    expect(pickOne(['x', 'y', 'z'], () => 0)).toBe('x');
    expect(pickOne(['x', 'y', 'z'], () => 0.99)).toBe('z');
  });
});
