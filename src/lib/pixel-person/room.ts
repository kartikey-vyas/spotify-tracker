import { DOORWAY } from './doorway';
import { clamp } from './physics';
import type { Collider, Facing, Point, Rect } from './types';

/**
 * The room is the whole world. It is one authored band of page with its own
 * canvas: a floor (the band's bottom edge), two walls, a ceiling, a low record
 * shelf and a door. Everything is in room-local CSS pixels, so nothing here
 * knows about scrolling or about the rest of the page.
 */
export type ShelfSide = 'left' | 'centre' | 'right';

export const ROOM = {
  /** Walks are never planned closer than this to a wall. */
  edgeComfort: 10,
  /** Furniture inset from the wall: clamp(minimum, fraction × width, maximum). */
  furnitureInsetMin: 24,
  furnitureInsetFraction: 0.09,
  furnitureInsetMax: 104,
  /** Thickness of the invisible walls, floor and ceiling. */
  wallThickness: 200,
  /** Floor kept between the door and a right-hand shelf, for the doorstep. */
  doorClearance: 40
} as const;

/**
 * A low record shelf standing on the floor. Records stand face-out on a board
 * at about hip height, so taking one is a crouch rather than a reach.
 */
export const SHELF = {
  /** Records are drawn at one CSS pixel per art pixel. */
  recordSize: 12,
  slotGap: 3,
  /** Board overhang beyond the outermost record. */
  overhang: 3,
  /** Height of the board's top edge above the floor. */
  boardHeight: 11,
  boardThickness: 2,
  maxSlots: 5,
  /** Rooms narrower than this get the short shelf. */
  narrowRoomWidth: 520,
  narrowSlots: 3
} as const;

export interface ShelfSlotLayout {
  /** Top-left of the record standing in this slot. */
  x: number;
  y: number;
}

export interface ShelfLayout extends Rect {
  /** Top of the board the records stand on. */
  boardY: number;
  slots: ShelfSlotLayout[];
}

/**
 * The lounge: a couch, an armchair and a floor lamp, drawn as flat pixel
 * shapes. Everything is in CSS pixels at one art pixel each.
 */
export const LOUNGE = {
  couchWidth: 60,
  armchairWidth: 28,
  lampWidth: 9,
  /** Floor to the top of a seat's back. */
  backHeight: 20,
  /** Floor to the top of an arm. */
  armHeight: 14,
  armWidth: 5,
  /** Floor to the top of the seat cushion, where a record set down beside a sitter rests. */
  cushionHeight: 9,
  lampHeight: 34,
  /** The record player: a low cabinet with a turntable on top. */
  playerWidth: 22,
  /** Floor to the top of the cabinet; the turntable's plinth sits on it. */
  playerCabinetHeight: 11,
  /** Floor to the top of the plinth, where the vinyl sits. */
  playerHeight: 14,
  /** Between the lamp and the couch. */
  lampGap: 3,
  /** Either side of the record player. */
  playerGap: 10,
  chairGap: 14,
  /** Clear floor kept around the shelf and the door. */
  clearance: 28
} as const;

export type FurnitureKind = 'couch' | 'armchair' | 'lamp' | 'player';

export interface FurniturePiece extends Rect {
  kind: FurnitureKind;
}

export interface SeatLayout {
  /** Centre x of the seat. */
  x: number;
  /**
   * Which way the sitter faces. The lounge pose rests one arm out to the side,
   * so each seat turns its sitter toward the nearer armrest.
   */
  facing: Facing;
}

export interface RoomLayout {
  width: number;
  height: number;
  /** The walking plane: feet stand on this y. */
  floorY: number;
  shelfSide: ShelfSide;
  shelf: ShelfLayout;
  furniture: FurniturePiece[];
  seats: SeatLayout[];
  /** Where the door stands when it is shown: while someone is held, arriving or leaving. */
  door: Rect;
  colliders: Collider[];
}

export function furnitureInset(width: number): number {
  return clamp(
    width * ROOM.furnitureInsetFraction,
    ROOM.furnitureInsetMin,
    ROOM.furnitureInsetMax
  );
}

