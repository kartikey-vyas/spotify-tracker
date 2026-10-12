import type { RoomRecord } from './types';

/**
 * What is on the room's shelf. Layout lives in `room.ts`; this is only which
 * record sits in which slot and who has it.
 *
 * A slot remembers its record while someone has it out, so the record goes
 * back where it came from even if the page has since swapped its albums.
 */
export interface ShelfSlot {
  record: RoomRecord | null;
  /** Person id holding this slot's record, or null while it is on the shelf. */
  out: string | null;
  /** Person id walking over to take it; keeps two people off one record. */
  reservedBy: string | null;
}

export function createShelf(slotCount: number): ShelfSlot[] {
  return resizeShelf([], slotCount);
}

/**
 * Resizes the shelf to `slotCount`. A record that is out when its slot goes
 * away has nowhere to return to; `returnToShelf` reports that, and the holder
 * pockets it instead.
 */
export function resizeShelf(shelf: ShelfSlot[], slotCount: number): ShelfSlot[] {
  if (shelf.length === slotCount) return shelf;
  const next = shelf.slice(0, slotCount);
  while (next.length < slotCount) next.push({ record: null, out: null, reservedBy: null });
  return next;
}

/**
 * Puts the page's albums on the shelf, in page order. Slots whose record is
 * still wanted keep it (no reshuffling under someone's nose); free slots take
 * the next album not already shelved; slots that are spoken for are left
 * alone.
 */
export function stockShelf(shelf: ShelfSlot[], records: readonly RoomRecord[]): void {
  const wanted = new Set(records.map((record) => record.imageUrl));
  for (const slot of shelf) {
    if (slot.out || slot.reservedBy) continue;
    if (slot.record && !wanted.has(slot.record.imageUrl)) slot.record = null;
  }
  const shelved = new Set(
    shelf.flatMap((slot) => (slot.record ? [slot.record.imageUrl] : []))
  );
  const queue = records.filter((record) => !shelved.has(record.imageUrl));
  for (const slot of shelf) {
    if (slot.record || slot.out || slot.reservedBy) continue;
    const record = queue.shift();
    if (!record) break;
    slot.record = record;
  }
}

/** Slots with a record on the shelf that nobody has claimed. */
export function availableSlots(shelf: readonly ShelfSlot[]): number[] {
  const slots: number[] = [];
  shelf.forEach((slot, index) => {
    if (slot.record && !slot.out && !slot.reservedBy) slots.push(index);
  });
  return slots;
}

export function reserveSlot(shelf: ShelfSlot[], index: number, personId: string): boolean {
  const slot = shelf[index];
  if (!slot?.record || slot.out || slot.reservedBy) return false;
  slot.reservedBy = personId;
  return true;
}

/** Takes the record off the shelf. Null when it is gone or claimed by someone else. */
export function takeFromShelf(
  shelf: ShelfSlot[],
  index: number,
  personId: string
): RoomRecord | null {
  const slot = shelf[index];
  if (!slot?.record || slot.out) return null;
  if (slot.reservedBy && slot.reservedBy !== personId) return null;
  slot.reservedBy = null;
  slot.out = personId;
  return slot.record;
}

/** The slot this person's record came from, or -1 when it no longer exists. */
export function slotHeldBy(shelf: readonly ShelfSlot[], personId: string): number {
  return shelf.findIndex((slot) => slot.out === personId);
}

/** Puts the record back in its slot. False when the slot has gone. */
export function returnToShelf(shelf: ShelfSlot[], personId: string): boolean {
  const index = slotHeldBy(shelf, personId);
  if (index < 0) return false;
  shelf[index].out = null;
  return true;
}

/** Lets go of any slot this person was walking over to, but not one they hold. */
export function releaseShelfReservations(shelf: ShelfSlot[], personId: string): void {
  for (const slot of shelf) {
    if (slot.reservedBy === personId) slot.reservedBy = null;
  }
}

/** Puts back anything this person has out or reserved. */
export function releaseShelf(shelf: ShelfSlot[], personId: string): void {
  for (const slot of shelf) {
    if (slot.out === personId) slot.out = null;
    if (slot.reservedBy === personId) slot.reservedBy = null;
  }
}
