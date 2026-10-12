import { normalizeArtistName } from './artist-name';
import { doorstepX } from './doorway';
import { clamp } from './physics';
import { pickOne, weightedPick } from './random';
import {
  chooseOpenSpot,
  lampReach,
  seatStandX,
  SETTLE_DISTANCE,
  slotStandX,
  walkRange
} from './room';
import { freeSeats, reserveSeat } from './seats';
import { availableSlots, reserveSlot } from './shelf';
import type { Beat, PixelPersonRuntime, RoomWorld } from './simulation';
import type { RoomRecord } from './types';

/**
 * Everything a person can decide to do in the room.
 *
 * An activity is a weight and a plan. The weight says how much they feel like
 * it right now (0 rules it out); the plan is the queue of beats they will run
 * to completion. To add something new for people to do, write one of these
 * and append it to `ACTIVITIES` — the beat runner in `simulation.ts` does the
 * rest. Every duration lives in a named block so retuning is a no-logic
 * change.
 */
export interface Activity {
  id: string;
  weight(person: PixelPersonRuntime, world: RoomWorld, now: number): number;
  /** Null when, on closer inspection, it cannot happen after all. */
  plan(person: PixelPersonRuntime, world: RoomWorld, now: number): Beat[] | null;
}

/** Wandering about between pauses — what people do most of the time. */
export const ROUTINE = {
  restMinMs: 3_000,
  restJitterMs: 5_000,
  lookMinMs: 4_000,
  lookJitterMs: 6_000,
  legMinDistance: 40,
  legJitterDistance: 120,
  /** Chance a stroll gets a second leg rather than ending after one. */
  extraLegChance: 0.35,
  /** Chance a second leg carries on the same way instead of doubling back. */
  continueBias: 0.6,
  /** Below this a leg is not worth walking; the beat is dropped. */
  minWorthwhileLeg: 8
} as const;

/** Listening to records, from the shelf or a pocket. */
export const MUSIC = {
  /** A new arrival settles in before reaching for music. */
  firstDelayMs: 8_000,
  /**
   * Between one record and the next. Counted from when the plan starts, so it
   * has to cover the listen itself plus a spell of doing something else.
   */
  cooldownMs: 65_000,
  cooldownJitterMs: 30_000,
  /** Standing at the shelf looking before crouching for one. */
  browseMinMs: 1_200,
  browseJitterMs: 1_400,
  /** Crouch before the record moves, then the rest of the crouch after. */
  crouchMs: 420,
  riseMs: 320,
  /** Once sat down with a record, they stay a while: 30s at least. */
  listenMinMs: 30_000,
  listenJitterMs: 30_000,
  /** The record rising out of, or sinking into, a pocket. */
  pocketMs: 380,
  /** A beat after sitting back up, before putting the record away. */
  settleMs: 700,
  /** Weights while music is off cooldown; the stroll weighs 1. */
  shelfWeight: 1.6,
  pocketWeight: 0.6,
  /** An artist with their own record to hand reaches for it more often. */
  ownPocketWeight: 1.4
} as const;

/**
 * The lounge is for listening. The only seated pose wears headphones, so a
 * seat is only ever taken with a record in hand (or on its way out of a
 * pocket) — sitting there empty-handed reads as listening to nothing.
 */
export const LOUNGE_TIMING = {
  /** Chance a record gets listened to on a free seat rather than standing. */
  seatedListenChance: 0.75
} as const;

/** The floor lamp beside the couch. */
export const LAMP = {
  /** Weights against the stroll's 1: on is wanted more than off. */
  switchOnWeight: 0.35,
  switchOffWeight: 0.12,
  /** One arm up to the shade and a small pull down; holds the last frame. */
  reachMs: 820,
  /** Chance a seated listen starts by switching the lamp on, when it is off. */
  beforeListenChance: 0.6
} as const;

function randomBetween(random: () => number, minimum: number, jitter: number): number {
  return minimum + random() * jitter;
}

function restBeat(random: () => number): Beat {
  return { kind: 'pause', ms: randomBetween(random, ROUTINE.restMinMs, ROUTINE.restJitterMs) };
}

function lookBeat(random: () => number): Beat {
  return {
    kind: 'pause',
    ms: randomBetween(random, ROUTINE.lookMinMs, ROUTINE.lookJitterMs),
    look: true
  };
}

