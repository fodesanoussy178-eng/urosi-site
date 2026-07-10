import { useEffect, useRef, useState } from 'react';
import { T } from '@/components/ui/theme';
import {
  fetchNotifications,
  markAllNotificationsRead,
  subscribeToNotifications,
  unsubscribeNotifications,
  type Notification,
} from '@/features/notifications/notificationsService';

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  return `il y a ${Math.floor(s / 86400)} j`;
}

const KIND_ICONS: Record<string, string> = {
  application: '📥',
  application_accepted: '✅',
  application_rejected: '📪',
  application_cancelled: '✕',
  mission_completed: '🏁',
  rating: '★',
  message: '💬',
  payment: '💶',
  delay: '⏱',
};

// Cloche de notifications : pastille non-lus + panneau, alimentee en temps
// reel (supabase realtime) et rafraichie a l'ouverture.
export function NotificationBell({ profileId, onDataChanged }: { profileId: string; onDataChanged?: () => void }) {
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const changed = useRef(onDataChanged);
  changed.current = onDataChanged;

  useEffect(() => {
    let active = true;
    fetchNotifications(profileId)
      .then((list) => active && setItems(list))
      .catch(() => undefined);
    const channel = subscribeToNotifications(profileId, (n) => {
      setItems((prev) => [n, ...prev]);
      changed.current?.();
    });
    return () => {
      active = false;
      unsubscribeNotifications(channel);
    };
  }, [profileId]);

  const unread = items.filter((n) => !n.read_at).length;

  async function openPanel() {
    setOpen(true);
    if (unread > 0) {
      try {
        await markAllNotificationsRead(profileId);
        setItems((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: new Date().toISOString() })));
      } catch {
        // pas bloquant
      }
    }
  }

  return (
    <>
      <button
        onClick={openPanel}
        aria-label="Notifications"
        style={{ position: 'relative', background: 'none', border: `1px solid ${T.cb}`, borderRadius: 8, width: 30, height: 30, cursor: 'pointer', color: T.sub, fontSize: 14 }}
      >
        🔔
        {unread > 0 && (
          <span style={{ position: 'absolute', top: -5, right: -5, minWidth: 15, height: 15, borderRadius: 8, background: '#dc2626', color: '#fff', fontSize: 9, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px' }}>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.82)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 600 }}
          onClick={() => setOpen(false)}
        >
          <div
            style={{ width: '100%', maxWidth: 430, background: T.card, borderRadius: '20px 20px 0 0', padding: '18px 16px 28px', maxHeight: '75vh', overflowY: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontSize: 15, fontWeight: 900, color: T.text }}>Notifications</span>
              <button onClick={() => setOpen(false)} style={{ background: T.row, border: 'none', borderRadius: 6, width: 24, height: 24, cursor: 'pointer', color: T.sub, fontSize: 13 }}>×</button>
            </div>
            {items.length === 0 && <div style={{ fontSize: 11, color: T.mu, textAlign: 'center', padding: 24 }}>Rien pour l'instant.</div>}
            {items.map((n) => (
              <div key={n.id} style={{ display: 'flex', gap: 10, padding: '10px 2px', borderBottom: `1px solid ${T.cb}` }}>
                <span style={{ fontSize: 16, flexShrink: 0 }}>{KIND_ICONS[n.kind] ?? '·'}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: T.text }}>{n.title}</div>
                  {n.body && <div style={{ fontSize: 11, color: T.sub, lineHeight: 1.45, marginTop: 2 }}>{n.body}</div>}
                  <div style={{ fontSize: 9, color: T.mu, marginTop: 3 }}>{timeAgo(n.created_at)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
