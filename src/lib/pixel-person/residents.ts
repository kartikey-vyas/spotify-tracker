import type { PixelPersonRuntime } from './simulation';
import type { RoomRecord } from './types';

/** How many covers the session crate remembers for pocket records. */
export const CRATE_SIZE = 24;

/**
 * Who lives in the room, kept at module level so they survive navigation. Each
 * page mounts its own room; whoever was in the last one walks into the next
 * as themselves instead of being re-rolled.
 */
export interface RoomSession {
  people: PixelPersonRuntime[];
  /** Width of the room they were last in, to keep their relative spot. */
  lastRoomWidth: number;
  nextPersonId: number;
  /** People asked for with +1 or an artist click, beyond the ambient default. */
  manualPopulation: number;
  /** Everyone was sent out through the door on purpose. */
  suppressed: boolean;
  /** Covers seen on any page this session, newest first. */
  crate: RoomRecord[];
  /** Whether the lamp was left on; every page's room shares it. */
  lampOn: boolean;
}

export const roomSession: RoomSession = {
  people: [],
  lastRoomWidth: 0,
  nextPersonId: 1,
  manualPopulation: 0,
  suppressed: false,
  crate: [],
  lampOn: false
};

/**
 * Remembers covers seen on the page, newest first, so a page without an album
 * wall (about, activity) still has records to pull out of a pocket.
 */
export function rememberRecords(crate: RoomRecord[], records: readonly RoomRecord[]): RoomRecord[] {
  return uniqueRecords([...records, ...crate]).slice(0, CRATE_SIZE);
}

/** De-duplicates by image URL, keeping the first (page order is rank order). */
export function uniqueRecords(records: readonly RoomRecord[]): RoomRecord[] {
  const seen = new Set<string>();
  return records.filter((record) => {
    if (seen.has(record.imageUrl)) return false;
    seen.add(record.imageUrl);
    return true;
  });
}
