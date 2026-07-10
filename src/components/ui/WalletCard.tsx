import { useCallback, useEffect, useState } from 'react';
import { T } from '@/components/ui/theme';
import { formatEuros } from '@/lib/format';
import {
  fetchWallet,
  fetchWalletTransactions,
  walletDeposit,
  walletWithdraw,
  TX_KIND_LABELS,
  type Wallet,
  type WalletTransaction,
} from '@/features/wallet/walletService';

function euros(cents: number): string {
  return formatEuros(cents).replace(' EUR', ' €');
}

// Wallet partage Worker/Structure : solde, historique, et selon le role
// provisionnement (structure) ou retrait (travailleur).
export function WalletCard({ profileId, mode, notif }: { profileId: string; mode: 'worker' | 'structure'; notif: (m: string) => void }) {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [txs, setTxs] = useState<WalletTransaction[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const w = await fetchWallet(profileId);
      setWallet(w);
      if (w) setTxs(await fetchWalletTransactions(w.id));
    } catch {
      // wallet pas encore cree : rien a afficher
    }
  }, [profileId]);

  useEffect(() => {
    load();
  }, [load]);

  async function move(action: 'deposit' | 'withdraw') {
    if (busy) return;
    const label = action === 'deposit' ? 'Montant à provisionner (€)' : 'Montant à retirer (€)';
    const raw = window.prompt(label, action === 'deposit' ? '100' : '');
    if (!raw) return;
    const amount = Math.round(Number(raw.replace(',', '.')) * 100);
    if (!Number.isFinite(amount) || amount <= 0) {
      notif('Montant invalide.');
      return;
    }
    setBusy(true);
    try {
      const balance = action === 'deposit' ? await walletDeposit(amount) : await walletWithdraw(amount);
      notif(action === 'deposit' ? `✓ Wallet provisionné — solde ${euros(balance)}.` : `✓ Retrait demandé — solde ${euros(balance)}.`);
      await load();
    } catch (e) {
      notif(e instanceof Error ? e.message : 'Opération impossible.');
    } finally {
      setBusy(false);
    }
  }

  const balance = wallet?.balance_cents ?? 0;
  const shown = showAll ? txs : txs.slice(0, 5);

  return (
    <div style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 14, padding: 15 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 9, fontWeight: 700, color: T.mu, textTransform: 'uppercase', letterSpacing: 0.5 }}>Wallet</span>
        <span style={{ fontSize: 8.5, color: T.mu }}>paiements sécurisés UROSI</span>
      </div>
      <div style={{ fontSize: 28, fontWeight: 900, color: balance < 0 ? T.amber : T.text, letterSpacing: -1, marginBottom: 10 }}>{euros(balance)}</div>
      {mode === 'structure' && balance < 0 && (
        <div style={{ fontSize: 10, color: T.amber, background: T.amberBg, border: `1px solid ${T.amberBorder}`, borderRadius: 8, padding: '7px 10px', marginBottom: 10, lineHeight: 1.5 }}>
          Solde à provisionner : les rémunérations versées dépassent ton provisionnement.
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 6, marginBottom: 12 }}>
        {mode === 'structure' ? (
          <button onClick={() => move('deposit')} disabled={busy} style={{ background: T.grad, color: '#fff', border: 'none', borderRadius: 9, padding: '10px 0', fontSize: 12, fontWeight: 900, cursor: 'pointer' }}>
            {busy ? '…' : '＋ Provisionner le wallet'}
          </button>
        ) : (
          <button
            onClick={() => move('withdraw')}
            disabled={busy || balance < 100}
            style={{ background: balance >= 100 ? '#fff' : T.row, color: balance >= 100 ? '#000' : T.mu, border: 'none', borderRadius: 9, padding: '10px 0', fontSize: 12, fontWeight: 900, cursor: balance >= 100 ? 'pointer' : 'not-allowed' }}
          >
            {busy ? '…' : '↓ Retirer vers mon compte'}
          </button>
        )}
      </div>
      <div style={{ fontSize: 9, fontWeight: 700, color: T.mu, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 7 }}>Historique</div>
      {txs.length === 0 && <div style={{ fontSize: 11, color: T.mu }}>Aucun mouvement pour l'instant.</div>}
      {shown.map((tx) => (
        <div key={tx.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '7px 0', borderTop: `1px solid ${T.cb}` }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: T.text }}>{TX_KIND_LABELS[tx.kind]}</div>
            {tx.label && <div style={{ fontSize: 9.5, color: T.mu, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tx.label}</div>}
            <div style={{ fontSize: 8.5, color: T.mu }}>{new Date(tx.created_at).toLocaleDateString('fr-FR')}</div>
          </div>
          <span style={{ fontSize: 12.5, fontWeight: 900, color: tx.amount_cents > 0 ? T.green : T.red, flexShrink: 0 }}>
            {tx.amount_cents > 0 ? '+' : ''}
            {euros(tx.amount_cents)}
          </span>
        </div>
      ))}
      {txs.length > 5 && (
        <button onClick={() => setShowAll((v) => !v)} style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', fontSize: 10.5, color: T.cyan, fontWeight: 700, padding: '8px 0 0' }}>
          {showAll ? 'Réduire' : `Voir les ${txs.length} mouvements`}
        </button>
      )}
    </div>
  );
}
