import type { CharacterDefinition } from './types';
import {
  createDangle,
  releaseDangle,
  rebaseDangleAnchor,
  resolveDroppedBody,
  sampleDanglePointer,
  stepDangle,
  type DangleState
} from './drag';
import {
  clamp,
  defaultPhysicsConfig,
  expandedRect,
  hasBodyClearance,
  intersects,
  SpatialHash,
  stepPhysics,
  withinBounds
} from './physics';
import type {
  AnimationName,
  Collider,
  DroppedRecord,
  Facing,
  ItemSource,
  Occluder,
  PhysicsBody,
  PhysicsConfig,
  PixelPersonCommand,
  PixelWorldEvent,
  Point,
  Rect,
  WorldGeometry
} from './types';

const CLIMB_SPEED = 31;
const MAX_CLIMB_HEIGHT = 190;
const MIN_MANTLE_DURATION_MS = 340;
const MAX_MANTLE_HORIZONTAL_SPEED = 52;
const EASE_IN_OUT_MAX_SLOPE = 1.5;
const CLIMB_VIEWPORT_MARGIN = 2;
const CRAWL_HEIGHT = 12;
/** Once stuckForMs reaches this, the world owner respawns the person. */
export const STUCK_RECOVERY_MS = 1_400;
/** A crawl that hasn't found a stand-up spot by then flags itself as stuck. */
const CRAWL_BAILOUT_MS = 12_000;
const CRAWL_PHYSICS_CONFIG: PhysicsConfig = {
  ...defaultPhysicsConfig,
  walkSpeed: 24,
  groundAcceleration: 190,
  airAcceleration: 90,
  groundFriction: 260,
  jumpSpeed: 0
};

const RECORD_ERRAND = {
  firstDelayMs: 12_000,
  cooldownMs: 30_000,
  cooldownJitterMs: 25_000,
  retryMs: 6_000,
  maxTravelDistance: 420,
  travelTimeoutMs: 12_000,
  stoopMs: 550,
  carryMinMs: 5_000,
  carryJitterMs: 10_000,
  deliverTimeoutMs: 20_000,
  listenMinMs: 8_000,
  listenJitterMs: 8_000,
  returnDelayMs: 6_000,
  returnJitterMs: 8_000,
  wallExitMargin: 24,
  arrivalSlackX: 5,
  arrivalSlackY: 46,
  driftChance: 0.35
} as const;

type Activity =
  | 'idle'
  | 'wander'
  | 'seek-hide'
  | 'hiding'
  | 'seek-record'
  | 'record-stoop'
  | 'listen'
  | 'climb'
  | 'mantle'
  | 'drag';

interface ClimbMotion {
  wall: Collider;
  top: Collider;
  side: 'left' | 'right';
  direction: 'up' | 'down';
  returnY: number | null;
}

interface MantleMotion {
  start: Point;
  end: Point;
  startedAt: number;
  supportId?: string;
  after?: ClimbMotion;
}

interface HideMotion {
  occluder: Occluder;
  original: Point;
  target: Point;
  startedAt: number;
}

interface PlannedClimb {
  top: Collider;
  wall: Collider;
  side: 'left' | 'right';
  goalX: number;
}

interface RecordErrand {
  sourceId: string;
  imageUrl: string;
}

interface RecordStoop {
  action: 'pickup' | 'place';
  startedAt: number;
}

interface ListenSession {
  startedAt: number;
  until: number;
}

interface CarriedRecord {
  sourceId: string;
  imageUrl: string;
  putDownAt: number;
  /** Where to march while still inside the record wall; set-down waits until outside. */
  deliverGoalX: number;
}

export interface PixelPersonRuntime {
  id: string;
  definition: CharacterDefinition;
  body: PhysicsBody;
  facing: Facing;
  animation: AnimationName;
  animationStartedAt: number;
  activity: Activity;
  activityUntil: number;
  goalX: number;
  stuckForMs: number;
  previousX: number;
  lastClimbAt: number;
  nextHideAt: number;
  nextRecordAt: number;
  lastRecordSourceId: string | null;
  climb: ClimbMotion | null;
  mantle: MantleMotion | null;
  hide: HideMotion | null;
  hiddenOccluderId: string | null;
  plannedClimb: PlannedClimb | null;
  recordErrand: RecordErrand | null;
  recordStoop: RecordStoop | null;
  listen: ListenSession | null;
  carrying: CarriedRecord | null;
  drag: DangleState | null;
  crawling: boolean;
  crawlingSince: number;
}

export function createPixelPerson(
  definition: CharacterDefinition,
  body: PhysicsBody,
  now: number,
  id = 'pixel-person-1'
): PixelPersonRuntime {
  return {
    id,
    definition,
    body,
    facing: 1,
    animation: 'idle',
    animationStartedAt: now,
    activity: 'idle',
    activityUntil: now + 900,
    goalX: body.x,
    stuckForMs: 0,
    previousX: body.x,
    lastClimbAt: now - 12_000,
    nextHideAt: now + 7_000,
    nextRecordAt: now + RECORD_ERRAND.firstDelayMs,
    lastRecordSourceId: null,
    climb: null,
    mantle: null,
    hide: null,
    hiddenOccluderId: null,
    plannedClimb: null,
    recordErrand: null,
    recordStoop: null,
    listen: null,
    carrying: null,
    drag: null,
    crawling: false,
    crawlingSince: 0
  };
}

