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
  | 'listen'
  /** Sunk into a lounge seat, feet on the floor. */
  | 'lounge'
  /** One arm up to the lamp's shade, then a small pull down to switch it. */
  | 'reach';

export type Facing = -1 | 1;

export interface Point {
  x: number;
  y: number;
}

export interface Rect extends Point {
  width: number;
  height: number;
}

/** The room's walls, floor and ceiling. Nothing on the page is terrain. */
export interface Collider extends Rect {
  id: string;
}

/** An artist represented somewhere on the page — a list row, a cover tile. */
export interface ArtistPresence {
  name: string;
  /** 1-based position in whatever ranking rendered it; absent when unranked. */
  rank?: number;
}

/** An album a person can take off the shelf or out of a pocket. */
export interface RoomRecord {
  imageUrl: string;
  /** Display name of the album's artist, when the page declared one. */
  artistName?: string;
}

export interface SpriteFrame {
  rows: string[];
}

export interface SpriteAnimation {
  frames: SpriteFrame[];
  frameDurationMs: number;
  loop: boolean;
}

/**
 * Where a character's frame declarations live in source, for the dev-only
 * sprite editor. Characters that share frames share this, which is how the
 * editor can warn that an edit reaches more than the character on screen.
 */
export interface FrameSource {
  /** Repo-relative file holding the declarations. */
  file: string;
  /** `<animation>:<frameIndex>` -> the frame's source identifier. */
  names: Readonly<Record<string, string>>;
  /** False only when a character intentionally opts out of local paint editing. */
  editable?: boolean;
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
  frameSource: FrameSource;
  /** Normalised artist name for artist characters; drives record affinity. */
  artistKey?: string;
}

export interface PhysicsBody extends Rect {
  vx: number;
  vy: number;
  grounded: boolean;
}

export interface PhysicsInput {
  moveX: -1 | 0 | 1;
}

export interface PhysicsConfig {
  gravity: number;
  maxFallSpeed: number;
  walkSpeed: number;
  groundAcceleration: number;
  airAcceleration: number;
  groundFriction: number;
}

export type PixelPersonCommand = { type: 'summon' } | { type: 'spawn'; characterId: string };
