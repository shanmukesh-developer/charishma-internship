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
} from 'react-native';
import { KeyboardAvoidingView } from '../../components/KeyboardAvoidingView';
import Clipboard from '@react-native-clipboard/clipboard';
import { useRouter, useFocusEffect } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { COLORS, SHADOWS } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { useDietary, DietPrefs } from '../../context/DietaryContext';
import AmbientBackground from '../../components/AmbientBackground';
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
import { cleanRoom, cleanBlock, formatHostel, useCampusHostelBlocks, HOSTEL_BLOCK_MAX, ROOM_NUMBER_MAX } from '../../utils/hostel';
import { openLegal, LEGAL_LABELS, LegalPage } from '../../utils/legal';

const PHONE_RE = /^[6-9]\d{9}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
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
  const { user, setUser, logout } = useAuth();
  const { isDark, toggleTheme, colors } = useTheme();
  const router = useRouter();
  const userId = user?._id || user?.id;

  // Color Palette mappings
  const bg = colors.bg;
  const cardBg = colors.card;
  const txt = colors.text;
  const txtSec = colors.textSecondary;
  const border = colors.border;
  const goldColor = isDark ? COLORS.gold : colors.gold;

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
  const [editPhone, setEditPhone] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editAbout, setEditAbout] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editCity, setEditCity] = useState('');
  const [editHostelBlock, setEditHostelBlock] = useState('');
  const [editRoom, setEditRoom] = useState('');
  // Hostel blocks from the campus directory (only loaded while the editor is open)
  const hostelCampuses = useCampusHostelBlocks(isEditing);
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
        if (!silent) Alert.alert('Notifications are off', 'Turn on notifications for Zenvy in your phone settings to get order updates.');
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

      const res = await apiFetch(`${API_URL}/api/users/fcm-token`, {
        method: 'POST',
        body: JSON.stringify({ fcmToken, appVersion: APP_VERSION, platform: Platform.OS }),
      });

      if (res.ok) {
        AsyncStorage.setItem('zenvy_push_token', fcmToken).catch(() => {});
        if (mountedRef.current) setPushOn(true);
        if (!silent && mountedRef.current) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          Alert.alert('You’re all set 🔔', 'We’ll notify you about your orders on this phone.');
        }
      } else if (!silent && mountedRef.current) {
        const errData = await res.json().catch(() => ({}));
        Alert.alert('Couldn’t turn on notifications', errData.message || 'Please try again in a moment.');
      }
    } catch (err: any) {
      console.warn('Push registration error:', err);
      if (!silent && mountedRef.current) Alert.alert('Couldn’t turn on notifications', 'Please try again in a moment.');
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
    setOtpSent(false);
    setOtpCode('');
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
        const res = await fetch(
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
      Alert.alert('Couldn’t send the code', r.message || 'Please try again in a minute.');
    }
  };

  const handleUpdateProfile = async () => {
    if (savingRef.current) return;
    const name = editName.trim();
    const email = editEmail.trim().toLowerCase();
    if (name.length < 2) {
      Alert.alert('Add your name', 'Please enter your name (at least 2 letters).');
      return;
    }
    if (!PHONE_RE.test(normalizedEditPhone)) {
      Alert.alert('Check your number', 'Enter a valid 10-digit Indian mobile number.');
      return;
    }
    if (email && !EMAIL_RE.test(email)) {
      Alert.alert('Check your email', 'That email address doesn’t look right.');
      return;
    }
    if (editProfileImage && !/^(https?:\/\/|data:image\/)/i.test(editProfileImage)) {
      Alert.alert('Check the photo link', 'Paste a full image link starting with https://, or choose a photo from your gallery.');
      return;
    }
    if (phoneChanged) {
      if (!otpSent) {
        sendPhoneOtp();
        return;
      }
      // In Firebase mode Android may have verified the number in the background (no code typed).
      if (phoneOtp.mode !== 'firebase' && !/^\d{6}$/.test(otpCode)) {
        Alert.alert('Enter the code', `Type the 6-digit code we sent to +91 ${normalizedEditPhone}.`);
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
    };

    savingRef.current = true;
    setSavingProfile(true);
    try {
      let proof: PhoneProof | null = null;
      if (phoneChanged) {
        try {
          proof = await phoneOtp.getProof(otpCode);
        } catch (e: any) {
          if (mountedRef.current) Alert.alert('Couldn’t verify the code', e?.message || 'Please try again.');
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
        Alert.alert('Profile updated ✨', 'Your changes are saved.');
      } else {
        if (data?.code === 'OTP_EXPIRED' || data?.code === 'OTP_LOCKED') {
          setOtpSent(false);
          setOtpCode('');
          phoneOtp.reset();
        }
        if (phoneChanged) phoneOtp.allowAutoRetry();
        Alert.alert('Couldn’t save', data?.message || 'Please check your details and try again.');
      }
    } catch (e: any) {
      if (mountedRef.current) Alert.alert('No connection', 'Check your internet and try again.');
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
    Alert.alert('Send this gift?', `₹${amt} from your Zenvy Wallet to +91 ${phone}.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: `Send ₹${amt}`, onPress: () => sendGift(amt, phone) },
    ]);
  };

  const copyText = (value: string, title: string) => {
    Clipboard.setString(value);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    Alert.alert(title, value);
  };

  if (!user) {
    return (
      <View style={[s.container, { backgroundColor: bg, justifyContent: 'center', alignItems: 'center', padding: 20 }]}>
        <AmbientBackground />
        <Text style={{ fontSize: 48, marginBottom: 16 }}>🔐</Text>
        <Text style={{ fontSize: 18, fontWeight: '900', color: txt, letterSpacing: 2, textAlign: 'center', marginBottom: 8 }}>
          SIGN IN TO CONTINUE
        </Text>
        <Text style={{ fontSize: 11, color: txtSec, fontWeight: '600', textAlign: 'center', marginBottom: 24, lineHeight: 18 }}>
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
          <Text style={{ color: '#FFF', fontSize: 11, fontWeight: '900', letterSpacing: 2 }}>SIGN IN / SIGN UP</Text>
        </TouchableOpacity>
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
  const inputBg = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)';

  return (
    <View style={[s.container, { backgroundColor: bg }]}>
      <AmbientBackground />
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

        {/* Profile Card */}
        <StaggeredSection delay={100} direction="down">
          <View style={[s.profileCard, { backgroundColor: cardBg, borderColor: border }]}>

            {/* Top row: Avatar + Zenvy Badge / Streak */}
            <View style={s.profileCardHeader}>
              <TouchableOpacity onPress={openEditor} accessibilityLabel="Edit profile">
                <View style={s.avatarOuterRing}>
                  <LinearGradient
                    colors={isDark ? [goldColor, '#FFF', '#C9962C'] : ['#EF4F5F', '#FF7E8B', '#E03546']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={s.avatarRingGradient}
                  >
                    <View style={[s.avatar, { backgroundColor: isDark ? '#141416' : '#FFF' }]}>
                      <Avatar
                        uri={user?.profileImage}
                        style={s.avatarImg}
                        fallback={<Text style={[s.avatarText, { color: isDark ? goldColor : '#EF4F5F' }]}>{initials}</Text>}
                      />
                    </View>
                  </LinearGradient>
                  {streak > 0 ? (
                    <View style={[s.streakBadge, { borderColor: isDark ? goldColor : '#FFF', backgroundColor: isDark ? '#000' : '#EF4F5F' }]}>
                      <Text style={s.streakBadgeText}>🔥 {streak}</Text>
                    </View>
                  ) : null}
                </View>
              </TouchableOpacity>

              <View style={s.headerBadges}>
                <View style={[s.zenvyBadge, { backgroundColor: goldColor }]}>
                  <Text style={s.zenvyBadgeText}>ZENVY</Text>
                  <View style={s.zenvyDots}>
                    <View style={s.zenvyDot} />
                    <View style={s.zenvyDot} />
                  </View>
                </View>

                <TouchableOpacity style={[s.streakCapsule, { borderColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)', backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)' }]} onPress={() => router.push('/rewards')}>
                  <Text style={[s.streakCapsuleText, { color: txt }]}>🔥 {streak} Day Streak</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Name & tier */}
            <Text style={[s.name, { color: txt }]}>{(user?.name || 'ZENVY MEMBER').toUpperCase()}</Text>
            <Text style={[s.tierText, { color: goldColor }]}>
              {user?.isElite ? 'ELITE MEMBER' : 'ZENVY MEMBER'}
              {user?.createdAt ? ` • SINCE ${new Date(user.createdAt).getFullYear()}` : ''}
            </Text>

            {friendCode ? (
              <TouchableOpacity
                style={[s.barcodeBtn, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#F3F4F6' }]}
                onPress={() => copyText(friendCode, 'Friend code copied')}
                accessibilityLabel="Copy friend code"
              >
                <Text style={{ fontSize: 12 }}>🤝</Text>
                <Text style={[s.barcodeText, { color: txtSec }]}>FRIEND CODE {friendCode}</Text>
              </TouchableOpacity>
            ) : null}

            {/* Saved hostel block & room (used at checkout), else the delivery address */}
            <TouchableOpacity
              style={[s.primaryAddressBox, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#F3F4F6', borderColor: border }]}
              onPress={openEditor}
              accessibilityRole="button"
              accessibilityLabel={`Hostel and room: ${formatHostel(user) || 'not set'}. Edit`}
            >
              <Text style={{ fontSize: 14 }}>{formatHostel(user) ? '🏢' : '📍'}</Text>
              <Text style={[s.primaryAddressText, { color: txt }]} numberOfLines={1}>
                {formatHostel(user) || user?.address || 'Set your hostel room & block'}
              </Text>
              <Text style={[s.editAddrText, { color: goldColor }]}>EDIT</Text>
            </TouchableOpacity>

            {/* Bio and contact */}
            <View style={{ width: '100%', gap: 10, marginVertical: 12 }}>
              <TouchableOpacity activeOpacity={0.8} onPress={openEditor} style={{ padding: 12, backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : '#F9FAFB', borderRadius: 12, borderWidth: 1, borderColor: border }}>
                <Text style={{ fontSize: 10, fontWeight: '800', color: goldColor, letterSpacing: 1.5, marginBottom: 4 }}>ABOUT ME</Text>
                <Text style={{ fontSize: 13, color: txt, fontStyle: user?.about ? 'normal' : 'italic', lineHeight: 18 }}>
                  {user?.about || 'No bio yet. Tap to write something about yourself!'}
                </Text>
              </TouchableOpacity>

              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1, padding: 12, backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : '#F9FAFB', borderRadius: 12, borderWidth: 1, borderColor: border }}>
                  <Text style={{ fontSize: 10, fontWeight: '800', color: txtSec, letterSpacing: 1, marginBottom: 4 }}>MOBILE</Text>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: txt }} numberOfLines={1}>
                    {user?.phone ? `+91 ${user.phone}` : 'Not set'}
                  </Text>
                </View>
                <View style={{ flex: 1, padding: 12, backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : '#F9FAFB', borderRadius: 12, borderWidth: 1, borderColor: border }}>
                  <Text style={{ fontSize: 10, fontWeight: '800', color: txtSec, letterSpacing: 1, marginBottom: 4 }}>EMAIL</Text>
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
                  <Text style={s.telemetryLabel}>DELIVERED</Text>
                  <Text style={[s.telemetryVal, { color: txt }]}>{completedOrders}</Text>
                </View>
                <View style={[s.telemetryItem, s.telemetryBorder]}>
                  <Text style={s.telemetryLabel}>ZEN POINTS</Text>
                  <Text style={[s.telemetryVal, { color: goldColor }]}>{Number(user?.zenPoints) || 0}</Text>
                </View>
                <TouchableOpacity
                  style={s.telemetryItem}
                  onPress={() => router.push('/wallet-history' as any)}
                  accessibilityRole="button"
                  accessibilityLabel={`Wallet balance ₹${Number(user?.walletBalance) || 0}. Open wallet history`}
                >
                  <Text style={s.telemetryLabel}>WALLET</Text>
                  <Text style={[s.telemetryVal, { color: goldColor, fontSize: 13 }]}>
                    ₹{Number(user?.walletBalance) || 0}
                  </Text>
                  <Text style={[s.telemetryLabel, { color: goldColor, marginTop: 2 }]}>HISTORY ›</Text>
                </TouchableOpacity>
              </View>

              <View style={s.progressContainer}>
                <View style={s.progressLabels}>
                  <Text style={s.progressTitle}>{nextMilestone ? `NEXT BADGE: ${nextMilestone.name.toUpperCase()}` : allBadgesUnlocked ? 'ALL ORDER BADGES UNLOCKED' : 'ORDER BADGES'}</Text>
                  <Text style={[s.progressVal, { color: goldColor }]}>
                    {nextMilestone ? `${completedOrders} / ${nextMilestone.threshold}` : allBadgesUnlocked ? '👑' : `${completedOrders}`}
                  </Text>
                </View>
                <View style={[s.progressBarBg, { backgroundColor: isDark ? '#000' : '#E0E0E0' }]}>
                  <View style={[s.progressBarFill, { backgroundColor: goldColor, width: `${milestonePct}%` }]} />
                </View>
              </View>
            </View>

          </View>
        </StaggeredSection>

        {/* 🥗 Dietary Preferences */}
        <StaggeredSection delay={180} direction="up">
          <Text style={[s.sectionTitleText, { color: isDark ? goldColor : '#111' }]}>FOOD PREFERENCE</Text>
          <View style={[s.dietCard, { backgroundColor: cardBg, borderColor: border }]}>
            <Text style={[s.dietLabel, { color: txtSec }]}>FILTER MENUS EVERYWHERE YOU ORDER</Text>
            <View style={s.dietModeGrid}>
              {([
                { id: 'all', label: 'EVERYTHING', icon: '🍽️' },
                { id: 'veg', label: 'VEG ONLY', icon: '🥦' },
                { id: 'egg', label: 'EGGETARIAN', icon: '🍳' },
                { id: 'non-veg', label: 'NON-VEG', icon: '🍗' },
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
                      {opt.icon} {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={s.divider} />

            <Text style={[s.dietLabel, { color: txtSec }]}>HIDE DISHES WITH</Text>
            <View style={s.allergyRow}>
              {([
                { key: 'nuts', label: '🥜 Nuts' },
                { key: 'dairy', label: '🥛 Dairy' },
                { key: 'gluten', label: '🌾 Gluten' },
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
                  <Text style={[s.allergyBadgeText, { color: '#EF4444' }]}>🚫 {a}</Text>
                  <TouchableOpacity
                    onPress={() => updateDietPrefs({ ...dietPrefs, custom: (dietPrefs.custom || []).filter((_, j) => j !== i) })}
                    style={{ marginLeft: 6 }}
                    accessibilityLabel={`Remove ${a}`}
                  >
                    <Text style={{ color: '#EF4444', fontWeight: 'bold', fontSize: 10 }}>✕</Text>
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
                <Text style={s.allergyAddBtnText}>ADD</Text>
              </TouchableOpacity>
            </View>
            <Text style={{ fontSize: 9, color: txtSec, marginTop: 6 }}>Only dishes the store has marked with that allergen are hidden.</Text>
          </View>
        </StaggeredSection>

        {/* 🔔 Notifications */}
        <StaggeredSection delay={200} direction="up">
          <Text style={[s.sectionTitleText, { color: isDark ? goldColor : '#111' }]}>NOTIFICATIONS</Text>
          <TouchableOpacity
            style={[s.themeBtn, { backgroundColor: cardBg, borderColor: border }]}
            onPress={() => handleEnablePush(false)}
          >
            <View style={[s.notifIconOuter, { backgroundColor: isDark ? '#1C1B1F' : '#F3F4F6' }]}>
              <Text style={{ fontSize: 16 }}>🛵</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[s.notifLabel, { color: txt }]}>Order updates on this phone</Text>
              <Text style={[s.notifDesc, { color: txtSec }]}>Placed, accepted, out for delivery, delivered</Text>
            </View>
            <View style={[s.pushBtn, { borderColor: pushOn ? COLORS.emerald : goldColor }]}>
              <Text style={[s.pushBtnText, { color: pushOn ? COLORS.emerald : goldColor }]}>{pushOn ? 'ON ✓' : 'TURN ON'}</Text>
            </View>
          </TouchableOpacity>
        </StaggeredSection>

        {/* 🏆 Your Badges */}
        <StaggeredSection delay={220} direction="up">
          <Text style={[s.sectionTitleText, { color: isDark ? goldColor : '#111' }]}>YOUR BADGES</Text>
          <View style={[s.achievementsCard, { backgroundColor: cardBg, borderColor: border }]}>
            {Array.isArray(user?.badges) && user.badges.length > 0 ? (
              <View style={s.badgeGrid}>
                {user.badges.map((badgeName: string) => {
                  const v = badgeVisual(String(badgeName));
                  return (
                    <View key={badgeName} style={[s.badgeCard, { borderColor: v.color }]}>
                      <Text style={s.badgeEmoji}>{v.emoji}</Text>
                      <Text style={s.badgeTitle}>{badgeName}</Text>
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
                <Text style={s.graySubText}>Your first badge unlocks at 5 delivered orders</Text>
              </View>
            )}

            <View style={s.achievementsFooter}>
              <View style={s.footerLeft}>
                <Text style={[s.footerLabel, { color: txtSec }]}>ZEN POINTS</Text>
                <Text style={[s.footerVal, { color: goldColor }]}>{Number(user?.zenPoints) || 0} ZP</Text>
              </View>
              <View style={s.verticalDivider} />
              <View style={s.footerRight}>
                <Text style={[s.footerLabel, { color: txtSec }]}>NEXT ORDER BADGE</Text>
                <Text style={[s.footerVal, { color: txt }]}>
                  {nextMilestone ? `${completedOrders} / ${nextMilestone.threshold} orders` : allBadgesUnlocked ? 'All unlocked 👑' : `${completedOrders} orders`}
                </Text>
              </View>
            </View>
          </View>
        </StaggeredSection>

        {/* 🎫 My Coupons */}
        <StaggeredSection delay={240} direction="up">
          <View style={s.sectionHeader}>
            <Text style={[s.sectionTitleText, { color: isDark ? goldColor : '#111' }]}>MY COUPONS</Text>
            <TouchableOpacity onPress={() => router.push('/rewards')}>
              <Text style={[s.sectionAddBtn, { color: goldColor }]}>🎯 SPIN & WIN</Text>
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
                    <Text style={[s.couponType, { color: goldColor }]}>{cpn.type === 'FREEDEL' ? 'DELIVERY' : 'DISCOUNT'}</Text>
                    <Text style={[s.couponHeader, { color: txt }]}>{String(label).toUpperCase()}</Text>
                    <Text style={{ fontSize: 9, fontWeight: '700', color: txtSec, marginBottom: 6 }}>{expires}</Text>
                    <View style={s.couponCodeRow}>
                      <Text style={[s.couponCodeText, { color: goldColor }]}>{cpn.code}</Text>
                      <TouchableOpacity onPress={() => copyText(cpn.code, 'Coupon copied — use it at checkout')} style={s.couponCopyBtn}>
                        <Text style={s.couponCopyBtnText}>COPY</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          ) : (
            <View style={[s.emptyCard, { backgroundColor: cardBg, borderColor: border }]}>
              <Text style={{ fontSize: 24, marginBottom: 8 }}>🎫</Text>
              <Text style={[s.emptyText, { color: txtSec }]}>No coupons yet</Text>
              <Text style={[s.emptySubText, { color: txtSec, marginBottom: 12 }]}>Spin the wheel to win coupons</Text>
              <TouchableOpacity
                style={{ backgroundColor: goldColor, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 12 }}
                onPress={() => router.push('/rewards')}
              >
                <Text style={{ color: '#000', fontSize: 9, fontWeight: '900', letterSpacing: 1 }}>SPIN THE WHEEL</Text>
              </TouchableOpacity>
            </View>
          )}
        </StaggeredSection>

        {/* 🔗 Invite friends (real referral code from the account) */}
        {referralCode ? (
          <StaggeredSection delay={260} direction="up">
            <Text style={[s.sectionTitleText, { color: isDark ? goldColor : '#111' }]}>INVITE FRIENDS</Text>
            <View style={[s.buddyLinkCard, { backgroundColor: isDark ? 'rgba(249, 196, 64, 0.06)' : 'rgba(249, 196, 64, 0.08)', borderColor: isDark ? 'rgba(249, 196, 64, 0.18)' : 'rgba(249, 196, 64, 0.25)' }]}>
              <View style={s.buddyLinkHeader}>
                <View style={s.buddyLinkIconCircle}>
                  <Text style={s.buddyLinkIconEmoji}>🔗</Text>
                </View>
                <View style={s.buddyLinkHeaderText}>
                  <Text style={[s.buddyLinkTitle, { color: isDark ? '#FFF' : '#111' }]}>Invite friends to Zenvy</Text>
                  <Text style={[s.buddyLinkSubtitle, { color: txtSec }]}>
                    When a friend signs up with your code, you both get <Text style={{ color: goldColor, fontWeight: '900' }}>50 ZenPoints</Text>
                  </Text>
                </View>
              </View>

              <View style={[s.buddyCodeRow, { backgroundColor: isDark ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.04)', borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }]}>
                <View>
                  <Text style={[s.buddyCodeLabel, { color: txtSec }]}>YOUR CODE</Text>
                  <Text style={[s.buddyCodeValue, { color: goldColor }]}>{referralCode}</Text>
                </View>
                <TouchableOpacity
                  style={[s.buddyCopyChip, { backgroundColor: isDark ? 'rgba(249,196,64,0.15)' : 'rgba(249,196,64,0.18)' }]}
                  onPress={() => copyText(referralCode, 'Referral code copied')}
                  activeOpacity={0.7}
                >
                  <Text style={[s.buddyCopyChipText, { color: goldColor }]}>COPY</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={s.buddyShareBtn}
                activeOpacity={0.85}
                onPress={async () => {
                  const name = user?.name?.split(' ')[0] || 'Your friend';
                  try {
                    await Share.share({
                      title: 'Join me on Zenvy!',
                      message: `🍔 ${name} invited you to Zenvy — campus food & essentials delivered to your hostel. Sign up with my code ${referralCode} and we both get 50 ZenPoints! 🎉`,
                    });
                  } catch (e) {
                    // share sheet dismissed
                  }
                }}
              >
                <LinearGradient colors={['#F9C440', '#E8A317']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.buddyShareBtnGrad}>
                  <Text style={s.buddyShareBtnEmoji}>📤</Text>
                  <Text style={s.buddyShareBtnText}>SHARE MY CODE</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </StaggeredSection>
        ) : null}

        {/* 🎁 Send a Gift (Elite Perk): off. The wallet is non-transferable order credit (the server answers
            403 TRANSFER_DISABLED), so the section is hidden until WALLET_GIFTS_ENABLED is switched back on. */}
        {WALLET_GIFTS_ENABLED && user?.isElite ? (
          <StaggeredSection delay={280} direction="up">
            <Text style={[s.sectionTitleText, { color: isDark ? goldColor : '#111' }]}>SEND A GIFT</Text>
            <View style={[s.giftCard, { backgroundColor: cardBg, borderColor: border }]}>
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

        {/* 📊 Spending Dashboard */}
        <StaggeredSection delay={300} direction="up">
          <Text style={[s.sectionTitleText, { color: isDark ? goldColor : '#111' }]}>MY SPENDING</Text>
          {statsState === 'loading' && !spendStats ? (
            <View style={[s.emptyCard, { backgroundColor: cardBg, borderColor: border }]}>
              <ActivityIndicator color={goldColor} />
            </View>
          ) : statsState === 'error' && !spendStats ? (
            <View style={[s.emptyCard, { backgroundColor: cardBg, borderColor: border }]}>
              <Text style={{ fontSize: 22, marginBottom: 6 }}>📡</Text>
              <Text style={[s.emptyText, { color: txtSec }]}>Couldn’t load your spending</Text>
              <TouchableOpacity
                style={{ marginTop: 10, backgroundColor: goldColor, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 12 }}
                onPress={() => { setStatsState('loading'); fetchData('focus'); }}
              >
                <Text style={{ color: '#000', fontSize: 9, fontWeight: '900', letterSpacing: 1 }}>RETRY</Text>
              </TouchableOpacity>
            </View>
          ) : !hasSpend ? (
            <View style={[s.emptyCard, { backgroundColor: cardBg, borderColor: border }]}>
              <Text style={{ fontSize: 22, marginBottom: 6 }}>🧾</Text>
              <Text style={[s.emptyText, { color: txtSec }]}>Your spending shows up here after your first order</Text>
              <TouchableOpacity
                style={{ marginTop: 10, backgroundColor: goldColor, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 12 }}
                onPress={() => router.push('/(tabs)' as any)}
              >
                <Text style={{ color: '#000', fontSize: 9, fontWeight: '900', letterSpacing: 1 }}>ORDER NOW</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={s.spendingWrapper}>
              {monthlySpend.length > 0 && (
                <View style={[s.chartCard, { backgroundColor: cardBg, borderColor: border }]}>
                  <Text style={[s.chartTitle, { color: txtSec }]}>LAST 6 MONTHS</Text>
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
                            {total > 0 ? <Text style={[s.chartBarTotal, { color: txt }]}>₹{total}</Text> : null}
                          </View>
                        );
                      });
                    })()}
                  </View>
                </View>
              )}

              {topItems.length > 0 && (
                <View style={[s.topItemsCard, { backgroundColor: cardBg, borderColor: border }]}>
                  <Text style={[s.chartTitle, { color: txtSec }]}>MOST ORDERED</Text>
                  {topItems.map((item: any, i: number) => (
                    <View key={`${item.name}-${i}`} style={s.topItemRow}>
                      <View style={s.topItemLeft}>
                        <Text style={{ fontSize: 14 }}>{i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'}</Text>
                        <View style={{ marginLeft: 10, flexShrink: 1 }}>
                          <Text style={[s.topItemName, { color: txt }]} numberOfLines={1}>{item.name}</Text>
                          <Text style={[s.topItemCount, { color: txtSec }]}>{item.count}x ordered</Text>
                        </View>
                      </View>
                      <Text style={[s.topItemSpend, { color: goldColor }]}>₹{item.spend}</Text>
                    </View>
                  ))}
                </View>
              )}

              <View style={s.statsGridRow}>
                {[
                  { label: 'AVG ORDER', value: `₹${Number(spendStats?.avgOrderValue) || 0}`, emoji: '📦' },
                  { label: 'DELIVERED', value: String(completedOrders), emoji: '🧾' },
                  { label: 'STREAK', value: `🔥 ${streak}d`, emoji: '⚡' },
                  { label: 'FAVOURITE', value: favRestaurant, emoji: '❤️' },
                ].map((stat) => (
                  <View key={stat.label} style={[s.smallStatCard, { backgroundColor: cardBg, borderColor: border }]}>
                    <Text style={{ fontSize: 18, marginBottom: 4 }}>{stat.emoji}</Text>
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

        {/* 💬 Help & Support & About */}
        <StaggeredSection delay={320} direction="up">
          <Text style={[s.sectionTitleText, { color: isDark ? goldColor : '#111' }]}>HELP & SUPPORT</Text>
          <View style={s.supportGrid}>
            <TouchableOpacity style={[s.supportBtn, { backgroundColor: cardBg, borderColor: border }]} onPress={() => router.push('/support' as any)}>
              <Text style={{ fontSize: 20 }}>🎫</Text>
              <Text style={[s.supportBtnTitle, { color: goldColor }]}>SUPPORT TICKETS</Text>
              <Text style={[s.supportBtnDesc, { color: txtSec }]}>Report an issue & track it</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[s.supportBtn, { backgroundColor: cardBg, borderColor: border }]} onPress={() => setShowAbout(true)}>
              <Text style={{ fontSize: 20 }}>✨</Text>
              <Text style={[s.supportBtnTitle, { color: txt }]}>ABOUT ZENVY</Text>
              <Text style={[s.supportBtnDesc, { color: txtSec }]}>Version & info</Text>
            </TouchableOpacity>
          </View>
          <View style={s.supportGrid}>
            <TouchableOpacity style={[s.supportBtn, { backgroundColor: cardBg, borderColor: border }]} onPress={() => Linking.openURL(ENDPOINTS.privacyPolicy).catch(() => {})} accessibilityRole="link">
              <Text style={{ fontSize: 20 }}>🔒</Text>
              <Text style={[s.supportBtnTitle, { color: txt }]}>PRIVACY POLICY</Text>
              <Text style={[s.supportBtnDesc, { color: txtSec }]}>What we collect & why</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.supportBtn, { backgroundColor: cardBg, borderColor: border }]} onPress={() => openLegal('terms')} accessibilityRole="link">
              <Text style={{ fontSize: 20 }}>📜</Text>
              <Text style={[s.supportBtnTitle, { color: txt }]}>TERMS OF SERVICE</Text>
              <Text style={[s.supportBtnDesc, { color: txtSec }]}>Orders, wallet & rules</Text>
            </TouchableOpacity>
          </View>
          {/* C4: the remaining policies (Refunds, Grievance, Community Guidelines) */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: -6, marginBottom: 20, marginHorizontal: 20 }}>
            {(['refunds', 'grievance', 'community', 'index'] as LegalPage[]).map((p) => (
              <TouchableOpacity key={p} onPress={() => openLegal(p)} accessibilityRole="link" hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                <Text style={{ color: COLORS.gold, fontSize: 12, fontWeight: '800' }}>{LEGAL_LABELS[p]} ↗</Text>
              </TouchableOpacity>
            ))}
          </View>
        </StaggeredSection>

        {/* Theme switch button */}
        <StaggeredSection delay={340} direction="up">
          <TouchableOpacity style={[s.themeBtn, { backgroundColor: cardBg, borderColor: border }]} onPress={toggleTheme}>
            <View style={[s.notifIconOuter, { backgroundColor: isDark ? '#1C1B1F' : '#F3F4F6' }]}>
              <Text style={{ fontSize: 16 }}>{isDark ? '☀️' : '🌙'}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[s.notifLabel, { color: txt }]}>{isDark ? 'LIGHT MODE' : 'DARK MODE'}</Text>
              <Text style={[s.notifDesc, { color: txtSec }]}>
                {isDark ? 'Switch to the light theme' : 'Switch to the dark theme'}
              </Text>
            </View>
          </TouchableOpacity>
        </StaggeredSection>

        {/* Logout */}
        <StaggeredSection delay={360} direction="up">
          <TouchableOpacity
            style={[s.logoutBtn, { borderColor: '#EF4444' }]}
            onPress={() => {
              Alert.alert(
                'Sign out?',
                'You can sign back in anytime with your mobile number.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Sign Out',
                    style: 'destructive',
                    onPress: async () => {
                      await logout();
                      router.replace('/login');
                    }
                  }
                ]
              );
            }}
          >
            <Text style={s.logoutText}>SIGN OUT</Text>
          </TouchableOpacity>
          <Text style={s.logoutSubText}>Sign out of your Zenvy account on this phone</Text>

          {/* Account deletion (Google Play requirement): anonymises the account + deletes personal data */}
          <TouchableOpacity onPress={() => setShowDeleteAccount(true)} accessibilityRole="button" style={{ alignItems: 'center', paddingVertical: 14 }}>
            <Text style={{ color: '#EF4444', fontSize: 13, fontWeight: '700', textDecorationLine: 'underline' }}>Delete my account</Text>
          </TouchableOpacity>
        </StaggeredSection>

      </ScrollView>

      {/* ─── MODAL: EDIT PROFILE ─── */}
      <Modal visible={isEditing} animationType="slide" transparent={true} onRequestClose={closeEditor}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 40 : 0}
        >
          <View style={s.modalOverlay}>
            <ScrollView
              contentContainerStyle={[s.modalScroll, { paddingBottom: 120 }]}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              bounces={true}
            >
              <View style={[s.modalContent, { backgroundColor: cardBg, borderColor: border }]}>
              <Text style={[s.modalTitle, { color: txt }]}>EDIT PROFILE</Text>

              {/* Avatar preview */}
              <View style={{ alignItems: 'center', marginVertical: 12 }}>
                <View style={{ width: 80, height: 80, borderRadius: 40, overflow: 'hidden', borderWidth: 2.5, borderColor: goldColor, backgroundColor: isDark ? '#1C1917' : '#F1F5F9', alignItems: 'center', justifyContent: 'center' }}>
                  <Avatar
                    uri={editProfileImage}
                    style={{ width: '100%', height: '100%' }}
                    fallback={<Text style={{ fontSize: 24, fontWeight: '900', color: goldColor }}>{initials}</Text>}
                  />
                </View>
                {editProfileImage ? (
                  <TouchableOpacity onPress={() => setEditProfileImage(null)} style={{ marginTop: 6, padding: 4 }}>
                    <Text style={{ fontSize: 10, fontWeight: '800', color: '#EF4444', letterSpacing: 1 }}>REMOVE PHOTO</Text>
                  </TouchableOpacity>
                ) : (
                  <Text style={{ fontSize: 9, fontWeight: '800', color: txtSec, marginTop: 6, letterSpacing: 1 }}>NO PHOTO — SHOWING INITIALS</Text>
                )}
              </View>

              <TouchableOpacity
                style={s.localUploadBtn}
                onPress={handleUploadLocalImage}
                disabled={uploadingImage || savingProfile}
              >
                {uploadingImage ? (
                  <ActivityIndicator size="small" color={goldColor} />
                ) : (
                  <Text style={s.localUploadBtnText}>📸 {isDataUriImage ? 'CHOOSE A DIFFERENT PHOTO' : 'CHOOSE FROM GALLERY'}</Text>
                )}
              </TouchableOpacity>

              {!isDataUriImage ? (
                <>
                  <Text style={[s.inputLabel, { color: txtSec }]}>OR PASTE AN IMAGE LINK</Text>
                  <TextInput
                    value={editProfileImage || ''}
                    onChangeText={(t) => setEditProfileImage(t.trim() ? t.trim() : null)}
                    placeholder="https://…"
                    placeholderTextColor={txtSec}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    style={[s.modalInput, { color: txt, backgroundColor: inputBg, borderColor: border }]}
                  />
                </>
              ) : null}

              {/* Name */}
              <Text style={[s.inputLabel, { color: txtSec }]}>FULL NAME</Text>
              <TextInput
                value={editName}
                onChangeText={setEditName}
                placeholder="Your name"
                placeholderTextColor={txtSec}
                maxLength={50}
                autoCapitalize="words"
                style={[s.modalInput, { color: txt, backgroundColor: inputBg, borderColor: border }]}
              />

              {/* Mobile Number */}
              <Text style={[s.inputLabel, { color: txtSec }]}>MOBILE NUMBER</Text>
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
                style={[s.modalInput, { color: txt, backgroundColor: inputBg, borderColor: border }]}
              />
              {phoneChanged ? (
                <View style={{ marginTop: -4, marginBottom: 8 }}>
                  {otpSent ? (
                    <>
                      <Text style={{ fontSize: 10, color: txtSec, fontWeight: '600', marginBottom: 6 }}>
                        Enter the 6-digit code we sent to +91 {normalizedEditPhone}
                      </Text>
                      <TextInput
                        value={otpCode}
                        onChangeText={(t) => setOtpCode(t.replace(/\D/g, '').slice(0, 6))}
                        placeholder="6-digit code"
                        placeholderTextColor={txtSec}
                        keyboardType="number-pad"
                        maxLength={6}
                        textContentType="oneTimeCode"
                        autoComplete="sms-otp"
                        style={[s.modalInput, { color: txt, backgroundColor: inputBg, borderColor: goldColor, letterSpacing: 6, textAlign: 'center' }]}
                      />
                      <TouchableOpacity onPress={sendPhoneOtp} disabled={sendingOtp || resendIn > 0} style={{ alignSelf: 'flex-end', padding: 4 }}>
                        <Text style={{ fontSize: 10, fontWeight: '800', color: resendIn > 0 ? txtSec : goldColor }}>
                          {sendingOtp ? 'SENDING…' : resendIn > 0 ? `RESEND IN ${resendIn}s` : 'RESEND CODE'}
                        </Text>
                      </TouchableOpacity>
                    </>
                  ) : (
                    <Text style={{ fontSize: 10, color: txtSec, fontWeight: '600' }}>
                      We’ll text a code to the new number to confirm it’s yours.
                    </Text>
                  )}
                </View>
              ) : null}

              {/* Email */}
              <Text style={[s.inputLabel, { color: txtSec }]}>EMAIL (OPTIONAL)</Text>
              <TextInput
                value={editEmail}
                onChangeText={setEditEmail}
                placeholder="you@example.com"
                placeholderTextColor={txtSec}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={100}
                style={[s.modalInput, { color: txt, backgroundColor: inputBg, borderColor: border }]}
              />

              {/* Bio/About */}
              <Text style={[s.inputLabel, { color: txtSec }]}>ABOUT ME</Text>
              <TextInput
                value={editAbout}
                onChangeText={setEditAbout}
                placeholder="Write something about yourself..."
                placeholderTextColor={txtSec}
                multiline
                numberOfLines={3}
                maxLength={BIO_MAX}
                style={[s.modalInput, { color: txt, backgroundColor: inputBg, borderColor: border, height: 80, textAlignVertical: 'top', paddingTop: 10 }]}
              />
              <Text style={{ fontSize: 9, color: txtSec, textAlign: 'right', marginTop: -4, marginBottom: 6 }}>{editAbout.length}/{BIO_MAX}</Text>

              {/* Hostel block (campus directory chips + free text) and room number */}
              <Text style={[s.inputLabel, { color: txtSec }]}>HOSTEL BLOCK</Text>
              {hostelCampuses.length > 0 && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                  {hostelCampuses.flatMap((c) => c.blocks.map((b) => ({ key: `${c.code}:${b}`, block: b }))).filter((x, i, arr) => arr.findIndex((y) => y.block === x.block) === i).slice(0, 32).map(({ key, block }) => {
                    const on = editHostelBlock.toLowerCase() === block.toLowerCase();
                    return (
                      <TouchableOpacity
                        key={key}
                        onPress={() => setEditHostelBlock(on ? '' : block)}
                        accessibilityRole="button"
                        accessibilityState={{ selected: on }}
                        style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, borderWidth: 1, borderColor: on ? goldColor : border, backgroundColor: on ? goldColor : inputBg }}
                      >
                        <Text style={{ fontSize: 11, fontWeight: '800', color: on ? '#000' : txt }}>🏢 {block}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
              <TextInput
                value={editHostelBlock}
                onChangeText={(t) => setEditHostelBlock(t.slice(0, HOSTEL_BLOCK_MAX))}
                placeholder={hostelCampuses.length ? 'Or type your block' : 'e.g. Ganga Block'}
                placeholderTextColor={txtSec}
                maxLength={HOSTEL_BLOCK_MAX}
                style={[s.modalInput, { color: txt, backgroundColor: inputBg, borderColor: border }]}
              />
              <Text style={[s.inputLabel, { color: txtSec }]}>ROOM NUMBER</Text>
              <TextInput
                value={editRoom}
                onChangeText={(t) => setEditRoom(t.replace(/^\s*room\s*/i, '').slice(0, ROOM_NUMBER_MAX))}
                placeholder="e.g. 304"
                placeholderTextColor={txtSec}
                maxLength={ROOM_NUMBER_MAX}
                autoCapitalize="characters"
                autoCorrect={false}
                style={[s.modalInput, { color: txt, backgroundColor: inputBg, borderColor: border }]}
              />

              {/* Delivery Address Auto-complete */}
              <Text style={[s.inputLabel, { color: txtSec }]}>DELIVERY ADDRESS</Text>
              <View style={{ zIndex: 99 }}>
                <TextInput
                  value={editAddress}
                  onChangeText={(text) => {
                    setEditAddress(text);
                    fetchAddressSuggestions(text);
                  }}
                  placeholder="Hostel room, block name..."
                  placeholderTextColor={txtSec}
                  maxLength={200}
                  style={[s.modalInput, { color: txt, backgroundColor: inputBg, borderColor: border }]}
                />

                {showSuggestions && suggestions.length > 0 && (
                  <View style={[s.suggestionsBox, { backgroundColor: cardBg, borderColor: border }]}>
                    {suggestions.map((item, i) => (
                      <TouchableOpacity
                        key={item.place_id || i}
                        onPress={() => handleSelectSuggestion(item)}
                        style={s.suggestionItem}
                      >
                        <Text style={[s.suggestionText, { color: txt }]} numberOfLines={2}>
                          📍 {item.display_name}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>

              {/* City */}
              <Text style={[s.inputLabel, { color: txtSec }]}>CITY</Text>
              <TextInput
                value={editCity}
                onChangeText={setEditCity}
                placeholder="City"
                placeholderTextColor={txtSec}
                maxLength={60}
                style={[s.modalInput, { color: txt, backgroundColor: inputBg, borderColor: border }]}
              />

              <View style={s.modalActionsRow}>
                <TouchableOpacity
                  style={[s.modalCancelBtn, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }]}
                  onPress={closeEditor}
                  disabled={savingProfile}
                >
                  <Text style={[s.modalCancelBtnText, { color: txt }]}>CANCEL</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.modalSaveBtn, { backgroundColor: goldColor }, (savingProfile || sendingOtp) && { opacity: 0.7 }]}
                  onPress={handleUpdateProfile}
                  disabled={savingProfile || sendingOtp}
                >
                  {savingProfile || sendingOtp ? (
                    <ActivityIndicator size="small" color="#000" />
                  ) : (
                    <Text style={s.modalSaveBtnText}>{phoneChanged && !otpSent ? 'VERIFY NUMBER' : 'SAVE'}</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
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

      {/* ─── MODAL: ABOUT US ─── */}
      <Modal visible={showAbout} animationType="slide" transparent={true} onRequestClose={() => setShowAbout(false)}>
        <View style={s.modalOverlay}>
          <View style={[s.modalContent, { backgroundColor: cardBg, borderColor: border }]}>
            <View style={s.aboutHeader}>
              <View style={[s.aboutLogo, { backgroundColor: goldColor }]}>
                <Text style={{ fontSize: 24 }}>⚡</Text>
              </View>
              <View>
                <Text style={[s.aboutTitle, { color: goldColor }]}>Project Zenvy</Text>
                <Text style={[s.aboutSub, { color: txtSec }]}>Mobile App</Text>
              </View>
            </View>

            <Text style={s.aboutQuote}>
              &quot;Built for students, by a student. Zenvy brings food, essentials, and campus services right to your hostel door — fast, fresh, and hassle-free.&quot;
            </Text>

            <View style={s.aboutStatsRow}>
              <View style={s.aboutStatCol}>
                <Text style={s.aboutStatLabel}>VERSION</Text>
                <Text style={s.aboutStatVal}>
                  {APP_VERSION}
                </Text>
              </View>
              <View style={s.aboutStatCol}>
                <Text style={s.aboutStatLabel}>PLATFORM</Text>
                <Text style={s.aboutStatVal}>{Platform.OS.toUpperCase()}</Text>
              </View>
            </View>

            <Text style={s.aboutFooter}>
              Designed & Developed by {'\n'}
              <Text style={{ color: goldColor }}>Shanmukesh Kunjam</Text>
            </Text>

            <TouchableOpacity style={s.aboutCloseBtn} onPress={() => setShowAbout(false)}>
              <Text style={s.aboutCloseText}>CLOSE</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

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
    fontWeight: '900',
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
    fontSize: 9,
    fontWeight: '900',
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
    fontSize: 10,
    fontWeight: '900',
    color: '#000',
    letterSpacing: 2,
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
    fontSize: 9,
    fontWeight: '900',
    color: '#FFF',
  },
  name: {
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 2,
    marginBottom: 4,
    textAlign: 'left',
    alignSelf: 'flex-start',
  },
  tierText: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 2.5,
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
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1.5,
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
    fontSize: 11,
    fontWeight: '600',
  },
  editAddrText: {
    fontSize: 9,
    fontWeight: '900',
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
    fontSize: 7,
    fontWeight: '900',
    color: '#888',
    marginBottom: 4,
  },
  telemetryVal: {
    fontSize: 18,
    fontWeight: '900',
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
    fontSize: 8,
    fontWeight: '900',
    color: '#888',
  },
  progressVal: {
    fontSize: 8,
    fontWeight: '900',
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
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 2.5,
    borderLeftWidth: 3,
    borderLeftColor: '#D4AF7A',
    paddingLeft: 12,
    marginVertical: 12,
    marginLeft: 16,
  },
  sectionAddBtn: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.5,
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
    fontWeight: '800',
  },
  emptySubText: {
    fontSize: 9,
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
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
  },
  savedAddressVal: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
    flexShrink: 1,
  },
  deleteBtnText: {
    fontSize: 14,
    color: '#EF4444',
    paddingHorizontal: 8,
    fontWeight: '800',
  },
  dietCard: {
    marginHorizontal: 16,
    borderRadius: 24,
    borderWidth: 1,
    padding: 16,
    marginBottom: 20,
  },
  dietLabel: {
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 2,
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
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
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
    fontSize: 9,
    fontWeight: '900',
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
    fontSize: 10,
    fontWeight: '600',
  },
  allergyAddBtn: {
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  allergyAddBtnText: {
    fontSize: 9,
    fontWeight: '900',
    color: '#000',
  },
  pushBtn: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  pushBtnText: {
    fontSize: 8,
    fontWeight: '900',
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
    fontWeight: '900',
  },
  notifDesc: {
    fontSize: 8,
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
    fontSize: 9,
    fontWeight: '900',
    color: '#FFF',
    letterSpacing: 0.5,
  },
  badgeDesc: {
    fontSize: 7,
    fontWeight: '700',
    color: '#888',
    marginTop: 2,
  },
  emptyAchievements: {
    alignItems: 'center',
    paddingVertical: 14,
  },
  emptyAchievementsText: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.5,
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
    fontSize: 8,
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
    fontSize: 7,
    fontWeight: '900',
    marginBottom: 2,
  },
  footerVal: {
    fontSize: 13,
    fontWeight: '900',
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
    fontSize: 7,
    fontWeight: '900',
    letterSpacing: 2,
  },
  couponHeader: {
    fontSize: 15,
    fontWeight: '900',
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
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  couponCopyBtn: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  couponCopyBtnText: {
    fontSize: 8,
    fontWeight: '900',
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
    fontWeight: '900',
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  buddyLinkSubtitle: {
    fontSize: 9,
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
    fontSize: 7,
    fontWeight: '900',
    letterSpacing: 1.5,
    marginBottom: 3,
  },
  buddyCodeValue: {
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 2.5,
  },
  buddyCopyChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 10,
  },
  buddyCopyChipText: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
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
    fontSize: 11,
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
    fontSize: 8,
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
    fontWeight: '900',
    color: '#000',
    letterSpacing: 1.5,
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
    fontWeight: '900',
    marginBottom: 2,
  },
  buddyStatLabel: {
    fontSize: 7,
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
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1.5,
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
    fontWeight: '900',
  },
  giftSubText: {
    fontSize: 7,
    color: '#666',
    fontWeight: '800',
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
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1.5,
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
    fontSize: 7,
    fontWeight: '900',
    marginTop: 6,
  },
  chartBarTotal: {
    fontSize: 6,
    fontWeight: '900',
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
    fontSize: 11,
    fontWeight: '900',
  },
  topItemCount: {
    fontSize: 8,
    fontWeight: '700',
    marginTop: 1,
  },
  topItemSpend: {
    fontSize: 11,
    fontWeight: '900',
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
    fontWeight: '900',
  },
  smallStatLabel: {
    fontSize: 7,
    fontWeight: '900',
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
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
    marginTop: 8,
  },
  supportBtnDesc: {
    fontSize: 7,
    fontWeight: '600',
    marginTop: 2,
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
    fontSize: 10,
    fontWeight: '900',
    color: '#EF4444',
    letterSpacing: 3,
    textAlign: 'center',
  },
  logoutSubText: {
    fontSize: 8,
    color: '#666',
    fontWeight: '800',
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
    fontWeight: '900',
    color: '#FFF',
    letterSpacing: 2,
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 8,
    fontWeight: '900',
    color: '#888',
    letterSpacing: 1.5,
    alignSelf: 'flex-start',
    marginTop: 12,
    marginBottom: 6,
  },
  modalInput: {
    width: '100%',
    height: 48,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 14,
    paddingHorizontal: 16,
    fontSize: 12,
    color: '#FFF',
    fontWeight: '600',
    marginBottom: 8,
  },
  localUploadBtn: {
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
  localUploadBtnText: {
    fontSize: 9,
    fontWeight: '900',
    color: '#D4AF7A',
    letterSpacing: 1.5,
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
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  suggestionText: {
    color: '#FFF',
    fontSize: 10,
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
    fontSize: 10,
    fontWeight: '900',
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
    fontSize: 10,
    fontWeight: '900',
    color: '#000',
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
    fontWeight: '900',
  },
  qrContainer: {
    padding: 16,
    backgroundColor: '#FFF',
    borderRadius: 20,
    marginTop: 20,
  },
  qrName: {
    fontSize: 16,
    fontWeight: '900',
    color: '#FFF',
    marginTop: 10,
  },
  qrCity: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 2.5,
    marginTop: 4,
  },
  qrSubText: {
    fontSize: 8,
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
    fontSize: 10,
    fontWeight: '900',
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

  // About Modal specifically
  aboutHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
    alignSelf: 'flex-start',
  },
  aboutLogo: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aboutTitle: {
    fontSize: 18,
    fontWeight: '900',
  },
  aboutSub: {
    fontSize: 8,
    fontWeight: '800',
    color: '#888',
    letterSpacing: 2,
  },
  aboutQuote: {
    fontSize: 11,
    fontWeight: '600',
    fontStyle: 'italic',
    color: '#CCC',
    lineHeight: 16,
    marginVertical: 12,
    textAlign: 'left',
  },
  aboutStatsRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
    marginVertical: 14,
  },
  aboutStatCol: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  aboutStatLabel: {
    fontSize: 7,
    fontWeight: '900',
    color: '#888',
    marginBottom: 4,
  },
  aboutStatVal: {
    fontSize: 11,
    fontWeight: '900',
    color: '#FFF',
  },
  aboutFooter: {
    fontSize: 9,
    color: '#888',
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 14,
    marginVertical: 16,
  },
  aboutCloseBtn: {
    width: '100%',
    height: 44,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aboutCloseText: {
    fontSize: 10,
    fontWeight: '900',
    color: '#FFF',
  },
});
