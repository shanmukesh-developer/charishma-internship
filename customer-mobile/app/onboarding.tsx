import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  ScrollView,
  Platform,
  LayoutAnimation,
  useWindowDimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
  FlatList,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useReduceMotion } from '../utils/reduceMotion';

// First-run onboarding (shown once after install; app/index.tsx decides). Dark and gold, matching the
// ZCS intro: swipeable pages with a photo parallax, gold pill progress, one accent colour.

const BG = '#0A0A0B';
const GOLD = '#D4AF37';
const TEXT = '#F3F0E8';
const MUTED = 'rgba(236,230,218,0.62)';
const ND = Platform.OS !== 'web';
const SIDE = 20;

const BRAND_FONT = Platform.select({
  android: { fontFamily: 'sans-serif-medium', fontWeight: '500' as const },
  ios: { fontFamily: 'Avenir Next', fontWeight: '500' as const },
  default: { fontFamily: '"Avenir Next", Montserrat, "Segoe UI", Roboto, Helvetica, Arial, sans-serif', fontWeight: '500' as const },
});
const BRAND_SUB_FONT = Platform.select({
  android: { fontFamily: 'sans-serif-light', fontWeight: '300' as const },
  ios: { fontFamily: 'Avenir Next', fontWeight: '400' as const },
  default: { fontFamily: '"Avenir Next", Montserrat, "Segoe UI", Roboto, Helvetica, Arial, sans-serif', fontWeight: '300' as const },
});

type Feature = { icon: keyof typeof Ionicons.glyphMap; text: string; where: string };
type Page = { id: string; tag: string; title: string; line: string; image: string; features: Feature[] };

const PAGES: Page[] = [
  {
    id: 'food',
    tag: 'Food delivery',
    title: 'Hot meals to your room',
    line: 'Campus canteens and nearby restaurants, 6 am to 9 pm.',
    image: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=1200&q=85',
    features: [
      { icon: 'restaurant-outline', text: 'Browse stores, dishes and offers', where: 'Home' },
      { icon: 'basket-outline', text: 'Review your items and place the order', where: 'Basket' },
      { icon: 'wallet-outline', text: 'Pay cash on delivery or with Wallet', where: 'Checkout' },
    ],
  },
  {
    id: 'essentials',
    tag: 'Groceries and essentials',
    title: 'Daily essentials, delivered',
    line: 'Snacks and groceries from the campus store, or send a list.',
    image: 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=1200&q=85',
    features: [
      { icon: 'storefront-outline', text: 'Shop the campus store by category', where: 'Others' },
      { icon: 'list-outline', text: 'Send a list like “2 Maggi, 1 atta”', where: 'Others' },
      { icon: 'cash-outline', text: 'Pay cash on delivery when it arrives', where: 'Checkout' },
    ],
  },
  {
    id: 'services',
    tag: 'Services, stays and rides',
    title: 'Repairs, PG stays and rides',
    line: 'Services, student stays, shared rides and campus events.',
    image: 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=1200&q=85',
    features: [
      { icon: 'construct-outline', text: 'Book repairs, laundry and other services', where: 'Others' },
      { icon: 'business-outline', text: 'Explore PGs and request a booking', where: 'Others' },
      { icon: 'bicycle-outline', text: 'Share a ride, rent a vehicle, get event passes', where: 'Others' },
    ],
  },
  {
    id: 'campus',
    tag: 'Campus',
    title: 'Your campus in one place',
    line: 'Chats, Pulse, Spaces, the Forum and Tasks, for verified students.',
    image: 'https://images.unsplash.com/photo-1511632765486-a01980e01a18?w=1200&q=85',
    features: [
      { icon: 'people-outline', text: 'Chat with classmates and friends', where: 'Campus' },
      { icon: 'shield-checkmark-outline', text: 'Verify your college once to unlock Campus', where: 'Campus' },
      { icon: 'search-outline', text: 'Lost something? Post it in Lost and found', where: 'Campus' },
    ],
  },
  {
    id: 'orders-profile',
    tag: 'Orders and profile',
    title: 'Track orders and get help',
    line: 'Follow every order live, and manage Wallet, alerts and support.',
    image: 'https://images.unsplash.com/photo-1617347454431-f49d7ff5c3b1?w=1200&q=85',
    features: [
      { icon: 'receipt-outline', text: 'Track live orders and your history', where: 'Orders' },
      { icon: 'person-circle-outline', text: 'Wallet, notifications, help and support', where: 'Profile' },
    ],
  },
];

