// Push + ring sound (expo-notifications).
//  - Order pushes while the app is closed: the server (utils/storePush.js) sends FCM pushes on channel
//    'delivery-alerts-v2' for every new order and cancellation. We register this phone's FCM token with
//    POST /api/restaurants/fcm-token after login and remove it on logout.
//  - Ring: a short loud ring (assets/sounds/alert.wav, bundled into res/raw by the expo-notifications
//    plugin) played through a local notification on an alarm-volume channel. It does not depend on the
//    TTS engine, so a broken / missing voice never means a silent new order.
// Every function is best effort and never throws.
import { Linking, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { registerPushToken, removePushToken } from './api';
import { safeGet, safeSet } from './storage';

const APP: 'restaurant' | 'vendor' = 'vendor';
const APP_TITLE = 'ZCS Vendor';
const REGISTERED_KEY = '@zenvy_vendor_push_registered';
/** The registered token is re-sent to the server at most this often (see registerStorePush). */
const REREGISTER_MS = 24 * 60 * 60 * 1000;
/** Same id the server sends store pushes on (utils/storePush.js). */
export const ORDERS_CHANNEL = 'delivery-alerts-v2';
const RING_CHANNEL = 'zenvy-ring-v1';
const RING_SOUND = 'alert.wav';
/** Length of assets/sounds/alert.wav (+ a little slack). */
export const RING_SOUND_MS = 2600;

const isNative = Platform.OS === 'android' || Platform.OS === 'ios';

if (isNative) {
  try {
    Notifications.setNotificationHandler({
      handleNotification: async (n) => {
        const data = (n?.request?.content?.data as any) || {};
        const ring = data.ring === true;
        // App open + order push: the socket, the order card, the ring and the voice already cover it.
        const coveredInApp = data.type === 'NEW_ORDER' || data.type === 'ORDER_CANCELLED';
        return {
          shouldShowBanner: !ring && !coveredInApp,
          shouldShowList: !coveredInApp,
          shouldPlaySound: ring || !coveredInApp,
          shouldSetBadge: false,
        };
      },
    });
  } catch { /* module missing in this build */ }
}

let channelsReady: Promise<boolean> | null = null;
function ensureChannels(): Promise<boolean> {
  if (Platform.OS !== 'android') return Promise.resolve(true);
  if (!channelsReady) {
    channelsReady = (async () => {
      const alarm = {
        usage: Notifications.AndroidAudioUsage.ALARM,
        contentType: Notifications.AndroidAudioContentType.SONIFICATION,
      };
      await Notifications.setNotificationChannelAsync(ORDERS_CHANNEL, {
        name: 'New orders',
        description: 'New orders and cancellations, also when the app is closed',
        importance: Notifications.AndroidImportance.MAX,
        sound: RING_SOUND,
        audioAttributes: alarm,
        vibrationPattern: [0, 600, 250, 600, 250, 600],
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        bypassDnd: true,
      });
      await Notifications.setNotificationChannelAsync(RING_CHANNEL, {
        name: 'Order ring',
        description: 'Loud ring while a new order is waiting',
        importance: Notifications.AndroidImportance.MAX,
        sound: RING_SOUND,
        audioAttributes: alarm,
        enableVibrate: false, // the app vibrates itself (its own pattern)
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        bypassDnd: true,
      });
      return true;
    })().catch(() => {
      channelsReady = null;
      return false;
    });
  }
  return channelsReady;
}

let permissionAsk: Promise<boolean> | null = null;

/**
 * Notification permission, asked at most once at a time: push registration and the kitchen service both
 * need it at startup, and two overlapping system prompts drop one of the answers. Never throws.
 */
export function ensureNotificationPermission(ask: boolean): Promise<boolean> {
  if (!isNative) return Promise.resolve(false);
  if (permissionAsk) return permissionAsk;
  const run = (async () => {
    try {
      const cur = await Notifications.getPermissionsAsync();
      if (cur.status === 'granted') return true;
      if (!ask || cur.canAskAgain === false) return false;
      return (await Notifications.requestPermissionsAsync()).status === 'granted';
    } catch {
      return false;
    }
  })();
  if (!ask) return run;
  permissionAsk = run;
  run.finally(() => { if (permissionAsk === run) permissionAsk = null; });
  return run;
}

const hasPermission = (ask: boolean) => ensureNotificationPermission(ask);

/**
 * Forced logout (session expired / revoked): a loud notification on the order channel, so a phone lying in
 * the kitchen with the screen off does not go quiet without anyone noticing. Best effort, never throws.
 */
export async function notifyLoggedOut(message: string): Promise<void> {
  if (!isNative) return;
  try {
    if (!(await hasPermission(false))) return;
    await ensureChannels();
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `${APP_TITLE}: logged out`,
        body: `${message} New orders will NOT ring until you log in again.`,
        sound: RING_SOUND,
        data: { type: 'LOGGED_OUT' },
      },
      trigger: Platform.OS === 'android' ? { channelId: ORDERS_CHANNEL } : null,
    });
  } catch { /* ignore */ }
}

/** Plays the ring once. false = it could not (web, notifications blocked, old build): use a fallback. */
export async function playRing(text = 'New order waiting'): Promise<boolean> {
  if (!isNative) return false;
  try {
    if (!(await hasPermission(false))) return false;
    if (!(await ensureChannels())) return false;
    const id = await Notifications.scheduleNotificationAsync({
      content: { title: APP_TITLE, body: text, sound: RING_SOUND, data: { ring: true } },
      trigger: Platform.OS === 'android' ? { channelId: RING_CHANNEL } : null,
    });
    setTimeout(() => { Notifications.dismissNotificationAsync(id).catch(() => {}); }, RING_SOUND_MS + 3000);
    return true;
  } catch {
    return false;
  }
}

