import { describe, expect, it } from 'vitest';
import {
  createSeats,
  freeSeats,
  releaseSeats,
  reserveSeat,
  resizeSeats,
  takeSeat
} from '../../src/lib/pixel-person/seats';

describe('lounge seats', () => {
  it('starts with every seat free', () => {
    expect(freeSeats(createSeats(3))).toEqual([0, 1, 2]);
  });

  it('keeps two people out of one seat', () => {
    const seats = createSeats(2);
    expect(reserveSeat(seats, 0, 'p1')).toBe(true);
    expect(reserveSeat(seats, 0, 'p2')).toBe(false);
    expect(takeSeat(seats, 0, 'p2')).toBe(false);
    expect(takeSeat(seats, 0, 'p1')).toBe(true);
    expect(takeSeat(seats, 0, 'p2')).toBe(false);
    expect(freeSeats(seats)).toEqual([1]);
  });

  it('frees everything a person held when they get up or are picked up', () => {
    const seats = createSeats(3);
    takeSeat(seats, 0, 'p1');
    reserveSeat(seats, 2, 'p1');
    releaseSeats(seats, 'p1');
    expect(freeSeats(seats)).toEqual([0, 1, 2]);
  });

  it('cannot sit in a seat that does not exist', () => {
    const seats = resizeSeats(createSeats(3), 1);
    expect(takeSeat(seats, 2, 'p1')).toBe(false);
    expect(resizeSeats(seats, 2)).toHaveLength(2);
  });
});
