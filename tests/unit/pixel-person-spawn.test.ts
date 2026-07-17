import { describe, expect, it } from 'vitest';
import { tinyPerson } from '../../src/lib/pixel-person/characters';
import { findSafeSpawn } from '../../src/lib/pixel-person/geometry';
import type { Collider, WorldGeometry } from '../../src/lib/pixel-person/types';

function shelf(id: string, y: number): Collider {
  return {
    id,
    kind: 'border',
    edge: 'top',
    x: 50,
    y,
    width: 400,
    height: 2
  };
}

function viewportFloor(viewportHeight: number): Collider {
  return {
    id: 'viewport-floor',
    kind: 'floor',
    edge: 'top',
    x: -360,
    y: viewportHeight - 2,
    width: 1220,
    height: 40
  };
}

function geometry(overrides: Partial<WorldGeometry> = {}): WorldGeometry {
  return {
    colliders: [],
    occluders: [],
    itemSources: [],
    scanBounds: { x: -360, y: -280, width: 1220, height: 1560 },
    viewportBounds: { x: 0, y: 0, width: 500, height: 1000 },
    ...overrides
  };
}

describe('spawn spread', () => {
  // Shelves sit exactly on the 0.42/0.62/0.75 band heights and the others are
  // at least 0.13 * viewport height away, so even with the maximum +-0.05
  // jitter the nearest shelf for each band stays unambiguous.
  const shelves = () => [
    shelf('shelf-150', 150),
    shelf('shelf-420', 420),
    shelf('shelf-620', 620),
    shelf('shelf-750', 750)
  ];

  it('spreads slots across vertically stacked shelves', () => {
    const world = geometry({ colliders: shelves() });

    const chosenSupportIds = new Set<string>();
    for (let slot = 0; slot <= 5; slot += 1) {
      const spawn = findSafeSpawn(world, tinyPerson, slot);
      expect(spawn.supportId).not.toBeNull();
      expect(spawn.grounded).toBe(true);
      chosenSupportIds.add(spawn.supportId!);
    }

    expect(chosenSupportIds.size).toBeGreaterThanOrEqual(3);
  });

  it('pins the first three slots to their band shelves regardless of jitter', () => {
    const world = geometry({ colliders: shelves() });

    // Bands 0.62 / 0.42 / 0.75 with +-0.05 jitter stay within 50px of their
    // shelf while every other shelf is at least 80px away, and all three
    // candidate positions on the nearest shelf outrank the runner-up shelf.
    expect(findSafeSpawn(world, tinyPerson, 0).supportId).toBe('shelf-620');
    expect(findSafeSpawn(world, tinyPerson, 1).supportId).toBe('shelf-420');
    expect(findSafeSpawn(world, tinyPerson, 2).supportId).toBe('shelf-750');
  });

  it('keeps slot 0 on the historical 0.62 band', () => {
    const world = geometry({
      colliders: [shelf('band-42', 420), shelf('band-62', 620), shelf('band-75', 750)]
    });

    expect(findSafeSpawn(world, tinyPerson, 0).supportId).toBe('band-62');
  });

  it('falls back to the viewport floor when only floors are present', () => {
    const world = geometry({ colliders: [viewportFloor(1000)] });

    const spawn = findSafeSpawn(world, tinyPerson, 3);

    expect(spawn.supportId).toBe('viewport-floor');
    expect(spawn.y).toBe(1000 - 2 - tinyPerson.body.height);
    expect(spawn.grounded).toBe(true);
  });

  it('falls back to a null support at the viewport bottom when nothing exists', () => {
    const world = geometry();

    const spawn = findSafeSpawn(world, tinyPerson, 1);

    expect(spawn.supportId).toBeNull();
    expect(spawn.y).toBe(1000 - 4 - tinyPerson.body.height);
    expect(spawn.grounded).toBe(true);
  });
});
