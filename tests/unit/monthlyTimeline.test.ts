import { describe, expect, it } from 'vitest';
import { formatMonthLabel, monthlyBarWidth } from '../../src/lib/monthlyTimeline.js';

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
});
