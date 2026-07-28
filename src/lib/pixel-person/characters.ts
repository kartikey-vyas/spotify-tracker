import type { CharacterDefinition, SpriteAnimation, SpriteFrame } from './types';

const WIDTH = 24;
const HEIGHT = 32;

export function frame(rows: string[]): SpriteFrame {
  if (rows.length !== HEIGHT || rows.some((row) => row.length !== WIDTH)) {
    throw new Error(`Pixel person frames must be ${WIDTH}x${HEIGHT}.`);
  }
  return { rows };
}

// The rig reads as one figure across every pose: head mass 12 wide (rows 1-11
// standing), shoulder line at row 14, hips at row 22, feet flush with row 31.
// Only what should move, moves.
const idleA = frame([
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
  '......tttttttttttt......',
  '.....tttttttttttttt.....',
  '.....tttttttttttttt.....',
  '.....tttttttttttttt.....',
  '.....tttttttttttttt.....',
  '.....ssttttttttttss.....',
  '.....ssttttttttttss.....',
  '......tttttttttttt......',
  '......pppppppppppp......',
  '......pppppppppppp......',
  '......pppp....pppp......',
  '......pppp....pppp......',
  '......pppp....pppp......',
  '......pppp....pppp......',
  '......pppp....pppp......',
  '......bbbb....bbbb......',
  '......bbbb....bbbb......',
  '.....bbbbb....bbbbb.....'
]);

// Breathing beat: the head settles a row and one of the two neck rows
// disappears into the shoulders, so the figure reads as one body inhaling
// rather than two poses. The shoulder line never moves.
const idleB = frame([
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
  '......tttttttttttt......',
  '.....tttttttttttttt.....',
  '.....tttttttttttttt.....',
  '.....tttttttttttttt.....',
  '.....tttttttttttttt.....',
  '.....ssttttttttttss.....',
  '.....ssttttttttttss.....',
  '......tttttttttttt......',
  '......pppppppppppp......',
  '......pppppppppppp......',
  '......pppp....pppp......',
  '......pppp....pppp......',
  '......pppp....pppp......',
  '......pppp....pppp......',
  '......pppp....pppp......',
  '......bbbb....bbbb......',
  '......bbbb....bbbb......',
  '.....bbbbb....bbbbb.....'
]);

// Stride frame: arms counter-swing (right hand high, left hand low) and the
// legs open from the hip, feet clearing the body box on both sides.
const walkA = frame([
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
  '......tttttttttttt......',
  '.....tttttttttttttt.....',
  '.....tttttttttttttt.....',
  '.....tttttttttttttt.....',
  '.....ttttttttttttss.....',
  '.....ttttttttttttss.....',
  '.....sstttttttttttt.....',
  '......tttttttttttt......',
  '......pppppppppppp......',
  '......pppppppppppp......',
  '......pppp....pppp......',
  '.....pppp......pppp.....',
  '.....pppp......pppp.....',
  '....pppp........pppp....',
  '....pppp........pppp....',
  '....bbbb........bbbb....',
  '....bbbb........bbbb....',
  '...bbbbb........bbbbb...'
]);

// Passing frame: arms swap, legs close, and the trailing foot loses its flare
// so one heel reads as lifted without the figure drifting off its hips.
const walkB = frame([
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
  '......tttttttttttt......',
  '.....tttttttttttttt.....',
  '.....tttttttttttttt.....',
  '.....tttttttttttttt.....',
  '.....sstttttttttttt.....',
  '.....sstttttttttttt.....',
  '.....ttttttttttttss.....',
  '......tttttttttttt......',
  '......pppppppppppp......',
  '......pppppppppppp......',
  '......pppp....pppp......',
  '......pppp....pppp......',
  '......pppp....pppp......',
  '......pppp....pppp......',
  '......pppp....pppp......',
  '......bbbb....bbbb......',
  '......bbbb....bbbb......',
  '.....bbbbb....bbbb......'
]);

