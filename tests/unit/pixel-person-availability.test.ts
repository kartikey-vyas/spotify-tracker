import { describe, expect, it } from 'vitest';
import {
  AMBIENT_MIN_VIEWPORT_WIDTH,
  desiredPopulation,
  MAX_PIXEL_PEOPLE,
  shouldRunPixelRoom
} from '../../src/lib/pixel-person/availability';
import { PixelPersonController } from '../../src/lib/pixel-person/controller';

const WIDE = AMBIENT_MIN_VIEWPORT_WIDTH + 1;
const NARROW = AMBIENT_MIN_VIEWPORT_WIDTH;

describe('pixel room availability', () => {
  it('runs on a wide viewport and not at the mobile breakpoint', () => {
    expect(shouldRunPixelRoom(WIDE, false)).toBe(true);
    expect(shouldRunPixelRoom(NARROW, false)).toBe(false);
  });

  it('lets an explicit summon wake a narrow room', () => {
    expect(shouldRunPixelRoom(NARROW, false, true)).toBe(true);
  });

  it('never runs under reduced motion, summoned or not', () => {
    expect(shouldRunPixelRoom(WIDE, true)).toBe(false);
    expect(shouldRunPixelRoom(NARROW, true, true)).toBe(false);
  });
});

describe('room population', () => {
  it('holds one ambient resident on a wide viewport and none on a narrow one', () => {
    expect(desiredPopulation(WIDE, 0, false)).toBe(1);
    expect(desiredPopulation(NARROW, 0, false)).toBe(0);
  });

  it('honours summons up to the cap', () => {
    expect(desiredPopulation(NARROW, 3, false)).toBe(3);
    expect(desiredPopulation(WIDE, MAX_PIXEL_PEOPLE + 4, false)).toBe(MAX_PIXEL_PEOPLE);
  });

  it('is empty after everyone was sent out on purpose', () => {
    expect(desiredPopulation(WIDE, 3, true)).toBe(0);
  });
});

describe('the command queue', () => {
  it('queues commands in order and drains them once', () => {
    const controller = new PixelPersonController();
    controller.summon();
    controller.spawn('artist-frank-ocean');
    expect(controller.drain()).toEqual([
      { type: 'summon' },
      { type: 'spawn', characterId: 'artist-frank-ocean' }
    ]);
    expect(controller.drain()).toEqual([]);
  });

  it('tells every listener as soon as a command is queued', () => {
    const controller = new PixelPersonController();
    const seen: string[] = [];
    controller.onCommand(() => seen.push('shell'));
    const off = controller.onCommand(() => seen.push(`stage:${controller.drain().length}`));
    controller.summon();
    off();
    controller.summon();
    expect(seen).toEqual(['shell', 'stage:1', 'shell']);
  });

  it('keeps commands queued until something drains them', () => {
    const controller = new PixelPersonController();
    controller.summon();
    controller.onCommand(() => undefined);
    expect(controller.drain()).toEqual([{ type: 'summon' }]);
  });
});
