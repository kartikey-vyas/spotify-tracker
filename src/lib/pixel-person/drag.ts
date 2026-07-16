import { clamp, hasBodyClearance, intersects, withinBounds } from './physics';
import type { Collider, PhysicsBody, Point, Rect } from './types';

export interface DangleConfig {
  gravity: number;
  pointerAccelerationInfluence: number;
  angularDamping: number;
  maximumAngle: number;
  maximumAngularSpeed: number;
  maximumPointerSpeed: number;
  maximumPointerAcceleration: number;
  pointerVelocitySmoothing: number;
  pointerAccelerationSmoothing: number;
  pointerVelocityDecay: number;
  pointerAccelerationDecay: number;
  maximumReleaseSpeed: number;
}

export interface DangleState {
  pointerId: number;
  anchor: Point;
  angle: number;
  angularVelocity: number;
  pointerVelocity: Point;
  pointerAcceleration: Point;
  lastSampleAt: number;
  length: number;
}

export interface DangleStep {
  state: DangleState;
  body: PhysicsBody;
}

export const defaultDangleConfig: DangleConfig = {
  gravity: 700,
  pointerAccelerationInfluence: 0.5,
  angularDamping: 4.8,
  maximumAngle: Math.PI * 0.36,
  maximumAngularSpeed: 5.4,
  maximumPointerSpeed: 1_800,
  maximumPointerAcceleration: 7_500,
  pointerVelocitySmoothing: 0.48,
  pointerAccelerationSmoothing: 0.32,
  pointerVelocityDecay: 11,
  pointerAccelerationDecay: 14,
  maximumReleaseSpeed: 430
};

export function createDangle(
  pointerId: number,
  anchor: Point,
  body: PhysicsBody,
  length: number,
  now: number,
  config: DangleConfig = defaultDangleConfig
): DangleState {
  const safeLength = Math.max(8, length);
  const horizontalOffset = body.x + body.width / 2 - anchor.x;
  const angle = clamp(
    Math.asin(clamp(horizontalOffset / safeLength, -0.72, 0.72)),
    -config.maximumAngle,
    config.maximumAngle
  );
  return {
    pointerId,
    anchor: { ...anchor },
    angle,
    angularVelocity: 0,
    pointerVelocity: { x: 0, y: 0 },
    pointerAcceleration: { x: 0, y: 0 },
    lastSampleAt: now,
    length: safeLength
  };
}

export function sampleDanglePointer(
  source: DangleState,
  anchor: Point,
  now: number,
  config: DangleConfig = defaultDangleConfig
): DangleState {
  const elapsed = clamp((now - source.lastSampleAt) / 1000, 1 / 240, 0.08);
  const rawVelocity = limitVector(
    {
      x: (anchor.x - source.anchor.x) / elapsed,
      y: (anchor.y - source.anchor.y) / elapsed
    },
    config.maximumPointerSpeed
  );
  const pointerVelocity = mixPoint(
    source.pointerVelocity,
    rawVelocity,
    config.pointerVelocitySmoothing
  );
  const rawAcceleration = limitVector(
    {
      x: (pointerVelocity.x - source.pointerVelocity.x) / elapsed,
      y: (pointerVelocity.y - source.pointerVelocity.y) / elapsed
    },
    config.maximumPointerAcceleration
  );

  return {
    ...source,
    anchor: { ...anchor },
    pointerVelocity,
    pointerAcceleration: mixPoint(
      source.pointerAcceleration,
      rawAcceleration,
      config.pointerAccelerationSmoothing
    ),
    lastSampleAt: now
  };
}

export function rebaseDangleAnchor(
  source: DangleState,
  anchor: Point,
  now: number
): DangleState {
  return {
    ...source,
    anchor: { ...anchor },
    pointerVelocity: { ...source.pointerVelocity },
    pointerAcceleration: { ...source.pointerAcceleration },
    lastSampleAt: now
  };
}

