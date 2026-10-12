import { chooseActivity, MUSIC, returnRecordBeats } from './activities';
import {
  createDangle,
  rebaseDangleAnchor,
  releaseDangle,
  sampleDanglePointer,
  stepDangle,
  type DangleState
} from './drag';
import { DOORWAY, doorstepX, doorwayEnterX } from './doorway';
import { clamp, defaultPhysicsConfig, stepPhysics } from './physics';
import { clampToWalk, slotStandX, type RoomLayout } from './room';
import { releaseSeats, takeSeat, type SeatState } from './seats';
import {
  releaseShelf,
  releaseShelfReservations,
  returnToShelf,
  slotHeldBy,
  takeFromShelf,
  type ShelfSlot
} from './shelf';
import type {
  AnimationName,
  CharacterDefinition,
  Facing,
  PhysicsBody,
  PhysicsConfig,
  Point,
  RoomRecord
} from './types';

/**
 * Two walking gears. Strolling ambles; an errand walks with intent, so going
 * to the shelf reads differently from drifting about. The softened stroll
 * acceleration matters as much as the lower top speed.
 */
// Acceleration and friction scale with speed, so reaching full pace and
// stopping take the same time whatever the gear's speed.
export const STROLL_PHYSICS_CONFIG: PhysicsConfig = {
  ...defaultPhysicsConfig,
  walkSpeed: 26.4,
  groundAcceleration: 132,
  groundFriction: 216
};
export const PURPOSEFUL_PHYSICS_CONFIG: PhysicsConfig = {
  ...defaultPhysicsConfig,
  walkSpeed: 38.4,
  groundAcceleration: defaultPhysicsConfig.groundAcceleration * 1.2,
  groundFriction: defaultPhysicsConfig.groundFriction * 1.2
};

export type Pace = 'stroll' | 'purposeful';

/** Slack on top of distance / speed before a walk is deemed hopeless. */
const WALK_ALLOWANCE_MS = 2_600;
/** Close enough to a walk's target to call it arrived. */
const ARRIVAL_SLACK_X = 2;
/** The pause after landing from a drop, before getting on with things. */
const LANDING_PAUSE_MS = 700;
/** Instant beats that can complete in one frame before the runner yields. */
const MAX_BEATS_PER_FRAME = 8;

/**
 * A single unit of intent. An activity is a queue of these, planned up front
 * and run to completion, so nobody re-decides what they are doing mid-stride.
 *
 * Adding a new kind of thing to do is usually just a new activity built from
 * these beats (see `activities.ts`). A new beat kind is only needed for a new
 * kind of *effect* — moving a record, a new pose with a side effect.
 */
export type Beat =
  | { kind: 'walk'; toX: number; pace: Pace }
  /** Stand still. `look` glances the other way halfway through. */
  | { kind: 'pause'; ms: number; look?: boolean; face?: Facing }
  /** Hold an animation in place, e.g. the crouch at the shelf. */
  | { kind: 'pose'; animation: AnimationName; ms: number }
  | { kind: 'take-from-shelf'; slot: number }
  | { kind: 'return-to-shelf' }
  /** The record rises out of a pocket over `MUSIC.pocketMs`. */
  | { kind: 'take-from-pocket'; record: RoomRecord }
  /** Whatever is in hand sinks back into a pocket over `MUSIC.pocketMs`. */
  | { kind: 'stow' }
  /** Flick the floor lamp to `on`; a no-op if someone already did. */
  | { kind: 'set-lamp'; on: boolean }
  | { kind: 'listen'; ms: number }
  /** Sit in a lounge seat they are standing in front of (and reserved). */
  | { kind: 'sit'; seat: number }
  | { kind: 'stand' };

export interface Plan {
  /** Which activity this came from, for debugging and recovery. */
  activity: string;
  beats: Beat[];
  index: number;
  started: boolean;
  beatStartedAt: number;
  beatUntil: number;
  lookFlipAt: number;
}

export interface CarriedRecord {
  record: RoomRecord;
  source: 'shelf' | 'pocket';
  /** When it came into hand; drives the pocket reveal. */
  takenAt: number;
  /** When it started back into the pocket, or null while held. */
  stowingAt: number | null;
}

