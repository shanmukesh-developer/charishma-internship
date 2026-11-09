import TabBackButton from '../../components/TabBackButton';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  Image,
  Modal,
  TextInput,
  Alert,
  ActivityIndicator,
  RefreshControl,
  Share,
  Linking,
  Switch,
} from 'react-native';
import { KeyboardAvoidingView } from '../../components/KeyboardAvoidingView';
import Clipboard from '@react-native-clipboard/clipboard';
import { useRouter, useFocusEffect } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { COLORS, SHADOWS, surfaceLift } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { useDietary, DietPrefs } from '../../context/DietaryContext';
import AmbientBackground from '../../components/AmbientBackground';
import { useDietLight } from '../../components/local/dietLightTheme';
import { StaggeredSection } from '../../components/AnimatedSection';
import { apiFetch, getToken } from '../../utils/auth';
import { newIdempotencyKey } from '../../context/CartContext';
import { API_URL, ENDPOINTS } from '../../constants/api';
import { usePhoneOtp, PhoneProof } from '../../utils/phoneOtp';
let Notifications: any = null;
try {
  Notifications = require('expo-notifications');
} catch (e: any) {
  console.warn('expo-notifications not available:', e.message);
}
import Constants from 'expo-constants';
import { pickAndUploadImage, alertUploadError } from '../../utils/imageUpload';
import DeleteAccountModal from '../../components/DeleteAccountModal';
import ProfileSettingsSection from '../../components/ProfileSettingsSection';
import AboutZcsModal from '../../components/AboutZcsModal';
import { cleanRoom, cleanBlock, formatHostel, useCampusHostelBlocks, HOSTEL_BLOCK_MAX, ROOM_NUMBER_MAX } from '../../utils/hostel';
import { useCollege } from '../../utils/college';
import { openLegal, LEGAL_LABELS, LegalPage } from '../../utils/legal';
import { formatINR, formatCount, plural } from '../../utils/format';
import { getSoundsEnabled, setSoundsEnabled, onSoundSettingChange } from '../../utils/sounds';
import { loadPushPrefs, savePushPrefs, DEFAULT_PUSH_PREFS, PUSH_CATEGORY_ROWS, PushPrefs, PushCategory } from '../../utils/pushPrefs';
import { Ionicons } from '@expo/vector-icons';
import { useTopInset } from '../../utils/useTopInset';
import SymbolIcon from '../../components/SymbolIcon';

