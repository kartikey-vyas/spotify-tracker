import type { Collider, PhysicsBody, PhysicsConfig, PhysicsInput, Rect } from './types';

export const defaultPhysicsConfig: PhysicsConfig = {
  gravity: 620,
  maxFallSpeed: 360,
  walkSpeed: 42,
  groundAcceleration: 280,
  airAcceleration: 130,
  groundFriction: 340
};

const EPSILON = 0.01;

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function intersects(left: Rect, right: Rect): boolean {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  );
}

export function moveToward(current: number, target: number, amount: number): number {
  if (current < target) return Math.min(current + amount, target);
  if (current > target) return Math.max(current - amount, target);
  return target;
}

/**
 * One step of a body inside the room. The colliders are the room's own walls,
 * floor and ceiling, so this is swept AABB against four rectangles — the page
 * itself is never terrain.
 */
export function stepPhysics(
  source: PhysicsBody,
  input: PhysicsInput,
  colliders: readonly Collider[],
  elapsedSeconds: number,
  config: PhysicsConfig = defaultPhysicsConfig
): PhysicsBody {
  const dt = Math.max(0, Math.min(elapsedSeconds, 1 / 20));
  const body = { ...source };

  const acceleration = body.grounded ? config.groundAcceleration : config.airAcceleration;
  if (input.moveX === 0) {
    body.vx = moveToward(body.vx, 0, (body.grounded ? config.groundFriction : 0) * dt);
  } else {
    body.vx = moveToward(body.vx, input.moveX * config.walkSpeed, acceleration * dt);
  }

  body.vy = Math.min(body.vy + config.gravity * dt, config.maxFallSpeed);

  const startX = body.x;
  const nextX = startX + body.vx * dt;
  if (body.vx > 0) {
    let limit = nextX;
    let hit = false;
    for (const collider of colliders) {
      if (!overlapsVertically(body, collider)) continue;
      if (startX + body.width <= collider.x + EPSILON && nextX + body.width >= collider.x) {
        const candidate = collider.x - body.width;
        if (candidate < limit) {
          limit = candidate;
          hit = true;
        }
      }
    }
    body.x = limit;
    if (hit) body.vx = 0;
  } else if (body.vx < 0) {
    let limit = nextX;
    let hit = false;
    for (const collider of colliders) {
      if (!overlapsVertically(body, collider)) continue;
      const colliderRight = collider.x + collider.width;
      if (startX >= colliderRight - EPSILON && nextX <= colliderRight) {
        if (colliderRight > limit) {
          limit = colliderRight;
          hit = true;
        }
      }
    }
    body.x = limit;
    if (hit) body.vx = 0;
  }

  const startY = body.y;
  const nextY = startY + body.vy * dt;
  body.grounded = false;

  if (body.vy > 0) {
    let limit = nextY;
    for (const collider of colliders) {
      if (!overlapsHorizontally(body, collider)) continue;
      if (startY + body.height <= collider.y + EPSILON && nextY + body.height >= collider.y) {
        const candidate = collider.y - body.height;
        if (candidate < limit) {
          limit = candidate;
          body.grounded = true;
        }
      }
    }
    body.y = limit;
    if (body.grounded) body.vy = 0;
  } else if (body.vy < 0) {
    let limit = nextY;
    let hit = false;
    for (const collider of colliders) {
      if (!overlapsHorizontally(body, collider)) continue;
      const colliderBottom = collider.y + collider.height;
      if (startY >= colliderBottom - EPSILON && nextY <= colliderBottom) {
        if (colliderBottom > limit) {
          limit = colliderBottom;
          hit = true;
        }
      }
    }
    body.y = limit;
    if (hit) body.vy = 0;
  }

  return body;
}

function overlapsHorizontally(body: Rect, collider: Rect): boolean {
  return body.x < collider.x + collider.width && body.x + body.width > collider.x;
}

function overlapsVertically(body: Rect, collider: Rect): boolean {
  return body.y < collider.y + collider.height && body.y + body.height > collider.y;
}