/**
 * Leaving through the doorway, in three beats: land beside it, walk to it,
 * step through while it shuts. Each beat has to finish before the next starts,
 * or the whole thing collapses into a dissolve on the spot.
 */
export interface DoorwayExit {
  doorX: number;
  startedAt: number;
  phase: 'landing' | 'walking' | 'entering';
  /** When they reached the threshold; drives the shut and the fade. */
  enteredAt: number | null;
}

/**
 * Coming in through the door, the mirror of leaving: the door fades in shut,
 * swings open, they appear on the threshold, walk in, and it shuts behind
 * them once they are clear of the frame.
 */
export interface DoorwayArrival {
  /** When the door starts to appear. Later than creation when queued behind someone. */
  startedAt: number;
  /** When they were clear of the frame; the door shuts from here. */
  clearedAt: number | null;
}

export const DOORWAY_ARRIVAL = {
  /** The door fades in shut before it opens. */
  openAtMs: DOORWAY.fadeMs,
  openMs: 380,
  /** Fading in on the threshold once the door is open. */
  appearMs: 380,
  /** Clear of the frame by this much before the door shuts. */
  clearancePx: 4,
  shutMs: 380,
  /** A second arrival waits this long behind the first. */
  queueMs: 1_400
} as const;

/** When they step off the threshold and start walking in. */
const ARRIVAL_STEP_OUT_MS =
  DOORWAY_ARRIVAL.openAtMs + DOORWAY_ARRIVAL.openMs + DOORWAY_ARRIVAL.appearMs;

export const DOORWAY_EXIT = {
  /** Long enough to read as walking off, short enough not to feel stuck. */
  walkTimeoutMs: 6_000,
  /** A drop that never finds the floor still has to get on with it. */
  landingTimeoutMs: 1_600,
  arrivalSlackX: 3,
  /** Matches the door's shut so the two read as one motion. */
  fadeMs: DOORWAY_ARRIVAL.shutMs
} as const;

export interface PixelPersonRuntime {
  id: string;
  definition: CharacterDefinition;
  /**
   * True when this character was asked for by name rather than rolled. The
   * room re-rolls its ambient population freely; someone who clicked an
   * artist to summon them must not have them swapped out.
   */
  pinnedCharacter: boolean;
  body: PhysicsBody;
  facing: Facing;
  animation: AnimationName;
  animationStartedAt: number;
  /** When this person was created; recent arrivals may still be re-rolled. */
  spawnedAt: number;
  plan: Plan | null;
  /** Earliest time a music activity may be chosen again. */
  nextMusicAt: number;
  /** Image URLs played recently (newest last); avoided when choosing again. */
  recentRecords: string[];
  carrying: CarriedRecord | null;
  /**
   * The lounge seat they are sitting in. The body stays on the floor: the
   * `lounge` pose has their feet on the floor and hips in the cushion.
   */
  seated: { seat: number } | null;
  drag: DangleState | null;
  exit: DoorwayExit | null;
  /** Set while coming in through the door; cleared once it has shut behind them. */
  arrival: DoorwayArrival | null;
  /** Just arrived: their first plan is a record, the lamp and a seat. */
  settlingIn: boolean;
}

/** Shared furniture state a person can claim and must give back. */
export interface RoomFurnitureState {
  shelf: ShelfSlot[];
  seats: SeatState[];
}

/** The floor lamp. `changedAt` drives the glow fading in or out. */
export interface LampState {
  on: boolean;
  changedAt: number;
}

/** Everything a person needs to know about the room they are in. */
export interface RoomWorld extends RoomFurnitureState {
  room: RoomLayout;
  lamp: LampState;
  people: readonly PixelPersonRuntime[];
  /** Records seen this session, for pulling out of pockets. */
  crate: readonly RoomRecord[];
  random: () => number;
}

export function createPixelPerson(
  definition: CharacterDefinition,
  x: number,
  room: RoomLayout,
  now: number,
  id: string,
  pinnedCharacter = false,
  firstMusicDelayMs = 0
): PixelPersonRuntime {
  return {
    id,
    definition,
    pinnedCharacter,
    body: {
      x: clampToWalk(room, x, definition.body.width),
      y: room.floorY - definition.body.height,
      width: definition.body.width,
      height: definition.body.height,
      vx: 0,
      vy: 0,
      grounded: true
    },
    facing: 1,
    animation: 'idle',
    animationStartedAt: now,
    spawnedAt: now,
    plan: newPlan('arrive', [{ kind: 'pause', ms: 900 }]),
    nextMusicAt: now + firstMusicDelayMs,
    recentRecords: [],
    carrying: null,
    seated: null,
    drag: null,
    exit: null,
    arrival: null,
    settlingIn: false
  };
}

