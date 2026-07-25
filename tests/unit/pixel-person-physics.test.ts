import { describe, expect, it } from 'vitest';
import {
  characterRegistry,
  tinyPerson,
  withPalette
} from '../../src/lib/pixel-person/characters';
import { PixelPersonController } from '../../src/lib/pixel-person/controller';
import {
  defaultPhysicsConfig,
  hasBodyClearance,
  intersects,
  SpatialHash,
  stepPhysics
} from '../../src/lib/pixel-person/physics';
import { createPixelPerson, stepPixelPerson } from '../../src/lib/pixel-person/simulation';
import type { Collider, PhysicsBody, WorldGeometry } from '../../src/lib/pixel-person/types';

function body(overrides: Partial<PhysicsBody> = {}): PhysicsBody {
  return {
    x: 10,
    y: 0,
    width: 14,
    height: 31,
    vx: 0,
    vy: 0,
    grounded: false,
    supportId: null,
    ...overrides
  };
}

function collider(overrides: Partial<Collider> = {}): Collider {
  return {
    id: 'platform',
    kind: 'border',
    x: 0,
    y: 60,
    width: 100,
    height: 2,
    ...overrides
  };
}

describe('pixel person character registry', () => {
  it('contains a complete, consistently-sized tiny person', () => {
    expect(characterRegistry[tinyPerson.id]).toBe(tinyPerson);
    expect(tinyPerson.pixelWidth).toBe(16);
    expect(tinyPerson.pixelHeight).toBe(22);
    expect(tinyPerson.scale).toBe(1.5);
    // Footprint is held at the pre-existing 24x32 so world tuning still applies.
    expect(tinyPerson.pixelWidth * tinyPerson.scale).toBe(24);
    expect(tinyPerson.body.width).toBe(14);
    expect(tinyPerson.body.height).toBe(31);
  });

  it('every registered character is complete and consistently sized', () => {
    const characters = Object.values(characterRegistry);
    expect(characters.length).toBeGreaterThanOrEqual(2);
    for (const character of characters) {
      expect(characterRegistry[character.id]).toBe(character);
      expect(Object.keys(character.animations).sort()).toEqual([
        'climb',
        'crawl',
        'dangle',
        'fall',
        'hide',
        'idle',
        'jump',
        'listen',
        'mantle',
        'walk'
      ]);
      for (const animation of Object.values(character.animations)) {
        for (const frame of animation.frames) {
          expect(frame.rows).toHaveLength(character.pixelHeight);
          expect(frame.rows.every((row) => row.length === character.pixelWidth)).toBe(true);
        }
      }
      // Every palette key used by any frame must resolve to a color.
      for (const animation of Object.values(character.animations)) {
        for (const frame of animation.frames) {
          for (const row of frame.rows) {
            for (const key of row) {
              if (key === '.') continue;
              expect(character.palette[key]).toBeTruthy();
            }
          }
        }
      }
    }
  });

  it('withPalette derives recolored variants that share frames', () => {
    const variant = withPalette(tinyPerson, 'test-variant', { t: '#ff0000' });
    expect(variant.id).toBe('test-variant');
    expect(variant.palette.t).toBe('#ff0000');
    expect(variant.palette.h).toBe(tinyPerson.palette.h);
    expect(variant.animations).toBe(tinyPerson.animations);
    expect(tinyPerson.palette.t).not.toBe('#ff0000');
  });
});

