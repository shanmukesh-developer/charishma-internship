/**
 * Online payment for a PENDING_PAYMENT registration (only offered when GET /status says onlinePayEnabled and
 * the event accepts ONLINE). The server creates the Razorpay order (POST /registrations/:id/pay/razorpay-order,
 * 503 PAYMENT_NOT_CONFIGURED until the owner adds keys); Razorpay Standard Checkout runs in a WebView; card /
 * UPI details go straight to Razorpay, never through Zenvy. The checkout's "success" callback is NOT proof:
 * the app then polls GET /registrations/:id/payment until the server (Razorpay webhook) confirms, fails, or
 * the pay-by time passes.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Modal, ActivityIndicator, TouchableOpacity } from 'react-native';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { campusEventsApi, errorCopy, inr, type PaymentBlock, type RegStatus } from './campusEventsApi';
import { usePalette, Btn, Notice } from './ui';

type Phase = 'order' | 'checkout' | 'verifying' | 'confirmed' | 'failed' | 'pending' | 'error';

const html = (o: { keyId: string; orderId: string; amountPaise: number; currency: string; title: string; color: string }) => `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>body{margin:0;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;color:#555}</style></head>
<body><p>Opening secure payment…</p>
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
<script>
  function send(m){ window.ReactNativeWebView.postMessage(JSON.stringify(m)); }
  try {
    var rzp = new Razorpay({
      key: ${JSON.stringify(o.keyId)}, order_id: ${JSON.stringify(o.orderId)}, amount: ${Number(o.amountPaise)}, currency: ${JSON.stringify(o.currency)},
      name: 'ZenWe Campus Events', description: ${JSON.stringify(o.title.slice(0, 80))},
      handler: function(){ send({ type: 'done' }); },
      modal: { ondismiss: function(){ send({ type: 'dismissed' }); } },
      theme: { color: ${JSON.stringify(o.color)} }
    });
    rzp.on('payment.failed', function(r){ send({ type: 'failed', reason: (r && r.error && r.error.description) || '' }); });
    rzp.open();
  } catch (e) { send({ type: 'error', reason: String(e && e.message || e) }); }
</script></body></html>`;

export default function PayOnline({ visible, registrationId, title, onClose }: {
  visible: boolean; registrationId: string; title: string; onClose: (result: { status: RegStatus; payment: PaymentBlock } | null) => void;
}) {
  const p = usePalette();
  const [phase, setPhase] = useState<Phase>('order');
  const [order, setOrder] = useState<{ keyId: string; orderId: string; amountPaise: number; currency: string } | null>(null);
  const [msg, setMsg] = useState<string>('');
  const last = useRef<{ status: RegStatus; payment: PaymentBlock } | null>(null);
  const polling = useRef(false);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    setPhase('order');
    setOrder(null);
    setMsg('');
    campusEventsApi.razorpayOrder(registrationId)
      .then((o) => { if (alive) { setOrder(o); setPhase('checkout'); } })
      .catch((e) => { if (alive) { setMsg(errorCopy(e).message); setPhase('error'); } });
    return () => { alive = false; polling.current = false; };
  }, [visible, registrationId]);

  /** Server truth: poll until confirmed / failed / ~90 s. */
  const verify = async () => {
    setPhase('verifying');
    polling.current = true;
    const until = Date.now() + 90000;
    while (polling.current && Date.now() < until) {
      try {
        const r = await campusEventsApi.paymentStatus(registrationId);
        last.current = { status: r.status, payment: r.payment };
        if (r.confirmed || r.status === 'CONFIRMED' || r.status === 'PENDING_APPROVAL') { setPhase('confirmed'); return; }
        if (['FAILED', 'TIMEOUT', 'CANCELLED'].includes(r.payment.status) || ['EXPIRED', 'CANCELLED'].includes(r.status)) { setPhase('failed'); return; }
      } catch { /* keep polling through blips */ }
      await new Promise((res) => setTimeout(res, 3000));
    }
    if (polling.current) setPhase('pending');
  };

  const close = () => { polling.current = false; onClose(last.current); };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close}>
      <View style={{ flex: 1, backgroundColor: p.bg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 44, paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: p.border }}>
          <Text style={{ flex: 1, fontSize: 17, fontWeight: '900', color: p.text }}>Secure payment</Text>
          <TouchableOpacity onPress={close} accessibilityRole="button" accessibilityLabel="Close payment" style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="close" size={24} color={p.sub} />
          </TouchableOpacity>
        </View>
        {phase === 'checkout' && order ? (
          <WebView
            originWhitelist={['*']}
            source={{ html: html({ ...order, title, color: p.grad[0] }), baseUrl: 'https://checkout.razorpay.com' }}
            javaScriptEnabled
            onMessage={(e) => {
              let m: any = null;
              try { m = JSON.parse(e.nativeEvent.data); } catch { return; }
              if (m?.type === 'done') verify();
              else if (m?.type === 'failed') { setMsg(m.reason || 'The payment did not go through.'); verify(); }
              else if (m?.type === 'dismissed') verify();
              else if (m?.type === 'error') { setMsg('Could not open the payment page.'); setPhase('error'); }
            }}
            startInLoadingState
            renderLoading={() => <ActivityIndicator color={p.accent} style={{ marginTop: 40 }} />}
          />
        ) : (
          <View style={{ flex: 1, padding: 24, justifyContent: 'center' }}>
            {phase === 'order' ? <><ActivityIndicator color={p.accent} size="large" /><Text style={{ color: p.sub, textAlign: 'center', marginTop: 10 }}>Preparing your payment…</Text></> : null}
            {phase === 'verifying' ? <><ActivityIndicator color={p.accent} size="large" /><Text style={{ color: p.text, textAlign: 'center', marginTop: 12, fontWeight: '800' }}>Checking with the payment provider…</Text><Text style={{ color: p.sub, textAlign: 'center', marginTop: 6 }}>Your place is confirmed only when Razorpay confirms the payment to ZenWe.</Text></> : null}
            {phase === 'confirmed' ? <><Ionicons name="checkmark-circle" size={56} color={p.success} style={{ alignSelf: 'center' }} /><Text style={{ color: p.text, textAlign: 'center', fontSize: 18, fontWeight: '900', marginTop: 8 }}>Payment confirmed</Text>{last.current ? <Text style={{ color: p.sub, textAlign: 'center', marginTop: 4 }}>{inr(last.current.payment.total)} received.</Text> : null}</> : null}
            {phase === 'failed' ? <Notice tone="danger" icon="close-circle-outline">{msg || 'The payment failed or was cancelled. You were not charged twice; you can try again while your place is held.'}</Notice> : null}
            {phase === 'pending' ? <Notice tone="warn" icon="time-outline">We have not heard back from the payment provider yet. If money left your account, your place is confirmed automatically when it arrives (or refunded if the place is gone). Check My registrations in a few minutes.</Notice> : null}
            {phase === 'error' ? <Notice tone="danger" icon="warning-outline">{msg || 'Online payment is not available right now.'}</Notice> : null}
            {phase !== 'order' && phase !== 'verifying' ? <Btn label={phase === 'confirmed' ? 'Done' : 'Close'} onPress={close} style={{ marginTop: 16 }} /> : null}
          </View>
        )}
      </View>
    </Modal>
  );
}
