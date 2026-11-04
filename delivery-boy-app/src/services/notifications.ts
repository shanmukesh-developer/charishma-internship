// Push: permission, Android channels, FCM token registration (once per token), listeners,
// plus the short "soundbox" chime played before a voice announcement.
import { Platform, Vibration } from 'react-native';
import * as Notifications from 'expo-notifications';
import { saveFcmToken } from './deliveryApi';
import { getItem, setItem } from './session';
import { KEYS } from '../config';

const REGISTERED_KEY = KEYS.pushRegistered;
/**
 * New-order pushes. v3 plays the bundled alert.wav (res/raw/alert.wav, app.json expo-notifications "sounds").
 * An Android channel's sound is fixed when it is created, so the old v2 channel (system default sound) is
 * deleted and the id bumped. Pushes the server still sends to 'delivery-alerts-v2' then land in the manifest's
 * default FCM channel, which is this one (app.json expo-notifications "defaultChannel").
 */
export const ALERT_CHANNEL = 'delivery-alerts-v3';
const LEGACY_ALERT_CHANNELS = ['delivery-alerts-v2', 'delivery-alerts'];
const ALERT_SOUND = 'alert.wav';
/** Money / cash / cancellation cues: heads-up + sound. */
const CHIME_CHANNEL = 'zenvy-chime-v1';
/** New-order cue in the app: the same alert sound as the push. */
const ORDER_CHIME_CHANNEL = 'zenvy-chime-order-v1';
/** Small "info" cues (online, accepted, ready): sound only, never a heads-up banner over Google Maps. */
const INFO_CHIME_CHANNEL = 'zenvy-chime-info-v1';

Notifications.setNotificationHandler({
  handleNotification: async (n) => {
    const data = (n?.request?.content?.data as any) || {};
    const chime = data.chime === true;
    // App open + new-order push: the in-app order card, chime and voice already cover it.
    // Playing the push sound too would stack two sounds on top of the announcement.
    const coveredInApp = data.type === 'NEW_ORDER';
    // A chime is a sound cue only: no banner over the app while it is open.
    return {
      shouldShowBanner: !chime && !coveredInApp,
      shouldShowList: !chime,
      shouldPlaySound: chime || !coveredInApp,
      shouldSetBadge: false,
    };
  },
});

let channelsReady: Promise<void> | null = null;

function ensureChannels(): Promise<void> {
  if (Platform.OS !== 'android') return Promise.resolve();
  if (!channelsReady) {
    channelsReady = (async () => {
      await Notifications.setNotificationChannelAsync(ALERT_CHANNEL, {
        name: 'New delivery orders',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250, 250, 250],
        lightColor: '#0E9F5B',
        sound: ALERT_SOUND,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      });
      await Notifications.setNotificationChannelAsync(ORDER_CHIME_CHANNEL, {
        name: 'New order sound',
        description: 'Sound before a new-order voice announcement',
        importance: Notifications.AndroidImportance.HIGH,
        sound: ALERT_SOUND,
        enableVibrate: false,
      });
      await Notifications.setNotificationChannelAsync(CHIME_CHANNEL, {
        name: 'Order sounds',
        description: 'Short sound before a money / cash / cancellation announcement',
        importance: Notifications.AndroidImportance.HIGH,
        sound: 'default',
        enableVibrate: false,
      });
      await Notifications.setNotificationChannelAsync(INFO_CHIME_CHANNEL, {
        name: 'Small updates',
        description: 'Quiet sound for small updates (on duty, order ready)',
        importance: Notifications.AndroidImportance.DEFAULT,
        sound: 'default',
        enableVibrate: false,
      });
      for (const id of LEGACY_ALERT_CHANNELS) {
        await Notifications.deleteNotificationChannelAsync(id).catch(() => {});
      }
    })().catch(() => {
      channelsReady = null;
    });
  }
  return channelsReady ?? Promise.resolve();
}

async function hasPermission(): Promise<boolean> {
  try {
    return (await Notifications.getPermissionsAsync()).status === 'granted';
  } catch {
    return false;
  }
}

export type ChimeKind = 'order' | 'money' | 'info' | 'alert';

