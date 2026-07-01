import { describe, expect, it } from 'vitest';
import { friendlyAuthError, friendlyLinkError } from '../../src/lib/auth/errors.js';

describe('friendlyAuthError', () => {
  it('maps invalid credentials', () => {
    expect(friendlyAuthError('Invalid login credentials')).toBe('Incorrect email or password.');
  });

  it('maps already-registered', () => {
    expect(friendlyAuthError('User already registered')).toBe(
      'That email is already a member — try signing in instead.'
    );
  });

  it('maps a weak-password message', () => {
    expect(friendlyAuthError('Password should be at least 6 characters')).toBe(
      'Password must be at least 8 characters.'
    );
  });

  it('passes through unknown messages', () => {
    expect(friendlyAuthError('Something oddly specific')).toBe('Something oddly specific');
  });

  it('returns a generic message for empty input', () => {
    expect(friendlyAuthError('')).toBe('Something went wrong. Please try again.');
  });
});

describe('friendlyLinkError', () => {
  it('returns null when there is no error', () => {
    expect(friendlyLinkError(null, null)).toBeNull();
  });

  it('returns friendly copy for an expired/used link', () => {
    expect(friendlyLinkError('access_denied', 'Email link is invalid or has expired')).toBe(
      'This link has already been used or has expired. Sign in below, or ask for a fresh invite or reset link.'
    );
  });
});