export function shelfSlotCount(width: number): number {
  return width < SHELF.narrowRoomWidth ? SHELF.narrowSlots : SHELF.maxSlots;
}

export function layoutRoom(width: number, height: number, shelfSide: ShelfSide): RoomLayout {
  const floorY = height;
  const inset = furnitureInset(width);
  const slotCount = shelfSlotCount(width);
  const shelfWidth =
    slotCount * SHELF.recordSize + (slotCount - 1) * SHELF.slotGap + SHELF.overhang * 2;
  // People come and go stage right: the door is always on the right wall.
  const door: Rect = {
    x: width - DOORWAY.marginX - DOORWAY.width,
    y: floorY - DOORWAY.height,
    width: DOORWAY.width,
    height: DOORWAY.height
  };
  // A right-hand shelf keeps clear of the door, which matters on narrow rooms
  // where the usual inset would put the two on top of each other.
  const shelfX =
    shelfSide === 'left'
      ? inset
      : shelfSide === 'right'
        ? Math.min(width - inset - shelfWidth, door.x - ROOM.doorClearance - shelfWidth)
        : Math.round((width - shelfWidth) / 2);
  const boardY = floorY - SHELF.boardHeight;
  const slots: ShelfSlotLayout[] = Array.from({ length: slotCount }, (_, index) => ({
    x: shelfX + SHELF.overhang + index * (SHELF.recordSize + SHELF.slotGap),
    y: boardY - SHELF.recordSize
  }));

  const thick = ROOM.wallThickness;
  const colliders: Collider[] = [
    { id: 'floor', x: -thick, y: floorY, width: width + thick * 2, height: thick },
    { id: 'ceiling', x: -thick, y: -thick, width: width + thick * 2, height: thick },
    { id: 'wall-left', x: -thick, y: -thick, width: thick, height: height + thick * 2 },
    { id: 'wall-right', x: width, y: -thick, width: thick, height: height + thick * 2 }
  ];

  const { furniture, seats } = layoutLounge(width, floorY, { x: shelfX, width: shelfWidth }, door);

  return {
    width,
    height,
    floorY,
    shelfSide,
    furniture,
    seats,
    shelf: {
      x: shelfX,
      y: slots[0]?.y ?? boardY,
      width: shelfWidth,
      height: floorY - (slots[0]?.y ?? boardY),
      boardY,
      slots
    },
    door,
    colliders
  };
}

type LoungePlan = { kind: FurnitureKind; width: number; gapAfter: number }[];

/** Largest first: a room gets the biggest lounge that fits its free floor. */
const LOUNGE_PLANS: LoungePlan[] = [
  // The record player sits between the couch and the armchair, within reach
  // of both.
  [
    { kind: 'lamp', width: LOUNGE.lampWidth, gapAfter: LOUNGE.lampGap },
    { kind: 'couch', width: LOUNGE.couchWidth, gapAfter: LOUNGE.playerGap },
    { kind: 'player', width: LOUNGE.playerWidth, gapAfter: LOUNGE.playerGap },
    { kind: 'armchair', width: LOUNGE.armchairWidth, gapAfter: 0 }
  ],
  [
    { kind: 'lamp', width: LOUNGE.lampWidth, gapAfter: LOUNGE.lampGap },
    { kind: 'couch', width: LOUNGE.couchWidth, gapAfter: LOUNGE.playerGap },
    { kind: 'player', width: LOUNGE.playerWidth, gapAfter: 0 }
  ],
  [
    { kind: 'lamp', width: LOUNGE.lampWidth, gapAfter: LOUNGE.lampGap },
    { kind: 'couch', width: LOUNGE.couchWidth, gapAfter: LOUNGE.chairGap },
    { kind: 'armchair', width: LOUNGE.armchairWidth, gapAfter: 0 }
  ],
  [
    { kind: 'lamp', width: LOUNGE.lampWidth, gapAfter: LOUNGE.lampGap },
    { kind: 'couch', width: LOUNGE.couchWidth, gapAfter: 0 }
  ],
  [
    { kind: 'lamp', width: LOUNGE.lampWidth, gapAfter: LOUNGE.lampGap },
    { kind: 'armchair', width: LOUNGE.armchairWidth, gapAfter: 0 }
  ],
  [{ kind: 'armchair', width: LOUNGE.armchairWidth, gapAfter: 0 }]
];

