import { characterRegistry, getCharacter } from './characters';
import type { ArtistPresence, CharacterDefinition } from './types';

/** Weight given to a matched artist whose element declared no rank. */
const UNRANKED = 8;
/** Numerator of the rank weighting curve: weight = RANK_WEIGHT / (rank + 1). */
const RANK_WEIGHT = 8;

export interface ArtistCharacterEntry {
  /** Names that map to this character; compared after normalisation. */
  match: string[];
  characterId: string;
}

/**
 * Artist characters are deliberately NOT in `characterRegistry`. That registry
 * is what `randomCharacter()` iterates, so adding them there would spawn Frank
 * regardless of whether he is on the page — the behaviour this exists to replace.
 */
export const artistCharacters: Record<string, CharacterDefinition> = {};
export const artistRegistry: ArtistCharacterEntry[] = [];

/** Collapses a display name to a stable match key. */
export function normalizeArtistName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function artistCharacterFor(name: string): CharacterDefinition | null {
  const key = normalizeArtistName(name);
  if (!key) return null;
  for (const entry of artistRegistry) {
    if (entry.match.some((candidate) => normalizeArtistName(candidate) === key)) {
      return artistCharacters[entry.characterId] ?? null;
    }
  }
  return null;
}

/** Resolves any character id — artist or generic — for the spawn command path. */
export function resolveCharacter(id?: string): CharacterDefinition {
  if (id && artistCharacters[id]) return artistCharacters[id];
  return getCharacter(id);
}

/**
 * Picks who spawns. Generic characters weight 1; each artist present on the
 * page weights `8 / (rank + 1)`, so a #1 artist is likely and a #8 is a treat.
 * With no matched artists this reduces to a uniform pick over the generics,
 * which is the pre-existing behaviour.
 */
export function pickCharacter(
  presences: ArtistPresence[] = [],
  random: () => number = Math.random
): CharacterDefinition {
  const pool: { character: CharacterDefinition; weight: number }[] = Object.values(
    characterRegistry
  ).map((character) => ({ character, weight: 1 }));

  // Best (lowest) rank wins, so an artist in both the cover wall and the list
  // does not get counted twice.
  const bestRank = new Map<string, number>();
  for (const presence of presences) {
    const character = artistCharacterFor(presence.name);
    if (!character) continue;
    const rank = presence.rank ?? UNRANKED;
    const existing = bestRank.get(character.id);
    if (existing === undefined || rank < existing) bestRank.set(character.id, rank);
  }
  for (const [id, rank] of bestRank) {
    const character = artistCharacters[id];
    if (character) pool.push({ character, weight: RANK_WEIGHT / (rank + 1) });
  }

  const total = pool.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = random() * total;
  for (const entry of pool) {
    roll -= entry.weight;
    if (roll < 0) return entry.character;
  }
  return pool[pool.length - 1].character;
}