function idleBeat(random: () => number): Beat {
  return random() < 0.5 ? restBeat(random) : lookBeat(random);
}

function otherPeopleX(person: PixelPersonRuntime, world: RoomWorld): number[] {
  return world.people.filter((other) => other !== person).map((other) => other.body.x);
}

export const stroll: Activity = {
  id: 'stroll',
  weight: () => 1,
  plan(person, world) {
    const { random } = world;
    const { minX, maxX } = walkRange(world.room, person.body.width);
    const beats: Beat[] = [];
    let cursorX = person.body.x;
    let direction: 1 | -1 = random() < 0.5 ? -1 : 1;
    const legs = random() < ROUTINE.extraLegChance ? 2 : 1;
    for (let leg = 0; leg < legs; leg += 1) {
      if (leg > 0 && random() >= ROUTINE.continueBias) direction = direction === 1 ? -1 : 1;
      const distance = ROUTINE.legMinDistance + random() * ROUTINE.legJitterDistance;
      let goalX = clamp(cursorX + distance * direction, minX, maxX);
      if (Math.abs(goalX - cursorX) < ROUTINE.minWorthwhileLeg) {
        // Against a wall: turning around is the only way to travel.
        direction = direction === 1 ? -1 : 1;
        goalX = clamp(cursorX + distance * direction, minX, maxX);
      }
      if (Math.abs(goalX - cursorX) >= ROUTINE.minWorthwhileLeg) {
        beats.push({ kind: 'walk', toX: goalX, pace: 'stroll' });
        cursorX = goalX;
      }
      beats.push(idleBeat(random));
    }
    return beats;
  }
};

/** True when the record is by the artist with this (already normalised) key. */
function isOwnRecord(key: string | undefined, record: RoomRecord | null | undefined): boolean {
  return Boolean(key && record?.artistName && normalizeArtistName(record.artistName) === key);
}

/**
 * Which shelf slot to go for: an artist goes for their own record when one is
 * shelved; otherwise something not played recently, from the nearest few so
 * nobody crosses the room for an arbitrary pick. A newcomer has no "nearest",
 * so `anywhere` takes any record on the shelf.
 */
export function chooseShelfSlot(
  person: PixelPersonRuntime,
  world: RoomWorld,
  anywhere = false
): number | null {
  const open = availableSlots(world.shelf);
  if (open.length === 0) return null;
  const key = person.definition.artistKey;
  const own = open.filter((index) => isOwnRecord(key, world.shelf[index].record));
  if (own.length > 0) return pickOne(own, world.random);
  const fresh = open.filter(
    (index) => !person.recentRecords.includes(world.shelf[index].record!.imageUrl)
  );
  const pool = fresh.length > 0 ? fresh : open;
  if (anywhere) return pickOne(pool, world.random);
  const nearest = pool
    .map((index) => ({
      index,
      distance: Math.abs(slotStandX(world.room, index, person.body.width) - person.body.x)
    }))
    .sort((left, right) => left.distance - right.distance)
    .slice(0, 3);
  return pickOne(nearest, world.random).index;
}

/** A record to pull out of a pocket: their own if they are an artist. */
export function choosePocketRecord(
  person: PixelPersonRuntime,
  crate: readonly RoomRecord[],
  random: () => number
): RoomRecord | null {
  if (crate.length === 0) return null;
  const key = person.definition.artistKey;
  const own = crate.filter((record) => isOwnRecord(key, record));
  const candidates = own.length > 0 ? own : crate;
  const fresh = candidates.filter((record) => !person.recentRecords.includes(record.imageUrl));
  return pickOne(fresh.length > 0 ? fresh : candidates, random);
}

function startMusicCooldown(person: PixelPersonRuntime, world: RoomWorld, now: number): void {
  person.nextMusicAt =
    now + randomBetween(world.random, MUSIC.cooldownMs, MUSIC.cooldownJitterMs);
}

function listenBeats(world: RoomWorld): Beat[] {
  return [
    { kind: 'pause', ms: MUSIC.settleMs },
    { kind: 'listen', ms: randomBetween(world.random, MUSIC.listenMinMs, MUSIC.listenJitterMs) },
    { kind: 'pause', ms: MUSIC.settleMs }
  ];
}

