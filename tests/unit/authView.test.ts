import { describe, expect, it } from 'vitest';
import { authView } from '../../src/lib/auth/view.js';

describe('authView', () => {
  it('shows login when there is no session', () => {
    expect(authView({ hasSession: false, hasProfile: false, recovery: false })).toBe('login');
  });

  it('shows setup when signed in without a profile', () => {
    expect(authView({ hasSession: true, hasProfile: false, recovery: false })).toBe('setup');
  });

  it('shows dashboard when signed in with a profile', () => {
    expect(authView({ hasSession: true, hasProfile: true, recovery: false })).toBe('dashboard');
  });

  it('shows recovery over dashboard when recovering with a session', () => {
    expect(authView({ hasSession: true, hasProfile: true, recovery: true })).toBe('recovery');
  });

  it('ignores a recovery flag with no session (falls back to login)', () => {
    expect(authView({ hasSession: false, hasProfile: false, recovery: true })).toBe('login');
  });
});
