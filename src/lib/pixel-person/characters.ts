import type {
  AnimationName,
  CharacterDefinition,
  SpriteAnimation,
  SpriteFrame
} from './types';

const WIDTH = 12;
const HEIGHT = 16;

function frame(rows: string[]): SpriteFrame {
  if (rows.length !== HEIGHT || rows.some((row) => row.length < WIDTH)) {
    throw new Error(`Pixel person frames must be ${WIDTH}x${HEIGHT}.`);
  }
  // Authoring a symmetric 12-pixel figure is easier with an occasional trailing
  // transparent guide pixel. Trim that guide while keeping runtime frames strict.
  return { rows: rows.map((row) => row.slice(0, WIDTH)) };
}

const idleA = frame([
  '............',
  '....hhhh....',
  '...hooooh...',
  '...hssss....',
  '...osssso...',
  '....osso....',
  '...otttto...',
  '..otttttto..',
  '..osttttso..',
  '...otttto...',
  '...oppppo...',
  '...opp.ppo...',
  '...opp.ppo...',
  '...ob...bo...',
  '..obb...bbo..',
  '............'
]);

const idleB = frame([
  '............',
  '....hhhh....',
  '...hooooh...',
  '...hssss....',
  '...osssso...',
  '....osso....',
  '...otttto...',
  '..otttttto..',
  '..osttttso..',
  '...otttto...',
  '...oppppo...',
  '...opp.ppo...',
  '...opp.ppo...',
  '..oob...bo...',
  '..obb...bbo..',
  '............'
]);

const walkA = frame([
  '............',
  '....hhhh....',
  '...hooooh...',
  '...hssss....',
  '...osssso...',
  '....osso....',
  '...otttto...',
  '..otttttto..',
  '..ostttso...',
  '...otttto...',
  '...oppppo...',
  '...opp.ppo...',
  '..opp...po...',
  '..ob....b...',
  '.obb....bbo.',
  '............'
]);

const walkB = frame([
  '............',
  '....hhhh....',
  '...hooooh...',
  '...hssss....',
  '...osssso...',
  '....osso....',
  '...otttto...',
  '..otttttto..',
  '...ostttso..',
  '...otttto...',
  '...oppppo...',
  '...opp.ppo...',
  '....ppoppo..',
  '....bo.ob...',
  '...bbo.obbo.',
  '............'
]);

const jump = frame([
  '............',
  '....hhhh....',
  '...hooooh...',
  '...hssss....',
  '...osssso...',
  '....osso....',
  '..osttttso..',
  '.osttttttso.',
  '...otttto...',
  '...otttto...',
  '...oppppo...',
  '..opp..ppo...',
  '.opp....ppo..',
  '.ob......bo..',
  '..b......b...',
  '............'
]);

const fall = frame([
  '............',
  '....hhhh....',
  '...hooooh...',
  '...hssss....',
  '...osssso...',
  '..s.osso.s...',
  '..osttttso..',
  '...tttttt...',
  '...otttto...',
  '...otttto...',
  '...oppppo...',
  '...opp.ppo...',
  '..opp...ppo..',
  '..ob....bo...',
  '...b....b....',
  '............'
]);

const crawlA = frame([
  '............',
  '............',
  '............',
  '............',
  '............',
  '............',
  '............',
  '............',
  '............',
  '............',
  '.....hhhh...',
  '....hooooh..',
  '..s.hssss...',
  '.ssoosssso..',
  '..ottttttto.',
  '.obppppbbbo.'
]);

const crawlB = frame([
  '............',
  '............',
  '............',
  '............',
  '............',
  '............',
  '............',
  '............',
  '............',
  '............',
  '....hhhh....',
  '...hooooh...',
  '...hssss.ss.',
  '..oossssoos.',
  '.otttttttto.',
  '..obbpppbbo.'
]);

const climbA = frame([
  '......ss....',
  '....hhho....',
  '...hooooh...',
  '...hsssso...',
  '...osssso...',
  '....osso....',
  '...ottttso..',
  '..osttttto...',
  '..sotttto....',
  '...otttto...',
  '...oppppo...',
  '...opp.ppo...',
  '...op...ppo..',
  '...ob....bo..',
  '..obbo...b...',
  '............'
]);

