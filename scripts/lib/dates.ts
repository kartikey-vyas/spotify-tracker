export const MELBOURNE_TIME_ZONE = 'Australia/Melbourne';

const melbourneDateFormatter = new Intl.DateTimeFormat('en-AU', {
  timeZone: MELBOURNE_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

export function localDateFor(dateInput: string | number | Date): string {
  const date = new Date(dateInput);
  const parts = Object.fromEntries(
    melbourneDateFormatter.formatToParts(date).map((part) => [part.type, part.value])
  );

  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function unixMs(dateInput: string | Date): number {
  return new Date(dateInput).getTime();
}

export function isoFromUnixMs(ms: number): string {
  return new Date(ms).toISOString();
}

export function uniqueSortedDates(dates: Iterable<string>): string[] {
  return [...new Set(dates)].sort();
}