export function stepPixelPerson(
  person: PixelPersonRuntime,
  geometry: WorldGeometry,
  spatial: SpatialHash,
  commands: PixelPersonCommand[],
  elapsedSeconds: number,
  now: number,
  events?: PixelWorldEvent[]
): PixelPersonRuntime | null {
  if (applyCommands(person, commands, now) === null) return null;

  const dt = Math.max(0, Math.min(elapsedSeconds, 1 / 20));
  if (person.activity === 'drag' && person.drag) {
    const result = stepDangle(person.drag, person.body, dt);
    person.drag = result.state;
    person.body = result.body;
    return person;
  }
  if (person.activity === 'mantle') {
    updateMantle(person, now);
    return person;
  }
  if (person.activity === 'climb') {
    updateClimb(person, dt, now);
    return person;
  }
  if (person.activity === 'hiding') {
    updateHiding(person, now);
    return person;
  }
  if (person.activity === 'record-stoop') {
    updateRecordStoop(person, geometry, now, events);
    return person;
  }
  if (person.activity === 'listen') {
    updateListening(person, now);
    return person;
  }
  if (person.crawling) {
    updateCrawl(person, geometry, spatial, dt, now);
    return person;
  }

  if (now >= person.activityUntil) chooseNextActivity(person, geometry, now);

  if (
    person.carrying &&
    person.body.grounded &&
    now >= person.carrying.putDownAt &&
    (person.activity === 'idle' || person.activity === 'wander')
  ) {
    // Records get delivered away from the wall they came from; only give up
    // and settle in place if leaving has taken implausibly long. Either way,
    // the record gets listened to before it's set down.
    const stillInWall = isInsideRecordWall(person, geometry);
    if (!stillInWall || now >= person.carrying.putDownAt + RECORD_ERRAND.deliverTimeoutMs) {
      beginListening(person, now);
      return person;
    }
  }

  if (person.activity === 'seek-record' && person.recordErrand) {
    const source = geometry.itemSources.find(
      (candidate) => candidate.id === person.recordErrand?.sourceId
    );
    if (!source) {
      cancelRecordErrand(person, now);
    } else {
      // Re-aim every step so layout shifts re-route instead of stranding us.
      person.goalX = source.x + source.width / 2 - person.body.width / 2;
      const feetY = person.body.y + person.body.height;
      const arrived =
        person.body.grounded &&
        Math.abs(person.body.x - person.goalX) <= RECORD_ERRAND.arrivalSlackX &&
        // Feet anywhere along the source's vertical span (standing on the
        // shelf under it, or on its top edge) counts as reaching the record.
        feetY >= source.y - RECORD_ERRAND.arrivalSlackY &&
        feetY <= source.y + source.height + RECORD_ERRAND.arrivalSlackY;
      if (arrived) {
        beginRecordStoop(person, 'pickup', now);
        return person;
      }
    }
  }

  const goalDirection: -1 | 0 | 1 =
    person.goalX > person.body.x
      ? 1
      : person.goalX < person.body.x
        ? -1
        : 0;
  const moveX: -1 | 0 | 1 = person.activity === 'idle' ? 0 : directionTowardGoal(person);
  if (moveX !== 0) person.facing = moveX;

  if (
    person.body.grounded &&
    moveX === 0 &&
    goalDirection !== 0 &&
    tryBeginInteriorClimbOut(person, geometry, goalDirection, now)
  ) {
    return person;
  }

  if (
    person.plannedClimb &&
    person.body.grounded &&
    Math.abs(person.body.x - person.plannedClimb.goalX) <= 7
  ) {
    const plan = person.plannedClimb;
    person.plannedClimb = null;
    handleClimbDownTransition(person, plan.top, plan.wall, plan.side, geometry, now);
    return person;
  }

  if (person.activity === 'seek-hide' && person.hide) {
    if (Math.abs(person.body.x - person.goalX) <= 5) {
      beginHiding(person, now);
      return person;
    }
  }

  let jump = false;
  const hasStandingSupportAhead =
    moveX !== 0 &&
    hasSupportAhead(person.body, moveX, spatial, person.definition.body.height);
  if (person.body.grounded && moveX !== 0 && !hasStandingSupportAhead) {
    if (hasSupportAhead(person.body, moveX, spatial, CRAWL_HEIGHT)) {
      beginCrawl(person, now);
      return person;
    }
    const exitedContainer = tryBeginInteriorClimbOut(person, geometry, moveX, now);
    if (exitedContainer) return person;
    const descended = tryBeginClimbDown(person, geometry, now);
    if (descended) return person;
    jump = person.body.supportId !== 'viewport-floor';
  }

  const nearby = spatial.query(expandedRect(person.body, 28));
  const result = stepPhysics(person.body, { moveX, jump }, nearby, dt);
  person.body = result.body;

  const wall = moveX > 0 ? result.contacts.right : moveX < 0 ? result.contacts.left : null;
  if (wall) {
    if (person.activity === 'seek-hide' && person.hide && sameGeometryGroup(wall, person.hide.occluder)) {
      beginHiding(person, now);
      return person;
    }

    const obstacleHeight = person.body.y + person.body.height - wall.y;
    if (person.body.grounded && obstacleHeight > 0 && obstacleHeight <= 22) {
      person.body.vy = -150;
      person.body.grounded = false;
      person.body.supportId = null;
    } else {
      if (tryBeginClimbUp(person, wall, geometry, now)) return person;
      reverse(person, geometry, now);
    }
  }

  if (moveX !== 0 && Math.abs(person.body.x - person.previousX) < 0.15) {
    person.stuckForMs += dt * 1000;
    if (person.stuckForMs > 720) reverse(person, geometry, now);
  } else {
    person.stuckForMs = 0;
  }
  person.previousX = person.body.x;

  if (moveX === 0 && person.activity !== 'idle') chooseNextActivity(person, geometry, now);
  setLocomotionAnimation(person, now);
  return person;
}

