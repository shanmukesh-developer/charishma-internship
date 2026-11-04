import AsyncStorage from '@react-native-async-storage/async-storage';

// Push categories (Profile > Notifications). Kept on this phone and sent with the push token
// (POST /api/users/fcm-token { pushPrefs }); the server then skips the categories switched off.
// Chats, calls, account, wallet and support messages are never muted by these switches.
export type PushCategory = 'orders' | 'offers' | 'campus' | 'reminders';
export type PushPrefs = Record<PushCategory, boolean>;

export const PUSH_PREFS_KEY = 'zenvy_push_prefs_v1';
export const DEFAULT_PUSH_PREFS: PushPrefs = { orders: true, offers: true, campus: true, reminders: true };

export const PUSH_CATEGORY_ROWS: { key: PushCategory; label: string; desc: string }[] = [
  { key: 'orders', label: 'Orders and deliveries', desc: 'Accepted, out for delivery, delivered, cancelled' },
  { key: 'offers', label: 'Offers', desc: 'Coupons and deals from ZENV and stores' },
  { key: 'campus', label: 'Campus activity', desc: 'Replies, follows, forum, tasks and Spaces' },
  { key: 'reminders', label: 'Reminders', desc: 'Streak and reorder nudges' },
];

export async function loadPushPrefs(): Promise<PushPrefs> {
  try {
    const raw = await AsyncStorage.getItem(PUSH_PREFS_KEY);
    if (!raw) return { ...DEFAULT_PUSH_PREFS };
    const parsed = JSON.parse(raw);
    const out = { ...DEFAULT_PUSH_PREFS };
    (Object.keys(out) as PushCategory[]).forEach((k) => {
      if (typeof parsed?.[k] === 'boolean') out[k] = parsed[k];
    });
    return out;
  } catch {
    return { ...DEFAULT_PUSH_PREFS };
  }
}

export async function savePushPrefs(prefs: PushPrefs): Promise<void> {
  try {
    await AsyncStorage.setItem(PUSH_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // kept in memory for this run
  }
}