/**
 * Brings a new person in through the door: standing in the opening, invisible
 * until the door has opened. Their first plan is chosen as they step out, and
 * it is always the settle-in: a record, the lamp, a seat.
 */
export function enterThroughDoor(
  person: PixelPersonRuntime,
  room: RoomLayout,
  startAt: number
): void {
  person.body.x = doorwayEnterX(room, person.body.width);
  person.body.y = room.floorY - person.body.height;
  // The door is on the right wall, so they come in facing left.
  person.facing = -1;
  person.arrival = { startedAt: startAt, clearedAt: null };
  person.settlingIn = true;
  person.plan = null;
}

/**
 * When the next arrival may start: straight away, or queued behind whoever is
 * already coming in, so two people never appear in the doorway together.
 */
export function nextArrivalStart(people: readonly PixelPersonRuntime[], now: number): number {
  let start = now;
  for (const person of people) {
    if (person.arrival) {
      start = Math.max(start, person.arrival.startedAt + DOORWAY_ARRIVAL.queueMs);
    }
  }
  return start;
}

/** 0 while an arrival is behind the door, 1 once they are fully in view. */
export function arrivalAppear(person: PixelPersonRuntime, now: number): number {
  if (!person.arrival) return 1;
  const visibleFrom = person.arrival.startedAt + DOORWAY_ARRIVAL.openAtMs + DOORWAY_ARRIVAL.openMs;
  return clamp((now - visibleFrom) / DOORWAY_ARRIVAL.appearMs, 0, 1);
}

/**
 * How open this person needs the door, 0 (shut) to 1 (open), or null when
 * they have no business with it. The room takes the most open of everyone's.
 */
export function doorOpenness(person: PixelPersonRuntime, now: number): number | null {
  if (person.exit) return person.exit.enteredAt === null ? 1 : 1 - doorwayExitFade(person, now);
  const arrival = person.arrival;
  if (!arrival) return null;
  const elapsed = now - arrival.startedAt;
  if (elapsed < DOORWAY_ARRIVAL.openAtMs) return 0;
  if (arrival.clearedAt === null) {
    return clamp((elapsed - DOORWAY_ARRIVAL.openAtMs) / DOORWAY_ARRIVAL.openMs, 0, 1);
  }
  return 1 - clamp((now - arrival.clearedAt) / DOORWAY_ARRIVAL.shutMs, 0, 1);
}

function clearOfDoor(person: PixelPersonRuntime, room: RoomLayout): boolean {
  const margin = DOORWAY_ARRIVAL.clearancePx;
  return (
    person.body.x >= room.door.x + room.door.width + margin ||
    person.body.x + person.body.width <= room.door.x - margin
  );
}

/**
 * Advances an arrival. Returns true while they are still waiting behind the
 * door, which means they do nothing else this frame.
 */
function updateArrival(person: PixelPersonRuntime, room: RoomLayout, now: number): boolean {
  const arrival = person.arrival!;
  if (now - arrival.startedAt < ARRIVAL_STEP_OUT_MS) {
    person.body.vx = 0;
    setAnimation(person, 'idle', now);
    return true;
  }
  if (arrival.clearedAt === null && clearOfDoor(person, room)) arrival.clearedAt = now;
  if (arrival.clearedAt !== null && now - arrival.clearedAt >= DOORWAY_ARRIVAL.shutMs) {
    person.arrival = null;
  }
  return false;
}

function newPlan(activity: string, beats: Beat[]): Plan {
  return {
    activity,
    beats,
    index: 0,
    started: false,
    beatStartedAt: 0,
    beatUntil: 0,
    lookFlipAt: 0
  };
}

/** The beat a person is currently running, if any. */
export function currentBeat(person: PixelPersonRuntime): Beat | null {
  const plan = person.plan;
  if (!plan || !plan.started) return null;
  return plan.beats[plan.index] ?? null;
}