// Campus choice on the last page: pre-selects the campus at checkout (same key and list as checkout.tsx).
const CHECKOUT_CAMPUS_KEY = 'zenvy_checkout_campus';
const CAMPUSES: { key: string; label: string; sub: string }[] = [
  { key: 'srmap', label: 'SRM AP', sub: 'SRM University AP' },
  { key: 'vitap', label: 'VIT AP', sub: 'VIT-AP University' },
  { key: 'amrita', label: 'Amrita', sub: 'Amrita Vishwa Vidyapeetham' },
];

const DOT = 6;
const DOT_STEP = 18; // centre-to-centre spacing of the progress dots
const PILL = 20;

const tick = () => { if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {}); };

export default function OnboardingScreen() {
  const router = useRouter();
  const { width: W, height: H } = useWindowDimensions();
  const reduceMotion = useReduceMotion();
  const [index, setIndex] = useState(0);
  const [campus, setCampus] = useState<string | null>(null);
  const listRef = useRef<FlatList<Page>>(null);
  const scrollX = useRef(new Animated.Value(0)).current;
  const indexRef = useRef(0);
  const last = PAGES.length - 1;
  const isLast = index === last;

  // Show the campus already chosen (e.g. at checkout on an earlier install of this session).
  useEffect(() => {
    AsyncStorage.getItem(CHECKOUT_CAMPUS_KEY).then((v) => { if (v) setCampus(v); }).catch(() => {});
  }, []);

  const pickCampus = (key: string) => {
    tick();
    setCampus(key);
    AsyncStorage.setItem(CHECKOUT_CAMPUS_KEY, key).catch(() => {});
  };

  const settle = useCallback((next: number) => {
    if (next === indexRef.current) return;
    // The Back button slides in on page 2 and out on page 1 (no jump).
    if ((next === 0) !== (indexRef.current === 0)) LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    indexRef.current = next;
    setIndex(next);
    tick();
  }, []);

  const goTo = useCallback((i: number) => {
    const next = Math.max(0, Math.min(last, i));
    listRef.current?.scrollToOffset({ offset: next * W, animated: !reduceMotion });
    settle(next);
  }, [W, last, reduceMotion, settle]);

  // Window resized or rotated: keep the current page in place.
  useEffect(() => {
    listRef.current?.scrollToOffset({ offset: indexRef.current * W, animated: false });
  }, [W]);

  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    settle(Math.round(e.nativeEvent.contentOffset.x / Math.max(1, W)));
  };

  const finishingRef = useRef(false);
  const finish = async (destination: '/register' | '/login' | '/(tabs)') => {
    // A quick double tap (Skip + Get started) must not stack two screens.
    if (finishingRef.current) return;
    finishingRef.current = true;
    try {
      await AsyncStorage.setItem('has_seen_onboarding', 'true');
      await AsyncStorage.setItem('zenvy_onboarded', 'true');
    } catch (e) {
      console.warn('Failed to persist onboarding state', e);
    }
    router.replace(destination as any);
  };

  const onScroll = Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
    useNativeDriver: ND,
    // Web fallback: settle the page when the browser's scroll-snap ends (no momentum event there).
    listener: Platform.OS === 'web' ? (e: any) => {
      const x = e?.nativeEvent?.contentOffset?.x ?? 0;
      const i = Math.round(x / Math.max(1, W));
      if (Math.abs(x - i * W) < 2) settle(i);
    } : undefined,
  });

  // Hero size from the real space: the pager height minus the tallest copy block, so tall phones get a
  // bigger photo instead of an empty gap, and short phones never push the copy under the buttons.
  const [pagerH, setPagerH] = useState(0);
  const [copyH, setCopyH] = useState<Record<string, number>>({});
  const frameW = W - SIDE * 2;
  const clamp = (v: number, lo: number, hi: number) => Math.round(Math.max(lo, Math.min(hi, v)));
  const copyMax = Math.max(0, ...PAGES.slice(0, last).map((p) => copyH[p.id] || 0));
  const HERO_GAP = 18 + 12 + 12; // hero margin + page bottom padding + breathing room
  const measured = pagerH > 0 && copyMax > 0;
  const heroH = measured
    ? clamp(pagerH - copyMax - HERO_GAP, frameW * 0.5, frameW)
    : Math.round(Math.min(frameW * 0.72, H * 0.3));
  // Very tall windows: once the photo is square, split what is left above and below (same on every page).
  const spare = measured ? Math.max(0, Math.floor((pagerH - copyMax - HERO_GAP - heroH) / 2)) : 0;
  const lastCopy = copyH[PAGES[last].id] || 0;
  const lastHeroH = measured && lastCopy > 0
    ? clamp(pagerH - lastCopy - HERO_GAP, frameW * 0.34, heroH)
    : Math.round(heroH * 0.7);
  const onCopyLayout = (id: string, h: number) => {
    setCopyH((prev) => (Math.abs((prev[id] || 0) - h) > 1 ? { ...prev, [id]: h } : prev));
  };

  const renderPage = ({ item, index: i }: { item: Page; index: number }) => {
    const range = [(i - 1) * W, i * W, (i + 1) * W];
    // Photo drifts at a fraction of the swipe speed inside its frame (parallax); copy fades and rises.
    const photoX = reduceMotion ? 0 : scrollX.interpolate({ inputRange: range, outputRange: [-W * 0.22, 0, W * 0.22], extrapolate: 'clamp' });
    const copyOpacity = scrollX.interpolate({ inputRange: [(i - 0.6) * W, i * W, (i + 0.6) * W], outputRange: [0, 1, 0], extrapolate: 'clamp' });
    const copyY = reduceMotion ? 0 : scrollX.interpolate({ inputRange: range, outputRange: [18, 0, 18], extrapolate: 'clamp' });
    const pageIsLast = i === last;
    const h = pageIsLast ? lastHeroH : heroH;

    return (
      <ScrollView
        style={{ width: W }}
        contentContainerStyle={[s.pageContent, !pageIsLast && spare > 0 && { paddingTop: spare }]}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        <View style={[s.hero, { height: h }]}>
          <Animated.View style={[s.heroPhoto, { left: -W * 0.22, right: -W * 0.22, transform: [{ translateX: photoX }] }]}>
            <Image source={{ uri: item.image }} style={StyleSheet.absoluteFill} contentFit="cover" transition={250} />
          </Animated.View>
          <LinearGradient
            colors={['rgba(10,10,11,0)', 'rgba(10,10,11,0.35)', 'rgba(10,10,11,0.92)']}
            locations={[0.35, 0.7, 1]}
            style={StyleSheet.absoluteFill}
          />
          <View style={s.heroTag}>
            <View style={s.heroTagDot} />
            <Text style={s.heroTagText}>{item.tag}</Text>
          </View>
        </View>

        <Animated.View
          style={{ opacity: copyOpacity, transform: [{ translateY: copyY }] }}
          onLayout={(e) => onCopyLayout(item.id, e.nativeEvent.layout.height)}
        >
          <Text style={s.title}>{item.title}</Text>
          <Text style={s.line}>{item.line}</Text>

          <View style={s.features}>
            {item.features.map((f, k) => (
              <View key={f.text} style={[s.featureRow, k > 0 && s.featureDivider]}>
                <View style={s.featureIcon}>
                  <Ionicons name={f.icon} size={17} color={GOLD} />
                </View>
                <Text style={s.featureText}>{f.text}</Text>
                <Text style={s.featureWhere}>{f.where}</Text>
              </View>
            ))}
          </View>

          {pageIsLast && (
            <View style={s.campusBlock}>
              <Text style={s.campusTitle}>Choose your campus</Text>
              <View style={s.campusRow}>
                {CAMPUSES.map((c) => {
                  const on = campus === c.key;
                  return (
                    <TouchableOpacity
                      key={c.key}
                      onPress={() => pickCampus(c.key)}
                      activeOpacity={0.85}
                      style={[s.campusCard, on && s.campusCardOn]}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: on, checked: on }}
                      accessibilityLabel={`${c.label}, ${c.sub}`}
                    >
                      <Ionicons
                        name={on ? 'checkmark-circle' : 'ellipse-outline'}
                        size={18}
                        color={on ? GOLD : 'rgba(255,255,255,0.28)'}
                        style={s.campusCheck}
                      />
                      <Text style={[s.campusName, on && { color: '#FFF6DC' }]}>{c.label}</Text>
                      <Text style={s.campusSub} numberOfLines={2}>{c.sub}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={s.campusNote}>Used at checkout. You can change it any time.</Text>
            </View>
          )}
        </Animated.View>
      </ScrollView>
    );
  };

  // Progress: faint gold dots, and one gold pill that slides to the active page and stretches mid-swipe.
  const pillX = scrollX.interpolate({ inputRange: [0, last * W], outputRange: [0, last * DOT_STEP], extrapolate: 'clamp' });
  const stretchIn: number[] = [];
  const stretchOut: number[] = [];
  PAGES.forEach((_, i) => {
    stretchIn.push(i * W);
    stretchOut.push(1);
    if (i < last) { stretchIn.push((i + 0.5) * W); stretchOut.push(reduceMotion ? 1 : 1.7); }
  });
  const pillStretch = scrollX.interpolate({ inputRange: stretchIn, outputRange: stretchOut, extrapolate: 'clamp' });
  const dotsW = last * DOT_STEP + PILL;

  return (
    <View style={s.screen}>
      <SafeAreaView style={s.safe} edges={['top', 'bottom', 'left', 'right']}>
        {/* Header: ZCS mark + Skip (always visible) */}
        <View style={s.header}>
          <View accessible accessibilityLabel="ZCS, Zenvy Community and Services">
            <Text allowFontScaling={false} style={s.brand}>ZCS</Text>
            <Text allowFontScaling={false} style={s.brandSub}>Zenvy Community and Services</Text>
          </View>
          <TouchableOpacity
            style={s.skip}
            onPress={() => finish('/(tabs)')}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Skip the introduction"
          >
            <Text style={s.skipText}>Skip</Text>
          </TouchableOpacity>
        </View>

        <Animated.FlatList
          ref={listRef as any}
          data={PAGES}
          keyExtractor={(p) => p.id}
          horizontal
          pagingEnabled
          bounces={false}
          showsHorizontalScrollIndicator={false}
          onScroll={onScroll}
          scrollEventThrottle={16}
          onMomentumScrollEnd={onMomentumEnd}
          getItemLayout={(_, i) => ({ length: W, offset: W * i, index: i })}
          renderItem={renderPage}
          extraData={`${W}-${campus}-${reduceMotion}-${heroH}-${lastHeroH}-${spare}`}
          onLayout={(e) => setPagerH(e.nativeEvent.layout.height)}
          style={s.pager}
        />

        {/* Bottom: progress, Back + Next / Get started, Sign in */}
        <View style={s.bottom}>
          <View
            style={[s.dots, { width: dotsW }]}
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel={`Page ${index + 1} of ${PAGES.length}`}
          >
            {PAGES.map((p, i) => (
              <View key={p.id} style={[s.dot, { left: i * DOT_STEP + (PILL - DOT) / 2 }]} />
            ))}
            <Animated.View style={[s.pill, { transform: [{ translateX: pillX }, { scaleX: pillStretch }] }]} />
          </View>

          <View style={s.actions}>
            {index > 0 && (
              <TouchableOpacity
                style={s.back}
                onPress={() => goTo(index - 1)}
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityLabel="Back"
              >
                <Ionicons name="chevron-back" size={22} color={TEXT} />
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={s.primary}
              onPress={() => (isLast ? finish('/register') : goTo(index + 1))}
              activeOpacity={0.88}
              accessibilityRole="button"
              accessibilityLabel={isLast ? 'Get started' : 'Next'}
            >
              <Text style={s.primaryText}>{isLast ? 'Get started' : 'Next'}</Text>
              {!isLast && <Ionicons name="arrow-forward" size={18} color={BG} style={{ marginLeft: 6 }} />}
            </TouchableOpacity>
          </View>

          <View style={s.signInRow}>
            <Text style={s.signInPrompt}>Already have an account?</Text>
            <TouchableOpacity onPress={() => finish('/login')} activeOpacity={0.7} hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }} accessibilityRole="button">
              <Text style={s.signIn}>Sign in</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  safe: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SIDE,
    paddingTop: 10,
    paddingBottom: 12,
  },
  brand: { ...BRAND_FONT, color: '#D9B65C', fontSize: 18, letterSpacing: 6 },
  brandSub: { ...BRAND_SUB_FONT, color: 'rgba(217,199,149,0.72)', fontSize: 9.5, letterSpacing: 1.4, marginTop: 1 },
  skip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  skipText: { color: TEXT, fontSize: 13, fontWeight: '500' },

  pager: { flex: 1 },
  pageContent: { paddingHorizontal: SIDE, paddingBottom: 12 },

  hero: {
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: '#15130F',
    borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.14)',
    marginBottom: 18,
  },
  heroPhoto: { position: 'absolute', top: 0, bottom: 0 },
  heroTag: {
    position: 'absolute',
    left: 14,
    bottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: 'rgba(10,10,11,0.6)',
    borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.35)',
  },
  heroTagDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: GOLD, marginRight: 6 },
  heroTagText: { color: '#EBD39A', fontSize: 12, fontWeight: '600' },

  title: { color: TEXT, fontSize: 24, fontWeight: '700', lineHeight: 30, letterSpacing: -0.2 },
  line: { color: MUTED, fontSize: 14, fontWeight: '400', lineHeight: 20, marginTop: 6 },

  features: {
    marginTop: 16,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 12,
  },
  featureRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  featureDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.08)' },
  featureIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(212,175,55,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  featureText: { flex: 1, color: '#ECE8DF', fontSize: 14, fontWeight: '500', lineHeight: 19 },
  featureWhere: { color: 'rgba(255,255,255,0.38)', fontSize: 12, fontWeight: '500', marginLeft: 8 },

  campusBlock: { marginTop: 18 },
  campusTitle: { color: TEXT, fontSize: 15, fontWeight: '600', marginBottom: 10 },
  campusRow: { flexDirection: 'row', gap: 8 },
  campusCard: {
    flex: 1,
    minHeight: 84,
    borderRadius: 16,
    padding: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  campusCardOn: { borderColor: GOLD, backgroundColor: 'rgba(212,175,55,0.1)' },
  campusCheck: { position: 'absolute', top: 10, right: 10 },
  campusName: { color: TEXT, fontSize: 15, fontWeight: '600', marginTop: 18 },
  campusSub: { color: 'rgba(255,255,255,0.45)', fontSize: 11, lineHeight: 14, marginTop: 3 },
  campusNote: { color: 'rgba(255,255,255,0.4)', fontSize: 12, marginTop: 10 },

  bottom: { paddingHorizontal: SIDE, paddingTop: 8, paddingBottom: 12 },
  dots: { height: DOT, alignSelf: 'center', marginBottom: 16 },
  dot: { position: 'absolute', top: 0, width: DOT, height: DOT, borderRadius: DOT / 2, backgroundColor: 'rgba(212,175,55,0.28)' },
  pill: { position: 'absolute', top: 0, left: 0, width: PILL, height: DOT, borderRadius: DOT / 2, backgroundColor: GOLD },

  actions: { flexDirection: 'row', gap: 10 },
  back: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  primary: {
    flex: 1,
    height: 52,
    borderRadius: 16,
    backgroundColor: GOLD,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { color: BG, fontSize: 15, fontWeight: '600' },

  signInRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 14, gap: 6 },
  signInPrompt: { color: 'rgba(255,255,255,0.5)', fontSize: 13 },
  signIn: { color: '#E6C770', fontSize: 13, fontWeight: '600' },
});