/**
 * Puts the lounge right beside the shelf, so the records and the couch read as
 * one listening corner and fetching a record is a few steps rather than a trek
 * across the room. It takes whichever side of the shelf has more free floor;
 * the lamp always stands between the couch and the shelf.
 */
function layoutLounge(
  width: number,
  floorY: number,
  shelf: { x: number; width: number },
  door: { x: number; width: number }
): { furniture: FurniturePiece[]; seats: SeatLayout[] } {
  const gap = LOUNGE.clearance;
  const doorFrom = door.x - gap;
  const doorTo = door.x + door.width + gap;
  // Free floor on each side of the shelf, stopping at the door or the wall.
  const leftEnd = shelf.x - gap;
  const leftStart = doorTo <= leftEnd ? Math.max(gap, doorTo) : gap;
  const rightStart = shelf.x + shelf.width + gap;
  const rightEnd = doorFrom >= rightStart ? Math.min(width - gap, doorFrom) : width - gap;
  const sides = [
    { side: 'left' as const, room: leftEnd - leftStart },
    { side: 'right' as const, room: rightEnd - rightStart }
  ].sort((first, second) => second.room - first.room);

  for (const plan of LOUNGE_PLANS) {
    const total = plan.reduce((sum, piece) => sum + piece.width + piece.gapAfter, 0);
    const choice = sides.find((option) => option.room >= total);
    if (!choice) continue;
    // Laid out from the shelf outward: lamp nearest the shelf.
    const ordered = choice.side === 'right' ? plan : [...plan].reverse();
    const furniture: FurniturePiece[] = [];
    const seats: SeatLayout[] = [];
    let x = choice.side === 'right' ? rightStart : leftEnd - total;
    ordered.forEach((piece, index) => {
      const height =
        piece.kind === 'lamp'
          ? LOUNGE.lampHeight
          : piece.kind === 'player'
            ? LOUNGE.playerHeight
            : LOUNGE.backHeight;
      furniture.push({ kind: piece.kind, x, y: floorY - height, width: piece.width, height });
      if (piece.kind === 'couch') {
        seats.push({ x: x + Math.round(piece.width * 0.3), facing: 1 });
        seats.push({ x: x + Math.round(piece.width * 0.7), facing: -1 });
      } else if (piece.kind === 'armchair') {
        seats.push({ x: x + Math.round(piece.width / 2), facing: 1 });
      }
      // Reversed, each piece's gap belongs to the one before it in the plan.
      const gapAfter =
        choice.side === 'right' ? piece.gapAfter : (ordered[index + 1]?.gapAfter ?? 0);
      x += piece.width + gapAfter;
    });
    return { furniture, seats };
  }
  return { furniture: [], seats: [] };
}

function pieceOf(room: RoomLayout, kind: FurnitureKind): FurniturePiece | null {
  return room.furniture.find((piece) => piece.kind === kind) ?? null;
}

/** Body-left x that stands a body in front of the record player. */
export function playerStandX(room: RoomLayout, bodyWidth: number): number | null {
  const player = pieceOf(room, 'player');
  if (!player) return null;
  return clampToWalk(room, player.x + player.width / 2 - bodyWidth / 2, bodyWidth);
}

/** Slack around the lamp for clicking it: a 1px pole is too fine a target. */
const LAMP_HIT_PADDING = 4;

/** True when a room-local point is on (or just around) the floor lamp. */
export function isOnLamp(room: RoomLayout, point: Point): boolean {
  const lamp = lampOf(room);
  if (!lamp) return false;
  return (
    point.x >= lamp.x - LAMP_HIT_PADDING &&
    point.x <= lamp.x + lamp.width + LAMP_HIT_PADDING &&
    point.y >= lamp.y - LAMP_HIT_PADDING &&
    point.y <= lamp.y + lamp.height
  );
}

