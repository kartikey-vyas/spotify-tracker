import { supabase } from '$lib/supabase';
import type { AdminDashboard, AdminInviteHealth, AdminSystemHealth, AdminUserHealth } from '$lib/adminHealth';

type AdminMarker = {
  user_id: string;
};

export async function isCurrentUserAdmin(): Promise<boolean> {
  if (!supabase) return false;

  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user) return false;

  const { data, error } = await supabase
    .from('admin_users')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle<AdminMarker>();

  if (error) return false;
  return Boolean(data);
}

export async function getAdminDashboard(): Promise<AdminDashboard | null> {
  if (!supabase) return null;

  const [
    { data: system, error: systemError },
    { data: users, error: usersError },
    { data: invites, error: invitesError }
  ] = await Promise.all([
    supabase.from('admin_system_health').select('*').maybeSingle<AdminSystemHealth>(),
    supabase
      .from('admin_user_health')
      .select('*')
      .order('display_name', { ascending: true })
      .returns<AdminUserHealth[]>(),
    supabase
      .from('admin_invite_health')
      .select('*')
      .order('created_at', { ascending: false })
      .returns<AdminInviteHealth[]>()
  ]);

  if (systemError) throw new Error(systemError.message);
  if (usersError) throw new Error(usersError.message);
  if (invitesError) throw new Error(invitesError.message);
  if (!system) return null;

  return {
    system,
    users: users ?? [],
    invites: invites ?? []
  };
}
