import { normalizeArtistName } from './artist-name';
import { animation, characterRegistry, frame, getCharacter, tinyPerson } from './characters';
import type { ArtistPresence, CharacterDefinition } from './types';

/**
 * Rank assumed for a matched artist whose element declared no rank. Fed into
 * the same `RANK_WEIGHT / (rank + 1)` curve as a real rank, so this yields a
 * weight of 8/9 ≈ 0.89 — slightly below a single generic's weight of 1, not
 * above it.
 */
const UNRANKED_RANK = 8;
/** Numerator of the rank weighting curve: weight = RANK_WEIGHT / (rank + 1). */
const RANK_WEIGHT = 8;

export interface ArtistCharacterEntry {
  /** Names that map to this character, already normalised by `artistEntry`. */
  match: string[];
  character: CharacterDefinition;
}

/**
 * Artist characters are deliberately NOT in `characterRegistry`. `pickCharacter`
 * below builds its generic pool from that registry, so adding them there would
 * spawn Frank regardless of whether he is on the page — artists must only
 * spawn when present on the page, which is why they are folded into the pool
 * separately, weighted by presence.
 *
 * One array, holding the character itself rather than an id into a second map:
 * a single structure cannot drift out of sync with itself.
 */
export const artistRegistry: ArtistCharacterEntry[] = [];

/** Registers an artist, normalising its match names once instead of per lookup. */
function artistEntry(match: string[], character: CharacterDefinition): ArtistCharacterEntry {
  return { match: match.map(normalizeArtistName), character };
}

// The blond pose: forearm rising on the left, hand over the ear and temple.
// Head, face and legs match idleA so it reads as the same figure — only the
// left arm and the left hip hand move.
//
// Two things this frame learned the hard way, both invisible to the tests:
//   - The hand stops at the head's `h` column instead of covering it. Hand and
//     face are the same brown, so with the hair gone they merge into one wide
//     face; the green column is what separates them. Toning the hand
//     differently, or outlining it in `o`, both read worse — outlines here are
//     bright, so an outlined hand becomes a post standing beside the figure.
//   - The arm is built like the `jump` frame's: outline on the outer edge
//     only, stepping in at row 8 to merge with the shoulder. That merge needs
//     row 9 at jump's wider torso, not idleA's — against idleA's narrower row
//     the diagonal lands on the torso outline and the arm reads detached.
const frankSignature = frame([
  '................',
  '.....gggggg.....',
  '....gggggggg....',
  '.ossshhhhhhh....',
  '.osshssssssh....',
  '.osshsossosh....',
  '.osshssssssh....',
  '.ossossssss.....',
  '..ot..ssss......',
  '...otttttttto...',
  '...otttttttto...',
  '...otttttttto...',
  '...otttttttso...',
  '....otttttto....',
  '....oppppppo....',
  '....opp..ppo....',
  '....opp..ppo....',
  '....opp..ppo....',
  '....opp..ppo....',
  '....ob....bo....',
  '...obb....bbo...',
  '................'
]);

const frankOcean: CharacterDefinition = {
  ...tinyPerson,
  id: 'artist-frank-ocean',
  artistKey: 'frank ocean',
  palette: {
    ...tinyPerson.palette,
    g: '#2f6b3c', // shaded crown of the buzzcut
    h: '#4f9d5f', // blond green
    s: '#6b4230',
    t: '#6b4230', // bare torso, matching the skin
    p: '#2b3a4a'
  },
  animations: {
    ...tinyPerson.animations,
    signature: animation([frankSignature], 900)
  }
};

artistRegistry.push(artistEntry(['frank ocean'], frankOcean));

export function artistCharacterFor(name: string): CharacterDefinition | null {
  const key = normalizeArtistName(name);
  if (!key) return null;
  return artistRegistry.find((entry) => entry.match.includes(key))?.character ?? null;
}

/**
 * True when any presence maps to a registered artist character. The world uses
 * this to detect the moment the artist rail becomes meaningful, because the
 * first geometry scan runs before async-loaded artist elements exist.
 */
export function hasMatchedArtist(presences: ArtistPresence[]): boolean {
  return presences.some((presence) => artistCharacterFor(presence.name) !== null);
}

/** Resolves any character id — artist or generic — for the spawn command path. */
export function resolveCharacter(id?: string): CharacterDefinition {
  if (!id) return getCharacter(id);
  const artist = artistRegistry.find((entry) => entry.character.id === id);
  return artist ? artist.character : getCharacter(id);
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
  // does not get counted twice. Keyed by the definition itself — they are
  // singletons, so identity dedupes without a second lookup.
  const bestRank = new Map<CharacterDefinition, number>();
  for (const presence of presences) {
    const character = artistCharacterFor(presence.name);
    if (!character) continue;
    const rank = presence.rank ?? UNRANKED_RANK;
    const existing = bestRank.get(character);
    if (existing === undefined || rank < existing) bestRank.set(character, rank);
  }
  for (const [character, rank] of bestRank) {
    pool.push({ character, weight: RANK_WEIGHT / (rank + 1) });
  }

  const total = pool.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = random() * total;
  for (const entry of pool) {
    roll -= entry.weight;
    if (roll < 0) return entry.character;
  }
  return pool[pool.length - 1].character;
}
