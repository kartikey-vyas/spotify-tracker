import type { RoomRecord } from './types';

/**
 * What is on the lounge's record player. One record at a time, claimed the
 * same reserve-then-use way as the shelf and the seats, so two people never
 * head over to put a record on together.
 */
export interface RecordPlayerState {
  record: RoomRecord | null;
  /** Who put the record on; they take it off again when they are done. */
  owner: string | null;
  reservedBy: string | null;
}

export function createRecordPlayer(): RecordPlayerState {
  return { record: null, owner: null, reservedBy: null };
}

/** Nothing on it and nobody on the way: `owner` is only ever set with `record`. */
export function isPlayerFree(player: RecordPlayerState): boolean {
  return !player.record && !player.reservedBy;
}

export function reservePlayer(player: RecordPlayerState, personId: string): boolean {
  if (!isPlayerFree(player)) return false;
  player.reservedBy = personId;
  return true;
}

/** Puts a record on. False when someone else has it or a record is already playing. */
export function playRecord(
  player: RecordPlayerState,
  record: RoomRecord,
  personId: string
): boolean {
  if (player.record || (player.reservedBy && player.reservedBy !== personId)) return false;
  player.record = record;
  player.owner = personId;
  player.reservedBy = null;
  return true;
}

/** Takes their record back off. Null when it is not theirs, or nothing is playing. */
export function stopRecord(player: RecordPlayerState, personId: string): RoomRecord | null {
  if (player.owner !== personId || !player.record) return null;
  const record = player.record;
  player.record = null;
  player.owner = null;
  return record;
}

/** Lets go of the player: a reservation lapses and their record comes off. */
export function releasePlayer(player: RecordPlayerState, personId: string): void {
  if (player.reservedBy === personId) player.reservedBy = null;
  if (player.owner === personId) {
    player.record = null;
    player.owner = null;
  }
}