/** When the current listen began, or null when they are not listening. */
export function listeningSince(person: PixelPersonRuntime): number | null {
  return currentBeat(person)?.kind === 'listen' ? (person.plan?.beatStartedAt ?? null) : null;
}

/**
 * Advances one person by one frame. Returns false once they have walked out
 * through the door, which is how the room owner learns to drop them.
 */
export function stepPixelPerson(
  person: PixelPersonRuntime,
  world: RoomWorld,
  elapsedSeconds: number,
  now: number
): boolean {
  const dt = clamp(elapsedSeconds, 0, 1 / 20);
  if (person.drag) {
    const result = stepDangle(person.drag, person.body, dt);
    person.drag = result.state;
    person.body = result.body;
    return true;
  }
  if (person.exit) return updateDoorwayExit(person, world.room, dt, now);
  if (person.arrival && updateArrival(person, world.room, now)) return true;

  // Airborne (just let go of): fall, land, take a breath, then carry on.
  if (!person.body.grounded) {
    move(person, world.room, 0, dt, PURPOSEFUL_PHYSICS_CONFIG);
    if (person.body.grounded) {
      person.plan = newPlan('land', [{ kind: 'pause', ms: LANDING_PAUSE_MS }]);
    }
    setLocomotionAnimation(person, now);
    return true;
  }

  for (let guard = 0; guard < MAX_BEATS_PER_FRAME; guard += 1) {
    if (!person.plan || person.plan.index >= person.plan.beats.length) {
      const next = chooseActivity(person, world, now);
      person.plan = newPlan(next.activity, next.beats);
    }
    const plan = person.plan;
    const beat = plan.beats[plan.index];
    if (!plan.started && !startBeat(person, world, beat, now)) {
      abortPlan(person, world);
      continue;
    }
    const status = beatStatus(person, beat, now);
    if (status === 'running') break;
    if (status === 'failed') {
      abortPlan(person, world);
      continue;
    }
    finishBeat(person, beat);
  }

  const beat = currentBeat(person);
  let moveX: -1 | 0 | 1 = 0;
  let config = STROLL_PHYSICS_CONFIG;
  if (beat?.kind === 'walk') {
    moveX = walkDirection(person, beat.toX);
    if (moveX !== 0) person.facing = moveX;
    if (beat.pace === 'purposeful') config = PURPOSEFUL_PHYSICS_CONFIG;
  }
  const plan = person.plan;
  if (plan && plan.lookFlipAt > 0 && now >= plan.lookFlipAt) {
    plan.lookFlipAt = 0;
    person.facing = person.facing === 1 ? -1 : 1;
  }
  move(person, world.room, moveX, dt, config);

  if (beat?.kind === 'pose') setAnimation(person, beat.animation, now);
  // Seated, they lounge (headphones on, since a seat is only ever taken to
  // listen); on the floor the cross-legged listening pose.
  else if (person.seated) setAnimation(person, 'lounge', now);
  else if (beat?.kind === 'listen') setAnimation(person, 'listen', now);
  else setLocomotionAnimation(person, now);
  return true;
}

function move(
  person: PixelPersonRuntime,
  room: RoomLayout,
  moveX: -1 | 0 | 1,
  dt: number,
  config: PhysicsConfig
): void {
  person.body = stepPhysics(person.body, { moveX }, room.colliders, dt, config);
}

function walkDirection(person: PixelPersonRuntime, toX: number): -1 | 0 | 1 {
  if (toX > person.body.x + ARRIVAL_SLACK_X) return 1;
  if (toX < person.body.x - ARRIVAL_SLACK_X) return -1;
  return 0;
}

/**
 * A walk's budget is derived from the distance at its own pace, so slowing
 * people down can never turn a legitimate walk into a timeout.
 */
export function walkBudgetMs(fromX: number, toX: number, pace: Pace): number {
  const speed =
    pace === 'purposeful'
      ? PURPOSEFUL_PHYSICS_CONFIG.walkSpeed
      : STROLL_PHYSICS_CONFIG.walkSpeed;
  return (Math.abs(toX - fromX) / speed) * 1_000 + WALK_ALLOWANCE_MS;
}

