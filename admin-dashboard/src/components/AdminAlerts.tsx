"use client";
// Server alerts for admins (backend utils/adminAlert emits 'adminAlert' to the admin room): no rider for an order,
// a rider who did not pick up, the daily SMS budget used up (sign-up codes paused), wallet / rider-cash mismatches,
// an Auto driver SOS. They used to reach only admin phones with the ZCS app; the web portal showed nothing.
// Shown as sticky cards (newest first, at most 4) until dismissed, with a link to where to act; a browser
// notification too when the admin allowed them for this site.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAdminSocket } from './AdminSocketProvider';

interface AlertPayload { title?: string; body?: string; type?: string; orderId?: string; at?: string }
interface ShownAlert { key: string; title: string; body: string; href: string | null; urgent: boolean; at: string }

const linkFor = (a: AlertPayload): string | null => {
  switch (a.type) {
    case 'NO_RIDER':
    case 'RIDER_PICKUP_TIMEOUT':
      return a.orderId ? `/orders?order=${encodeURIComponent(a.orderId)}` : '/orders';
    case 'WALLET_RECONCILE':
    case 'RIDER_CASH_RECONCILE':
      return '/finance';
    case 'AUTO_DRIVER_SOS':
      return '/auto-ride';
    default:
      return null;
  }
};
const URGENT = new Set(['NO_RIDER', 'AUTO_DRIVER_SOS', 'SMS_BUDGET']);

export default function AdminAlerts() {
  const { socket } = useAdminSocket();
  const [alerts, setAlerts] = useState<ShownAlert[]>([]);

  useEffect(() => {
    if (!socket) return;
    const onAlert = (a: AlertPayload) => {
      const title = String(a?.title || 'ZENV alert').slice(0, 120);
      const body = String(a?.body || '').slice(0, 400);
      const shown: ShownAlert = {
        key: `${a?.type || 'alert'}-${a?.orderId || ''}-${a?.at || Date.now()}`,
        title, body, href: linkFor(a || {}), urgent: URGENT.has(String(a?.type || '')), at: a?.at || new Date().toISOString(),
      };
      setAlerts(prev => [shown, ...prev.filter(x => x.key !== shown.key)].slice(0, 4));
      try {
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
          new Notification(title, { body, tag: shown.key });
        }
      } catch { /* notifications unavailable */ }
    };
    socket.on('adminAlert', onAlert);
    return () => { socket.off('adminAlert', onAlert); };
  }, [socket]);

  if (!alerts.length) return null;
  const canAsk = typeof Notification !== 'undefined' && Notification.permission === 'default';
  return (
    <div className="fixed right-4 top-16 z-[195] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2" role="alert" aria-live="assertive">
      {alerts.map(a => (
        <div key={a.key} className={`rounded-lg border px-3 py-2.5 text-sm shadow-pop ${a.urgent ? 'border-danger/30 bg-danger-soft' : 'border-warning/30 bg-warning-soft'}`}>
          <div className="flex items-start gap-2">
            <p className={`flex-1 font-semibold ${a.urgent ? 'text-danger-text' : 'text-warning-text'}`}>{a.title}</p>
            <button type="button" className="text-fg-muted hover:text-fg" aria-label="Dismiss alert" onClick={() => setAlerts(prev => prev.filter(x => x.key !== a.key))}>×</button>
          </div>
          {a.body && <p className="mt-0.5 text-fg-muted">{a.body}</p>}
          <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs">
            {a.href && <Link href={a.href} className="font-semibold text-accent-text underline" onClick={() => setAlerts(prev => prev.filter(x => x.key !== a.key))}>Open</Link>}
            {canAsk && (
              <button type="button" className="text-fg-muted underline" onClick={() => { try { void Notification.requestPermission(); } catch { /* ignore */ } }}>Alert me on this computer</button>
            )}
            <span className="ml-auto text-fg-subtle">{new Date(a.at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