const PHONE_RE = /^[6-9]\d{9}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// Edit profile rules (10 Nov 2026): letters (any script), spaces and . ' - only; rooms like 304, B-214, 12A.
const NAME_RE = /^[\p{L}][\p{L}\p{M} .'-]*$/u;
const ROOM_RE = /^[A-Za-z0-9][A-Za-z0-9 /-]*$/;
const CITY_RE = /^[\p{L}][\p{L}\p{M} .'-]*$/u;
type EditField = 'name' | 'phone' | 'email' | 'photo' | 'block' | 'room' | 'city' | 'address';
const BIO_MAX = 160;
// Diet filter <-> account dietaryPreference (PUT /api/users/profile accepts None/Veg/Eggetarian/Non-Veg)
const DIET_TO_SERVER: Record<string, string> = { all: 'None', veg: 'Veg', egg: 'Eggetarian', eggarian: 'Eggetarian', 'non-veg': 'Non-Veg', nonveg: 'Non-Veg' };
const SERVER_TO_DIET: Record<string, DietPrefs['mode']> = { None: 'all', Veg: 'veg', Eggetarian: 'egg', 'Non-Veg': 'non-veg' };
const APP_VERSION = Constants.expoConfig?.version || '1.0.0';

// Mirrors backend/services/BadgeService.js (ORDERS badges are earned on completedOrders).
const TIER_STYLE: Record<string, { emoji: string; color: string }> = {
  Bronze: { emoji: '🥉', color: '#D97706' },
  Silver: { emoji: '🥈', color: '#9CA3AF' },
  Gold: { emoji: '🥇', color: '#EAB308' },
  Platinum: { emoji: '💠', color: '#A855F7' },
  Diamond: { emoji: '💎', color: '#38BDF8' },
  Elite: { emoji: '👑', color: '#F59E0B' },
};

const BADGE_INFO: Record<string, { tier: string; desc: string }> = {
  'Bronze Beginner': { tier: 'Bronze', desc: '5 orders delivered' },
  'Silver Scaler': { tier: 'Silver', desc: '15 orders delivered' },
  'Gold Grafter': { tier: 'Gold', desc: '50 orders delivered' },
  'Platinum Pro': { tier: 'Platinum', desc: '100 orders delivered' },
  'Diamond Devotee': { tier: 'Diamond', desc: '250 orders delivered' },
  'Elite Eater': { tier: 'Elite', desc: '500 orders delivered' },
  'Bronze Bat': { tier: 'Bronze', desc: '3 late-night orders' },
  'Silver Shadow': { tier: 'Silver', desc: '10 late-night orders' },
  'Gold Ghost': { tier: 'Gold', desc: '25 late-night orders' },
  'Platinum Phantom': { tier: 'Platinum', desc: '75 late-night orders' },
  'Diamond Drifter': { tier: 'Diamond', desc: '150 late-night orders' },
  'Bronze Believer': { tier: 'Bronze', desc: '3-day order streak' },
  'Silver Streaker': { tier: 'Silver', desc: '7-day order streak' },
  'Gold Guardian': { tier: 'Gold', desc: '21-day order streak' },
  'Platinum Persistence': { tier: 'Platinum', desc: '50-day order streak' },
  'Diamond Dynamo': { tier: 'Diamond', desc: '100-day order streak' },
};

function badgeVisual(name: string) {
  const info = BADGE_INFO[name];
  const tier = info?.tier || Object.keys(TIER_STYLE).find((t) => name.startsWith(t)) || '';
  const style = TIER_STYLE[tier] || { emoji: '🏅', color: '#A855F7' };
  return { ...style, desc: info?.desc || 'Badge unlocked' };
}

function digitsOnly(v: string, max = 10) {
  return v.replace(/\D/g, '').slice(-max);
}

/** The user's own photo, or initials when there is none / it fails to load. Never a stock face. */
function Avatar({ uri, style, fallback }: { uri?: string | null; style: any; fallback: React.ReactNode }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [uri]);
  if (!uri || failed) return <>{fallback}</>;
  return <Image source={{ uri }} style={style} onError={() => setFailed(true)} />;
}

type StatsState = 'loading' | 'ready' | 'error';


// Wallet gifts / P2P transfers are turned off (owner decision: refund credit is not transferable).
const WALLET_GIFTS_ENABLED: boolean = false;
export default function ProfileScreen() {
  // Real status-bar inset, never less than the old fixed padding (utils/useTopInset)
  const topPad = useTopInset();
  const { user, setUser, logout } = useAuth();
  const { isDark, toggleTheme, colors } = useTheme();
  const router = useRouter();
  const userId = user?._id || user?.id;

  // Color Palette mappings
  // Owner, 10 Nov 2026: Profile keeps its layout but takes the app's new look (Local / Basket / Orders): the light
  // diet band and page, glass cards and the diet accent. Gold stays only for rewards (badge, points, progress).
  const d = useDietLight();
  const bg = d.pageDeep;
  // Solid, not see-through: on Android the card shadow showed through as a square inside the card (owner, 10 Nov
  // 2026, same fix as Orders). Exact colour of 74% white over the page, so the look is unchanged.
  const cardBg = isDark ? d.card : d.pageDeep === '#ECF5EF' ? '#FAFCFB' : '#FDFAFB';
  const lift = isDark
    ? { shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 8 }, elevation: 3 }
    : { shadowColor: d.dk, shadowOpacity: 0.16, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 3 };
  const txt = colors.text;
  const txtSec = colors.textSecondary;
  const border = isDark ? d.edge : 'rgba(255,255,255,0.95)';
  const goldColor = d.acc;
  const rewardGold = isDark ? COLORS.gold : colors.gold;

  const mountedRef = useRef(true);
  const suggestTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (suggestTimeout.current) clearTimeout(suggestTimeout.current);
    };
  }, []);

  // Feature states
  const [refreshing, setRefreshing] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);

  // Edit fields
  const [editName, setEditName] = useState('');
  // Inline validation: a field shows its message once it was left (touched) or after a Save attempt.
  const [touched, setTouched] = useState<Partial<Record<EditField, boolean>>>({});
  const [triedSave, setTriedSave] = useState(false);
  const [focusField, setFocusField] = useState<EditField | 'about' | 'address' | null>(null);
  const [editPhone, setEditPhone] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editAbout, setEditAbout] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editCity, setEditCity] = useState('');
  const [editHostelBlock, setEditHostelBlock] = useState('');
  const [editRoom, setEditRoom] = useState('');
  // Hostel blocks from the campus directory (only loaded while the editor is open)
  const hostelCampuses = useCampusHostelBlocks(isEditing);
  // Only the student's own college's hostels (3 Nov 2026: every college's list was merged into one row, so an SRM AP
  // student saw VIT's blocks too). No college picked yet: no chips, the block is typed.
  const myCollege = useCollege();
  const myHostelCampuses = myCollege ? hostelCampuses.filter((c) => c.code.toLowerCase() === myCollege) : [];
  // The college's city from the campus directory (SRM AP / VIT-AP: Amaravathi): fills an empty City field.
  const campusCity = myHostelCampuses.find((c) => c.city)?.city || '';
  useEffect(() => {
    if (isEditing && campusCity && !editCity.trim()) setEditCity(campusCity);
    // only when the editor opens or the campus list arrives, never while the student types
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing, campusCity]);
  const [editProfileImage, setEditProfileImage] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const savingRef = useRef(false);

  // Phone change verification (OTP to the NEW number)
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  // Firebase phone auth first (free), Zenvy SMS only as the fallback — same as login.
  const phoneOtp = usePhoneOtp('change_phone');
  const sendingOtp = phoneOtp.sending;
  const resendIn = phoneOtp.countdown;

  // Email change verification: a code to the NEW address (POST /api/users/profile/email-code), sent with the save.
  const [emailCodeSent, setEmailCodeSent] = useState(false);
  const [emailCode, setEmailCode] = useState('');
  const [sendingEmailCode, setSendingEmailCode] = useState(false);
  const [emailResendIn, setEmailResendIn] = useState(0);
  useEffect(() => {
    if (emailResendIn <= 0) return;
    const t = setTimeout(() => setEmailResendIn((n) => Math.max(0, n - 1)), 1000);
    return () => clearTimeout(t);
  }, [emailResendIn]);

  // Location suggestions
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Dietary (menu filter, kept on this device by DietaryContext)
  const { dietPrefs: globalDietPrefs, updateDietPrefs } = useDietary();
  const dietPrefs: DietPrefs = globalDietPrefs || { mode: 'all', nuts: false, dairy: false, gluten: false, custom: [] };
  const [customAllergy, setCustomAllergy] = useState('');

  // Dashboard & stats
  const [spendStats, setSpendStats] = useState<any>(null);
  const [statsState, setStatsState] = useState<StatsState>('loading');
  const [coupons, setCoupons] = useState<any[]>([]);
  const [giftPhone, setGiftPhone] = useState('');
  const [pushOn, setPushOn] = useState(false);
  const [pushPrefs, setPushPrefs] = useState<PushPrefs>(DEFAULT_PUSH_PREFS);
  const pushPrefsRef = useRef<PushPrefs>(DEFAULT_PUSH_PREFS);
  const [soundsOn, setSoundsOn] = useState(getSoundsEnabled());
  const [sendingGift, setSendingGift] = useState(false);
  const giftRef = useRef(false);
  // One Idempotency-Key per gift (recipient + amount), kept across retries until the server answers,
  // so a timed-out request that did debit the wallet is not charged again on retry.
  const giftKeyRef = useRef<{ sig: string; key: string } | null>(null);

  const initials = (user?.name || 'ZU').trim().substring(0, 2).toUpperCase() || 'ZU';
  const completedOrders = Number(user?.completedOrders) || 0;
  const streak = Number(user?.streakCount) || 0;
  // Next order badge comes from the server (BadgeService), so the app never drifts from the real rules.
  const badgeInfoLoaded = !!user && Object.prototype.hasOwnProperty.call(user, 'nextBadge');
  const nextMilestone: { name: string; threshold: number } | null = badgeInfoLoaded ? ((user as any).nextBadge || null) : null;
  const prevThreshold = Number((user as any)?.previousBadgeThreshold) || 0;
  const allBadgesUnlocked = badgeInfoLoaded && !nextMilestone;
  const milestonePct = nextMilestone
    ? Math.min(100, Math.max(0, Math.round(((completedOrders - prevThreshold) / Math.max(1, nextMilestone.threshold - prevThreshold)) * 100)))
    : allBadgesUnlocked ? 100 : 0;

  const fetchData = useCallback(async (mode: 'focus' | 'pull' = 'focus') => {
    if (mode === 'pull') setRefreshing(true);
    const tokenAtStart = await getToken();
    const [profileRes, statsRes, couponsRes] = await Promise.allSettled([
      apiFetch(ENDPOINTS.profile),
      apiFetch(`${API_URL}/api/orders/stats`),
      apiFetch(`${API_URL}/api/rewards/coupons`),
    ]);
    if (!mountedRef.current) return;

    try {
      if (profileRes.status === 'fulfilled' && profileRes.value.ok) {
        const data = await profileRes.value.json();
        // Signed out (or switched account) while this was loading: don't bring the old profile back.
        const sameSession = !!tokenAtStart && (await getToken()) === tokenAtStart;
        if (mountedRef.current && sameSession && data && typeof data === 'object') setUser(data);
      }
    } catch (e) {
      console.warn('[Profile] profile sync failed:', e);
    }

    try {
      if (statsRes.status === 'fulfilled' && statsRes.value.ok) {
        const data = await statsRes.value.json();
        if (mountedRef.current) {
          setSpendStats(data);
          setStatsState('ready');
        }
      } else if (mountedRef.current) {
        setStatsState((prev) => (prev === 'ready' ? 'ready' : 'error'));
      }
    } catch (e) {
      if (mountedRef.current) setStatsState((prev) => (prev === 'ready' ? 'ready' : 'error'));
    }

    try {
      if (couponsRes.status === 'fulfilled' && couponsRes.value.ok) {
        const data = await couponsRes.value.json();
        if (mountedRef.current && Array.isArray(data)) setCoupons(data);
      }
    } catch (e) {
      console.warn('[Profile] coupons failed:', e);
    }

    if (mountedRef.current) setRefreshing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tab switches re-focus Profile constantly: refetch the three cards at most every 20 s
  // (pull-to-refresh always refetches; a different account always refetches).
  const lastProfileLoad = useRef<{ user: string; at: number }>({ user: '', at: 0 });
  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      const now = Date.now();
      if (lastProfileLoad.current.user === String(userId) && now - lastProfileLoad.current.at < 20000) return;
      lastProfileLoad.current = { user: String(userId), at: now };
      fetchData('focus');
    }, [userId, fetchData])
  );

  // Push categories (kept on this phone, sent with the token) and the App sounds switch.
  useEffect(() => {
    loadPushPrefs().then((p) => {
      pushPrefsRef.current = p;
      if (mountedRef.current) setPushPrefs(p);
    });
    return onSoundSettingChange((on) => { if (mountedRef.current) setSoundsOn(on); });
  }, []);

  const togglePushCategory = (key: PushCategory, value: boolean) => {
    const next = { ...pushPrefsRef.current, [key]: value };
    pushPrefsRef.current = next;
    setPushPrefs(next);
    savePushPrefs(next).then(() => {
      // Tell the server (it skips muted categories). Silent: never prompts for permission here.
      if (pushOn) handleEnablePush(true);
    });
  };

  // Register this device for push once per signed-in user (silent: never prompts here)
  useEffect(() => {
    if (userId) handleEnablePush(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const saveDietMode = (mode: DietPrefs['mode']) => {
    Haptics.selectionAsync().catch(() => {});
    updateDietPrefs({ ...dietPrefs, mode });
    // Also saved on the account, so a new phone starts with the same filter.
    if (user) {
      apiFetch(`${API_URL}/api/users/profile`, {
        method: 'PUT',
        body: JSON.stringify({ dietaryPreference: DIET_TO_SERVER[mode] || 'None' }),
      }).catch(() => {});
    }
  };

  // A phone that never picked a filter starts with the one saved on the account.
  const dietHydratedRef = useRef(false);
  useEffect(() => {
    if (dietHydratedRef.current || !user) return;
    dietHydratedRef.current = true;
    const fromServer = SERVER_TO_DIET[String((user as any)?.dietaryPreference || '')];
    if (!fromServer || fromServer === 'all' || dietPrefs.mode !== 'all') return;
    AsyncStorage.getItem('zenvy_diet_prefs').then((raw) => {
      if (!raw) updateDietPrefs({ ...dietPrefs, mode: fromServer });
    }).catch(() => {});
  }, [user, dietPrefs, updateDietPrefs]);

  const handleEnablePush = async (silent = false) => {
    if (Platform.OS === 'web' || !Notifications) {
      if (!silent) Alert.alert('Not supported', 'Push notifications are not available on this device.');
      return;
    }
    try {
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;
      if (existingStatus !== 'granted') {
        if (silent) return; // Do not prompt silently
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }
      if (finalStatus !== 'granted') {
        if (!silent) Alert.alert('Notifications are off', 'Turn on notifications for ZenWe in your phone settings to get order updates.');
        return;
      }

      let fcmToken = '';
      try {
        const deviceTokenData = await Notifications.getDevicePushTokenAsync();
        fcmToken = deviceTokenData.data;
      } catch (deviceError) {
        console.warn('FCM native token failed, trying Expo fallback:', deviceError);
        let projectId = Constants.expoConfig?.extra?.eas?.projectId || Constants.easConfig?.projectId;
        if (!projectId || projectId === 'your-eas-project-id') {
          projectId = undefined;
        }
        const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
        fcmToken = tokenData.data;
      }
      if (!fcmToken) throw new Error('No push token');

      const pushPrefsNow = await loadPushPrefs();
      const res = await apiFetch(`${API_URL}/api/users/fcm-token`, {
        method: 'POST',
        body: JSON.stringify({ fcmToken, appVersion: APP_VERSION, platform: Platform.OS, pushPrefs: pushPrefsNow }),
      });

      if (res.ok) {
        AsyncStorage.setItem('zenvy_push_token', fcmToken).catch(() => {});
        if (mountedRef.current) setPushOn(true);
        if (!silent && mountedRef.current) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          Alert.alert('Notifications are on', "We'll notify you about your orders on this phone.");
        }
      } else if (!silent && mountedRef.current) {
        const errData = await res.json().catch(() => ({}));
        Alert.alert("Couldn't turn on notifications", errData.message || 'Please try again in a moment.');
      }
    } catch (err: any) {
      console.warn('Push registration error:', err);
      if (!silent && mountedRef.current) Alert.alert("Couldn't turn on notifications", 'Please try again in a moment.');
    }
  };

  // ── Profile editor ──
  const openEditor = () => {
    setEditName(user?.name || '');
    setEditPhone(user?.phone || '');
    setEditEmail(user?.email || '');
    setEditAbout((user?.about || '').slice(0, BIO_MAX));
    setEditAddress(user?.address || '');
    setEditCity(user?.city || '');
    setEditHostelBlock(cleanBlock((user as any)?.hostelBlock));
    setEditRoom(cleanRoom((user as any)?.roomNumber));
    setEditProfileImage(user?.profileImage || null);
    setTouched({});
    setTriedSave(false);
    setFocusField(null);
    setOtpSent(false);
    setOtpCode('');
    setEmailCodeSent(false);
    setEmailCode('');
    setSuggestions([]);
    setShowSuggestions(false);
    setIsEditing(true);
  };

  const closeEditor = () => {
    if (savingRef.current) return;
    if (suggestTimeout.current) clearTimeout(suggestTimeout.current);
    setIsEditing(false);
    setOtpSent(false);
    setOtpCode('');
    phoneOtp.reset();
    setEmailCodeSent(false);
    setEmailCode('');
    setShowSuggestions(false);
  };

  const fetchAddressSuggestions = (query: string) => {
    if (suggestTimeout.current) clearTimeout(suggestTimeout.current);
    if (query.length < 3) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    suggestTimeout.current = setTimeout(async () => {
      try {
        // Signed in (apiFetch adds the session): the server serves address search to signed-in students only.
        const res = await apiFetch(
          `${API_URL}/api/system/nominatim-proxy?type=search&format=json&q=${encodeURIComponent(query)}&countrycodes=in&addressdetails=1&limit=5`
        );
        const results = res.ok ? await res.json() : [];
        if (!mountedRef.current) return;
        setSuggestions(Array.isArray(results) ? results : []);
        setShowSuggestions(Array.isArray(results) && results.length > 0);
      } catch (err) {
        if (mountedRef.current) setSuggestions([]);
      }
    }, 400);
  };

  const handleSelectSuggestion = (item: any) => {
    const addr = item.address || {};
    const parts = [item.name, addr.road || addr.neighbourhood, addr.suburb || addr.village, addr.state_district].filter(Boolean);
    const city = addr.city || addr.town || addr.county || addr.state_district || '';
    setEditAddress((parts.join(', ') || item.display_name || '').slice(0, 200));
    if (city) setEditCity(String(city).slice(0, 60));
    setSuggestions([]);
    setShowSuggestions(false);
  };

  // Same pipeline as Campus: compress to 640 px JPEG, upload to Zenvy media, store the short https link.
  const handleUploadLocalImage = async () => {
    if (uploadingImage) return;
    try {
      setUploadingImage(true);
      const up = await pickAndUploadImage('avatar', { allowsEditing: true, aspect: [1, 1], maxEdge: 640 });
      if (up && mountedRef.current) setEditProfileImage(up.absoluteUrl);
    } catch (err) {
      if (mountedRef.current) alertUploadError(err, handleUploadLocalImage, "Photo didn't upload");
    } finally {
      if (mountedRef.current) setUploadingImage(false);
    }
  };

  const normalizedEditPhone = digitsOnly(editPhone);
  const phoneChanged = !!normalizedEditPhone && normalizedEditPhone !== digitsOnly(user?.phone || '');

  const sendPhoneOtp = async () => {
    if (sendingOtp || resendIn > 0) return;
    if (!PHONE_RE.test(normalizedEditPhone)) {
      Alert.alert('Check your number', 'Enter a valid 10-digit Indian mobile number.');
      return;
    }
    const r = await phoneOtp.send(normalizedEditPhone);
    if (!mountedRef.current) return;
    if (r.ok) {
      setOtpSent(true);
      setOtpCode('');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } else {
      Alert.alert("Couldn't send the OTP", r.message || 'Please try again in a minute.');
    }
  };

  const normalizedEditEmail = editEmail.trim().toLowerCase();
  const emailChanged = !!normalizedEditEmail && normalizedEditEmail !== String(user?.email || '').trim().toLowerCase();

  const sendEmailCode = async () => {
    if (sendingEmailCode || emailResendIn > 0) return;
    if (!EMAIL_RE.test(normalizedEditEmail)) {
      Alert.alert('Check your email', "That email address doesn't look right.");
      return;
    }
    setSendingEmailCode(true);
    try {
      const res = await apiFetch(`${API_URL}/api/users/profile/email-code`, {
        method: 'POST',
        body: JSON.stringify({ email: normalizedEditEmail }),
      });
      const data = await res.json().catch(() => ({} as any));
      if (!mountedRef.current) return;
      if (res.ok) {
        setEmailCodeSent(true);
        setEmailCode('');
        setEmailResendIn(Number(data?.resendAfter) > 0 ? Number(data.resendAfter) : 60);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      } else {
        if (Number(data?.retryAfter) > 0 && data?.code === 'OTP_COOLDOWN') setEmailResendIn(Math.min(Number(data.retryAfter), 120));
        Alert.alert("Couldn't send the code", data?.message || 'Please try again in a minute.');
      }
    } catch {
      if (mountedRef.current) Alert.alert("Couldn't send the code", 'Check your connection and try again.');
    } finally {
      if (mountedRef.current) setSendingEmailCode(false);
    }
  };

  const fieldErrors: Partial<Record<EditField, string>> = (() => {
    const e: Partial<Record<EditField, string>> = {};
    const n = editName.trim().replace(/\s+/g, ' ');
    if (n.length < 2) e.name = 'Enter your name (at least 2 letters).';
    else if (!NAME_RE.test(n)) e.name = 'Use letters only (spaces, . \' - are fine).';
    if (!normalizedEditPhone) e.phone = 'Enter your mobile number.';
    else if (normalizedEditPhone.length < 10) e.phone = `${10 - normalizedEditPhone.length} more digit${normalizedEditPhone.length === 9 ? '' : 's'} needed.`;
    else if (!PHONE_RE.test(normalizedEditPhone)) e.phone = 'Indian mobile numbers start with 6, 7, 8 or 9.';
    if (normalizedEditEmail && !EMAIL_RE.test(normalizedEditEmail)) e.email = 'Check the email, like name@gmail.com.';
    if (editProfileImage && !/^(https?:\/\/|data:image\/)/i.test(editProfileImage)) e.photo = 'Paste a full link starting with https://';
    const room = editRoom.trim();
    if (room && !ROOM_RE.test(room)) e.room = 'Use letters, numbers or - only (e.g. 304, B-214).';
    if (room && !editHostelBlock.trim()) e.block = 'Add your hostel block for this room.';
    const city = editCity.trim();
    if (city && !CITY_RE.test(city)) e.city = 'Use letters only.';
    const addr = editAddress.trim();
    if (addr && (addr.length < 5 || !/\p{L}/u.test(addr))) e.address = 'Add a little more, like the street or a landmark.';
    return e;
  })();
  const showErr = (f: EditField) => (triedSave || touched[f] ? fieldErrors[f] : undefined);
  const touch = (f: EditField) => setTouched((prev) => (prev[f] ? prev : { ...prev, [f]: true }));

  const handleUpdateProfile = async () => {
    if (savingRef.current) return;
    const name = editName.trim().replace(/\s+/g, ' ');
    const email = normalizedEditEmail;
    if (Object.keys(fieldErrors).length) {
      setTriedSave(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      return;
    }
    if (phoneChanged) {
      if (!otpSent) {
        sendPhoneOtp();
        return;
      }
      // In Firebase mode Android may have verified the number in the background (no code typed).
      if (phoneOtp.mode !== 'firebase' && !/^\d{6}$/.test(otpCode)) {
        Alert.alert('Enter the OTP', `Type the 6-digit OTP we sent to +91 ${normalizedEditPhone}.`);
        return;
      }
    }
    // A new (or first) email is saved only with the code we email to it.
    if (emailChanged) {
      if (!emailCodeSent) {
        sendEmailCode();
        return;
      }
      if (!/^\d{6}$/.test(emailCode)) {
        Alert.alert('Enter the email code', `Type the 6-digit code we emailed to ${email}.`);
        return;
      }
    }

    const body: any = {
      name,
      phone: normalizedEditPhone,
      email,
      about: editAbout.trim().slice(0, BIO_MAX),
      address: editAddress.trim().slice(0, 200),
      city: editCity.trim().slice(0, 60),
      hostelBlock: cleanBlock(editHostelBlock),
      roomNumber: cleanRoom(editRoom),
      profileImage: editProfileImage || null,
      ...(emailChanged ? { emailOtp: emailCode } : {}),
    };

    savingRef.current = true;
    setSavingProfile(true);
    try {
      let proof: PhoneProof | null = null;
      if (phoneChanged) {
        try {
          proof = await phoneOtp.getProof(otpCode);
        } catch (e: any) {
          if (mountedRef.current) Alert.alert("Couldn't verify the OTP", e?.message || 'Please try again.');
          return;
        }
      }
      const response = await apiFetch(`${API_URL}/api/users/profile`, {
        method: 'PUT',
        body: JSON.stringify(proof ? { ...body, ...proof } : body),
      });
      const data = await response.json().catch(() => ({} as any));
      if (!mountedRef.current) return;
      if (response.ok) {
        // Never replace the account with the bare form body (it has no _id, wallet, badges…).
        setUser(data && typeof data === 'object' && Object.keys(data).length ? data : { ...user, ...body });
        savingRef.current = false;
        closeEditor();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        Alert.alert('Profile updated', 'Your changes are saved.');
      } else {
        if (emailChanged && ['OTP_EXPIRED', 'OTP_LOCKED', 'EMAIL_VERIFICATION_REQUIRED'].includes(data?.code)) {
          setEmailCodeSent(false);
          setEmailCode('');
        }
        if (data?.code === 'OTP_EXPIRED' || data?.code === 'OTP_LOCKED') {
          setOtpSent(false);
          setOtpCode('');
          phoneOtp.reset();
        }
        if (phoneChanged) phoneOtp.allowAutoRetry();
        Alert.alert("Couldn't save", data?.message || 'Please check your details and try again.');
      }
    } catch (e: any) {
      if (mountedRef.current) Alert.alert("Couldn't save", 'Check your connection and try again.');
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setSavingProfile(false);
    }
  };

  // ── Gifting (Elite perk) ──
  const sendGift = async (amt: number, phone: string) => {
    if (giftRef.current) return;
    giftRef.current = true;
    setSendingGift(true);
    const sig = `${phone}:${amt}`;
    if (!giftKeyRef.current || giftKeyRef.current.sig !== sig) {
      giftKeyRef.current = { sig, key: newIdempotencyKey() };
    }
    const idemKey = giftKeyRef.current.key;
    try {
      const res = await apiFetch(`${API_URL}/api/features/gift`, {
        method: 'POST',
        headers: { 'Idempotency-Key': idemKey },
        body: JSON.stringify({ recipientPhone: phone, amount: amt, idempotencyKey: idemKey }),
      });
      const data = await res.json().catch(() => ({} as any));
      // The server answered: this attempt is settled (a 409 means the same key is still in flight).
      if (res.status !== 409 && giftKeyRef.current?.key === idemKey) giftKeyRef.current = null;
      if (!mountedRef.current) return;
      if (res.ok) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        Alert.alert('Gift sent 🎁', data.message || `₹${amt} is on its way to your friend.`);
        setGiftPhone('');
        fetchData('focus');
      } else {
        Alert.alert('Couldn’t send the gift', data.message || 'Please try again.');
      }
    } catch {
      if (mountedRef.current) {
        // The request may have reached the server before the connection dropped; never claim it failed.
        Alert.alert(
          'Couldn’t confirm the gift',
          'We couldn’t confirm whether your gift went through. Check your Wallet balance before trying again.'
        );
        fetchData('focus');
      }
    } finally {
      giftRef.current = false;
      if (mountedRef.current) setSendingGift(false);
    }
  };

  const handleSendGift = (amt: number) => {
    if (giftRef.current) return;
    const phone = digitsOnly(giftPhone);
    if (!PHONE_RE.test(phone)) {
      Alert.alert('Check the number', "Enter your friend's 10-digit mobile number.");
      return;
    }
    if (phone === digitsOnly(user?.phone || '')) {
      Alert.alert('That’s you!', 'Enter a friend’s number to send a gift.');
      return;
    }
    Alert.alert('Send this gift?', `₹${amt} from your ZenWe Wallet to +91 ${phone}.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: `Send ₹${amt}`, onPress: () => sendGift(amt, phone) },
    ]);
  };

  const copyText = (value: string, title: string, message?: string) => {
    Clipboard.setString(value);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    Alert.alert(title, message ?? value);
  };

  if (!user) {
    return (
      <View style={[s.container, { paddingTop: topPad, backgroundColor: bg }]}>
        <AmbientBackground />
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
          {/* Back, as when signed in: Profile has no tab of its own, it opens from the avatar on Home (3 Nov 2026) */}
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 12 }}>
            <TabBackButton />
            <Text style={{ fontSize: 20, fontWeight: '700', color: txt }}>Profile</Text>
          </View>
          <View style={{ alignItems: 'center', paddingHorizontal: 20, paddingTop: 28, paddingBottom: 36 }}>
            <Ionicons name="lock-closed-outline" size={48} color={txtSec} style={{ marginBottom: 16 }} />
            <Text style={{ fontSize: 18, fontWeight: '700', color: txt, letterSpacing: 0.2, textAlign: 'center', marginBottom: 8 }}>
              Sign in to see your profile
            </Text>
            <Text style={{ fontSize: 12, color: txtSec, fontWeight: '600', textAlign: 'center', marginBottom: 24, lineHeight: 18 }}>
              Sign in to see your profile, orders, coupons and rewards.
            </Text>
            <TouchableOpacity
              style={{
                backgroundColor: COLORS.red,
                paddingHorizontal: 32,
                paddingVertical: 14,
                borderRadius: 16,
                ...SHADOWS.redGlow
              }}
              onPress={() => router.push('/login' as any)}
            >
              <Text style={{ color: '#FFF', fontSize: 12, fontWeight: '700', letterSpacing: 0.3 }}>Sign in or sign up</Text>
            </TouchableOpacity>
          </View>
          {/* Guests can still switch the theme and sounds, read the policies and see About */}
          <ProfileSettingsSection
            signedIn={false}
            soundsOn={soundsOn}
            onSoundsChange={(v) => { setSoundsOn(v); setSoundsEnabled(v); }}
            onOpenHelp={() => router.push('/help' as any)}
            onOpenAbout={() => setShowAbout(true)}
          />
        </ScrollView>
        <AboutZcsModal visible={showAbout} onClose={() => setShowAbout(false)} />
      </View>
    );
  }

  const friendCode: string | null = user?.friendCode || null;
  const referralCode: string | null = user?.referralCode || null;
  const monthlySpend: any[] = Array.isArray(spendStats?.monthlySpend) ? spendStats.monthlySpend : [];
  const topItems: any[] = Array.isArray(spendStats?.topItems) ? spendStats.topItems : [];
  const hasSpend = monthlySpend.some((m) => Number(m?.total) > 0) || topItems.length > 0;
  const favRestaurant = spendStats?.favoriteRestaurant && spendStats.favoriteRestaurant !== 'N/A' ? spendStats.favoriteRestaurant : '—';
  const isDataUriImage = typeof editProfileImage === 'string' && editProfileImage.startsWith('data:');
  const inputBg = isDark ? 'rgba(255,255,255,0.05)' : '#FAFBFC';
  const inputBorder = isDark ? colors.border : '#D3D8E0';
  // One look for every field: accent border while typing, red border + message when it needs a fix.
  const fieldStyle = (f: EditField | 'about' | 'address', extra?: any) => {
    const err = f === 'about' ? undefined : showErr(f as EditField);
    const on = focusField === f;
    return [s.modalInput, { color: txt, backgroundColor: on && !isDark ? d.soft : inputBg, borderColor: err ? '#DC2626' : on ? goldColor : inputBorder, borderWidth: err || on ? 1.6 : 1 }, extra];
  };
  const errText = (f: EditField) => {
    const m = showErr(f);
    return m ? <Text style={s.fieldError} accessibilityLiveRegion="polite">{m}</Text> : null;
  };

  return (
    <View style={[s.container, { paddingTop: 0, backgroundColor: bg }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => fetchData('pull')}
            tintColor={goldColor}
            colors={[goldColor]}
          />
        }
      >
        {/* Back (goes to the previous screen, or Home), on the light diet band */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: topPad + 8, paddingBottom: 18, marginBottom: 14, backgroundColor: d.top, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 }}>
          <TabBackButton />
          <Text style={{ fontSize: 20, fontWeight: '800', color: d.dk }}>Profile</Text>
        </View>

        {/* Profile Card */}
        <StaggeredSection delay={100} direction="down">
          <View style={[s.profileCard, { backgroundColor: cardBg, borderColor: border }, lift]}>

            {/* Top row: Avatar + Zenvy Badge / Streak */}
            <View style={s.profileCardHeader}>
              <TouchableOpacity onPress={openEditor} accessibilityLabel="Edit profile">
                <View style={s.avatarOuterRing}>
                  <LinearGradient
                    colors={[d.acc, d.soft, d.acc]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={s.avatarRingGradient}
                  >
                    <View style={[s.avatar, { backgroundColor: isDark ? '#141416' : '#FFF' }]}>
                      <Avatar
                        uri={user?.profileImage}
                        style={s.avatarImg}
                        fallback={<Text style={[s.avatarText, { color: goldColor }]}>{initials}</Text>}
                      />
                    </View>
                  </LinearGradient>
                  {streak > 0 ? (
                    <View style={[s.streakBadge, { borderColor: isDark ? goldColor : '#FFF', backgroundColor: isDark ? '#000' : d.acc }]}>
                      <Text style={s.streakBadgeText}><Ionicons name="flame" size={9} color="#FFF" /> {streak}</Text>
                    </View>
                  ) : null}
                </View>
              </TouchableOpacity>

              <View style={s.headerBadges}>
                <View style={[s.zenvyBadge, { backgroundColor: rewardGold }]}>
                  <Text style={s.zenvyBadgeText}>ZenWe</Text>
                  <View style={s.zenvyDots}>
                    <View style={s.zenvyDot} />
                    <View style={s.zenvyDot} />
                  </View>
                </View>

                <TouchableOpacity style={[s.streakCapsule, { borderColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)', backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)' }]} onPress={() => router.push('/rewards')}>
                  <Text style={[s.streakCapsuleText, { color: txt }]}>{streak > 0 ? `${streak}-day streak` : 'Start a streak'}</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Name & tier */}
            <Text style={[s.name, { color: txt }]}>{user?.name || 'ZenWe member'}</Text>
            <Text style={[s.tierText, { color: goldColor }]}>
              {user?.isElite ? 'Elite member' : 'ZenWe member'}
              {user?.createdAt && !Number.isNaN(new Date(user.createdAt).getTime()) ? ` · since ${new Date(user.createdAt).getFullYear()}` : ''}
            </Text>

            {friendCode ? (
              <TouchableOpacity
                style={[s.barcodeBtn, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#F3F4F6' }]}
                onPress={() => copyText(friendCode, 'Friend code copied')}
                accessibilityLabel="Copy friend code"
              >
                <Ionicons name="people-outline" size={13} color={txtSec} />
                <Text style={[s.barcodeText, { color: txtSec }]}>Friend code {friendCode}</Text>
              </TouchableOpacity>
            ) : null}

            {/* Saved hostel block & room (used at checkout), else the delivery address */}
            <TouchableOpacity
              style={[s.primaryAddressBox, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#F3F4F6', borderColor: border }]}
              onPress={openEditor}
              accessibilityRole="button"
              accessibilityLabel={`Hostel and room: ${formatHostel(user) || 'not set'}. Edit`}
            >
              <Ionicons name={formatHostel(user) ? 'business-outline' : 'location-outline'} size={15} color={goldColor} />
              <Text style={[s.primaryAddressText, { color: txt }]} numberOfLines={1}>
                {formatHostel(user) || user?.address || 'Set your hostel room & block'}
              </Text>
              <Text style={[s.editAddrText, { color: goldColor }]}>Edit</Text>
            </TouchableOpacity>

            {/* Bio and contact */}
            <View style={{ width: '100%', gap: 10, marginVertical: 12 }}>
              <TouchableOpacity activeOpacity={0.8} onPress={openEditor} style={{ padding: 12, backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : '#F9FAFB', borderRadius: 12, borderWidth: 1, borderColor: border }}>
                <Text style={{ fontSize: 12, fontWeight: '600', color: goldColor, letterSpacing: 0.2, marginBottom: 4 }}>About me</Text>
                <Text style={{ fontSize: 13, color: txt, fontStyle: user?.about ? 'normal' : 'italic', lineHeight: 18 }}>
                  {user?.about || 'No bio yet. Tap to add one.'}
                </Text>
              </TouchableOpacity>

              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1, padding: 12, backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : '#F9FAFB', borderRadius: 12, borderWidth: 1, borderColor: border }}>
                  <Text style={{ fontSize: 12, fontWeight: '600', color: txtSec, letterSpacing: 0.2, marginBottom: 4 }}>Mobile</Text>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: txt }} numberOfLines={1}>
                    {user?.phone ? `+91 ${user.phone}` : 'Not set'}
                  </Text>
                </View>
                <View style={{ flex: 1, padding: 12, backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : '#F9FAFB', borderRadius: 12, borderWidth: 1, borderColor: border }}>
                  <Text style={{ fontSize: 12, fontWeight: '600', color: txtSec, letterSpacing: 0.2, marginBottom: 4 }}>Email</Text>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: txt }} numberOfLines={1}>
                    {user?.email || 'Not set'}
                  </Text>
                </View>
              </View>
            </View>

            {/* Stats */}
            <View style={[s.telemetryContainer, { backgroundColor: isDark ? '#1C1B1F' : '#FAFAFA', borderColor: border }]}>
              <View style={s.telemetryGrid}>
                <View style={s.telemetryItem}>
                  <Text style={s.telemetryLabel}>Delivered</Text>
                  <Text style={[s.telemetryVal, { color: txt }]}>{completedOrders}</Text>
                </View>
                <View style={[s.telemetryItem, s.telemetryBorder]}>
                  <Text style={s.telemetryLabel}>ZenWe Points</Text>
                  <Text style={[s.telemetryVal, { color: rewardGold }]}>{formatCount(user?.zenPoints)}</Text>
                </View>
                <TouchableOpacity
                  style={s.telemetryItem}
                  onPress={() => router.push('/wallet-history' as any)}
                  accessibilityRole="button"
                  accessibilityLabel={`Wallet balance ${formatINR(user?.walletBalance)}. Open wallet history`}
                >
                  <Text style={s.telemetryLabel}>Wallet</Text>
                  <Text style={[s.telemetryVal, { color: goldColor, fontSize: 13 }]}>
                    {formatINR(user?.walletBalance)}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}><Text style={[s.telemetryLabel, { color: goldColor, marginTop: 2 }]}>History</Text><SymbolIcon name="chevron-forward" style={[s.telemetryLabel, { color: goldColor, marginTop: 2 }]} scale={1} /></View>
                </TouchableOpacity>
              </View>

              <View style={s.progressContainer}>
                <View style={s.progressLabels}>
                  <Text style={s.progressTitle}>{nextMilestone ? `Next badge: ${nextMilestone.name}` : allBadgesUnlocked ? 'All order badges earned' : 'Order badges'}</Text>
                  <Text style={[s.progressVal, { color: rewardGold }]}>
                    {nextMilestone ? `${completedOrders} / ${nextMilestone.threshold}` : allBadgesUnlocked ? '✓' : `${completedOrders}`}
                  </Text>
                </View>
                <View style={[s.progressBarBg, { backgroundColor: isDark ? '#000' : '#E0E0E0' }]}>
                  <View style={[s.progressBarFill, { backgroundColor: rewardGold, width: `${milestonePct}%` }]} />
                </View>
              </View>
            </View>

          </View>
        </StaggeredSection>

        {/* Dietary preferences */}
        <StaggeredSection delay={180} direction="up">
          <Text style={[s.sectionTitleText, { color: isDark ? goldColor : '#111', borderLeftColor: goldColor }]}>Food preference</Text>
          <View style={[s.dietCard, { backgroundColor: cardBg, borderColor: border }, lift]}>
            <Text style={[s.dietLabel, { color: txtSec }]}>Filters menus wherever you order</Text>
            <View style={s.dietModeGrid}>
              {([
                { id: 'all', label: 'Everything' },
                { id: 'veg', label: 'Veg only' },
                { id: 'egg', label: 'Eggetarian' },
                { id: 'non-veg', label: 'Non-veg' },
              ] as const).map((opt) => {
                const active = dietPrefs.mode === opt.id
                  || (opt.id === 'egg' && dietPrefs.mode === 'eggarian')
                  || (opt.id === 'non-veg' && dietPrefs.mode === 'nonveg');
                return (
                  <TouchableOpacity
                    key={opt.id}
                    style={[
                      s.dietModeBtn,
                      {
                        backgroundColor: active ? goldColor : (isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)'),
                        borderColor: active ? goldColor : border,
                      },
                    ]}
                    onPress={() => saveDietMode(opt.id)}
                  >
                    <Text style={[s.dietModeBtnText, { color: active ? '#000' : txt }]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={s.divider} />

            <Text style={[s.dietLabel, { color: txtSec }]}>Hide dishes with</Text>
            <View style={s.allergyRow}>
              {([
                { key: 'nuts', label: 'Nuts' },
                { key: 'dairy', label: 'Dairy' },
                { key: 'gluten', label: 'Gluten' },
              ] as const).map(({ key, label }) => (
                <TouchableOpacity
                  key={key}
                  style={[
                    s.allergyBadge,
                    {
                      backgroundColor: dietPrefs[key] ? 'rgba(239, 68, 68, 0.15)' : (isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)'),
                      borderColor: dietPrefs[key] ? '#EF4444' : border,
                    },
                  ]}
                  onPress={() => {
                    Haptics.selectionAsync().catch(() => {});
                    updateDietPrefs({ ...dietPrefs, [key]: !dietPrefs[key] });
                  }}
                >
                  <Text style={[s.allergyBadgeText, { color: dietPrefs[key] ? '#EF4444' : txt }]}>{label}</Text>
                </TouchableOpacity>
              ))}

              {(dietPrefs.custom || []).map((a, i) => (
                <View key={`${a}-${i}`} style={[s.allergyBadge, { backgroundColor: 'rgba(239, 68, 68, 0.15)', borderColor: '#EF4444' }]}>
                  <Text style={[s.allergyBadgeText, { color: '#EF4444' }]}>{a}</Text>
                  <TouchableOpacity
                    onPress={() => updateDietPrefs({ ...dietPrefs, custom: (dietPrefs.custom || []).filter((_, j) => j !== i) })}
                    style={{ marginLeft: 6 }}
                    accessibilityLabel={`Remove ${a}`}
                  >
                    <SymbolIcon name="close" style={{ color: '#EF4444', fontWeight: 'bold', fontSize: 12 }} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>

            <View style={s.allergyInputRow}>
              <TextInput
                value={customAllergy}
                onChangeText={setCustomAllergy}
                placeholder="Other allergy (soy, shellfish…)"
                placeholderTextColor={isDark ? '#666' : '#999'}
                maxLength={30}
                style={[s.allergyInput, { color: txt, borderColor: border, backgroundColor: isDark ? 'rgba(0,0,0,0.2)' : '#FFF' }]}
              />
              <TouchableOpacity
                style={[s.allergyAddBtn, { backgroundColor: goldColor }]}
                onPress={() => {
                  const v = customAllergy.trim();
                  if (!v) return;
                  const existing = dietPrefs.custom || [];
                  if (!existing.some((c) => String(c).toLowerCase() === v.toLowerCase())) {
                    updateDietPrefs({ ...dietPrefs, custom: [...existing, v] });
                  }
                  setCustomAllergy('');
                }}
              >
                <Text style={s.allergyAddBtnText}>Add</Text>
              </TouchableOpacity>
            </View>
            <Text style={{ fontSize: 12, color: txtSec, marginTop: 6 }}>Only dishes the store has marked with that allergen are hidden.</Text>
          </View>
        </StaggeredSection>

        {/* Notifications */}
        <StaggeredSection delay={200} direction="up">
          <Text style={[s.sectionTitleText, { color: isDark ? goldColor : '#111', borderLeftColor: goldColor }]}>Notifications</Text>
          <TouchableOpacity
            style={[s.themeBtn, { backgroundColor: cardBg, borderColor: border }, lift]}
            onPress={() => handleEnablePush(false)}
          >
            <View style={[s.notifIconOuter, { backgroundColor: isDark ? '#1C1B1F' : '#F3F4F6' }]}>
              <Ionicons name="notifications-outline" size={17} color={goldColor} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[s.notifLabel, { color: txt }]}>Order updates on this phone</Text>
              <Text style={[s.notifDesc, { color: txtSec }]}>{pushOn ? 'On for this phone. Turn off in phone settings.' : 'Placed, accepted, out for delivery, delivered'}</Text>
            </View>
            <View style={[s.pushBtn, { borderColor: goldColor }]}>
              <Text style={[s.pushBtnText, { color: goldColor }]}>{pushOn ? 'On' : 'Turn on'}</Text>
            </View>
          </TouchableOpacity>
          {/* Push categories: what this phone is notified about */}
          <View style={[s.prefCard, { backgroundColor: cardBg, borderColor: border }, lift]}>
            {PUSH_CATEGORY_ROWS.map((row, i) => (
              <View key={row.key} style={[s.prefRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[s.notifLabel, { color: txt }]}>{row.label}</Text>
                  <Text style={[s.notifDesc, { color: txtSec }]}>{row.desc}</Text>
                </View>
                <Switch
                  value={pushPrefs[row.key]}
                  onValueChange={(v) => togglePushCategory(row.key, v)}
                  trackColor={{ false: isDark ? '#3A3A3C' : '#D1D5DB', true: goldColor }}
                  thumbColor="#FFFFFF"
                  {...({ activeThumbColor: "#FFFFFF" } as any)}
                  accessibilityLabel={`${row.label} notifications`}
                />
              </View>
            ))}
            <Text style={[s.notifDesc, { color: txtSec, paddingTop: 10 }]}>Chats, calls, wallet and support replies always come through.</Text>
          </View>
        </StaggeredSection>

        {/* Your badges */}
        <StaggeredSection delay={220} direction="up">
          <Text style={[s.sectionTitleText, { color: isDark ? goldColor : '#111', borderLeftColor: goldColor }]}>Your badges</Text>
          <View style={[s.achievementsCard, { backgroundColor: cardBg, borderColor: border }, lift]}>
            {Array.isArray(user?.badges) && user.badges.length > 0 ? (
              <View style={s.badgeGrid}>
                {user.badges.map((badgeName: string) => {
                  const v = badgeVisual(String(badgeName));
                  return (
                    <View key={badgeName} style={[s.badgeCard, { borderColor: v.color }]}>
                      <Text style={s.badgeEmoji}>{v.emoji}</Text>
                      <Text style={[s.badgeTitle, { color: txt }]}>{badgeName}</Text>
                      <Text style={s.badgeDesc}>{v.desc}</Text>
                    </View>
                  );
                })}
              </View>
            ) : (
              <View style={s.emptyAchievements}>
                <Text style={[s.emptyAchievementsText, { color: txtSec }]}>No badges yet</Text>
                <View style={s.grayEmojis}>
                  <Text style={s.grayEmoji}>🥉</Text>
                  <Text style={s.grayEmoji}>🦉</Text>
                  <Text style={s.grayEmoji}>🔥</Text>
                </View>
                <Text style={s.graySubText}>Your first order badge unlocks at 5 delivered orders</Text>
              </View>
            )}

            <View style={s.achievementsFooter}>
              <View style={s.footerLeft}>
                <Text style={[s.footerLabel, { color: txtSec }]}>ZenWe Points</Text>
                <Text style={[s.footerVal, { color: rewardGold }]}>{formatCount(user?.zenPoints)} ZenWe Points</Text>
              </View>
              <View style={s.verticalDivider} />
              <View style={s.footerRight}>
                <Text style={[s.footerLabel, { color: txtSec }]}>Next order badge</Text>
                <Text style={[s.footerVal, { color: txt }]}>
                  {nextMilestone ? `${completedOrders} / ${nextMilestone.threshold} orders` : allBadgesUnlocked ? 'All earned' : plural(completedOrders, 'order')}
                </Text>
              </View>
            </View>
          </View>
        </StaggeredSection>

        {/* Your coupons */}
        <StaggeredSection delay={240} direction="up">
          <View style={s.sectionHeader}>
            <Text style={[s.sectionTitleText, { color: isDark ? goldColor : '#111', borderLeftColor: goldColor }]}>Your coupons</Text>
            <TouchableOpacity onPress={() => router.push('/rewards')}>
              <Text style={[s.sectionAddBtn, { color: goldColor }]}>Spin the wheel</Text>
            </TouchableOpacity>
          </View>
          {coupons.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.couponsScroll}>
              {coupons.map((cpn) => {
                const label = cpn.label || (cpn.type === 'FREEDEL' ? 'Free delivery' : 'Discount');
                const expires = typeof cpn.expiresInDays === 'number'
                  ? (cpn.expiresInDays <= 0 ? 'Expires today' : `Expires in ${cpn.expiresInDays} day${cpn.expiresInDays === 1 ? '' : 's'}`)
                  : 'No expiry';
                return (
                  <View key={cpn.id || cpn.code} style={[s.couponCard, { backgroundColor: isDark ? '#1C1917' : '#FFFDF5', borderColor: goldColor }]}>
                    <Text style={[s.couponType, { color: goldColor }]}>{cpn.type === 'FREEDEL' ? 'Delivery' : 'Discount'}</Text>
                    <Text style={[s.couponHeader, { color: txt }]}>{String(label)}</Text>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: txtSec, marginBottom: 6 }}>{expires}</Text>
                    <View style={s.couponCodeRow}>
                      <Text style={[s.couponCodeText, { color: goldColor }]}>{cpn.code}</Text>
                      <TouchableOpacity onPress={() => copyText(cpn.code, 'Coupon copied', `Use ${cpn.code} at checkout.`)} style={s.couponCopyBtn}>
                        <Text style={s.couponCopyBtnText}>Copy</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          ) : (
            <View style={[s.emptyCard, { backgroundColor: cardBg, borderColor: border }, lift]}>
              <Ionicons name="ticket-outline" size={24} color={goldColor} style={{ marginBottom: 8 }} />
              <Text style={[s.emptyText, { color: txtSec }]}>No coupons yet</Text>
              <Text style={[s.emptySubText, { color: txtSec, marginBottom: 12 }]}>Spin the wheel to win coupons</Text>
              <TouchableOpacity
                style={{ backgroundColor: goldColor, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 12 }}
                onPress={() => router.push('/rewards')}
              >
                <Text style={{ color: isDark ? '#000' : '#FFF', fontSize: 12, fontWeight: '700', letterSpacing: 0.2 }}>Spin the wheel</Text>
              </TouchableOpacity>
            </View>
          )}
        </StaggeredSection>

        {/* Invite friends (real referral code from the account) */}
        {referralCode ? (
          <StaggeredSection delay={260} direction="up">
            <Text style={[s.sectionTitleText, { color: isDark ? goldColor : '#111', borderLeftColor: goldColor }]}>Invite friends</Text>
            <View style={[s.buddyLinkCard, { backgroundColor: isDark ? 'rgba(249, 196, 64, 0.06)' : 'rgba(249, 196, 64, 0.08)', borderColor: isDark ? 'rgba(249, 196, 64, 0.18)' : 'rgba(249, 196, 64, 0.25)' }]}>
              <View style={s.buddyLinkHeader}>
                <View style={s.buddyLinkIconCircle}>
                  <Ionicons name="link-outline" size={22} color={goldColor} />
                </View>
                <View style={s.buddyLinkHeaderText}>
                  <Text style={[s.buddyLinkTitle, { color: isDark ? '#FFF' : '#111' }]}>Invite friends to ZenWe</Text>
                  <Text style={[s.buddyLinkSubtitle, { color: txtSec }]}>
                    When a friend signs up with your code, you both get <Text style={{ color: goldColor, fontWeight: '700' }}>50 ZenWe Points</Text>
                  </Text>
                </View>
              </View>

              <View style={[s.buddyCodeRow, { backgroundColor: isDark ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.04)', borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }]}>
                <View>
                  <Text style={[s.buddyCodeLabel, { color: txtSec }]}>Your code</Text>
                  <Text style={[s.buddyCodeValue, { color: goldColor }]}>{referralCode}</Text>
                </View>
                <TouchableOpacity
                  style={[s.buddyCopyChip, { backgroundColor: isDark ? 'rgba(249,196,64,0.15)' : 'rgba(249,196,64,0.18)' }]}
                  onPress={() => copyText(referralCode, 'Referral code copied')}
                  activeOpacity={0.7}
                >
                  <Text style={[s.buddyCopyChipText, { color: goldColor }]}>Copy</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={s.buddyShareBtn}
                activeOpacity={0.85}
                onPress={async () => {
                  const name = user?.name?.split(' ')[0] || 'Your friend';
                  try {
                    await Share.share({
                      title: 'Join me on ZenWe',
                      message: `${name} invited you to ZenWe: campus food and essentials delivered to your hostel. Sign up with code ${referralCode} and you both get 50 ZenWe Points.`,
                    });
                  } catch (e) {
                    // share sheet dismissed
                  }
                }}
              >
                <LinearGradient colors={['#F9C440', '#E8A317']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.buddyShareBtnGrad}>
                  <Ionicons name="share-outline" size={18} color="#000" />
                  <Text style={s.buddyShareBtnText}>Share my code</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </StaggeredSection>
        ) : null}

        {/* 🎁 Send a Gift (Elite Perk): off. The wallet is non-transferable order credit (the server answers
            403 TRANSFER_DISABLED), so the section is hidden until WALLET_GIFTS_ENABLED is switched back on. */}
        {WALLET_GIFTS_ENABLED && user?.isElite ? (
          <StaggeredSection delay={280} direction="up">
            <Text style={[s.sectionTitleText, { color: isDark ? goldColor : '#111', borderLeftColor: goldColor }]}>SEND A GIFT</Text>
            <View style={[s.giftCard, { backgroundColor: cardBg, borderColor: border }, lift]}>
              <Text style={[s.giftLabel, { color: txtSec }]}>GIFT WALLET MONEY TO A FRIEND (ELITE PERK)</Text>
              <TextInput
                value={giftPhone}
                onChangeText={(t) => setGiftPhone(t.replace(/\D/g, '').slice(0, 10))}
                placeholder="Friend's 10-digit mobile number"
                placeholderTextColor={isDark ? '#666' : '#999'}
                keyboardType="number-pad"
                maxLength={10}
                editable={!sendingGift}
                style={[s.giftInput, { color: txt, borderColor: border }]}
              />
              <View style={s.giftButtonsRow}>
                {[50, 100, 200].map((amt) => (
                  <TouchableOpacity
                    key={amt}
                    disabled={sendingGift}
                    style={[s.giftAmtBtn, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)', borderColor: border }, sendingGift && { opacity: 0.5 }]}
                    onPress={() => handleSendGift(amt)}
                  >
                    <Text style={[s.giftAmtText, { color: goldColor }]}>₹{amt}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {sendingGift ? <ActivityIndicator size="small" color={goldColor} style={{ marginTop: 8 }} /> : null}
              <Text style={s.giftSubText}>3 gifts per month • Paid from your Wallet</Text>
            </View>
          </StaggeredSection>
        ) : null}

        {/* Spending dashboard */}
        <StaggeredSection delay={300} direction="up">
          <Text style={[s.sectionTitleText, { color: isDark ? goldColor : '#111', borderLeftColor: goldColor }]}>Your spending</Text>
          {statsState === 'loading' && !spendStats ? (
            <View style={[s.emptyCard, { backgroundColor: cardBg, borderColor: border }, lift]}>
              <ActivityIndicator color={goldColor} />
            </View>
          ) : statsState === 'error' && !spendStats ? (
            <View style={[s.emptyCard, { backgroundColor: cardBg, borderColor: border }, lift]}>
              <Ionicons name="cloud-offline-outline" size={22} color={txtSec} style={{ marginBottom: 6 }} />
              <Text style={[s.emptyText, { color: txtSec }]}>Couldn't load your spending</Text>
              <TouchableOpacity
                style={{ marginTop: 10, backgroundColor: goldColor, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 12 }}
                onPress={() => { setStatsState('loading'); fetchData('focus'); }}
              >
                <Text style={{ color: isDark ? '#000' : '#FFF', fontSize: 12, fontWeight: '700', letterSpacing: 0.2 }}>Try again</Text>
              </TouchableOpacity>
            </View>
          ) : !hasSpend ? (
            <View style={[s.emptyCard, { backgroundColor: cardBg, borderColor: border }, lift]}>
              <Ionicons name="receipt-outline" size={22} color={txtSec} style={{ marginBottom: 6 }} />
              <Text style={[s.emptyText, { color: txtSec }]}>Your spending shows up here after your first order</Text>
              <TouchableOpacity
                style={{ marginTop: 10, backgroundColor: goldColor, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 12 }}
                onPress={() => router.push('/(tabs)' as any)}
              >
                <Text style={{ color: isDark ? '#000' : '#FFF', fontSize: 12, fontWeight: '700', letterSpacing: 0.2 }}>Order now</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={s.spendingWrapper}>
              {monthlySpend.length > 0 && (
                <View style={[s.chartCard, { backgroundColor: cardBg, borderColor: border }, lift]}>
                  <Text style={[s.chartTitle, { color: txtSec }]}>Last 6 months</Text>
                  <View style={s.chartRow}>
                    {(() => {
                      const max = Math.max(...monthlySpend.map((m: any) => Number(m.total) || 0), 1);
                      return monthlySpend.map((m: any, i: number) => {
                        const total = Number(m.total) || 0;
                        const barHeight = Math.max(8, (total / max) * 70);
                        return (
                          <View key={`${m.month}-${i}`} style={s.chartBarContainer}>
                            <View
                              style={[
                                s.chartBar,
                                {
                                  height: barHeight,
                                  backgroundColor: i === monthlySpend.length - 1 ? goldColor : (isDark ? 'rgba(255,255,255,0.12)' : '#E5E7EB'),
                                },
                              ]}
                            />
                            <Text style={[s.chartBarMonth, { color: txtSec }]}>{String(m.month || '').split(' ')[0]}</Text>
                            {total > 0 ? <Text style={[s.chartBarTotal, { color: txt }]}>{formatINR(total, { paise: 'never' })}</Text> : null}
                          </View>
                        );
                      });
                    })()}
                  </View>
                </View>
              )}

              {topItems.length > 0 && (
                <View style={[s.topItemsCard, { backgroundColor: cardBg, borderColor: border }, lift]}>
                  <Text style={[s.chartTitle, { color: txtSec }]}>Most ordered</Text>
                  {topItems.map((item: any, i: number) => (
                    <View key={`${item.name}-${i}`} style={s.topItemRow}>
                      <View style={s.topItemLeft}>
                        <Text style={{ fontSize: 13, fontWeight: '700', color: goldColor, minWidth: 16, textAlign: 'center' }}>{i + 1}</Text>
                        <View style={{ marginLeft: 10, flexShrink: 1 }}>
                          <Text style={[s.topItemName, { color: txt }]} numberOfLines={1}>{item.name}</Text>
                          <Text style={[s.topItemCount, { color: txtSec }]}>Ordered {plural(item.count, 'time')}</Text>
                        </View>
                      </View>
                      <Text style={[s.topItemSpend, { color: goldColor }]}>{formatINR(item.spend)}</Text>
                    </View>
                  ))}
                </View>
              )}

              <View style={s.statsGridRow}>
                {[
                  { label: 'Avg order', value: formatINR(spendStats?.avgOrderValue), icon: 'cube-outline' },
                  { label: 'Delivered', value: formatCount(completedOrders), icon: 'receipt-outline' },
                  { label: 'Streak', value: plural(streak, 'day'), icon: 'flame-outline' },
                  { label: 'Favourite', value: favRestaurant, icon: 'heart-outline' },
                ].map((stat) => (
                  <View key={stat.label} style={[s.smallStatCard, { backgroundColor: cardBg, borderColor: border }, lift]}>
                    <Ionicons name={stat.icon as any} size={18} color={goldColor} style={{ marginBottom: 4 }} />
                    <Text style={[s.smallStatVal, { color: txt }]} numberOfLines={1}>
                      {stat.value}
                    </Text>
                    <Text style={[s.smallStatLabel, { color: txtSec }]}>{stat.label}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}
        </StaggeredSection>

        {/* Help, support and about */}
        <StaggeredSection delay={320} direction="up">
          <Text style={[s.sectionTitleText, { color: isDark ? goldColor : '#111', borderLeftColor: goldColor }]}>Help & support</Text>
          <View style={s.supportGrid}>
            <TouchableOpacity style={[s.supportBtn, { backgroundColor: cardBg, borderColor: border }, lift]} onPress={() => router.push('/support' as any)}>
              <Ionicons name="help-buoy-outline" size={20} color={goldColor} />
              <Text style={[s.supportBtnTitle, { color: goldColor }]}>Support tickets</Text>
              <Text style={[s.supportBtnDesc, { color: txtSec }]}>Report an issue & track it</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[s.supportBtn, { backgroundColor: cardBg, borderColor: border }, lift]} onPress={() => router.push('/help' as any)} accessibilityRole="button" accessibilityLabel="Help and FAQ">
              <Ionicons name="help-circle-outline" size={20} color={goldColor} />
              <Text style={[s.supportBtnTitle, { color: txt }]}>Help and FAQ</Text>
              <Text style={[s.supportBtnDesc, { color: txtSec }]}>Hours, payments, refunds</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[s.supportBtn, { backgroundColor: cardBg, borderColor: border }, lift]} onPress={() => setShowAbout(true)}>
              <Ionicons name="information-circle-outline" size={20} color={goldColor} />
              <Text style={[s.supportBtnTitle, { color: txt }]}>About ZenWe</Text>
              <Text style={[s.supportBtnDesc, { color: txtSec }]}>Version & info</Text>
            </TouchableOpacity>
          </View>
        </StaggeredSection>

        {/* Settings: preferences, help and legal, account, delete, version */}
        <StaggeredSection delay={340} direction="up">
          <ProfileSettingsSection
            signedIn
            soundsOn={soundsOn}
            onSoundsChange={(v) => { setSoundsOn(v); setSoundsEnabled(v); }}
            onOpenHelp={() => router.push('/help' as any)}
            onSignOut={() => {
              Alert.alert(
                'Sign out?',
                'You can sign back in anytime with your mobile number.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Sign out',
                    style: 'destructive',
                    onPress: async () => {
                      await logout();
                      router.replace('/login');
                    },
                  },
                ],
              );
            }}
            // Account deletion (Google Play requirement): anonymises the account + deletes personal data
            onDeleteAccount={() => setShowDeleteAccount(true)}
          />
        </StaggeredSection>

      </ScrollView>

      {/* ─── Modal: edit profile ─── */}
      {/* Edit profile as a full-screen form (owner, 10 Nov 2026: fill it like a form; fields shrank and the colours
          merged): diet band header, three section cards, full-width bordered fields, Save fixed at the bottom. */}
      <Modal visible={isEditing} animationType="slide" transparent={false} statusBarTranslucent onRequestClose={closeEditor}>
        <View style={{ flex: 1, backgroundColor: isDark ? colors.bg : d.pageDeep }}>
          <View style={[s.formHeader, { paddingTop: topPad + 10, backgroundColor: d.top }]}>
            <TouchableOpacity onPress={closeEditor} disabled={savingProfile} style={[s.formClose, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : '#FFFFFF' }]} accessibilityRole="button" accessibilityLabel="Close without saving">
              <Ionicons name="close" size={22} color={d.dk} />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={[s.formTitle, { color: d.dk }]}>Edit profile</Text>
              <Text style={[s.formSub, { color: d.dk }]}>Fields marked * are needed for delivery</Text>
            </View>
          </View>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
            <ScrollView
              contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View style={[s.formCard, { backgroundColor: isDark ? colors.card : '#FFFFFF', borderColor: isDark ? colors.border : 'rgba(17,17,26,0.06)' }]}>
              <View style={s.formSectionRow}>
                <Ionicons name="camera-outline" size={17} color={goldColor} />
                <Text style={[s.formSectionText, { color: txt }]}>Profile photo</Text>
              </View>

              {/* Avatar preview */}
              <View style={{ alignItems: 'center', marginVertical: 12 }}>
                <View style={{ width: 80, height: 80, borderRadius: 40, overflow: 'hidden', borderWidth: 2.5, borderColor: goldColor, backgroundColor: isDark ? '#1C1917' : '#F1F5F9', alignItems: 'center', justifyContent: 'center' }}>
                  <Avatar
                    uri={editProfileImage}
                    style={{ width: '100%', height: '100%' }}
                    fallback={<Text style={{ fontSize: 24, fontWeight: '700', color: goldColor }}>{initials}</Text>}
                  />
                </View>
                {editProfileImage ? (
                  <TouchableOpacity onPress={() => setEditProfileImage(null)} style={{ marginTop: 6, padding: 4 }}>
                    <Text style={{ fontSize: 12, fontWeight: '600', color: '#EF4444', letterSpacing: 0.2 }}>Remove photo</Text>
                  </TouchableOpacity>
                ) : null}
              </View>

              <TouchableOpacity
                style={[s.localUploadBtn, !isDark && { backgroundColor: d.soft, borderColor: d.acc }]}
                onPress={handleUploadLocalImage}
                disabled={uploadingImage || savingProfile}
              >
                {uploadingImage ? (
                  <ActivityIndicator size="small" color={goldColor} />
                ) : (
                  <Text style={[s.localUploadBtnText, !isDark && { color: d.acc }]}>{isDataUriImage ? 'Choose a different photo' : 'Choose from gallery'}</Text>
                )}
              </TouchableOpacity>

              {/* Only without a photo: it showed the stored photo's server address (3 Nov 2026). */}
              {!isDataUriImage && !editProfileImage ? (
                <>
                  <Text style={[s.inputLabel, { color: txtSec }]}>Or paste an image link</Text>
                  <TextInput
                    value={editProfileImage || ''}
                    onChangeText={(t) => setEditProfileImage(t.trim() ? t.trim() : null)}
                    placeholder="https://…"
                    placeholderTextColor={txtSec}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    onFocus={() => setFocusField('photo')}
                    onBlur={() => { setFocusField(null); touch('photo'); }}
                    style={fieldStyle('photo')}
                  />
                  {errText('photo')}
                </>
              ) : null}

              </View>

              <View style={[s.formCard, { backgroundColor: isDark ? colors.card : '#FFFFFF', borderColor: isDark ? colors.border : 'rgba(17,17,26,0.06)' }]}>
              <View style={s.formSectionRow}>
                <Ionicons name="person-outline" size={17} color={goldColor} />
                <Text style={[s.formSectionText, { color: txt }]}>Your details</Text>
              </View>
              {/* Name */}
              <Text style={[s.inputLabel, { color: txtSec }]}>Full name *</Text>
              <TextInput
                value={editName}
                onChangeText={setEditName}
                placeholder="Your name"
                placeholderTextColor={txtSec}
                maxLength={50}
                autoCapitalize="words"
                textContentType="name"
                autoComplete="name"
                onFocus={() => setFocusField('name')}
                onBlur={() => { setFocusField(null); touch('name'); setEditName((v) => v.trim().replace(/\s+/g, ' ')); }}
                style={fieldStyle('name')}
              />
              {errText('name')}

              {/* Mobile Number */}
              <Text style={[s.inputLabel, { color: txtSec }]}>Mobile number *</Text>
              <TextInput
                value={editPhone}
                onChangeText={(t) => {
                  setEditPhone(t.replace(/\D/g, '').slice(0, 10));
                  if (otpSent) { setOtpSent(false); setOtpCode(''); }
                }}
                placeholder="10-digit mobile number"
                placeholderTextColor={txtSec}
                keyboardType="number-pad"
                maxLength={10}
                textContentType="telephoneNumber"
                onFocus={() => setFocusField('phone')}
                onBlur={() => { setFocusField(null); touch('phone'); }}
                style={fieldStyle('phone')}
              />
              {errText('phone')}
              {phoneChanged && !fieldErrors.phone ? (
                <View style={{ marginTop: -4, marginBottom: 8 }}>
                  {otpSent ? (
                    <>
                      <Text style={{ fontSize: 12, color: txtSec, fontWeight: '600', marginBottom: 6 }}>
                        Enter the 6-digit OTP we sent to +91 {normalizedEditPhone}
                      </Text>
                      <TextInput
                        value={otpCode}
                        onChangeText={(t) => setOtpCode(t.replace(/\D/g, '').slice(0, 6))}
                        placeholder="6-digit OTP"
                        placeholderTextColor={txtSec}
                        keyboardType="number-pad"
                        maxLength={6}
                        textContentType="oneTimeCode"
                        autoComplete="sms-otp"
                        style={[s.modalInput, { color: txt, backgroundColor: inputBg, borderColor: goldColor, letterSpacing: 6, textAlign: 'center' }]}
                      />
                      <TouchableOpacity onPress={sendPhoneOtp} disabled={sendingOtp || resendIn > 0} style={{ alignSelf: 'flex-end', padding: 4 }}>
                        <Text style={{ fontSize: 12, fontWeight: '600', color: resendIn > 0 ? txtSec : goldColor }}>
                          {sendingOtp ? 'Sending…' : resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend OTP'}
                        </Text>
                      </TouchableOpacity>
                    </>
                  ) : (
                    <Text style={{ fontSize: 12, color: txtSec, fontWeight: '600' }}>
                      We'll text an OTP to the new number to confirm it's yours.
                    </Text>
                  )}
                </View>
              ) : null}

              {/* Email */}
              <Text style={[s.inputLabel, { color: txtSec }]}>Email (optional)</Text>
              <TextInput
                value={editEmail}
                onChangeText={(t) => {
                  setEditEmail(t);
                  if (emailCodeSent) { setEmailCodeSent(false); setEmailCode(''); }
                }}
                placeholder="you@example.com"
                placeholderTextColor={txtSec}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={100}
                textContentType="emailAddress"
                onFocus={() => setFocusField('email')}
                onBlur={() => { setFocusField(null); touch('email'); setEditEmail((v) => v.trim()); }}
                style={fieldStyle('email')}
              />
              {errText('email')}
              {emailChanged && !fieldErrors.email ? (
                <View style={{ marginTop: -4, marginBottom: 8 }}>
                  {emailCodeSent ? (
                    <>
                      <Text style={{ fontSize: 12, color: txtSec, fontWeight: '600', marginBottom: 6 }}>
                        Enter the 6-digit code we emailed to {normalizedEditEmail}
                      </Text>
                      <TextInput
                        value={emailCode}
                        onChangeText={(t) => setEmailCode(t.replace(/\D/g, '').slice(0, 6))}
                        placeholder="6-digit code"
                        placeholderTextColor={txtSec}
                        keyboardType="number-pad"
                        maxLength={6}
                        textContentType="oneTimeCode"
                        autoComplete="one-time-code"
                        style={[s.modalInput, { color: txt, backgroundColor: inputBg, borderColor: goldColor, letterSpacing: 6, textAlign: 'center' }]}
                      />
                      <TouchableOpacity onPress={sendEmailCode} disabled={sendingEmailCode || emailResendIn > 0} style={{ alignSelf: 'flex-end', padding: 4 }}>
                        <Text style={{ fontSize: 12, fontWeight: '600', color: emailResendIn > 0 ? txtSec : goldColor }}>
                          {sendingEmailCode ? 'Sending…' : emailResendIn > 0 ? `Resend in ${emailResendIn}s` : 'Resend code'}
                        </Text>
                      </TouchableOpacity>
                    </>
                  ) : (
                    <Text style={{ fontSize: 12, color: txtSec, fontWeight: '600' }}>
                      We'll email a code to the new address to confirm it's yours.
                    </Text>
                  )}
                </View>
              ) : null}

              {/* Bio/About */}
              <Text style={[s.inputLabel, { color: txtSec }]}>About me</Text>
              <TextInput
                value={editAbout}
                onChangeText={setEditAbout}
                placeholder="Write something about yourself…"
                placeholderTextColor={txtSec}
                multiline
                numberOfLines={3}
                maxLength={BIO_MAX}
                onFocus={() => setFocusField('about')}
                onBlur={() => setFocusField(null)}
                style={fieldStyle('about', { height: 80, textAlignVertical: 'top', paddingTop: 10 })}
              />
              <Text style={{ fontSize: 12, color: txtSec, textAlign: 'right', marginTop: -4, marginBottom: 6 }}>{editAbout.length}/{BIO_MAX}</Text>

              {/* Where you live (10 Nov 2026): block chips, then Block + Room side by side, then the other address and City */}
              </View>

              <View style={[s.formCard, { backgroundColor: isDark ? colors.card : '#FFFFFF', borderColor: isDark ? colors.border : 'rgba(17,17,26,0.06)', zIndex: 5 }]}>
              <View style={s.formSectionRow}>
                <Ionicons name="location-outline" size={17} color={goldColor} />
                <Text style={[s.formSectionText, { color: txt }]}>Where you live</Text>
              </View>
              {myHostelCampuses.some((c) => c.blocks.length) ? <Text style={[s.inputLabel, { color: txtSec }]}>Pick your hostel block</Text> : null}
              {myHostelCampuses.length > 0 && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                  {myHostelCampuses.flatMap((c) => c.blocks.map((b) => ({ key: `${c.code}:${b}`, block: b }))).filter((x, i, arr) => arr.findIndex((y) => y.block === x.block) === i).slice(0, 32).map(({ key, block }) => {
                    const on = editHostelBlock.toLowerCase() === block.toLowerCase();
                    return (
                      <TouchableOpacity
                        key={key}
                        onPress={() => setEditHostelBlock(on ? '' : block)}
                        accessibilityRole="button"
                        accessibilityState={{ selected: on }}
                        style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, borderWidth: 1, borderColor: on ? goldColor : border, backgroundColor: on ? goldColor : inputBg }}
                      >
                        <Text style={{ fontSize: 12, fontWeight: '600', color: on ? (isDark ? '#000' : '#FFF') : txt }}>{block}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
              <View style={s.twoCol}>
                <View style={{ flex: 1.35 }}>
                  <Text style={[s.inputLabel, { color: txtSec }]}>Hostel block *</Text>
                  <TextInput
                    value={editHostelBlock}
                    onChangeText={(t) => setEditHostelBlock(t.slice(0, HOSTEL_BLOCK_MAX))}
                    placeholder={myHostelCampuses.some((c) => c.blocks.length) ? 'Or type it' : 'Hostel or block'}
                    placeholderTextColor={txtSec}
                    maxLength={HOSTEL_BLOCK_MAX}
                    onFocus={() => setFocusField('block')}
                    onBlur={() => { setFocusField(null); touch('block'); }}
                    style={fieldStyle('block')}
                  />
                  {errText('block')}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.inputLabel, { color: txtSec }]}>Room *</Text>
                  <TextInput
                    value={editRoom}
                    onChangeText={(t) => setEditRoom(t.replace(/^\s*room\s*/i, '').slice(0, ROOM_NUMBER_MAX))}
                    placeholder="e.g. 304"
                    placeholderTextColor={txtSec}
                    maxLength={ROOM_NUMBER_MAX}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    onFocus={() => setFocusField('room')}
                    onBlur={() => { setFocusField(null); touch('room'); touch('block'); }}
                    style={fieldStyle('room')}
                  />
                  {errText('room')}
                </View>
              </View>

              {/* Delivery Address Auto-complete */}
              <Text style={[s.inputLabel, { color: txtSec }]}>Other address (optional)</Text>
              {/* Full width like the other fields (the bare wrapper shrank it to its text and centred it). */}
              <View style={{ zIndex: 99, alignSelf: 'stretch' }}>
                <TextInput
                  value={editAddress}
                  onChangeText={(text) => {
                    setEditAddress(text);
                    fetchAddressSuggestions(text);
                  }}
                  placeholder="Street, area or landmark"
                  placeholderTextColor={txtSec}
                  maxLength={200}
                  onFocus={() => setFocusField('address')}
                  onBlur={() => { setFocusField(null); touch('address'); }}
                  style={fieldStyle('address', { paddingRight: 40 })}
                />
                {editAddress ? (
                  <TouchableOpacity onPress={() => { setEditAddress(''); setSuggestions([]); setShowSuggestions(false); }} style={s.clearBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityLabel="Clear address">
                    <Ionicons name="close-circle" size={18} color={txtSec} />
                  </TouchableOpacity>
                ) : null}
                {errText('address')}

                {showSuggestions && suggestions.length > 0 && (
                  <View style={[s.suggestionsBox, { backgroundColor: isDark ? colors.card : '#FFFFFF', borderColor: inputBorder }]}>
                    {suggestions.map((item, i) => {
                      const full = String(item.display_name || '');
                      const head = String(item.name || full.split(',')[0] || '').trim();
                      const rest = full.split(',').slice(1, 4).join(',').trim();
                      return (
                        <TouchableOpacity
                          key={item.place_id || i}
                          onPress={() => handleSelectSuggestion(item)}
                          style={[s.suggestionItem, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: inputBorder }]}
                          accessibilityRole="button"
                          accessibilityLabel={`Use ${full}`}
                        >
                          <View style={[s.suggestionPin, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : d.soft }]}>
                            <Ionicons name="location" size={14} color={goldColor} />
                          </View>
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={[s.suggestionText, { color: txt }]} numberOfLines={1}>{head}</Text>
                            {rest ? <Text style={{ fontSize: 11.5, color: txtSec, marginTop: 1 }} numberOfLines={1}>{rest}</Text> : null}
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
              </View>

              {/* City */}
              <Text style={[s.inputLabel, { color: txtSec }]}>City</Text>
              <TextInput
                value={editCity}
                onChangeText={setEditCity}
                placeholder="City"
                placeholderTextColor={txtSec}
                maxLength={60}
                autoCapitalize="words"
                onFocus={() => setFocusField('city')}
                onBlur={() => { setFocusField(null); touch('city'); }}
                style={fieldStyle('city')}
              />
              {errText('city')}
              {campusCity && !editCity.trim() ? (
                <TouchableOpacity onPress={() => setEditCity(campusCity)} style={[s.useCityChip, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : d.soft }]} accessibilityRole="button">
                  <Ionicons name="navigate-outline" size={13} color={goldColor} />
                  <Text style={{ fontSize: 12, fontWeight: '700', color: goldColor }}>Use {campusCity}</Text>
                </TouchableOpacity>
              ) : null}
              {triedSave && Object.keys(fieldErrors).length ? (
                <Text style={[s.fieldError, { alignSelf: 'center', marginTop: 10 }]}>Fix the fields marked in red to save.</Text>
              ) : null}

              </View>
            </ScrollView>
              <View style={[s.formFooter, { backgroundColor: isDark ? colors.card : '#FFFFFF', borderTopColor: isDark ? colors.border : 'rgba(17,17,26,0.08)' }]}>
                <TouchableOpacity
                  style={[s.modalCancelBtn, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }]}
                  onPress={closeEditor}
                  disabled={savingProfile}
                >
                  <Text style={[s.modalCancelBtnText, { color: txt }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.modalSaveBtn, { backgroundColor: goldColor }, (savingProfile || sendingOtp || sendingEmailCode) && { opacity: 0.7 }]}
                  onPress={handleUpdateProfile}
                  disabled={savingProfile || sendingOtp || sendingEmailCode}
                >
                  {savingProfile || sendingOtp || sendingEmailCode ? (
                    <ActivityIndicator size="small" color={isDark ? '#000' : '#FFF'} />
                  ) : (
                    <Text style={s.modalSaveBtnText}>{phoneChanged && !otpSent ? 'Verify number' : emailChanged && !emailCodeSent ? 'Verify email' : 'Save'}</Text>
                  )}
                </TouchableOpacity>
              </View>
      </KeyboardAvoidingView>
        </View>
      </Modal>

      <DeleteAccountModal
        visible={showDeleteAccount}
        phone={user?.phone}
        onClose={() => setShowDeleteAccount(false)}
        onDeleted={async () => {
          setShowDeleteAccount(false);
          await logout();
          router.replace('/login');
        }}
      />

      {/* ─── About ZCS ─── */}
      <AboutZcsModal visible={showAbout} onClose={() => setShowAbout(false)} />

    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: Platform.OS === 'android' ? 40 : 50,
    width: '100%',
    maxWidth: 600,
    alignSelf: 'center',
  },
  profileCard: {
    marginHorizontal: 16,
    paddingVertical: 24,
    paddingHorizontal: 20,
    borderRadius: 28,
    borderWidth: 1.5,
    marginBottom: 20,
    ...SHADOWS.card,
  },
  profileCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    marginBottom: 16,
  },
  avatarOuterRing: {
    position: 'relative',
  },
  avatarRingGradient: {
    width: 88,
    height: 88,
    borderRadius: 44,
    padding: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    width: '100%',
    height: '100%',
    borderRadius: 41,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImg: {
    width: '100%',
    height: '100%',
  },
  avatarText: {
    fontSize: 24,
    fontWeight: '700',
  },
  streakBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  streakBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFF',
  },
  headerBadges: {
    alignItems: 'flex-end',
    gap: 8,
  },
  zenvyBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    ...SHADOWS.goldGlow,
  },
  zenvyBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#000',
    letterSpacing: 0.4,
  },
  zenvyDots: {
    flexDirection: 'row',
    gap: 2,
  },
  zenvyDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  streakCapsule: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  streakCapsuleText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFF',
  },
  name: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: 0.3,
    marginBottom: 4,
    textAlign: 'left',
    alignSelf: 'flex-start',
  },
  tierText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
    marginBottom: 16,
    alignSelf: 'flex-start',
  },
  barcodeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    alignSelf: 'flex-start',
    marginBottom: 16,
  },
  barcodeLines: {
    flexDirection: 'row',
    gap: 2,
    height: 12,
    opacity: 0.6,
  },
  barcodeLine: {
    height: '100%',
  },
  barcodeText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  primaryAddressBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    width: '100%',
    gap: 8,
    marginBottom: 16,
  },
  primaryAddressText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
  },
  editAddrText: {
    fontSize: 12,
    fontWeight: '700',
  },
  telemetryContainer: {
    width: '100%',
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
    marginTop: 8,
  },
  telemetryGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  telemetryItem: {
    flex: 1,
    alignItems: 'center',
  },
  telemetryBorder: {
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  telemetryLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#888',
    marginBottom: 4,
  },
  telemetryVal: {
    fontSize: 18,
    fontWeight: '700',
  },
  progressContainer: {
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingTop: 12,
  },
  progressLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  progressTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#888',
  },
  progressVal: {
    fontSize: 12,
    fontWeight: '700',
  },
  progressBarBg: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
  },
  sectionTitleText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
    borderLeftWidth: 3,
    borderLeftColor: '#D4AF7A',
    paddingLeft: 12,
    marginVertical: 12,
    marginLeft: 16,
  },
  sectionAddBtn: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  emptyCard: {
    marginHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 12,
    fontWeight: '600',
  },
  emptySubText: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
  savedAddressCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderRadius: 20,
    borderWidth: 1,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  savedAddressLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  savedAddressIconBox: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: 'rgba(201,168,76,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  savedAddressLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  savedAddressVal: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
    flexShrink: 1,
  },
  deleteBtnText: {
    fontSize: 14,
    color: '#EF4444',
    paddingHorizontal: 8,
    fontWeight: '600',
  },
  dietCard: {
    marginHorizontal: 16,
    borderRadius: 24,
    borderWidth: 1,
    padding: 16,
    marginBottom: 20,
  },
  dietLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
    marginBottom: 10,
  },
  dietModeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  dietModeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
  },
  dietModeBtnText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginVertical: 14,
  },
  allergyRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 12,
  },
  allergyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
  },
  allergyBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  allergyInputRow: {
    flexDirection: 'row',
    gap: 8,
    height: 40,
    marginTop: 8,
  },
  allergyInput: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 12,
    fontWeight: '600',
  },
  allergyAddBtn: {
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  allergyAddBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFF', // restyle-fixes-2026-11-10: white on the diet accent
  },
  pushBtn: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  pushBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  notifCard: {
    marginHorizontal: 16,
    borderRadius: 24,
    borderWidth: 1,
    padding: 16,
    marginBottom: 20,
    gap: 16,
  },
  notifRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  notifLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  notifIconOuter: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notifLabel: {
    fontSize: 12,
    fontWeight: '700',
  },
  notifDesc: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  achievementsCard: {
    marginHorizontal: 16,
    borderRadius: 24,
    borderWidth: 1,
    padding: 16,
    marginBottom: 20,
  },
  badgeGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  badgeCard: {
    flex: 1,
    borderRadius: 18,
    borderWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.02)',
    alignItems: 'center',
    padding: 14,
  },
  badgeEmoji: {
    fontSize: 22,
    marginBottom: 6,
  },
  badgeTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFF',
    letterSpacing: 0.5,
  },
  badgeDesc: {
    fontSize: 12,
    fontWeight: '700',
    color: '#888',
    marginTop: 2,
  },
  emptyAchievements: {
    alignItems: 'center',
    paddingVertical: 14,
  },
  emptyAchievementsText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  grayEmojis: {
    flexDirection: 'row',
    gap: 12,
    marginVertical: 10,
    opacity: 0.15,
  },
  grayEmoji: {
    fontSize: 24,
  },
  graySubText: {
    fontSize: 12,
    color: '#666',
    fontWeight: '600',
  },
  achievementsFooter: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    marginTop: 14,
    paddingTop: 12,
  },
  footerLeft: {
    flex: 1,
    alignItems: 'flex-start',
  },
  footerRight: {
    flex: 1,
    alignItems: 'flex-end',
  },
  verticalDivider: {
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  footerLabel: {
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 2,
  },
  footerVal: {
    fontSize: 13,
    fontWeight: '700',
  },
  couponsScroll: {
    paddingLeft: 16,
    marginBottom: 20,
  },
  couponCard: {
    width: 220,
    borderRadius: 20,
    borderWidth: 1.5,
    padding: 16,
    marginRight: 12,
  },
  couponType: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  couponHeader: {
    fontSize: 15,
    fontWeight: '700',
    marginVertical: 6,
  },
  couponCodeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginTop: 6,
  },
  couponCodeText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  couponCopyBtn: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  couponCopyBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFF',
  },
  // ── Buddy Link Styles ─────────────────────────────
  buddyLinkCard: {
    marginHorizontal: 16,
    borderRadius: 28,
    borderWidth: 1.5,
    padding: 20,
    marginBottom: 20,
  },
  buddyLinkHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 18,
    gap: 12,
  },
  buddyLinkIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(249, 196, 64, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buddyLinkIconEmoji: {
    fontSize: 22,
  },
  buddyLinkHeaderText: {
    flex: 1,
  },
  buddyLinkTitle: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  buddyLinkSubtitle: {
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 13,
  },
  buddyCodeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 10,
  },
  buddyCodeLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
    marginBottom: 3,
  },
  buddyCodeValue: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 2.5,
  },
  buddyCopyChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 10,
  },
  buddyCopyChipText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  buddyLinkUrlRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 16,
  },
  buddyLinkUrlText: {
    fontSize: 12,
    fontWeight: '700',
    flex: 1,
    marginRight: 8,
  },
  buddyQrWrapper: {
    alignItems: 'center',
    marginBottom: 18,
  },
  buddyQrContainer: {
    padding: 14,
    borderRadius: 20,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  buddyQrHint: {
    fontSize: 12,
    fontWeight: '700',
    marginTop: 8,
    letterSpacing: 0.5,
  },
  buddyShareBtn: {
    marginBottom: 16,
    borderRadius: 18,
    overflow: 'hidden',
    shadowColor: '#F9C440',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  buddyShareBtnGrad: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 52,
    gap: 8,
  },
  buddyShareBtnEmoji: {
    fontSize: 18,
  },
  buddyShareBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFF', // restyle-fixes-2026-11-10: white on the diet accent
    letterSpacing: 0.3,
  },
  buddyStatsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  buddyStatPill: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 10,
    alignItems: 'center',
  },
  buddyStatNum: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 2,
  },
  buddyStatLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  giftCard: {
    marginHorizontal: 16,
    borderRadius: 24,
    borderWidth: 1,
    padding: 16,
    marginBottom: 20,
  },
  giftLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
    marginBottom: 10,
  },
  giftInput: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 10,
  },
  giftButtonsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  giftAmtBtn: {
    flex: 1,
    borderWidth: 1,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
  },
  giftAmtText: {
    fontSize: 12,
    fontWeight: '700',
  },
  giftSubText: {
    fontSize: 12,
    color: '#666',
    fontWeight: '600',
    textAlign: 'center',
  },
  spendingWrapper: {
    marginHorizontal: 16,
    gap: 12,
    marginBottom: 20,
  },
  chartCard: {
    borderRadius: 24,
    borderWidth: 1,
    padding: 16,
  },
  chartTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
    marginBottom: 14,
  },
  chartRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    height: 100,
    paddingTop: 10,
  },
  chartBarContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    height: '100%',
  },
  chartBar: {
    width: 14,
    borderRadius: 4,
  },
  chartBarMonth: {
    fontSize: 12,
    fontWeight: '700',
    marginTop: 6,
  },
  chartBarTotal: {
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  topItemsCard: {
    borderRadius: 24,
    borderWidth: 1,
    padding: 16,
  },
  topItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
  },
  topItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  topItemName: {
    fontSize: 12,
    fontWeight: '700',
  },
  topItemCount: {
    fontSize: 12,
    fontWeight: '700',
    marginTop: 1,
  },
  topItemSpend: {
    fontSize: 12,
    fontWeight: '700',
  },
  statsGridRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  smallStatCard: {
    width: '48%',
    borderRadius: 18,
    borderWidth: 1,
    padding: 12,
  },
  smallStatVal: {
    fontSize: 12,
    fontWeight: '700',
  },
  smallStatLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#888',
    marginTop: 2,
  },
  supportGrid: {
    flexDirection: 'row',
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 20,
  },
  supportBtn: {
    flex: 1,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    padding: 16,
  },
  supportBtnTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
    marginTop: 8,
  },
  supportBtnDesc: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  prefCard: {
    marginHorizontal: 16,
    marginTop: -8,
    marginBottom: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
    paddingBottom: 12,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  prefRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  themeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 16,
    padding: 14,
    borderRadius: 20,
    borderWidth: 1.5,
    marginBottom: 20,
  },
  logoutBtn: {
    marginHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  logoutText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#EF4444',
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  logoutSubText: {
    fontSize: 12,
    color: '#666',
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 40,
  },

  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  modalScroll: {
    flexGrow: 1,
    alignItems: 'center',
    paddingTop: 40,
    paddingBottom: 280, // Ample clearance to scroll any field/button above keyboard
    width: '100%',
  },
  modalContent: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 30,
    borderWidth: 1.5,
    padding: 24,
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFF',
    letterSpacing: 0.3,
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#888',
    letterSpacing: 0.2,
    alignSelf: 'flex-start',
    marginTop: 14,
    marginBottom: 7,
  },
  formHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 18, borderBottomLeftRadius: 26, borderBottomRightRadius: 26 },
  formClose: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  formTitle: { fontSize: 22, fontWeight: '900', letterSpacing: -0.3 },
  formSub: { fontSize: 12.5, fontWeight: '600', opacity: 0.7, marginTop: 2 },
  formCard: { borderRadius: 22, borderWidth: 1, padding: 16, marginBottom: 14, alignItems: 'stretch', shadowColor: '#1b1a17', shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 1 },
  formSectionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  formSectionText: { fontSize: 15.5, fontWeight: '900' },
  formFooter: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 18, borderTopWidth: 1 },
  modalInput: {
    alignSelf: 'stretch',
    width: '100%',
    height: 52,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 14,
    paddingHorizontal: 14,
    fontSize: 15,
    color: '#FFF',
    fontWeight: '600',
    marginBottom: 6,
  },
  localUploadBtn: {
    alignSelf: 'stretch',
    width: '100%',
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(212, 175, 122, 0.4)',
    backgroundColor: 'rgba(212, 175, 122, 0.05)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    marginBottom: 16,
  },
  groupHead: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth },
  groupHeadText: { fontSize: 14, fontWeight: '800' },
  twoCol: { alignSelf: 'stretch', flexDirection: 'row', gap: 10 },
  clearBtn: { position: 'absolute', right: 12, top: 15 },
  useCityChip: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, marginTop: 2, marginBottom: 6 },
  fieldError: {
    alignSelf: 'flex-start',
    fontSize: 11.5,
    fontWeight: '600',
    color: '#DC2626',
    marginTop: -3,
    marginBottom: 6,
    marginLeft: 2,
  },
  localUploadBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#D4AF7A',
    letterSpacing: 0.3,
  },
  suggestionsBox: {
    backgroundColor: '#1E1E22',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 14,
    width: '100%',
    maxHeight: 150,
    position: 'absolute',
    top: 52,
    zIndex: 9999,
    overflow: 'scroll',
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  suggestionPin: { width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  suggestionText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '600',
  },
  modalActionsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
    width: '100%',
  },
  modalCancelBtn: {
    flex: 1,
    height: 44,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancelBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFF',
  },
  modalSaveBtn: {
    flex: 1,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalSaveBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFF', // restyle-fixes-2026-11-10: white on the diet accent
  },

  // QR Modal specifically
  qrWrapper: {
    alignItems: 'center',
    marginVertical: 20,
    position: 'relative',
  },
  qrAvatarBox: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 2,
    borderColor: '#D4AF7A',
    backgroundColor: '#FFF',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'absolute',
    top: -24,
    zIndex: 10,
  },
  qrAvatarImg: {
    width: '100%',
    height: '100%',
  },
  qrAvatarText: {
    fontSize: 16,
    fontWeight: '700',
  },
  qrContainer: {
    padding: 16,
    backgroundColor: '#FFF',
    borderRadius: 20,
    marginTop: 20,
  },
  qrName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFF',
    marginTop: 10,
  },
  qrCity: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 2.5,
    marginTop: 4,
  },
  qrSubText: {
    fontSize: 12,
    color: '#888',
    fontWeight: '700',
    marginTop: 4,
    marginBottom: 20,
  },
  modalCloseBtn: {
    width: '100%',
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCloseBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#000',
  },

  // Avatar select
  avatarSelectRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  avatarSelectBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    overflow: 'hidden',
  },
  avatarSelectImg: {
    width: '100%',
    height: '100%',
  },

});
