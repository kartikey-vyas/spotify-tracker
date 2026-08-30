import type { CharacterDefinition, SpriteAnimation, SpriteFrame } from './types';

/** Builds a frame at its explicitly authored resolution. */
export function frameOfSize(width: number, height: number, rows: string[]): SpriteFrame {
  if (rows.length !== height || rows.some((row) => row.length !== width)) {
    throw new Error(`Pixel person frames must be ${width}x${height}.`);
  }
  return { rows };
}

export function animation(
  frames: SpriteFrame[],
  frameDurationMs: number,
  loop = true
): SpriteAnimation {
  return { frames, frameDurationMs, loop };
}

// ---------------------------------------------------------------------------
// 48x64 promenade defaults
// ---------------------------------------------------------------------------

const PROMENADE_WIDTH = 48;
const PROMENADE_HEIGHT = 64;

type PilotPixel = keyof CharacterDefinition['palette'];

interface PilotPainter {
  rect(x: number, y: number, width: number, height: number, key: PilotPixel): void;
  line(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    key: PilotPixel,
    thickness?: number
  ): void;
}

/**
 * A tiny authoring canvas for the high-density pilot. The art is assembled
 * from one-pixel coordinates and deliberately uses odd widths, offsets and
 * facial details; it is not a nearest-neighbour enlargement of the old rig.
 */
function paintPilot(draw: (painter: PilotPainter) => void): SpriteFrame {
  const pixels = Array.from({ length: PROMENADE_HEIGHT }, () =>
    Array<string>(PROMENADE_WIDTH).fill('.')
  );
  const rect: PilotPainter['rect'] = (x, y, width, height, key) => {
    for (let row = Math.max(0, y); row < Math.min(PROMENADE_HEIGHT, y + height); row += 1) {
      for (
        let column = Math.max(0, x);
        column < Math.min(PROMENADE_WIDTH, x + width);
        column += 1
      ) {
        pixels[row][column] = key;
      }
    }
  };
  const line: PilotPainter['line'] = (x1, y1, x2, y2, key, thickness = 1) => {
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
      const doubled = 2 * error;
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
    PROMENADE_WIDTH,
    PROMENADE_HEIGHT,
    pixels.map((row) => row.join(''))
  );
}