/** Applies a beat's entry effects. False when the beat cannot happen. */
function startBeat(
  person: PixelPersonRuntime,
  world: RoomWorld,
  beat: Beat,
  now: number
): boolean {
  const plan = person.plan!;
  plan.started = true;
  plan.beatStartedAt = now;
  plan.beatUntil = now;
  plan.lookFlipAt = 0;
  switch (beat.kind) {
    case 'walk': {
      standUp(person, world);
      beat.toX = clampToWalk(world.room, beat.toX, person.body.width);
      plan.beatUntil = now + walkBudgetMs(person.body.x, beat.toX, beat.pace);
      return true;
    }
    case 'pause':
      plan.beatUntil = now + beat.ms;
      if (beat.face) person.facing = beat.face;
      if (beat.look) plan.lookFlipAt = now + beat.ms / 2;
      return true;
    case 'pose':
    case 'listen':
      if (beat.kind === 'listen' && !person.carrying) return false;
      plan.beatUntil = now + beat.ms;
      return true;
    case 'take-from-shelf': {
      const record = takeFromShelf(world.shelf, beat.slot, person.id);
      if (!record) return false;
      person.carrying = { record, source: 'shelf', takenAt: now, stowingAt: null };
      rememberPlayed(person, record);
      return true;
    }
    case 'return-to-shelf':
      // A slot that vanished (the room resized) leaves nowhere to put it;
      // the record simply goes into a pocket instead.
      if (person.carrying?.source === 'shelf') returnToShelf(world.shelf, person.id);
      person.carrying = null;
      return true;
    case 'take-from-pocket':
      person.carrying = { record: beat.record, source: 'pocket', takenAt: now, stowingAt: null };
      rememberPlayed(person, beat.record);
      plan.beatUntil = now + MUSIC.pocketMs;
      return true;
    case 'stow':
      if (!person.carrying) return true;
      // Anything from the shelf goes back there first; stowing is for pockets.
      if (person.carrying.source === 'shelf') releaseShelf(world.shelf, person.id);
      person.carrying.stowingAt = now;
      plan.beatUntil = now + MUSIC.pocketMs;
      return true;
    case 'sit': {
      if (!takeSeat(world.seats, beat.seat, person.id)) return false;
      person.seated = { seat: beat.seat };
      person.facing = world.room.seats[beat.seat]?.facing ?? person.facing;
      person.body.vx = 0;
      return true;
    }
    case 'stand':
      standUp(person, world);
      return true;
    case 'set-lamp':
      if (world.lamp.on !== beat.on) {
        world.lamp.on = beat.on;
        world.lamp.changedAt = now;
      }
      return true;
  }
}

/** Gets up from their seat. Only a seat they are in: a reservation they are walking to stands. */
function standUp(person: PixelPersonRuntime, world: RoomFurnitureState): void {
  if (!person.seated) return;
  releaseSeats(world.seats, person.id);
  person.seated = null;
}

/**
 * Gives back everything this person had claimed: a shelf record pops back into
 * its slot, reservations lapse, and their seat is free.
 */
export function releaseFurniture(furniture: RoomFurnitureState, personId: string): void {
  releaseShelf(furniture.shelf, personId);
  releaseSeats(furniture.seats, personId);
}

/** Remembered so the next pick prefers something different. */
export const RECENT_RECORD_MEMORY = 4;

function rememberPlayed(person: PixelPersonRuntime, record: RoomRecord): void {
  person.recentRecords = [
    ...person.recentRecords.filter((url) => url !== record.imageUrl),
    record.imageUrl
  ].slice(-RECENT_RECORD_MEMORY);
}

function beatStatus(
  person: PixelPersonRuntime,
  beat: Beat,
  now: number
): 'running' | 'done' | 'failed' {
  if (beat.kind === 'walk') {
    if (walkDirection(person, beat.toX) === 0) return 'done';
    return now >= person.plan!.beatUntil ? 'failed' : 'running';
  }
  return now >= person.plan!.beatUntil ? 'done' : 'running';
}

function finishBeat(person: PixelPersonRuntime, beat: Beat): void {
  if (beat.kind === 'stow') person.carrying = null;
  const plan = person.plan!;
  plan.index += 1;
  plan.started = false;
  plan.lookFlipAt = 0;
}

/**
 * Drops a plan that cannot continue. Someone holding a shelf record walks it
 * back rather than pocketing the room's albums; a second failure on that way
 * back gives up and pockets it, so recovery cannot loop.
 */
