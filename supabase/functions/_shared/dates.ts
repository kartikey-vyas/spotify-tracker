export function unixMs(iso: string): number {
  const value = Date.parse(iso);
  if (Number.isNaN(value)) throw new Error(`Invalid date: ${iso}`);
  return value;
}

export function localDateFor(iso: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-AU', {
      timeZone: 'Australia/Melbourne',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    })
      .formatToParts(new Date(iso))
      .map((part) => [part.type, part.value])
  );

  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function uniqueSortedDates(values: Set<string>): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

