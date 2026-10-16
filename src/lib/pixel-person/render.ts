import { MUSIC } from './activities';
import { clamp } from './physics';
import { getRecordArt } from './record-art';
import type { RecordPlayerState } from './record-player';
import { LOUNGE, SHELF, type FurniturePiece, type RoomLayout } from './room';
import type { ShelfSlot } from './shelf';
import {
  arrivalAppear,
  doorwayExitFade,
  listeningSince,
  type LampState,
  type PixelPersonRuntime
} from './simulation';
import { hitTestSpriteFrame, selectSpriteFrame, spriteTimeScale } from './sprite';
import type { AnimationName, Point, SpriteFrame } from './types';

/** Everything one frame of the room draws. */
export interface RoomScene {
  room: RoomLayout;
  shelf: readonly ShelfSlot[];
  people: readonly PixelPersonRuntime[];
  now: number;
  /** 0..1: the door fades in while it is wanted (held, arriving, leaving). */
  doorOpacity: number;
  /** 0 open .. 1 shut. */
  doorShut: number;
  lamp: LampState;
  player: RecordPlayerState;
  debug: boolean;
}

/**
 * The lamp's light: always a soft warm yellow, like a real bulb, whatever the
 * theme. A pale yellow all but vanishes on a light page, so light themes get a
 * deeper amber at a little more strength — still a lamp, just visible.
 */
export const LAMP_GLOW = {
  fadeMs: 600,
  /** Reach of the glow from the shade, in CSS px. */
  radius: 46,
  dark: { shade: '#ffd27a', glow: '#ffc964', strength: 0.24 },
  light: { shade: '#f2b544', glow: '#f0a630', strength: 0.34 }
} as const;

/** 0 dark, 1 fully lit, easing between the two after a switch. */
export function lampGlow(lamp: LampState, now: number): number {
  const progress = clamp((now - lamp.changedAt) / LAMP_GLOW.fadeMs, 0, 1);
  const eased = progress * progress * (3 - 2 * progress);
  return lamp.on ? eased : 1 - eased;
}

const RECORD_SIZE = SHELF.recordSize;
const spriteCache = new Map<string, HTMLCanvasElement>();

/**
 * Device pixels per sprite pixel. Rasterizing at this step keeps every pixel
 * edge on a device-pixel boundary, which is what lets `scale` be fractional:
 * the constraint is that `scale * dpr` be integral, not `scale` itself.
 */
export function deviceStep(scale: number, dpr: number): number {
  return Math.max(1, Math.round(scale * dpr));
}

/**
 * Cache identity for a rasterized frame. The step must be part of it — once
 * rasterization depends on dpr, browser zoom would otherwise serve bitmaps
 * rendered for the previous ratio.
 */
export function spriteCacheKey(frameKey: string, outline: string, step: number): string {
  return `${frameKey}:${outline}:${step}`;
}

/**
 * The device pixel ratio the canvas is transformed by, capped so a 3x display
 * does not triple the raster cost. Sprites rasterize against this same value,
 * or cached sprites would be drawn at a different density than the canvas.
 */
function clampedDpr(): number {
  return Math.min(window.devicePixelRatio || 1, 2);
}

interface AppliedSize {
  dpr: number;
  width: number;
  height: number;
  signature: string;
}

const appliedSizes = new WeakMap<HTMLCanvasElement, AppliedSize>();

/**
 * Sizes the canvas backing store to its CSS box. Browser zoom changes dpr and
 * CSS size inversely, so all three are tracked; assigning width/height resets
 * the bitmap even to the same value, so they are only touched on a change.
 */
export function sizeCanvas(
  canvas: HTMLCanvasElement,
  width: number,
  height: number
): CanvasRenderingContext2D | null {
  const context = canvas.getContext('2d');
  if (!context) return null;
  const dpr = clampedDpr();
  const applied = appliedSizes.get(canvas);
  if (applied && applied.dpr === dpr && applied.width === width && applied.height === height) {
    return context;
  }
  const pixelWidth = Math.max(1, Math.round(width * dpr));
  const pixelHeight = Math.max(1, Math.round(height * dpr));
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.imageSmoothingEnabled = false;
  appliedSizes.set(canvas, { dpr, width, height, signature: '' });
  return context;
}

interface ThemeColours {
  outline: string;
  line: string;
  muted: string;
  accent: string;
  /** True when the page ground is light; the lamp's warm light needs more body there. */
  lightGround: boolean;
  /** Upholstery: the theme's accent ramp, so the lounge belongs to each theme. */
  fabric: string;
  cushion: string;
  pillow: string;
}

