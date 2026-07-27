import { clientToDocument } from './geometry';
import { clamp, expandedRect } from './physics';
import { getRecordArt, RECORD_PIXELS, RECORD_SCALE } from './record-art';
import type { PixelPersonRuntime } from './simulation';
import { hitTestSpriteFrame, selectSpriteFrame } from './sprite';
import type {
  Collider,
  ItemSource,
  Occluder,
  PlacedRecord,
  Point,
  Rect,
  SpriteFrame,
  WorldGeometry
} from './types';

/** Set-down records stay at full opacity for the hold, then fade out. */
export const PLACED_RECORD_HOLD_MS = 120_000;
export const PLACED_RECORD_FADE_MS = 4_000;

/** When this record's fade begins: after its hold, or the moment it was dismissed. */
export function fadeStartAt(record: PlacedRecord): number {
  return Math.min(
    record.placedAt + PLACED_RECORD_HOLD_MS,
    record.dismissedAt ?? Number.POSITIVE_INFINITY
  );
}

/** The drawn art box: bottom-centered on the record's feet point. */
function placedRecordRect(record: PlacedRecord): Rect {
  const size = RECORD_PIXELS * RECORD_SCALE;
  return {
    x: record.position.x - size / 2,
    y: record.position.y - size,
    width: size,
    height: size
  };
}

const spriteCache = new Map<string, HTMLCanvasElement>();
let cachedTheme = '';
let cachedOutline = '#111';

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

// Browser zoom changes devicePixelRatio and innerWidth INVERSELY, so the
// physical pixel size alone cannot detect it — the applied dpr and CSS size
// are tracked explicitly or zoom leaves a stale transform and inline size.
let appliedDpr = 0;
let appliedCssWidth = 0;
let appliedCssHeight = 0;

/**
 * The device pixel ratio the canvas is transformed by, capped so a 3x display
 * does not triple the raster cost. Sprites rasterize against this same value —
 * if the two ever disagree, cached sprites are drawn at a different density
 * than the canvas expects, so both callers read it from here.
 */
function clampedDpr(): number {
  return Math.min(window.devicePixelRatio || 1, 2);
}

/** `appliedDpr` is 0 until sizeCanvas runs; fall back to the live ratio. */
function currentDpr(): number {
  return appliedDpr || clampedDpr();
}

export function sizeCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const context = canvas.getContext('2d');
  if (!context) return null;
  const dpr = clampedDpr();
  const pixelWidth = Math.round(window.innerWidth * dpr);
  const pixelHeight = Math.round(window.innerHeight * dpr);
  if (
    canvas.width !== pixelWidth ||
    canvas.height !== pixelHeight ||
    appliedDpr !== dpr ||
    appliedCssWidth !== window.innerWidth ||
    appliedCssHeight !== window.innerHeight
  ) {
    // Assigning width/height always resets the bitmap and canvas state, even
    // to the same value — only touch them when they actually changed.
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.imageSmoothingEnabled = false;
    appliedDpr = dpr;
    appliedCssWidth = window.innerWidth;
    appliedCssHeight = window.innerHeight;
  }
  return context;
}

let lastGeometry: WorldGeometry | null = null;
let geometryRevision = 0;
let lastRenderSignature = '';

/**
 * Everything drawn is a pure function of these inputs; when none of them
 * changed since the last frame the previous canvas contents are already
 * correct and the whole clear+draw (and its raster upload) can be skipped.
 * Continuous states (drag pendulum, record fade, debug overlay) fold `now`
 * into the signature, which forces a redraw every frame while they last.
 */
function renderSignature(
  canvas: HTMLCanvasElement,
  people: readonly PixelPersonRuntime[],
  geometry: WorldGeometry,
  now: number,
  debug: boolean,
  placedRecords: readonly PlacedRecord[]
): string {
  if (geometry !== lastGeometry) {
    lastGeometry = geometry;
    geometryRevision += 1;
  }
  let signature =
    `${canvas.width}:${canvas.height}:${window.devicePixelRatio}:${window.scrollX}` +
    `:${window.scrollY}:${geometryRevision}:${document.documentElement.dataset.theme ?? ''}`;
  if (debug) signature += `:${now}`;
  for (const record of placedRecords) {
    // Held records are static; only an active fade needs per-frame redraws.
    signature +=
      now >= fadeStartAt(record)
        ? `:${now}`
        : `:${record.id}:${getRecordArt(record.imageUrl)?.status ?? ''}`;
  }
  for (const person of people) {
    // Dragging (pendulum) and listening (floating notes) animate continuously.
    if (person.drag || person.activity === 'listen') {
      signature += `:${now}`;
      continue;
    }
    const frameIndex = selectSpriteFrame(
      person.definition,
      person.animation,
      person.animationStartedAt,
      now
    ).index;
    signature +=
      `|${person.id}:${person.definition.id}:${Math.round(person.body.x)}:${Math.round(person.body.y)}` +
      `:${person.body.height}:${person.facing}:${person.animation}:${frameIndex}` +
      `:${person.hiddenOccluderId ?? ''}`;
    if (person.carrying) {
      const art = getRecordArt(person.carrying.imageUrl);
      signature += `:${art?.status ?? ''}:${carriedRecordBob(person, now)}`;
    }
  }
  return signature;
}

