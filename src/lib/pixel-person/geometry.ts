import { parseArtistPresence } from './artist-presence';
import { hasBodyClearance, intersects } from './physics';
import type {
  CharacterDefinition,
  Collider,
  PhysicsBody,
  Point,
  Rect,
  WorldGeometry
} from './types';

const SCAN_PADDING_X = 360;
const SCAN_PADDING_Y = 280;
const MIN_BORDER_THICKNESS = 2;
// Walkable-top bridging: adjacent surfaces whose tops align within the
// tolerance and sit closer than a body width apart get one continuous strip,
// so grids of tiles (e.g. the album cover wall) read as walkable floor
// instead of a sequence of micro-steps and impassable gaps.
const BRIDGE_TOP_TOLERANCE = 3;
const BRIDGE_MAX_GAP = 18;
const BRIDGE_MIN_SEGMENT_WIDTH = 24;
// A gap is only bridged when it is small relative to its neighbors — grid
// tiles qualify, but two unrelated buttons that happen to share a top line
// must not gain a load-bearing strip across the void between them.
const BRIDGE_MAX_GAP_RATIO = 0.4;
// Spawn spread: a single ideal height funnels the whole population onto one
// shelf, so the ideal band cycles per slot and gets a little jitter so repeat
// spawns on the same slot do not stack on identical spots. Slot 0 stays at
// the historical 0.62 band.
const SPAWN_BAND_FACTORS = [0.62, 0.42, 0.75, 0.5, 0.68, 0.35];
const SPAWN_BAND_JITTER = 0.05;
const SOLID_SELECTOR = [
  'button',
  'input',
  'select',
  'textarea',
  'img',
  'canvas',
  'svg',
  '[data-pixel-collision="solid"]'
].join(',');
const OCCLUDER_SELECTOR = [
  '.panel',
  '.card',
  '.toolbar',
  'button',
  'input',
  'select',
  'textarea',
  'img',
  'canvas',
  'svg',
  '[data-pixel-collision="occluder"]'
].join(',');

let nextGeometryId = 1;
const elementIds = new WeakMap<Element, string>();
const textIds = new WeakMap<Node, string>();

function stableId(target: Element | Node, prefix: 'element' | 'text'): string {
  const map = prefix === 'element' ? elementIds : textIds;
  const existing = map.get(target as Element & Node);
  if (existing) return existing;
  const id = `${prefix}-${nextGeometryId++}`;
  map.set(target as Element & Node, id);
  return id;
}

export function clientToDocument(point: Point): Point {
  return { x: point.x + window.scrollX, y: point.y + window.scrollY };
}

function currentViewportBounds(): Rect {
  return {
    x: window.scrollX,
    y: window.scrollY,
    width: window.innerWidth,
    height: window.innerHeight
  };
}

