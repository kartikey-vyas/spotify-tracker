import { describe, expect, it } from 'vitest';
import {
  availableSlots,
  createShelf,
  releaseShelf,
  reserveSlot,
  resizeShelf,
  returnToShelf,
  slotHeldBy,
  stockShelf,
  takeFromShelf
} from '../../src/lib/pixel-person/shelf';
import { rememberRecords, uniqueRecords, CRATE_SIZE } from '../../src/lib/pixel-person/residents';
import type { RoomRecord } from '../../src/lib/pixel-person/types';

function records(...names: string[]): RoomRecord[] {
  return names.map((name) => ({ imageUrl: `https://covers/${name}`, artistName: name }));
}

function urls(shelf: ReturnType<typeof createShelf>): (string | null)[] {
  return shelf.map((slot) => slot.record?.imageUrl.replace('https://covers/', '') ?? null);
}

describe('stocking the shelf', () => {
  it('shelves the page albums in page order', () => {
    const shelf = createShelf(3);
    stockShelf(shelf, records('a', 'b', 'c', 'd'));
    expect(urls(shelf)).toEqual(['a', 'b', 'c']);
  });

  it('leaves slots empty when the page has fewer albums than the shelf', () => {
    const shelf = createShelf(3);
    stockShelf(shelf, records('a'));
    expect(urls(shelf)).toEqual(['a', null, null]);
  });

  it('keeps albums that are still wanted where they are', () => {
    const shelf = createShelf(3);
    stockShelf(shelf, records('a', 'b', 'c'));
    stockShelf(shelf, records('c', 'x', 'a'));
    // 'b' left the page; its slot takes the new album, nothing else moves.
    expect(urls(shelf)).toEqual(['a', 'x', 'c']);
  });

  it('never restocks a slot whose record is out or spoken for', () => {
    const shelf = createShelf(3);
    stockShelf(shelf, records('a', 'b', 'c'));
    takeFromShelf(shelf, 0, 'p1');
    reserveSlot(shelf, 1, 'p2');
    stockShelf(shelf, records('x', 'y', 'z'));
    expect(urls(shelf)).toEqual(['a', 'b', 'x']);
  });
});

describe('taking and returning records', () => {
  it('takes a record off the shelf and puts it back in the same slot', () => {
    const shelf = createShelf(3);
    stockShelf(shelf, records('a', 'b', 'c'));
    expect(takeFromShelf(shelf, 1, 'p1')?.imageUrl).toBe('https://covers/b');
    expect(availableSlots(shelf)).toEqual([0, 2]);
    expect(slotHeldBy(shelf, 'p1')).toBe(1);
    expect(returnToShelf(shelf, 'p1')).toBe(true);
    expect(availableSlots(shelf)).toEqual([0, 1, 2]);
  });

  it('keeps two people off one record', () => {
    const shelf = createShelf(2);
    stockShelf(shelf, records('a', 'b'));
    expect(reserveSlot(shelf, 0, 'p1')).toBe(true);
    expect(reserveSlot(shelf, 0, 'p2')).toBe(false);
    expect(takeFromShelf(shelf, 0, 'p2')).toBeNull();
    expect(takeFromShelf(shelf, 0, 'p1')).not.toBeNull();
    expect(takeFromShelf(shelf, 0, 'p2')).toBeNull();
  });

  it('cannot take from an empty slot', () => {
    const shelf = createShelf(2);
    expect(takeFromShelf(shelf, 0, 'p1')).toBeNull();
    expect(reserveSlot(shelf, 0, 'p1')).toBe(false);
  });

  it('releases everything a person had out or reserved', () => {
    const shelf = createShelf(3);
    stockShelf(shelf, records('a', 'b', 'c'));
    takeFromShelf(shelf, 0, 'p1');
    reserveSlot(shelf, 2, 'p1');
    releaseShelf(shelf, 'p1');
    expect(availableSlots(shelf)).toEqual([0, 1, 2]);
  });

  it('reports a return with nowhere to go after the shelf shrank', () => {
    let shelf = createShelf(5);
    stockShelf(shelf, records('a', 'b', 'c', 'd', 'e'));
    takeFromShelf(shelf, 4, 'p1');
    shelf = resizeShelf(shelf, 3);
    expect(shelf).toHaveLength(3);
    expect(returnToShelf(shelf, 'p1')).toBe(false);
  });

  it('grows with empty slots', () => {
    const shelf = resizeShelf(createShelf(3), 5);
    expect(shelf).toHaveLength(5);
    expect(urls(shelf)).toEqual([null, null, null, null, null]);
  });
});

describe('the session crate', () => {
  it('remembers covers newest first without duplicates', () => {
    const crate = rememberRecords(records('a', 'b'), records('c', 'a'));
    expect(crate.map((record) => record.artistName)).toEqual(['c', 'a', 'b']);
  });

  it('forgets the oldest covers beyond its size', () => {
    const many = records(...Array.from({ length: CRATE_SIZE + 5 }, (_, index) => `r${index}`));
    expect(rememberRecords([], many)).toHaveLength(CRATE_SIZE);
  });

  it('de-duplicates a page that shows one album twice, keeping the first', () => {
    const page = [...records('a', 'b'), { imageUrl: 'https://covers/a', artistName: 'other' }];
    expect(uniqueRecords(page).map((record) => record.artistName)).toEqual(['a', 'b']);
  });
});