/**
 * Walk a shelf record back to its slot and put it away. Shared by the end of a
 * shelf listen and by the recovery when a plan is abandoned mid-errand.
 */
export function returnRecordBeats(standX: number, pace: 'stroll' | 'purposeful'): Beat[] {
  return [
    { kind: 'walk', toX: standX, pace },
    { kind: 'pose', animation: 'hide', ms: MUSIC.crouchMs },
    { kind: 'return-to-shelf' },
    { kind: 'pose', animation: 'hide', ms: MUSIC.riseMs }
  ];
}

/**
 * Claims the free seat nearest to `fromX`, or null when the lounge is full.
 * Nearest rather than random, so nobody walks past an empty seat to another.
 */
export function claimNearestSeat(
  person: PixelPersonRuntime,
  world: RoomWorld,
  fromX: number
): number | null {
  const width = person.body.width;
  const seat = freeSeats(world.seats).sort(
    (left, right) =>
      Math.abs(seatStandX(world.room, left, width) - fromX) -
      Math.abs(seatStandX(world.room, right, width) - fromX)
  )[0];
  if (seat === undefined || !reserveSeat(world.seats, seat, person.id)) return null;
  return seat;
}

/** Walk to the lamp, reach up to the shade, and switch it `on` or off. */
function lampBeats(person: PixelPersonRuntime, world: RoomWorld, on: boolean): Beat[] {
  const reach = lampReach(world.room, person.body.width);
  if (!reach) return [];
  return [
    { kind: 'walk', toX: reach.standX, pace: 'stroll' },
    { kind: 'pause', ms: 400, face: reach.facing },
    { kind: 'pose', animation: 'reach', ms: LAMP.reachMs },
    { kind: 'set-lamp', on },
    { kind: 'pause', ms: 500 }
  ];
}

/** True when someone already has a trip to the lamp planned. */
function lampSpokenFor(world: RoomWorld): boolean {
  return world.people.some((other) =>
    other.plan?.beats.slice(other.plan.index).some((beat) => beat.kind === 'set-lamp')
  );
}

/**
 * Wraps `inner` (beats done with a record in hand) in a seat, when the mood
 * takes them and one is free, switching the lamp on first when it is off.
 * Someone settling in (`eager`) always takes a free seat and always lights
 * the lamp. Null when they will listen standing.
 */
function seatedListen(
  person: PixelPersonRuntime,
  world: RoomWorld,
  fromX: number,
  inner: Beat[],
  eager: boolean
): Beat[] | null {
  if (!eager && world.random() >= LOUNGE_TIMING.seatedListenChance) return null;
  const seat = claimNearestSeat(person, world, fromX);
  if (seat === null) return null;
  const lightFirst =
    !world.lamp.on &&
    !lampSpokenFor(world) &&
    (eager || world.random() < LAMP.beforeListenChance);
  return [
    ...(lightFirst ? lampBeats(person, world, true) : []),
    { kind: 'walk', toX: seatStandX(world.room, seat, person.body.width), pace: 'stroll' },
    { kind: 'sit', seat },
    ...inner,
    { kind: 'stand' }
  ];
}

/**
 * Browse the shelf, crouch for a record, take it to a seat (or somewhere with
 * a bit of room), listen, then walk it back and put it where it came from.
 */
export const shelfListen: Activity = {
  id: 'shelf-listen',
  weight(person, world, now) {
    if (now < person.nextMusicAt || person.carrying) return 0;
    return availableSlots(world.shelf).length > 0 ? MUSIC.shelfWeight : 0;
  },
  plan: (person, world, now) => planShelfListen(person, world, now, false)
};

function planShelfListen(
  person: PixelPersonRuntime,
  world: RoomWorld,
  now: number,
  eager: boolean
): Beat[] | null {
  const slot = chooseShelfSlot(person, world, eager);
  if (slot === null || !reserveSlot(world.shelf, slot, person.id)) return null;
  startMusicCooldown(person, world, now);
  const standX = slotStandX(world.room, slot, person.body.width);
  const listen = listenBeats(world);
  const somewhere =
    seatedListen(person, world, standX, listen, eager) ?? [
      {
        kind: 'walk',
        toX: chooseOpenSpot(world.room, person.body.width, standX, otherPeopleX(person, world), world.random, {
          avoidFurniture: true,
          preferredDistance: SETTLE_DISTANCE
        }),
        pace: 'purposeful'
      },
      ...listen
    ];
  return [
    { kind: 'walk', toX: standX, pace: 'purposeful' },
    { kind: 'pause', ms: randomBetween(world.random, MUSIC.browseMinMs, MUSIC.browseJitterMs) },
    { kind: 'pose', animation: 'hide', ms: MUSIC.crouchMs },
    { kind: 'take-from-shelf', slot },
    { kind: 'pose', animation: 'hide', ms: MUSIC.riseMs },
    ...somewhere,
    ...returnRecordBeats(standX, 'stroll'),
    restBeat(world.random)
  ];
}