export function stepDangle(
  source: DangleState,
  sourceBody: PhysicsBody,
  elapsedSeconds: number,
  config: DangleConfig = defaultDangleConfig
): DangleStep {
  const dt = clamp(elapsedSeconds, 0, 1 / 30);
  const state: DangleState = {
    ...source,
    anchor: { ...source.anchor },
    pointerVelocity: { ...source.pointerVelocity },
    pointerAcceleration: { ...source.pointerAcceleration }
  };
  const body = { ...sourceBody };

  if (dt > 0) {
    const sine = Math.sin(state.angle);
    const cosine = Math.cos(state.angle);
    const acceleration = state.pointerAcceleration;
    const tangentialAcceleration =
      -config.gravity * sine -
      config.pointerAccelerationInfluence * acceleration.x * cosine +
      config.pointerAccelerationInfluence * acceleration.y * sine;
    const angularAcceleration =
      tangentialAcceleration / state.length - config.angularDamping * state.angularVelocity;

    state.angularVelocity = clamp(
      state.angularVelocity + angularAcceleration * dt,
      -config.maximumAngularSpeed,
      config.maximumAngularSpeed
    );
    state.angle += state.angularVelocity * dt;

    if (Math.abs(state.angle) > config.maximumAngle) {
      state.angle = Math.sign(state.angle) * config.maximumAngle;
      state.angularVelocity *= -0.18;
    }

    state.pointerVelocity.x *= Math.exp(-config.pointerVelocityDecay * dt);
    state.pointerVelocity.y *= Math.exp(-config.pointerVelocityDecay * dt);
    state.pointerAcceleration.x *= Math.exp(-config.pointerAccelerationDecay * dt);
    state.pointerAcceleration.y *= Math.exp(-config.pointerAccelerationDecay * dt);
  }

  const massVelocity = dangleMassVelocity(state);
  const center = dangleCenter(state);
  body.x = center.x - body.width / 2;
  body.y = center.y - body.height / 2;
  body.vx = massVelocity.x;
  body.vy = massVelocity.y;
  body.grounded = false;
  body.supportId = null;
  return { state, body };
}

export function releaseDangle(
  state: DangleState,
  sourceBody: PhysicsBody,
  config: DangleConfig = defaultDangleConfig
): PhysicsBody {
  const velocity = limitVector(dangleMassVelocity(state), config.maximumReleaseSpeed);
  return {
    ...sourceBody,
    vx: velocity.x,
    vy: velocity.y,
    grounded: false,
    supportId: null
  };
}

export function resolveDroppedBody(
  source: PhysicsBody,
  colliders: Collider[],
  maximumDistance = 180,
  bounds?: Rect
): PhysicsBody {
  const blockers = colliders.filter((collider) => intersects(source, collider));
  const isClear = (candidate: PhysicsBody) =>
    withinBounds(candidate, bounds) && hasBodyClearance(candidate, colliders);
  if (isClear(source)) return { ...source };

  if (bounds) {
    const bounded = {
      ...source,
      x: clamp(source.x, bounds.x, bounds.x + bounds.width - source.width),
      y: clamp(source.y, bounds.y, bounds.y + bounds.height - source.height)
    };
    if (isClear(bounded)) return bounded;
  }

  for (const blocker of blockers.sort((left, right) => left.y - right.y)) {
    const candidate = { ...source, y: blocker.y - source.height };
    if (isClear(candidate)) return candidate;
  }

  for (let distance = 4; distance <= maximumDistance; distance += 4) {
    const candidate = { ...source, y: source.y - distance };
    if (isClear(candidate)) return candidate;
  }

  const directions: Point[] = [
    { x: -1, y: 0 },
    { x: 1, y: 0 },
    { x: -0.7, y: -0.7 },
    { x: 0.7, y: -0.7 },
    { x: 0, y: 1 },
    { x: -0.7, y: 0.7 },
    { x: 0.7, y: 0.7 }
  ];
  for (let distance = 4; distance <= maximumDistance; distance += 4) {
    for (const direction of directions) {
      const candidate = {
        ...source,
        x: source.x + direction.x * distance,
        y: source.y + direction.y * distance
      };
      if (isClear(candidate)) return candidate;
    }
  }

  return { ...source };
}

export function dangleCenter(state: DangleState): Point {
  return {
    x: state.anchor.x + Math.sin(state.angle) * state.length,
    y: state.anchor.y + Math.cos(state.angle) * state.length
  };
}

export function dangleMassVelocity(state: DangleState): Point {
  return {
    x: state.pointerVelocity.x + state.length * state.angularVelocity * Math.cos(state.angle),
    y: state.pointerVelocity.y - state.length * state.angularVelocity * Math.sin(state.angle)
  };
}

function limitVector(vector: Point, maximumLength: number): Point {
  const length = Math.hypot(vector.x, vector.y);
  if (length <= maximumLength || length === 0) return vector;
  const scale = maximumLength / length;
  return { x: vector.x * scale, y: vector.y * scale };
}

function mixPoint(from: Point, to: Point, amount: number): Point {
  return {
    x: from.x + (to.x - from.x) * amount,
    y: from.y + (to.y - from.y) * amount
  };
}
