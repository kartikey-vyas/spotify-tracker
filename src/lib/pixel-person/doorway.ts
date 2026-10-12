import type { RoomLayout } from './room';
import type { Point } from './types';

/**
 * The little door people come in and go out by. It stands on the room's floor
 * against the right wall, and is only there while someone is held, arriving
 * or leaving, so it never becomes furniture.
 */
export const DOORWAY = {
  // Wide and tall enough to contain a 24x32 sprite, so someone standing on
  // the threshold is framed by the doorway rather than overhanging its posts.
  width: 34,
  height: 46,
  /** Inset from the room's wall. */
  marginX: 28,
  /** Generosity around the door when deciding whether a drop counts. */
  hitPadding: 22,
  /** Fade in when it is wanted, out once nobody is using it. */
  fadeMs: 180,
  /**
   * Where someone dropped on the door is set down, measured from the frame on
   * the room side. Just far enough to see them arrive, not a journey.
   */
  approachDistance: 16,
  /** How far above the floor they are set down, so the landing is visible. */
  dropHeight: 26,
  /** How long the shut door lingers before the whole thing fades away. */
  holdAfterShutMs: 420
} as const;

/**
 * Whether a drop at this room point should send someone through the door.
 *
 * Padded well beyond the art: the door is small, the thing being dropped is a
 * swinging body, and a near miss that silently does nothing is worse than a
 * generous target.
 */
export function isOverDoorway(point: Point, room: RoomLayout): boolean {
  const rect = room.door;
  return (
    point.x >= rect.x - DOORWAY.hitPadding &&
    point.x <= rect.x + rect.width + DOORWAY.hitPadding &&
    point.y >= rect.y - DOORWAY.hitPadding &&
    point.y <= rect.y + rect.height + DOORWAY.hitPadding
  );
}

/** Body-left x where someone set down at the door lands: just outside it. */
export function doorstepX(room: RoomLayout, bodyWidth: number): number {
  const rect = room.door;
  // The door is on the right wall, so the room is to its left.
  return Math.max(2, rect.x - DOORWAY.approachDistance - bodyWidth);
}

/** Body-left x they walk to: standing centred in the opening. */
export function doorwayEnterX(room: RoomLayout, bodyWidth: number): number {
  return room.door.x + room.door.width / 2 - bodyWidth / 2;
}

/**
 * How visible the door is, 0 to 1: it fades in while someone is held and out
 * again when they are let go.
 */
export function doorwayOpacity(shown: boolean, changedAt: number, now: number): number {
  const elapsed = Math.max(0, now - changedAt);
  const progress = Math.min(1, elapsed / DOORWAY.fadeMs);
  return shown ? progress : 1 - progress;
}
