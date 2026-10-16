import { describe, expect, it } from 'vitest';
import {
  createRecordPlayer,
  isPlayerFree,
  playRecord,
  releasePlayer,
  reservePlayer,
  stopRecord
} from '../../src/lib/pixel-person/record-player';

const record = { imageUrl: 'https://covers/1' };

describe('record player state', () => {
  it('plays one record for whoever reserved it, and gives it back to them', () => {
    const player = createRecordPlayer();
    expect(reservePlayer(player, 'p1')).toBe(true);
    expect(reservePlayer(player, 'p2')).toBe(false);
    expect(playRecord(player, record, 'p2')).toBe(false);
    expect(playRecord(player, record, 'p1')).toBe(true);
    expect(isPlayerFree(player)).toBe(false);
    expect(stopRecord(player, 'p2')).toBeNull();
    expect(stopRecord(player, 'p1')).toBe(record);
    expect(isPlayerFree(player)).toBe(true);
  });

  it('will not put a second record on', () => {
    const player = createRecordPlayer();
    playRecord(player, record, 'p1');
    expect(playRecord(player, { imageUrl: 'https://covers/2' }, 'p1')).toBe(false);
  });

  it('lets go of a reservation or a playing record on release', () => {
    const player = createRecordPlayer();
    reservePlayer(player, 'p1');
    releasePlayer(player, 'p1');
    expect(isPlayerFree(player)).toBe(true);
    playRecord(player, record, 'p1');
    releasePlayer(player, 'p2');
    expect(player.record).toBe(record);
    releasePlayer(player, 'p1');
    expect(isPlayerFree(player)).toBe(true);
  });
});
