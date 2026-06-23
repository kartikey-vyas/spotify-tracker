export type DateRangePreset =
  | 'today'
  | 'yesterday'
  | 'this_week'
  | 'last_week'
  | 'this_month'
  | 'last_month'
  | 'last_7_days'
  | 'last_30_days'
  | 'last_365_days';

export const dateRangeOptions: Array<{ value: DateRangePreset; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'this_week', label: 'This week' },
  { value: 'last_week', label: 'Last week' },
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'last_7_days', label: 'Last 7 days' },
  { value: 'last_30_days', label: 'Last 30 days' },
  { value: 'last_365_days', label: 'Last 365 days' }
];

const timeZone = 'Australia/Melbourne';

function melbourneParts(date = new Date()): { year: number; month: number; day: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-AU', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value])
  );

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day)
  };
}

function dateFromParts(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day, 12));
}

export function melbourneToday(date = new Date()): string {
  const { year, month, day } = melbourneParts(date);
  return isoDate(dateFromParts(year, month, day));
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function addMonths(date: Date, months: number): Date {
  const copy = new Date(date);
  copy.setUTCMonth(copy.getUTCMonth() + months);
  return copy;
}

function mondayStart(date: Date): Date {
  const day = date.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  return addDays(date, mondayOffset);
}

export function getPresetDateRange(preset: DateRangePreset): { start: string; end: string } {
  const now = melbourneParts();
  const today = dateFromParts(now.year, now.month, now.day);

  switch (preset) {
    case 'today':
      return { start: isoDate(today), end: isoDate(today) };
    case 'yesterday': {
      const day = addDays(today, -1);
      return { start: isoDate(day), end: isoDate(day) };
    }
    case 'this_week':
      return { start: isoDate(mondayStart(today)), end: isoDate(today) };
    case 'last_week': {
      const start = addDays(mondayStart(today), -7);
      return { start: isoDate(start), end: isoDate(addDays(start, 6)) };
    }
    case 'this_month': {
      const start = dateFromParts(now.year, now.month, 1);
      return { start: isoDate(start), end: isoDate(today) };
    }
    case 'last_month': {
      const thisMonth = dateFromParts(now.year, now.month, 1);
      const start = addMonths(thisMonth, -1);
      const end = addDays(thisMonth, -1);
      return { start: isoDate(start), end: isoDate(end) };
    }
    case 'last_7_days':
      return { start: isoDate(addDays(today, -6)), end: isoDate(today) };
    case 'last_30_days':
      return { start: isoDate(addDays(today, -29)), end: isoDate(today) };
    case 'last_365_days':
      return { start: isoDate(addDays(today, -364)), end: isoDate(today) };
  }
}
