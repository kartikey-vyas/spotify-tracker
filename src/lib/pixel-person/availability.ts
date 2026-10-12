/** Viewports at or below this width get no ambient population (summon still works). */
export const AMBIENT_MIN_VIEWPORT_WIDTH = 800;

/** Hard cap on how many people one room holds. */
export const MAX_PIXEL_PEOPLE = 6;

export function ambientPixelPersonPopulation(viewportWidth: number): number {
  return viewportWidth > AMBIENT_MIN_VIEWPORT_WIDTH ? 1 : 0;
}

/**
 * Whether a room should load its people at all. Reduced motion always wins;
 * otherwise a wide enough viewport, or an explicit summon on a narrow one.
 */
export function shouldRunPixelRoom(
  viewportWidth: number,
  reducedMotion: boolean,
  manuallySummoned = false
): boolean {
  return (
    !reducedMotion && (ambientPixelPersonPopulation(viewportWidth) > 0 || manuallySummoned)
  );
}

/** How many people the room wants right now. */
export function desiredPopulation(
  viewportWidth: number,
  manualPopulation: number,
  suppressed: boolean
): number {
  if (suppressed) return 0;
  return Math.min(
    MAX_PIXEL_PEOPLE,
    Math.max(ambientPixelPersonPopulation(viewportWidth), manualPopulation)
  );
}