// Both arms thrown overhead — the fists are 3 wide and 2 tall so they read as
// hands, not nubs — with the whole body riding two rows higher than idle.
const jump = frame([
  '..sss..............sss..',
  '..sss...gggggggg...sss..',
  '..ttt..gggggggggg..ttt..',
  '..ttt.gggggggggggg.ttt..',
  '..ttt.hhhhhhhhhhhh.ttt..',
  '..ttt.hhhhhhhhhhhh.ttt..',
  '..ttt.fssssssssssf.ttt..',
  '..ttt.fssssssssssf.ttt..',
  '..ttt.fsoossssoosf.ttt..',
  '..ttt.fssssssssssf.ttt..',
  '..ttt..ssssssssss..ttt..',
  '..ttt...ssssssss...ttt..',
  '...ttt...ssssss...ttt...',
  '....ttt..ssssss..ttt....',
  '....tttttttttttttttt....',
  '.....tttttttttttttt.....',
  '.....tttttttttttttt.....',
  '.....ssttttttttttss.....',
  '.....tttttttttttttt.....',
  '.....tttttttttttttt.....',
  '......tttttttttttt......',
  '......pppppppppppp......',
  '.....pppp......pppp.....',
  '.....pppp......pppp.....',
  '....pppp........pppp....',
  '....pppp........pppp....',
  '....pppp........pppp....',
  '....bbbb........bbbb....',
  '....bbbb........bbbb....',
  '...bbbbb........bbbbb...',
  '........................',
  '........................'
]);

// Arms flung straight out at the shoulder line, two rows thick so the hands are
// 2x2 blocks at the wrists rather than single stray pixels.
const fall = frame([
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
  '......tttttttttttt......',
  '.....tttttttttttttt.....',
  '.....tttttttttttttt.....',
  '.sstt.tttttttttttt.ttss.',
  '.sstt.tttttttttttt.ttss.',
  '.....tttttttttttttt.....',
  '.....tttttttttttttt.....',
  '......tttttttttttt......',
  '......pppppppppppp......',
  '......pppppppppppp......',
  '.....pppp......pppp.....',
  '.....pppp......pppp.....',
  '.....pppp......pppp.....',
  '.....pppp......pppp.....',
  '.....pppp......pppp.....',
  '.....bbbb......bbbb.....',
  '.....bbbb......bbbb.....',
  '....bbbbb......bbbbb....'
]);

// CRAWL_HEIGHT is 12 CSS px, which at scale 1.0 is exactly 12 sprite rows, so
// every lit pixel below has to live in rows 20-31. Anything higher clips
// through the gaps this animation exists to squeeze under.
//
// A bear crawl facing right: head raised at the front, back running flat to
// the hips at the left, one knee tucked under the belly, and the near arm
// dropping from under the shoulder to a hand planted on the floor. The extra
// rows buy a real profile head — hair at the back, temple column, a two-pixel
// eye — instead of the old six-pixel blob.
//
// The arm is a SLEEVE (`t`) down to a skin hand at the bottom. Drawn in skin it
// ran straight into the face — same colour, no edge between them — and the head
// read as a snout. Blue against the peach face is the separation; the `o` run
// closing the jaw underside on row 26 is the other half of it.
const crawlA = frame([
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
  '......ttttttthhfssssss..',
  '....ttttttttthfssoosss..',
  '..pppptttttttttsssssss..',
  '.pppppttttttttttttttt...',
  '.ppppp...ppppp.tttt.....',
  'ppppp....ppppp.tttt.....',
  'ppppp....ppppp..tttt....',
  'bbbbb....bbbbb..ssss....',
  'bbbbb....bbbbb..ssssss..'
]);

