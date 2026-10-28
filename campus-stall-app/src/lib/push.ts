// Push (expo-notifications). The server (backend/modules/campusBooking/services/notify.js -> utils/storePush.js)
// sends FCM pushes to this stall's ZCS Campus Stall devices on channel 'delivery-alerts-v2' with data
// { type: 'CAMPUS_BOOKING', bookingId, status } ("New booking: payment to review", "Payment proof sent again",
// "Booking cancelled"). Pushes are a bonus: bookings also arrive live over the socket and by a 30 s refresh.
// Without google-services.json (package not registered in Firebase yet) there is no FCM device token: the state is
// 'unavailable', Settings says so, and nothing crashes. Every function is best effort and never throws.
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { apiFetch } from './http';
import { STORAGE } from '../config';
import { safeGet, safeSet } from './storage';

/** Same id the server sends on (utils/storePush.js). */
export const ALERTS_CHANNEL = 'delivery-alerts-v2';
const SOUND = 'alert.wav';
const REREGISTER_MS = 24 * 60 * 60 * 1000;
const isNative = Platform.OS === 'android' || Platform.OS === 'ios';

if (isNative) {
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
    });
  } catch { /* module missing in this build */ }
}

let channelReady: Promise<boolean> | null = null;
function ensureChannel(): Promise<boolean> {
  if (Platform.OS !== 'android') return Promise.resolve(true);
  if (!channelReady) {
    channelReady = Notifications.setNotificationChannelAsync(ALERTS_CHANNEL, {
      name: 'Bookings',
      description: 'New In-Campus Bookings with a payment to review, and cancellations',
      importance: Notifications.AndroidImportance.HIGH,
      sound: SOUND,
      vibrationPattern: [0, 300, 150, 300],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    }).then(() => true).catch(() => { channelReady = null; return false; });
  }
  return channelReady;
}

/**
 *  'ok'          token registered with the server
 *  'blocked'     notification permission refused
 *  'unavailable' no FCM device token (no google-services.json in this build, or no Play services)
 *  'unknown'     web, or a network / server hiccup (retried next start)
 */
export type PushState = 'ok' | 'blocked' | 'unavailable' | 'unknown';

let currentToken: string | null = null;

const saveToken = (token: string) => apiFetch('/api/restaurants/fcm-token', { method: 'POST', body: { token, app: 'campusstall' }, no401Logout: true });
const removeToken = (token: string) => apiFetch('/api/restaurants/fcm-token/remove', { method: 'POST', body: { token }, no401Logout: true, timeoutMs: 8000 });

export async function registerStallPush(stallId: string): Promise<PushState> {
  if (!isNative || !stallId) return 'unknown';
  try {
    await ensureChannel();
    const cur = await Notifications.getPermissionsAsync();
    let granted = cur.status === 'granted';
    if (!granted && cur.canAskAgain !== false) granted = (await Notifications.requestPermissionsAsync()).status === 'granted';
    if (!granted) return 'blocked';
  } catch {
    return 'unknown';
  }
  let token = '';
  try {
    const device = await Notifications.getDevicePushTokenAsync();
    token = typeof device?.data === 'string' ? device.data : '';
  } catch {
    return 'unavailable';
  }
  if (!token) return 'unavailable';
  currentToken = token;
  try {
    const marker = `${stallId}:${token}`;
    const saved = (await safeGet(STORAGE.pushRegistered)) || '';
    const [savedMarker, savedAt] = saved.split('|');
    if (savedMarker === marker && Date.now() - Number(savedAt || 0) < REREGISTER_MS) return 'ok';
    await saveToken(token);
    await safeSet(STORAGE.pushRegistered, `${marker}|${Date.now()}`);
    return 'ok';
  } catch {
    return 'unknown';
  }
}

/** Re-sends the token when FCM rotates it. Returns the unsubscribe function. */
export function onPushTokenChange(stallId: string): () => void {
  if (!isNative) return () => {};
  try {
    const sub = Notifications.addPushTokenListener(async (t) => {
      const token = typeof t?.data === 'string' ? t.data : '';
      if (!token || !stallId) return;
      currentToken = token;
      try {
        await saveToken(token);
        await safeSet(STORAGE.pushRegistered, `${stallId}:${token}|${Date.now()}`);
      } catch { /* retried next start */ }
    });
    return () => sub.remove();
  } catch {
    return () => {};
  }
}

/** Logout: POST /fcm-token/remove while the session token is still valid. */
export async function unregisterStorePush(): Promise<void> {
  if (!isNative) return;
  try {
    let token = currentToken;
    if (!token) {
      const device = await Notifications.getDevicePushTokenAsync().catch(() => null);
      token = typeof device?.data === 'string' ? device.data : null;
    }
    await safeSet(STORAGE.pushRegistered, '');
    currentToken = null;
    if (token) await removeToken(token);
  } catch { /* the server prunes stale tokens itself */ }
}

/** A local notification when the session ended while the app is in the background (best effort). */
export async function notifyLoggedOut(message: string): Promise<void> {
  if (!isNative) return;
  try {
    await ensureChannel();
    await Notifications.scheduleNotificationAsync({
      content: { title: 'ZCS Campus Stall logged out', body: `${message} Log in again to keep getting bookings.` },
      trigger: null,
    });
  } catch { /* ignore */ }
}

export interface PushData { type?: string; bookingId?: string; status?: string }

/**
 * Booking pushes received while open (`tapped` false) or tapped (`tapped` true). The tap that cold-launched the
 * app (before this listener existed) is delivered once as tapped too.
 */
// Taps already handled in this app run (notification ids). The listener is re-subscribed whenever the signed-in
// stall object changes (session refresh), and getLastNotificationResponseAsync keeps returning the same old tap:
// without this the booking that cold-launched the app opened again on every refresh.
const handledTaps = new Set<string>();
const firstTime = (r: any): boolean => {
  const id = String(r?.notification?.request?.identifier || r?.actionIdentifier || '');
  if (!id) return true;
  if (handledTaps.has(id)) return false;
  handledTaps.add(id);
  return true;
};

export function onStallPush(cb: (data: PushData, tapped: boolean) => void): () => void {
  if (!isNative) return () => {};
  let alive = true;
  try {
    const recv = Notifications.addNotificationReceivedListener((n) => cb((n.request.content.data as any) || {}, false));
    const tap = Notifications.addNotificationResponseReceivedListener((r) => { if (firstTime(r)) cb((r.notification.request.content.data as any) || {}, true); });
    Promise.resolve((Notifications as any).getLastNotificationResponseAsync?.())
      .then((r: any) => { const d = r?.notification?.request?.content?.data; if (d && alive && firstTime(r)) cb(d, true); })
      .catch(() => {});
    return () => { alive = false; recv.remove(); tap.remove(); };
  } catch {
    return () => {};
  }
}
