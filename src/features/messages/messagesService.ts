import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database.types';

export type Message = Database['public']['Tables']['messages']['Row'];

export async function fetchMessages(applicationId: string): Promise<Message[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('application_id', applicationId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function sendMessage(applicationId: string, senderId: string, body: string): Promise<Message> {
  const { data, error } = await supabase
    .from('messages')
    .insert({ application_id: applicationId, sender_id: senderId, body: body.trim() })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

// Marque comme lus tous les messages recus (pas envoyes) du fil.
export async function markThreadRead(applicationId: string, myId: string): Promise<void> {
  const { error } = await supabase
    .from('messages')
    .update({ read_at: new Date().toISOString() })
    .eq('application_id', applicationId)
    .neq('sender_id', myId)
    .is('read_at', null);
  if (error) throw error;
}

// Nombre de messages non lus par candidature (pour les pastilles).
export async function fetchUnreadCounts(applicationIds: string[], myId: string): Promise<Map<string, number>> {
  if (applicationIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from('messages')
    .select('application_id')
    .in('application_id', applicationIds)
    .neq('sender_id', myId)
    .is('read_at', null);
  if (error) throw error;
  const map = new Map<string, number>();
  for (const row of data ?? []) {
    map.set(row.application_id, (map.get(row.application_id) ?? 0) + 1);
  }
  return map;
}

// Abonnement realtime au fil d'une candidature. Retourne le channel a
// desabonner via supabase.removeChannel(channel).
export function subscribeToThread(applicationId: string, onMessage: (m: Message) => void): RealtimeChannel {
  return supabase
    .channel(`messages:${applicationId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `application_id=eq.${applicationId}` },
      (payload) => onMessage(payload.new as Message),
    )
    .subscribe();
}

export function unsubscribe(channel: RealtimeChannel): void {
  supabase.removeChannel(channel);
}
