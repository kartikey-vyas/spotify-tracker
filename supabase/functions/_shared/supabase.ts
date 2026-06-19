import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2';
import { publishableKey, requireEnv, secretKey, secretKeys } from './env.ts';

export function adminClient(): SupabaseClient {
  return createClient(requireEnv('SUPABASE_URL'), secretKey(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

export function userClient(req: Request): SupabaseClient {
  const authorization = req.headers.get('Authorization');
  if (!authorization) throw new Error('Missing Authorization header');

  return createClient(requireEnv('SUPABASE_URL'), publishableKey(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    },
    global: {
      headers: {
        Authorization: authorization
      }
    }
  });
}

export async function authenticatedUser(req: Request): Promise<User> {
  const supabase = userClient(req);
  const { data, error } = await supabase.auth.getUser();
  if (error) throw new Error(error.message);
  if (!data.user) throw new Error('Not authenticated');
  return data.user;
}

export function assertServiceRequest(req: Request): void {
  const apikey = req.headers.get('apikey');
  if (!apikey || !secretKeys().includes(apikey)) {
    throw new Error('Invalid service credential');
  }
}