/** The floor lamp, when this room's lounge has one. */
export function lampOf(room: RoomLayout): FurniturePiece | null {
  return pieceOf(room, 'lamp');
}

export interface LampReach {
  /** Body-left x to stand at, beside the pole. */
  standX: number;
  /** Facing the lamp, so the raised hand reaches the shade. */
  facing: Facing;
}

/**
 * Where to stand to switch the lamp: beside it on the open-floor side (toward
 * the shelf, since the couch is tight against the other side), facing it. The
 * shade is at head height, so standing under it would wear it like a hat; the
 * offsets keep the head just clear of it with the raised hand at its edge.
 */
export function lampReach(room: RoomLayout, bodyWidth: number): LampReach | null {
  const lamp = lampOf(room);
  if (!lamp) return null;
  const centre = lamp.x + lamp.width / 2;
  const side = room.shelf.x + room.shelf.width / 2 >= centre ? 1 : -1;
  return {
    standX: clampToWalk(room, side === 1 ? centre + 5 : centre - bodyWidth - 5, bodyWidth),
    facing: side === 1 ? -1 : 1
  };
}

/** Body-left x that stands a body in front of a seat, ready to sit. */
export function seatStandX(room: RoomLayout, seat: number, bodyWidth: number): number {
  return clampToWalk(room, room.seats[seat].x - bodyWidth / 2, bodyWidth);
}

/** The body-left x range a body of this width may plan walks within. */
export function walkRange(room: RoomLayout, bodyWidth: number): { minX: number; maxX: number } {
  const minX = ROOM.edgeComfort;
  const maxX = Math.max(minX, room.width - bodyWidth - ROOM.edgeComfort);
  return { minX, maxX };
}

/** A body-left x kept within the walk range. */
export function clampToWalk(room: RoomLayout, x: number, bodyWidth: number): number {
  const { minX, maxX } = walkRange(room, bodyWidth);
  return clamp(x, minX, maxX);
}

/** Body-left x that stands a body centred on a shelf slot. */
export function slotStandX(room: RoomLayout, slot: number, bodyWidth: number): number {
  const layout = room.shelf.slots[slot];
  return clampToWalk(room, layout.x + SHELF.recordSize / 2 - bodyWidth / 2, bodyWidth);
}

/** How far someone likes to carry a record before sitting down with it. */
export const SETTLE_DISTANCE = 110;

/**
 * Somewhere to settle: spread out from everyone else, clear of the shelf, and
 * about `preferredDistance` from where they are now — a few steps, not a hike
 * and not on the spot. Sampled rather than solved — the room is one dimension
 * and a dozen candidates is plenty to look deliberate.
 */
export function chooseOpenSpot(
  room: RoomLayout,
  bodyWidth: number,
  fromX: number,
  othersX: readonly number[],
  random: () => number,
  options: { avoidFurniture?: boolean; preferredDistance?: number } = {}
): number {
  const preferred = options.preferredDistance ?? 0;
  const { minX, maxX } = walkRange(room, bodyWidth);
  // Sitting on the floor in front of the couch or the shelf looks like a
  // mistake, so a settling spot keeps clear of every piece of furniture.
  const keepClear = [room.shelf, ...room.furniture].map((piece) => ({
    from: piece.x - bodyWidth - 6,
    to: piece.x + piece.width + 6
  }));
  let best = clamp(fromX, minX, maxX);
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let attempt = 0; attempt < 14; attempt += 1) {
    const candidate = minX + random() * (maxX - minX);
    if (
      options.avoidFurniture &&
      keepClear.some((zone) => candidate > zone.from && candidate < zone.to)
    ) {
      continue;
    }
    const spacing = othersX.length
      ? Math.min(60, ...othersX.map((x) => Math.abs(x - candidate)))
      : 60;
    // Spacing dominates; distance only breaks ties, so a crowded room still
    // spreads people out even when that means a longer walk.
    const score = spacing - Math.abs(Math.abs(candidate - fromX) - preferred) * 0.08;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}