function abortPlan(person: PixelPersonRuntime, world: RoomWorld): void {
  const failed = person.plan?.activity;
  releaseShelfReservations(world.shelf, person.id);
  releaseSeats(world.seats, person.id);
  person.seated = null;
  const slot = slotHeldBy(world.shelf, person.id);
  if (person.carrying?.source === 'shelf' && slot >= 0 && failed !== 'return-record') {
    person.plan = newPlan(
      'return-record',
      returnRecordBeats(slotStandX(world.room, slot, person.body.width), 'purposeful')
    );
    return;
  }
  if (person.carrying) {
    person.plan = newPlan('pocket-record', [{ kind: 'stow' }]);
    return;
  }
  releaseShelf(world.shelf, person.id);
  person.plan = null;
}

/** From the hand to the body's centre: the pendulum's length while held. */
function dragLength(definition: CharacterDefinition): number {
  const bodyCenterY = definition.body.offsetY + definition.body.height / 2;
  return bodyCenterY - definition.dragGrip.y * definition.scale;
}

export function beginPixelPersonDrag(
  person: PixelPersonRuntime,
  furniture: RoomFurnitureState,
  pointerId: number,
  anchor: Point,
  now: number
): void {
  // Being picked up interrupts everything. A shelf record pops back into its
  // slot, a pocket record goes back in the pocket, and the seat is free.
  releaseFurniture(furniture, person.id);
  person.seated = null;
  person.carrying = null;
  person.arrival = null;
  person.settlingIn = false;
  person.plan = null;
  person.drag = createDangle(pointerId, anchor, person.body, dragLength(person.definition), now);
  const result = stepDangle(person.drag, person.body, 0);
  person.drag = result.state;
  person.body = result.body;
  setAnimation(person, 'dangle', now);
}

export function moveDraggedPixelPerson(
  person: PixelPersonRuntime,
  pointerId: number,
  anchor: Point,
  now: number
): boolean {
  if (!person.drag || person.drag.pointerId !== pointerId) return false;
  person.drag = sampleDanglePointer(person.drag, anchor, now);
  return true;
}

export function rebaseDraggedPixelPerson(
  person: PixelPersonRuntime,
  pointerId: number,
  anchor: Point,
  now: number
): boolean {
  if (!person.drag || person.drag.pointerId !== pointerId) return false;
  person.drag = rebaseDangleAnchor(person.drag, anchor, now);
  return true;
}

/** Lets go: they keep the swing's momentum, inside the room, and fall. */
export function releasePixelPersonDrag(
  person: PixelPersonRuntime,
  room: RoomLayout,
  pointerId: number,
  now: number
): boolean {
  if (!person.drag || person.drag.pointerId !== pointerId) return false;
  const released = releaseDangle(person.drag, person.body);
  person.body = containBody(released, room);
  person.drag = null;
  person.plan = null;
  if (Math.abs(person.body.vx) > 20) person.facing = person.body.vx < 0 ? -1 : 1;
  setAnimation(person, person.body.vy < -20 ? 'jump' : 'fall', now);
  return true;
}

/** Clamps a body inside the room's walls, above its floor and below its ceiling. */
function containBody(body: PhysicsBody, room: RoomLayout): PhysicsBody {
  return {
    ...body,
    x: clamp(body.x, 0, Math.max(0, room.width - body.width)),
    y: clamp(body.y, 0, room.floorY - body.height)
  };
}

/**
 * Sends someone off through the doorway: they are set down beside it, walk to
 * it and fade on the threshold while it shuts. The reader asked for them to
 * leave, not to be erased mid-stride.
 */
export function beginDoorwayExit(person: PixelPersonRuntime, room: RoomLayout, now: number): void {
  person.drag = null;
  person.plan = null;
  person.carrying = null;
  person.seated = null;
  person.arrival = null;
  const doorX = doorwayEnterX(room, person.body.width);
  person.body = {
    ...person.body,
    x: doorstepX(room, person.body.width),
    y: room.floorY - person.body.height - DOORWAY.dropHeight,
    vx: 0,
    vy: 0,
    grounded: false
  };
  person.exit = { doorX, startedAt: now, phase: 'landing', enteredAt: null };
  person.facing = doorX >= person.body.x ? 1 : -1;
  setLocomotionAnimation(person, now);
}

