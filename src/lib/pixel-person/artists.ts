import { normalizeArtistName } from './artist-name';
import {
  ambientCharacterRegistry,
  animation,
  frameOfSize,
  getCharacter
} from './characters';
import type { ArtistPresence, CharacterDefinition, SpriteFrame } from './types';

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
 * Artist characters are deliberately NOT in `characterRegistry` or
 * `ambientCharacterRegistry`. `pickCharacter` builds its ordinary spawn pool
 * from the latter, so artists must be folded in separately and weighted by
 * presence.
 *
 * One array, holding the character itself rather than an id into a second map:
 * a single structure cannot drift out of sync with itself.
 */
export const artistRegistry: ArtistCharacterEntry[] = [];

/** Registers an artist, normalising its match names once instead of per lookup. */
function artistEntry(match: string[], character: CharacterDefinition): ArtistCharacterEntry {
  return { match: match.map(normalizeArtistName), character };
}

// ---------------------------------------------------------------------------
// 48x64 Frank Ocean redraw
// ---------------------------------------------------------------------------

const FRANK_WIDTH = 48;
const FRANK_HEIGHT = 64;

type FrankPixel = keyof CharacterDefinition['palette'];

interface FrankPainter {
  rect(x: number, y: number, width: number, height: number, key: FrankPixel): void;
  line(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    key: FrankPixel,
    thickness?: number
  ): void;
}

function paintFrank(draw: (painter: FrankPainter) => void): SpriteFrame {
  const pixels = Array.from({ length: FRANK_HEIGHT }, () =>
    Array<string>(FRANK_WIDTH).fill('.')
  );
  const rect: FrankPainter['rect'] = (x, y, width, height, key) => {
    for (let row = Math.max(0, y); row < Math.min(FRANK_HEIGHT, y + height); row += 1) {
      for (let column = Math.max(0, x); column < Math.min(FRANK_WIDTH, x + width); column += 1) {
        pixels[row][column] = key;
      }
    }
  };
  const line: FrankPainter['line'] = (x1, y1, x2, y2, key, thickness = 1) => {
    let x = x1;
    let y = y1;
    const dx = Math.abs(x2 - x1);
    const dy = -Math.abs(y2 - y1);
    const stepX = x1 < x2 ? 1 : -1;
    const stepY = y1 < y2 ? 1 : -1;
    let error = dx + dy;
    const inset = Math.floor(thickness / 2);
    while (true) {
      rect(x - inset, y - inset, thickness, thickness, key);
      if (x === x2 && y === y2) break;
      const doubled = error * 2;
      if (doubled >= dy) {
        error += dy;
        x += stepX;
      }
      if (doubled <= dx) {
        error += dx;
        y += stepY;
      }
    }
  };
  draw({ rect, line });
  return frameOfSize(
    FRANK_WIDTH,
    FRANK_HEIGHT,
    pixels.map((row) => row.join(''))
  );
}

function frankLimb(
  painter: FrankPainter,
  points: readonly (readonly [number, number])[],
  fill: FrankPixel,
  width: number
): void {
  for (let index = 1; index < points.length; index += 1) {
    const [x1, y1] = points[index - 1];
    const [x2, y2] = points[index];
    painter.line(x1, y1, x2, y2, 'o', width + 2);
  }
  for (let index = 1; index < points.length; index += 1) {
    const [x1, y1] = points[index - 1];
    const [x2, y2] = points[index];
    painter.line(x1, y1, x2, y2, fill, width);
  }
}

function drawFrankHead(
  painter: FrankPainter,
  top: number,
  blink: boolean,
  headphones = false,
  gaze: -1 | 0 | 1 = 0
): void {
  const { rect, line } = painter;

  // Narrow jaw, exposed temples and a close two-tone green crop. Keeping the
  // green above the temple line is what makes this read as a buzzcut instead
  // of the helmet silhouette of the original 24x32 sprite.
  rect(14, top + 5, 20, 17, 'o');
  rect(16, top + 21, 16, 3, 'o');
  rect(12, top + 10, 4, 8, 'o');
  rect(32, top + 10, 4, 8, 'o');
  rect(15, top + 6, 18, 16, 's');
  rect(17, top + 21, 14, 2, 's');
  rect(13, top + 11, 3, 6, 'f');
  rect(32, top + 11, 3, 6, 'f');

  rect(18, top + 2, 12, 1, 'g');
  rect(16, top + 3, 16, 2, 'g');
  rect(14, top + 5, 20, 2, 'g');
  rect(13, top + 7, 22, 2, 'g');
  rect(14, top + 9, 20, 2, 'h');
  rect(14, top + 11, 4, 1, 'h');
  rect(30, top + 11, 4, 1, 'h');
  rect(31, top + 5, 3, 4, 'h');

  rect(18, top + 14, 4, 1, 'o');
  rect(27, top + 14, 4, 1, 'o');
  if (blink) {
    rect(19, top + 16, 3, 1, 'o');
    rect(27, top + 16, 3, 1, 'o');
  } else {
    rect(20 + gaze, top + 16, 2, 2, 'o');
    rect(27 + gaze, top + 16, 2, 2, 'o');
  }
  rect(24, top + 17, 2, 3, 'f');
  rect(23, top + 21, 5, 1, 'o');
  rect(33, top + 16, 2, 2, 'n');

  if (headphones) {
    line(13, top + 8, 16, top + 1, 'a', 2);
    line(16, top + 1, 31, top, 'a', 2);
    line(31, top, 35, top + 8, 'a', 2);
    rect(10, top + 12, 4, 8, 'a');
    rect(35, top + 12, 4, 8, 'a');
    rect(11, top + 14, 2, 4, 'o');
    rect(36, top + 14, 2, 4, 'o');
  }
}

