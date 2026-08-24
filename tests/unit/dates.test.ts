import { describe, expect, it } from 'vitest';
import { getPresetDateRange, melbourneToday } from '../../src/lib/dateRanges.js';
import { localDateFor } from '../../scripts/lib/dates.js';

describe('date helpers', () => {
  it('buckets UTC timestamps into Melbourne dates', () => {
    expect(localDateFor('2026-06-18T14:30:00.000Z')).toBe('2026-06-19');
  });

  it('returns ISO dates for presets', () => {
    const range = getPresetDateRange('last_30_days');
    expect(range.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(range.end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('this_year runs from January 1 to today', () => {
    const today = melbourneToday();
    const year = today.slice(0, 4);
    expect(getPresetDateRange('this_year')).toEqual({ start: `${year}-01-01`, end: today });
  });

  it('last_year covers the whole previous calendar year', () => {
    const year = Number(melbourneToday().slice(0, 4)) - 1;
    expect(getPresetDateRange('last_year')).toEqual({
      start: `${year}-01-01`,
      end: `${year}-12-31`
    });
  });

  it('last_6_months is a rolling half-year window ending today', () => {
    const { start, end } = getPresetDateRange('last_6_months');
    expect(end).toBe(melbourneToday());
    // Six calendar months span 181-184 days; the start-day clamp for short
    // months (e.g. the 31st mapping into February) can trim a few more.
    const days = (Date.parse(end) - Date.parse(start)) / 86_400_000;
    expect(days).toBeGreaterThanOrEqual(178);
    expect(days).toBeLessThanOrEqual(184);
  });
});