export function beginPixelPersonDrag(
  person: PixelPersonRuntime,
  pointerId: number,
  anchor: Point,
  now: number
): void {
  if (person.crawling) resizeBodyFromFeet(person.body, person.definition.body.height);
  person.crawling = false;
  cancelSpecialMovement(person);
  const definition = person.definition;
  const bodyCenterY = definition.body.offsetY + person.body.height / 2;
  const gripY = definition.dragGrip.y * definition.scale;
  person.drag = createDangle(
    pointerId,
    anchor,
    person.body,
    bodyCenterY - gripY,
    now
  );
  const result = stepDangle(person.drag, person.body, 0);
  person.drag = result.state;
  person.body = result.body;
  person.activity = 'drag';
  person.activityUntil = Number.POSITIVE_INFINITY;
  person.hiddenOccluderId = null;
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

export function releasePixelPersonDrag(
  person: PixelPersonRuntime,
  pointerId: number,
  spatial: SpatialHash,
  now: number,
  bounds?: Rect
): boolean {
  if (!person.drag || person.drag.pointerId !== pointerId) return false;
  const released = releaseDangle(person.drag, person.body);
  const nearby = spatial.query(expandedRect(released, 200));
  const crawlCandidate = resizedBodyFromFeet(released, CRAWL_HEIGHT);
  const overheadObstacles = nearby.filter((collider) => intersects(released, collider));
  const canCrawlAtRelease =
    overheadObstacles.length > 0 &&
    overheadObstacles.every(
      (collider) => collider.y + collider.height <= crawlCandidate.y + 0.5
    ) &&
    hasBodyClearance(crawlCandidate, nearby) &&
    withinBounds(crawlCandidate, bounds);
  person.body = canCrawlAtRelease
    ? crawlCandidate
    : resolveDroppedBody(released, nearby, 180, bounds);
  person.crawling = canCrawlAtRelease;
  if (canCrawlAtRelease) person.crawlingSince = now;
  person.drag = null;
  person.activity = canCrawlAtRelease ? 'wander' : 'idle';
  person.activityUntil = now + (canCrawlAtRelease ? 3_000 : 700);
  person.stuckForMs = 0;
  person.previousX = person.body.x;
  if (Math.abs(person.body.vx) > 20) person.facing = person.body.vx < 0 ? -1 : 1;
  if (canCrawlAtRelease) person.goalX = person.body.x + person.facing * 120;
  setAnimation(
    person,
    canCrawlAtRelease ? 'crawl' : person.body.vy < -20 ? 'jump' : 'fall',
    now
  );
  return true;
}

function beginCrawl(person: PixelPersonRuntime, now: number): void {
  resizeBodyFromFeet(person.body, CRAWL_HEIGHT);
  person.crawling = true;
  person.crawlingSince = now;
  person.body.vx = clamp(
    person.body.vx,
    -CRAWL_PHYSICS_CONFIG.walkSpeed,
    CRAWL_PHYSICS_CONFIG.walkSpeed
  );
  person.body.vy = 0;
  person.plannedClimb = null;
  person.stuckForMs = 0;
  person.previousX = person.body.x;
  setAnimation(person, 'crawl', now);
}

function updateCrawl(
  person: PixelPersonRuntime,
  geometry: WorldGeometry,
  spatial: SpatialHash,
  dt: number,
  now: number
): void {
  // Crawling bypasses the activity planner, so a pocket with no stand-up spot
  // would otherwise trap the person forever; hand them to stuck recovery.
  if (now - person.crawlingSince > CRAWL_BAILOUT_MS) {
    person.stuckForMs = STUCK_RECOVERY_MS;
    return;
  }
  let moveX = directionTowardGoal(person);
  if (moveX === 0 || now >= person.activityUntil) {
    chooseCrawlGoal(person, geometry, now);
    moveX = directionTowardGoal(person);
  }
  if (moveX !== 0) person.facing = moveX;

  const standingBody = resizedBodyFromFeet(person.body, person.definition.body.height);
  const canStandHere = hasBodyClearance(
    standingBody,
    spatial.query(expandedRect(standingBody, 2))
  );
  const lowClearanceAhead =
    person.body.grounded &&
    moveX !== 0 &&
    !hasSupportAhead(person.body, moveX, spatial, person.definition.body.height) &&
    hasSupportAhead(person.body, moveX, spatial, CRAWL_HEIGHT);

  if (canStandHere && !lowClearanceAhead) {
    endCrawl(person, now);
    return;
  }

  if (
    person.body.grounded &&
    moveX !== 0 &&
    !hasSupportAhead(person.body, moveX, spatial, CRAWL_HEIGHT)
  ) {
    reverse(person, geometry, now);
    moveX = person.facing;
  }

  const nearby = spatial.query(expandedRect(person.body, 28));
  const result = stepPhysics(
    person.body,
    { moveX, jump: false },
    nearby,
    dt,
    CRAWL_PHYSICS_CONFIG
  );
  person.body = result.body;

  const wall = moveX > 0 ? result.contacts.right : moveX < 0 ? result.contacts.left : null;
  if (wall) reverse(person, geometry, now);

  if (moveX !== 0 && Math.abs(person.body.x - person.previousX) < 0.1) {
    person.stuckForMs += dt * 1000;
    if (person.stuckForMs > 520) reverse(person, geometry, now);
  } else {
    person.stuckForMs = 0;
  }
  person.previousX = person.body.x;
  setAnimation(person, 'crawl', now);
}

function endCrawl(person: PixelPersonRuntime, now: number): void {
  resizeBodyFromFeet(person.body, person.definition.body.height);
  person.crawling = false;
  person.stuckForMs = 0;
  person.previousX = person.body.x;
  setLocomotionAnimation(person, now);
}

function chooseCrawlGoal(
  person: PixelPersonRuntime,
  geometry: WorldGeometry,
  now: number
): void {
  const { scanBounds, viewportBounds } = geometry;
  const minimumX = Math.max(scanBounds.x + 12, viewportBounds.x + 12);
  const maximumX = Math.min(
    scanBounds.x + scanBounds.width - person.body.width - 12,
    viewportBounds.x + viewportBounds.width - person.body.width - 12
  );
  let direction = person.facing;
  let goalX = clamp(person.body.x + direction * 150, minimumX, maximumX);
  if (Math.abs(goalX - person.body.x) < 12) {
    direction = direction === 1 ? -1 : 1;
    goalX = clamp(person.body.x + direction * 150, minimumX, maximumX);
  }
  person.facing = direction;
  person.goalX = goalX;
  person.activity = 'wander';
  person.activityUntil = now + 4_000;
}

function directionTowardGoal(person: PixelPersonRuntime): -1 | 0 | 1 {
  if (person.goalX > person.body.x + 2) return 1;
  if (person.goalX < person.body.x - 2) return -1;
  return 0;
}

function resizeBodyFromFeet(body: PhysicsBody, height: number): void {
  const bottom = body.y + body.height;
  body.height = height;
  body.y = bottom - height;
}

function resizedBodyFromFeet(body: PhysicsBody, height: number): PhysicsBody {
  const resized = { ...body };
  resizeBodyFromFeet(resized, height);
  return resized;
}

function applyCommands(
  person: PixelPersonRuntime,
  commands: PixelPersonCommand[],
  now: number
): PixelPersonRuntime | null {
  for (const command of commands) {
    if (command.type === 'despawn' && command.id === person.id) return null;
    if (command.type === 'move') {
      cancelSpecialMovement(person);
      person.goalX = command.position.x;
      person.activity = 'wander';
      person.activityUntil = now + 8_000;
    }
    if (command.type === 'flee') {
      cancelSpecialMovement(person);
      const direction = person.body.x + person.body.width / 2 < command.position.x ? -1 : 1;
      person.goalX = person.body.x + direction * 240;
      person.activity = 'wander';
      person.activityUntil = now + 5_000;
    }
  }
  return person;
}

function chooseNextActivity(
  person: PixelPersonRuntime,
  geometry: WorldGeometry,
  now: number
): void {
  cancelSpecialMovement(person);

  // While carrying inside the record wall, the goal is explicit: march toward
  // the delivery spot instead of dawdling among the shelves.
  if (person.carrying && isInsideRecordWall(person, geometry)) {
    const viewport = geometry.viewportBounds;
    person.goalX = clamp(
      person.carrying.deliverGoalX,
      viewport.x + 12,
      viewport.x + viewport.width - person.body.width - 12
    );
    person.facing = person.goalX >= person.body.x ? 1 : -1;
    person.activity = 'wander';
    person.activityUntil = now + 4_000;
    return;
  }

  // Record errands come before climb planning: cover tiles are solid supports,
  // so the climb branch would otherwise always win while standing on the wall.
  let wanderBiasX: number | null = null;
  if (!person.carrying && now >= person.nextRecordAt) {
    const source = chooseRecordSource(person, geometry);
    if (source) {
      person.recordErrand = { sourceId: source.id, imageUrl: source.imageUrl };
      person.goalX = source.x + source.width / 2 - person.body.width / 2;
      person.facing = person.goalX >= person.body.x ? 1 : -1;
      person.activity = 'seek-record';
      person.activityUntil = now + RECORD_ERRAND.travelTimeoutMs;
      person.nextRecordAt =
        now + RECORD_ERRAND.cooldownMs + Math.random() * RECORD_ERRAND.cooldownJitterMs;
      return;
    }
    person.nextRecordAt = now + RECORD_ERRAND.retryMs;
    // No source at this level: drift wandering toward the nearest one so
    // pick-ups are findable instead of pure chance (climbing does the rest).
    wanderBiasX = nearestRecordSourceX(person, geometry);
  }

  const climbPlan = chooseClimbPlan(person, geometry.colliders, now);
  if (climbPlan) {
    person.plannedClimb = climbPlan;
    person.goalX = climbPlan.goalX;
    person.facing = climbPlan.goalX >= person.body.x ? 1 : -1;
    person.activity = 'wander';
    person.activityUntil = now + 15_000;
    return;
  }

  if (now >= person.nextHideAt && !person.carrying) {
    const target = chooseHideTarget(person, geometry.occluders);
    if (target) {
      const onLeft = person.body.x + person.body.width / 2 < target.x + target.width / 2;
      const outsideX = onLeft ? target.x - person.body.width : target.x + target.width;
      const overlapX = onLeft ? target.x - person.body.width * 0.35 : target.x + target.width - person.body.width * 0.65;
      person.hide = {
        occluder: target,
        original: { x: outsideX, y: person.body.y },
        target: { x: overlapX, y: person.body.y + 5 },
        startedAt: 0
      };
      person.goalX = outsideX;
      person.activity = 'seek-hide';
      person.activityUntil = now + 6_000;
      person.nextHideAt = now + 15_000 + Math.random() * 6_000;
      return;
    }
    person.nextHideAt = now + 4_000;
  }

  if (Math.random() < 0.3) {
    person.activity = 'idle';
    person.activityUntil = now + 900 + Math.random() * 1_900;
    person.goalX = person.body.x;
    setAnimation(person, 'idle', now);
    return;
  }

  const viewport = geometry.viewportBounds;
  const minX = Math.max(geometry.scanBounds.x + 24, viewport.x + 12);
  const maxX = Math.min(
    geometry.scanBounds.x + geometry.scanBounds.width - person.body.width - 24,
    viewport.x + viewport.width - person.body.width - 12
  );
  const distance = 90 + Math.random() * 210;
  const drifting = wanderBiasX !== null && Math.random() < RECORD_ERRAND.driftChance;
  const direction: Facing = drifting
    ? (wanderBiasX as number) >= person.body.x
      ? 1
      : -1
    : Math.random() < 0.5
      ? -1
      : 1;
  person.goalX = clamp(person.body.x + distance * direction, minX, maxX);
  person.facing = person.goalX >= person.body.x ? 1 : -1;
  person.activity = 'wander';
  person.activityUntil = now + 4_500 + Math.random() * 3_500;
}

function chooseClimbPlan(
  person: PixelPersonRuntime,
  colliders: Collider[],
  now: number
): PlannedClimb | null {
  if (now - person.lastClimbAt < 10_000) return null;
  const support = colliders.find((collider) => collider.id === person.body.supportId);
  if (!support?.groupId || (support.edge !== 'top' && support.kind !== 'solid')) return null;

  if (support.kind === 'solid') {
    if (support.height > MAX_CLIMB_HEIGHT) return null;
    const leftDistance = Math.abs(person.body.x - support.x);
    const rightDistance = Math.abs(
      person.body.x + person.body.width - (support.x + support.width)
    );
    const side = leftDistance <= rightDistance ? 'left' : 'right';
    return {
      top: support,
      wall: support,
      side,
      goalX:
        side === 'left'
          ? support.x + 2
          : support.x + support.width - person.body.width - 2
    };
  }

  const leftWall = colliders.find(
    (collider) => collider.groupId === support.groupId && collider.edge === 'left'
  );
  const rightWall = colliders.find(
    (collider) => collider.groupId === support.groupId && collider.edge === 'right'
  );
  const options: Array<{ distance: number; plan: PlannedClimb }> = [];
  if (leftWall && leftWall.height <= MAX_CLIMB_HEIGHT) {
    options.push({
      distance: Math.abs(person.body.x - support.x),
      plan: { top: support, wall: leftWall, side: 'left', goalX: support.x + 2 }
    });
  }
  if (rightWall && rightWall.height <= MAX_CLIMB_HEIGHT) {
    options.push({
      distance: Math.abs(person.body.x + person.body.width - (support.x + support.width)),
      plan: {
        top: support,
        wall: rightWall,
        side: 'right',
        goalX: support.x + support.width - person.body.width - 2
      }
    });
  }

  options.sort((left, right) => left.distance - right.distance);
  return options[0]?.plan ?? null;
}

function chooseRecordSource(
  person: PixelPersonRuntime,
  geometry: WorldGeometry
): ItemSource | null {
  const bodyBottom = person.body.y + person.body.height;
  const candidates = geometry.itemSources
    .filter((source) => {
      if (source.kind !== 'record') return false;
      if (!intersects(source, geometry.viewportBounds)) return false;
      // People walk on top of tiles, so a source is reachable when its top
      // edge is near the current walking plane (or the body overlaps it).
      const reachableLevel =
        Math.abs(source.y - bodyBottom) <= RECORD_ERRAND.arrivalSlackY ||
        (person.body.y < source.y + source.height && bodyBottom > source.y);
      return (
        reachableLevel &&
        horizontalDistance(person.body, source) <= RECORD_ERRAND.maxTravelDistance
      );
    })
    .sort(
      (left, right) =>
        horizontalDistance(person.body, left) - horizontalDistance(person.body, right)
    );
  if (candidates.length === 0) return null;
  const pool = candidates.slice(0, 4);
  // Come back for a different record than the last one, when there's a choice.
  const fresh = pool.filter((source) => source.id !== person.lastRecordSourceId);
  const options = fresh.length > 0 ? fresh : pool;
  return options[Math.floor(Math.random() * options.length)];
}

/** Bounding box of all record sources — the "record wall" as one region. */
function recordWallBounds(geometry: WorldGeometry): Rect | null {
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  let found = false;
  for (const source of geometry.itemSources) {
    if (source.kind !== 'record') continue;
    found = true;
    left = Math.min(left, source.x);
    top = Math.min(top, source.y);
    right = Math.max(right, source.x + source.width);
    bottom = Math.max(bottom, source.y + source.height);
  }
  return found ? { x: left, y: top, width: right - left, height: bottom - top } : null;
}

function isInsideRecordWall(person: PixelPersonRuntime, geometry: WorldGeometry): boolean {
  const wall = recordWallBounds(geometry);
  return wall !== null && intersects(person.body, expandedRect(wall, RECORD_ERRAND.wallExitMargin));
}

/**
 * Picks a random-ish delivery x outside the record wall, preferring whichever
 * side of the viewport has room. When the wall spans the full width, aim past
 * the nearer edge — walking off the shelf ends drops the carrier out of the
 * wall's bounds from below, which also counts as delivered.
 */
function chooseDeliveryGoalX(person: PixelPersonRuntime, geometry: WorldGeometry): number {
  const viewport = geometry.viewportBounds;
  const minX = viewport.x + 12;
  const maxX = viewport.x + viewport.width - person.body.width - 12;
  const wall = recordWallBounds(geometry);
  if (!wall) {
    const direction = Math.random() < 0.5 ? -1 : 1;
    return clamp(person.body.x + direction * (150 + Math.random() * 200), minX, maxX);
  }
  const margin = RECORD_ERRAND.wallExitMargin;
  const leftZone = { from: minX, to: wall.x - margin - person.body.width };
  const rightZone = { from: wall.x + wall.width + margin, to: maxX };
  const zones = [leftZone, rightZone].filter((zone) => zone.to - zone.from >= 40);
  if (zones.length === 0) {
    // No horizontal room beside the wall: overshoot toward the nearer edge.
    return person.body.x - viewport.x < viewport.width / 2 ? minX : maxX;
  }
  const zone = zones[Math.floor(Math.random() * zones.length)];
  return zone.from + Math.random() * (zone.to - zone.from);
}

function nearestRecordSourceX(
  person: PixelPersonRuntime,
  geometry: WorldGeometry
): number | null {
  let best: ItemSource | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const source of geometry.itemSources) {
    if (source.kind !== 'record' || !intersects(source, geometry.viewportBounds)) continue;
    const distance = horizontalDistance(person.body, source);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = source;
    }
  }
  return best ? best.x + best.width / 2 : null;
}

