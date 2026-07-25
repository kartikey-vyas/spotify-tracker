import type { CharacterDefinition, Facing, SpriteFrame } from './types';

export interface SelectedSpriteFrame {
  frame: SpriteFrame;
  index: number;
}

export function selectSpriteFrame(
  definition: CharacterDefinition,
  animationName: keyof CharacterDefinition['animations'],
  animationStartedAt: number,
  now: number
): SelectedSpriteFrame {
  // A character without a signature pose falls back to idle rather than
  // dereferencing undefined.
  const animation = definition.animations[animationName] ?? definition.animations.idle;
  const elapsed = Math.max(0, now - animationStartedAt);
  const rawIndex = Math.floor(elapsed / animation.frameDurationMs);
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
