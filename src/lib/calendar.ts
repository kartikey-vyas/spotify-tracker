import type { CalendarDay } from '$lib/types';

/**
 * Pure helpers for the GitHub-style listening calendar: a fixed Jan–Dec grid
 * for a single year (`buildYearGrid`) plus the years to offer and how loud each
 * one was (`yearTotals`). Deterministic — pass `endDate` to cap the current
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

export interface YearTotal {
  year: number;
  value: number;
  /** 0..1 against the busiest year, so the picker can carry a bar. */
  share: number;
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

/**
 * Every year that has data, newest first, with its total and that total as a
 * fraction of the busiest year. Drives the year picker: the years are the
 * options, and `share` lets each option carry a bar so the picker doubles as a
 * coarse history of the account rather than being a bare list of numbers.
 *
 * `share` is relative to the loudest year, not to a fixed ceiling, so the top
 * year always reads as full — the picker compares years to each other, which is
 * the only comparison it can honestly make.
 */
export function yearTotals(days: CalendarDay[], metric: CalendarMetric): YearTotal[] {
  const totals = new Map<number, number>();
  for (const day of days) {
    const year = Number(day.local_date.slice(0, 4));
    totals.set(year, (totals.get(year) ?? 0) + dayValue(day, metric));
  }
  // Guard the divisor rather than the numerator: a year can legitimately total 0
  // (days recorded with no plays under this metric) and must still be offered.
  const max = Math.max(1, ...totals.values());
  return [...totals.entries()]
    .sort(([left], [right]) => right - left)
    .map(([year, value]) => ({ year, value, share: value / max }));
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
