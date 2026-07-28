import type { CharacterDefinition, SpriteAnimation, SpriteFrame } from './types';

const WIDTH = 16;
const HEIGHT = 22;

export function frame(rows: string[]): SpriteFrame {
  if (rows.length !== HEIGHT || rows.some((row) => row.length !== WIDTH)) {
    throw new Error(`Pixel person frames must be ${WIDTH}x${HEIGHT}.`);
  }
  return { rows };
}

const idleA = frame([
  '................',
  '.....gggggg.....',
  '....gggggggg....',
  '....hhhhhhhh....',
  '....fssssssf....',
  '....fsossosf....',
  '....fssssssf....',
  '.....ssssss.....',
  '......ssss......',
  '....otttttto....',
  '...otttttttto...',
  '...otttttttto...',
  '...osttttttso...',
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

// Breathing beat: the head settles a row and the neck disappears into the
// shoulders, so the figure reads as one body inhaling rather than two poses.
const idleB = frame([
  '................',
  '................',
  '.....gggggg.....',
  '....gggggggg....',
  '....hhhhhhhh....',
  '....fssssssf....',
  '....fsossosf....',
  '....fssssssf....',
  '.....ssssss.....',
  '....otttttto....',
  '...otttttttto...',
  '...otttttttto...',
  '...osttttttso...',
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

const walkA = frame([
  '................',
  '.....gggggg.....',
  '....gggggggg....',
  '....hhhhhhhh....',
  '....fssssssf....',
  '....fsossosf....',
  '....fssssssf....',
  '.....ssssss.....',
  '......ssss......',
  '....otttttto....',
  '...otttttttto...',
  '...otttttttso...',
  '...osttttttto...',
  '....otttttto....',
  '....oppppppo....',
  '....opp..ppo....',
  '...opp....ppo...',
  '...opp....ppo...',
  '...opp....ppo...',
  '...ob......bo...',
  '..obb......bbo..',
  '................'
]);

const walkB = frame([
  '................',
  '.....gggggg.....',
  '....gggggggg....',
  '....hhhhhhhh....',
  '....fssssssf....',
  '....fsossosf....',
  '....fssssssf....',
  '.....ssssss.....',
  '......ssss......',
  '....otttttto....',
  '...otttttttto...',
  '...osttttttto...',
  '...otttttttso...',
  '....otttttto....',
  '....oppppppo....',
  '....opp..ppo....',
  '....opp..ppo....',
  '....opp..ppo....',
  '....opp..ppo....',
  '....ob....bo....',
  '...obb.....bo...',
  '................'
]);

const jump = frame([
  '................',
  '.....gggggg.....',
  '....gggggggg....',
  '....hhhhhhhh....',
  '.ss.fssssssf.ss.',
  '.ot.fsossosf.to.',
  '.ot.fssssssf.to.',
  '.ot..ssssss..to.',
  '..ot..ssss..to..',
  '...otttttttto...',
  '...otttttttto...',
  '...otttttttto...',
  '....otttttto....',
  '....oppppppo....',
  '....oppppppo....',
  '...opp....ppo...',
  '...opp....ppo...',
  '...opp....ppo...',
  '...ob......bo...',
  '..obb......bbo..',
  '................',
  '................'
]);

const fall = frame([
  '................',
  '.....gggggg.....',
  '....gggggggg....',
  '....hhhhhhhh....',
  '....fssssssf....',
  '....fsossosf....',
  '....fssssssf....',
  '.....ssssss.....',
  '......ssss......',
  '....otttttto....',
  '.stottttttttots.',
  '...otttttttto...',
  '....otttttto....',
  '....oppppppo....',
  '....opp..ppo....',
  '....opp..ppo....',
  '...opp....ppo...',
  '...opp....ppo...',
  '...opp....ppo...',
  '...ob......bo...',
  '..obb......bbo..',
  '................'
]);

// CRAWL_HEIGHT is 12 CSS px, which at scale 1.5 is exactly 8 sprite rows, so
// every lit pixel below has to live in rows 14-21. Anything higher clips
// through the gaps this animation exists to squeeze under.
const crawlA = frame([
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '..........gggg..',
  '.........hhhhhh.',
  '......otthhssos.',
  '..otttttttssss..',
  '.opppttttttto...',
  'oppppo.....to...',
  'oppo.......so...',
  'bbbo......obbo..'
]);

const crawlB = frame([
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '..........gggg..',
  '.........hhhhhh.',
  '......otthhssos.',
  '..otttttttssss..',
  '..oppttttttto...',
  '.oppppo.....to..',
  '.oppo.......so..',
  'obbbo......obbo.'
]);

const climbA = frame([
  '............ss..',
  '............tto.',
  '....gggggg..tto.',
  '...gggggggg.tto.',
  '...hhhhhhhh.tto.',
  '...fssssssf.tto.',
  '...fsossosf.tto.',
  '...fssssssf.tto.',
  '....ssssss..tto.',
  '.....ssss...tto.',
  '...ottttttttto..',
  '...otttttttto...',
  '...osttttttto...',
  '....otttttto....',
  '....oppppppo....',
  '...opp...ppo....',
  '..opp....ppo....',
  '..obbo...ppo....',
  '.........ppo....',
  '........obbo....',
  '.......obbbo....',
  '................'
]);

const climbB = frame([
  '..ss............',
  '.ott............',
  '.ott..gggggg....',
  '.ott.gggggggg...',
  '.ott.hhhhhhhh...',
  '.ott.fssssssf...',
  '.ott.fsossosf...',
  '.ott.fssssssf...',
  '.ott..ssssss....',
  '.ott...ssss.....',
  '..ottttttttto...',
  '...otttttttto...',
  '...otttttttso...',
  '....otttttto....',
  '....oppppppo....',
  '....opp...ppo...',
  '....opp....ppo..',
  '....opp...obbo..',
  '....opp.........',
  '....obbo........',
  '....obbbo.......',
  '................'
]);

const mantleA = frame([
  '................',
  '.....gggggg.....',
  '....gggggggg....',
  '....hhhhhhhh....',
  '....fssssssf....',
  '....fsossosf....',
  '....fssssssf....',
  '.....ssssss.....',
  '......ssss......',
  '....otttttto....',
  '...otttttttto...',
  '...otttttttto...',
  '...otttttttto...',
  '..otottttttoto..',
  '..otoppppppoto..',
  '..osopp..pposo..',
  '....opp..ppo....',
  '....opp..ppo....',
  '....ob....bo....',
  '...obb....bbo...',
  '................',
  '................'
]);

const mantleB = frame([
  '....gggggggg....',
  '....hhhhhhhh....',
  '....fssssssf....',
  '....fsossosf....',
  '....fssssssf....',
  '.....ssssss.....',
  '......ssss......',
  '....otttttto....',
  '...otttttttto...',
  '...otttttttto...',
  '...osttttttso...',
  '....otttttto....',
  '....oppppppo....',
  '....opp..ppo....',
  '....opp..ppo....',
  '....opp..ppo....',
  '....opp..ppo....',
  '....ob....bo....',
  '...obb....bbo...',
  '................',
  '................',
  '................'
]);

const hideA = frame([
  '................',
  '................',
  '................',
  '................',
  '.....gggggg.....',
  '....gggggggg....',
  '....hhhhhhhh....',
  '....fssssssf....',
  '....fsossosf....',
  '....fssssssf....',
  '.....ssssss.....',
  '......ssss......',
  '....otttttto....',
  '...otttttttto...',
  '...otttttttto...',
  '...osttttttso...',
  '....otttttto....',
  '....oppppppo....',
  '....opp..ppo....',
  '....opp..ppo....',
  '...obb....bbo...',
  '................'
]);

const dangleA = frame([
  '.....ss..ss.....',
  '....ott..tto....',
  '....ott..tto....',
  '....ott..tto....',
  '.....gggggg.....',
  '....gggggggg....',
  '....hhhhhhhh....',
  '....fssssssf....',
  '....fsossosf....',
  '....fssssssf....',
  '.....ssssss.....',
  '......ssss......',
  '....otttttto....',
  '...otttttttto...',
  '...otttttttto...',
  '....otttttto....',
  '....oppppppo....',
  '....opp..ppo....',
  '....opp..ppo....',
  '...opp....ppo...',
  '...ob......bo...',
  '..obb......bbo..'
]);

const dangleB = frame([
  '.....ss..ss.....',
  '....ott..tto....',
  '....ott..tto....',
  '....ott..tto....',
  '.....gggggg.....',
  '....gggggggg....',
  '....hhhhhhhh....',
  '....fssssssf....',
  '....fsossosf....',
  '....fssssssf....',
  '.....ssssss.....',
  '......ssss......',
  '....otttttto....',
  '...otttttttto...',
  '...otttttttto...',
  '....otttttto....',
  '....oppppppo....',
  '....opp..ppo....',
  '...opp....ppo...',
  '..opp......ppo..',
  '..ob........bo..',
  '.obb........bbo.'
]);

// Sitting with headphones on — the band and ear cups are outline pixels laid
// over the hair. Nothing above row 5 so the pose reads as seated; frame B
// nods the head a row without moving the shoulders.
// Seated with headphones on. The band arcs over the full width of the crown and
// the cups are two pixels wide at ear height — the previous version put a
// one-pixel stripe on top of the hair and one-pixel nubs up at the temples,
// which read as a hairband rather than headphones.
const listenA = frame([
  '................',
  '................',
  '................',
  '................',
  '....nnnnnnnn....',
  '...nggggggggn...',
  '..nnhhhhhhhhnn..',
  '..nnfssssssfnn..',
  '..nnfsossosfnn..',
  '...nfssssssfn...',
  '.....ssssss.....',
  '......ssss......',
  '....otttttto....',
  '...otttttttto...',
  '...osttttttso...',
  '....oppppppo....',
  '...oppppppppo...',
  '...obbppppbbo...',
  '................',
  '................',
  '................',
  '................'
]);

// Nod: the head sinks a row and the neck disappears into the shoulders.
const listenB = frame([
  '................',
  '................',
  '................',
  '................',
  '................',
  '....nnnnnnnn....',
  '...nggggggggn...',
  '..nnhhhhhhhhnn..',
  '..nnfssssssfnn..',
  '..nnfsossosfnn..',
  '...nfssssssfn...',
  '.....ssssss.....',
  '....otttttto....',
  '...otttttttto...',
  '...osttttttso...',
  '....oppppppo....',
  '...oppppppppo...',
  '...obbppppbbo...',
  '................',
  '................',
  '................',
  '................'
]);

export function animation(
  frames: SpriteFrame[],
  frameDurationMs: number,
  loop = true
): SpriteAnimation {
  return { frames, frameDurationMs, loop };
}

// Generics carry the base ten poses and no signature; the signature is the one
// thing an artist character adds on top of the shared rig.
const animations: CharacterDefinition['animations'] = {
  idle: animation([idleA, idleB], 620),
  walk: animation([walkA, walkB], 145),
  jump: animation([jump], 250, false),
  fall: animation([fall], 250, false),
  crawl: animation([crawlA, crawlB], 220),
  climb: animation([climbA, climbB], 190),
  mantle: animation([mantleA, mantleB], 150, false),
  hide: animation([hideA, idleB], 520),
  dangle: animation([dangleA, dangleB], 240),
  listen: animation([listenA, listenB], 480)
};

export const tinyPerson: CharacterDefinition = {
  id: 'tiny-person',
  pixelWidth: WIDTH,
  pixelHeight: HEIGHT,
  // 16x22 at 1.5 renders 24x33 CSS px — the pre-existing footprint, at a
  // grid with room for a face. Fractional scale is safe because sprites
  // rasterize in device space; see render.ts deviceStep().
  scale: 1.5,
  dragGrip: { x: 8, y: 1 },
  palette: {
    o: '$outline',
    // Two hair tones: `g` is the crown, `h` the mass below it. Frank's green
    // fade rides on this, so it lives in the shared rig rather than in his
    // own frames — every character gets a subtle highlight for free.
    g: '#5a3a28',
    h: '#744c34',
    // The temple column flanking the face. Its own key so a close-cropped
    // character can set it to skin: with hair here the head reads as a shell
    // wrapping the face, which on a buzzcut looks like a helmet.
    f: '#744c34',
    s: '#efaa78',
    t: '#4ba7c8',
    p: '#625b9a',
    // Boots are NOT '$outline'. Sharing the outline colour turned each foot
    // into a solid three-pixel block of it — the chunkiest thing on the sprite.
    b: '#3f3a4d',
    // Headphones. Their own key, and deliberately not '$outline': the cups have
    // to be big enough to read as an object, and at that size the theme's text
    // colour made them a slab of stark white. A mid grey reads on both themes.
    n: '#9aa0aa'
  },
  body: {
    offsetX: 5,
    offsetY: 2,
    width: 14,
    height: 31
  },
  animations
};

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

const sunnyPerson = withPalette(tinyPerson, 'tiny-person-sunny', {
  f: '#e8c170',
  b: '#4a3a2e',
  g: '#c9a154',
  h: '#e8c170',
  t: '#c14b4b',
  p: '#54586e'
});

const mossPerson = withPalette(tinyPerson, 'tiny-person-moss', {
  f: '#2f2b26',
  b: '#232a20',
  g: '#1f1c19',
  h: '#2f2b26',
  s: '#c98d5e',
  t: '#6a9a58',
  p: '#5d5266'
});

const plumPerson = withPalette(tinyPerson, 'tiny-person-plum', {
  f: '#a8623d',
  b: '#3a2f3d',
  g: '#8a4e30',
  h: '#a8623d',
  t: '#9e5f8a',
  p: '#39546b'
});

export const characterRegistry: Record<string, CharacterDefinition> = {
  [tinyPerson.id]: tinyPerson,
  [sunnyPerson.id]: sunnyPerson,
  [mossPerson.id]: mossPerson,
  [plumPerson.id]: plumPerson
};

export function getCharacter(id = tinyPerson.id): CharacterDefinition {
  return characterRegistry[id] ?? tinyPerson;
}