let currentToken: string | null = null;

/**
 * Closed-app order alerts:
 *  'ok'          token registered with the server
 *  'blocked'     notification permission refused: alerts only while the app is open
 *  'unavailable' this build / phone has no FCM device token (no google-services.json, no Play services)
 *  'muted'       Android: token registered, but the "New orders" channel was switched off, set to silent or
 *                its sound removed in the phone's settings, so a closed-app order push would not ring
 *  'unknown'     web, or a network / server hiccup (retried on the next start; no banner)
 */
export type PushState = 'ok' | 'blocked' | 'unavailable' | 'muted' | 'unknown';

/** app.json android.package (Settings finds the app by it). */
const ANDROID_PACKAGE = 'com.srm.zenvyvendor';

/** true when the order channel exists but cannot ring (switched off / silent / no sound). */
async function orderChannelMuted(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    const ch = await Notifications.getNotificationChannelAsync(ORDERS_CHANNEL);
    if (!ch) return false;
    const quiet = [Notifications.AndroidImportance.NONE, Notifications.AndroidImportance.MIN, Notifications.AndroidImportance.LOW];
    return quiet.includes(ch.importance) || ch.sound === null;
  } catch {
    return false;
  }
}

/**
 * Opens this app's notification settings (the "New orders" channel page when only its sound is off).
 * Standard Android Settings actions through Linking.sendIntent; falls back to the app's info page.
 */
export async function openNotificationSettings(state: PushState): Promise<void> {
  if (Platform.OS === 'android') {
    const app = { key: 'android.provider.extra.APP_PACKAGE', value: ANDROID_PACKAGE };
    try {
      if (state === 'muted') {
        await Linking.sendIntent('android.settings.CHANNEL_NOTIFICATION_SETTINGS', [app, { key: 'android.provider.extra.CHANNEL_ID', value: ORDERS_CHANNEL }]);
      } else {
        await Linking.sendIntent('android.settings.APP_NOTIFICATION_SETTINGS', [app]);
      }
      return;
    } catch { /* fall back below */ }
  }
  Linking.openSettings().catch(() => {});
}

/** Ask permission, then send this phone's FCM token to the server (once per store + token). */
export async function registerStorePush(storeId: string): Promise<PushState> {
  if (!isNative || !storeId) return 'unknown';
  try {
    await ensureChannels();
    if (!(await hasPermission(true))) return 'blocked';
  } catch {
    return 'unknown';
  }
  let token = '';
  try {
    // The server sends through FCM, so only the native device token is useful. Without
    // google-services.json in the build this throws: order alerts then work only while the app runs.
    const device = await Notifications.getDevicePushTokenAsync();
    token = typeof device?.data === 'string' ? device.data : '';
  } catch (err) {
    console.warn('[PUSH_TOKEN]', (err as any)?.message || err);
    return 'unavailable';
  }
  if (!token) return 'unavailable';
  currentToken = token;
  try {
    const marker = `${storeId}:${token}`;
    // Re-sent at least once a day even when unchanged: the server may have dropped it (stale-token prune,
    // another stall's login on this phone, a database move), and a phone that never re-sends would stay
    // silent while closed forever. The server treats a repeat as a no-op.
    const saved = (await safeGet(REGISTERED_KEY)) || '';
    const [savedMarker, savedAt] = saved.split('|');
    if (savedMarker === marker && Date.now() - Number(savedAt || 0) < REREGISTER_MS) return (await orderChannelMuted()) ? 'muted' : 'ok';
    await registerPushToken(token, APP);
    await safeSet(REGISTERED_KEY, `${marker}|${Date.now()}`);
    return (await orderChannelMuted()) ? 'muted' : 'ok';
  } catch (err) {
    console.warn('[PUSH_REGISTER]', (err as any)?.message || err);
    return 'unknown';
  }
}

/** Re-sends the token when FCM rotates it. Returns the unsubscribe function. */
export function onPushTokenChange(storeId: string): () => void {
  if (!isNative) return () => {};
  try {
    const sub = Notifications.addPushTokenListener(async (t) => {
      const token = typeof t?.data === 'string' ? t.data : '';
      if (!token || !storeId) return;
      currentToken = token;
      try {
        await registerPushToken(token, APP);
        await safeSet(REGISTERED_KEY, `${storeId}:${token}|${Date.now()}`);
      } catch { /* retried on the next start */ }
    });
    return () => sub.remove();
  } catch {
    return () => {};
  }
}

/** Logout: stop pushes to this phone (call while the session token is still valid). */
export async function unregisterStorePush(): Promise<void> {
  if (!isNative) return;
  try {
    let token = currentToken;
    if (!token) {
      const device = await Notifications.getDevicePushTokenAsync().catch(() => null);
      token = typeof device?.data === 'string' ? device.data : null;
    }
    await safeSet(REGISTERED_KEY, '');
    currentToken = null;
    if (token) await removePushToken(token);
  } catch { /* the server prunes stale tokens itself */ }
}

/** Order pushes (received while open, or tapped): `cb` gets the push data ({ type, orderId }). */
export function onOrderPush(cb: (data: { type?: string; orderId?: string }) => void): () => void {
  if (!isNative) return () => {};
  try {
    const recv = Notifications.addNotificationReceivedListener((n) => {
      const data = (n.request.content.data as any) || {};
      if (data.ring === true) return;
      cb(data);
    });
    const tap = Notifications.addNotificationResponseReceivedListener((r) => {
      const data = (r.notification.request.content.data as any) || {};
      if (data.ring === true) return;
      cb(data);
    });
    return () => { recv.remove(); tap.remove(); };
  } catch {
    return () => {};
  }
}