interface FrankStandingPose {
  bob?: number;
  blink?: boolean;
  gaze?: -1 | 0 | 1;
  coverFace?: boolean;
  leftKneeX?: number;
  rightKneeX?: number;
  leftFootX?: number;
  rightFootX?: number;
  leftHand?: readonly [number, number];
  rightHand?: readonly [number, number];
}

function makeFrankStandingFrame({
  bob = 0,
  blink = false,
  gaze = 0,
  coverFace = false,
  leftKneeX = 20,
  rightKneeX = 28,
  leftFootX = 18,
  rightFootX = 30,
  leftHand = [10, 43],
  rightHand = [38, 43]
}: FrankStandingPose): SpriteFrame {
  return paintFrank((painter) => {
    const { rect, line } = painter;
    const hipY = 44 + bob;

    frankLimb(painter, [[27, hipY], [rightKneeX, 52], [rightFootX, 59]], 'p', 5);
    frankLimb(painter, [[21, hipY], [leftKneeX, 52], [leftFootX, 59]], 'p', 6);
    rect(rightFootX - 4, 58, 9, 5, 'b');
    rect(rightFootX - 3, 62, 9, 2, 't');
    rect(leftFootX - 4, 58, 9, 5, 'b');
    rect(leftFootX - 5, 62, 10, 2, 't');

    // Bare shoulders around a narrow ribbed tank make a silhouette distinct
    // from the defaults' jackets. A fine chain and pendant survive at 2x DPR.
    rect(15, 27 + bob, 18, 19, 'o');
    rect(16, 28 + bob, 16, 17, 's');
    rect(19, 28 + bob, 10, 17, 't');
    rect(21, 28 + bob, 2, 17, 'a');
    rect(27, 28 + bob, 2, 17, 'a');
    rect(18, 42 + bob, 12, 3, 'p');

    frankLimb(
      painter,
      [[16, 30 + bob], [13, 36 + bob], leftHand],
      's',
      4
    );
    frankLimb(
      painter,
      [[32, 30 + bob], [35, 36 + bob], rightHand],
      's',
      4
    );
    rect(leftHand[0] - 2, leftHand[1] - 1, 4, 4, 's');
    rect(rightHand[0] - 2, rightHand[1] - 1, 4, 4, 's');
    rect(rightHand[0] - 2, rightHand[1] - 2, 4, 1, 'n');

    rect(21, 23 + bob, 6, 6, 'o');
    rect(22, 23 + bob, 4, 6, 's');
    drawFrankHead(painter, 2 + bob, blink, false, gaze);
    line(21, 27 + bob, 24, 32 + bob, 'n');
    line(27, 27 + bob, 24, 32 + bob, 'n');
    rect(24, 32 + bob, 2, 2, 'n');

    if (coverFace) {
      frankLimb(painter, [[16, 31 + bob], [18, 23 + bob], [24, 18 + bob]], 's', 4);
      rect(21, 15 + bob, 8, 5, 's');
      rect(21, 14 + bob, 2, 5, 'f');
      rect(24, 14 + bob, 1, 5, 'f');
      rect(27, 15 + bob, 1, 4, 'f');
    }
  });
}

