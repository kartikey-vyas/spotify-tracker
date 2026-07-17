import { describe, expect, it } from 'vitest';
import {
  isPixelPersonRoute,
  normalizePixelPersonPath,
  shouldEnablePixelPerson
} from '../../src/lib/pixel-person/availability';

describe('pixel person availability', () => {
  it.each(['/', '/explore/', '/activity/', '/about/'])(
    'enables the public route %s on desktop',
    (path) => {
      expect(shouldEnablePixelPerson(path, 1280, false)).toBe(true);
    }
  );

  it.each(['/app/', '/admin/', '/profile/', '/loader/'])(
    'does not run on the private or unsupported route %s',
    (path) => {
      expect(shouldEnablePixelPerson(path, 1280, false)).toBe(false);
    }
  );

  it('turns off at the mobile breakpoint and for reduced motion', () => {
    expect(shouldEnablePixelPerson('/', 800, false)).toBe(false);
    expect(shouldEnablePixelPerson('/', 801, false)).toBe(true);
    expect(shouldEnablePixelPerson('/', 1280, true)).toBe(false);
  });

  it('allows an explicit mobile summon without overriding route or motion safeguards', () => {
    expect(shouldEnablePixelPerson('/', 390, false, '', true)).toBe(true);
    expect(shouldEnablePixelPerson('/', 390, true, '', true)).toBe(false);
    expect(shouldEnablePixelPerson('/app/', 390, false, '', true)).toBe(false);
  });

  it('reports routes where the summon control is supported', () => {
    expect(isPixelPersonRoute('/activity/')).toBe(true);
    expect(isPixelPersonRoute('/app/')).toBe(false);
  });

  it('normalizes production base paths and trailing slashes', () => {
    expect(normalizePixelPersonPath('/spotify-tracker/explore', '/spotify-tracker')).toBe(
      '/explore/'
    );
    expect(
      shouldEnablePixelPerson('/spotify-tracker/explore', 1280, false, '/spotify-tracker')
    ).toBe(true);
  });
});
