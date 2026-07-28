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

// The blond pose: forearm rising on the left to a hand cupped over the ear and
// temple. Head, face and legs match idleA so it reads as the same figure —
// only the left arm moves.
//
// The hard part is that Frank's palette collapses `s`, `f` and `t` onto one
// brown, so hand, face, arm and torso are all the same colour — the silhouette
// has to do the whole job. At 16x22 the hand was 2x2 and read as a blob. Here
// it is a closed 4-wide, 6-tall mass, and four things separate it:
//   - It is drawn in front of the head. The head is 12 wide from column 6; the
//     hand covers columns 6-7 and overhangs left to column 3, so it breaks the
//     head's own outline instead of sitting beside it.
//   - Its whole contour is `o`, including the seam at column 8 where it crosses
//     the face. Outlining the *arm* turns it into a post; outlining only the
//     hand's contour reads as a hand's edge, the same trick the torso already
//     uses for the idle hands.
//   - A raised finger: rows 1-2 step in to 2 pixels above the 4-wide hand, and
//     that notch against the green crown is the strongest single cue here.
//   - The wrist steps 4 -> 3 -> 2 down rows 9-13, so the forearm is visibly
//     thinner than the hand rather than one continuous bar.
// The arm merges into the torso at row 14 by taking over the shoulder's own
// outline column, which is what keeps it attached rather than adjacent.
const frankSignature = frame([
  '........................',
  '.....oo.gggggggg........',
  '....okkoggggggggg.......',
  '...okkkkoggggggggg......',
  '...okkkkohhhhhhhhh......',
  '..okkkkkohhhhhhhhh......',
  '..okkkkkossssssssf......',
  '...okkkkossssssssf......',
  '...okkkkosssssoosf......',
  '...okkkosssssssssf......',
  '...okkossssssssss.......',
  '...okko.ssssssss........',
  '...okko..ssssss.........',
  '....okk..ssssss.........',
  '....okktttttttttto......',
  '.....otttttttttttto.....',
  '.....otttttttttttto.....',
  '.....otttttttttttto.....',
  '.....otttttttttttto.....',
  '.....osttttttttttso.....',
  '.....osttttttttttso.....',
  '......otttttttttto......',
  '......oppppppppppo......',
  '......oppppppppppo......',
  '......oppp....pppo......',
  '......oppp....pppo......',
  '......oppp....pppo......',
  '......oppp....pppo......',
  '......oppp....pppo......',
  '......obbb....bbbo......',
  '......obbb....bbbo......',
  '.....obbbb....bbbbo.....'
]);

const frankOcean: CharacterDefinition = {
  ...tinyPerson,
  id: 'artist-frank-ocean',
  artistKey: 'frank ocean',
  palette: {
    ...tinyPerson.palette,
    // Bright at the crown fading darker at the hairline, the way the bleach
    // sits on the album cover. The reverse read as a dark cap.
    g: '#63b56e',
    h: '#357a45',
    // Temple is skin, not hair. This is what makes it a buzzcut: with hair in
    // the temple column the green wrapped the whole head and read as a helmet.
    f: '#6b4230',
    s: '#6b4230',
    k: '#8a5740', // hand raised in front of the face, catching light
    t: '#6b4230', // bare torso, matching the skin
    p: '#2b3a4a',
    b: '#26313d'
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
