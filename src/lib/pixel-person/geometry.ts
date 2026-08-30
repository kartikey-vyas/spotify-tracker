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

/**
 * The top of the ground people stand on at the bottom of the viewport.
 *
 * Exported because anything drawn as standing on that ground (the doorway)
 * has to agree with it to the pixel; deriving it separately leaves furniture
 * hovering just above the floor its occupants walk on.
 */
export function viewportFloorY(viewportBounds: Rect): number {
  return viewportBounds.y + viewportBounds.height - MIN_BORDER_THICKNESS;
}
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
// The promenade is authored, not inferred. Before this contract the scanner
// turned buttons, images, SVGs, borders and even individual words into level
// geometry. That made an ordinary dashboard behave like a restless platform
// game. Content may still opt into a semantic role (record/artist/occluder),
// but only these explicit attributes create physical terrain.
const SOLID_SELECTOR = '[data-pixel-collision="solid"]';
const OCCLUDER_SELECTOR = '[data-pixel-collision="occluder"]';
const PROMENADE_SELECTOR = '[data-pixel-promenade="rail"]';

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

/** Builds the physical walking plane from an authored clear-air rail band. */
export function promenadeCollider(rect: Rect, id: string, groupId?: string): Collider {
  return {
    x: rect.x,
    y: rect.y + rect.height - MIN_BORDER_THICKNESS,
    width: rect.width,
    height: MIN_BORDER_THICKNESS,
    id,
    groupId,
    edge: 'top',
    kind: 'platform'
  };
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
    const isPromenade = element.matches(PROMENADE_SELECTOR);
    // Promenade bands are decorative and correctly aria-hidden, but they are
    // still deliberately authored geometry. All ordinary aria-hidden content
    // remains excluded from semantic and collision scans.
    if (isIgnored(element) || !isVisible(element, style, isPromenade)) continue;

    const override = element.getAttribute('data-pixel-collision');
    const groupId = stableId(element, 'element');
    const isSolid = override === 'solid' || element.matches(SOLID_SELECTOR);

    if (isPromenade) {
      // The rail component owns a band of clear air; its bottom edge is the
      // visible hairline and therefore the plane the person's feet meet.
      colliders.push(promenadeCollider(rect, `${groupId}:promenade`, groupId));
    } else if (isSolid) {
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

  colliders.push(...bridgeWalkableTops(colliders));

  const floorY = viewportFloorY(viewportBounds);
  colliders.push({
    x: scanBounds.x,
    y: floorY,
    width: scanBounds.width,
    height: Math.max(40, scanBounds.y + scanBounds.height - floorY + 40),
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
    Math.abs(documentFloorY - floorY) > 4 &&
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

/**
 * Picks a surface with body clearance to stand on. `near` overrides the usual
 * band-and-centre heuristic with "closest to this page point", which is what a
 * click-to-spawn wants: land on the thing that was clicked, not in the spot the
 * ambient spawner would have chosen.
 */
export function findSafeSpawn(
  geometry: WorldGeometry,
  character: CharacterDefinition,
  slot = 0,
  near?: Point
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
      const score = ({ support, x }: { support: Collider; x: number }): number =>
        near
          ? Math.hypot(x + width / 2 - near.x, support.y - near.y)
          : spawnScore(support, x, idealY, viewportCenterX) -
            itemSourceBonus(geometry, x, width, support.y);
      return score(left) - score(right);
    });

  // A `near` spawn wants the closest candidate, not one of the slot's rotation.
  const selected =
    candidates.length === 0
      ? null
      : candidates[near ? 0 : Math.abs(slot) % candidates.length];
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
  const kindPenalty = support.id.endsWith(':promenade')
    ? -20
    : support.kind === 'platform'
      ? 0
      : support.kind === 'border'
        ? 12
        : support.kind === 'text'
          ? 24
          : 36;
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

function isIgnored(element: Element): boolean {
  return Boolean(element.closest('[data-pixel-collision="ignore"], [data-pixel-world]'));
}

function isVisible(
  element: Element,
  style = getComputedStyle(element),
  allowAriaHidden = false
): element is HTMLElement {
  if (!(element instanceof HTMLElement) && !(element instanceof SVGElement)) return false;
  if (
    element.hasAttribute('hidden') ||
    (!allowAriaHidden && element.getAttribute('aria-hidden') === 'true')
  ) {
    return false;
  }
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
