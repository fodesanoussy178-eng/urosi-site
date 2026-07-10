import { useEffect, useRef, useState } from 'react';
import { T, inp } from '@/components/ui/theme';
import {
  fetchMessages,
  markThreadRead,
  sendMessage,
  subscribeToThread,
  unsubscribe,
  type Message,
} from '@/features/messages/messagesService';

// Fil de discussion temps reel entre le travailleur et la structure d'une
// candidature acceptee. Utilise cote Worker et cote Structure.
export function ChatSheet({
  applicationId,
  myId,
  title,
  onClose,
}: {
  applicationId: string;
  myId: string;
  title: string;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    fetchMessages(applicationId)
      .then((list) => {
        if (!active) return;
        setMessages(list);
        markThreadRead(applicationId, myId).catch(() => undefined);
      })
      .catch(() => active && setError('Impossible de charger la discussion.'));

    const channel = subscribeToThread(applicationId, (m) => {
      setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
      if (m.sender_id !== myId) {
        markThreadRead(applicationId, myId).catch(() => undefined);
      }
    });
    return () => {
      active = false;
      unsubscribe(channel);
    };
  }, [applicationId, myId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  async function send() {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    try {
      const m = await sendMessage(applicationId, myId, body);
      setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
      setDraft('');
    } catch {
      setError("Message non envoyé — la discussion s'ouvre une fois la candidature acceptée.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.85)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 500 }}
      onClick={onClose}
    >
      <div
        style={{ width: '100%', maxWidth: 430, background: T.card, borderRadius: '20px 20px 0 0', padding: '16px 14px 22px', display: 'flex', flexDirection: 'column', height: '72vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 900, color: T.text }}>💬 Discussion</div>
            <div style={{ fontSize: 10, color: T.mu, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
          </div>
          <button onClick={onClose} style={{ background: T.row, border: 'none', borderRadius: 6, width: 24, height: 24, cursor: 'pointer', color: T.sub, fontSize: 13, flexShrink: 0 }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, padding: '4px 2px' }}>
          {messages.length === 0 && (
            <div style={{ fontSize: 11, color: T.mu, textAlign: 'center', padding: 24, lineHeight: 1.6 }}>
              Pas encore de message.
              <br />
              Coordonnez-vous ici (horaires, accès, consignes…).
            </div>
          )}
          {messages.map((m) => {
            const mine = m.sender_id === myId;
            return (
              <div key={m.id} style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start' }}>
                <div
                  style={{
                    maxWidth: '78%',
                    background: mine ? '#1d4ed8' : T.row,
                    color: mine ? '#fff' : T.text,
                    border: mine ? 'none' : `1px solid ${T.cb}`,
                    borderRadius: mine ? '12px 12px 3px 12px' : '12px 12px 12px 3px',
                    padding: '8px 11px',
                    fontSize: 12.5,
                    lineHeight: 1.45,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {m.body}
                  <div style={{ fontSize: 8.5, color: mine ? '#bfdbfe' : T.mu, marginTop: 3, textAlign: 'right' }}>
                    {new Date(m.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        {error && <div style={{ fontSize: 10.5, color: T.amber, padding: '6px 2px' }}>{error}</div>}
        <div style={{ display: 'flex', gap: 7, marginTop: 8 }}>
          <input
            aria-label="Message"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            placeholder="Écris un message…"
            style={{ ...inp, marginBottom: 0, flex: 1 }}
          />
          <button
            onClick={send}
            disabled={busy || !draft.trim()}
            style={{ background: draft.trim() && !busy ? T.grad : T.row, color: draft.trim() && !busy ? '#fff' : T.mu, border: 'none', borderRadius: 9, padding: '0 16px', fontSize: 13, fontWeight: 900, cursor: draft.trim() && !busy ? 'pointer' : 'not-allowed', flexShrink: 0 }}
          >
            ➤
          </button>
        </div>
      </div>
    </div>
  );
}
