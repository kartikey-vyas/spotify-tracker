import { describe, expect, it } from 'vitest';
import type { AdminClient } from '../../scripts/lib/supabase-admin.js';
import {
  refreshConnectedUsersPublicStats,
  refreshUserPublicStats
} from '../../scripts/lib/supabase-admin.js';

type FakeOpts = {
  users?: string[];
  rpcError?: { message: string } | null;
  selectError?: { message: string } | null;
};

function fakeSupabase(opts: FakeOpts = {}) {
  const rpcCalls: Array<{ name: string; args: unknown }> = [];
  const fromCalls: string[] = [];
  const client = {
    rpcCalls,
    fromCalls,
    rpc(name: string, args: unknown) {
      rpcCalls.push({ name, args });
      return Promise.resolve({ error: opts.rpcError ?? null });
    },
    from(table: string) {
      fromCalls.push(table);
      const builder = {
        select: () => builder,
        eq: () =>
          Promise.resolve({
            data: (opts.users ?? []).map((user_id) => ({ user_id })),
            error: opts.selectError ?? null
          })
      };
      return builder;
    }
  };
  return client;
}

describe('per-user public stats refresh', () => {
  it('refreshUserPublicStats issues refresh_user_public_stats with the user and dates', async () => {
    const sb = fakeSupabase();
    await refreshUserPublicStats(sb as unknown as AdminClient, 'user-1', ['2026-06-19']);
    expect(sb.rpcCalls).toEqual([
      { name: 'refresh_user_public_stats', args: { p_user_id: 'user-1', target_dates: ['2026-06-19'] } }
    ]);
  });

  it('refreshUserPublicStats throws on RPC error', async () => {
    const sb = fakeSupabase({ rpcError: { message: 'boom' } });
    await expect(
      refreshUserPublicStats(sb as unknown as AdminClient, 'u', ['2026-06-19'])
    ).rejects.toThrow(/boom/);
  });

  it('refreshConnectedUsersPublicStats refreshes every sync-enabled user for the dates', async () => {
    const sb = fakeSupabase({ users: ['u1', 'u2'] });
    await refreshConnectedUsersPublicStats(sb as unknown as AdminClient, ['2026-06-19', '2026-06-20']);
    expect(sb.fromCalls).toEqual(['spotify_connections']);
    expect(sb.rpcCalls).toEqual([
      {
        name: 'refresh_user_public_stats',
        args: { p_user_id: 'u1', target_dates: ['2026-06-19', '2026-06-20'] }
      },
      {
        name: 'refresh_user_public_stats',
        args: { p_user_id: 'u2', target_dates: ['2026-06-19', '2026-06-20'] }
      }
    ]);
  });

  it('refreshConnectedUsersPublicStats does nothing when there are no affected dates', async () => {
    const sb = fakeSupabase({ users: ['u1'] });
    await refreshConnectedUsersPublicStats(sb as unknown as AdminClient, []);
    expect(sb.fromCalls).toEqual([]);
    expect(sb.rpcCalls).toEqual([]);
  });
});