function beginListening(person: PixelPersonRuntime, now: number): void {
  person.listen = {
    startedAt: now,
    until: now + RECORD_ERRAND.listenMinMs + Math.random() * RECORD_ERRAND.listenJitterMs
  };
  person.activity = 'listen';
  person.body.vx = 0;
  person.body.vy = 0;
  setAnimation(person, 'listen', now);
}

function updateListening(person: PixelPersonRuntime, now: number): void {
  if (!person.listen || !person.carrying) {
    person.listen = null;
    person.activity = 'idle';
    person.activityUntil = now;
    setAnimation(person, 'idle', now);
    return;
  }
  if (now < person.listen.until) return;
  person.listen = null;
  beginRecordStoop(person, 'place', now);
}

function beginRecordStoop(
  person: PixelPersonRuntime,
  action: RecordStoop['action'],
  now: number
): void {
  person.recordStoop = { action, startedAt: now };
  person.activity = 'record-stoop';
  person.body.vx = 0;
  person.body.vy = 0;
  setAnimation(person, 'hide', now);
}

function updateRecordStoop(
  person: PixelPersonRuntime,
  geometry: WorldGeometry,
  now: number,
  events?: PixelWorldEvent[]
): void {
  if (person.recordStoop && now - person.recordStoop.startedAt < RECORD_ERRAND.stoopMs) {
    return;
  }
  const action = person.recordStoop?.action;
  person.recordStoop = null;
  if (action === 'pickup' && person.recordErrand) {
    person.carrying = {
      sourceId: person.recordErrand.sourceId,
      imageUrl: person.recordErrand.imageUrl,
      putDownAt: now + RECORD_ERRAND.carryMinMs + Math.random() * RECORD_ERRAND.carryJitterMs,
      deliverGoalX: chooseDeliveryGoalX(person, geometry)
    };
    person.lastRecordSourceId = person.recordErrand.sourceId;
  } else if (action === 'place' && person.carrying) {
    events?.push({ type: 'record-dropped', personId: person.id, record: dropPayload(person) });
    person.carrying = null;
    // Head back for another record soon — the browse-deliver loop.
    person.nextRecordAt =
      now + RECORD_ERRAND.returnDelayMs + Math.random() * RECORD_ERRAND.returnJitterMs;
  }
  person.recordErrand = null;
  person.activity = 'idle';
  person.activityUntil = now + 500;
  setAnimation(person, 'idle', now);
}

