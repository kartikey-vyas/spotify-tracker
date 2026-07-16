import type {
  Collider,
  PhysicsBody,
  PhysicsConfig,
  PhysicsInput,
  PhysicsStep,
  Rect
} from './types';

export const defaultPhysicsConfig: PhysicsConfig = {
  gravity: 620,
  maxFallSpeed: 360,
  walkSpeed: 42,
  groundAcceleration: 280,
  airAcceleration: 130,
  groundFriction: 340,
  jumpSpeed: 185
};

const EPSILON = 0.01;

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function withinBounds(body: Rect, bounds?: Rect): boolean {
  if (!bounds) return true;
  return (
    body.x >= bounds.x &&
    body.y >= bounds.y &&
    body.x + body.width <= bounds.x + bounds.width &&
    body.y + body.height <= bounds.y + bounds.height
  );
}

export function intersects(left: Rect, right: Rect): boolean {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  );
}

export function hasBodyClearance(
  body: Rect,
  colliders: Collider[],
  ignoredColliderId?: string
): boolean {
  return !colliders.some(
    (collider) => collider.id !== ignoredColliderId && intersects(body, collider)
  );
}

export function expandedRect(rect: Rect, padding: number): Rect {
  return {
    x: rect.x - padding,
    y: rect.y - padding,
    width: rect.width + padding * 2,
    height: rect.height + padding * 2
  };
}

export function moveToward(current: number, target: number, amount: number): number {
  if (current < target) return Math.min(current + amount, target);
  if (current > target) return Math.max(current - amount, target);
  return target;
}

export function stepPhysics(
  source: PhysicsBody,
  input: PhysicsInput,
  colliders: Collider[],
  elapsedSeconds: number,
  config: PhysicsConfig = defaultPhysicsConfig
): PhysicsStep {
  const dt = Math.max(0, Math.min(elapsedSeconds, 1 / 20));
  const body = { ...source };
  const contacts: PhysicsStep['contacts'] = {
    left: null,
    right: null,
    ground: null,
    ceiling: null
  };

  const acceleration = body.grounded ? config.groundAcceleration : config.airAcceleration;
  if (input.moveX === 0) {
    body.vx = moveToward(body.vx, 0, config.groundFriction * dt);
  } else {
    body.vx = moveToward(body.vx, input.moveX * config.walkSpeed, acceleration * dt);
  }

  if (input.jump && body.grounded) {
    body.vy = -config.jumpSpeed;
    body.grounded = false;
    body.supportId = null;
  }

  body.vy = Math.min(body.vy + config.gravity * dt, config.maxFallSpeed);

  const startX = body.x;
  const nextX = startX + body.vx * dt;
  if (body.vx > 0) {
    const startRight = startX + body.width;
    const nextRight = nextX + body.width;
    let limit = nextX;
    for (const collider of colliders) {
      if (!overlapsVertically(body, collider)) continue;
      if (startRight <= collider.x + EPSILON && nextRight >= collider.x) {
        const candidate = collider.x - body.width;
        if (candidate < limit) {
          limit = candidate;
          contacts.right = collider;
        }
      }
    }
    body.x = limit;
    if (contacts.right) body.vx = 0;
  } else if (body.vx < 0) {
    const startLeft = startX;
    const nextLeft = nextX;
    let limit = nextX;
    for (const collider of colliders) {
      if (!overlapsVertically(body, collider)) continue;
      const colliderRight = collider.x + collider.width;
      if (startLeft >= colliderRight - EPSILON && nextLeft <= colliderRight) {
        const candidate = colliderRight;
        if (candidate > limit) {
          limit = candidate;
          contacts.left = collider;
        }
      }
    }
    body.x = limit;
    if (contacts.left) body.vx = 0;
  } else {
    body.x = nextX;
  }

  const startY = body.y;
  const nextY = startY + body.vy * dt;
  body.grounded = false;
  body.supportId = null;

  if (body.vy > 0) {
    const startBottom = startY + body.height;
    const nextBottom = nextY + body.height;
    let limit = nextY;
    for (const collider of colliders) {
      if (!overlapsHorizontally(body, collider)) continue;
      if (startBottom <= collider.y + EPSILON && nextBottom >= collider.y) {
        const candidate = collider.y - body.height;
        const standingBody = { ...body, y: candidate };
        if (!hasBodyClearance(standingBody, colliders, collider.id)) continue;
        if (candidate < limit) {
          limit = candidate;
          contacts.ground = collider;
        }
      }
    }
    body.y = limit;
    if (contacts.ground) {
      body.vy = 0;
      body.grounded = true;
      body.supportId = contacts.ground.id;
    }
  } else if (body.vy < 0) {
    const startTop = startY;
    const nextTop = nextY;
    let limit = nextY;
    for (const collider of colliders) {
      if (!overlapsHorizontally(body, collider)) continue;
      const colliderBottom = collider.y + collider.height;
      if (startTop >= colliderBottom - EPSILON && nextTop <= colliderBottom) {
        const candidate = colliderBottom;
        if (candidate > limit) {
          limit = candidate;
          contacts.ceiling = collider;
        }
      }
    }
    body.y = limit;
    if (contacts.ceiling) body.vy = 0;
  } else {
    body.y = nextY;
  }

  return { body, contacts };
}

function overlapsHorizontally(body: Rect, collider: Rect): boolean {
  return body.x < collider.x + collider.width && body.x + body.width > collider.x;
}

function overlapsVertically(body: Rect, collider: Rect): boolean {
  return body.y < collider.y + collider.height && body.y + body.height > collider.y;
}

// Cell coordinates are combined into one numeric key; supports documents up to
// ~32 million px on each axis before neighbouring keys could collide.
const CELL_KEY_STRIDE = 1_048_576;

export class SpatialHash {
  private readonly cells = new Map<number, Collider[]>();

  constructor(
    colliders: Collider[],
    private readonly cellSize = 64
  ) {
    for (const collider of colliders) this.insert(collider);
  }

  query(rect: Rect): Collider[] {
    const found: Collider[] = [];
    const seen = new Set<string>();
    const { left, right, top, bottom } = this.cellRange(rect);
    for (let x = left; x <= right; x += 1) {
      for (let y = top; y <= bottom; y += 1) {
        const cell = this.cells.get(x * CELL_KEY_STRIDE + y);
        if (!cell) continue;
        for (const collider of cell) {
          if (seen.has(collider.id)) continue;
          seen.add(collider.id);
          found.push(collider);
        }
      }
    }
    return found;
  }

  private insert(collider: Collider): void {
    const { left, right, top, bottom } = this.cellRange(collider);
    for (let x = left; x <= right; x += 1) {
      for (let y = top; y <= bottom; y += 1) {
        const key = x * CELL_KEY_STRIDE + y;
        const cell = this.cells.get(key);
        if (cell) cell.push(collider);
        else this.cells.set(key, [collider]);
      }
    }
  }

  private cellRange(rect: Rect): { left: number; right: number; top: number; bottom: number } {
    return {
      left: Math.floor(rect.x / this.cellSize),
      right: Math.floor((rect.x + Math.max(0, rect.width - EPSILON)) / this.cellSize),
      top: Math.floor(rect.y / this.cellSize),
      bottom: Math.floor((rect.y + Math.max(0, rect.height - EPSILON)) / this.cellSize)
    };
  }
}