const PATTERNS: Record<ChimeKind, number[]> = {
  order: [0, 350, 150, 350, 150, 600],
  money: [0, 120, 80, 120],
  info: [0, 120],
  alert: [0, 500, 200, 500],
};

const CHIME_CHANNEL_FOR: Record<ChimeKind, string> = {
  order: ORDER_CHIME_CHANNEL,
  money: CHIME_CHANNEL,
  alert: CHIME_CHANNEL,
  info: INFO_CHIME_CHANNEL,
};

/**
 * Distinctive cue: vibration pattern + the system notification sound (a silent-banner local notification
 * that removes itself). Never throws. `text` is the notification body when it shows in the tray.
 */
export async function playChime(kind: ChimeKind, text: string): Promise<void> {
  try {
    Vibration.vibrate(PATTERNS[kind]);
  } catch {
    // no vibrator
  }
  if (!(await hasPermission())) return;
  try {
    await ensureChannels();
    const id = await Notifications.scheduleNotificationAsync({
      content: { title: 'ZENV Rider', body: text, sound: kind === 'order' ? ALERT_SOUND : 'default', data: { chime: true } },
      trigger: Platform.OS === 'android' ? { channelId: CHIME_CHANNEL_FOR[kind] } : null,
    });
    setTimeout(() => {
      Notifications.dismissNotificationAsync(id).catch(() => {});
    }, 6000);
  } catch {
    // sound is best effort
  }
}

const REREGISTER_MS = 12 * 60 * 60 * 1000;

/** Ask permission and send the device (FCM) token to the server. Safe to call repeatedly. */
export async function registerForPush(riderId: string): Promise<void> {
  try {
    await ensureChannels();
    const perm = await Notifications.getPermissionsAsync();
    let granted = perm.status === 'granted';
    if (!granted) granted = (await Notifications.requestPermissionsAsync()).status === 'granted';
    if (!granted) return;
    // The server sends through FCM, so only the native device token is useful.
    const device = await Notifications.getDevicePushTokenAsync();
    const token = typeof device?.data === 'string' ? device.data : '';
    if (!token) return;
    const marker = `${riderId}:${token}`;
    // Re-sent at least every 12 h even when unchanged (and on every return to the app): the server drops a
    // token whose send failed, another rider's login on this phone takes it, a database move can lose it.
    // A rider whose token was sent once and never again stayed silent while the app was closed, for good.
    const [savedMarker, savedAt] = ((await getItem(REGISTERED_KEY)) || '').split('|');
    if (savedMarker === marker && Date.now() - Number(savedAt || 0) < REREGISTER_MS) return;
    await saveFcmToken(token);
    await setItem(REGISTERED_KEY, `${marker}|${Date.now()}`);
  } catch {
    // Push is best effort; polling still finds orders while the app is open.
  }
}

export function onPushTokenChange(riderId: string): () => void {
  const sub = Notifications.addPushTokenListener(async (t) => {
    const token = typeof t?.data === 'string' ? t.data : '';
    if (!token) return;
    try {
      await saveFcmToken(token);
      await setItem(REGISTERED_KEY, `${riderId}:${token}|${Date.now()}`);
    } catch {
      // retried on next start
    }
  });
  return () => sub.remove();
}

/**
 * Logout: forget the local marker AND invalidate this phone's FCM token. The store's logout first asks the
 * server to drop the token (POST /delivery/fcm-token/remove, best effort); once FCM deletes it every push
 * to it fails anyway, so a logged-out phone stops getting this rider's order / tip / cancellation pushes.
 * The next login asks FCM for a fresh token and registers that one.
 */
/** The device token this phone last registered for `riderId` (from the local marker), or null. */
export async function registeredPushToken(riderId: string): Promise<string | null> {
  const marker = ((await getItem(REGISTERED_KEY)) || '').split('|')[0]; // "<rider>:<token>|<sent at>"
  const prefix = `${riderId}:`;
  return riderId && marker && marker.startsWith(prefix) ? marker.slice(prefix.length) || null : null;
}

