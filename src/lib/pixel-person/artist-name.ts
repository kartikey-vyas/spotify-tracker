/**
 * Collapses an artist display name to a stable match key: strips diacritics and
 * punctuation, lowercases, and collapses whitespace. Idempotent.
 *
 * Lives below the artist content layer on purpose. `simulation.ts` needs it for
 * record affinity, and importing it from `artists.ts` would give the DOM-free
 * physics core a dependency on every artist's frame data and matching rules —
 * a module that grows with each artist added.
 */
export function normalizeArtistName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