export function collectWorldGeometry(root: HTMLElement): WorldGeometry {
  const viewportBounds = currentViewportBounds();
  const scanBounds: Rect = {
    x: viewportBounds.x - SCAN_PADDING_X,
    y: viewportBounds.y - SCAN_PADDING_Y,
    width: viewportBounds.width + SCAN_PADDING_X * 2,
    height: viewportBounds.height + SCAN_PADDING_Y * 2
  };
  const colliders: Collider[] = [];
  const occluders: WorldGeometry['occluders'] = [];
  const itemSources: WorldGeometry['itemSources'] = [];
  const artistPresences: WorldGeometry['artistPresences'] = [];
  const elements = [root, ...root.querySelectorAll<HTMLElement>('*')];

  for (const element of elements) {
    const rect = fromClientRect(element.getBoundingClientRect());
    if (!usableRect(rect) || !intersects(rect, scanBounds)) continue;
    const style = getComputedStyle(element);
    if (isIgnored(element) || !isVisible(element, style)) continue;

    const override = element.getAttribute('data-pixel-collision');
    const groupId = stableId(element, 'element');
    const isSolid = override === 'solid' || (override !== 'platform' && element.matches(SOLID_SELECTOR));

    if (isSolid) {
      colliders.push({ ...rect, id: `${groupId}:solid`, groupId, kind: 'solid' });
    } else if (override === 'ladder') {
      colliders.push({ ...rect, id: `${groupId}:ladder`, groupId, kind: 'ladder' });
    } else if (override === 'platform') {
      colliders.push({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: MIN_BORDER_THICKNESS,
        id: `${groupId}:platform`,
        groupId,
        edge: 'top',
        kind: 'platform'
      });
    } else {
      addBorderColliders(style, rect, groupId, colliders);
    }

    if (override === 'occluder' || element.matches(OCCLUDER_SELECTOR)) {
      occluders.push({ ...rect, id: `${groupId}:occluder`, groupId });
    }

    const presence = parseArtistPresence(
      rect,
      groupId,
      element.getAttribute('data-pixel-artist'),
      element.getAttribute('data-pixel-artist-rank')
    );
    if (presence) artistPresences.push(presence);

    const recordUrl = element.getAttribute('data-pixel-record');
    if (recordUrl) {
      itemSources.push({
        ...rect,
        id: groupId,
        kind: 'record',
        imageUrl: recordUrl,
        artistName: presence?.name
      });
    }
  }

  addTextColliders(root, scanBounds, colliders);
  colliders.push(...bridgeWalkableTops(colliders));

  const viewportFloorY = viewportBounds.y + viewportBounds.height - MIN_BORDER_THICKNESS;
  colliders.push({
    x: scanBounds.x,
    y: viewportFloorY,
    width: scanBounds.width,
    height: Math.max(40, scanBounds.y + scanBounds.height - viewportFloorY + 40),
    id: 'viewport-floor',
    kind: 'floor',
    edge: 'top'
  });

  const documentFloorY = Math.max(
    document.documentElement.scrollHeight,
    document.body.scrollHeight,
    viewportBounds.y + viewportBounds.height
  );
  if (
    Math.abs(documentFloorY - viewportFloorY) > 4 &&
    documentFloorY < scanBounds.y + scanBounds.height
  ) {
    colliders.push({
      x: scanBounds.x,
      y: documentFloorY - MIN_BORDER_THICKNESS,
      width: scanBounds.width,
      height: 40,
      id: 'document-floor',
      kind: 'floor',
      edge: 'top'
    });
  }

  return { colliders, occluders, itemSources, artistPresences, scanBounds, viewportBounds };
}

/**
 * Emits synthetic platform strips over runs of walkable tops (top-edge and
 * solid colliders) that align within BRIDGE_TOP_TOLERANCE and sit at most
 * BRIDGE_MAX_GAP apart. Originals are kept — strips only add support, so
 * climb/hide logic keeps referencing the real elements. Exported for tests.
 */
export function bridgeWalkableTops(colliders: Collider[]): Collider[] {
  const segments = colliders
    .filter(
      (collider) =>
        collider.width >= BRIDGE_MIN_SEGMENT_WIDTH &&
        (collider.edge === 'top' || collider.kind === 'solid')
    )
    .sort((left, right) => left.y - right.y);

  const bridges: Collider[] = [];
  let bridgeCount = 0;
  let row: Collider[] = [];
  let rowTopY = 0;

  const flushRow = (): void => {
    if (row.length < 2) return;
    row.sort((left, right) => left.x - right.x);
    let start = row[0];
    let spanRight = start.x + start.width;
    let spanMinY = start.y;
    let spanCount = 1;
    const flushSpan = (): void => {
      if (spanCount >= 2) {
        bridges.push({
          x: start.x,
          y: spanMinY,
          width: spanRight - start.x,
          height: MIN_BORDER_THICKNESS,
          id: `bridge-${++bridgeCount}`,
          edge: 'top',
          kind: 'platform'
        });
      }
    };
    let previousSegment = start;
    for (let index = 1; index < row.length; index += 1) {
      const segment = row[index];
      const gap = segment.x - spanRight;
      const bridgeable =
        gap <= BRIDGE_MAX_GAP &&
        gap <= Math.min(previousSegment.width, segment.width) * BRIDGE_MAX_GAP_RATIO;
      if (bridgeable) {
        spanRight = Math.max(spanRight, segment.x + segment.width);
        spanMinY = Math.min(spanMinY, segment.y);
        spanCount += 1;
        previousSegment = segment;
      } else {
        flushSpan();
        start = segment;
        previousSegment = segment;
        spanRight = segment.x + segment.width;
        spanMinY = segment.y;
        spanCount = 1;
      }
    }
    flushSpan();
  };

  for (const segment of segments) {
    if (row.length > 0 && segment.y - rowTopY <= BRIDGE_TOP_TOLERANCE) {
      row.push(segment);
    } else {
      flushRow();
      row = [segment];
      rowTopY = segment.y;
    }
  }
  flushRow();

  return bridges;
}

