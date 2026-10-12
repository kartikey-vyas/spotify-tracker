import { describe, expect, it } from 'vitest';
import { tinyPerson } from '../../src/lib/pixel-person/characters';
import { DOORWAY, doorstepX, doorwayEnterX, isOverDoorway } from '../../src/lib/pixel-person/doorway';
import { defaultPhysicsConfig, intersects, stepPhysics } from '../../src/lib/pixel-person/physics';
import {
  chooseOpenSpot,
  lampReach,
  layoutRoom,
  LOUNGE,
  SHELF,
  shelfSlotCount,
  slotStandX,
  walkRange,
  type ShelfSide
} from '../../src/lib/pixel-person/room';
import type { PhysicsBody } from '../../src/lib/pixel-person/types';

const SIDES: ShelfSide[] = ['left', 'centre', 'right'];
const WIDTHS = [320, 390, 519, 520, 800, 1100, 1400];
const HEIGHT = 83;
const BODY_WIDTH = tinyPerson.body.width;

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

function standing(x: number, overrides: Partial<PhysicsBody> = {}): PhysicsBody {
  return {
    x,
    y: HEIGHT - tinyPerson.body.height,
    width: tinyPerson.body.width,
    height: tinyPerson.body.height,
    vx: 0,
    vy: 0,
    grounded: true,
    ...overrides
  };
}

describe('room layout', () => {
  it('stands the floor on the bottom edge of the room', () => {
    expect(layoutRoom(1000, HEIGHT, 'right').floorY).toBe(HEIGHT);
  });

  it('puts the shelf at the requested end', () => {
    const left = layoutRoom(1000, HEIGHT, 'left').shelf;
    const right = layoutRoom(1000, HEIGHT, 'right').shelf;
    const centre = layoutRoom(1000, HEIGHT, 'centre').shelf;
    expect(left.x + left.width / 2).toBeLessThan(500);
    expect(right.x + right.width / 2).toBeGreaterThan(500);
    expect(Math.abs(centre.x + centre.width / 2 - 500)).toBeLessThanOrEqual(1);
  });

  it('keeps the shelf, the door and every record inside the room', () => {
    for (const width of WIDTHS) {
      for (const side of SIDES) {
        const room = layoutRoom(width, HEIGHT, side);
        const bounds = { x: 0, y: 0, width, height: HEIGHT };
        expect(room.shelf.x).toBeGreaterThanOrEqual(0);
        expect(room.shelf.x + room.shelf.width).toBeLessThanOrEqual(width);
        expect(room.door.x).toBeGreaterThanOrEqual(0);
        expect(room.door.x + room.door.width).toBeLessThanOrEqual(width);
        for (const slot of room.shelf.slots) {
          expect(intersects({ ...slot, width: SHELF.recordSize, height: SHELF.recordSize }, bounds)).toBe(true);
        }
      }
    }
  });

  it('never puts the door where the shelf stands', () => {
    for (const width of WIDTHS) {
      for (const side of SIDES) {
        const room = layoutRoom(width, HEIGHT, side);
        expect(intersects(room.door, room.shelf)).toBe(false);
      }
    }
  });

  it('stands records on the board, not floating above or sunk into it', () => {
    const room = layoutRoom(1000, HEIGHT, 'right');
    for (const slot of room.shelf.slots) {
      expect(slot.y + SHELF.recordSize).toBe(room.shelf.boardY);
    }
    expect(room.shelf.boardY).toBe(room.floorY - SHELF.boardHeight);
  });

  it('gives narrow rooms the short shelf', () => {
    expect(layoutRoom(SHELF.narrowRoomWidth - 1, HEIGHT, 'right').shelf.slots).toHaveLength(
      SHELF.narrowSlots
    );
    expect(layoutRoom(SHELF.narrowRoomWidth, HEIGHT, 'right').shelf.slots).toHaveLength(
      SHELF.maxSlots
    );
    expect(shelfSlotCount(SHELF.narrowRoomWidth)).toBe(SHELF.maxSlots);
  });

  it('spaces slots so records never overlap', () => {
    const { slots } = layoutRoom(1000, HEIGHT, 'right').shelf;
    for (let index = 1; index < slots.length; index += 1) {
      expect(slots[index].x - slots[index - 1].x).toBeGreaterThanOrEqual(SHELF.recordSize);
    }
  });

  it('plans walks inside the walls', () => {
    for (const width of WIDTHS) {
      const room = layoutRoom(width, HEIGHT, 'right');
      const { minX, maxX } = walkRange(room, BODY_WIDTH);
      expect(minX).toBeGreaterThanOrEqual(0);
      expect(maxX + BODY_WIDTH).toBeLessThanOrEqual(width);
    }
  });

  it('stands someone centred on the slot they are taking from', () => {
    const room = layoutRoom(1000, HEIGHT, 'left');
    room.shelf.slots.forEach((slot, index) => {
      const centre = slotStandX(room, index, BODY_WIDTH) + BODY_WIDTH / 2;
      expect(centre).toBeCloseTo(slot.x + SHELF.recordSize / 2);
    });
  });
});