function pilotLimb(
  painter: PilotPainter,
  points: readonly (readonly [number, number])[],
  fill: PilotPixel,
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

function drawPilotHead(
  painter: PilotPainter,
  top: number,
  blink: boolean,
  headphones = false,
  gaze: -1 | 0 | 1 = 0
): void {
  const { rect, line } = painter;

  // A slightly tapered jaw keeps the face readable without the old square
  // mask silhouette. Ears sit behind the head and pick up the skin shadow.
  rect(13, top + 5, 22, 17, 'o');
  rect(15, top + 21, 18, 3, 'o');
  rect(11, top + 10, 4, 8, 'o');
  rect(33, top + 10, 4, 8, 'o');
  rect(14, top + 6, 20, 16, 's');
  rect(16, top + 21, 16, 2, 's');
  rect(12, top + 11, 3, 6, 'f');
  rect(33, top + 11, 3, 6, 'f');

  // A side part, tapered temples and loose fringe use one-pixel/odd-width
  // decisions that would be impossible in a doubled 24x32 source.
  rect(16, top + 1, 15, 2, 'g');
  rect(13, top + 3, 21, 3, 'g');
  rect(11, top + 6, 25, 4, 'g');
  rect(11, top + 9, 5, 10, 'h');
  rect(33, top + 8, 3, 10, 'h');
  rect(15, top + 6, 18, 3, 'h');
  rect(15, top + 9, 7, 3, 'h');
  rect(29, top + 9, 4, 2, 'h');
  rect(34, top + 4, 1, 1, 'n');

  // Brows, eyes, nose shadow and a restrained half-smile.
  rect(17, top + 13, 4, 1, 'h');
  rect(27, top + 13, 4, 1, 'h');
  if (blink) {
    rect(18, top + 15, 3, 1, 'g');
    rect(28, top + 15, 3, 1, 'g');
  } else {
    rect(19 + gaze, top + 15, 2, 2, 'g');
    rect(28 + gaze, top + 15, 2, 2, 'g');
  }
  rect(24, top + 16, 2, 3, 'f');
  rect(23, top + 20, 5, 1, 'h');
  rect(26, top + 19, 2, 1, 'f');

  if (headphones) {
    line(12, top + 7, 15, top + 1, 'n', 2);
    line(15, top + 1, 31, top, 'n', 2);
    line(31, top, 36, top + 8, 'n', 2);
    rect(9, top + 11, 4, 9, 'n');
    rect(36, top + 11, 4, 9, 'n');
    rect(10, top + 13, 2, 5, 'o');
    rect(37, top + 13, 2, 5, 'o');
  }
}

interface PilotStandingPose {
  bob?: number;
  blink?: boolean;
  gaze?: -1 | 0 | 1;
  leftKneeX?: number;
  rightKneeX?: number;
  leftFootX?: number;
  rightFootX?: number;
  leftHand?: readonly [number, number];
  rightHand?: readonly [number, number];
}

function makePilotStandingFrame({
  bob = 0,
  blink = false,
  gaze = 0,
  leftKneeX = 20,
  rightKneeX = 28,
  leftFootX = 18,
  rightFootX = 30,
  leftHand = [9, 42],
  rightHand = [39, 42]
}: PilotStandingPose): SpriteFrame {
  return paintPilot((painter) => {
    const { rect } = painter;
    const hipY = 43 + bob;

    // Back leg and arm land first, then the jacket hides their joins.
    pilotLimb(painter, [[27, hipY], [rightKneeX, 52], [rightFootX, 59]], 'p', 5);
    pilotLimb(
      painter,
      [[34, 29 + bob], [36 + Math.sign(rightHand[0] - 34), 35 + bob], rightHand],
      't',
      4
    );
    rect(rightHand[0] - 2, rightHand[1] - 1, 4, 4, 's');

    pilotLimb(painter, [[21, hipY], [leftKneeX, 52], [leftFootX, 59]], 'p', 6);
    rect(rightFootX - 4, 58, 9, 5, 'b');
    rect(rightFootX - 3, 62, 9, 2, 'n');
    rect(leftFootX - 4, 58, 9, 5, 'b');
    rect(leftFootX - 5, 62, 10, 2, 'n');

    // Cropped jacket, warm undershirt and small lapels. The off-centre zip
    // gives the torso a front instead of reading as a coloured rectangle.
    rect(13, 26 + bob, 22, 19, 'o');
    rect(14, 27 + bob, 20, 17, 't');
    rect(20, 27 + bob, 8, 16, 'n');
    rect(14, 35 + bob, 3, 8, 'a');
    rect(31, 35 + bob, 3, 8, 'a');
    rect(19, 28 + bob, 3, 6, 'a');
    rect(28, 28 + bob, 3, 6, 'a');
    rect(24, 31 + bob, 2, 13, 'o');
    rect(15, 41 + bob, 18, 3, 'a');
    rect(19, 44 + bob, 10, 3, 'p');

    pilotLimb(
      painter,
      [[14, 29 + bob], [12 - Math.sign(14 - leftHand[0]), 35 + bob], leftHand],
      't',
      4
    );
    rect(leftHand[0] - 2, leftHand[1] - 1, 4, 4, 's');

    rect(21, 22 + bob, 6, 7, 'o');
    rect(22, 22 + bob, 4, 7, 's');
    drawPilotHead(painter, 2 + bob, blink, false, gaze);
  });
}

function makePilotListenFrame(nod: number, blink: boolean, tap: number): SpriteFrame {
  return paintPilot((painter) => {
    const { rect } = painter;

    // Seated legs: one recedes, the nearer sneaker taps by a single raw pixel.
    pilotLimb(painter, [[23, 48], [34, 52], [38, 59]], 'p', 6);
    pilotLimb(painter, [[20, 48], [14, 54], [18 + tap, 60 - tap]], 'p', 6);
    rect(34, 58, 10, 5, 'b');
    rect(34, 62, 11, 2, 'n');
    rect(13 + tap, 59 - tap, 10, 5, 'b');
    rect(12 + tap, 62 - tap, 11, 2, 'n');

    // Hands rest around a record-sized negative space rather than waving.
    pilotLimb(painter, [[14, 37], [12, 44], [18, 49]], 't', 4);
    pilotLimb(painter, [[34, 37], [36, 44], [30, 49]], 't', 4);
    rect(16, 48, 4, 4, 's');
    rect(29, 48, 4, 4, 's');

    rect(13, 33, 22, 17, 'o');
    rect(14, 34, 20, 15, 't');
    rect(20, 34, 8, 14, 'n');
    rect(14, 41, 3, 7, 'a');
    rect(31, 41, 3, 7, 'a');
    rect(19, 34, 3, 5, 'a');
    rect(28, 34, 3, 5, 'a');
    rect(24, 39, 2, 10, 'o');
    rect(21, 28 + nod, 6, 7, 'o');
    rect(22, 28 + nod, 4, 7, 's');
    drawPilotHead(painter, 8 + nod, blink, true);
  });
}

function makePilotCrawlFrame(step: number): SpriteFrame {
  return paintPilot((painter) => {
    const { rect } = painter;
    // Kept in the lower half so the simulation's shortened crawl body clips
    // under low rails without an upright head leaking through the surface.
    pilotLimb(painter, [[10, 50], [7 + step, 56], [5 + step, 61]], 'p', 6);
    pilotLimb(painter, [[24, 50], [20 - step, 57], [19 - step, 62]], 'p', 6);
    rect(3 + step, 60, 11, 4, 'b');
    rect(15 - step, 61, 11, 3, 'b');
    rect(8, 43, 25, 11, 'o');
    rect(9, 44, 24, 9, 't');
    rect(10, 49, 19, 3, 'n');
    pilotLimb(painter, [[29, 48], [35, 55], [37 + step, 62]], 't', 5);
    rect(35 + step, 60, 7, 4, 's');

    rect(30, 38, 15, 14, 'o');
    rect(31, 39, 13, 12, 's');
    rect(30, 37, 13, 5, 'g');
    rect(29, 40, 5, 10, 'h');
    rect(40, 43, 2, 2, 'o');
    rect(41, 48, 3, 1, 'o');
  });
}

const pilotIdleA = makePilotStandingFrame({});
const pilotIdleBlink = makePilotStandingFrame({ blink: true });
const pilotIdleGlance = makePilotStandingFrame({ gaze: 1 });
const pilotIdleBreath = makePilotStandingFrame({ bob: 1, leftHand: [9, 43], rightHand: [39, 43] });

const pilotWalkA = makePilotStandingFrame({
  leftKneeX: 17, rightKneeX: 31, leftFootX: 13, rightFootX: 35,
  leftHand: [13, 40], rightHand: [35, 45]
});
const pilotWalkB = makePilotStandingFrame({
  bob: 1, leftKneeX: 18, rightKneeX: 30, leftFootX: 16, rightFootX: 33,
  leftHand: [11, 42], rightHand: [37, 44]
});
const pilotWalkC = makePilotStandingFrame({
  bob: 2, leftKneeX: 20, rightKneeX: 28, leftFootX: 18, rightFootX: 30,
  leftHand: [9, 44], rightHand: [39, 41]
});
const pilotWalkD = makePilotStandingFrame({
  bob: 1, leftKneeX: 23, rightKneeX: 25, leftFootX: 32, rightFootX: 16,
  leftHand: [12, 45], rightHand: [36, 40]
});
const pilotWalkE = makePilotStandingFrame({
  leftKneeX: 25, rightKneeX: 23, leftFootX: 35, rightFootX: 13,
  leftHand: [14, 45], rightHand: [34, 40]
});
const pilotWalkF = makePilotStandingFrame({
  bob: 1, leftKneeX: 22, rightKneeX: 26, leftFootX: 31, rightFootX: 17,
  leftHand: [12, 43], rightHand: [36, 42]
});

const pilotJump = makePilotStandingFrame({
  leftKneeX: 17, rightKneeX: 31, leftFootX: 16, rightFootX: 32,
  leftHand: [10, 8], rightHand: [38, 8]
});
const pilotFall = makePilotStandingFrame({
  leftKneeX: 18, rightKneeX: 30, leftFootX: 13, rightFootX: 35,
  leftHand: [3, 31], rightHand: [45, 31]
});
const pilotCrawlA = makePilotCrawlFrame(0);
const pilotCrawlB = makePilotCrawlFrame(3);
const pilotClimbA = makePilotStandingFrame({
  leftKneeX: 16, rightKneeX: 30, leftFootX: 17, rightFootX: 32,
  leftHand: [14, 6], rightHand: [35, 13]
});
const pilotClimbB = makePilotStandingFrame({
  leftKneeX: 20, rightKneeX: 33, leftFootX: 15, rightFootX: 30,
  leftHand: [13, 14], rightHand: [34, 6]
});
const pilotMantleA = makePilotCrawlFrame(1);
const pilotMantleB = makePilotStandingFrame({
  bob: 2, leftKneeX: 17, rightKneeX: 29, leftFootX: 17, rightFootX: 30,
  leftHand: [8, 28], rightHand: [39, 28]
});
const pilotHide = makePilotStandingFrame({ leftHand: [19, 17], rightHand: [30, 17] });
const pilotDangleA = makePilotStandingFrame({
  leftKneeX: 17, rightKneeX: 29, leftFootX: 15, rightFootX: 31,
  leftHand: [4, 2], rightHand: [37, 43]
});
const pilotDangleB = makePilotStandingFrame({
  leftKneeX: 22, rightKneeX: 33, leftFootX: 20, rightFootX: 35,
  leftHand: [4, 2], rightHand: [39, 41]
});
const pilotListenA = makePilotListenFrame(0, false, 0);
const pilotListenBlink = makePilotListenFrame(0, true, 0);
const pilotListenNod = makePilotListenFrame(1, false, 1);

const promenadeAnimations: CharacterDefinition['animations'] = {
  // Long stretches of stillness make the occasional glance, blink and breath
  // feel observed rather than mechanically looped.
  idle: animation(
    [
      pilotIdleA,
      pilotIdleBlink,
      pilotIdleA,
      pilotIdleA,
      pilotIdleGlance,
      pilotIdleGlance,
      pilotIdleA,
      pilotIdleBreath,
      pilotIdleBreath,
      pilotIdleA
    ],
    440
  ),
  walk: animation([pilotWalkA, pilotWalkB, pilotWalkC, pilotWalkD, pilotWalkE, pilotWalkF], 120),
  jump: animation([pilotJump], 250, false),
  fall: animation([pilotFall], 250, false),
  crawl: animation([pilotCrawlA, pilotCrawlB], 220),
  climb: animation([pilotClimbA, pilotClimbB], 190),
  mantle: animation([pilotMantleA, pilotMantleB], 150, false),
  hide: animation([pilotHide, pilotIdleBlink], 520),
  dangle: animation([pilotDangleA, pilotDangleB], 240),
  listen: animation(
    [pilotListenA, pilotListenBlink, pilotListenA, pilotListenA, pilotListenNod, pilotListenA],
    520
  )
};

/**
 * First high-density generic for the calmer promenade direction.
 *
 * The 48x64 source is displayed at 0.5 scale, preserving the proven 24x32 CSS
 * footprint and 14x31 physics body. On a 2x display every authored source
 * pixel maps to one device pixel; lower-density displays degrade to the same
 * physical resolution of the original low-density sprites.
 */
export const promenadePerson: CharacterDefinition = {
  id: 'promenade-person',
  pixelWidth: PROMENADE_WIDTH,
  pixelHeight: PROMENADE_HEIGHT,
  scale: 0.5,
  // Raw sprite coordinates; at 0.5 scale this is the same 2x1 CSS grip as the
  // established rig, so the existing pendulum math does not jump on a swap.
  dragGrip: { x: 4, y: 2 },
  palette: {
    o: '#30343a',
    g: '#3b2a25',
    h: '#62483c',
    f: '#d48c63',
    s: '#edb184',
    t: '#537f8d',
    a: '#385d68',
    p: '#465165',
    b: '#292d35',
    n: '#d2b47a'
  },
  // CharacterDefinition body values are CSS-space, not raw sprite pixels.
  // These preserve the established 24x32 CSS-space collision footprint.
  body: {
    offsetX: 5,
    offsetY: 1,
    width: 14,
    height: 31
  },
  animations: promenadeAnimations,
  frameSource: {
    file: 'src/lib/pixel-person/characters.ts',
    names: {
      'idle:0': 'pilotIdleA',
      'idle:1': 'pilotIdleBlink',
      'idle:2': 'pilotIdleA',
      'idle:3': 'pilotIdleA',
      'idle:4': 'pilotIdleGlance',
      'idle:5': 'pilotIdleGlance',
      'idle:6': 'pilotIdleA',
      'idle:7': 'pilotIdleBreath',
      'idle:8': 'pilotIdleBreath',
      'idle:9': 'pilotIdleA',
      'walk:0': 'pilotWalkA',
      'walk:1': 'pilotWalkB',
      'walk:2': 'pilotWalkC',
      'walk:3': 'pilotWalkD',
      'walk:4': 'pilotWalkE',
      'walk:5': 'pilotWalkF',
      'jump:0': 'pilotJump',
      'fall:0': 'pilotFall',
      'crawl:0': 'pilotCrawlA',
      'crawl:1': 'pilotCrawlB',
      'climb:0': 'pilotClimbA',
      'climb:1': 'pilotClimbB',
      'mantle:0': 'pilotMantleA',
      'mantle:1': 'pilotMantleB',
      'hide:0': 'pilotHide',
      'hide:1': 'pilotIdleBlink',
      'dangle:0': 'pilotDangleA',
      'dangle:1': 'pilotDangleB',
      'listen:0': 'pilotListenA',
      'listen:1': 'pilotListenBlink',
      'listen:2': 'pilotListenA',
      'listen:3': 'pilotListenA',
      'listen:4': 'pilotListenNod',
      'listen:5': 'pilotListenA'
    }
  }
};

/** Compatibility name for callers that predate the promenade redraw. */
export const tinyPerson = promenadePerson;

/**
 * Derives a new character from an existing one by recoloring — frames are
 * shared by reference (the sprite cache keys by character id, so variants
 * rasterize independently). The cheap way to grow the roster.
 */
export function withPalette(
  base: CharacterDefinition,
  id: string,
  paletteOverrides: CharacterDefinition['palette']
): CharacterDefinition {
  return { ...base, id, palette: { ...base.palette, ...paletteOverrides } };
}

// Keep the ambient roster consistently high-density. Moss is a palette variant
// of the promenade rig, so either generic spawn uses the authored 48x64 source.
const mossPerson = withPalette(promenadePerson, 'promenade-person-moss', {
  g: '#1f1c19',
  h: '#3d3028',
  f: '#8f5b3b',
  s: '#c98a60',
  t: '#687b61',
  a: '#475a45',
  p: '#4b515a',
  b: '#292a2c',
  n: '#d0a85e'
});

export const characterRegistry: Record<string, CharacterDefinition> = {
  [promenadePerson.id]: promenadePerson,
  [mossPerson.id]: mossPerson
};

/** High-density characters eligible for ordinary ambient promenade spawns. */
export const ambientCharacterRegistry: Record<string, CharacterDefinition> = {
  [promenadePerson.id]: promenadePerson,
  [mossPerson.id]: mossPerson
};

export function getCharacter(id = promenadePerson.id): CharacterDefinition {
  return characterRegistry[id] ?? promenadePerson;
}