function dropPayload(person: PixelPersonRuntime): DroppedRecord {
  const carrying = person.carrying as CarriedRecord;
  return {
    sourceId: carrying.sourceId,
    imageUrl: carrying.imageUrl,
    position: {
      x: person.body.x + person.body.width / 2,
      y: person.body.y + person.body.height
    }
  };
}

/** Abandons a planned pickup, e.g. when its artwork failed to load. */
export function cancelRecordErrand(person: PixelPersonRuntime, now: number): void {
  if (!person.recordErrand) return;
  person.recordErrand = null;
  if (person.activity === 'seek-record') {
    person.activity = 'idle';
    person.activityUntil = now;
  }
}

/** Instantly releases a carried record (user grab, respawn); returns where it fell. */
export function dropCarriedRecord(person: PixelPersonRuntime): DroppedRecord | null {
  if (!person.carrying) return null;
  const payload = dropPayload(person);
  person.carrying = null;
  return payload;
}

function chooseHideTarget(
  person: PixelPersonRuntime,
  occluders: Occluder[]
): Occluder | null {
  const bodyBottom = person.body.y + person.body.height;
  return (
    occluders
      .filter((occluder) => {
        const touchesLevel =
          Math.abs(occluder.y - bodyBottom) <= 42 ||
          (person.body.y < occluder.y + occluder.height && bodyBottom > occluder.y);
        const distance = Math.min(
          Math.abs(person.body.x - (occluder.x + occluder.width)),
          Math.abs(person.body.x + person.body.width - occluder.x)
        );
        return touchesLevel && distance <= 300 && occluder.width >= person.body.width * 1.5;
      })
      .sort((left, right) => horizontalDistance(person.body, left) - horizontalDistance(person.body, right))[0] ?? null
  );
}