describe('choosing an open spot', () => {
  it('spreads out from everyone already in the room', () => {
    const room = layoutRoom(1000, HEIGHT, 'right');
    const others = [200, 210, 220];
    for (let seed = 1; seed < 20; seed += 1) {
      const spot = chooseOpenSpot(room, BODY_WIDTH, 210, others, seededRandom(seed));
      expect(Math.min(...others.map((x) => Math.abs(x - spot)))).toBeGreaterThan(30);
    }
  });

  it('keeps a listening spot clear of the shelf when asked', () => {
    const room = layoutRoom(1000, HEIGHT, 'right');
    for (let seed = 1; seed < 40; seed += 1) {
      const spot = chooseOpenSpot(room, BODY_WIDTH, room.shelf.x, [], seededRandom(seed), {
        avoidFurniture: true
      });
      const body = { x: spot, y: 0, width: BODY_WIDTH, height: 1 };
      expect(intersects(body, { ...room.shelf, y: 0, height: 1 })).toBe(false);
    }
  });

  it('stays inside the walk range', () => {
    const room = layoutRoom(320, HEIGHT, 'centre');
    const { minX, maxX } = walkRange(room, BODY_WIDTH);
    for (let seed = 1; seed < 40; seed += 1) {
      const spot = chooseOpenSpot(room, BODY_WIDTH, 0, [10, 300], seededRandom(seed));
      expect(spot).toBeGreaterThanOrEqual(minX);
      expect(spot).toBeLessThanOrEqual(maxX);
    }
  });
});

describe('room physics', () => {
  const room = layoutRoom(600, HEIGHT, 'right');

  it('lands a falling body on the floor', () => {
    let body = standing(100, { y: 2, grounded: false });
    for (let step = 0; step < 60; step += 1) {
      body = stepPhysics(body, { moveX: 0 }, room.colliders, 1 / 20);
    }
    expect(body.grounded).toBe(true);
    expect(body.y + body.height).toBeCloseTo(room.floorY);
  });

  it('stops a walker at the wall', () => {
    let body = standing(560);
    for (let step = 0; step < 60; step += 1) {
      body = stepPhysics(body, { moveX: 1 }, room.colliders, 1 / 20);
    }
    expect(body.x + body.width).toBeLessThanOrEqual(room.width);
    expect(body.vx).toBe(0);
  });

  it('keeps a flung body below the ceiling', () => {
    let body = standing(300, { y: 10, vy: -400, grounded: false });
    body = stepPhysics(body, { moveX: 0 }, room.colliders, 1 / 20);
    expect(body.y).toBeGreaterThanOrEqual(0);
  });

  it('never exceeds the configured walking speed', () => {
    let body = standing(100);
    for (let step = 0; step < 40; step += 1) {
      body = stepPhysics(body, { moveX: 1 }, room.colliders, 1 / 20);
      expect(Math.abs(body.vx)).toBeLessThanOrEqual(defaultPhysicsConfig.walkSpeed);
    }
  });
});

describe('the doorway', () => {
  it('counts a drop on or just around the door, not across the room', () => {
    const room = layoutRoom(1000, HEIGHT, 'right');
    const centre = { x: room.door.x + room.door.width / 2, y: room.door.y + room.door.height / 2 };
    expect(isOverDoorway(centre, room)).toBe(true);
    expect(isOverDoorway({ x: room.door.x - DOORWAY.hitPadding + 1, y: centre.y }, room)).toBe(true);
    expect(isOverDoorway({ x: room.width / 2, y: centre.y }, room)).toBe(false);
  });

  it('sets someone down on the room side of the door, a short walk from it', () => {
    for (const side of SIDES) {
      const room = layoutRoom(1000, HEIGHT, side);
      const step = doorstepX(room, BODY_WIDTH);
      const enter = doorwayEnterX(room, BODY_WIDTH);
      expect(intersects({ x: step, y: 0, width: BODY_WIDTH, height: 1 }, { ...room.door, y: 0, height: 1 })).toBe(false);
      expect(Math.abs(step - enter)).toBeLessThan(DOORWAY.width + DOORWAY.approachDistance + BODY_WIDTH);
      expect(step).toBeGreaterThanOrEqual(0);
      expect(step + BODY_WIDTH).toBeLessThanOrEqual(room.width);
    }
  });
});

