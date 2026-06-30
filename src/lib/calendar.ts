import type { CalendarDay } from '$lib/types';

/**
 * Pure helpers for the GitHub-style listening calendar: a fixed Jan–Dec grid
 * for a single year (`buildYearGrid`) plus the list of years to offer
 * (`availableYears`). Deterministic — pass `endDate` to cap the current
 * (partial) year so future days render as empty squares.
 */

export type CalendarMetric = 'plays' | 'minutes';

/** 0 = no activity; 1–4 = increasing intensity relative to the busiest day. */
export type ContributionLevel = 0 | 1 | 2 | 3 | 4;

export interface ContributionCell {
  /** ISO `YYYY-MM-DD`. */
  date: string;
  value: number;
  level: ContributionLevel;
  /** False for trailing cells after `endDate` (future padding); render blank. */
  inRange: boolean;
}

export interface MonthLabel {
  /** Index into `weeks` where this month's label should sit. */
  column: number;
  label: string;
}

export interface ContributionGrid {
  /** Columns of 7 cells each, row 0 = Sunday. */
  weeks: ContributionCell[][];
  monthLabels: MonthLabel[];
  /** Highest single-day value across the visible range (≥ 0). */
  maxValue: number;
  /** Sum of all in-range values. */
  total: number;
}

const DAYS_PER_WEEK = 7;
const MS_PER_DAY = 86_400_000;
/** Minimum columns between month labels; closer ones overlap, so the earlier is dropped. */
const MIN_MONTH_LABEL_GAP = 3;

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec'
];

/** Day-of-week labels by row index (Sunday = 0); blanks render no label. */
export const WEEKDAY_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', ''] as const;

function parseISODate(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

function toISODate(ms: number): string {
  const date = new Date(ms);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dayValue(day: CalendarDay, metric: CalendarMetric): number {
  return metric === 'plays' ? day.plays : day.minutes;
}

function levelFor(value: number, maxValue: number): ContributionLevel {
  if (value <= 0) return 0;
  return Math.min(4, Math.ceil((value / maxValue) * 4)) as ContributionLevel;
}

function emptyGrid(): ContributionGrid {
  return { weeks: [], monthLabels: [], maxValue: 0, total: 0 };
}

/** Distinct years that have any data, newest first — drives the year selector. */
export function availableYears(days: CalendarDay[]): number[] {
  const years = new Set<number>();
  for (const day of days) {
    years.add(Number(day.local_date.slice(0, 4)));
  }
  return [...years].sort((left, right) => right - left);
}

/**
 * Builds a fixed Jan 1 → Dec 31 grid for a single calendar `year` (GitHub-style).
 * Cells outside the year are padding (`inRange: false`); levels are relative to
 * that year's own busiest day. Pass `endDate` to cap the current (partial) year
 * so future days render blank.
 */
export function buildYearGrid(
  days: CalendarDay[],
  year: number,
  metric: CalendarMetric,
  options: { endDate?: string } = {}
): ContributionGrid {
  if (days.length === 0) return emptyGrid();

  const valueByDate = new Map<string, number>();
  for (const day of days) {
    valueByDate.set(day.local_date, dayValue(day, metric));
  }

  const jan1Ms = Date.UTC(year, 0, 1);
  const dec31Ms = Date.UTC(year, 11, 31);
  const capMs = options.endDate ? Math.min(dec31Ms, parseISODate(options.endDate)) : dec31Ms;

  // Pad out to whole Sunday-first weeks around the year.
  const gridStartMs = jan1Ms - new Date(jan1Ms).getUTCDay() * MS_PER_DAY;
  const gridEndMs = dec31Ms + (6 - new Date(dec31Ms).getUTCDay()) * MS_PER_DAY;
  const weekCount = Math.round((gridEndMs - gridStartMs) / MS_PER_DAY + 1) / DAYS_PER_WEEK;

  let maxValue = 0;
  let total = 0;
  const cellsByWeek: Array<Array<Omit<ContributionCell, 'level'>>> = [];
  for (let week = 0; week < weekCount; week += 1) {
    const column: Array<Omit<ContributionCell, 'level'>> = [];
    for (let row = 0; row < DAYS_PER_WEEK; row += 1) {
      const ms = gridStartMs + (week * DAYS_PER_WEEK + row) * MS_PER_DAY;
      // Every day of the selected year gets a square; days outside it are grid
      // padding. Future days of the current year render as empty (level 0)
      // squares — only days up to the cap (today) carry real values/colour.
      const inYear = ms >= jan1Ms && ms <= dec31Ms;
      const counted = inYear && ms <= capMs;
      const value = counted ? (valueByDate.get(toISODate(ms)) ?? 0) : 0;
      if (counted) {
        total += value;
        maxValue = Math.max(maxValue, value);
      }
      column.push({ date: toISODate(ms), value, inRange: inYear });
    }
    cellsByWeek.push(column);
  }

  const safeMax = Math.max(1, maxValue);
  const weeks: ContributionCell[][] = cellsByWeek.map((column) =>
    column.map((cell) => ({ ...cell, level: cell.inRange ? levelFor(cell.value, safeMax) : 0 }))
  );

  // Base labels on the first in-range cell of each column so the leading and
  // trailing padding (Dec of the prior year / Jan of the next) never label.
  const monthLabels = monthLabelsFor(weeks, (column) => column.find((cell) => cell.inRange)?.date);

  return { weeks, monthLabels, maxValue, total };
}

/**
 * Emits a month label at each column where a new month begins, dropping labels
 * whose successor starts too soon to fit the text. `monthDate` returns the date
 * a column should be attributed to (or undefined to skip the column entirely).
 */
function monthLabelsFor(
  weeks: ContributionCell[][],
  monthDate: (column: ContributionCell[]) => string | undefined
): MonthLabel[] {
  const raw: MonthLabel[] = [];
  let lastMonth = -1;
  weeks.forEach((column, index) => {
    const date = monthDate(column);
    if (!date) return;
    const month = new Date(parseISODate(date)).getUTCMonth();
    if (month !== lastMonth) {
      raw.push({ column: index, label: MONTH_NAMES[month] });
      lastMonth = month;
    }
  });
  return raw.filter((label, index) => {
    const next = raw[index + 1];
    return !next || next.column - label.column >= MIN_MONTH_LABEL_GAP;
  });
}
