/** One item, chosen uniformly. The pool must not be empty. */
export function pickOne<T>(pool: readonly T[], random: () => number): T {
  return pool[Math.floor(random() * pool.length)];
}

/**
 * One item, chosen in proportion to its weight. Entries weighing 0 or less
 * never win; the last entry absorbs any float drift at the top of the range.
 * The pool must not be empty.
 */
export function weightedPick<T>(
  pool: readonly (readonly [T, number])[],
  random: () => number
): T {
  const total = pool.reduce((sum, [, weight]) => sum + Math.max(0, weight), 0);
  let roll = random() * total;
  for (const [item, weight] of pool) {
    if (weight <= 0) continue;
    roll -= weight;
    if (roll < 0) return item;
  }
  return pool[pool.length - 1][0];
}
