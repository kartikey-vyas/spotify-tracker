import type { CharacterDefinition, Facing, SpriteFrame } from './types';

export interface SelectedSpriteFrame {
  frame: SpriteFrame;
  index: number;
}

/**
 * The walk cadence baked into every character's `frameDurationMs` was tuned
 * against this top speed. Walking slower than it without stretching the cycle
 * reads as skating, so the scale below restores the relationship.
 */
export const REFERENCE_WALK_SPEED = 42;

/**
 * How much to stretch a frame's duration so the legs match the feet. Only the
 * walk cycle is speed-coupled; everything else runs at its authored cadence.
 *
 * Takes plain values rather than a runtime so it stays unit-testable under the
 * node-only vitest environment.
 */
export function spriteTimeScale(animationName: string, horizontalSpeed: number): number {
  if (animationName !== 'walk') return 1;
  // Below the floor the scale would explode as speed approaches zero; walking
  // that slowly is a stop in progress, and the idle animation takes over.
  const speed = Math.max(Math.abs(horizontalSpeed), 10);
  return Math.min(REFERENCE_WALK_SPEED / speed, 2.4);
}

/** How long a person takes to rise into place after appearing. */
export const SPAWN_REVEAL_MS = 420;

/**
 * How far through their entrance a person is, 0 to 1.
 *
 * People used to blink into existence, which was easy to miss and read as a
 * glitch when it happened near the reader. The renderer clips to the sprite's
 * final box and draws it offset downward by the remaining fraction, so they
 * rise up into place out of whatever they are standing on.
 *
 * Eased out, so the motion decelerates into its resting position rather than
 * stopping dead.
 */
export function spawnRevealProgress(spawnedAt: number, now: number): number {
  if (!Number.isFinite(spawnedAt)) return 1;
  const elapsed = now - spawnedAt;
  if (elapsed >= SPAWN_REVEAL_MS) return 1;
  if (elapsed <= 0) return 0;
  const linear = elapsed / SPAWN_REVEAL_MS;
  return 1 - (1 - linear) * (1 - linear);
}

export function selectSpriteFrame(
  definition: CharacterDefinition,
  animationName: keyof CharacterDefinition['animations'],
  animationStartedAt: number,
  now: number,
  timeScale = 1
): SelectedSpriteFrame {
  const animation = definition.animations[animationName];
  const elapsed = Math.max(0, now - animationStartedAt);
  const rawIndex = Math.floor(elapsed / (animation.frameDurationMs * timeScale));
  const index = animation.loop
    ? rawIndex % animation.frames.length
    : Math.min(rawIndex, animation.frames.length - 1);
  return { frame: animation.frames[index], index };
}

export function hitTestSpriteFrame(
  frame: SpriteFrame,
  scale: number,
  facing: Facing,
  localX: number,
  localY: number,
  hitSlop = 2
): boolean {
  const width = frame.rows[0].length * scale;
  const height = frame.rows.length * scale;
  for (let offsetY = -hitSlop; offsetY <= hitSlop; offsetY += 1) {
    for (let offsetX = -hitSlop; offsetX <= hitSlop; offsetX += 1) {
      let x = localX + offsetX;
      const y = localY + offsetY;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      if (facing === -1) x = width - x - 0.0001;
      const column = Math.floor(x / scale);
      const row = Math.floor(y / scale);
      if (frame.rows[row]?.[column] !== '.') return true;
    }
  }
  return false;
}
