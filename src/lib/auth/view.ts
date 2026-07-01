export type AuthView = 'login' | 'recovery' | 'setup' | 'dashboard';

export function authView(state: {
  hasSession: boolean;
  hasProfile: boolean;
  recovery: boolean;
}): AuthView {
  if (state.recovery && state.hasSession) return 'recovery';
  if (!state.hasSession) return 'login';
  if (!state.hasProfile) return 'setup';
  return 'dashboard';
}
