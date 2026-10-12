import type { ArtistPresence } from './types';

/**
 * Turns `data-pixel-artist` / `data-pixel-artist-rank` attribute values into a
 * presence. Kept free of DOM types so it can be unit tested — vitest runs in
 * the node environment and no jsdom is installed.
 */
export function parseArtistPresence(
  nameAttribute: string | null,
  rankAttribute: string | null
): ArtistPresence | null {
  const name = nameAttribute?.trim();
  if (!name) return null;
  const parsed = Number(rankAttribute);
  const rank = Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
  return { name, rank };
}