function makeFrankListenFrame(nod: number, blink: boolean, tap: number): SpriteFrame {
  return paintFrank((painter) => {
    const { rect, line } = painter;
    frankLimb(painter, [[23, 49], [34, 53], [38, 59]], 'p', 6);
    frankLimb(painter, [[20, 49], [14, 55], [18 + tap, 60 - tap]], 'p', 6);
    rect(34, 58, 10, 5, 'b');
    rect(34, 62, 11, 2, 't');
    rect(13 + tap, 59 - tap, 10, 5, 'b');
    rect(12 + tap, 62 - tap, 11, 2, 't');

    rect(15, 34, 18, 17, 'o');
    rect(16, 35, 16, 15, 's');
    rect(19, 35, 10, 15, 't');
    rect(21, 35, 2, 15, 'a');
    rect(27, 35, 2, 15, 'a');
    frankLimb(painter, [[16, 38], [13, 45], [19, 50]], 's', 4);
    frankLimb(painter, [[32, 38], [35, 45], [30, 50]], 's', 4);
    rect(17, 49, 4, 4, 's');
    rect(29, 49, 4, 4, 's');

    rect(21, 29 + nod, 6, 7, 'o');
    rect(22, 29 + nod, 4, 7, 's');
    drawFrankHead(painter, 9 + nod, blink, true);
    line(21, 34 + nod, 24, 39 + nod, 'n');
    line(27, 34 + nod, 24, 39 + nod, 'n');
  });
}

function makeFrankCrawlFrame(step: number): SpriteFrame {
  return paintFrank((painter) => {
    const { rect } = painter;
    frankLimb(painter, [[10, 51], [7 + step, 57], [5 + step, 61]], 'p', 6);
    frankLimb(painter, [[24, 51], [20 - step, 57], [19 - step, 62]], 'p', 6);
    rect(3 + step, 60, 10, 4, 'b');
    rect(15 - step, 61, 10, 3, 'b');
    rect(9, 44, 24, 11, 'o');
    rect(10, 45, 22, 9, 's');
    rect(14, 45, 12, 9, 't');
    frankLimb(painter, [[29, 49], [35, 56], [38 + step, 62]], 's', 4);
    rect(36 + step, 60, 6, 4, 's');

    rect(30, 39, 15, 14, 'o');
    rect(31, 40, 13, 12, 's');
    rect(31, 38, 13, 5, 'g');
    rect(31, 42, 13, 2, 'h');
    rect(41, 46, 2, 2, 'o');
  });
}

const hiFrankIdleA = makeFrankStandingFrame({});
const hiFrankIdleBlink = makeFrankStandingFrame({ blink: true });
const hiFrankIdleGlance = makeFrankStandingFrame({ gaze: -1 });
const hiFrankIdleBreath = makeFrankStandingFrame({ bob: 1, leftHand: [10, 44], rightHand: [38, 44] });
const hiFrankWalkA = makeFrankStandingFrame({
  leftKneeX: 17, rightKneeX: 31, leftFootX: 13, rightFootX: 35,
  leftHand: [13, 40], rightHand: [35, 45]
});
const hiFrankWalkB = makeFrankStandingFrame({
  bob: 1, leftKneeX: 18, rightKneeX: 30, leftFootX: 16, rightFootX: 33,
  leftHand: [11, 42], rightHand: [37, 44]
});
const hiFrankWalkC = makeFrankStandingFrame({
  bob: 1, leftKneeX: 20, rightKneeX: 28, leftFootX: 18, rightFootX: 30,
  leftHand: [9, 44], rightHand: [39, 41]
});
const hiFrankWalkD = makeFrankStandingFrame({
  bob: 1, leftKneeX: 23, rightKneeX: 25, leftFootX: 32, rightFootX: 16,
  leftHand: [12, 45], rightHand: [36, 40]
});
const hiFrankWalkE = makeFrankStandingFrame({
  leftKneeX: 25, rightKneeX: 23, leftFootX: 35, rightFootX: 13,
  leftHand: [14, 45], rightHand: [34, 40]
});
const hiFrankWalkF = makeFrankStandingFrame({
  bob: 1, leftKneeX: 22, rightKneeX: 26, leftFootX: 31, rightFootX: 17,
  leftHand: [12, 43], rightHand: [36, 42]
});
const hiFrankJump = makeFrankStandingFrame({
  leftKneeX: 17, rightKneeX: 31, leftFootX: 16, rightFootX: 32,
  leftHand: [10, 8], rightHand: [38, 8]
});
const hiFrankFall = makeFrankStandingFrame({
  leftKneeX: 18, rightKneeX: 30, leftFootX: 13, rightFootX: 35,
  leftHand: [3, 31], rightHand: [45, 31]
});
const hiFrankCrawlA = makeFrankCrawlFrame(0);
const hiFrankCrawlB = makeFrankCrawlFrame(3);
const hiFrankClimbA = makeFrankStandingFrame({
  leftKneeX: 16, rightKneeX: 30, leftFootX: 17, rightFootX: 32,
  leftHand: [14, 6], rightHand: [35, 13]
});
const hiFrankClimbB = makeFrankStandingFrame({
  leftKneeX: 20, rightKneeX: 33, leftFootX: 15, rightFootX: 30,
  leftHand: [13, 14], rightHand: [34, 6]
});
const hiFrankMantleA = makeFrankCrawlFrame(1);
const hiFrankMantleB = makeFrankStandingFrame({
  bob: 2, leftKneeX: 17, rightKneeX: 29, leftFootX: 17, rightFootX: 30,
  leftHand: [8, 28], rightHand: [39, 28]
});
const hiFrankCoverPose = makeFrankStandingFrame({ coverFace: true });
const hiFrankDangleA = makeFrankStandingFrame({
  leftKneeX: 17, rightKneeX: 29, leftFootX: 15, rightFootX: 31,
  leftHand: [4, 2], rightHand: [37, 43]
});
const hiFrankDangleB = makeFrankStandingFrame({
  leftKneeX: 22, rightKneeX: 33, leftFootX: 20, rightFootX: 35,
  leftHand: [4, 2], rightHand: [39, 41]
});
const hiFrankListenA = makeFrankListenFrame(0, false, 0);
const hiFrankListenBlink = makeFrankListenFrame(0, true, 0);
const hiFrankListenNod = makeFrankListenFrame(1, false, 1);

