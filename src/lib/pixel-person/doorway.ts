import type { Point, Rect } from './types';

/**
 * The little door that appears while you are holding someone, for letting them
 * go for good. It is drawn on the pixel canvas rather than added to the page,
 * so it costs the document nothing and cannot disturb layout — and it is only
 * there while dragging, so it never becomes furniture.
 */
export const DOORWAY = {
  /** Sprite-pixel footprint, drawn at the character scale. */
  // Wide and tall enough to contain a 24x32 sprite, so someone standing on
  // the threshold is framed by the doorway rather than overhanging its posts.
  width: 34,
  height: 46,
  /** Inset from the viewport's right edge and its floor. */
  marginX: 28,
  marginBottom: 6,
  /** Generosity around the door when deciding whether a drop counts. */
  hitPadding: 22,
  /** Fade in when a drag starts, out when it ends. */
  fadeMs: 180,
  /**
   * Where someone dropped on the door is set down, measured left of the frame.
   * They land here and walk in, rather than dissolving wherever the pointer
   * happened to be — the little scene is the point, and a drop landing exactly
   * on the threshold would leave nothing to watch.
   *
   * Kept short on purpose. At 58 the walk was 82px, which is over three
   * seconds at the amble speed: long enough that the reader is waiting for it
   * rather than watching it. Just far enough to see them arrive is the point,
   * not a journey.
   */
  approachDistance: 16,
  /** How far above the ground they are set down, so the landing is visible. */
  dropHeight: 26,
  /** The door swinging shut behind them. */
  shutMs: 380,
  /** How long the shut door lingers before the whole thing fades away. */
  holdAfterShutMs: 420
} as const;

/**
 * Where the door stands, in document coordinates.
 *
 * Anchored to the viewport rather than the page so it is always within reach
 * of wherever the reader is dragging, and always in the same place relative to
 * the screen — a fixed spot is learnable in a way a moving one is not.
 */
export function doorwayRect(viewportBounds: Rect): Rect {
  return {
    x: viewportBounds.x + viewportBounds.width - DOORWAY.marginX - DOORWAY.width,
    y: viewportBounds.y + viewportBounds.height - DOORWAY.marginBottom - DOORWAY.height,
    width: DOORWAY.width,
    height: DOORWAY.height
  };
}

/**
 * Whether a drop at this document point should send someone through the door.
 *
 * Padded well beyond the art: the door is small, the thing being dropped is a
 * swinging body, and a near miss that silently does nothing is worse than a
 * generous target.
 */
export function isOverDoorway(point: Point, viewportBounds: Rect): boolean {
  const rect = doorwayRect(viewportBounds);
  return (
    point.x >= rect.x - DOORWAY.hitPadding &&
    point.x <= rect.x + rect.width + DOORWAY.hitPadding &&
    point.y >= rect.y - DOORWAY.hitPadding &&
    point.y <= rect.y + rect.height + DOORWAY.hitPadding
  );
}

/** Where someone set down at the door lands: on the ground, just outside it. */
export function doorstepX(viewportBounds: Rect, bodyWidth: number): number {
  const rect = doorwayRect(viewportBounds);
  return Math.max(
    viewportBounds.x + 4,
    rect.x - DOORWAY.approachDistance - bodyWidth
  );
}

/**
 * The height they are set down from, so they drop a short way and land.
 *
 * Dropping them at the pointer's own height does not work: the door sits at
 * the very bottom of the viewport, so a pointer near it leaves the body at or
 * below the floor, where it never registers as grounded and the landing beat
 * burns its whole timeout standing still. Starting just above the door's base
 * guarantees a real, short fall onto the floor the door stands on.
 */
export function doorstepY(viewportBounds: Rect, bodyHeight: number): number {
  const rect = doorwayRect(viewportBounds);
  const groundY = rect.y + rect.height;
  return groundY - bodyHeight - DOORWAY.dropHeight;
}

/** Where they walk to: standing centred in the opening. */
export function doorwayEnterX(viewportBounds: Rect, bodyWidth: number): number {
  const rect = doorwayRect(viewportBounds);
  return rect.x + rect.width / 2 - bodyWidth / 2;
}

/**
 * How visible the door is, 0 to 1: it fades in while someone is held and out
 * again when they are let go.
 */
export function doorwayOpacity(
  dragging: boolean,
  changedAt: number,
  now: number
): number {
  const elapsed = Math.max(0, now - changedAt);
  const progress = Math.min(1, elapsed / DOORWAY.fadeMs);
  return dragging ? progress : 1 - progress;
}