const crawlB = frame([
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
  '......ttttttthhfssssss..',
  '....ttttttttthfssoosss..',
  '...ppptttttttttsssssss..',
  '..ppppttttttttttttttt...',
  '..ppppp..ppppp..tttt....',
  '.ppppp...ppppp..tttt....',
  '.ppppp...ppppp...tttt...',
  '.bbbbb...bbbbb...ssss...',
  '.bbbbb...bbbbb...ssssss.'
]);

// Reach: one arm straight overhead onto the next hold, the head tucked a row
// into the shoulders, the far leg swung out onto a rung and the near leg
// hanging. climbB is the mirrored beat, so the cycle alternates sides.
const climbA = frame([
  '..................sss...',
  '..................sss...',
  '.......gggggggg...tttt..',
  '......gggggggggg..tttt..',
  '.....gggggggggggg.tttt..',
  '.....hhhhhhhhhhhh.tttt..',
  '.....hhhhhhhhhhhh.tttt..',
  '.....fssssssssssf.tttt..',
  '.....fssssssssssf.tttt..',
  '.....fsoossssoosf.tttt..',
  '.....fssssssssssf.tttt..',
  '......ssssssssss..tttt..',
  '.......ssssssss...tttt..',
  '........ssssss....tttt..',
  '....tttttttttttttttttt..',
  '....tttttttttttttt......',
  '....tttttttttttttt......',
  '....tttttttttttttt......',
  '....tttttttttttttt......',
  '....sstttttttttttt......',
  '....sstttttttttttt......',
  '.....tttttttttttt.......',
  '.....pppppppppppp.......',
  '.....pppppppppppp.......',
  '.....pppp....pppp.......',
  '...pppp......pppp.......',
  '..pppp.......pppp.......',
  '..bbbbb......pppp.......',
  '.............pppp.......',
  '.............pppp.......',
  '............bbbbb.......',
  '...........bbbbbb.......'
]);

const climbB = frame([
  '...sss..................',
  '...sss..................',
  '..tttt...gggggggg.......',
  '..tttt..gggggggggg......',
  '..tttt.gggggggggggg.....',
  '..tttt.hhhhhhhhhhhh.....',
  '..tttt.hhhhhhhhhhhh.....',
  '..tttt.fssssssssssf.....',
  '..tttt.fssssssssssf.....',
  '..tttt.fsoossssoosf.....',
  '..tttt.fssssssssssf.....',
  '..tttt..ssssssssss......',
  '..tttt...ssssssss.......',
  '..tttt....ssssss........',
  '..tttttttttttttttttt....',
  '......tttttttttttttt....',
  '......tttttttttttttt....',
  '......tttttttttttttt....',
  '......tttttttttttttt....',
  '......ttttttttttttss....',
  '......ttttttttttttss....',
  '.......tttttttttttt.....',
  '.......pppppppppppp.....',
  '.......pppppppppppp.....',
  '.......pppp....pppp.....',
  '.......pppp......pppp...',
  '.......pppp.......pppp..',
  '.......pppp......bbbbb..',
  '.......pppp.............',
  '.......pppp.............',
  '.......bbbbb............',
  '.......bbbbbb...........'
]);

// Pulling up over a ledge: both arms locked out at the sides as struts whose
// inner outline doubles as the torso outline, the body squeezed between them
// and the feet two rows off the ground.
const mantleA = frame([
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
  '......tttttttttttt......',
  '.....tttttttttttttt.....',
  '.....tttttttttttttt.....',
  '...ttt.tttttttttt.ttt...',
  '...ttt.tttttttttt.ttt...',
  '...ttt.tttttttttt.ttt...',
  '...ttt.tttttttttt.ttt...',
  '...ttt.tttttttttt.ttt...',
  '...ttt.pppppppppp.ttt...',
  '...ttt.pppppppppp.ttt...',
  '...sss.ppp....ppp.sss...',
  '...sss.ppp....ppp.sss...',
  '......pppp....pppp......',
  '......bbbb....bbbb......',
  '......bbbb....bbbb......',
  '.....bbbbb....bbbbb.....',
  '........................',
  '........................'
]);