export async function forgetPushRegistration(): Promise<void> {
  await setItem(REGISTERED_KEY, '');
  try {
    await Promise.race([
      Notifications.unregisterForNotificationsAsync(),
      new Promise((resolve) => setTimeout(resolve, 4000)),
    ]);
  } catch {
    // best effort: no Firebase on this build / no network
  }
}

/** True when the tray shows the server's NEW_ORDER push for this order (it already rang with its own sound). */
export async function newOrderPushShown(orderId: string): Promise<boolean> {
  try {
    const list = await Notifications.getPresentedNotificationsAsync();
    return list.some((n) => {
      const content: any = n.request.content || {};
      const trigger: any = n.request.trigger || {};
      const data: any = { ...(trigger.remoteMessage?.data || {}), ...(content.data || {}) };
      if (data.chime === true || data.type !== 'NEW_ORDER') return false;
      return !data.orderId || String(data.orderId) === String(orderId);
    });
  } catch {
    return false;
  }
}

export function onPushReceived(cb: (data: Record<string, any>) => void): () => void {
  const sub = Notifications.addNotificationReceivedListener((n) => {
    const data = (n.request.content.data as any) || {};
    if (data.chime === true) return; // our own chime
    cb(data);
  });
  return () => sub.remove();
}

// Ids of notification taps already routed, so the launch tap and the listener never both act on one tap.
const handledTaps = new Set<string>();
let launchTapChecked = false;

export function onPushTapped(cb: (data: Record<string, any>) => void): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener((r) => {
    const data = (r.notification.request.content.data as any) || {};
    if (data.chime === true) return;
    const key = r.notification.request.identifier;
    if (key) {
      if (handledTaps.has(key)) return;
      handledTaps.add(key);
    }
    cb(data);
  });
  return () => sub.remove();
}

/**
 * The tap that launched a killed app is not delivered to listeners registered later. Read it once per app
 * run (null when the app was not opened from a notification, or it was already routed).
 */
export async function takeLaunchPushTap(): Promise<Record<string, any> | null> {
  if (launchTapChecked) return null;
  launchTapChecked = true;
  try {
    const r = await Notifications.getLastNotificationResponseAsync();
    if (!r) return null;
    const data = (r.notification.request.content.data as any) || {};
    if (data.chime === true) return null;
    const key = r.notification.request.identifier;
    if (key) {
      if (handledTaps.has(key)) return null;
      handledTaps.add(key);
    }
    return data;
  } catch {
    return null;
  }
}

// ── Alert health (Home banner) ─────────────────────────────────────────────
/**
 * Can a new-order push reach this rider with sound?
 *  'ok'       permission granted and the order channel rings
 *  'blocked'  notification permission refused (canAskAgain: the app may still ask)
 *  'muted'    Android: the "New delivery orders" channel was switched off, set to silent or its sound removed
 *  'unknown'  web, or the check failed (no banner)
 */
export type AlertHealth = { state: 'ok' | 'muted' | 'unknown' } | { state: 'blocked'; canAskAgain: boolean };

const MUTED_IMPORTANCE = [
  Notifications.AndroidImportance.NONE,
  Notifications.AndroidImportance.MIN,
  Notifications.AndroidImportance.LOW,
];

export async function checkAlertHealth(): Promise<AlertHealth> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return { state: 'unknown' };
  try {
    const perm = await Notifications.getPermissionsAsync();
    if (perm.status !== 'granted') return { state: 'blocked', canAskAgain: perm.canAskAgain !== false };
    if (Platform.OS !== 'android') return { state: 'ok' };
    await ensureChannels();
    const ch = await Notifications.getNotificationChannelAsync(ALERT_CHANNEL);
    if (!ch) return { state: 'unknown' };
    if (MUTED_IMPORTANCE.includes(ch.importance) || ch.sound === null) return { state: 'muted' };
    return { state: 'ok' };
  } catch {
    return { state: 'unknown' };
  }
}

/** Asks for notification permission again (only when Android still allows the prompt). */
export async function askNotificationPermission(): Promise<boolean> {
  try {
    return (await Notifications.requestPermissionsAsync()).status === 'granted';
  } catch {
    return false;
  }
}