export function findSafeSpawn(
  geometry: WorldGeometry,
  character: CharacterDefinition,
  slot = 0
): PhysicsBody {
  const { width, height } = character.body;
  const viewport = geometry.viewportBounds;
  const viewportTop = viewport.y + 54;
  const viewportBottom = viewport.y + viewport.height - 4;
  const idealBandFactor = SPAWN_BAND_FACTORS[Math.abs(slot) % SPAWN_BAND_FACTORS.length];
  const idealBandJitter = (Math.random() * 2 - 1) * SPAWN_BAND_JITTER;
  const idealY = viewport.y + viewport.height * (idealBandFactor + idealBandJitter);
  const viewportCenterX = viewport.x + viewport.width / 2;
  const candidates = geometry.colliders
    .filter(
      (collider) =>
        collider.kind !== 'floor' &&
        collider.width >= width + 10 &&
        collider.y >= viewportTop + height &&
        collider.y <= viewportBottom
    )
    .flatMap((support) => {
      const inset = Math.min(10, Math.max(3, support.width * 0.08));
      const positions = [
        support.x + inset,
        support.x + support.width / 2 - width / 2,
        support.x + support.width - width - inset
      ];
      return positions.map((x) => ({ support, x }));
    })
    .filter(({ support, x }) => {
      const body = { x, y: support.y - height, width, height };
      return hasBodyClearance(body, geometry.colliders, support.id);
    })
    .sort((left, right) => {
      const leftScore =
        spawnScore(left.support, left.x, idealY, viewportCenterX) -
        itemSourceBonus(geometry, left.x, width, left.support.y);
      const rightScore =
        spawnScore(right.support, right.x, idealY, viewportCenterX) -
        itemSourceBonus(geometry, right.x, width, right.support.y);
      return leftScore - rightScore;
    });

  const selected = candidates.length > 0 ? candidates[Math.abs(slot) % candidates.length] : null;
  if (selected) {
    return {
      x: selected.x,
      y: selected.support.y - height,
      width,
      height,
      vx: 0,
      vy: 0,
      grounded: true,
      supportId: selected.support.id
    };
  }

  const floor = geometry.colliders.find((collider) => collider.id === 'viewport-floor');
  const floorY = floor?.y ?? viewportBottom;
  return {
    x:
      viewport.x +
      Math.min(
        viewport.width - width - 8,
        Math.max(24, viewport.width * 0.16 + Math.abs(slot) * (width + 12))
      ),
    y: floorY - height,
    width,
    height,
    vx: 0,
    vy: 0,
    grounded: true,
    supportId: floor?.id ?? null
  };
}

function spawnScore(
  support: Collider,
  x: number,
  idealY: number,
  viewportCenterX: number
): number {
  const kindPenalty = support.kind === 'border' ? 0 : support.kind === 'text' ? 18 : 30;
  const widthBonus = Math.min(support.width, 260) * 0.12;
  const centerPenalty = Math.abs(x + support.width / 2 - viewportCenterX) * 0.02;
  return Math.abs(support.y - idealY) + kindPenalty + centerPenalty - widthBonus;
}

// Mild preference for spawning near interactable items (e.g. the cover wall),
// so record pick-ups are findable without turning the wall into a magnet.
function itemSourceBonus(
  geometry: WorldGeometry,
  x: number,
  width: number,
  supportY: number
): number {
  for (const source of geometry.itemSources) {
    if (
      x + width > source.x - 40 &&
      x < source.x + source.width + 40 &&
      Math.abs(source.y - supportY) <= 160
    ) {
      return 25;
    }
  }
  return 0;
}

