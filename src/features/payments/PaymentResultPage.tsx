import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Logo } from '@/components/ui/Logo';
import { T, FONT } from '@/components/ui/theme';
import { supabase } from '@/lib/supabase';

// Page de retour Stripe Checkout. NE CONFIRME JAMAIS la mission elle-même :
// seule la confirmation vient du webhook. En mode succès, on interroge
// simplement l'état de la candidature jusqu'à ce que le webhook l'ait passée
// à 'paid'/'accepted' (délai habituel : quelques secondes).
export function PaymentResultPage({ outcome }: { outcome: 'success' | 'cancel' }) {
  const [params] = useSearchParams();
  const applicationId = params.get('application_id');
  const [confirmed, setConfirmed] = useState(false);
  const [waited, setWaited] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    if (outcome !== 'success' || !applicationId) return;
    let active = true;

    const appId = applicationId;
    async function poll() {
      const { data } = await supabase
        .from('applications')
        .select('status, stripe_payment_status')
        .eq('id', appId)
        .maybeSingle();
      if (!active) return;
      if (data?.stripe_payment_status === 'paid') {
        setConfirmed(true);
        if (timer.current) clearInterval(timer.current);
      }
    }

    poll();
    timer.current = setInterval(() => {
      setWaited((w) => w + 1);
      poll();
    }, 2500);
    return () => {
      active = false;
      if (timer.current) clearInterval(timer.current);
    };
  }, [outcome, applicationId]);

  const shell = (children: React.ReactNode) => (
    <div style={{ minHeight: '100vh', background: T.bg, display: 'flex', justifyContent: 'center', fontFamily: FONT, padding: '24px 16px' }}>
      <div style={{ width: '100%', maxWidth: 430 }}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}><Logo sz={54} /></div>
        <div style={{ background: T.card, border: `1px solid ${T.cb}`, borderRadius: 16, padding: 20, textAlign: 'center' }}>{children}</div>
      </div>
    </div>
  );

  const backButton = (
    <button onClick={() => window.location.assign('/app')} style={{ width: '100%', background: '#fff', color: '#000', border: 'none', borderRadius: 10, padding: '13px 0', fontSize: 14, fontWeight: 900, cursor: 'pointer', marginTop: 16 }}>
      Retour à mes missions
    </button>
  );

  if (outcome === 'cancel') {
    return shell(
      <>
        <div style={{ fontSize: 34, marginBottom: 6 }}>⚠️</div>
        <div style={{ fontSize: 16, fontWeight: 900, color: T.amber, marginBottom: 6 }}>Paiement non terminé</div>
        <div style={{ fontSize: 12, color: T.sub, lineHeight: 1.55 }}>
          La mission n'a pas été confirmée et le candidat n'a pas été affecté. Aucun montant n'a été débité. Tu peux relancer le paiement depuis la candidature quand tu veux.
        </div>
        {backButton}
      </>,
    );
  }

  if (confirmed) {
    return shell(
      <>
        <div style={{ fontSize: 34, marginBottom: 6 }}>✅</div>
        <div style={{ fontSize: 16, fontWeight: 900, color: T.green, marginBottom: 6 }}>Paiement confirmé</div>
        <div style={{ fontSize: 12, color: T.sub, lineHeight: 1.55 }}>
          La mission est confirmée et le travailleur est affecté. Le fil de discussion est ouvert et le pointage QR sera disponible le jour de la mission.
        </div>
        {backButton}
      </>,
    );
  }

  return shell(
    <>
      <div style={{ fontSize: 34, marginBottom: 6 }}>⏳</div>
      <div style={{ fontSize: 16, fontWeight: 900, color: T.text, marginBottom: 6 }}>Paiement reçu — confirmation en cours</div>
      <div style={{ fontSize: 12, color: T.sub, lineHeight: 1.55 }}>
        Ton paiement est bien reçu. La confirmation de la mission est en cours de validation sécurisée{waited > 6 ? ' (cela peut prendre quelques instants de plus)' : ''}…
      </div>
      {backButton}
    </>,
  );
}