describe('settling distance', () => {
  it('carries a record a few steps away rather than sitting on the spot', () => {
    const room = layoutRoom(1000, HEIGHT, 'centre');
    let total = 0;
    for (let seed = 1; seed <= 40; seed += 1) {
      const spot = chooseOpenSpot(room, BODY_WIDTH, 300, [], seededRandom(seed * 7919), {
        preferredDistance: 110
      });
      total += Math.abs(spot - 300);
    }
    const average = total / 40;
    expect(average).toBeGreaterThan(60);
    expect(average).toBeLessThan(200);
  });
});

describe('the lounge', () => {
  it('stands beside the shelf, clear of the shelf and the door, inside the room', () => {
    for (const width of WIDTHS) {
      for (const side of SIDES) {
        const room = layoutRoom(width, HEIGHT, side);
        for (const piece of room.furniture) {
          expect(piece.x).toBeGreaterThanOrEqual(0);
          expect(piece.x + piece.width).toBeLessThanOrEqual(width);
          expect(intersects(piece, room.shelf)).toBe(false);
          expect(intersects(piece, room.door)).toBe(false);
          expect(piece.y + piece.height).toBe(room.floorY);
        }
      }
    }
  });

  it('keeps the furniture from overlapping itself', () => {
    for (const width of WIDTHS) {
      for (const side of SIDES) {
        const pieces = layoutRoom(width, HEIGHT, side).furniture;
        for (let a = 0; a < pieces.length; a += 1) {
          for (let b = a + 1; b < pieces.length; b += 1) {
            expect(intersects(pieces[a], pieces[b])).toBe(false);
          }
        }
      }
    }
  });

  it('puts every seat on a couch or an armchair', () => {
    for (const width of WIDTHS) {
      const room = layoutRoom(width, HEIGHT, 'right');
      const sofas = room.furniture.filter((piece) => piece.kind !== 'lamp');
      for (const seat of room.seats) {
        expect(sofas.some((piece) => seat.x > piece.x && seat.x < piece.x + piece.width)).toBe(true);
      }
    }
  });

  it('is a short walk from the shelf', () => {
    const room = layoutRoom(1180, HEIGHT, 'right');
    for (const seat of room.seats) {
      expect(Math.abs(seat.x - (room.shelf.x + room.shelf.width / 2))).toBeLessThan(200);
    }
  });

  it('gives a full-width room the couch and the armchair, and a phone at least a chair', () => {
    expect(layoutRoom(1180, HEIGHT, 'right').seats).toHaveLength(3);
    expect(layoutRoom(360, HEIGHT, 'right').seats.length).toBeGreaterThanOrEqual(1);
  });
});

describe('the lamp', () => {
  it('has its reaching spot beside the pole, head clear of the shade, facing it', () => {
    for (const width of WIDTHS) {
      for (const side of SIDES) {
        const room = layoutRoom(width, HEIGHT, side);
        const lamp = room.furniture.find((piece) => piece.kind === 'lamp');
        const reach = lampReach(room, BODY_WIDTH);
        if (!lamp) {
          expect(reach).toBeNull();
          continue;
        }
        const centre = lamp.x + lamp.width / 2;
        const bodyCentre = reach!.standX + BODY_WIDTH / 2;
        expect(Math.abs(bodyCentre - centre)).toBeGreaterThan(BODY_WIDTH / 2);
        // Facing the pole.
        expect(Math.sign(centre - bodyCentre)).toBe(reach!.facing);
        // Their head (the sprite's middle half) stays clear of the shade.
        const headLeft = reach!.standX - tinyPerson.body.offsetX + 6;
        const headRight = headLeft + 12;
        expect(headRight <= lamp.x || headLeft >= lamp.x + lamp.width).toBe(true);
      }
    }
  });
});

describe('stage right', () => {
  it('always puts the door on the right wall', () => {
    for (const width of WIDTHS) {
      for (const side of SIDES) {
        const room = layoutRoom(width, HEIGHT, side);
        expect(room.door.x + room.door.width / 2).toBeGreaterThan(width / 2);
        expect(room.door.x + room.door.width).toBe(width - DOORWAY.marginX);
      }
    }
  });

  it('keeps a right-hand shelf clear of the doorstep', () => {
    for (const width of WIDTHS) {
      const room = layoutRoom(width, HEIGHT, 'right');
      const step = doorstepX(room, BODY_WIDTH);
      expect(room.shelf.x + room.shelf.width).toBeLessThanOrEqual(step);
    }
  });
});
