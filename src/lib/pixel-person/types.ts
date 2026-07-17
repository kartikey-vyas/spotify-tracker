export type AnimationName =
  | 'idle'
  | 'walk'
  | 'jump'
  | 'fall'
  | 'crawl'
  | 'climb'
  | 'mantle'
  | 'hide'
  | 'dangle'
  | 'listen';

export type Facing = -1 | 1;

export interface Point {
  x: number;
  y: number;
}

export interface Rect extends Point {
  width: number;
  height: number;
}

/** 'ladder' colliders never block movement; they are climbable zones. */
export type ColliderKind = 'text' | 'border' | 'solid' | 'platform' | 'floor' | 'ladder';

export interface Collider extends Rect {
  id: string;
  kind: ColliderKind;
  groupId?: string;
  edge?: 'top' | 'right' | 'bottom' | 'left';
}

export interface Occluder extends Rect {
  id: string;
  groupId?: string;
}

/** A page element pixel people can interact with (extensible beyond records). */
export type ItemSourceKind = 'record';

export interface ItemSource extends Rect {
  id: string;
  kind: ItemSourceKind;
  imageUrl: string;
}

export interface WorldGeometry {
  colliders: Collider[];
  occluders: Occluder[];
  itemSources: ItemSource[];
  scanBounds: Rect;
  viewportBounds: Rect;
}

/** A record released by a person; position is the feet point it lands on. */
export interface DroppedRecord {
  sourceId: string;
  imageUrl: string;
  position: Point;
}

/** Events the DOM-free simulation emits for the world owner to act on. */
export type PixelWorldEvent = {
  type: 'record-dropped';
  personId: string;
  record: DroppedRecord;
};

/** A set-down record living in the world until its fade-out completes. */
export interface PlacedRecord {
  id: number;
  imageUrl: string;
  position: Point;
  placedAt: number;
  /** Set when the user clicks the record; starts its fade immediately. */
  dismissedAt?: number;
}

export interface SpriteFrame {
  rows: string[];
}

export interface SpriteAnimation {
  frames: SpriteFrame[];
  frameDurationMs: number;
  loop: boolean;
}

export interface CharacterDefinition {
  id: string;
  pixelWidth: number;
  pixelHeight: number;
  scale: number;
  dragGrip: Point;
  palette: Record<string, string>;
  body: {
    offsetX: number;
    offsetY: number;
    width: number;
    height: number;
  };
  animations: Record<AnimationName, SpriteAnimation>;
}

export interface PhysicsBody extends Rect {
  vx: number;
  vy: number;
  grounded: boolean;
  supportId: string | null;
}

export interface PhysicsContacts {
  left: Collider | null;
  right: Collider | null;
  ground: Collider | null;
  ceiling: Collider | null;
}

export interface PhysicsInput {
  moveX: -1 | 0 | 1;
  jump: boolean;
}

export interface PhysicsStep {
  body: PhysicsBody;
  contacts: PhysicsContacts;
}

export interface PhysicsConfig {
  gravity: number;
  maxFallSpeed: number;
  walkSpeed: number;
  groundAcceleration: number;
  airAcceleration: number;
  groundFriction: number;
  jumpSpeed: number;
}

export type PixelPersonCommand =
  | { type: 'summon' }
  | { type: 'spawn'; position: Point; characterId?: string }
  | { type: 'move'; position: Point }
  | { type: 'flee'; position: Point }
  | { type: 'despawn'; id: string };
