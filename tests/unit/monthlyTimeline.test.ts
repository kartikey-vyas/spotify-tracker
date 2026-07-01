import { describe, expect, it } from 'vitest';
import {
  buildTimelineHistogram,
  formatMonthLabel,
  monthlyBarWidth,
  timelineBucketMode
} from '../../src/lib/monthlyTimeline.js';

describe('monthly timeline helpers', () => {
  it('formats month bucket labels compactly', () => {
    expect(formatMonthLabel('2026-06-01')).toBe('Jun 2026');
  });

  it('calculates stable bar widths with a visible minimum for non-zero values', () => {
    expect(monthlyBarWidth(0, 100)).toBe(0);
    expect(monthlyBarWidth(2, 100)).toBe(4);
    expect(monthlyBarWidth(50, 100)).toBe(50);
    expect(monthlyBarWidth(200, 100)).toBe(100);
    expect(monthlyBarWidth(10, 0)).toBe(100);
  });

  it('uses daily buckets for ranges under 365 days and sparse month labels', () => {
    expect(timelineBucketMode('2026-06-01', '2026-06-30')).toBe('day');

    expect(
      buildTimelineHistogram(
        [
          { local_date: '2026-06-01', minutes: 10, plays: 2 },
          { local_date: '2026-06-02', minutes: 5, plays: 1 },
          { local_date: '2026-07-01', minutes: 15, plays: 3 }
        ],
        '2026-06-01',
        '2026-07-01'
      )
    ).toEqual([
      { key: '2026-06-01', label: 'Jun 1', minutes: 10, plays: 2 },
      { key: '2026-06-02', label: '', minutes: 5, plays: 1 },
      { key: '2026-07-01', label: 'Jul 1', minutes: 15, plays: 3 }
    ]);
  });

  it('uses monthly buckets for ranges of 365 days or more with sparse year labels', () => {
    expect(timelineBucketMode('2025-01-01', '2025-12-31')).toBe('month');

    expect(
      buildTimelineHistogram(
        [
          { local_date: '2025-01-02', minutes: 10, plays: 2 },
          { local_date: '2025-01-20', minutes: 5, plays: 1 },
          { local_date: '2025-02-01', minutes: 15, plays: 3 },
          { local_date: '2026-01-01', minutes: 30, plays: 6 }
        ],
        '2025-01-01',
        '2026-01-01'
      )
    ).toEqual([
      { key: '2025-01-01', label: 'Jan 2025', minutes: 15, plays: 3 },
      { key: '2025-02-01', label: '', minutes: 15, plays: 3 },
      { key: '2026-01-01', label: 'Jan 2026', minutes: 30, plays: 6 }
    ]);
  });
});