/** 0 while solid, 1 once fully faded; the room owner removes them at 1. */
export function doorwayExitFade(person: PixelPersonRuntime, now: number): number {
  const enteredAt = person.exit?.enteredAt;
  if (enteredAt === null || enteredAt === undefined) return 0;
  return clamp((now - enteredAt) / DOORWAY_EXIT.fadeMs, 0, 1);
}

/** True while anyone is coming in or going out, so the door stays up for them. */
export function isUsingDoor(people: readonly PixelPersonRuntime[]): boolean {
  return people.some((person) => person.exit !== null || person.arrival !== null);
}

function updateDoorwayExit(
  person: PixelPersonRuntime,
  room: RoomLayout,
  dt: number,
  now: number
): boolean {
  const exit = person.exit!;
  if (exit.phase === 'entering') {
    person.body.vx = 0;
    return doorwayExitFade(person, now) < 1;
  }
  if (exit.phase === 'landing') {
    move(person, room, 0, dt, PURPOSEFUL_PHYSICS_CONFIG);
    if (person.body.grounded || now - exit.startedAt >= DOORWAY_EXIT.landingTimeoutMs) {
      exit.phase = 'walking';
      exit.startedAt = now;
      person.facing = exit.doorX >= person.body.x ? 1 : -1;
    }
    setLocomotionAnimation(person, now);
    return true;
  }
  // Arrival, or a walk that never got there — either way they leave, because
  // the reader already decided that.
  if (
    Math.abs(person.body.x - exit.doorX) <= DOORWAY_EXIT.arrivalSlackX ||
    now - exit.startedAt >= DOORWAY_EXIT.walkTimeoutMs
  ) {
    exit.phase = 'entering';
    exit.enteredAt = now;
    person.body.vx = 0;
    setAnimation(person, 'idle', now);
    return true;
  }
  const moveX = walkDirection(person, exit.doorX);
  if (moveX !== 0) person.facing = moveX;
  move(person, room, moveX, dt, STROLL_PHYSICS_CONFIG);
  setLocomotionAnimation(person, now);
  return true;
}

/**
 * Brings someone into a different room (a navigation mounted a new one) as
 * themselves: same character, same id, standing on the new floor near the
 * same relative spot. Whatever they were doing belonged to the old room, so
 * it is dropped. Returns false for someone who was on their way out.
 */
export function settleIntoRoom(
  person: PixelPersonRuntime,
  previousWidth: number,
  room: RoomLayout,
  now: number
): boolean {
  if (person.exit) return false;
  const relative = previousWidth > 0 ? person.body.x / previousWidth : 0.5;
  person.body = {
    ...person.body,
    x: clampToWalk(room, relative * room.width, person.body.width),
    y: room.floorY - person.body.height,
    vx: 0,
    vy: 0,
    grounded: true
  };
  person.drag = null;
  person.carrying = null;
  person.seated = null;
  person.arrival = null;
  person.plan = newPlan('arrive', [{ kind: 'pause', ms: 600 }]);
  setAnimation(person, 'idle', now);
  return true;
}

/**
 * Swaps a live person's character while keeping their feet and horizontal
 * centre fixed. Definitions may use different body boxes.
 */
export function setPersonDefinition(
  person: PixelPersonRuntime,
  definition: CharacterDefinition
): void {
  if (person.definition.id === definition.id) return;
  const centerX = person.body.x + person.body.width / 2;
  const feetY = person.body.y + person.body.height;
  person.definition = definition;
  person.body.width = definition.body.width;
  person.body.height = definition.body.height;
  person.body.x = centerX - definition.body.width / 2;
  person.body.y = feetY - definition.body.height;
  if (person.drag) person.drag.length = Math.max(8, dragLength(definition));
}

function setLocomotionAnimation(person: PixelPersonRuntime, now: number): void {
  if (!person.body.grounded) {
    setAnimation(person, person.body.vy < 0 ? 'jump' : 'fall', now);
  } else if (Math.abs(person.body.vx) > 3) {
    setAnimation(person, 'walk', now);
  } else {
    setAnimation(person, 'idle', now);
  }
}

function setAnimation(person: PixelPersonRuntime, animation: AnimationName, now: number): void {
  if (person.animation === animation) return;
  person.animation = animation;
  person.animationStartedAt = now;
}