const hiFrankAnimations: CharacterDefinition['animations'] = {
  idle: animation(
    [
      hiFrankIdleA,
      hiFrankIdleBlink,
      hiFrankIdleA,
      hiFrankIdleA,
      hiFrankIdleGlance,
      hiFrankIdleGlance,
      hiFrankIdleA,
      hiFrankIdleBreath,
      hiFrankIdleBreath,
      hiFrankIdleA
    ],
    440
  ),
  walk: animation(
    [hiFrankWalkA, hiFrankWalkB, hiFrankWalkC, hiFrankWalkD, hiFrankWalkE, hiFrankWalkF],
    120
  ),
  jump: animation([hiFrankJump], 250, false),
  fall: animation([hiFrankFall], 250, false),
  crawl: animation([hiFrankCrawlA, hiFrankCrawlB], 220),
  climb: animation([hiFrankClimbA, hiFrankClimbB], 190),
  mantle: animation([hiFrankMantleA, hiFrankMantleB], 150, false),
  hide: animation([hiFrankCoverPose, hiFrankIdleBlink], 520),
  dangle: animation([hiFrankDangleA, hiFrankDangleB], 240),
  listen: animation(
    [hiFrankListenA, hiFrankListenBlink, hiFrankListenA, hiFrankListenNod, hiFrankListenA],
    500
  )
};

const frankOcean: CharacterDefinition = {
  id: 'artist-frank-ocean',
  artistKey: 'frank ocean',
  pixelWidth: FRANK_WIDTH,
  pixelHeight: FRANK_HEIGHT,
  scale: 0.5,
  dragGrip: { x: 4, y: 2 },
  palette: {
    o: '#2d3135',
    g: '#69a96a',
    h: '#3f754b',
    f: '#81523c',
    s: '#a96f50',
    t: '#e5dfd2',
    p: '#354454',
    b: '#242b31',
    n: '#d5ad62',
    a: '#b9b6ad'
  },
  body: {
    offsetX: 5,
    offsetY: 1,
    width: 14,
    height: 31
  },
  animations: hiFrankAnimations,
  frameSource: {
    file: 'src/lib/pixel-person/artists.ts',
    editable: false,
    names: {
      'idle:0': 'hiFrankIdleA',
      'idle:1': 'hiFrankIdleBlink',
      'idle:2': 'hiFrankIdleA',
      'idle:3': 'hiFrankIdleA',
      'idle:4': 'hiFrankIdleGlance',
      'idle:5': 'hiFrankIdleGlance',
      'idle:6': 'hiFrankIdleA',
      'idle:7': 'hiFrankIdleBreath',
      'idle:8': 'hiFrankIdleBreath',
      'idle:9': 'hiFrankIdleA',
      'walk:0': 'hiFrankWalkA',
      'walk:1': 'hiFrankWalkB',
      'walk:2': 'hiFrankWalkC',
      'walk:3': 'hiFrankWalkD',
      'walk:4': 'hiFrankWalkE',
      'walk:5': 'hiFrankWalkF',
      'jump:0': 'hiFrankJump',
      'fall:0': 'hiFrankFall',
      'crawl:0': 'hiFrankCrawlA',
      'crawl:1': 'hiFrankCrawlB',
      'climb:0': 'hiFrankClimbA',
      'climb:1': 'hiFrankClimbB',
      'mantle:0': 'hiFrankMantleA',
      'mantle:1': 'hiFrankMantleB',
      'hide:0': 'hiFrankCoverPose',
      'hide:1': 'hiFrankIdleBlink',
      'dangle:0': 'hiFrankDangleA',
      'dangle:1': 'hiFrankDangleB',
      'listen:0': 'hiFrankListenA',
      'listen:1': 'hiFrankListenBlink',
      'listen:2': 'hiFrankListenA',
      'listen:3': 'hiFrankListenNod',
      'listen:4': 'hiFrankListenA'
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
    ambientCharacterRegistry
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
