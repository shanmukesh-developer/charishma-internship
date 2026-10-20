import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, Dimensions, Animated, Easing, Alert, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import Clipboard from '@react-native-clipboard/clipboard';
import { COLORS, SHADOWS, RADIUS } from '../constants/theme';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { StaggeredSection, FloatingPulse, BounceIn } from '../components/AnimatedSection';
import DopaminePressable, { ActionPressable } from '../components/DopaminePressable';
import { LinearGradient } from 'expo-linear-gradient';
import { apiFetch, readJson } from '../utils/auth';
import { useLiveSync } from '../utils/useLiveSync';
import { API_URL } from '../constants/api';
import { useCart } from '../context/CartContext';
import { Ionicons } from '@expo/vector-icons';
import { formatCount, plural } from '../utils/format';

const { width: SW, height: SH } = Dimensions.get('window');

// Display mirror of the server's 8-sector prize table (same order). The server picks the prize;
// GET /api/rewards/spin-eligibility returns the live table in `prizes`, which wins when present.
const PRIZES = [
  { label: 'Free delivery', value: 'FREEDEL', type: 'coupon', display: 'Free delivery' },
  { label: '10 pts', value: 10, type: 'points', display: '10 ZenPoints' },
  { label: '20 pts', value: 20, type: 'points', display: '20 ZenPoints' },
  { label: '5 pts', value: 5, type: 'points', display: '5 ZenPoints' },
  { label: '50 pts', value: 50, type: 'points', display: '50 ZenPoints' },
  { label: '100 pts', value: 100, type: 'points', display: '100 ZenPoints' },
  { label: '5 pts', value: 5, type: 'points', display: '5 ZenPoints' },
  { label: '2 pts', value: 2, type: 'points', display: '2 ZenPoints' },
];

type Prize = { label: string; value: any; type: string; display: string };

// The server's prize table can carry emoji / ALL-CAPS labels; the wheel and alerts show plain text
// built from the prize type and value instead.
const EMOJI_RE = /(?:[\uD83C-\uD83E][\uDC00-\uDFFF]|[\u2600-\u27BF]|\uFE0F)/g;
const plainText = (t: unknown) => String(t ?? '').replace(EMOJI_RE, '').replace(/\s{2,}/g, ' ').trim();
const isPoints = (p?: Partial<Prize> | null) => !!p && p.type === 'points' && Number.isFinite(Number(p.value));
const prizeWheelLabel = (p?: Partial<Prize> | null) => {
  if (!p) return '';
  if (p.value === 'FREEDEL') return 'Free delivery';
  if (isPoints(p)) return `${formatCount(p.value)} pts`;
  return plainText(p.label);
};
const prizeDisplay = (p?: Partial<Prize> | null) => {
  if (!p) return '';
  if (p.value === 'FREEDEL') return 'Free delivery';
  if (isPoints(p)) return `${formatCount(p.value)} ZenPoints`;
  return plainText(p.display || p.label);
};
type Eligibility = { spinsAvailable: number; nextMilestoneIn: number; spinsUsed: number; prizes?: Prize[] };

