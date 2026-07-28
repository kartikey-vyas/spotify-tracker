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

// Frank owns his own copy of every frame so he can be shaped independently of
// the generic rig. He began as a pure palette swap, which made the green
// buzzcut free but left no pixel that was actually his.
//
// The cost of this fork is that fixes to the shared rig no longer reach him.
// That is the intended trade for an artist character: past the point where one
// is meant to look distinct, inheriting the generic silhouette stops being a
// feature.
const frankIdleA = frame([
  '........................',
  '........gggggggg........',
  '.......gggggggggg.......',
  '......gggggggggggg......',
  '......hhhhhhhhhhhh......',
  '......hhhhhhhhhhhh......',
  '......fssssssssssf......',
  '......fssssssssssf......',
  '......fsoossssoosf......',
  '......fssssssssssf......',
  '.......ssssssssss.......',
  '........ssssssss........',
  '.........ssssss.........',
  '.........ssssss.........',
  '......otttttttttto......',
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

const frankIdleB = frame([
  '........................',
  '........................',
  '........gggggggg........',
  '.......gggggggggg.......',
  '......gggggggggggg......',
  '......hhhhhhhhhhhh......',
  '......hhhhhhhhhhhh......',
  '......fssssssssssf......',
  '......fssssssssssf......',
  '......fsoossssoosf......',
  '......fssssssssssf......',
  '.......ssssssssss.......',
  '........ssssssss........',
  '.........ssssss.........',
  '......otttttttttto......',
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

const frankWalkA = frame([
  '........................',
  '........gggggggg........',
  '.......gggggggggg.......',
  '......gggggggggggg......',
  '......hhhhhhhhhhhh......',
  '......hhhhhhhhhhhh......',
  '......fssssssssssf......',
  '......fssssssssssf......',
  '......fsoossssoosf......',
  '......fssssssssssf......',
  '.......ssssssssss.......',
  '........ssssssss........',
  '.........ssssss.........',
  '.........ssssss.........',
  '......otttttttttto......',
  '.....otttttttttttto.....',
  '.....otttttttttttto.....',
  '.....otttttttttttto.....',
  '.....otttttttttttso.....',
  '.....otttttttttttso.....',
  '.....osttttttttttto.....',
  '......otttttttttto......',
  '......oppppppppppo......',
  '......oppppppppppo......',
  '......oppp....pppo......',
  '.....oppp......pppo.....',
  '.....oppp......pppo.....',
  '....oppp........pppo....',
  '....oppp........pppo....',
  '....obbb........bbbo....',
  '....obbb........bbbo....',
  '...obbbb........bbbbo...'
]);

const frankWalkB = frame([
  '........................',
  '........gggggggg........',
  '.......gggggggggg.......',
  '......gggggggggggg......',
  '......hhhhhhhhhhhh......',
  '......hhhhhhhhhhhh......',
  '......fssssssssssf......',
  '......fssssssssssf......',
  '......fsoossssoosf......',
  '......fssssssssssf......',
  '.......ssssssssss.......',
  '........ssssssss........',
  '.........ssssss.........',
  '.........ssssss.........',
  '......otttttttttto......',
  '.....otttttttttttto.....',
  '.....otttttttttttto.....',
  '.....otttttttttttto.....',
  '.....osttttttttttto.....',
  '.....osttttttttttto.....',
  '.....otttttttttttso.....',
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
  '.....obbbb....bbbo......'
]);

const frankJump = frame([
  '..sss..............sss..',
  '..sss...gggggggg...sss..',
  '..ott..gggggggggg..tto..',
  '..ott.gggggggggggg.tto..',
  '..ott.hhhhhhhhhhhh.tto..',
  '..ott.hhhhhhhhhhhh.tto..',
  '..ott.fssssssssssf.tto..',
  '..ott.fssssssssssf.tto..',
  '..ott.fsoossssoosf.tto..',
  '..ott.fssssssssssf.tto..',
  '..ott..ssssssssss..tto..',
  '..ott...ssssssss...tto..',
  '...ott...ssssss...tto...',
  '....ott..ssssss..tto....',
  '....otttttttttttttto....',
  '.....otttttttttttto.....',
  '.....otttttttttttto.....',
  '.....osttttttttttso.....',
  '.....otttttttttttto.....',
  '.....otttttttttttto.....',
  '......otttttttttto......',
  '......oppppppppppo......',
  '.....oppp......pppo.....',
  '.....oppp......pppo.....',
  '....oppp........pppo....',
  '....oppp........pppo....',
  '....oppp........pppo....',
  '....obbb........bbbo....',
  '....obbb........bbbo....',
  '...obbbb........bbbbo...',
  '........................',
  '........................'
]);

const frankFall = frame([
  '........................',
  '........gggggggg........',
  '.......gggggggggg.......',
  '......gggggggggggg......',
  '......hhhhhhhhhhhh......',
  '......hhhhhhhhhhhh......',
  '......fssssssssssf......',
  '......fssssssssssf......',
  '......fsoossssoosf......',
  '......fssssssssssf......',
  '.......ssssssssss.......',
  '........ssssssss........',
  '.........ssssss.........',
  '.........ssssss.........',
  '......otttttttttto......',
  '.....otttttttttttto.....',
  '.....otttttttttttto.....',
  '.ssttottttttttttttottss.',
  '.ssttottttttttttttottss.',
  '.....otttttttttttto.....',
  '.....otttttttttttto.....',
  '......otttttttttto......',
  '......oppppppppppo......',
  '......oppppppppppo......',
  '.....oppp......pppo.....',
  '.....oppp......pppo.....',
  '.....oppp......pppo.....',
  '.....oppp......pppo.....',
  '.....oppp......pppo.....',
  '.....obbb......bbbo.....',
  '.....obbb......bbbo.....',
  '....obbbb......bbbbo....'
]);

const frankCrawlA = frame([
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '...............gggggg...',
  '..............gggggggg..',
  '.............hhhhhhhhh..',
  '......otttttthhfssssss..',
  '....otttttttthfssoosss..',
  '..oppptttttttttsssssso..',
  '.oppppttttttttttooooo...',
  '.opppo...opppo.otto.....',
  'opppo....opppo.otto.....',
  'opppo....opppo..otto....',
  'obbbo....obbbo..osso....',
  'obbbo....obbbo..osssso..'
]);

const frankCrawlB = frame([
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '...............gggggg...',
  '..............gggggggg..',
  '.............hhhhhhhhh..',
  '......otttttthhfssssss..',
  '....otttttttthfssoosss..',
  '...opptttttttttsssssso..',
  '..opppttttttttttooooo...',
  '..opppo..opppo..otto....',
  '.opppo...opppo..otto....',
  '.opppo...opppo...otto...',
  '.obbbo...obbbo...osso...',
  '.obbbo...obbbo...osssso.'
]);

const frankClimbA = frame([
  '..................sss...',
  '..................sss...',
  '.......gggggggg...ttto..',
  '......gggggggggg..ttto..',
  '.....gggggggggggg.ttto..',
  '.....hhhhhhhhhhhh.ttto..',
  '.....hhhhhhhhhhhh.ttto..',
  '.....fssssssssssf.ttto..',
  '.....fssssssssssf.ttto..',
  '.....fsoossssoosf.ttto..',
  '.....fssssssssssf.ttto..',
  '......ssssssssss..ttto..',
  '.......ssssssss...ttto..',
  '........ssssss....ttto..',
  '....otttttttttttttttto..',
  '....otttttttttttto......',
  '....otttttttttttto......',
  '....otttttttttttto......',
  '....otttttttttttto......',
  '....osttttttttttto......',
  '....osttttttttttto......',
  '.....otttttttttto.......',
  '.....oppppppppppo.......',
  '.....oppppppppppo.......',
  '.....oppp....pppo.......',
  '...oppp......pppo.......',
  '..oppp.......pppo.......',
  '..obbbo......pppo.......',
  '.............pppo.......',
  '.............pppo.......',
  '............obbbo.......',
  '...........obbbbo.......'
]);

const frankClimbB = frame([
  '...sss..................',
  '...sss..................',
  '..ottt...gggggggg.......',
  '..ottt..gggggggggg......',
  '..ottt.gggggggggggg.....',
  '..ottt.hhhhhhhhhhhh.....',
  '..ottt.hhhhhhhhhhhh.....',
  '..ottt.fssssssssssf.....',
  '..ottt.fssssssssssf.....',
  '..ottt.fsoossssoosf.....',
  '..ottt.fssssssssssf.....',
  '..ottt..ssssssssss......',
  '..ottt...ssssssss.......',
  '..ottt....ssssss........',
  '..otttttttttttttttto....',
  '......otttttttttttto....',
  '......otttttttttttto....',
  '......otttttttttttto....',
  '......otttttttttttto....',
  '......otttttttttttso....',
  '......otttttttttttso....',
  '.......otttttttttto.....',
  '.......oppppppppppo.....',
  '.......oppppppppppo.....',
  '.......oppp....pppo.....',
  '.......oppp......pppo...',
  '.......oppp.......pppo..',
  '.......oppp......obbbo..',
  '.......oppp.............',
  '.......oppp.............',
  '.......obbbo............',
  '.......obbbbo...........'
]);

const frankMantleA = frame([
  '........................',
  '........gggggggg........',
  '.......gggggggggg.......',
  '......gggggggggggg......',
  '......hhhhhhhhhhhh......',
  '......hhhhhhhhhhhh......',
  '......fssssssssssf......',
  '......fssssssssssf......',
  '......fsoossssoosf......',
  '......fssssssssssf......',
  '.......ssssssssss.......',
  '........ssssssss........',
  '.........ssssss.........',
  '.........ssssss.........',
  '......otttttttttto......',
  '.....otttttttttttto.....',
  '.....otttttttttttto.....',
  '...ottottttttttttotto...',
  '...ottottttttttttotto...',
  '...ottottttttttttotto...',
  '...ottottttttttttotto...',
  '...ottottttttttttotto...',
  '...ottoppppppppppotto...',
  '...ottoppppppppppotto...',
  '...ossoppp....ppposso...',
  '...ossoppp....ppposso...',
  '......oppp....pppo......',
  '......obbb....bbbo......',
  '......obbb....bbbo......',
  '.....obbbb....bbbbo.....',
  '........................',
  '........................'
]);

const frankMantleB = frame([
  '.......gggggggggg.......',
  '......gggggggggggg......',
  '......hhhhhhhhhhhh......',
  '......hhhhhhhhhhhh......',
  '......fssssssssssf......',
  '......fssssssssssf......',
  '......fsoossssoosf......',
  '......fssssssssssf......',
  '.......ssssssssss.......',
  '........ssssssss........',
  '.........ssssss.........',
  '......otttttttttto......',
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
  '.....obbbb....bbbbo.....',
  '........................',
  '........................',
  '........................'
]);

const frankHideA = frame([
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........gggggggg........',
  '.......gggggggggg.......',
  '......gggggggggggg......',
  '......hhhhhhhhhhhh......',
  '......hhhhhhhhhhhh......',
  '......fssssssssssf......',
  '......fssssssssssf......',
  '......fsoossssoosf......',
  '......fssssssssssf......',
  '.......ssssssssss.......',
  '........ssssssss........',
  '.........ssssss.........',
  '......otttttttttto......',
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
  '......obbb....bbbo......',
  '.....obbbb....bbbbo.....'
]);

const frankDangleA = frame([
  '.sss....................',
  '.sss....................',
  '.ott....................',
  '.ott.....gggggggg.......',
  '.ott....gggggggggg......',
  '.ott...gggggggggggg.....',
  '.ott...hhhhhhhhhhhh.....',
  '.ott...hhhhhhhhhhhh.....',
  '.ott...fssssssssssf.....',
  '..ott..fssssssssssf.....',
  '.ott...fsoossssoosf.....',
  '..ott..fssssssssssf.....',
  '...ott..ssssssssss......',
  '...ott...ssssssss.......',
  '....ott...ssssss........',
  '....otttttttttttttto....',
  '......ottttttttttttotto.',
  '......ottttttttttttotto.',
  '......ottttttttttttotto.',
  '......ottttttttttttotto.',
  '......ottttttttttttotto.',
  '......ottttttttttttosso.',
  '......ottttttttttttosso.',
  '.......otttttttttto.....',
  '........oppppppppppo....',
  '........oppppppppppo....',
  '........oppp....pppo....',
  '.........oppp....pppo...',
  '.........oppp....pppo...',
  '..........oppp....pppo..',
  '..........obbb....bbbo..',
  '.........obbbb....bbbbo.'
]);

const frankDangleB = frame([
  '.sss....................',
  '.sss....................',
  '.ott....................',
  '.ott.....gggggggg.......',
  '.ott....gggggggggg......',
  '.ott...gggggggggggg.....',
  '.ott...hhhhhhhhhhhh.....',
  '.ott...hhhhhhhhhhhh.....',
  '.ott...fssssssssssf.....',
  '..ott..fssssssssssf.....',
  '.ott...fsoossssoosf.....',
  '..ott..fssssssssssf.....',
  '...ott..ssssssssss......',
  '...ott...ssssssss.......',
  '....ott...ssssss........',
  '....otttttttttttttto....',
  '......ottttttttttttotto.',
  '......ottttttttttttotto.',
  '......ottttttttttttotto.',
  '......otttttttttttto.tto',
  '......otttttttttttto.tto',
  '......otttttttttttto.sso',
  '......otttttttttttto.sso',
  '.......otttttttttto.....',
  '........oppppppppppo....',
  '........oppppppppppo....',
  '........oppp....pppo....',
  '........oppp....pppo....',
  '.......oppp....pppo.....',
  '.......oppp....pppo.....',
  '.......obbb....bbbo.....',
  '......obbbb....bbbbo....'
]);

const frankListenA = frame([
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........nnnnnnnn........',
  '.......nggggggggn.......',
  '......nggggggggggn......',
  '....nnggggggggggggnn....',
  '...nnnhhhhhhhhhhhhnnn...',
  '...nnnhhhhhhhhhhhhnnn...',
  '...nnnfssssssssssfnnn...',
  '...nnnfssssssssssfnnn...',
  '...nnnfsoossssoosfnnn...',
  '...nnnfssssssssssfnnn...',
  '....nn.ssssssssss.nn....',
  '........ssssssss........',
  '.........ssssss.........',
  '.........ssssss.........',
  '......otttttttttto......',
  '.....otttttttttttto.....',
  '.....otttttttttttto.....',
  '.....osttttttttttso.....',
  '......otttttttttto......',
  '.....oppppppppppppo.....',
  '....oppppppppppppppo....',
  '....obbbppppppppbbbo....',
  '........................',
  '........................',
  '........................',
  '........................'
]);

const frankListenB = frame([
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........nnnnnnnn........',
  '.......nggggggggn.......',
  '......nggggggggggn......',
  '....nnggggggggggggnn....',
  '...nnnhhhhhhhhhhhhnnn...',
  '...nnnhhhhhhhhhhhhnnn...',
  '...nnnfssssssssssfnnn...',
  '...nnnfssssssssssfnnn...',
  '...nnnfsoossssoosfnnn...',
  '...nnnfssssssssssfnnn...',
  '....nn.ssssssssss.nn....',
  '........ssssssss........',
  '......otttttttttto......',
  '.....otttttttttttto.....',
  '.....otttttttttttto.....',
  '.....osttttttttttso.....',
  '......otttttttttto......',
  '.....oppppppppppppo.....',
  '....oppppppppppppppo....',
  '....obbbppppppppbbbo....',
  '........................',
  '........................',
  '........................',
  '........................'
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
    t: '#6b4230', // bare torso, matching the skin
    p: '#2b3a4a',
    b: '#26313d'
  },
  animations: {
    idle: animation([frankIdleA, frankIdleB], 620),
    walk: animation([frankWalkA, frankWalkB], 145),
    jump: animation([frankJump], 250, false),
    fall: animation([frankFall], 250, false),
    crawl: animation([frankCrawlA, frankCrawlB], 220),
    climb: animation([frankClimbA, frankClimbB], 190),
    mantle: animation([frankMantleA, frankMantleB], 150, false),
    // hide reuses the idle B-frame, mirroring the shared rig.
    hide: animation([frankHideA, frankIdleB], 520),
    dangle: animation([frankDangleA, frankDangleB], 240),
    listen: animation([frankListenA, frankListenB], 480)
  },
  frameSource: {
    file: 'src/lib/pixel-person/artists.ts',
    names: {
      'idle:0': 'frankIdleA', 'idle:1': 'frankIdleB',
      'walk:0': 'frankWalkA', 'walk:1': 'frankWalkB',
      'jump:0': 'frankJump', 'fall:0': 'frankFall',
      'crawl:0': 'frankCrawlA', 'crawl:1': 'frankCrawlB',
      'climb:0': 'frankClimbA', 'climb:1': 'frankClimbB',
      'mantle:0': 'frankMantleA', 'mantle:1': 'frankMantleB',
      'hide:0': 'frankHideA', 'hide:1': 'frankIdleB',
      'dangle:0': 'frankDangleA', 'dangle:1': 'frankDangleB',
      'listen:0': 'frankListenA', 'listen:1': 'frankListenB'
    }
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