let cachedTheme: string | null = null;
let cachedColours: ThemeColours = {
  outline: '#111',
  line: '#444',
  muted: '#666',
  accent: '#666',
  lightGround: false,
  fabric: '#444',
  cushion: '#555',
  pillow: '#666'
};

/**
 * Resolves a custom property to a colour canvas can use. The `--data-*` ramp
 * is `color-mix()` over other variables, which a canvas fillStyle cannot
 * parse, so it is resolved through a probe element's computed colour.
 */
function resolveColour(name: string, fallback: string): string {
  const probe = document.createElement('span');
  probe.style.display = 'none';
  probe.style.color = `var(${name}, ${fallback})`;
  document.body.append(probe);
  const colour = getComputedStyle(probe).color || fallback;
  probe.remove();
  return colour;
}

/** Relative luminance (0..1) of an `rgb(...)` or hex colour. */
export function luminance(colour: string): number {
  const [red, green, blue] = withAlpha(colour, 1)
    .match(/[\d.]+/g)!
    .slice(0, 3)
    .map((channel) => {
      const value = Number(channel) / 255;
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function themeColours(): ThemeColours {
  const theme = document.documentElement.dataset.theme ?? 'light';
  if (theme !== cachedTheme) {
    cachedTheme = theme;
    const styles = getComputedStyle(document.documentElement);
    const read = (name: string) => styles.getPropertyValue(name).trim();
    const muted = read('--muted') || read('--text') || '#666';
    const line = read('--line') || muted;
    const accent = read('--accent') || muted;
    cachedColours = {
      outline: muted,
      muted,
      line,
      accent,
      lightGround: luminance(resolveColour('--bg', '#000')) > 0.5,
      fabric: resolveColour('--data-1', line),
      cushion: resolveColour('--data-2', line),
      pillow: resolveColour('--data-3', accent)
    };
  }
  return cachedColours;
}

/**
 * Silhouette colour for sprites. Reads `--muted` rather than `--text`: at full
 * text contrast the outline traced every limb in stark white or black, which
 * read as heavy banding rather than an edge.
 */
export function themeOutline(): string {
  return themeColours().outline;
}

/** 0..1 for a record rising out of a pocket or sinking back in; 1 when simply held. */
export function pocketReveal(person: PixelPersonRuntime, now: number): number {
  const carried = person.carrying;
  if (!carried) return 0;
  if (carried.stowingAt !== null) {
    return 1 - clamp((now - carried.stowingAt) / MUSIC.pocketMs, 0, 1);
  }
  if (carried.source !== 'pocket') return 1;
  return clamp((now - carried.takenAt) / MUSIC.pocketMs, 0, 1);
}

/** True while something on screen changes every frame, so there is no point comparing. */
function animatingContinuously(scene: RoomScene): boolean {
  const { now } = scene;
  const glow = lampGlow(scene.lamp, now);
  if (scene.debug || (glow > 0 && glow < 1)) return true;
  return scene.people.some(
    (person) =>
      person.drag !== null ||
      listeningSince(person) !== null ||
      person.exit?.enteredAt != null ||
      (person.carrying !== null && pocketReveal(person, now) < 1) ||
      arrivalAppear(person, now) < 1
  );
}

/**
 * Everything drawn is a pure function of these inputs; when none of them
 * changed since the last frame the canvas is already right and the clear and
 * draw are skipped. Null when something animates continuously, so a frame is
 * drawn without building a signature that could never match.
 */
function renderSignature(canvas: HTMLCanvasElement, scene: RoomScene): string | null {
  if (animatingContinuously(scene)) return null;
  const { now } = scene;
  let signature =
    `${canvas.width}:${canvas.height}:${scene.room.width}:${scene.room.shelfSide}` +
    `:${document.documentElement.dataset.theme ?? ''}` +
    `:door${scene.doorOpacity.toFixed(2)}:${scene.doorShut.toFixed(2)}` +
    `:${scene.room.furniture.length}:${scene.lamp.on}` +
    // A playing record only changes when its sheen steps on, not every frame.
    `:${playerSignature(scene.player, now)}`;
  for (const slot of scene.shelf) {
    const url = slot.record?.imageUrl ?? '';
    signature += `|${url}:${slot.out ?? ''}:${url ? (getRecordArt(url)?.status ?? '') : ''}`;
  }
  for (const person of scene.people) {
    const frameIndex = selectSpriteFrame(
      person.definition,
      person.animation,
      person.animationStartedAt,
      now,
      spriteTimeScale(person.animation, person.body.vx)
    ).index;
    signature +=
      `|${person.id}:${person.definition.id}:${Math.round(person.body.x)}:${Math.round(person.body.y)}` +
      `:${person.facing}:${person.animation}:${frameIndex}`;
    if (person.carrying) {
      const art = getRecordArt(person.carrying.record.imageUrl);
      signature += `:${art?.status ?? ''}:${carriedRecordBob(person, now)}`;
    }
  }
  return signature;
}

export function renderRoom(canvas: HTMLCanvasElement, scene: RoomScene): void {
  const { room, now } = scene;
  const context = sizeCanvas(canvas, room.width, room.height);
  if (!context) return;
  const applied = appliedSizes.get(canvas)!;
  const signature = renderSignature(canvas, scene);
  if (signature !== null && signature === applied.signature) return;
  applied.signature = signature ?? '';
  // Clear in device space: CSS-space clearing under-covers the last device
  // row/column when the size * dpr rounds up (fractional-DPR ghosting).
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.restore();

  const colours = themeColours();
  const glow = lampGlow(scene.lamp, now);
  // Behind everything, so the light falls on the couch and whoever is on it.
  for (const piece of room.furniture) {
    if (piece.kind === 'lamp' && glow > 0) drawLampGlow(context, piece, glow, colours);
  }
  for (const piece of room.furniture) {
    if (piece.kind === 'player') drawRecordPlayer(context, piece, scene.player, colours, now);
    else drawFurniture(context, piece, colours, glow);
  }
  drawShelf(context, room, scene.shelf, colours);
  if (scene.debug) drawDebug(context, room);
  drawDoorwayFrame(context, room, scene.doorOpacity, colours);
  for (const person of scene.people) {
    // Set down beside a sitter, the record is painted first so they sit in
    // front of it; in hand it paints over the sprite.
    const behind = person.carrying ? carriedRecordPlacement(person, room, now).behind : false;
    if (behind) drawCarriedRecord(context, room, person, now);
    drawPerson(context, person, now);
    if (!behind) drawCarriedRecord(context, room, person, now);
    // From the headphones, whether the record is in hand or on the player.
    drawListeningNotes(context, person, now, colours.outline);
  }
  // Last, so the closing door passes in front of whoever stepped through it.
  drawDoorwayDoor(context, room, scene.doorOpacity, scene.doorShut, colours);
}

/**
 * The low record shelf: a 2px board with a 1px echo rule beneath it — the
 * same paired-hairline vocabulary as the cover wall's shelves — on two thin
 * legs, with the records standing face-out on top. A record someone has out
 * leaves its gap.
 */
function drawShelf(
  context: CanvasRenderingContext2D,
  room: RoomLayout,
  shelf: readonly ShelfSlot[],
  colours: ThemeColours
): void {
  const { x, width, boardY } = room.shelf;
  context.save();
  context.fillStyle = colours.line;
  context.strokeStyle = colours.line;
  context.fillRect(x, boardY, width, SHELF.boardThickness);
  context.fillRect(x, boardY + SHELF.boardThickness + 3, width, 1);
  context.fillRect(x + 1, boardY, 1, room.floorY - boardY);
  context.fillRect(x + width - 2, boardY, 1, room.floorY - boardY);
  shelf.forEach((slot, index) => {
    const layout = room.shelf.slots[index];
    if (!layout || !slot.record || slot.out) return;
    const art = getRecordArt(slot.record.imageUrl);
    if (art?.status === 'ready' && art.sprite) {
      context.drawImage(art.sprite, layout.x, layout.y, RECORD_SIZE, RECORD_SIZE);
    } else {
      // A sleeve outline while the art loads (or if it never does), so the
      // shelf never looks emptier than it is.
      context.globalAlpha = 0.6;
      context.strokeRect(layout.x + 0.5, layout.y + 0.5, RECORD_SIZE - 1, RECORD_SIZE - 1);
      context.globalAlpha = 1;
    }
  });
  context.restore();
}

// A tiny eighth note, one CSS pixel per cell, so it reads as a hint of music
// rather than competing with the sprite.
const NOTE_GLYPH = ['..#.', '..##', '..#.', '..#.', '.##.', '###.'];
const NOTE_CELL = 1;
const NOTE_INTERVAL_MS = 900;
const NOTE_LIFE_MS = 1_700;
const NOTE_RISE = 14;
const NOTE_ALPHA = 0.7;

function drawListeningNotes(
  context: CanvasRenderingContext2D,
  person: PixelPersonRuntime,
  now: number,
  colour: string
): void {
  const since = listeningSince(person);
  if (since === null) return;
  const elapsed = now - since;
  const newest = Math.floor(elapsed / NOTE_INTERVAL_MS);
  const oldest = Math.max(0, Math.ceil((elapsed - NOTE_LIFE_MS) / NOTE_INTERVAL_MS));
  const originX = person.body.x + person.body.width / 2;
  const originY = person.body.y + 2 + (POSE[person.animation]?.headDrop ?? 0);
  context.save();
  context.fillStyle = colour;
  for (let index = oldest; index <= newest; index += 1) {
    const age = elapsed - index * NOTE_INTERVAL_MS;
    if (age < 0 || age >= NOTE_LIFE_MS) continue;
    const progress = age / NOTE_LIFE_MS;
    const side = index % 2 === 0 ? 1 : -1;
    const x = originX + side * (6 + progress * 5) + Math.sin(age / 260 + index);
    const y = Math.max(0, originY - progress * NOTE_RISE);
    context.globalAlpha = NOTE_ALPHA * (progress < 0.75 ? 1 : 1 - (progress - 0.75) / 0.25);
    drawNoteGlyph(context, Math.round(x), Math.round(y));
  }
  context.restore();
}

function drawNoteGlyph(context: CanvasRenderingContext2D, x: number, y: number): void {
  for (let row = 0; row < NOTE_GLYPH.length; row += 1) {
    for (let column = 0; column < NOTE_GLYPH[row].length; column += 1) {
      if (NOTE_GLYPH[row][column] !== '#') continue;
      context.fillRect(x + column * NOTE_CELL, y + row * NOTE_CELL, NOTE_CELL, NOTE_CELL);
    }
  }
}

function carriedRecordBob(person: PixelPersonRuntime, now: number): number {
  return person.animation === 'walk' ? Math.round(Math.sin(now / 220)) : 0;
}

/**
 * How each pose holds a record and where its head sits, for the poses that
 * differ from standing. Keyed by the animation actually drawn, so a new pose
 * declares its own entry rather than adding a special case below.
 */
const POSE: Partial<
  Record<AnimationName, { hold?: 'rest' | 'off-hand'; restHeight?: number; headDrop?: number }>
> = {
  // Cross-legged on the floor: the record leans on the floor beside them.
  listen: { hold: 'rest', restHeight: 0 },
  // Sunk into a seat: on the cushion by their knee, head about 4px lower.
  lounge: { hold: 'rest', restHeight: LOUNGE.cushionHeight, headDrop: 4 },
  // One arm up to the lamp: the record is in the other hand.
  reach: { hold: 'off-hand' }
};

/**
 * Where a carried record is drawn, and whether it sits behind the person.
 *
 * - Sitting (on a seat, or cross-legged on the floor to listen): it rests
 *   beside them — on the cushion by their knee, or on the floor — from the
 *   moment they sit, behind them. Waiting for the listen to start left it
 *   hovering at standing hand height for the settle beat, then jumping down.
 * - Reaching for the lamp: in the hand that is not reaching, i.e. on the side
 *   away from the lamp, or it hangs in the air beside the raised arm.
 * - Otherwise: in hand, in front, on the side they face, with a walk bob.
 *
 * Kept free of canvas types so the placement rules can be unit tested.
 */
export function carriedRecordPlacement(
  person: PixelPersonRuntime,
  room: RoomLayout,
  now: number
): { x: number; y: number; behind: boolean } {
  const { body } = person;
  const pose = POSE[person.animation];
  if (pose?.hold === 'rest') {
    const x = person.facing === 1 ? body.x + body.width - 4 : body.x - RECORD_SIZE + 4;
    return { x, y: room.floorY - (pose.restHeight ?? 0) - RECORD_SIZE, behind: true };
  }
  const side = pose?.hold === 'off-hand' ? -person.facing : person.facing;
  const x = side === 1 ? body.x + body.width - 3 : body.x - RECORD_SIZE + 3;
  const y = body.y + body.height - RECORD_SIZE - 7 + carriedRecordBob(person, now);
  return { x, y, behind: false };
}

function drawCarriedRecord(
  context: CanvasRenderingContext2D,
  room: RoomLayout,
  person: PixelPersonRuntime,
  now: number
): void {
  if (!person.carrying) return;
  const art = getRecordArt(person.carrying.record.imageUrl);
  if (art?.status !== 'ready' || !art.sprite) return;
  const reveal = pocketReveal(person, now);
  if (reveal <= 0) return;
  // Drawn outside the facing-flip transform so the album art never mirrors.
  const { x, y } = carriedRecordPlacement(person, room, now);
  const sink = Math.round((1 - reveal) * 8);
  context.save();
  if (reveal < 1) {
    // Clipped at the hip, so it comes up out of the pocket rather than
    // fading in mid-air.
    context.beginPath();
    context.rect(x - 1, y - 2, RECORD_SIZE + 2, RECORD_SIZE + 2);
    context.clip();
    context.globalAlpha = Math.min(1, reveal * 1.5);
  }
  context.drawImage(art.sprite, Math.round(x), Math.round(y + sink), RECORD_SIZE, RECORD_SIZE);
  context.restore();
}

/** Room-local hit test against the sprite's lit pixels, not its box. */
export function isPointOnPixelPerson(
  person: PixelPersonRuntime,
  point: Point,
  now: number
): boolean {
  if (person.drag || person.exit || arrivalAppear(person, now) < 1) return false;
  const definition = person.definition;
  const hitSlop = 2;
  const spriteX = person.body.x - definition.body.offsetX;
  const spriteY = spriteTopY(person);
  if (
    point.x < spriteX - hitSlop ||
    point.x > spriteX + definition.pixelWidth * definition.scale + hitSlop ||
    point.y < spriteY - hitSlop ||
    point.y > spriteY + definition.pixelHeight * definition.scale + hitSlop
  ) {
    return false;
  }
  const { frame } = selectSpriteFrame(
    definition,
    person.animation,
    person.animationStartedAt,
    now,
    spriteTimeScale(person.animation, person.body.vx)
  );
  return hitTestSpriteFrame(
    frame,
    definition.scale,
    person.facing,
    point.x - spriteX,
    point.y - spriteY
  );
}

function drawPerson(
  context: CanvasRenderingContext2D,
  person: PixelPersonRuntime,
  now: number
): void {
  const definition = person.definition;
  const { frame, index: frameIndex } = selectSpriteFrame(
    definition,
    person.animation,
    person.animationStartedAt,
    now,
    spriteTimeScale(person.animation, person.body.vx)
  );
  const spriteX = Math.round(person.body.x - definition.body.offsetX);
  const spriteY = Math.round(spriteTopY(person));
  const spriteWidth = definition.pixelWidth * definition.scale;
  const spriteHeight = definition.pixelHeight * definition.scale;
  const sprite = cachedFrame(
    `${definition.id}:${person.animation}:${frameIndex}`,
    frame,
    definition.palette,
    definition.scale
  );

  // Coming in, they fade up on the threshold once the door is open; going
  // out, they fade as it shuts on them.
  const visible = arrivalAppear(person, now) * (1 - doorwayExitFade(person, now));
  if (visible <= 0) return;
  context.save();
  if (visible < 1) context.globalAlpha = visible;
  if (person.drag) {
    const gripX = definition.dragGrip.x * definition.scale;
    const gripY = definition.dragGrip.y * definition.scale;
    context.translate(Math.round(person.drag.anchor.x), Math.round(person.drag.anchor.y));
    context.rotate(-person.drag.angle);
    if (person.facing === -1) context.scale(-1, 1);
    context.drawImage(sprite, -gripX, -gripY, spriteWidth, spriteHeight);
  } else if (person.facing === -1) {
    context.translate(spriteX + spriteWidth, spriteY);
    context.scale(-1, 1);
    context.drawImage(sprite, 0, 0, spriteWidth, spriteHeight);
  } else {
    context.drawImage(sprite, spriteX, spriteY, spriteWidth, spriteHeight);
  }
  context.restore();
}

function spriteTopY(person: PixelPersonRuntime): number {
  const definition = person.definition;
  return person.body.y - definition.body.offsetY - (definition.body.height - person.body.height);
}

/**
 * Lounge furniture as flat pixel shapes: theme-ramp upholstery with a --line
 * edge, so it sits in the same quiet register as the shelf. The lamp's shade
 * is the one accent.
 */
function drawFurniture(
  context: CanvasRenderingContext2D,
  piece: FurniturePiece,
  colours: ThemeColours,
  glow: number
): void {
  const floorY = piece.y + piece.height;
  context.save();
  if (piece.kind === 'lamp') {
    const centre = piece.x + Math.floor(piece.width / 2);
    context.fillStyle = colours.line;
    context.fillRect(centre, floorY - LOUNGE.lampHeight + 6, 1, LOUNGE.lampHeight - 6);
    context.fillRect(centre - 2, floorY - 1, 5, 1);
    // A shade that widens downward, one row at a time: a dull edge colour
    // when off, warming to lamplight as it comes on.
    const top = floorY - LOUNGE.lampHeight;
    const drawShade = (colour: string) => {
      context.fillStyle = colour;
      [5, 5, 7, 7, 9, 9].forEach((rowWidth, row) => {
        context.fillRect(piece.x + (piece.width - rowWidth) / 2, top + row, rowWidth, 1);
      });
    };
    drawShade(colours.line);
    if (glow > 0) {
      context.globalAlpha = glow;
      drawShade(lampLight(colours).shade);
      context.globalAlpha = 1;
    }
    context.restore();
    return;
  }

  const { x, width } = piece;
  const arm = LOUNGE.armWidth;
  const seatTop = floorY - LOUNGE.cushionHeight;
  const backTop = floorY - LOUNGE.backHeight;
  const armTop = floorY - LOUNGE.armHeight;
  // Legs.
  context.fillStyle = colours.line;
  context.fillRect(x + 2, floorY - 2, 2, 2);
  context.fillRect(x + width - 4, floorY - 2, 2, 2);
  // Back, then the seat base, then the arms over both.
  outlinedBox(context, x + arm - 1, backTop, width - (arm - 1) * 2, seatTop - backTop + 1, colours.fabric, colours.line);
  outlinedBox(context, x + arm - 1, seatTop, width - (arm - 1) * 2, floorY - 2 - seatTop, colours.cushion, colours.line);
  outlinedBox(context, x, armTop, arm, floorY - 2 - armTop, colours.fabric, colours.line);
  outlinedBox(context, x + width - arm, armTop, arm, floorY - 2 - armTop, colours.fabric, colours.line);
  if (piece.kind === 'couch') {
    // The seam between the two cushions, on the seat and up the back.
    const middle = x + Math.floor(width / 2);
    context.fillStyle = colours.line;
    context.fillRect(middle, seatTop + 1, 1, floorY - 3 - seatTop);
    context.fillRect(middle, backTop + 2, 1, seatTop - backTop - 3);
    // A throw pillow propped in the left corner.
    outlinedBox(context, x + arm, seatTop - 6, 6, 6, colours.pillow, colours.line);
  }
  context.restore();
}

function lampLight(colours: ThemeColours): (typeof LAMP_GLOW)['dark' | 'light'] {
  return colours.lightGround ? LAMP_GLOW.light : LAMP_GLOW.dark;
}

/**
 * A soft pool of warm light around the shade. The only gradient in the room,
 * and only while the lamp is on.
 */
function drawLampGlow(
  context: CanvasRenderingContext2D,
  lamp: FurniturePiece,
  glow: number,
  colours: ThemeColours
): void {
  const radius = LAMP_GLOW.radius;
  const centreX = lamp.x + lamp.width / 2;
  const centreY = lamp.y + 5;
  context.save();
  context.globalAlpha = glow;
  context.drawImage(glowSprite(lampLight(colours)), centreX - radius, centreY - radius, radius * 2, radius * 2);
  context.restore();
}

const glowSprites = new Map<string, HTMLCanvasElement>();

/**
 * The glow at full strength, rendered once per colour and pixel ratio. The
 * lamp is usually on, so building a gradient every frame would be the
 * room's biggest per-frame cost; a fade is just this drawn with an alpha.
 */
function glowSprite(light: (typeof LAMP_GLOW)['dark' | 'light']): HTMLCanvasElement {
  const dpr = clampedDpr();
  const key = `${light.glow}:${light.strength}:${dpr}`;
  const cached = glowSprites.get(key);
  if (cached) return cached;
  const size = Math.round(LAMP_GLOW.radius * 2 * dpr);
  const sprite = document.createElement('canvas');
  sprite.width = size;
  sprite.height = size;
  const context = sprite.getContext('2d');
  if (context) {
    const half = size / 2;
    const gradient = context.createRadialGradient(half, half, 0, half, half, half);
    gradient.addColorStop(0, withAlpha(light.glow, light.strength));
    gradient.addColorStop(0.45, withAlpha(light.glow, light.strength * 0.4));
    gradient.addColorStop(1, withAlpha(light.glow, 0));
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
  }
  glowSprites.set(key, sprite);
  return sprite;
}

/** `#rgb`, `#rrggbb` or `rgb(...)` with an alpha, for gradient stops. */
export function withAlpha(colour: string, alpha: number): string {
  let red = 0;
  let green = 0;
  let blue = 0;
  const hex = colour.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const digits =
      hex[1].length === 3 ? [...hex[1]].map((digit) => digit + digit).join('') : hex[1];
    red = parseInt(digits.slice(0, 2), 16);
    green = parseInt(digits.slice(2, 4), 16);
    blue = parseInt(digits.slice(4, 6), 16);
  } else {
    const parts = colour.match(/[\d.]+/g)?.map(Number) ?? [];
    [red, green, blue] = [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
  }
  return `rgba(${red}, ${green}, ${blue}, ${Math.max(0, Math.min(1, alpha))})`;
}

/** Vinyl is black whatever the theme. */
const VINYL = '#141414';
const VINYL_SHEEN = '#5c5c5c';
/** How fast the sheen travels round the spinning record. */
const SPIN_STEP_MS = 90;
const DISC_WIDTH = 11;

/** Which pixel of the disc the sheen is on. Nobody can tell where it started. */
function spinStep(now: number): number {
  return Math.floor(now / SPIN_STEP_MS) % DISC_WIDTH;
}

function playerSignature(player: RecordPlayerState, now: number): string {
  if (!player.record) return '';
  const art = getRecordArt(player.record.imageUrl);
  return `${player.record.imageUrl}:${art?.status ?? ''}:${spinStep(now)}`;
}

/**
 * The record player: a low cabinet in the lounge's upholstery colours with a
 * turntable on top. While a record plays, the vinyl sits on the platter with
 * a sheen travelling across it, the tonearm is over the record, and the
 * sleeve is propped against the cabinet so you can see what is on.
 */
function drawRecordPlayer(
  context: CanvasRenderingContext2D,
  piece: FurniturePiece,
  player: RecordPlayerState,
  colours: ThemeColours,
  now: number
): void {
  const { x, width } = piece;
  const floorY = piece.y + piece.height;
  const cabinetTop = floorY - LOUNGE.playerCabinetHeight;
  const plinthTop = floorY - LOUNGE.playerHeight;
  context.save();
  context.fillStyle = colours.line;
  context.fillRect(x + 2, floorY - 2, 2, 2);
  context.fillRect(x + width - 4, floorY - 2, 2, 2);
  outlinedBox(context, x, cabinetTop, width, floorY - 2 - cabinetTop, colours.fabric, colours.line);
  // A drawer line across the cabinet front.
  context.fillStyle = colours.line;
  context.fillRect(x + 3, cabinetTop + 4, width - 6, 1);
  outlinedBox(context, x + 2, plinthTop, width - 4, cabinetTop - plinthTop + 1, colours.cushion, colours.line);

  const discX = x + 4;
  const discWidth = DISC_WIDTH;
  const armPivotX = x + width - 4;
  context.fillStyle = colours.line;
  context.fillRect(armPivotX, plinthTop - 2, 1, 2);
  if (player.record) {
    // The disc seen almost edge-on: a narrower top row reads as its far rim.
    context.fillStyle = VINYL;
    context.fillRect(discX + 1, plinthTop - 2, discWidth - 2, 1);
    context.fillRect(discX, plinthTop - 1, discWidth, 1);
    context.fillStyle = colours.pillow;
    context.fillRect(discX + 4, plinthTop - 2, 3, 1);
    context.fillStyle = VINYL_SHEEN;
    context.fillRect(discX + spinStep(now), plinthTop - 1, 1, 1);
    // Tonearm across to the record, its stylus down in the groove.
    context.fillStyle = colours.line;
    context.fillRect(discX + 8, plinthTop - 3, armPivotX - discX - 7, 1);
    context.fillRect(discX + 8, plinthTop - 2, 1, 1);
    // The sleeve leans against the cabinet's outer side, so you can see what
    // is on without it hiding the player.
    const art = getRecordArt(player.record.imageUrl);
    if (art?.status === 'ready' && art.sprite) {
      context.drawImage(art.sprite, x - RECORD_SIZE + 5, floorY - RECORD_SIZE, RECORD_SIZE, RECORD_SIZE);
    }
  } else {
    // An empty platter, and the tonearm parked at its rest.
    context.fillRect(discX, plinthTop - 1, discWidth, 1);
    context.fillRect(armPivotX - 3, plinthTop - 3, 4, 1);
  }
  context.restore();
}

function outlinedBox(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
  edge: string
): void {
  context.fillStyle = edge;
  context.fillRect(x, y, width, height);
  context.fillStyle = fill;
  context.fillRect(x + 1, y + 1, width - 2, height - 2);
}

/**
 * The frame and the opening, painted *behind* the people so someone standing
 * on the threshold is in the doorway rather than in front of it. The opening
 * is a translucent black: filled with the page colour it read as an empty
 * frame.
 */
function drawDoorwayFrame(
  context: CanvasRenderingContext2D,
  room: RoomLayout,
  opacity: number,
  colours: ThemeColours
): void {
  if (opacity <= 0) return;
  const rect = room.door;
  const alpha = clamp(opacity, 0, 1);
  context.save();
  context.globalAlpha = alpha;
  context.fillStyle = colours.muted;
  context.fillRect(rect.x, rect.y, rect.width, rect.height);
  context.globalAlpha = alpha * 0.62;
  context.fillStyle = '#000';
  context.fillRect(rect.x + 3, rect.y + 3, rect.width - 6, rect.height - 3);
  context.globalAlpha = alpha;
  context.fillStyle = colours.muted;
  context.fillRect(rect.x + 3, rect.y + 8, rect.width - 6, 1);
  context.restore();
}

/**
 * The door itself, swinging across the opening — painted *in front* of the
 * people, because that is what closing a door on someone looks like.
 */
function drawDoorwayDoor(
  context: CanvasRenderingContext2D,
  room: RoomLayout,
  opacity: number,
  shut: number,
  colours: ThemeColours
): void {
  if (opacity <= 0 || shut <= 0) return;
  const rect = room.door;
  const alpha = clamp(opacity, 0, 1);
  const closed = clamp(shut, 0, 1);
  const openingX = rect.x + 3;
  const openingY = rect.y + 3;
  const openingWidth = rect.width - 6;
  const openingHeight = rect.height - 3;
  const leafWidth = Math.max(1, Math.round(openingWidth * closed));

  context.save();
  // An opaque dark base under a translucent --muted slab: the leaf must hide
  // whoever is stepping through, but a solid --muted slab glares.
  context.globalAlpha = alpha;
  context.fillStyle = '#000';
  context.fillRect(openingX, openingY, leafWidth, openingHeight);
  context.globalAlpha = alpha * 0.72;
  context.fillStyle = colours.muted;
  context.fillRect(openingX, openingY, leafWidth, openingHeight);
  context.globalAlpha = alpha * 0.55;
  context.fillStyle = '#000';
  context.fillRect(openingX + leafWidth - 1, openingY, 1, openingHeight);
  if (closed > 0.65) {
    context.globalAlpha = alpha;
    context.fillStyle = colours.accent;
    context.fillRect(openingX + leafWidth - 5, openingY + Math.round(openingHeight / 2), 2, 3);
  }
  context.restore();
}

function drawDebug(context: CanvasRenderingContext2D, room: RoomLayout): void {
  context.save();
  context.lineWidth = 1;
  context.strokeStyle = 'rgba(126, 217, 87, 0.85)';
  for (const slot of room.shelf.slots) {
    context.strokeRect(slot.x + 0.5, slot.y + 0.5, RECORD_SIZE - 1, RECORD_SIZE - 1);
  }
  context.setLineDash([3, 3]);
  context.strokeStyle = 'rgba(229, 106, 170, 0.65)';
  context.strokeRect(room.door.x + 0.5, room.door.y + 0.5, room.door.width - 1, room.door.height - 1);
  context.restore();
}

/**
 * Rasterizes one frame at `step` device pixels per sprite pixel. Callers own
 * caching; `cachedFrame` is the room's path, the sprite explorer is the other.
 */
export function rasterizeFrame(
  frame: SpriteFrame,
  palette: Record<string, string>,
  outline: string,
  step: number
): HTMLCanvasElement {
  const surface = document.createElement('canvas');
  surface.width = frame.rows[0].length * step;
  surface.height = frame.rows.length * step;
  const context = surface.getContext('2d');
  if (context) drawFrame(context, frame, palette, outline, step);
  return surface;
}

function cachedFrame(
  frameKey: string,
  frame: SpriteFrame,
  palette: Record<string, string>,
  scale: number
): HTMLCanvasElement {
  const outline = themeOutline();
  const step = deviceStep(scale, clampedDpr());
  const key = spriteCacheKey(frameKey, outline, step);
  const cached = spriteCache.get(key);
  if (cached) return cached;
  const surface = rasterizeFrame(frame, palette, outline, step);
  spriteCache.set(key, surface);
  return surface;
}

function drawFrame(
  context: CanvasRenderingContext2D,
  frame: SpriteFrame,
  palette: Record<string, string>,
  outline: string,
  step: number
): void {
  let activeColor = '';
  for (let row = 0; row < frame.rows.length; row += 1) {
    for (let column = 0; column < frame.rows[row].length; column += 1) {
      const key = frame.rows[row][column];
      if (key === '.') continue;
      const color = palette[key] === '$outline' ? outline : palette[key];
      if (!color) continue;
      if (color !== activeColor) {
        activeColor = color;
        context.fillStyle = color;
      }
      context.fillRect(column * step, row * step, step, step);
    }
  }
}
