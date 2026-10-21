// Soundbox brain (renders nothing). Watches the orders list and the connection and speaks:
//  - new order: rings (vibration + chime + voice) at once, then every RING_REPEAT_MS until accepted /
//    rejected / silenced. Oldest waiting order first.
//  - status changes seen from the server: rider arrived, picked up, delivered, cancelled / timed out.
//  - connection lost (after OFFLINE_AFTER_MS) / back.
// Announcements are keyed per order + event, so a refetch or a duplicate socket event never repeats them.
import { useEffect, useRef, useState } from 'react';
import { AppState, Platform, Vibration } from 'react-native';
import { RING_REPEAT_MS } from '../config';
import { serverNow } from '../lib/http';
import { TIMED_OUT_REASON } from '../lib/model';
import { playRing, RING_SOUND_MS } from '../lib/push';
import { cancelNativeOrderAlert, nativeOrderAlert } from '../voice/kitchenService';
import { announce, cancelAnnouncements, forgetAnnouncement, getVoiceSnapshot, voiceEnabled } from '../voice/voice';
import { useStore } from './StoreProvider';
import type { Order } from '../types';

const RING_PATTERN = [0, 600, 250, 600, 250, 600];
/**
 * Stop re-ringing an order this long after it was placed. The server auto-cancels a Pending order after
 * PENDING_ORDER_TIMEOUT_MINUTES (default 15); if the app never hears about it (offline, missed event) the
 * order would otherwise ring every RING_REPEAT_MS forever. It stays on screen in New.
 */
const RING_MAX_AGE_MS = 20 * 60 * 1000;
const stillFresh = (o: Order) => {
  const t = o.createdAt ? new Date(o.createdAt).getTime() : NaN;
  // createdAt is server time: compare with the server's clock, not a phone clock that may be minutes off.
  return !Number.isFinite(t) || serverNow() - t < RING_MAX_AGE_MS;
};
const PRE_PICKUP = ['Pending', 'Accepted', 'Preparing', 'ReadyForPickup'];
const BEFORE_HANDOVER = ['Pending', 'Accepted', 'Preparing', 'ReadyForPickup', 'Picking'];

/**
 * One ring: vibration + the bundled loud ring sound (alarm channel, independent of the TTS engine), then
 * the voice. If the ring sound cannot play (notifications blocked, web), the voice is forced on at full
 * volume so a new order is never silent. `stillWaiting` stops a late voice for an order already handled.
 */
function ring(o: Order, stillWaiting: (id: string) => boolean) {
  if (Platform.OS !== 'web') Vibration.vibrate(RING_PATTERN);
  const amount = String(Math.round(o.totalPrice || 0));
  // `silent`: the ring sound already played, so the background heads-up must not add a second sound.
  const speak = (force: boolean, silent: boolean) => {
    if (!stillWaiting(o.id)) return;
    forgetAnnouncement(`new:${o.id}`);
    announce(
      `new:${o.id}`,
      { kind: 'newOrder', campus: o.campus, items: o.itemCount, total: o.totalPrice },
      { urgent: true, dedupeMs: 0, force, native: { orderNum: o.shortId, amount, silent } },
    );
  };
  playRing(`New order #${o.shortId}`).then((rang) => {
    if (!rang) {
      speak(true, false); // no ring sound: the voice (and the heads-up's own sound) is the sound
    } else if (voiceEnabled()) {
      setTimeout(() => speak(false, true), RING_SOUND_MS); // voice right after the ring, never on top of it
    } else if (AppState.currentState !== 'active') {
      // Voice off: still wake the phone with the native heads-up notification (no speech, no second sound).
      nativeOrderAlert('', o.shortId, amount, getVoiceSnapshot().settings.lang, true);
    }
  });
}

