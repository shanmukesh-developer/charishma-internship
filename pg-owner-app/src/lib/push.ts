// Push (expo-notifications). The server (backend/modules/pgOwner/services/notify.js -> utils/push.js) sends FCM
// pushes on channel 'delivery-alerts-v2' with data { screen: 'pg_owner', type: PG_OWNER_BOOKING |
// PG_OWNER_COMPLAINT, bookingId?, complaintId?, hostelId } and also writes every one of them to the owner's
// in-app inbox (GET /notifications), so nothing is lost when pushes are unavailable.
// Without google-services.json (package not registered in Firebase yet) there is no FCM device token: the
// state is 'unavailable', Settings says so, and the inbox + Home badges still show everything.
// Every function is best effort and never throws.
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { ownerApi } from '../api/ownerApi';
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
      name: 'Booking requests and complaints',
      description: 'New booking requests from students and complaints from tenants',
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

export async function registerOwnerPush(ownerId: string): Promise<PushState> {
  if (!isNative || !ownerId) return 'unknown';
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
    const marker = `${ownerId}:${token}`;
    const saved = (await safeGet(STORAGE.pushRegistered)) || '';
    const [savedMarker, savedAt] = saved.split('|');
    if (savedMarker === marker && Date.now() - Number(savedAt || 0) < REREGISTER_MS) return 'ok';
    await ownerApi.saveFcmToken(token);
    await safeSet(STORAGE.pushRegistered, `${marker}|${Date.now()}`);
    return 'ok';
  } catch {
    return 'unknown';
  }
}

/** Re-sends the token when FCM rotates it. Returns the unsubscribe function. */
export function onPushTokenChange(ownerId: string): () => void {
  if (!isNative) return () => {};
  try {
    const sub = Notifications.addPushTokenListener(async (t) => {
      const token = typeof t?.data === 'string' ? t.data : '';
      if (!token || !ownerId) return;
      currentToken = token;
      try {
        await ownerApi.saveFcmToken(token);
        await safeSet(STORAGE.pushRegistered, `${ownerId}:${token}|${Date.now()}`);
      } catch { /* retried next start */ }
    });
    return () => sub.remove();
  } catch {
    return () => {};
  }
}

/** Logout: POST /fcm-token/remove while the session token is still valid. */
export async function unregisterOwnerPush(): Promise<void> {
  if (!isNative) return;
  try {
    let token = currentToken;
    if (!token) {
      const device = await Notifications.getDevicePushTokenAsync().catch(() => null);
      token = typeof device?.data === 'string' ? device.data : null;
    }
    await safeSet(STORAGE.pushRegistered, '');
    currentToken = null;
    if (token) await ownerApi.removeFcmToken(token);
  } catch { /* the server prunes stale tokens itself */ }
}

export interface PushData { screen?: string; type?: string; bookingId?: string; complaintId?: string; hostelId?: string }

/** Pushes received while open (`tapped` false) or tapped (`tapped` true). */
export function onOwnerPush(cb: (data: PushData, tapped: boolean) => void): () => void {
  if (!isNative) return () => {};
  try {
    const recv = Notifications.addNotificationReceivedListener((n) => cb((n.request.content.data as any) || {}, false));
    const tap = Notifications.addNotificationResponseReceivedListener((r) => cb((r.notification.request.content.data as any) || {}, true));
    return () => { recv.remove(); tap.remove(); };
  } catch {
    return () => {};
  }
}