describe('pixel person physics', () => {
  it('lands on a two-pixel UI border without tunnelling through it', () => {
    const platform = collider();
    const result = stepPhysics(
      body({ y: 20, vy: 360 }),
      { moveX: 0, jump: false },
      [platform],
      1 / 20
    );

    // Rests with its feet exactly on the platform top: 60 - body height 31.
    expect(result.body.y).toBe(29);
    expect(result.body.vy).toBe(0);
    expect(result.body.grounded).toBe(true);
    expect(result.body.supportId).toBe(platform.id);
    expect(result.contacts.ground).toBe(platform);
  });

  it('stops at a thin vertical border while walking', () => {
    const wall = collider({ id: 'wall', x: 30, y: 0, width: 2, height: 80 });
    const result = stepPhysics(
      body({ x: 14, y: 20, vx: defaultPhysicsConfig.walkSpeed, grounded: true }),
      { moveX: 1, jump: false },
      [wall],
      1 / 20
    );

    expect(result.body.x).toBe(16);
    expect(result.body.vx).toBe(0);
    expect(result.contacts.right).toBe(wall);
  });

  it('only jumps while grounded', () => {
    const grounded = stepPhysics(
      body({ grounded: true, supportId: 'floor' }),
      { moveX: 0, jump: true },
      [],
      1 / 60
    );
    const airborne = stepPhysics(body(), { moveX: 0, jump: true }, [], 1 / 60);

    expect(grounded.body.vy).toBeLessThan(0);
    expect(airborne.body.vy).toBeGreaterThan(0);
  });

  it('uses strict overlap so standing on a surface is not embedded in it', () => {
    // y 29 puts the feet exactly on the collider top (height 31); y 30 embeds them.
    expect(intersects(body({ y: 29 }), collider())).toBe(false);
    expect(intersects(body({ y: 30 }), collider())).toBe(true);
  });

  it('deduplicates colliders spanning several spatial cells', () => {
    const wide = collider({ width: 220 });
    const index = new SpatialHash([wide], 32);
    expect(index.query({ x: 0, y: 50, width: 200, height: 20 })).toEqual([wide]);
  });

  it('requires a full body-height of clearance above a support', () => {
    const support = collider({ id: 'support', y: 60 });
    const lowCeiling = collider({ id: 'ceiling', y: 40 });
    const standingBody = body({ y: support.y - 31 });

    expect(hasBodyClearance(standingBody, [support], support.id)).toBe(true);
    expect(hasBodyClearance(standingBody, [support, lowCeiling], support.id)).toBe(false);
  });

  it('crawls into a supported gap that is too low for standing', () => {
    const floor = collider({ id: 'floor', x: 0, y: 60, width: 120 });
    const ceiling = collider({ id: 'ceiling', x: 20, y: 46, width: 50 });
    const colliders = [floor, ceiling];
    const geometry: WorldGeometry = {
      colliders,
      occluders: [],
      itemSources: [],
      scanBounds: { x: 0, y: 0, width: 500, height: 500 },
      viewportBounds: { x: 0, y: 0, width: 500, height: 500 }
    };
    const person = createPixelPerson(
      tinyPerson,
      body({ x: 4, y: 29, grounded: true, supportId: floor.id }),
      0
    );
    person.activity = 'wander';
    person.activityUntil = 10_000;
    person.goalX = 100;
    const spatial = new SpatialHash(colliders);

    stepPixelPerson(person, geometry, spatial, [], 0.05, 50);

    expect(person.crawling).toBe(true);
    expect(person.animation).toBe('crawl');
    expect(person.body.height).toBe(12);
    expect(person.body.y + person.body.height).toBe(60);

    for (let step = 2; step <= 12; step += 1) {
      stepPixelPerson(person, geometry, spatial, [], 0.05, step * 50);
    }
    expect(person.body.x).toBeGreaterThan(4);
    expect(person.body.vx).toBeLessThanOrEqual(24);
  });

  it('stands back up after crawling clear of the low ceiling', () => {
    const floor = collider({ id: 'floor', x: 0, y: 60, width: 120 });
    const ceiling = collider({ id: 'ceiling', x: 20, y: 46, width: 40 });
    const colliders = [floor, ceiling];
    const geometry: WorldGeometry = {
      colliders,
      occluders: [],
      itemSources: [],
      scanBounds: { x: 0, y: 0, width: 500, height: 500 },
      viewportBounds: { x: 0, y: 0, width: 500, height: 500 }
    };
    const person = createPixelPerson(
      tinyPerson,
      body({ x: 4, y: 29, grounded: true, supportId: floor.id }),
      0
    );
    person.activity = 'wander';
    person.activityUntil = 10_000;
    person.goalX = 100;
    const spatial = new SpatialHash(colliders);
    stepPixelPerson(person, geometry, spatial, [], 0.05, 50);
    person.body.x = 70;

    stepPixelPerson(person, geometry, spatial, [], 0.05, 100);

    expect(person.crawling).toBe(false);
    expect(person.body.height).toBe(31);
    expect(person.body.y).toBe(29);
  });

  it('does not crawl into a gap shorter than the crawl body', () => {
    const floor = collider({ id: 'floor', x: 0, y: 60, width: 120 });
    const ceiling = collider({ id: 'ceiling', x: 20, y: 49, width: 50 });
    const colliders = [floor, ceiling];
    const geometry: WorldGeometry = {
      colliders,
      occluders: [],
      itemSources: [],
      scanBounds: { x: 0, y: 0, width: 500, height: 500 },
      viewportBounds: { x: 0, y: 0, width: 500, height: 500 }
    };
    const person = createPixelPerson(
      tinyPerson,
      body({ x: 4, y: 29, grounded: true, supportId: floor.id }),
      0
    );
    person.activity = 'wander';
    person.activityUntil = 10_000;
    person.goalX = 100;

    stepPixelPerson(person, geometry, new SpatialHash(colliders), [], 0.05, 50);

    expect(person.crawling).toBe(false);
    expect(person.body.height).toBe(31);
  });

  it('paces long mantles instead of skating sideways across UI surfaces', () => {
    const person = createPixelPerson(tinyPerson, body({ x: 0 }), 0);
    const geometry: WorldGeometry = {
      colliders: [],
      occluders: [],
      itemSources: [],
      scanBounds: { x: 0, y: 0, width: 500, height: 500 },
      viewportBounds: { x: 0, y: 0, width: 500, height: 500 }
    };
    const spatial = new SpatialHash([]);
    person.activity = 'mantle';
    person.mantle = {
      start: { x: 0, y: 0 },
      end: { x: 100, y: 0 },
      startedAt: 0
    };

    stepPixelPerson(person, geometry, spatial, [], 0.1, 1400);
    const previousX = person.body.x;
    stepPixelPerson(person, geometry, spatial, [], 0.1, 1500);

    expect((person.body.x - previousX) / 0.1).toBeLessThanOrEqual(52.1);
    expect(person.activity).toBe('mantle');
  });

  it('rejects a climb when another surface blocks the body-sized path', () => {
    const floor = collider({ id: 'floor', x: 0, y: 80, width: 200, height: 2 });
    const wall = collider({ id: 'wall', x: 30, y: 0, width: 2, height: 80 });
    const blocker = collider({ id: 'blocker', x: 15, y: 25, width: 14, height: 2 });
    const colliders = [floor, wall, blocker];
    const geometry: WorldGeometry = {
      colliders,
      occluders: [],
      itemSources: [],
      scanBounds: { x: 0, y: 0, width: 500, height: 500 },
      viewportBounds: { x: 0, y: 0, width: 500, height: 500 }
    };
    const person = createPixelPerson(
      tinyPerson,
      body({ x: 16, y: 50, vx: 42, grounded: true, supportId: floor.id }),
      0
    );
    person.activity = 'wander';
    person.activityUntil = 10_000;
    person.goalX = 100;

    const spatial = new SpatialHash(colliders);
    for (let step = 1; step <= 30; step += 1) {
      stepPixelPerson(person, geometry, spatial, [], 0.05, step * 50);
    }

    expect(person.climb).toBeNull();
    expect(person.activity).toBe('wander');
    expect(person.stuckForMs).toBeGreaterThanOrEqual(1_400);
  });

  it('applies viewport clearance to planned card-edge climbs', () => {
    const panel = collider({
      id: 'panel',
      kind: 'solid',
      x: 12,
      y: 333,
      width: 366,
      height: 96
    });
    const geometry: WorldGeometry = {
      colliders: [panel],
      occluders: [],
      itemSources: [],
      scanBounds: { x: 0, y: 0, width: 390, height: 844 },
      viewportBounds: { x: 0, y: 0, width: 390, height: 844 }
    };
    const person = createPixelPerson(
      tinyPerson,
      body({ x: 362, y: 303, grounded: true, supportId: panel.id }),
      0
    );
    person.activity = 'wander';
    person.activityUntil = 10_000;
    person.goalX = 362;
    person.plannedClimb = {
      top: panel,
      wall: panel,
      side: 'right',
      goalX: 362
    };

    stepPixelPerson(person, geometry, new SpatialHash([panel]), [], 0.05, 100);

    expect(person.mantle).toBeNull();
    expect(person.activity).toBe('wander');
    expect(person.facing).toBe(-1);
    expect(person.lastClimbAt).toBe(100);
  });

  it('scales an inside wall even when panel content overlaps the climb corridor', () => {
    const groupId = 'play-panel';
    const top = collider({
      id: 'panel-top',
      groupId,
      edge: 'top',
      x: 0,
      y: 0,
      width: 100,
      height: 2
    });
    const right = collider({
      id: 'panel-right',
      groupId,
      edge: 'right',
      x: 98,
      y: 0,
      width: 2,
      height: 96
    });
    const bottom = collider({
      id: 'panel-bottom',
      groupId,
      edge: 'bottom',
      x: 0,
      y: 94,
      width: 100,
      height: 2
    });
    const left = collider({
      id: 'panel-left',
      groupId,
      edge: 'left',
      x: 0,
      y: 0,
      width: 2,
      height: 96
    });
    const word = collider({
      id: 'panel-word',
      kind: 'text',
      x: 83,
      y: 30,
      width: 15,
      height: 16
    });
    const foothold = collider({
      id: 'panel-foothold',
      kind: 'text',
      x: 70,
      y: 94,
      width: 28,
      height: 2
    });
    const colliders = [top, right, bottom, left, word, foothold];
    const geometry: WorldGeometry = {
      colliders,
      occluders: [],
      itemSources: [],
      scanBounds: { x: 0, y: 0, width: 200, height: 200 },
      viewportBounds: { x: 0, y: 0, width: 200, height: 200 }
    };
    const person = createPixelPerson(
      tinyPerson,
      body({ x: 84, y: 64, grounded: true, supportId: foothold.id }),
      0
    );
    person.activity = 'wander';
    person.activityUntil = 10_000;
    person.goalX = 86;

    stepPixelPerson(person, geometry, new SpatialHash(colliders), [], 0.05, 100);

    expect(person.activity).toBe('climb');
    expect(person.climb).toMatchObject({ wall: right, top, side: 'left', direction: 'up' });
    expect(person.body.supportId).toBeNull();

    for (
      let step = 2;
      step <= 70 && (person.activity as string) === 'climb';
      step += 1
    ) {
      stepPixelPerson(person, geometry, new SpatialHash(colliders), [], 0.05, step * 50);
    }

    expect(person.activity).toBe('mantle');
    expect(person.mantle?.end.x).toBe(81);
    expect(person.mantle?.supportId).toBe(top.id);
  });
});

describe('pixel person interaction seam', () => {
  it('supports distinct runtime ids for multiple characters', () => {
    expect(createPixelPerson(tinyPerson, body(), 0, 'pixel-person-4').id).toBe(
      'pixel-person-4'
    );
  });

  it('queues ambient-compatible commands in order', () => {
    const controller = new PixelPersonController();
    controller.summon();
    controller.spawnAt({ x: 20, y: 30 }, 'tiny-person');
    controller.moveTo({ x: 100, y: 30 });
    controller.fleeFrom({ x: 70, y: 30 });
    controller.despawn('pixel-person-1');

    expect(controller.drain().map((command) => command.type)).toEqual([
      'summon',
      'spawn',
      'move',
      'flee',
      'despawn'
    ]);
    expect(controller.drain()).toEqual([]);
  });

  it('wakes its consumer as soon as a command is queued', () => {
    const controller = new PixelPersonController();
    const seen: number[] = [];
    controller.setWakeListener(() => seen.push(controller.drain().length));

    controller.summon();
    controller.summon();

    expect(seen).toEqual([1, 1]);
    expect(controller.drain()).toEqual([]);
  });
});