function beginHiding(person: PixelPersonRuntime, now: number): void {
  if (!person.hide) return;
  person.hide.original = { x: person.body.x, y: person.body.y };
  person.hide.target.y = person.body.y + 5;
  person.hide.startedAt = now;
  person.body.vx = 0;
  person.body.vy = 0;
  person.activity = 'hiding';
  person.hiddenOccluderId = person.hide.occluder.id;
  setAnimation(person, 'hide', now);
}

function updateHiding(person: PixelPersonRuntime, now: number): void {
  if (!person.hide) return;
  const elapsed = now - person.hide.startedAt;
  const enterDuration = 360;
  const holdUntil = 2_650;
  const exitUntil = 3_100;
  let progress: number;

  if (elapsed <= enterDuration) {
    progress = easeInOut(elapsed / enterDuration);
  } else if (elapsed <= holdUntil) {
    progress = 1;
  } else {
    progress = 1 - easeInOut((elapsed - holdUntil) / (exitUntil - holdUntil));
  }

  person.body.x = lerp(person.hide.original.x, person.hide.target.x, clamp(progress, 0, 1));
  person.body.y = lerp(person.hide.original.y, person.hide.target.y, clamp(progress, 0, 1));

  if (elapsed >= exitUntil) {
    person.body.x = person.hide.original.x;
    person.body.y = person.hide.original.y;
    person.hiddenOccluderId = null;
    person.hide = null;
    person.activityUntil = now;
    person.activity = 'idle';
    setAnimation(person, 'idle', now);
  }
}

function tryBeginClimbUp(
  person: PixelPersonRuntime,
  wall: Collider,
  geometry: WorldGeometry,
  now: number
): boolean {
  const top = topForWall(wall, geometry.colliders);
  const climbHeight = person.body.y + person.body.height - top.y;
  if (climbHeight <= 22 || climbHeight > MAX_CLIMB_HEIGHT) return false;

  const side = person.facing === 1 ? 'left' : 'right';
  const endY = top.y - person.body.height;
  const climbingInsideFrame =
    (wall.edge === 'left' && side === 'right') ||
    (wall.edge === 'right' && side === 'left');
  if (
    !hasClearClimbPath(
      person.body,
      wall,
      top,
      side,
      endY,
      geometry,
      climbingInsideFrame
    )
  ) {
    return false;
  }
  person.climb = { wall, top, side, direction: 'up', returnY: null };
  person.activity = 'climb';
  person.body.vx = 0;
  person.body.vy = 0;
  person.body.grounded = false;
  person.body.supportId = null;
  person.lastClimbAt = now;
  setAnimation(person, 'climb', now);
  return true;
}

