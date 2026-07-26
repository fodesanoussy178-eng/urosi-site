import { useCallback, useEffect, useState } from 'react';
import { T } from '@/components/ui/theme';
import { formatEuros } from '@/lib/format';
import {
  fetchWallet,
  fetchWalletFundSummary,
  fetchWalletTransactions,
  TX_KIND_LABELS,
  type Wallet,
  type WalletTransaction,
  type WalletFundSummary,
} from '@/features/wallet/walletService';
import { fetchStripeBalance, requestWorkerPayout, type StripeBalance } from '@/features/payments/stripeService';

function euros(cents: number): string {
  return formatEuros(cents).replace(' EUR', ' €');
}

// Wallet Worker/Structure : le solde travailleur vient du compte Stripe
// connecté (stripe-connect-balance) — plus de simulation interne. Le solde
// structure reste sur wallet_fund_summary (pas de compte Connect côté
// structure, cf. Module 2 : autorisation/capture par carte). wallet_transactions
// n'est plus conservé que pour l'historique, des deux côtés.
export function WalletCard({
  profileId,
  mode,
  amountsVisible: controlledAmountsVisible,
  onAmountsVisibleChange,
}: {
  profileId: string;
  mode: 'worker' | 'structure';
  amountsVisible?: boolean;
  onAmountsVisibleChange?: (visible: boolean) => void;
}) {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [txs, setTxs] = useState<WalletTransaction[]>([]);
  const [summary, setSummary] = useState<WalletFundSummary>({ available_cents: 0, pending_cents: 0, blocked_cents: 0 });
  const [balance, setBalance] = useState<StripeBalance | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [internalAmountsVisible, setInternalAmountsVisible] = useState(mode === 'structure');
  const amountsVisible = controlledAmountsVisible ?? internalAmountsVisible;
  const [payoutState, setPayoutState] = useState<'idle' | 'loading' | 'error' | 'done'>('idle');
  const [payoutError, setPayoutError] = useState<string | null>(null);

  function setAmountsVisible(visible: boolean) {
    if (onAmountsVisibleChange) onAmountsVisibleChange(visible);
    else setInternalAmountsVisible(visible);
  }

  const load = useCallback(async () => {
    try {
      const w = await fetchWallet(profileId);
      setWallet(w);
      if (w) {
        const transactions = await fetchWalletTransactions(w.id);
        setTxs(transactions);
      }
    } catch {
      // wallet pas encore cree : rien a afficher
    }

    if (mode === 'worker') {
      try {
        setBalance(await fetchStripeBalance());
      } catch {
        setBalance(null);
      }
    } else {
      try {
        setSummary(await fetchWalletFundSummary());
      } catch {
        // pas encore de fonds : rien a afficher
      }
    }
  }, [profileId, mode]);

  useEffect(() => {
    load();
  }, [load]);

  const available = mode === 'worker' ? (balance?.available_cents ?? 0) : wallet ? summary.available_cents : 0;
  const pending = mode === 'worker' ? (balance?.pending_cents ?? 0) : summary.pending_cents;
  const blocked = mode === 'worker' ? 0 : summary.blocked_cents;
  const total = available + pending + blocked;
  const shown = showAll ? txs : txs.slice(0, 5);

  // KYC Stripe pas terminé : soit l'onboarding Connect n'a jamais été lancé,
  // soit il l'a été mais Stripe n'a pas encore activé les versements.
  const kycIncomplete = mode === 'worker' && balance !== null && (!balance.onboarded || !balance.payouts_enabled);
  const canRequestPayout = mode === 'worker' && Boolean(balance?.payouts_enabled) && available > 0;

  async function handleRequestPayout() {
    setPayoutState('loading');
    setPayoutError(null);
    try {
      await requestWorkerPayout();
      setPayoutState('done');
      await load();
    } catch (err) {
      setPayoutState('error');
      setPayoutError(err instanceof Error ? err.message : 'Erreur lors de la demande de virement.');
    }
  }

  return (
    <div style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 14, padding: 15 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 9, fontWeight: 700, color: T.mu, textTransform: 'uppercase', letterSpacing: 0.5 }}>Wallet</span>
        {mode === 'worker' ? (
          <button type="button" onClick={() => setAmountsVisible(!amountsVisible)} aria-label={amountsVisible ? 'Masquer les montants' : 'Afficher les montants'} style={{ background: T.row, color: T.cyan, border: `1px solid ${T.cb}`, borderRadius: 8, padding: '5px 8px', fontSize: 9, fontWeight: 800, cursor: 'pointer' }}>
            {amountsVisible ? 'Masquer' : 'Afficher'}
          </button>
        ) : (
          <span style={{ fontSize: 8.5, color: T.mu }}>paiements sécurisés UROSI</span>
        )}
      </div>
      <div style={{ color: T.mu, fontSize: 8, marginBottom: 2 }}>Solde total</div>
      <div style={{ fontSize: 28, fontWeight: 900, color: total < 0 ? T.amber : T.text, letterSpacing: -1, marginBottom: 10 }}>{amountsVisible ? euros(total) : '•••'}</div>
      {mode === 'structure' && available < 0 && (
        <div style={{ fontSize: 10, color: T.amber, background: T.amberBg, border: `1px solid ${T.amberBorder}`, borderRadius: 8, padding: '7px 10px', marginBottom: 10, lineHeight: 1.5 }}>
          Solde à provisionner : les rémunérations versées dépassent ton provisionnement.
        </div>
      )}
      {kycIncomplete && (
        <div style={{ fontSize: 10, color: T.amber, background: T.amberBg, border: `1px solid ${T.amberBorder}`, borderRadius: 8, padding: '7px 10px', marginBottom: 10, lineHeight: 1.5 }}>
          {!balance?.onboarded
            ? 'Configure ton compte de versement Stripe pour recevoir tes paiements.'
            : 'Ton compte Stripe est en cours de vérification : les versements ne sont pas encore activés.'}
        </div>
      )}
      {/* « En attente » et « Bloqué » ne s'affichent que s'ils sont non nuls :
          un montant en attente permanent crée de la frustration. */}
      {(() => {
        const tiles: Array<[string, number, string]> = [['Disponible', available, T.green]];
        if (pending > 0) tiles.push(['En attente · J+3', pending, T.amber]);
        if (blocked > 0) tiles.push(['Bloqué', blocked, T.red]);
        return (
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${tiles.length}, 1fr)`, gap: 6, marginBottom: 12 }}>
            {tiles.map(([label, amount, color]) => (
              <div key={label} style={{ background: T.row, border: `1px solid ${T.cb}`, borderRadius: 9, padding: '8px 6px', minWidth: 0 }}>
                <div style={{ color: T.mu, fontSize: 8, marginBottom: 3 }}>{label}</div>
                <div style={{ color, fontSize: 10.5, fontWeight: 900, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {amountsVisible ? euros(amount) : '•••'}
                </div>
              </div>
            ))}
          </div>
        );
      })()}
      {mode === 'worker' && (
        <div style={{ marginBottom: 12 }}>
          <button
            type="button"
            onClick={handleRequestPayout}
            disabled={!canRequestPayout || payoutState === 'loading'}
            style={{
              width: '100%',
              background: canRequestPayout ? T.cyan : T.row,
              color: canRequestPayout ? '#fff' : T.mu,
              border: `1px solid ${T.cb}`,
              borderRadius: 9,
              padding: '9px 10px',
              fontSize: 11,
              fontWeight: 800,
              cursor: canRequestPayout && payoutState !== 'loading' ? 'pointer' : 'not-allowed',
            }}
          >
            {payoutState === 'loading' ? 'Demande en cours…' : 'Demander un virement'}
          </button>
          {payoutState === 'error' && payoutError && (
            <div style={{ fontSize: 9.5, color: T.red, marginTop: 5 }}>{payoutError}</div>
          )}
          {payoutState === 'done' && (
            <div style={{ fontSize: 9.5, color: T.green, marginTop: 5 }}>Virement demandé.</div>
          )}
        </div>
      )}
      <div style={{ fontSize: 9, fontWeight: 700, color: T.mu, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 7 }}>Historique</div>
      {txs.length === 0 && <div style={{ fontSize: 11, color: T.mu }}>Aucun mouvement pour l'instant.</div>}
      {shown.map((tx) => (
        <div key={tx.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '7px 0', borderTop: `1px solid ${T.cb}` }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: T.text }}>{TX_KIND_LABELS[tx.kind]}</div>
            {tx.label && <div style={{ fontSize: 9.5, color: T.mu, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tx.label}</div>}
            <div style={{ fontSize: 8.5, color: T.mu }}>{new Date(tx.created_at).toLocaleDateString('fr-FR')}</div>
            {tx.fund_status !== 'available' && (
              <div style={{ fontSize: 8.5, color: tx.fund_status === 'pending' ? T.amber : T.red }}>
                {tx.fund_status === 'pending'
                  ? `En attente${tx.available_at ? ` · disponible le ${new Date(tx.available_at).toLocaleDateString('fr-FR')}` : ''}`
                  : 'Bloqué'}
              </div>
            )}
          </div>
          <span style={{ fontSize: 12.5, fontWeight: 900, color: tx.amount_cents > 0 ? T.green : T.red, flexShrink: 0 }}>
            {amountsVisible ? `${tx.amount_cents > 0 ? '+' : ''}${euros(tx.amount_cents)}` : '•••'}
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
