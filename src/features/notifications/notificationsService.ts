import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database.types';

export type Notification = Database['public']['Tables']['notifications']['Row'];

// Fil principal : jamais les notifications supprimees (deleted_at) ni celles
// archivees (masquees volontairement, ex. critique non resolue rangee de
// cote) — voir fetchImportantNotifications pour ces dernieres.
export async function fetchNotifications(profileId: string, limit = 40): Promise<Notification[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('profile_id', profileId)
    .is('deleted_at', null)
    .is('archived_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

// Notifications critiques non supprimees (litige, KYC refuse, paiement...),
// qu'elles soient archivees ou non — restent accessibles tant que non
// resolues, meme si l'utilisateur les a masquees du fil principal.
export async function fetchImportantNotifications(profileId: string): Promise<Notification[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('profile_id', profileId)
    .eq('is_critical', true)
    .is('deleted_at', null)
    .order('resolved_at', { ascending: true, nullsFirst: true })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function markNotificationRead(id: string): Promise<void> {
  const { error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id).is('read_at', null);
  if (error) throw error;
}

export async function markAllNotificationsRead(profileId: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('profile_id', profileId)
    .is('read_at', null);
  if (error) throw error;
}

// Suppression individuelle : soft delete (deleted_at). Une notification
// critique non resolue ne peut pas etre supprimee — le trigger serveur
// annule silencieusement deleted_at dans ce cas ; l'appelant doit proposer
// "Archiver" plutot que "Supprimer" pour ces entrees (cf. isProtected()).
export async function deleteNotification(id: string): Promise<void> {
  const { error } = await supabase.from('notifications').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

// Masque du fil principal sans supprimer : utilise pour les notifications
// critiques non resolues ("Archiver" au lieu de "Supprimer").
export async function archiveNotification(id: string): Promise<void> {
  const { error } = await supabase.from('notifications').update({ archived_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

export async function restoreNotification(id: string): Promise<void> {
  const { error } = await supabase.from('notifications').update({ archived_at: null }).eq('id', id);
  if (error) throw error;
}

export interface DeleteAllResult {
  deleted: number;
  keptProtected: number;
}

// Tout supprimer : RPC serveur (garantit l'atomicite et renvoie combien de
// notifications critiques non resolues ont ete conservees, pour informer
// l'utilisateur au lieu de les faire disparaitre silencieusement).
export async function deleteAllNotifications(): Promise<DeleteAllResult> {
  const { data, error } = await supabase.rpc('delete_all_notifications');
  if (error) throw error;
  const result = data as { deleted: number; kept_protected: number };
  return { deleted: Number(result.deleted), keptProtected: Number(result.kept_protected) };
}

export function isProtectedNotification(n: Pick<Notification, 'is_critical' | 'resolved_at'>): boolean {
  return n.is_critical && !n.resolved_at;
}

// Abonnement realtime : nouvelles notifications ET mises a jour (lecture,
// suppression, archivage depuis un autre onglet/appareil) du profil connecte.
export function subscribeToNotifications(
  profileId: string,
  handlers: { onInsert: (n: Notification) => void; onUpdate?: (n: Notification) => void },
): RealtimeChannel {
  const channel = supabase.channel(`notifications:${profileId}`).on(
    'postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'notifications', filter: `profile_id=eq.${profileId}` },
    (payload) => handlers.onInsert(payload.new as Notification),
  );
  if (handlers.onUpdate) {
    channel.on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `profile_id=eq.${profileId}` },
      (payload) => handlers.onUpdate?.(payload.new as Notification),
    );
  }
  channel.subscribe();
  return channel;
}

export function unsubscribeNotifications(channel: RealtimeChannel): void {
  supabase.removeChannel(channel);
}
