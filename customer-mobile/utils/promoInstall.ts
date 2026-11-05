// Promoter attribution (5 Nov 2026). Promo link:
//   https://play.google.com/store/apps/details?id=com.srm.hostelbites&referrer=utm_source%3Dpromo%26utm_campaign%3D<CODE>
// Google Play hands that referrer to the installed app. On the first launch (Android only) we read it once and
// report it with this device's id (POST /api/promo/attribute); the backend credits the promoter only when a NEW
// account is then created on this device (the sign-up sends the same id as `installId`).
// Never blocks startup: runs after the first interactions, fails silently offline and retries on the next launch
// until the server has it.
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../constants/api';
import { postAuth } from './auth';

const SENT_KEY = 'zenv.promo.referrerSent.v1';
const CODE_KEY = 'zenv.promo.referrerCode.v1';
const FALLBACK_ID_KEY = 'zenv.promo.installId.v1';
const CODE_RE = /^[A-Z0-9]{4,16}$/;

let cachedId: string | null = null;

const appModule = (): any => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('expo-application');
  } catch {
    return null;
  }
};

/** Promoter code (utm_campaign) of a Play install referrer, '' when none. */
export const codeFromReferrer = (referrer: string | null | undefined): string => {
  if (!referrer) return '';
  let s = String(referrer).trim();
  if (!s.includes('=') && s.includes('%3D')) {
    try { s = decodeURIComponent(s); } catch { /* keep */ }
  }
  const m = s.match(/(?:^|&)utm_campaign=([^&]*)/);
  let code = m ? m[1] : '';
  try { code = decodeURIComponent(code); } catch { /* keep */ }
  code = code.trim().toUpperCase();
  return CODE_RE.test(code) ? code : '';
};

/**
 * Stable id of this device for attribution: Android's per-device id (survives reinstalls of the same signed app,
 * so a reinstall never counts twice). Elsewhere, or if it is unreadable, a random id kept for this install.
 */
export const getInstallId = async (): Promise<string | null> => {
  if (cachedId) return cachedId;
  if (Platform.OS === 'android') {
    try {
      const id = appModule()?.getAndroidId?.();
      if (typeof id === 'string' && /^[A-Za-z0-9]{8,64}$/.test(id)) {
        cachedId = `a:${id}`;
        return cachedId;
      }
    } catch { /* fall through */ }
  }
  if (Platform.OS === 'web') return null;
  try {
    let id = await AsyncStorage.getItem(FALLBACK_ID_KEY);
    if (!id) {
      id = `r:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}${Math.random().toString(36).slice(2, 12)}`;
      await AsyncStorage.setItem(FALLBACK_ID_KEY, id);
    }
    cachedId = id;
    return id;
  } catch {
    return null;
  }
};

/** The promoter code the Play install link carried (for prefilling the sign-up field), '' when none. */
export const getReferrerPromoCode = async (): Promise<string> => {
  try {
    const saved = await AsyncStorage.getItem(CODE_KEY);
    if (saved) return CODE_RE.test(saved) ? saved : '';
  } catch { /* ignore */ }
  if (Platform.OS !== 'android') return '';
  try {
    const code = codeFromReferrer(await appModule()?.getInstallReferrerAsync?.());
    try { await AsyncStorage.setItem(CODE_KEY, code || '-'); } catch { /* ignore */ }
    return code;
  } catch {
    return '';
  }
};

/** Fields every new-account call sends: { installId } and, when the install link had one, { promoCode }. */
export const signupAttributionFields = async (): Promise<{ installId?: string }> => {
  const installId = await getInstallId();
  return installId ? { installId } : {};
};

let running = false;
/** First-launch report of the install referrer. Safe to call on every launch; does nothing once sent. */
export const reportInstallReferrerOnce = async (): Promise<void> => {
  if (Platform.OS !== 'android' || running) return;
  running = true;
  try {
    if (await AsyncStorage.getItem(SENT_KEY)) return;
    const A = appModule();
    if (!A?.getInstallReferrerAsync) return;
    const referrer: string = String((await A.getInstallReferrerAsync()) || '');
    const code = codeFromReferrer(referrer);
    try { await AsyncStorage.setItem(CODE_KEY, code || '-'); } catch { /* ignore */ }
    const deviceId = await getInstallId();
    if (!deviceId) return;
    const r = await postAuth(`${API_URL}/api/promo/attribute`, { referrer: referrer.slice(0, 300), deviceId });
    // 200: recorded. 400: this request can never succeed (bad id): stop retrying. Anything else: next launch.
    if (r.ok || r.status === 400) await AsyncStorage.setItem(SENT_KEY, '1');
  } catch {
    // Offline / Play Store service unavailable: try again on the next launch.
  } finally {
    running = false;
  }
};