export function renderPixelWorld(
  canvas: HTMLCanvasElement,
  people: readonly PixelPersonRuntime[],
  geometry: WorldGeometry,
  now: number,
  debug: boolean,
  placedRecords: readonly PlacedRecord[] = []
): void {
  const context = sizeCanvas(canvas);
  if (!context) return;
  const signature = renderSignature(canvas, people, geometry, now, debug, placedRecords);
  if (signature === lastRenderSignature) return;
  lastRenderSignature = signature;
  // Clear in device space: CSS-space clearing under-covers the last device
  // row/column when innerWidth * dpr rounds up (fractional-DPR ghosting).
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.restore();

  if (debug) {
    drawDebugGeometry(context, geometry.colliders, geometry.occluders, geometry.itemSources);
  }
  drawPlacedRecords(context, placedRecords, now);
  for (const person of people) {
    // While seated the record leans beside the listener, painted first so the
    // person always sits in front of it; in hand it paints over the sprite.
    const listening = person.activity === 'listen';
    if (listening) drawCarriedRecord(context, person, now);
    drawPerson(context, person, now);
    if (!listening) drawCarriedRecord(context, person, now);
    if (listening) drawListeningNotes(context, person, now);
    const occluder = hidingOccluder(person, geometry);
    if (occluder) clearOccludedPixels(context, person, occluder);
    if (debug && person.drag) drawDangleDebug(context, person);
  }
}

// A tiny eighth note, drawn at the sprite scale (each cell is 2x2 px).
const NOTE_GLYPH = ['..#.', '..##', '..#.', '..#.', '.##.', '###.'];
const NOTE_INTERVAL_MS = 650;
const NOTE_LIFE_MS = 1_900;

function drawListeningNotes(
  context: CanvasRenderingContext2D,
  person: PixelPersonRuntime,
  now: number
): void {
  if (!person.listen) return;
  const elapsed = now - person.listen.startedAt;
  const newest = Math.floor(elapsed / NOTE_INTERVAL_MS);
  const oldest = Math.max(0, Math.ceil((elapsed - NOTE_LIFE_MS) / NOTE_INTERVAL_MS));
  const headX = person.body.x + person.body.width / 2;
  const headY = person.body.y + 6;
  context.save();
  context.fillStyle = themeOutline();
  for (let index = oldest; index <= newest; index += 1) {
    const age = elapsed - index * NOTE_INTERVAL_MS;
    if (age < 0 || age >= NOTE_LIFE_MS) continue;
    const progress = age / NOTE_LIFE_MS;
    const side = index % 2 === 0 ? 1 : -1;
    const x = headX + side * (7 + progress * 9) + Math.sin(age / 260 + index) * 2;
    const y = headY - 6 - progress * 24;
    context.globalAlpha = progress < 0.75 ? 1 : 1 - (progress - 0.75) / 0.25;
    drawNoteGlyph(context, Math.round(x - window.scrollX), Math.round(y - window.scrollY));
  }
  context.restore();
}

function drawNoteGlyph(context: CanvasRenderingContext2D, x: number, y: number): void {
  for (let row = 0; row < NOTE_GLYPH.length; row += 1) {
    for (let column = 0; column < NOTE_GLYPH[row].length; column += 1) {
      if (NOTE_GLYPH[row][column] !== '#') continue;
      context.fillRect(x + column * 2, y + row * 2, 2, 2);
    }
  }
}

/**
 * The placed record (topmost first) under a document-space point, if any.
 * Records already fading are not clickable — they are on their way out.
 */
