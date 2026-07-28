import type { PixelPersonCommand, Point } from './types';

const NO_COMMANDS: PixelPersonCommand[] = [];

export class PixelPersonController {
  private commands: PixelPersonCommand[] = [];
  private wake: (() => void) | null = null;

  summon(): void {
    this.push({ type: 'summon' });
  }

  spawnAt(position: Point, characterId?: string): void {
    this.push({ type: 'spawn', position, characterId });
  }

  drain(): PixelPersonCommand[] {
    return this.commands.length === 0 ? NO_COMMANDS : this.commands.splice(0);
  }

  /**
   * The consumer of this queue registers a listener so commands are handled
   * immediately even while its frame loop is idle or the feature is disabled.
   */
  setWakeListener(listener: (() => void) | null): void {
    this.wake = listener;
  }

  private push(command: PixelPersonCommand): void {
    this.commands.push(command);
    this.wake?.();
  }
}

export const pixelPersonController = new PixelPersonController();