// Top of the pull-up: the figure stands tall a further row and the crown's
// narrowest row is clipped by the sprite edge, which is what sells the rise.
const mantleB = frame([
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
  '......tttttttttttt......',
  '.....tttttttttttttt.....',
  '.....tttttttttttttt.....',
  '.....tttttttttttttt.....',
  '.....tttttttttttttt.....',
  '.....ssttttttttttss.....',
  '.....ssttttttttttss.....',
  '......tttttttttttt......',
  '......pppppppppppp......',
  '......pppppppppppp......',
  '......pppp....pppp......',
  '......pppp....pppp......',
  '......pppp....pppp......',
  '......pppp....pppp......',
  '......pppp....pppp......',
  '......bbbb....bbbb......',
  '......bbbb....bbbb......',
  '.....bbbbb....bbbbb.....',
  '........................',
  '........................',
  '........................'
]);

// Ducked out of sight: the head drops four rows and the legs fold to match, so
// the silhouette shortens without the feet leaving the floor.
const hideA = frame([
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
  '......tttttttttttt......',
  '.....tttttttttttttt.....',
  '.....tttttttttttttt.....',
  '.....tttttttttttttt.....',
  '.....tttttttttttttt.....',
  '.....ssttttttttttss.....',
  '.....ssttttttttttss.....',
  '......tttttttttttt......',
  '......pppppppppppp......',
  '......pppppppppppp......',
  '......pppp....pppp......',
  '......pppp....pppp......',
  '......pppp....pppp......',
  '......bbbb....bbbb......',
  '.....bbbbb....bbbbb.....'
]);

// Hanging off a pointer. Asymmetry is the whole point: ONE arm goes up on the
// left, the other hangs down the right side of the torso, and the hips and
// legs drift right so the figure is askew rather than plumb. `dragGrip` sits
// on the raised hand (2,1), which is the pixel render.ts pivots the pendulum
// around — so the body swings off-axis from the fist instead of see-sawing
// around its own centre line.
const dangleA = frame([
  '.sss....................',
  '.sss....................',
  '.ttt....................',
  '.ttt.....gggggggg.......',
  '.ttt....gggggggggg......',
  '.ttt...gggggggggggg.....',
  '.ttt...hhhhhhhhhhhh.....',
  '.ttt...hhhhhhhhhhhh.....',
  '.ttt...fssssssssssf.....',
  '..ttt..fssssssssssf.....',
  '.ttt...fsoossssoosf.....',
  '..ttt..fssssssssssf.....',
  '...ttt..ssssssssss......',
  '...ttt...ssssssss.......',
  '....ttt...ssssss........',
  '....tttttttttttttttt....',
  '......ttttttttttttt.ttt.',
  '......ttttttttttttt.ttt.',
  '......ttttttttttttt.ttt.',
  '......ttttttttttttt.ttt.',
  '......ttttttttttttt.ttt.',
  '......ttttttttttttt.sss.',
  '......ttttttttttttt.sss.',
  '.......tttttttttttt.....',
  '........pppppppppppp....',
  '........pppppppppppp....',
  '........pppp....pppp....',
  '.........pppp....pppp...',
  '.........pppp....pppp...',
  '..........pppp....pppp..',
  '..........bbbb....bbbb..',
  '.........bbbbb....bbbbb.'
]);

