const monthFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC'
});

export function formatMonthLabel(monthStart: string): string {
  return monthFormatter.format(new Date(`${monthStart}T00:00:00Z`));
}

export function monthlyBarWidth(value: number, maxValue: number): number {
  if (value <= 0) return 0;
  if (maxValue <= 0) return 100;
  return Math.min(100, Math.max(4, Math.round((value / maxValue) * 100)));
}