export function Announcer() {
  const { alertOrders, orders, ordersLoaded, conn } = useStore();

  // ── New-order ringing ──
  const alertRef = useRef(alertOrders);
  alertRef.current = alertOrders;
  // id → shortId of every order that rang (shortId names its native heads-up notification).
  const rung = useRef<Map<string, string>>(new Map());
  const alertKey = alertOrders.map((o) => `${o.id}:${o.partial ? 'p' : 'f'}`).join(',');
  const hasAlerts = alertOrders.length > 0;
  const isWaiting = (id: string) => alertRef.current.some((o) => o.id === id);
  const lastRingAt = useRef(0);
  // Bumped when the app comes back to the foreground: restarts the repeat timer below (Android may have
  // frozen JS timers, or stopped the kitchen service, while the phone was locked).
  const [armNonce, setArmNonce] = useState(0);

  useEffect(() => {
    const current = new Set(alertRef.current.map((o) => o.id));
    // Orders that left the alert list (accepted / rejected / silenced / cancelled): stop their pending
    // announcements and remove their heads-up notification.
    for (const [id, shortId] of rung.current) {
      if (!current.has(id)) {
        cancelAnnouncements(`new:${id}`);
        cancelNativeOrderAlert(shortId);
        rung.current.delete(id);
      }
    }
    // Brand-new orders ring right away (newest first, each once).
    const fresh = alertRef.current.filter((o) => !rung.current.has(o.id));
    for (const o of fresh.slice().reverse()) {
      rung.current.set(o.id, o.shortId);
      if (stillFresh(o)) {
        lastRingAt.current = Date.now();
        ring(o, isWaiting);
      }
    }
  }, [alertKey]);

  useEffect(() => {
    if (!hasAlerts) {
      if (Platform.OS !== 'web') Vibration.cancel();
      return;
    }
    const t = setInterval(() => {
      const oldest = alertRef.current.find(stillFresh);
      if (oldest) {
        lastRingAt.current = Date.now();
        ring(oldest, isWaiting);
      }
    }, RING_REPEAT_MS);
    return () => clearInterval(t);
  }, [hasAlerts, armNonce]);

  // Re-arm on return to the foreground: ring the oldest waiting order now (unless it rang moments ago)
  // instead of waiting for a timer that may have been frozen in the background, then restart the timer.
  // Pushes from the server (new order + waiting-order reminders) cover the time the app was closed.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') return;
      const oldest = alertRef.current.find(stillFresh);
      if (oldest && Date.now() - lastRingAt.current > RING_REPEAT_MS / 2) {
        lastRingAt.current = Date.now();
        ring(oldest, isWaiting);
      }
      setArmNonce((n) => n + 1);
    });
    return () => sub.remove();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Status changes ──
  const prev = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    if (!ordersLoaded) return;
    const before = prev.current;
    const next = new Map<string, string>();
    for (const o of orders) next.set(o.id, o.status);
    prev.current = next;
    if (!before) return; // first load: just remember, never announce history

    for (const o of orders) {
      const was = before.get(o.id);
      if (!was || was === o.status) continue;
      if (o.status === 'Picking' && PRE_PICKUP.includes(was)) {
        announce(`rider:${o.id}`, { kind: 'riderArrived', packed: !!o.readyAt || was === 'ReadyForPickup' }, { urgent: true });
      } else if ((o.status === 'PickedUp' || o.status === 'ArrivedAtGate') && BEFORE_HANDOVER.includes(was)) {
        announce(`picked:${o.id}`, { kind: 'pickedUp' });
      } else if (o.status === 'Delivered' && was !== 'Cancelled') {
        announce(`delivered:${o.id}`, { kind: 'delivered', amount: o.totalPrice });
      } else if (o.status === 'Cancelled' && was !== 'Delivered') {
        cancelAnnouncements(`new:${o.id}`);
        const timedOut = TIMED_OUT_REASON.test(o.cancellationReason || '');
        announce(`cancel:${o.id}`, { kind: timedOut ? 'timedOut' : 'cancelled' }, { urgent: true });
      }
    }
  }, [orders, ordersLoaded]);

  // ── Connection ──
  const wasOffline = useRef(false);
  useEffect(() => {
    if (conn === 'offline') {
      wasOffline.current = true;
      if (Platform.OS !== 'web') Vibration.vibrate([0, 300, 150, 300]);
      announce('conn:offline', { kind: 'offline' }, { dedupeMs: 5 * 60 * 1000 });
    } else if (conn === 'online' && wasOffline.current) {
      wasOffline.current = false;
      cancelAnnouncements('conn:offline');
      forgetAnnouncement('conn:offline');
      forgetAnnouncement('conn:online');
      announce('conn:online', { kind: 'online' }, { dedupeMs: 0 });
    }
  }, [conn]);

  // Unmount (logout / store switch): stop the vibration, any queued ring voice and the heads-up notifications.
  useEffect(() => () => {
    if (Platform.OS !== 'web') Vibration.cancel();
    for (const [id, shortId] of rung.current) {
      cancelAnnouncements(`new:${id}`);
      cancelNativeOrderAlert(shortId);
    }
    rung.current.clear();
  }, []);

  return null;
}
