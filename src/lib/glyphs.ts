import type { CalendarDay } from '$lib/types';

const GLYPHS = ['.', '-', '=', '+', '#'] as const;

export function dayValue(day: CalendarDay, metric: 'minutes' | 'plays'): number {
  return metric === 'plays' ? day.plays : day.minutes;
}

export function glyph(value: number, maxValue: number): string {
  if (value <= 0) return GLYPHS[0];
  return GLYPHS[Math.min(GLYPHS.length - 1, Math.ceil((value / maxValue) * (GLYPHS.length - 1)))];
}

export function glyphTimeline(
  days: CalendarDay[],
  metric: 'minutes' | 'plays',
  separator = ''
): string {
  const maxValue = Math.max(1, ...days.map((day) => dayValue(day, metric)));
  return days.map((day) => glyph(dayValue(day, metric), maxValue)).join(separator);
}
