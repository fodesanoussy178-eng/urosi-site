import { useEffect, useRef, useState } from 'react';
import { T } from '@/components/ui/theme';
import { useBodyScrollLock } from '@/components/ui/useBodyScrollLock';
import {
  fetchNotifications,
  fetchImportantNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  deleteNotification,
  archiveNotification,
  restoreNotification,
  deleteAllNotifications,
  isProtectedNotification,
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
  rating_request: '★',
  message: '💬',
  payment: '💶',
  delay: '⏱',
  spot_offer: '🎟',
  waitlist: '👥',
  kyc_rejected: '🪪',
};

const SWIPE_REVEAL = 84;

// Une seule rangee de notification : porte son propre menu "⋯" et son geste
// de balayage (glisser vers la gauche pour reveler "Supprimer"/"Archiver").
// Aucune suppression sur simple toucher : il faut soit ouvrir le menu, soit
// glisser au-dela du seuil ET taper le bouton revele.
function NotificationRow({
  n,
  onMarkRead,
  onDelete,
  onArchive,
  onRestore,
}: {
  n: Notification;
  onMarkRead: (id: string) => void;
  onDelete: (n: Notification) => void;
  onArchive: (n: Notification) => void;
  onRestore: (n: Notification) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragX, setDragX] = useState(0);
  const dragging = useRef<{ startX: number; active: boolean } | null>(null);
  const protectedNotif = isProtectedNotification(n);

  function onPointerDown(e: React.PointerEvent) {
    dragging.current = { startX: e.clientX, active: true };
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!dragging.current?.active) return;
    const delta = e.clientX - dragging.current.startX;
    setDragX(Math.max(-SWIPE_REVEAL, Math.min(0, delta)));
  }
  function endDrag() {
    if (!dragging.current) return;
    dragging.current.active = false;
    setDragX((x) => (x <= -SWIPE_REVEAL / 2 ? -SWIPE_REVEAL : 0));
  }

  const primaryAction = n.archived_at ? (
    <button
      onClick={() => {
        onRestore(n);
        setDragX(0);
      }}
      style={{ width: SWIPE_REVEAL, height: '100%', background: T.cyan, color: '#fff', border: 'none', fontSize: 10, fontWeight: 800, cursor: 'pointer' }}
    >
      Restaurer
    </button>
  ) : protectedNotif ? (
    <button
      onClick={() => {
        onArchive(n);
        setDragX(0);
      }}
      style={{ width: SWIPE_REVEAL, height: '100%', background: T.amber, color: '#000', border: 'none', fontSize: 10, fontWeight: 800, cursor: 'pointer' }}
    >
      Archiver
    </button>
  ) : (
    <button
      onClick={() => {
        onDelete(n);
        setDragX(0);
      }}
      style={{ width: SWIPE_REVEAL, height: '100%', background: '#dc2626', color: '#fff', border: 'none', fontSize: 10, fontWeight: 800, cursor: 'pointer' }}
    >
      Supprimer
    </button>
  );

  return (
    <div style={{ position: 'relative', overflow: 'hidden', borderBottom: `1px solid ${T.cb}` }}>
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, display: 'flex' }}>{primaryAction}</div>
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{
          position: 'relative',
          display: 'flex',
          gap: 10,
          padding: '10px 2px',
          background: T.card,
          transform: `translateX(${dragX}px)`,
          transition: dragging.current?.active ? 'none' : 'transform 160ms ease',
          touchAction: 'pan-y',
        }}
      >
        <span style={{ fontSize: 16, flexShrink: 0 }}>{KIND_ICONS[n.kind] ?? '·'}</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: T.text, flex: 1 }}>{n.title}</div>
            {!n.read_at && <span aria-hidden style={{ width: 6, height: 6, borderRadius: 3, background: T.cyan, flexShrink: 0 }} />}
          </div>
          {n.body && <div style={{ fontSize: 11, color: T.sub, lineHeight: 1.45, marginTop: 2 }}>{n.body}</div>}
          <div style={{ fontSize: 9, color: T.mu, marginTop: 3 }}>
            {timeAgo(n.created_at)}
            {protectedNotif && <span style={{ color: T.amber, fontWeight: 800 }}> · en cours de traitement</span>}
          </div>
        </div>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button
            aria-label="Options"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
            style={{ background: 'none', border: 'none', color: T.mu, fontSize: 16, fontWeight: 900, cursor: 'pointer', padding: '2px 6px' }}
          >
            ⋯
          </button>
          {menuOpen && (
            <div
              role="menu"
              style={{ position: 'absolute', top: 26, right: 0, zIndex: 5, background: T.card, border: `1px solid ${T.cb}`, borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,.35)', minWidth: 168, overflow: 'hidden' }}
            >
              {!n.read_at && (
                <button
                  onClick={() => {
                    onMarkRead(n.id);
                    setMenuOpen(false);
                  }}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', background: 'none', border: 'none', color: T.text, fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}
                >
                  Marquer comme lu
                </button>
              )}
              {n.archived_at ? (
                <button
                  onClick={() => {
                    onRestore(n);
                    setMenuOpen(false);
                  }}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', background: 'none', border: 'none', color: T.cyan, fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}
                >
                  Restaurer
                </button>
              ) : protectedNotif ? (
                <button
                  onClick={() => {
                    onArchive(n);
                    setMenuOpen(false);
                  }}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', background: 'none', border: 'none', color: T.amber, fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}
                >
                  Archiver
                </button>
              ) : (
                <button
                  onClick={() => {
                    onDelete(n);
                    setMenuOpen(false);
                  }}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', background: 'none', border: 'none', color: T.red, fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}
                >
                  Supprimer
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Cloche de notifications : pastille non-lus + panneau, alimentee en temps
// reel (supabase realtime) et rafraichie a l'ouverture. Suppression
// individuelle (soft delete reel en base), suppression totale avec
// confirmation, lecture individuelle/totale ; les notifications critiques
// non resolues (litige, KYC refuse...) ne peuvent qu'etre archivees.
export function NotificationBell({ profileId, onDataChanged }: { profileId: string; onDataChanged?: () => void }) {
  const [items, setItems] = useState<Notification[]>([]);
  const [important, setImportant] = useState<Notification[]>([]);
  const [showImportant, setShowImportant] = useState(false);
  const [open, setOpen] = useState(false);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const changed = useRef(onDataChanged);
  changed.current = onDataChanged;
  useBodyScrollLock(open);

  function notifyLocal(text: string) {
    setMessage(text);
    setTimeout(() => setMessage((m) => (m === text ? null : m)), 4000);
  }

  useEffect(() => {
    let active = true;
    fetchNotifications(profileId)
      .then((list) => active && setItems(list))
      .catch(() => undefined);
    fetchImportantNotifications(profileId)
      .then((list) => active && setImportant(list))
      .catch(() => undefined);
    const channel = subscribeToNotifications(profileId, {
      onInsert: (n) => {
        setItems((prev) => [n, ...prev]);
        if (n.is_critical) setImportant((prev) => [n, ...prev]);
        changed.current?.();
      },
      onUpdate: (n) => {
        setItems((prev) => (n.deleted_at || n.archived_at ? prev.filter((x) => x.id !== n.id) : prev.map((x) => (x.id === n.id ? n : x))));
        setImportant((prev) => {
          if (n.deleted_at) return prev.filter((x) => x.id !== n.id);
          if (!n.is_critical) return prev;
          return prev.some((x) => x.id === n.id) ? prev.map((x) => (x.id === n.id ? n : x)) : [n, ...prev];
        });
        changed.current?.();
      },
    });
    return () => {
      active = false;
      unsubscribeNotifications(channel);
    };
  }, [profileId]);

  const unread = items.filter((n) => !n.read_at).length;
  const hiddenImportant = important.filter((imp) => !items.some((i) => i.id === imp.id));

  async function openPanel() {
    setOpen(true);
    if (unread > 0) {
      try {
        await markAllNotificationsRead(profileId);
        setItems((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: new Date().toISOString() })));
        changed.current?.();
      } catch {
        // pas bloquant
      }
    }
  }

  async function handleMarkRead(id: string) {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read_at: n.read_at ?? new Date().toISOString() } : n)));
    try {
      await markNotificationRead(id);
    } catch {
      notifyLocal('Impossible de marquer comme lu.');
    } finally {
      changed.current?.();
    }
  }

  async function handleDelete(n: Notification) {
    const previous = items;
    setItems((prev) => prev.filter((x) => x.id !== n.id));
    try {
      await deleteNotification(n.id);
      changed.current?.();
    } catch {
      setItems(previous);
      notifyLocal('Suppression impossible.');
    }
  }

  async function handleArchive(n: Notification) {
    const previous = items;
    setItems((prev) => prev.filter((x) => x.id !== n.id));
    try {
      await archiveNotification(n.id);
    } catch {
      setItems(previous);
      notifyLocal('Archivage impossible.');
    }
  }

  async function handleRestore(n: Notification) {
    try {
      await restoreNotification(n.id);
      const restored = { ...n, archived_at: null };
      setItems((prev) => (prev.some((x) => x.id === n.id) ? prev : [restored, ...prev]));
      setImportant((prev) => prev.map((x) => (x.id === n.id ? restored : x)));
    } catch {
      notifyLocal('Restauration impossible.');
    }
  }

  async function handleMarkAllRead() {
    try {
      await markAllNotificationsRead(profileId);
      setItems((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: new Date().toISOString() })));
      changed.current?.();
    } catch {
      notifyLocal('Action impossible.');
    }
  }

  async function handleDeleteAll() {
    setConfirmDeleteAll(false);
    try {
      const result = await deleteAllNotifications();
      setItems((prev) => prev.filter((n) => isProtectedNotification(n)));
      changed.current?.();
      notifyLocal(
        result.keptProtected > 0
          ? `${result.deleted} notification(s) supprimée(s). ${result.keptProtected} en cours de traitement conservée(s).`
          : `${result.deleted} notification(s) supprimée(s).`,
      );
    } catch {
      notifyLocal('Suppression impossible.');
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
          className="urosi-modal-layer urosi-bottom-sheet-layer"
          role="dialog"
          aria-modal="true"
          aria-label="Notifications"
          style={{ background: 'rgba(0,0,0,.82)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
          onClick={() => setOpen(false)}
        >
          <div
            className="urosi-bottom-sheet"
            style={{ width: '100%', maxWidth: 430, maxHeight: '85vh', display: 'flex', flexDirection: 'column', background: T.card, borderRadius: '20px 20px 0 0', padding: '18px 16px 28px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontSize: 15, fontWeight: 900, color: T.text }}>Notifications</span>
              <button onClick={() => setOpen(false)} style={{ background: T.row, border: 'none', borderRadius: 6, width: 24, height: 24, cursor: 'pointer', color: T.sub, fontSize: 13 }}>×</button>
            </div>

            {!confirmDeleteAll ? (
              <div style={{ display: 'flex', gap: 14, marginBottom: 10 }}>
                <button onClick={handleMarkAllRead} style={{ background: 'none', border: 'none', color: T.cyan, fontSize: 11, fontWeight: 800, cursor: 'pointer', padding: 0 }}>
                  Tout marquer comme lu
                </button>
                <button
                  onClick={() => setConfirmDeleteAll(true)}
                  disabled={items.length === 0}
                  style={{ background: 'none', border: 'none', color: items.length === 0 ? T.mu : T.red, fontSize: 11, fontWeight: 800, cursor: items.length === 0 ? 'not-allowed' : 'pointer', padding: 0 }}
                >
                  Tout supprimer
                </button>
              </div>
            ) : (
              <div style={{ background: T.redBg, border: `1px solid ${T.redBorder}`, borderRadius: 10, padding: '10px 12px', marginBottom: 10 }}>
                <div style={{ fontSize: 11.5, color: T.text, fontWeight: 700, marginBottom: 8 }}>Supprimer toutes les notifications ? Cette action est définitive.</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={handleDeleteAll} style={{ flex: 1, background: T.red, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 0', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>
                    Confirmer
                  </button>
                  <button onClick={() => setConfirmDeleteAll(false)} style={{ flex: 1, background: T.row, color: T.text, border: `1px solid ${T.cb}`, borderRadius: 8, padding: '8px 0', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>
                    Annuler
                  </button>
                </div>
              </div>
            )}

            {message && <div role="status" style={{ fontSize: 10.5, color: T.sub, background: T.row, borderRadius: 8, padding: '7px 10px', marginBottom: 10 }}>{message}</div>}

            <div style={{ overflowY: 'auto', flex: 1 }}>
              {items.length === 0 && <div style={{ fontSize: 11, color: T.mu, textAlign: 'center', padding: 24 }}>Rien pour l'instant.</div>}
              {items.map((n) => (
                <NotificationRow key={n.id} n={n} onMarkRead={handleMarkRead} onDelete={handleDelete} onArchive={handleArchive} onRestore={handleRestore} />
              ))}

              {hiddenImportant.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <button
                    onClick={() => setShowImportant((v) => !v)}
                    style={{ width: '100%', textAlign: 'left', background: T.amberBg, border: `1px solid ${T.amberBorder}`, borderRadius: 10, padding: '9px 11px', color: T.amber, fontSize: 11, fontWeight: 800, cursor: 'pointer' }}
                  >
                    {showImportant ? '▾' : '▸'} Notifications importantes non résolues ({hiddenImportant.length})
                  </button>
                  {showImportant && (
                    <div style={{ marginTop: 6 }}>
                      {hiddenImportant.map((n) => (
                        <NotificationRow key={n.id} n={n} onMarkRead={handleMarkRead} onDelete={handleDelete} onArchive={handleArchive} onRestore={handleRestore} />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