export default function RewardsScreen() {
  const router = useRouter();
  const { user, refreshUser } = useAuth();
  const { isDark, colors } = useTheme();
  const { cart } = useCart();

  const streak = user?.streakCount || 0;
  const progressPercent = Math.min(100, (streak / 14) * 100);

  // Backend Eligibility State
  const [eligibility, setEligibility] = useState<Eligibility | null>(null);
  const [loadingEligibility, setLoadingEligibility] = useState(true);
  const [eligibilityError, setEligibilityError] = useState<string | null>(null);
  const [coupons, setCoupons] = useState<any[]>([]);
  const [loadingCoupons, setLoadingCoupons] = useState(false);
  const [couponsError, setCouponsError] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Wheel State
  const [spinning, setSpinning] = useState(false);
  const [selectedPrize, setSelectedPrize] = useState<string | null>(null);
  const spinLockRef = useRef(false);
  const mountedRef = useRef(true);
  const tickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Animation Values
  const spinAnim = useRef(new Animated.Value(0)).current;
  const pointerBounce = useRef(new Animated.Value(0)).current; // Tactile Pointer Bounce
  const bulbPulse = useRef(new Animated.Value(0.3)).current;   // Perimeter Chase Lights

  const wheelPrizes: Prize[] = Array.isArray(eligibility?.prizes) && eligibility!.prizes!.length === PRIZES.length
    ? eligibility!.prizes!
    : PRIZES;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (tickTimerRef.current) clearTimeout(tickTimerRef.current);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      spinAnim.stopAnimation();
      pointerBounce.stopAnimation();
    };
  }, []);

  const fetchEligibility = useCallback(async () => {
    setLoadingEligibility(true);
    try {
      const res = await apiFetch(`${API_URL}/api/rewards/spin-eligibility`);
      const data = await readJson(res);
      if (!mountedRef.current) return;
      if (res.ok && data) {
        setEligibility(data);
        setEligibilityError(null);
      } else {
        setEligibilityError((res.status < 500 && data?.message) || "We couldn't load your spins. Please try again.");
      }
    } catch (err) {
      console.error('Failed to fetch spin eligibility:', err);
      if (mountedRef.current) setEligibilityError("Can't reach Zenvy right now. Check your internet and try again.");
    } finally {
      if (mountedRef.current) setLoadingEligibility(false);
    }
  }, []);

  // silent = live-sync background refresh: keep the list, no spinner, no error card
  const fetchCoupons = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = !!opts?.silent;
    if (!silent) setLoadingCoupons(true);
    try {
      const res = await apiFetch(`${API_URL}/api/rewards/coupons`);
      const data = await readJson(res);
      if (!mountedRef.current) return;
      if (res.ok) {
        setCoupons(Array.isArray(data) ? data : []);
        setCouponsError(false);
      } else if (!silent) {
        setCouponsError(true);
      }
    } catch (err) {
      console.error('Failed to fetch user coupons:', err);
      if (mountedRef.current && !silent) setCouponsError(true);
    } finally {
      if (mountedRef.current && !silent) setLoadingCoupons(false);
    }
  }, []);

  // Live sync: coupon / vault edits from admin show up without leaving the screen
  useLiveSync({
    types: ['coupon'],
    enabled: !!user,
    onChange: () => { fetchCoupons({ silent: true }); },
  });

  useEffect(() => {
    if (user) {
      fetchEligibility();
      fetchCoupons();
    } else {
      setLoadingEligibility(false);
    }
    // Only when the account changes, not on every profile refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?._id]);

  const handleCopyCoupon = (code: string) => {
    Clipboard.setString(code);
    setCopiedCode(code);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => {
      if (mountedRef.current) setCopiedCode(null);
    }, 2500);
  };

  const handleUseCoupon = (code: string) => {
    if (!cart || cart.length === 0) {
      Alert.alert(
        'Add something first',
        `Your basket is empty. Add items and pick ${code} at checkout to apply it.`,
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Browse', onPress: () => router.push('/(tabs)' as any) },
        ]
      );
      return;
    }
    router.push({ pathname: '/checkout', params: { coupon: code } } as any);
  };

  // Bulb pulsing loop (stopped when leaving the screen)
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bulbPulse, { toValue: 1.0, duration: 600, useNativeDriver: true }),
        Animated.timing(bulbPulse, { toValue: 0.3, duration: 600, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  // The server picks the prize first; the wheel then animates to the slice it returned.
  const startSpin = async () => {
    if (spinning || spinLockRef.current) return;
    if (!eligibility || eligibility.spinsAvailable <= 0) {
      Alert.alert('No spins left', 'You earn a spin for every 2 delivered orders.');
      return;
    }

    spinLockRef.current = true;
    setSpinning(true);
    setSelectedPrize(null);

    let data: any = null;
    try {
      const res = await apiFetch(`${API_URL}/api/rewards/use-spin`, { method: 'POST', body: JSON.stringify({}) });
      data = await readJson(res);
      if (!res.ok || !data || typeof data.prizeIndex !== 'number') {
        if (mountedRef.current) {
          setSpinning(false);
          Alert.alert("Couldn't spin", data?.message || 'Please try again in a moment.');
          fetchEligibility();
        }
        spinLockRef.current = false;
        return;
      }
    } catch {
      // The request may have reached the server before the connection dropped: don't promise the spin is unused.
      if (mountedRef.current) {
        setSpinning(false);
        Alert.alert('Connection problem', "We couldn't confirm your spin. If it went through, your prize will show in My coupons below.");
        fetchEligibility();
        fetchCoupons({ silent: true });
      }
      spinLockRef.current = false;
      return;
    }
    if (!mountedRef.current) { spinLockRef.current = false; return; }

    const targetIndex = Math.max(0, Math.min(wheelPrizes.length - 1, data.prizeIndex));
    const prizeText: string = prizeDisplay(data.prize) || prizeDisplay(wheelPrizes[targetIndex]) || 'A prize';
    setEligibility(prev => (prev ? {
      ...prev,
      spinsAvailable: Number(data.spinsAvailable ?? Math.max(0, prev.spinsAvailable - 1)),
      spinsUsed: Number(data.spinsUsed ?? prev.spinsUsed + 1),
    } : prev));

    spinAnim.setValue(0);
    pointerBounce.setValue(0);

    // Land the pointer on the centre of the won slice (labels sit at idx*45+22.5 degrees).
    const sliceDeg = 360 / wheelPrizes.length;
    const finalVal = 8 - (targetIndex * sliceDeg + sliceDeg / 2) / 360;

    // 1. Decelerating pointer click ticks
    let tickCount = 0;
    const maxTicks = 42;
    const triggerTicks = (delay: number) => {
      if (tickCount >= maxTicks || !mountedRef.current) return;
      Animated.sequence([
        Animated.timing(pointerBounce, { toValue: -15, duration: delay * 0.2, useNativeDriver: true }),
        Animated.spring(pointerBounce, { toValue: 0, friction: 4, tension: 110, useNativeDriver: true }),
      ]).start();
      tickCount++;
      const nextDelay = delay * 1.09;
      tickTimerRef.current = setTimeout(() => triggerTicks(nextDelay), delay);
    };
    triggerTicks(55);

    // 2. Main wheel spin
    Animated.timing(spinAnim, {
      toValue: finalVal,
      duration: 5000,
      easing: Easing.out(Easing.bezier(0.12, 0.8, 0.32, 1)),
      useNativeDriver: true,
    }).start(() => {
      spinLockRef.current = false;
      if (tickTimerRef.current) clearTimeout(tickTimerRef.current);
      if (!mountedRef.current) return;
      setSelectedPrize(prizeText);
      setSpinning(false);
      Alert.alert(
        'You won',
        data.coupon?.code
          ? `${prizeText}. Your coupon ${data.coupon.code} is in My coupons below.`
          : `${prizeText} added to your account.`
      );
      refreshUser().catch(() => {});
      if (data.coupon) fetchCoupons();
    });
  };

  const rotateWheel = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const txt = colors.text;
  const txtSec = colors.textSecondary;
  const bg = colors.bg;
  const cardBg = colors.card;
  const border = colors.border;

  // Perimeter Bulb Positions (8 light bulbs around the wheel rim)
  const bulbPositions = Array.from({ length: 8 }).map((_, idx) => {
    const angle = (idx * 45 * Math.PI) / 180;
    const r = 114; // slightly wider than wheel radius
    const cx = 120; // half of wheel size (240px container)
    const cy = 120;
    return {
      x: cx + r * Math.cos(angle) - 4,
      y: cy + r * Math.sin(angle) - 4,
    };
  });

  if (!user) {
    return (
      <View style={[s.container, { backgroundColor: bg }]}>
        <View style={[s.header, { borderBottomColor: border, backgroundColor: cardBg }]}>
          <TouchableOpacity
            style={[s.backBtn, { borderColor: border, backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#F3F4F6' }]}
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => {
              if (router.canGoBack()) {
                router.back();
              } else {
                router.replace('/(tabs)/profile' as any);
              }
            }}
          >
            <Text style={{ fontSize: 16, color: txt }}>←</Text>
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={s.subText}>Zenvy rewards</Text>
            <Text style={[s.title, { color: txt }]}>Rewards and streaks</Text>
          </View>
        </View>

        <View style={[s.center, { flex: 1, padding: 24 }]}>
          <Ionicons name="trophy-outline" size={52} color="#D4AF7A" style={{ marginBottom: 16 }} />
          <Text style={{ fontSize: 18, fontWeight: '900', color: txt, letterSpacing: 0.2, textAlign: 'center', marginBottom: 8 }}>
            Zenvy rewards
          </Text>
          <Text style={{ fontSize: 12, color: txtSec, textAlign: 'center', lineHeight: 18, marginBottom: 28, maxWidth: 280 }}>
            Sign in to spin the prize wheel (one spin for every 2 delivered orders) and keep your order streak going.
          </Text>

          <DopaminePressable
            style={{
              backgroundColor: '#D4AF7A',
              paddingHorizontal: 32,
              paddingVertical: 14,
              borderRadius: 16,
              marginBottom: 14,
              width: '100%',
              maxWidth: 280,
              alignItems: 'center',
              ...SHADOWS.goldGlow
            }}
            onPress={() => router.push('/login' as any)}
            sound="click"
            activeScale={0.95}
          >
            <Text style={{ color: '#000', fontSize: 13, fontWeight: '900' }}>
              Sign in
            </Text>
          </DopaminePressable>

          <DopaminePressable
            style={{
              paddingVertical: 12,
              paddingHorizontal: 24,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: border,
              width: '100%',
              maxWidth: 280,
              alignItems: 'center'
            }}
            onPress={() => router.replace('/(tabs)' as any)}
            sound="click"
            activeScale={0.95}
          >
            <Text style={{ color: txtSec, fontSize: 12, fontWeight: '800' }}>
              Browse stores
            </Text>
          </DopaminePressable>
        </View>
      </View>
    );
  }

  return (
    <View style={[s.container, { backgroundColor: bg }]}>
      {/* Header */}
      <View style={[s.header, { borderBottomColor: border, backgroundColor: cardBg }]}>
        <TouchableOpacity
          style={[s.backBtn, { borderColor: border, backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#F3F4F6' }]}
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace('/(tabs)/profile' as any);
            }
          }}
        >
          <Text style={{ fontSize: 16, color: txt }}>←</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.subText}>Your rewards</Text>
          <Text style={[s.title, { color: txt }]}>Rewards and streaks</Text>
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={s.scrollContent}>

        {/* Streak Details Card */}
        <StaggeredSection delay={50} direction="up">
          <View style={[s.card, { backgroundColor: cardBg, borderColor: border }]}>
            <View style={s.streakHeader}>
              <View>
                <Text style={s.cardLabel}>Order streak</Text>
                <Text style={[s.streakVal, { color: txt }]}>{plural(streak, 'day')}</Text>
              </View>
            </View>

            {/* Progress Bar */}
            <View style={s.progressContainer}>
              <View style={[s.progressBar, { width: `${progressPercent}%` }]} />
            </View>

            <Text style={[s.cardDesc, { color: txtSec }]}>
              Order on consecutive days to grow your streak. Miss a full day and it starts again.
            </Text>
          </View>
        </StaggeredSection>

        {/* ── PRIZE WHEEL (1 spin per 2 delivered orders) ── */}
        <StaggeredSection delay={130} direction="up">
          <Text style={[s.sectionTitle, { color: txt }]}>Prize wheel</Text>

          <View style={[s.wheelCard, { backgroundColor: cardBg, borderColor: border }]}>
            {loadingEligibility && !eligibility ? (
              <ActivityIndicator size="small" color="#D4AF7A" style={{ marginBottom: 20 }} />
            ) : !eligibility ? (
              <TouchableOpacity onPress={fetchEligibility} style={{ marginBottom: 20, alignItems: 'center' }}>
                <Text style={[s.wheelSub, { marginBottom: 4, color: '#EF4444' }]}>
                  {eligibilityError || "We couldn't load your spins."}
                </Text>
                <Text style={[s.wheelSub, { marginBottom: 0, color: '#D4AF7A' }]}>Tap to try again</Text>
              </TouchableOpacity>
            ) : (
              <Text style={s.wheelSub}>
                {eligibility.spinsAvailable > 0
                  ? `${plural(eligibility.spinsAvailable, 'spin')} available`
                  : `Next spin after ${plural(eligibility.nextMilestoneIn, 'more delivered order')}`}
              </Text>
            )}

            {/* Interactive Animated Pointer */}
            <Animated.View
              style={[
                s.pointerContainer,
                {
                  transform: [
                    {
                      rotate: pointerBounce.interpolate({
                        inputRange: [-25, 25],
                        outputRange: ['-25deg', '25deg']
                      })
                    }
                  ]
                }
              ]}
            >
              <Text style={s.pointerIcon}>▼</Text>
            </Animated.View>

            {/* Wheel Canvas wrapper with chase lights */}
            <View style={s.wheelFrame}>

              {/* Pulsing Chase lights around the rim */}
              {bulbPositions.map((pos, idx) => (
                <Animated.View
                  key={idx}
                  style={[
                    s.chaseBulb,
                    {
                      left: pos.x,
                      top: pos.y,
                      opacity: bulbPulse.interpolate({
                        inputRange: [0.3, 1],
                        outputRange: idx % 2 === 0 ? [0.3, 1] : [1, 0.3] // Alternate pulsing patterns
                      })
                    }
                  ]}
                />
              ))}

              {/* Rotatable wheel block */}
              <Animated.View style={[s.wheelBody, { transform: [{ rotate: rotateWheel }] }]}>

                {/* 4 Overlapping lines dividing the circle into 8 segments */}
                {[0, 45, 90, 135].map((angle, idx) => (
                  <View
                    key={idx}
                    style={[s.wheelDividerLine, { transform: [{ rotate: `${angle}deg` }] }]}
                  />
                ))}

                {/* Prize labels placed along the slices */}
                {wheelPrizes.map((prize, idx) => {
                  const angle = idx * 45 + 22.5; // center text in slice
                  return (
                    <View
                      key={idx}
                      style={[
                        s.sliceTextWrap,
                        { transform: [{ rotate: `${angle}deg` }] }
                      ]}
                    >
                      <Text style={s.sliceText} numberOfLines={1}>
                        {prizeWheelLabel(prize)}
                      </Text>
                    </View>
                  );
                })}

                {/* Glass core dial */}
                <View style={s.coreBadge}>
                  <Ionicons name="star" size={12} color="#D4AF7A" />
                </View>
              </Animated.View>

            </View>

            {/* Initialize Trigger Button */}
            <FloatingPulse>
              <ActionPressable
                style={[
                  s.spinBtn,
                  (spinning || !eligibility || eligibility.spinsAvailable <= 0) && s.spinBtnDisabled
                ]}
                onPress={startSpin}
                disabled={spinning || !eligibility || eligibility.spinsAvailable <= 0}
                sound="success"
              >
                <Text style={s.spinBtnText}>
                  {spinning
                    ? 'Spinning…'
                    : !eligibility
                      ? 'Spins unavailable'
                      : eligibility.spinsAvailable <= 0
                        ? 'No spins left'
                        : 'Spin the wheel'
                  }
                </Text>
              </ActionPressable>
            </FloatingPulse>

            {selectedPrize && (
              <View style={s.resultBox}>
                <Text style={s.resultLabel}>You won</Text>
                <Text style={s.resultVal}>{selectedPrize}</Text>
              </View>
            )}
          </View>
        </StaggeredSection>

        {/* Won coupons */}
        {couponsError && coupons.length === 0 && !loadingCoupons && (
          <TouchableOpacity onPress={() => fetchCoupons()} style={{ paddingVertical: 12, alignItems: 'center' }}>
            <Text style={{ fontSize: 12, fontWeight: '700', color: '#EF4444' }}>Couldn't load your coupons. Tap to try again.</Text>
          </TouchableOpacity>
        )}
        {coupons.length === 0 && !couponsError && !loadingCoupons && (
          <View style={{ paddingVertical: 12, alignItems: 'center' }}>
            <Text style={[s.sectionTitle, { color: txt, marginTop: 16, alignSelf: 'flex-start' }]}>My coupons</Text>
            <Text style={{ fontSize: 12, fontWeight: '700', color: txtSec, textAlign: 'center' }}>No coupons yet. Spin the wheel to win one.</Text>
          </View>
        )}
        {coupons.length > 0 && (
          <StaggeredSection delay={280} direction="up">
            <Text style={[s.sectionTitle, { color: txt, marginTop: 16 }]}>My coupons</Text>
            <View style={{ gap: 10, marginBottom: 16 }}>
              {coupons.map((c, idx) => {
                const isCopied = copiedCode === c.code;
                return (
                  <View
                    key={c.id || c.code || idx}
                    style={[s.rewardRow, { backgroundColor: cardBg, borderColor: border, justifyContent: 'space-between' }]}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
                      <View style={[s.rewardIconWrap, { backgroundColor: 'rgba(212,175,122,0.1)' }]}>
                        <Ionicons name="ticket-outline" size={20} color="#D4AF7A" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[s.rewardTitle, { color: txt, letterSpacing: 1 }]} numberOfLines={1}>
                          {c.code}
                        </Text>
                        <Text style={[s.rewardDesc, { color: '#D4AF7A' }]}>
                          {c.label || (c.type === 'FREEDEL' ? 'Free delivery' : 'Discount')}
                          {typeof c.expiresInDays === 'number'
                            ? (c.expiresInDays <= 0 ? ' · Expires today' : ` · Expires in ${plural(c.expiresInDays, 'day')}`)
                            : ''}
                        </Text>
                      </View>
                    </View>

                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      <DopaminePressable
                        style={[
                          s.statusBox,
                          { backgroundColor: isCopied ? '#22c55e' : 'rgba(212,175,122,0.15)', borderWidth: 1, borderColor: isCopied ? '#22c55e' : '#D4AF7A' }
                        ]}
                        onPress={() => handleCopyCoupon(c.code)}
                        sound="click"
                        activeScale={0.9}
                      >
                        <Text style={[s.statusBoxText, { color: isCopied ? '#FFF' : '#D4AF7A', fontWeight: '900' }]}>
                          {isCopied ? 'Copied' : 'Copy'}
                        </Text>
                      </DopaminePressable>

                      <DopaminePressable
                        style={[
                          s.statusBox,
                          { backgroundColor: '#D4AF7A', borderWidth: 1, borderColor: '#D4AF7A' }
                        ]}
                        onPress={() => handleUseCoupon(c.code)}
                        sound="click"
                        activeScale={0.9}
                      >
                        <Text style={[s.statusBoxText, { color: '#000', fontWeight: '900' }]}>
                          Use now
                        </Text>
                      </DopaminePressable>
                    </View>
                  </View>
                );
              })}
            </View>
          </StaggeredSection>
        )}

        <View style={{ height: 60 }} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, paddingTop: Platform.OS === 'android' ? 40 : 50 },
  center: { alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 16, borderBottomWidth: 1 },
  backBtn: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  subText: { fontSize: 12, fontWeight: '800', color: '#D4AF7A', letterSpacing: 0.3 },
  title: { fontSize: 18, fontWeight: '900' },

  scrollContent: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 40 },
  card: { padding: 20, borderRadius: 28, borderWidth: 1, marginBottom: 20 },
  streakHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  cardLabel: { fontSize: 12, fontWeight: '800', color: '#888' },
  streakVal: { fontSize: 24, fontWeight: '900', marginTop: 2 },

  progressContainer: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.05)', overflow: 'hidden', marginBottom: 12 },
  progressBar: { height: '100%', borderRadius: 3, backgroundColor: '#D4AF7A' },
  cardDesc: { fontSize: 12, fontWeight: '700', lineHeight: 14 },

  sectionTitle: { fontSize: 13, fontWeight: '900', letterSpacing: 0.2, marginBottom: 12, marginLeft: 4 },
  wheelCard: { padding: 24, borderRadius: 28, borderWidth: 1, alignItems: 'center', marginBottom: 24 },
  wheelSub: { fontSize: 12, fontWeight: '800', color: '#888', marginBottom: 20, textAlign: 'center' },

  // Tactile Pointer
  pointerContainer: { zIndex: 50, marginBottom: -12, transformOrigin: 'top center' },
  pointerIcon: { fontSize: 24, color: '#D4AF7A', textShadowColor: 'rgba(212,175,122,0.5)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 6 },

  // Wheel Frame
  wheelFrame: { width: 240, height: 240, position: 'relative', justifyContent: 'center', alignItems: 'center', marginBottom: 24 },
  chaseBulb: { position: 'absolute', width: 8, height: 8, borderRadius: 4, backgroundColor: '#D4AF7A', zIndex: 40, shadowColor: '#D4AF7A', shadowOpacity: 0.8, shadowRadius: 6 },

  // Wheel Body
  wheelBody: { width: 220, height: 220, borderRadius: 110, borderWidth: 4, borderColor: '#D4AF7A', backgroundColor: '#0B0A0C', overflow: 'hidden', justifyContent: 'center', alignItems: 'center', position: 'relative', shadowColor: '#D4AF7A', shadowOpacity: 0.25, shadowRadius: 15, elevation: 8 },
  wheelDividerLine: { position: 'absolute', top: 0, bottom: 0, left: 107.5, width: 1.5, backgroundColor: 'rgba(212,175,122,0.22)' },

  // Text segments
  sliceTextWrap: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, justifyContent: 'flex-start', alignItems: 'center', paddingTop: 20 },
  sliceText: { fontSize: 12, fontWeight: '900', color: '#EBE3CE', letterSpacing: 0.2, textShadowColor: '#000', textShadowOffset: { width: 1, height: 1 }, textShadowRadius: 2 },

  // Core center badge
  coreBadge: { position: 'absolute', width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(11,10,12,0.95)', borderWidth: 2, borderColor: '#D4AF7A', justifyContent: 'center', alignItems: 'center', zIndex: 30, shadowColor: '#D4AF7A', shadowOpacity: 0.4, shadowRadius: 6 },

  spinBtn: { width: '100%', height: 46, backgroundColor: '#D4AF7A', borderRadius: 14, alignItems: 'center', justifyContent: 'center', ...SHADOWS.goldGlow },
  spinBtnDisabled: { backgroundColor: 'rgba(212,175,122,0.45)' },
  spinBtnText: { fontSize: 13, fontWeight: '900', color: '#000', letterSpacing: 0.2 },

  resultBox: { width: '100%', padding: 14, borderRadius: 16, backgroundColor: 'rgba(34,197,94,0.06)', borderWidth: 1.5, borderColor: 'rgba(34,197,94,0.18)', marginTop: 18, alignItems: 'center' },
  resultLabel: { fontSize: 12, fontWeight: '800', color: '#22c55e' },
  resultVal: { fontSize: 12, fontWeight: '900', color: '#22c55e', marginTop: 3 },

  tierList: { gap: 10 },
  rewardRow: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 20, borderWidth: 1, gap: 12 },
  rewardIconWrap: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  rewardTitle: { fontSize: 12, fontWeight: '900' },
  levelBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  levelBadgeText: { fontSize: 12, fontWeight: '900' },
  rewardDesc: { fontSize: 12, fontWeight: '700', marginTop: 2 },
  statusBox: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.04)' },
  statusBoxUnlocked: { backgroundColor: 'rgba(34,197,94,0.1)' },
  statusBoxText: { fontSize: 12, fontWeight: '900', color: '#888' }
});

