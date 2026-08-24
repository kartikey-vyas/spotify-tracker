export type DateRangePreset =
  | 'last_week'
  | 'this_month'
  | 'last_month'
  | 'last_6_months'
  | 'this_year'
  | 'last_year'
  | 'last_7_days'
  | 'last_30_days';

/* The explorer's date picker, ordered near-to-far. A deliberate subset of the
   presets above: the rolling windows (last_7_days, last_30_days) stay off the
   menu but available programmatically — the homepage band uses them — because
   calendar-shaped ranges read better as menu options. */
export const dateRangeOptions: Array<{ value: DateRangePreset; label: string }> = [
  { value: 'last_week', label: 'Last week' },
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'last_6_months', label: 'Last 6 months' },
  { value: 'this_year', label: 'This year' },
  { value: 'last_year', label: 'Last year' }
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
    case 'last_6_months': {
      /* Rolling window ending today, inclusive — the +1 day mirrors how
         last_7_days spans -6: six exact months land on today, not tomorrow. */
      const start = addDays(addMonths(today, -6), 1);
      return { start: isoDate(start), end: isoDate(today) };
    }
    case 'this_year': {
      const start = dateFromParts(now.year, 1, 1);
      return { start: isoDate(start), end: isoDate(today) };
    }
    case 'last_year': {
      const start = dateFromParts(now.year - 1, 1, 1);
      const end = dateFromParts(now.year - 1, 12, 31);
      return { start: isoDate(start), end: isoDate(end) };
    }
    case 'last_7_days':
      return { start: isoDate(addDays(today, -6)), end: isoDate(today) };
    case 'last_30_days':
      return { start: isoDate(addDays(today, -29)), end: isoDate(today) };
  }
}
