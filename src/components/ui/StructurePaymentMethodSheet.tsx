import { useEffect, useRef, useState } from 'react';
import type { StripePaymentElement } from '@stripe/stripe-js';
import { T, FONT } from '@/components/ui/theme';
import { getStripe, setupStructurePaymentMethod } from '@/features/payments/stripeService';
import { describeError } from '@/lib/errors';

// Enregistrement du moyen de paiement (SetupIntent, aucun débit) — affiché
// UNE SEULE FOIS, au moment de la première mission rémunérée d'une structure.
// Carte + Apple Pay + Google Pay via le Payment Element (automatic_payment_
// methods côté serveur) : Apple Pay nécessite en plus que le domaine soit
// enregistré dans le Dashboard Stripe (étape opérationnelle, pas du code).
export function StructurePaymentMethodSheet({
  structureId,
  onClose,
  onSaved,
}: {
  structureId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const stripeRef = useRef<Awaited<ReturnType<typeof getStripe>>>(null);
  const elementsRef = useRef<ReturnType<NonNullable<Awaited<ReturnType<typeof getStripe>>>['elements']> | null>(null);
  const paymentElementRef = useRef<StripePaymentElement | null>(null);
  const mountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stripe = await getStripe();
        if (!stripe) throw new Error('Paiement indisponible pour le moment.');
        const { client_secret } = await setupStructurePaymentMethod(structureId, crypto.randomUUID());
        if (cancelled) return;
        stripeRef.current = stripe;
        const elements = stripe.elements({ clientSecret: client_secret });
        elementsRef.current = elements;
        const paymentElement = elements.create('payment');
        paymentElementRef.current = paymentElement;
        if (mountRef.current) paymentElement.mount(mountRef.current);
        setReady(true);
      } catch (cause) {
        if (!cancelled) setError(describeError(cause, "l'enregistrement du moyen de paiement"));
      }
    })();
    return () => {
      cancelled = true;
      paymentElementRef.current?.unmount();
    };
  }, [structureId]);

  async function confirm() {
    const stripe = stripeRef.current;
    const elements = elementsRef.current;
    if (!stripe || !elements) return;
    setBusy(true);
    setError(null);
    try {
      const { error: confirmError } = await stripe.confirmSetup({
        elements,
        redirect: 'if_required',
        confirmParams: { return_url: `${window.location.origin}/app` },
      });
      if (confirmError) throw new Error(confirmError.message ?? 'Enregistrement refusé.');
      onSaved();
    } catch (cause) {
      setError(describeError(cause, "l'enregistrement du moyen de paiement"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Enregistrer un moyen de paiement"
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 2000 }}
      onClick={onClose}
    >
      <div style={{ width: '100%', maxWidth: 420, background: T.card, borderRadius: '20px 20px 0 0', padding: '18px 16px 26px', fontFamily: FONT }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontSize: 15, fontWeight: 900, color: T.text }}>Moyen de paiement</span>
          <button onClick={onClose} style={{ background: T.row, border: 'none', borderRadius: 6, width: 26, height: 26, cursor: 'pointer', color: T.sub, fontSize: 14 }}>×</button>
        </div>
        <p style={{ color: T.sub, fontSize: 11.5, lineHeight: 1.5, marginTop: 0 }}>
          Ta carte (ou Apple Pay / Google Pay) est enregistrée sans aucun débit. Elle ne sera prélevée qu'à la validation de présence du travailleur — jamais avant.
        </p>
        {error && <div style={{ background: T.redBg, border: `1px solid ${T.redBorder}`, borderRadius: 10, padding: 10, color: T.red, fontSize: 11.5, marginBottom: 10 }}>{error}</div>}
        <div ref={mountRef} style={{ minHeight: ready ? undefined : 80 }} />
        {!ready && !error && <div style={{ color: T.mu, fontSize: 11, textAlign: 'center', padding: '20px 0' }}>Chargement…</div>}
        <button
          type="button"
          disabled={!ready || busy}
          onClick={confirm}
          style={{ width: '100%', marginTop: 14, background: T.text, color: T.bg, border: 'none', borderRadius: 12, padding: '13px 0', fontSize: 13.5, fontWeight: 900, cursor: ready && !busy ? 'pointer' : 'not-allowed', opacity: ready && !busy ? 1 : 0.6 }}
        >
          {busy ? 'Enregistrement…' : 'Enregistrer ce moyen de paiement'}
        </button>
      </div>
    </div>
  );
}
