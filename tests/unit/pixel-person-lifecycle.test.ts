import { describe, expect, it } from 'vitest';
import {
  hasFallenOutOfWorld,
  isWithinSimulatedWorld
} from '../../src/lib/pixel-person/lifecycle';
import {
  SPAWN_REVEAL_MS,
  spawnRevealProgress
} from '../../src/lib/pixel-person/sprite';
import type { Rect } from '../../src/lib/pixel-person/types';

/** A scanned window partway down a tall page, as it would be after scrolling. */
function scanBounds(): Rect {
  return { x: -360, y: 1_720, width: 1_720, height: 1_360 };
}

function body(overrides: Partial<Rect> = {}): Rect {
  return { x: 400, y: 2_000, width: 14, height: 31, ...overrides };
}

describe('who is simulated', () => {
  it('simulates someone inside the scanned window', () => {
    expect(isWithinSimulatedWorld(body(), scanBounds())).toBe(true);
  });

  it('freezes someone the reader has scrolled well past', () => {
    const bounds = scanBounds();
    // Left behind above the window — the reader scrolled down.
    expect(isWithinSimulatedWorld(body({ y: 200 }), bounds)).toBe(false);
    // And below it — the reader scrolled up.
    expect(isWithinSimulatedWorld(body({ y: 4_000 }), bounds)).toBe(false);
  });

  it('keeps simulating someone just off the edge of the screen', () => {
    // The scanned window is padded well beyond the viewport precisely so that
    // walking off-screen does not stop the world; only leaving that padded
    // window does. Someone one pixel outside the viewport must still move.
    const bounds = scanBounds();
    const justInside = body({ y: bounds.y + 4 });
    expect(isWithinSimulatedWorld(justInside, bounds)).toBe(true);
  });
});

describe('who is genuinely lost', () => {
  const documentHeight = 6_000;

  it('does not call someone below the fold lost', () => {
    // The regression this guards: the old check measured against the scanned
    // window, which follows the viewport, so scrolling up made everyone below
    // the fold "fall out of the world" and get rebuilt somewhere else.
    const bounds = scanBounds();
    const belowTheFold = body({ y: bounds.y + bounds.height + 500 });
    expect(isWithinSimulatedWorld(belowTheFold, bounds)).toBe(false);
    expect(hasFallenOutOfWorld(belowTheFold, documentHeight)).toBe(false);
  });

  it('does not call someone standing at the very bottom of the page lost', () => {
    expect(hasFallenOutOfWorld(body({ y: documentHeight - 40 }), documentHeight)).toBe(false);
    expect(hasFallenOutOfWorld(body({ y: documentHeight }), documentHeight)).toBe(false);
  });

  it('does call someone flung well below the document lost', () => {
    expect(hasFallenOutOfWorld(body({ y: documentHeight + 4_000 }), documentHeight)).toBe(true);
  });

  it('leaves slack for a page that reflowed under someone', () => {
    // A body a little past the bottom is a page that just got shorter, not a
    // lost person — recovering them teleports someone the reader is watching.
    expect(hasFallenOutOfWorld(body({ y: documentHeight + 100 }), documentHeight)).toBe(false);
  });
});

describe('entrance reveal', () => {
  it('runs from hidden to fully in place over its window', () => {
    expect(spawnRevealProgress(1_000, 1_000)).toBe(0);
    expect(spawnRevealProgress(1_000, 1_000 + SPAWN_REVEAL_MS)).toBe(1);
    expect(spawnRevealProgress(1_000, 1_000 + SPAWN_REVEAL_MS * 2)).toBe(1);
  });

  it('eases out, so it decelerates into place', () => {
    const half = spawnRevealProgress(0, SPAWN_REVEAL_MS / 2);
    expect(half).toBeGreaterThan(0.5);
    expect(half).toBeLessThan(1);
  });

  it('advances monotonically', () => {
    let previous = -1;
    for (let step = 0; step <= 10; step += 1) {
      const value = spawnRevealProgress(0, (SPAWN_REVEAL_MS / 10) * step);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it('treats a person with no spawn time as already in place', () => {
    // Nothing should be invisible because a timestamp went missing.
    expect(spawnRevealProgress(Number.NaN, 5_000)).toBe(1);
    expect(spawnRevealProgress(Number.POSITIVE_INFINITY, 5_000)).toBe(1);
  });

  it('does not go negative if the clock runs behind the spawn', () => {
    expect(spawnRevealProgress(1_000, 500)).toBe(0);
  });
});
