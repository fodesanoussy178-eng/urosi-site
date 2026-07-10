import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database.types';

export type Notification = Database['public']['Tables']['notifications']['Row'];

export async function fetchNotifications(profileId: string, limit = 40): Promise<Notification[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function markAllNotificationsRead(profileId: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('profile_id', profileId)
    .is('read_at', null);
  if (error) throw error;
}

// Abonnement realtime : toute nouvelle notification du profil connecte.
export function subscribeToNotifications(profileId: string, onNotification: (n: Notification) => void): RealtimeChannel {
  return supabase
    .channel(`notifications:${profileId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'notifications', filter: `profile_id=eq.${profileId}` },
      (payload) => onNotification(payload.new as Notification),
    )
    .subscribe();
}

export function unsubscribeNotifications(channel: RealtimeChannel): void {
  supabase.removeChannel(channel);
}