// The swing back: same grip, same raised arm, but the legs pass through plumb
// to the far side and the free arm lifts off the ribs.
const dangleB = frame([
  '.sss....................',
  '.sss....................',
  '.ttt....................',
  '.ttt.....gggggggg.......',
  '.ttt....gggggggggg......',
  '.ttt...gggggggggggg.....',
  '.ttt...hhhhhhhhhhhh.....',
  '.ttt...hhhhhhhhhhhh.....',
  '.ttt...fssssssssssf.....',
  '..ttt..fssssssssssf.....',
  '.ttt...fsoossssoosf.....',
  '..ttt..fssssssssssf.....',
  '...ttt..ssssssssss......',
  '...ttt...ssssssss.......',
  '....ttt...ssssss........',
  '....tttttttttttttttt....',
  '......ttttttttttttt.ttt.',
  '......ttttttttttttt.ttt.',
  '......ttttttttttttt.ttt.',
  '......tttttttttttttt.ttt',
  '......tttttttttttttt.ttt',
  '......tttttttttttttt.sss',
  '......tttttttttttttt.sss',
  '.......tttttttttttt.....',
  '........pppppppppppp....',
  '........pppppppppppp....',
  '........pppp....pppp....',
  '........pppp....pppp....',
  '.......pppp....pppp.....',
  '.......pppp....pppp.....',
  '.......bbbb....bbbb.....',
  '......bbbbb....bbbbb....'
]);

// Seated with headphones on. The band arcs over the crown and the cups are a
// three-pixel column at ear height — wide enough to read as an object rather
// than a hairband. Nothing above row 6 so the pose reads as seated.
const listenA = frame([
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
  '......tttttttttttt......',
  '.....tttttttttttttt.....',
  '.....tttttttttttttt.....',
  '.....ssttttttttttss.....',
  '......tttttttttttt......',
  '.....pppppppppppppp.....',
  '....pppppppppppppppp....',
  '....bbbbppppppppbbbb....',
  '........................',
  '........................',
  '........................',
  '........................'
]);

// Nod: the head and its headphones sink two rows and both neck rows disappear
// into the shoulders, which stay exactly where they were.
const listenB = frame([
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
  '......tttttttttttt......',
  '.....tttttttttttttt.....',
  '.....tttttttttttttt.....',
  '.....ssttttttttttss.....',
  '......tttttttttttt......',
  '.....pppppppppppppp.....',
  '....pppppppppppppppp....',
  '....bbbbppppppppbbbb....',
  '........................',
  '........................',
  '........................',
  '........................'
]);

export function animation(
  frames: SpriteFrame[],
  frameDurationMs: number,
  loop = true
): SpriteAnimation {
  return { frames, frameDurationMs, loop };
}

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
  // 24x32 at 1.0 renders 24x32 CSS px — the same on-screen footprint the rig
  // has always had, with 2.2x the pixel budget. One sprite pixel is one CSS
  // pixel, so nothing depends on fractional-scale rasterization any more.
  scale: 1.0,
  // The raised fist in dangleA/dangleB. render.ts pivots the drag pendulum
  // around this pixel, so putting it on the hand instead of dead centre is
  // what makes the body hang off-axis and swing.
  dragGrip: { x: 2, y: 1 },
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
  // Unchanged in CSS px: 14x31, the box every world-tuning constant and
  // gap-fit rule is calibrated against. Only offsetY moves 2 -> 1 so that
  // offsetY + height === 32 keeps the feet flush with the sprite's last row.
  body: {
    offsetX: 5,
    offsetY: 1,
    width: 14,
    height: 31
  },
  animations,
  // The shared rig's literals. Cannot be derived by convention: `hide` reuses
  // idleB as its second frame, so editing hide:1 edits idle too.
  frameSource: {
    file: 'src/lib/pixel-person/characters.ts',
    names: {
      'idle:0': 'idleA', 'idle:1': 'idleB',
      'walk:0': 'walkA', 'walk:1': 'walkB',
      'jump:0': 'jump', 'fall:0': 'fall',
      'crawl:0': 'crawlA', 'crawl:1': 'crawlB',
      'climb:0': 'climbA', 'climb:1': 'climbB',
      'mantle:0': 'mantleA', 'mantle:1': 'mantleB',
      'hide:0': 'hideA', 'hide:1': 'idleB',
      'dangle:0': 'dangleA', 'dangle:1': 'dangleB',
      'listen:0': 'listenA', 'listen:1': 'listenB'
    }
  }
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