function tryBeginInteriorClimbOut(
  person: PixelPersonRuntime,
  geometry: WorldGeometry,
  direction: Facing,
  now: number
): boolean {
  const desiredEdge = direction === 1 ? 'right' : 'left';
  const wall = geometry.colliders
    .filter(
      (collider) =>
        Boolean(collider.groupId) &&
        collider.edge === desiredEdge &&
        isInsideFrameNearWall(person.body, collider, geometry.colliders, direction)
    )
    .sort(
      (left, right) =>
        distanceToInteriorWall(person.body, left, direction) -
        distanceToInteriorWall(person.body, right, direction)
    )[0];
  if (!wall) return false;
  person.facing = direction;
  return tryBeginClimbUp(person, wall, geometry, now);
}

function isInsideFrameNearWall(
  body: PhysicsBody,
  wall: Collider,
  colliders: Collider[],
  direction: Facing
): boolean {
  if (!wall.groupId) return false;
  const top = colliders.find(
    (collider) => collider.groupId === wall.groupId && collider.edge === 'top'
  );
  const bottom = colliders.find(
    (collider) => collider.groupId === wall.groupId && collider.edge === 'bottom'
  );
  const opposite = colliders.find(
    (collider) =>
      collider.groupId === wall.groupId &&
      collider.edge === (direction === 1 ? 'left' : 'right')
  );
  if (!top || !bottom || !opposite) return false;

  const centerX = body.x + body.width / 2;
  const centerY = body.y + body.height / 2;
  const frameLeft = direction === 1 ? opposite.x + opposite.width : wall.x + wall.width;
  const frameRight = direction === 1 ? wall.x : opposite.x;
  const distance = distanceToInteriorWall(body, wall, direction);
  return (
    centerX >= frameLeft &&
    centerX <= frameRight &&
    centerY >= top.y &&
    centerY <= bottom.y + bottom.height &&
    distance >= -0.5 &&
    distance <= 3
  );
}

function distanceToInteriorWall(
  body: PhysicsBody,
  wall: Collider,
  direction: Facing
): number {
  return direction === 1
    ? wall.x - (body.x + body.width)
    : body.x - (wall.x + wall.width);
}

function tryBeginClimbDown(
  person: PixelPersonRuntime,
  geometry: WorldGeometry,
  now: number
): boolean {
  if (now - person.lastClimbAt < 8_000) return false;
  const colliders = geometry.colliders;
  const support = colliders.find((collider) => collider.id === person.body.supportId);
  if (!support?.groupId || (support.edge !== 'top' && support.kind !== 'solid')) return false;
  const desiredEdge = person.facing === 1 ? 'right' : 'left';
  const wall =
    support.kind === 'solid'
      ? support
      : colliders.find(
          (collider) => collider.groupId === support.groupId && collider.edge === desiredEdge
        );
  if (!wall || wall.height < person.body.height * 0.8 || wall.height > MAX_CLIMB_HEIGHT) return false;

  const side = desiredEdge === 'right' ? 'right' : 'left';
  handleClimbDownTransition(person, support, wall, side, geometry, now);
  return true;
}

function handleClimbDownTransition(
  person: PixelPersonRuntime,
  support: Collider,
  wall: Collider,
  side: 'left' | 'right',
  geometry: WorldGeometry,
  now: number
): void {
  const returnY = climbDownReturnY(person.body, wall);
  if (!hasClearClimbPath(person.body, wall, support, side, returnY, geometry)) {
    person.lastClimbAt = now;
    reverse(person, geometry, now);
    return;
  }
  beginClimbDownTransition(person, support, wall, side, now);
}

function beginClimbDownTransition(
  person: PixelPersonRuntime,
  support: Collider,
  wall: Collider,
  side: 'left' | 'right',
  now: number
): void {
  const outsideX =
    side === 'right' ? wall.x + wall.width + 1 : wall.x - person.body.width - 1;
  const downMotion: ClimbMotion = {
    wall,
    top: support,
    side,
    direction: 'down',
    returnY: climbDownReturnY(person.body, wall)
  };
  person.mantle = {
    start: { x: person.body.x, y: person.body.y },
    end: { x: outsideX, y: support.y - person.body.height + 7 },
    startedAt: now,
    after: downMotion
  };
  person.activity = 'mantle';
  person.lastClimbAt = now;
  person.body.vx = 0;
  person.body.vy = 0;
  person.body.grounded = false;
  person.body.supportId = null;
  setAnimation(person, 'mantle', now);
}

function climbDownReturnY(body: PhysicsBody, wall: Collider): number {
  return Math.min(wall.y + wall.height - body.height * 0.7, body.y + 46);
}

function hasClearClimbPath(
  body: PhysicsBody,
  wall: Collider,
  top: Collider,
  side: 'left' | 'right',
  endY: number,
  geometry: WorldGeometry,
  ignoreObstructions = false
): boolean {
  const x =
    side === 'left' ? wall.x - body.width - 1 : wall.x + wall.width + 1;
  const viewport = geometry.viewportBounds;
  const viewportLeft = viewport.x + CLIMB_VIEWPORT_MARGIN;
  const viewportRight = viewport.x + viewport.width - CLIMB_VIEWPORT_MARGIN;
  if (x < viewportLeft || x + body.width > viewportRight) return false;
  if (ignoreObstructions) return true;

  const path: Rect = {
    x,
    y: Math.min(body.y, endY),
    width: body.width,
    height: Math.abs(body.y - endY) + body.height
  };
  return !geometry.colliders.some(
    (collider) =>
      collider.id !== wall.id &&
      collider.id !== top.id &&
      collider.id !== body.supportId &&
      intersects(path, collider)
  );
}

