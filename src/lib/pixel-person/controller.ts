import { writable } from 'svelte/store';
import type { PixelPersonCommand } from './types';

const NO_COMMANDS: PixelPersonCommand[] = [];

/**
 * The only way the rest of the app talks to the room: the header's +1 and a
 * click on an artist both queue a command here. Commands wait in the queue
 * until a room drains them, so a summon that has to lazy-load the room first
 * is not lost.
 */
export class PixelPersonController {
  private commands: PixelPersonCommand[] = [];
  private readonly listeners = new Set<() => void>();

  summon(): void {
    this.push({ type: 'summon' });
  }

  spawn(characterId: string): void {
    this.push({ type: 'spawn', characterId });
  }

  drain(): PixelPersonCommand[] {
    return this.commands.length === 0 ? NO_COMMANDS : this.commands.splice(0);
  }

  /** Called whenever a command is queued. Returns the unsubscribe. */
  onCommand(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private push(command: PixelPersonCommand): void {
    this.commands.push(command);
    for (const listener of this.listeners) listener();
  }
}

export const pixelPersonController = new PixelPersonController();

/**
 * How many rooms are mounted. The header only offers +1 while there is a
 * room on the page to put someone in.
 */
export const pixelRoomCount = writable(0);
