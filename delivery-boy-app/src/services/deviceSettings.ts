// Opens the phone's own settings pages (notifications, battery) for this app. No extra native modules:
// Linking.sendIntent (Android) with the standard Settings actions, falling back to the app's info page.
import { Linking, Platform } from 'react-native';
import Constants from 'expo-constants';

/** app.json android.package (the same string Settings uses to find this app). */
const PACKAGE: string = (Constants.expoConfig as any)?.android?.package || 'com.srm.hostelbitesdelivery';

async function tryIntent(action: string, extras?: { key: string; value: string }[]): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    await Linking.sendIntent(action, extras);
    return true;
  } catch {
    return false;
  }
}

async function appInfo(): Promise<void> {
  try {
    await Linking.openSettings();
  } catch {
    // nothing else to open
  }
}

/** This app's notification settings; with a channel id, that channel's page (sound, importance). */
export async function openNotificationSettings(channelId?: string): Promise<void> {
  const app = { key: 'android.provider.extra.APP_PACKAGE', value: PACKAGE };
  if (channelId && (await tryIntent('android.settings.CHANNEL_NOTIFICATION_SETTINGS', [app, { key: 'android.provider.extra.CHANNEL_ID', value: channelId }]))) return;
  if (await tryIntent('android.settings.APP_NOTIFICATION_SETTINGS', [app])) return;
  await appInfo();
}

/**
 * The phone's battery-optimisation list (Android 6+), where the rider picks Zenvy Rider and chooses
 * "Don't optimise" / "Unrestricted". Asking Android to exempt the app directly needs an extra permission
 * that Play restricts, so the app only opens the list. Falls back to the app's info page (Battery is there).
 */
export async function openBatterySettings(): Promise<void> {
  if (await tryIntent('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS')) return;
  await appInfo();
}

/** The app's info page: Battery, Autostart (on some phones) and Permissions live there. */
export async function openAppSettings(): Promise<void> {
  await appInfo();
}

export type PhoneBrand = 'xiaomi' | 'oppo' | 'vivo' | 'realme' | 'oneplus' | 'samsung' | 'other';

/** Phone maker (Android), for brand-specific autostart steps. */
export function phoneBrand(): PhoneBrand {
  if (Platform.OS !== 'android') return 'other';
  const c: any = Platform.constants || {};
  const b = `${c.Brand || ''} ${c.Manufacturer || ''}`.toLowerCase();
  if (/xiaomi|redmi|poco/.test(b)) return 'xiaomi';
  if (/realme/.test(b)) return 'realme';
  if (/oppo/.test(b)) return 'oppo';
  if (/vivo|iqoo/.test(b)) return 'vivo';
  if (/oneplus/.test(b)) return 'oneplus';
  if (/samsung/.test(b)) return 'samsung';
  return 'other';
}
