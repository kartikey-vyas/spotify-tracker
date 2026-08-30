import { describe, expect, it } from 'vitest';
import { tinyPerson } from '../../src/lib/pixel-person/characters';
import {
  findSafeSpawn,
  promenadeCollider
} from '../../src/lib/pixel-person/geometry';
import type { Collider, WorldGeometry } from '../../src/lib/pixel-person/types';

describe('authored promenade geometry', () => {
  it('uses the bottom of the clear band as its walking plane', () => {
    const rail = promenadeCollider(
      { x: 24, y: 80, width: 640, height: 76 },
      'overview:promenade',
      'overview'
    );

    expect(rail).toMatchObject({
      x: 24,
      y: 154,
      width: 640,
      height: 2,
      edge: 'top',
      kind: 'platform',
      groupId: 'overview'
    });
  });

  it('prefers an authored promenade over an incidental explicit platform', () => {
    const promenade = promenadeCollider(
      { x: 20, y: 80, width: 600, height: 76 },
      'station:promenade'
    );
    const shelf: Collider = {
      ...promenade,
      id: 'cover-shelf'
    };
    const geometry: WorldGeometry = {
      colliders: [shelf, promenade],
      occluders: [],
      itemSources: [],
      artistPresences: [],
      scanBounds: { x: -360, y: -280, width: 1_360, height: 960 },
      viewportBounds: { x: 0, y: 0, width: 640, height: 400 }
    };

    expect(findSafeSpawn(geometry, tinyPerson).supportId).toBe('station:promenade');
  });
});