export function placedRecordHitTest(
  records: readonly PlacedRecord[],
  documentPoint: Point,
  now: number
): PlacedRecord | null {
  const slop = 3;
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];
    if (now >= fadeStartAt(record)) continue;
    if (pointInside(documentPoint, expandedRect(placedRecordRect(record), slop))) {
      return record;
    }
  }
  return null;
}

function drawPlacedRecords(
  context: CanvasRenderingContext2D,
  records: readonly PlacedRecord[],
  now: number
): void {
  if (records.length === 0) return;
  for (const record of records) {
    const art = getRecordArt(record.imageUrl);
    if (art?.status !== 'ready' || !art.sprite) continue;
    const progress = clamp((now - fadeStartAt(record)) / PLACED_RECORD_FADE_MS, 0, 1);
    if (progress >= 1) continue;
    const rect = placedRecordRect(record);
    context.save();
    context.globalAlpha = 1 - progress * progress * (3 - 2 * progress);
    context.drawImage(
      art.sprite,
      Math.round(rect.x - window.scrollX),
      Math.round(rect.y - window.scrollY)
    );
    context.restore();
  }
}

function carriedRecordBob(person: PixelPersonRuntime, now: number): number {
  return person.animation === 'walk' ? Math.round(Math.sin(now / 220)) : 0;
}

function drawCarriedRecord(
  context: CanvasRenderingContext2D,
  person: PixelPersonRuntime,
  now: number
): void {
  if (!person.carrying || person.drag) return;
  const art = getRecordArt(person.carrying.imageUrl);
  if (art?.status !== 'ready' || !art.sprite) return;
  const size = RECORD_PIXELS * RECORD_SCALE;
  // Drawn outside the facing-flip transform so the album art never mirrors;
  // held in front of the body with a slight hand overlap and a walk bob.
  // While listening it rests on the ground, leaning against the sitter's
  // side (and is painted behind them by the render order above).
  const listening = person.activity === 'listen';
  const bob = listening ? 0 : carriedRecordBob(person, now);
  const x = listening
    ? person.facing === 1
      ? person.body.x + person.body.width - 6
      : person.body.x - size + 6
    : person.facing === 1
      ? person.body.x + person.body.width - 4
      : person.body.x - size + 4;
  const y = listening
    ? person.body.y + person.body.height - size
    : person.body.y + person.body.height - size - 4 + bob;
  context.drawImage(
    art.sprite,
    Math.round(x - window.scrollX),
    Math.round(y - window.scrollY)
  );
}

function hidingOccluder(
  person: PixelPersonRuntime,
  geometry: WorldGeometry
): Occluder | undefined {
  if (!person.hiddenOccluderId) return undefined;
  return geometry.occluders.find((candidate) => candidate.id === person.hiddenOccluderId);
}