const climbB = frame([
  '............',
  '....hhho....',
  '...hooooh...',
  '...hsssso...',
  '..sosssso...',
  '..s.osso.ss..',
  '..o.tttt.so..',
  '...ottttto...',
  '...otttto....',
  '...otttto...',
  '...oppppo...',
  '..opp..ppo...',
  '..ob....po...',
  '...b....bo...',
  '........bbo.',
  '............'
]);

const mantleA = frame([
  '............',
  '....hhhh....',
  '...hooooh...',
  '..shsssshs...',
  '..sosssso...',
  '..o.osso.o...',
  '...otttto...',
  '..otttttto..',
  '...otttto...',
  '...otttto...',
  '..ooppppo...',
  '..opp..ppo...',
  '..ob....bo...',
  '...b....b....',
  '............',
  '............'
]);

const mantleB = frame([
  '............',
  '............',
  '....hhhh....',
  '...hooooh...',
  '...hssss....',
  '...osssso...',
  '..osttttso..',
  '..otttttto..',
  '...otttto...',
  '...oppppo...',
  '..opp..ppo...',
  '..ob....bo...',
  '...b....b....',
  '............',
  '............',
  '............'
]);

const hideA = frame([
  '............',
  '............',
  '............',
  '....hhhh....',
  '...hooooh...',
  '...hssss....',
  '...osssso...',
  '..osttttso..',
  '...otttto...',
  '...oppppo...',
  '..opp..ppo...',
  '..ob....bo...',
  '..obb..bbo...',
  '............',
  '............',
  '............'
]);

const dangleA = frame([
  '.....ss.....',
  '....osso....',
  '....hhhh....',
  '...hooooh...',
  '...hssss....',
  '...osssso...',
  '....osso....',
  '...otttto...',
  '...otttto...',
  '...otttto...',
  '...oppppo...',
  '...opp.ppo...',
  '..opp...ppo.',
  '..ob.....bo.',
  '.obbo...obbo',
  '............'
]);

const dangleB = frame([
  '.....ss.....',
  '....osso....',
  '....hhhh....',
  '...hooooh...',
  '...hssss....',
  '...osssso...',
  '....osso....',
  '...otttto...',
  '...otttto...',
  '...otttto...',
  '...oppppo...',
  '...opp.ppo...',
  '....ppoppo..',
  '....bo..ob..',
  '...obbo.obbo',
  '............'
]);

// Sitting cross-legged with headphones on (the band and ear cups are outline
// pixels over the hair), legs stretched out front; frame B nods the head.
const listenA = frame([
  '............',
  '............',
  '............',
  '............',
  '............',
  '...oooooo...',
  '..o.hhhh.o..',
  '..ohooooho..',
  '...hssss....',
  '...otttto...',
  '..otttttto..',
  '..osttttso..',
  '...oppppo...',
  '...opppppo..',
  '..oob..obbo.',
  '............'
]);

const listenB = frame([
  '............',
  '............',
  '............',
  '............',
  '............',
  '............',
  '...oooooo...',
  '..o.hhhh.o..',
  '..ohooooho..',
  '...hssss....',
  '..otttttto..',
  '..osttttso..',
  '...oppppo...',
  '...opppppo..',
  '..oob..obbo.',
  '............'
]);

function animation(
  frames: SpriteFrame[],
  frameDurationMs: number,
  loop = true
): SpriteAnimation {
  return { frames, frameDurationMs, loop };
}

const animations: Record<AnimationName, SpriteAnimation> = {
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
  scale: 2,
  dragGrip: { x: 6, y: 1 },
  palette: {
    o: '$outline',
    h: '#744c34',
    s: '#efaa78',
    t: '#4ba7c8',
    p: '#625b9a',
    b: '$outline'
  },
  body: {
    offsetX: 5,
    offsetY: 2,
    width: 14,
    height: 30
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
  h: '#e8c170',
  t: '#c14b4b',
  p: '#54586e'
});

const mossPerson = withPalette(tinyPerson, 'tiny-person-moss', {
  h: '#2f2b26',
  s: '#c98d5e',
  t: '#6a9a58',
  p: '#5d5266'
});

const plumPerson = withPalette(tinyPerson, 'tiny-person-plum', {
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

export function randomCharacter(): CharacterDefinition {
  const all = Object.values(characterRegistry);
  return all[Math.floor(Math.random() * all.length)];
}