function addBorderColliders(
  style: CSSStyleDeclaration,
  rect: Rect,
  groupId: string,
  colliders: Collider[]
): void {
  const edges = [
    { edge: 'top' as const, width: rect.width, height: borderSize(style.borderTopWidth, style.borderTopStyle), x: rect.x, y: rect.y },
    { edge: 'right' as const, width: borderSize(style.borderRightWidth, style.borderRightStyle), height: rect.height, x: rect.x + rect.width, y: rect.y },
    { edge: 'bottom' as const, width: rect.width, height: borderSize(style.borderBottomWidth, style.borderBottomStyle), x: rect.x, y: rect.y + rect.height },
    { edge: 'left' as const, width: borderSize(style.borderLeftWidth, style.borderLeftStyle), height: rect.height, x: rect.x, y: rect.y }
  ];

  for (const edge of edges) {
    if (edge.width <= 0 || edge.height <= 0) continue;
    const x = edge.edge === 'right' ? edge.x - edge.width : edge.x;
    const y = edge.edge === 'bottom' ? edge.y - edge.height : edge.y;
    colliders.push({
      x,
      y,
      width: edge.width,
      height: edge.height,
      id: `${groupId}:border-${edge.edge}`,
      groupId,
      edge: edge.edge,
      kind: 'border'
    });
  }
}

function addTextColliders(root: HTMLElement, scanBounds: Rect, colliders: Collider[]): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  const parentEligibility = new Map<Element, boolean>();
  const isEligibleParent = (parent: Element): boolean => {
    let eligible = parentEligibility.get(parent);
    if (eligible === undefined) {
      eligible =
        !isIgnored(parent) &&
        isVisible(parent) &&
        !parent.closest(SOLID_SELECTOR) &&
        !parent.closest('[aria-hidden="true"]');
      parentEligibility.set(parent, eligible);
    }
    return eligible;
  };
  let current = walker.nextNode();

  while (current) {
    const parent = current.parentElement;
    const value = current.nodeValue ?? '';
    if (
      parent &&
      intersects(fromClientRect(parent.getBoundingClientRect()), scanBounds) &&
      isEligibleParent(parent)
    ) {
      const id = stableId(current, 'text');
      for (const match of value.matchAll(/\S+/g)) {
        const start = match.index ?? 0;
        range.setStart(current, start);
        range.setEnd(current, start + match[0].length);
        let rectIndex = 0;
        for (const clientRect of range.getClientRects()) {
          const rect = fromClientRect(clientRect);
          if (usableRect(rect) && intersects(rect, scanBounds)) {
            colliders.push({
              ...rect,
              id: `${id}:word-${start}-${rectIndex++}`,
              kind: 'text'
            });
          }
        }
      }
    }
    current = walker.nextNode();
  }

  range.detach();
}

function borderSize(width: string, style: string): number {
  if (style === 'none' || style === 'hidden') return 0;
  const numeric = Number.parseFloat(width);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.max(MIN_BORDER_THICKNESS, numeric);
}

function isIgnored(element: Element): boolean {
  return Boolean(element.closest('[data-pixel-collision="ignore"], [data-pixel-world]'));
}

function isVisible(
  element: Element,
  style = getComputedStyle(element)
): element is HTMLElement {
  if (!(element instanceof HTMLElement) && !(element instanceof SVGElement)) return false;
  if (element.hasAttribute('hidden') || element.getAttribute('aria-hidden') === 'true') return false;
  const closedDetails = element.closest('details:not([open])');
  if (closedDetails && closedDetails !== element) return false;
  // Opacity does not inherit, so an element inside an `opacity: 0` ancestor
  // (hover-revealed captions etc.) still computes its own opacity as 1; the
  // option flags make checkVisibility account for ancestors. Browsers that
  // ignore the options fall back to today's behavior.
  if (
    typeof element.checkVisibility === 'function' &&
    !element.checkVisibility({
      checkOpacity: true,
      checkVisibilityCSS: true,
      opacityProperty: true,
      visibilityProperty: true
    })
  ) {
    return false;
  }
  return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0;
}

function fromClientRect(rect: DOMRect | DOMRectReadOnly): Rect {
  return {
    ...clientToDocument({ x: rect.left, y: rect.top }),
    width: rect.width,
    height: rect.height
  };
}

function usableRect(rect: Rect): boolean {
  return rect.width >= 1 && rect.height >= 1;
}
