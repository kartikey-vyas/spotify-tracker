import { describe, expect, it } from 'vitest';
import { getPresetDateRange } from '../../src/lib/dateRanges.js';
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
});