export function isPointOnPixelPerson(
  person: PixelPersonRuntime,
  screenPoint: Point,
  geometry: WorldGeometry,
  now: number
): boolean {
  if (person.drag) return false;
  const definition = person.definition;
  const documentPoint = clientToDocument(screenPoint);

  const hitSlop = 2;
  const spriteX = person.body.x - definition.body.offsetX;
  const spriteY = spriteDocumentY(person);
  if (
    documentPoint.x < spriteX - hitSlop ||
    documentPoint.x > spriteX + definition.pixelWidth * definition.scale + hitSlop ||
    documentPoint.y < spriteY - hitSlop ||
    documentPoint.y > spriteY + definition.pixelHeight * definition.scale + hitSlop
  ) {
    return false;
  }

  const occluder = hidingOccluder(person, geometry);
  if (occluder && pointInside(documentPoint, occluder)) return false;

  const { frame } = selectSpriteFrame(
    definition,
    person.animation,
    person.animationStartedAt,
    now
  );
  return hitTestSpriteFrame(
    frame,
    definition.scale,
    person.facing,
    documentPoint.x - spriteX,
    documentPoint.y - spriteY
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
    now
  );
  const spriteX = Math.round(person.body.x - definition.body.offsetX - window.scrollX);
  const spriteY = Math.round(spriteDocumentY(person) - window.scrollY);
  const spriteWidth = definition.pixelWidth * definition.scale;
  const spriteHeight = definition.pixelHeight * definition.scale;
  const sprite = cachedFrame(
    `${definition.id}:${person.animation}:${frameIndex}`,
    frame,
    definition.palette,
    definition.scale
  );

  context.save();
  if (person.drag) {
    const gripX = definition.dragGrip.x * definition.scale;
    const gripY = definition.dragGrip.y * definition.scale;
    context.translate(
      Math.round(person.drag.anchor.x - window.scrollX),
      Math.round(person.drag.anchor.y - window.scrollY)
    );
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

function drawDangleDebug(
  context: CanvasRenderingContext2D,
  person: PixelPersonRuntime
): void {
  if (!person.drag) return;
  context.save();
  context.strokeStyle = 'rgba(229, 106, 170, 0.8)';
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(
    person.drag.anchor.x - window.scrollX,
    person.drag.anchor.y - window.scrollY
  );
  context.lineTo(
    person.body.x + person.body.width / 2 - window.scrollX,
    person.body.y + person.body.height / 2 - window.scrollY
  );
  context.stroke();
  context.restore();
}

/**
 * Rasterizes one frame at `step` device pixels per sprite pixel. Callers own
 * caching; `cachedFrame` is the game path, the sprite explorer is the other.
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
  if (context) drawFrame(context, frame, palette, outline, 0, 0, step);
  return surface;
}

function cachedFrame(
  frameKey: string,
  frame: SpriteFrame,
  palette: Record<string, string>,
  scale: number
): HTMLCanvasElement {
  const outline = themeOutline();
  const step = deviceStep(scale, currentDpr());
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
  x: number,
  y: number,
  scale: number
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
      context.fillRect(x + column * scale, y + row * scale, scale, scale);
    }
  }
}

export function themeOutline(): string {
  const theme = document.documentElement.dataset.theme ?? 'light';
  if (theme !== cachedTheme) {
    cachedTheme = theme;
    cachedOutline =
      getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#111';
  }
  return cachedOutline;
}

function clearOccludedPixels(
  context: CanvasRenderingContext2D,
  person: PixelPersonRuntime,
  occluder: Occluder
): void {
  const definition = person.definition;
  const sprite = {
    x: person.body.x - definition.body.offsetX,
    y: spriteDocumentY(person),
    width: definition.pixelWidth * definition.scale,
    height: definition.pixelHeight * definition.scale
  };
  const left = Math.max(sprite.x, occluder.x);
  const top = Math.max(sprite.y, occluder.y);
  const right = Math.min(sprite.x + sprite.width, occluder.x + occluder.width);
  const bottom = Math.min(sprite.y + sprite.height, occluder.y + occluder.height);
  if (right <= left || bottom <= top) return;
  context.clearRect(
    Math.floor(left - window.scrollX),
    Math.floor(top - window.scrollY),
    Math.ceil(right - left),
    Math.ceil(bottom - top)
  );
}

function spriteDocumentY(person: PixelPersonRuntime): number {
  const definition = person.definition;
  return (
    person.body.y -
    definition.body.offsetY -
    (definition.body.height - person.body.height)
  );
}

function pointInside(point: Point, rect: Rect): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

function drawDebugGeometry(
  context: CanvasRenderingContext2D,
  colliders: Collider[],
  occluders: Occluder[],
  itemSources: ItemSource[]
): void {
  context.save();
  context.lineWidth = 1;
  for (const collider of colliders) {
    context.strokeStyle = debugColor(collider.kind);
    context.strokeRect(
      Math.round(collider.x - window.scrollX) + 0.5,
      Math.round(collider.y - window.scrollY) + 0.5,
      Math.round(collider.width),
      Math.round(collider.height)
    );
  }
  context.setLineDash([3, 3]);
  context.strokeStyle = 'rgba(229, 106, 170, 0.65)';
  for (const occluder of occluders) {
    context.strokeRect(
      Math.round(occluder.x - window.scrollX) + 0.5,
      Math.round(occluder.y - window.scrollY) + 0.5,
      Math.round(occluder.width),
      Math.round(occluder.height)
    );
  }
  context.setLineDash([1, 2]);
  context.strokeStyle = 'rgba(126, 217, 87, 0.85)';
  for (const source of itemSources) {
    context.strokeRect(
      Math.round(source.x - window.scrollX) + 1.5,
      Math.round(source.y - window.scrollY) + 1.5,
      Math.round(source.width) - 2,
      Math.round(source.height) - 2
    );
  }
  context.restore();
}

function debugColor(kind: Collider['kind']): string {
  if (kind === 'text') return 'rgba(75, 167, 200, 0.75)';
  if (kind === 'border' || kind === 'platform') return 'rgba(230, 195, 132, 0.8)';
  if (kind === 'solid') return 'rgba(228, 104, 118, 0.75)';
  if (kind === 'ladder') return 'rgba(126, 217, 87, 0.6)';
  return 'rgba(220, 215, 186, 0.5)';
}
