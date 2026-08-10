import type { Point, Rect } from './types';

/**
 * The little door that appears while you are holding someone, for letting them
 * go for good. It is drawn on the pixel canvas rather than added to the page,
 * so it costs the document nothing and cannot disturb layout — and it is only
 * there while dragging, so it never becomes furniture.
 */
export const DOORWAY = {
  /** Sprite-pixel footprint, drawn at the character scale. */
  width: 26,
  height: 38,
  /** Inset from the viewport's right edge and its floor. */
  marginX: 28,
  marginBottom: 6,
  /** Generosity around the door when deciding whether a drop counts. */
  hitPadding: 22,
  /** Fade in when a drag starts, out when it ends. */
  fadeMs: 180
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
