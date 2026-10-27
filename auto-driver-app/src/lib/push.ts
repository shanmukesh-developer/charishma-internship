// Push (expo-notifications). The server (modules/autoRide/services/notify.js toDriver -> utils/push.js)
// sends FCM pushes on channel 'delivery-alerts-v2' with data { screen: 'auto_driver_trip', type, tripId,
// bookingId?, requestId? } and also writes every one of them to the driver's in-app inbox
// (GET /notifications), so nothing is lost when pushes are unavailable.
// We register this phone's FCM token with POST /fcm-token after login and remove it on logout.
// Every function is best effort and never throws.
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { driverApi } from '../api/driverApi';
import { STORAGE } from '../config';
import { safeGet, safeSet } from './storage';

/** Same id the server sends on (utils/push.js). */
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
      name: 'Bookings and trip alerts',
      description: 'New bookings, full-auto requests, verification and trip changes',
      importance: Notifications.AndroidImportance.MAX,
      sound: SOUND,
      vibrationPattern: [0, 400, 200, 400],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    }).then(() => true).catch(() => { channelReady = null; return false; });
  }
  return channelReady;
}

/**
 *  'ok'          token registered with the server
 *  'blocked'     notification permission refused: alerts only while the app is open (+ inbox)
 *  'unavailable' no FCM device token (no google-services.json in this build, or no Play services)
 *  'unknown'     web, or a network / server hiccup (retried next start)
 */
export type PushState = 'ok' | 'blocked' | 'unavailable' | 'unknown';

let currentToken: string | null = null;

export async function registerDriverPush(driverId: string): Promise<PushState> {
  if (!isNative || !driverId) return 'unknown';
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
    const marker = `${driverId}:${token}`;
    const saved = (await safeGet(STORAGE.pushRegistered)) || '';
    const [savedMarker, savedAt] = saved.split('|');
    if (savedMarker === marker && Date.now() - Number(savedAt || 0) < REREGISTER_MS) return 'ok';
    await driverApi.saveFcmToken(token);
    await safeSet(STORAGE.pushRegistered, `${marker}|${Date.now()}`);
    return 'ok';
  } catch {
    return 'unknown';
  }
}

/** Re-sends the token when FCM rotates it. Returns the unsubscribe function. */
export function onPushTokenChange(driverId: string): () => void {
  if (!isNative) return () => {};
  try {
    const sub = Notifications.addPushTokenListener(async (t) => {
      const token = typeof t?.data === 'string' ? t.data : '';
      if (!token || !driverId) return;
      currentToken = token;
      try {
        await driverApi.saveFcmToken(token);
        await safeSet(STORAGE.pushRegistered, `${driverId}:${token}|${Date.now()}`);
      } catch { /* retried next start */ }
    });
    return () => sub.remove();
  } catch {
    return () => {};
  }
}

/** Logout: POST /fcm-token/remove while the session token is still valid. */
export async function unregisterDriverPush(): Promise<void> {
  if (!isNative) return;
  try {
    let token = currentToken;
    if (!token) {
      const device = await Notifications.getDevicePushTokenAsync().catch(() => null);
      token = typeof device?.data === 'string' ? device.data : null;
    }
    await safeSet(STORAGE.pushRegistered, '');
    currentToken = null;
    if (token) await driverApi.removeFcmToken(token);
  } catch { /* the server prunes stale tokens itself */ }
}

export interface PushData { screen?: string; type?: string; tripId?: string; bookingId?: string; requestId?: string; vehicleId?: string }

/** Taps already routed (notification ids), so the launch tap and the listener never route the same tap twice. */
const handledTaps = new Set<string>();
let launchTapChecked = false;

/** Pushes received while open (`received`) or tapped (`tapped`). */
export function onDriverPush(cb: (data: PushData, tapped: boolean) => void): () => void {
  if (!isNative) return () => {};
  try {
    const recv = Notifications.addNotificationReceivedListener((n) => cb((n.request.content.data as any) || {}, false));
    const tap = Notifications.addNotificationResponseReceivedListener((r) => {
      const key = r.notification.request.identifier;
      if (key) {
        if (handledTaps.has(key)) return;
        handledTaps.add(key);
      }
      cb((r.notification.request.content.data as any) || {}, true);
    });
    return () => { recv.remove(); tap.remove(); };
  } catch {
    return () => {};
  }
}

/**
 * The tap that launched a killed app is not delivered to listeners registered later (the listener above
 * mounts only after the saved session loads). Read it once per app run; null when the app was not opened
 * from a notification or the tap was already routed.
 */
export async function takeLaunchPushTap(): Promise<PushData | null> {
  if (!isNative || launchTapChecked) return null;
  launchTapChecked = true;
  try {
    const r = await Notifications.getLastNotificationResponseAsync();
    if (!r) return null;
    const key = r.notification.request.identifier;
    if (key) {
      if (handledTaps.has(key)) return null;
      handledTaps.add(key);
    }
    return (r.notification.request.content.data as any) || {};
  } catch {
    return null;
  }
}
