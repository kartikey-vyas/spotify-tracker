import { intersects } from './physics';
import type { Rect } from './types';

/**
 * How far below the document a body must be before it counts as lost.
 *
 * Generous, because the alternative — recovering someone who was merely
 * standing near the bottom of a page that briefly reflowed — teleports a
 * person the reader was looking at.
 */
const FALL_MARGIN = 240;

/**
 * Whether this body has a world to be simulated in.
 *
 * Geometry is only collected within the scanned window (the viewport plus
 * SCAN_PADDING), so a body outside it has no colliders: stepping it would drop
 * it through a floor that was never scanned, and the free-fall would then trip
 * the lost-body recovery. Someone scrolled away from is therefore frozen where
 * they stand — same spot on the page, same character — and picks up again when
 * the reader comes back.
 */
export function isWithinSimulatedWorld(body: Rect, scanBounds: Rect): boolean {
  return intersects(body, scanBounds);
}

/**
 * Whether this body is genuinely lost rather than merely scrolled away from.
 *
 * Measured against the document, never against the scanned window: the window
 * follows the viewport, so anything below the fold reads as "fallen out of the
 * world" the moment the reader scrolls up.
 */
export function hasFallenOutOfWorld(body: Rect, documentHeight: number): boolean {
  return body.y > documentHeight + FALL_MARGIN;
}