function updateClimb(person: PixelPersonRuntime, dt: number, now: number): void {
  if (!person.climb) return;
  const climb = person.climb;
  person.body.vx = 0;
  person.body.vy = 0;
  person.facing = climb.side === 'left' ? 1 : -1;
  person.body.x =
    climb.side === 'left'
      ? climb.wall.x - person.body.width - 1
      : climb.wall.x + climb.wall.width + 1;

  if (climb.direction === 'down') {
    person.body.y += CLIMB_SPEED * dt;
    if (climb.returnY !== null && person.body.y >= climb.returnY) {
      climb.direction = 'up';
      climb.returnY = null;
      person.animationStartedAt = now;
    }
    return;
  }

  person.body.y -= CLIMB_SPEED * dt;
  const targetY = climb.top.y - person.body.height;
  if (person.body.y <= targetY + 7) beginMantleUp(person, climb, now);
}

function beginMantleUp(person: PixelPersonRuntime, climb: ClimbMotion, now: number): void {
  const inset = Math.min(5, Math.max(2, climb.top.width / 4));
  const targetEdge =
    climb.wall.edge === 'left' || climb.wall.edge === 'right'
      ? climb.wall.edge
      : climb.side;
  const endX =
    targetEdge === 'left'
      ? climb.top.x + inset
      : climb.top.x + climb.top.width - person.body.width - inset;
  person.mantle = {
    start: { x: person.body.x, y: person.body.y },
    end: { x: endX, y: climb.top.y - person.body.height },
    startedAt: now,
    supportId: climb.top.id
  };
  person.climb = null;
  person.activity = 'mantle';
  setAnimation(person, 'mantle', now);
}

function updateMantle(person: PixelPersonRuntime, now: number): void {
  if (!person.mantle) return;
  const horizontalDistance = Math.abs(person.mantle.end.x - person.mantle.start.x);
  const duration = Math.max(
    MIN_MANTLE_DURATION_MS,
    (horizontalDistance * EASE_IN_OUT_MAX_SLOPE * 1000) / MAX_MANTLE_HORIZONTAL_SPEED
  );
  const progress = clamp((now - person.mantle.startedAt) / duration, 0, 1);
  const eased = easeInOut(progress);
  person.body.x = lerp(person.mantle.start.x, person.mantle.end.x, eased);
  person.body.y = lerp(person.mantle.start.y, person.mantle.end.y, eased);
  if (progress < 1) return;

  const after = person.mantle.after;
  const supportId = person.mantle.supportId ?? null;
  person.mantle = null;
  if (after) {
    person.climb = after;
    person.activity = 'climb';
    setAnimation(person, 'climb', now);
    return;
  }

  person.body.vx = 0;
  person.body.vy = 0;
  person.body.grounded = true;
  person.body.supportId = supportId;
  person.activity = 'idle';
  person.activityUntil = now + 600;
  setAnimation(person, 'idle', now);
}

function topForWall(wall: Collider, colliders: Collider[]): Collider {
  if (!wall.groupId) return wall;
  return (
    colliders.find(
      (collider) => collider.groupId === wall.groupId && collider.edge === 'top'
    ) ?? wall
  );
}

function hasSupportAhead(
  body: PhysicsBody,
  direction: Facing,
  spatial: SpatialHash,
  occupantHeight = body.height
): boolean {
  const probeX = direction === 1 ? body.x + body.width + 2 : body.x - 5;
  const probe = { x: probeX, y: body.y + body.height, width: 3, height: 11 };
  return spatial
    .query(probe)
    .some((collider) => {
      if (
        collider.y < body.y + body.height - 1 ||
        collider.y > body.y + body.height + 10
      ) {
        return false;
      }
      const footX = probe.x + probe.width / 2;
      const standingBody: Rect = {
        x: footX - body.width / 2,
        y: collider.y - occupantHeight,
        width: body.width,
        height: occupantHeight
      };
      return hasBodyClearance(
        standingBody,
        spatial.query(expandedRect(standingBody, 2)),
        collider.id
      );
    });
}

function reverse(person: PixelPersonRuntime, geometry: WorldGeometry, now: number): void {
  const viewport = geometry.viewportBounds;
  person.facing = person.facing === 1 ? -1 : 1;
  const minimumX = viewport.x + 12;
  const maximumX = viewport.x + viewport.width - person.body.width - 12;
  person.goalX = clamp(
    person.body.x + person.facing * (80 + Math.random() * 130),
    minimumX,
    maximumX
  );
  if (Math.abs(person.goalX - person.body.x) < 12) {
    person.facing = person.body.x < viewport.x + viewport.width / 2 ? 1 : -1;
    person.goalX = clamp(person.body.x + person.facing * 120, minimumX, maximumX);
  }
  person.activity = 'wander';
  person.activityUntil = now + 3_000;
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

function cancelSpecialMovement(person: PixelPersonRuntime): void {
  person.climb = null;
  person.mantle = null;
  person.hide = null;
  person.hiddenOccluderId = null;
  person.plannedClimb = null;
  person.recordErrand = null;
  person.recordStoop = null;
  person.listen = null;
  // person.carrying is deliberately kept: records survive activity changes.
  person.drag = null;
}

function sameGeometryGroup(collider: Collider, occluder: Occluder): boolean {
  return Boolean(collider.groupId) && collider.groupId === occluder.groupId;
}

function horizontalDistance(body: PhysicsBody, rect: Rect): number {
  if (body.x + body.width < rect.x) return rect.x - (body.x + body.width);
  if (body.x > rect.x + rect.width) return body.x - (rect.x + rect.width);
  return 0;
}

function easeInOut(value: number): number {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function lerp(start: number, end: number, progress: number): number {
  return start + (end - start) * progress;
}