/** No shelf trip: a record comes out of a pocket, gets a listen, goes back. */
export const pocketListen: Activity = {
  id: 'pocket-listen',
  weight(person, world, now) {
    if (now < person.nextMusicAt || person.carrying || world.crate.length === 0) return 0;
    const key = person.definition.artistKey;
    return world.crate.some((record) => isOwnRecord(key, record))
      ? MUSIC.ownPocketWeight
      : MUSIC.pocketWeight;
  },
  plan: (person, world, now) => planPocketListen(person, world, now, false)
};

function planPocketListen(
  person: PixelPersonRuntime,
  world: RoomWorld,
  now: number,
  eager: boolean
): Beat[] | null {
  const record = choosePocketRecord(person, world.crate, world.random);
  if (!record) return null;
  startMusicCooldown(person, world, now);
  // The stow is the last thing before they get up, so nobody sits on with
  // headphones and nothing to play.
  const inner: Beat[] = [
    { kind: 'take-from-pocket', record },
    ...listenBeats(world),
    { kind: 'stow' }
  ];
  return [
    ...(seatedListen(person, world, person.body.x, inner, eager) ?? inner),
    restBeat(world.random)
  ];
}

/**
 * The first thing anyone does after coming through the door: a record off
 * the shelf (or out of a pocket when the shelf is bare), the lamp on, a seat,
 * a listen. It starts by stepping clear of the doorway so the door can shut.
 * Null when there is no music to be had at all.
 */
export function settleInPlan(
  person: PixelPersonRuntime,
  world: RoomWorld,
  now: number
): Beat[] | null {
  const plan =
    planShelfListen(person, world, now, true) ?? planPocketListen(person, world, now, true);
  if (!plan) return null;
  return [{ kind: 'walk', toX: doorstepX(world.room, person.body.width), pace: 'stroll' }, ...plan];
}

/** Go and switch the lamp: on, usually, and now and then off again. */
export const lampSwitch: Activity = {
  id: 'lamp',
  weight(person, world) {
    if (person.carrying || !lampReach(world.room, person.body.width)) return 0;
    if (lampSpokenFor(world)) return 0;
    return world.lamp.on ? LAMP.switchOffWeight : LAMP.switchOnWeight;
  },
  plan(person, world) {
    const beats = lampBeats(person, world, !world.lamp.on);
    return beats.length > 0 ? [...beats, restBeat(world.random)] : null;
  }
};

/** Selection is weighted random; order only matters as the roll's tie-break. */
export const ACTIVITIES: readonly Activity[] = [stroll, shelfListen, pocketListen, lampSwitch];

/**
 * Picks what to do next. A newcomer settles in first, always; after that it
 * is weighted. An activity whose plan turns out to be impossible is struck
 * off and the roll repeats; the stroll is always possible, so this always
 * returns something.
 */
export function chooseActivity(
  person: PixelPersonRuntime,
  world: RoomWorld,
  now: number,
  activities: readonly Activity[] = ACTIVITIES
): { activity: string; beats: Beat[] } {
  if (person.settlingIn) {
    person.settlingIn = false;
    const beats = settleInPlan(person, world, now);
    if (beats) return { activity: 'settle-in', beats };
  }
  const candidates = activities
    .map((activity) => [activity, activity.weight(person, world, now)] as const)
    .filter(([, weight]) => weight > 0);
  while (candidates.length > 0) {
    const activity = weightedPick(candidates, world.random);
    const beats = activity.plan(person, world, now);
    if (beats && beats.length > 0) return { activity: activity.id, beats };
    candidates.splice(
      candidates.findIndex(([candidate]) => candidate === activity),
      1
    );
  }
  return { activity: 'rest', beats: [restBeat(world.random)] };
}
