/**
 * Who is sitting where in the lounge. Layout lives in `room.ts`; this is only
 * occupancy, with the same reserve-then-take shape as the shelf so two people
 * never walk over to sit in the same seat.
 */
export interface SeatState {
  occupant: string | null;
  reservedBy: string | null;
}

export function createSeats(count: number): SeatState[] {
  return resizeSeats([], count);
}

/** Resizes to the room's seat count. Anyone sitting in a seat that went away just stands. */
export function resizeSeats(seats: SeatState[], count: number): SeatState[] {
  if (seats.length === count) return seats;
  const next = seats.slice(0, count);
  while (next.length < count) next.push({ occupant: null, reservedBy: null });
  return next;
}

export function freeSeats(seats: readonly SeatState[]): number[] {
  const free: number[] = [];
  seats.forEach((seat, index) => {
    if (!seat.occupant && !seat.reservedBy) free.push(index);
  });
  return free;
}

export function reserveSeat(seats: SeatState[], index: number, personId: string): boolean {
  const seat = seats[index];
  if (!seat || seat.occupant || seat.reservedBy) return false;
  seat.reservedBy = personId;
  return true;
}

/** Sits down. False when the seat is gone or someone else has it. */
export function takeSeat(seats: SeatState[], index: number, personId: string): boolean {
  const seat = seats[index];
  if (!seat || seat.occupant) return false;
  if (seat.reservedBy && seat.reservedBy !== personId) return false;
  seat.reservedBy = null;
  seat.occupant = personId;
  return true;
}

/** Stands up from, and gives up any claim on, every seat. */
export function releaseSeats(seats: SeatState[], personId: string): void {
  for (const seat of seats) {
    if (seat.occupant === personId) seat.occupant = null;
    if (seat.reservedBy === personId) seat.reservedBy = null;
  }
}
