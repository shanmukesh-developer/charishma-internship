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
  Easing,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useReduceMotion } from '../utils/reduceMotion';
import ZenvBadge from '../components/ZenvBadge';
import { API_URL } from '../constants/api';
import { setCollege, isCollegeKey } from '../utils/college';
import { writeCache } from '../utils/swrCache';

// First-run onboarding (shown once after install; app/index.tsx decides), redesigned 31 Oct 2026 (owner: "work on
// this section also", right after the new intro): it continues the intro. The ZenWe badge in the header; a
// full-bleed photo per page that cross-fades and drifts as the pages slide; editorial two-line titles with the second
// line in gold; one gold accent throughout. Its own photos, one per topic (owner: "not the same images as the other
// sections", "relevant images"): Unsplash, free licence, bundled in assets/onboarding (sources:
// docs/launch-reports/ZCS-onboarding-photo-sources-2026-10-31.txt), so nothing is downloaded on a first run.
// The Campus page is left out while the admins have Campus switched off (GET /api/config/sections campus.live).

const BG = '#0A0A0B';
const GOLD = '#D4AF37';
const TEXT = '#F3F0E8';
const MUTED = 'rgba(236,230,218,0.66)';
const ND = Platform.OS !== 'web';
const SIDE = 22;

const BRAND_FONT = Platform.select({
  android: { fontFamily: 'sans-serif-medium', fontWeight: '500' as const },
  ios: { fontFamily: 'Avenir Next', fontWeight: '500' as const },
  default: { fontFamily: '"Avenir Next", Montserrat, "Segoe UI", Roboto, Helvetica, Arial, sans-serif', fontWeight: '500' as const },
});

type Feature = { icon: keyof typeof Ionicons.glyphMap; text: string; where: string };
type Page = {
  id: string;
  tag: string;
  title: string;
  accent: string; // second title line, in gold
  line: string;
  art: number;
  glow: string; // a soft tint low on the photo
  features: Feature[];
};

const PAGES: Page[] = [
  {
    id: 'food',
    tag: 'Food delivery',
    // Orders are handed over at the hostel gate, never to rooms (owner, 31 Oct 2026): same words as the rest of the app.
    // Only restaurant (ZCS-delivered) orders use the three slots; campus stalls deliver themselves while open.
    title: 'Hot meals,',
    accent: 'at your hostel gate',
    line: 'Restaurants deliver in three daily slots, campus stalls while they are open. Your rider calls you at the gate.',
    art: require('../assets/onboarding/zcs-onboarding-food-copper-handi-2026-10-31.webp'),
    glow: '#FF8A47',
    features: [
      { icon: 'restaurant-outline', text: 'Browse stores, dishes and offers', where: 'Home' },
      { icon: 'basket-outline', text: 'Review your items and place the order', where: 'Basket' },
      { icon: 'wallet-outline', text: 'Pay cash on delivery or with Wallet', where: 'Checkout' },
    ],
  },
  {
    id: 'essentials',
    tag: 'Groceries and essentials',
    title: 'Daily essentials,',
    accent: 'delivered',
    line: 'Snacks, groceries and everyday needs from the campus stores.',
    art: require('../assets/onboarding/zcs-onboarding-groceries-mesh-bag-2026-10-31.webp'),
    glow: '#EDBE6C',
    features: [
      { icon: 'storefront-outline', text: 'Shop the campus stores by category', where: 'Groceries' },
      { icon: 'pricetag-outline', text: 'Find deals on everyday essentials', where: 'Groceries' },
      { icon: 'cash-outline', text: 'Pay when it arrives, or with Wallet', where: 'Checkout' },
    ],
  },
  {
    id: 'services',
    tag: 'Services, stays and rides',
    title: 'Repairs, stays',
    accent: 'and rides',
    line: 'Services, student stays, shared rides and campus events.',
    art: require('../assets/onboarding/zcs-onboarding-rides-scooter-night-2026-10-31.webp'),
    glow: '#FF8A47',
    features: [
      { icon: 'construct-outline', text: 'Book repairs, laundry and other services', where: 'Services' },
      { icon: 'business-outline', text: 'Explore PGs and request a booking', where: 'Services' },
      { icon: 'bicycle-outline', text: 'Share a ride, rent a vehicle, get event passes', where: 'Services' },
    ],
  },
  {
    id: 'campus',
    tag: 'Campus',
    title: 'Your campus,',
    accent: 'in one place',
    line: 'Chats, Pulse, Spaces, the Forum and Tasks, for verified students.',
    art: require('../assets/onboarding/zcs-onboarding-campus-community-talk-2026-10-31.webp'),
    glow: '#E8364F',
    features: [
      { icon: 'people-outline', text: 'Chat with classmates and friends', where: 'Campus' },
      { icon: 'shield-checkmark-outline', text: 'Verify your college once to unlock Campus', where: 'Campus' },
      { icon: 'search-outline', text: 'Lost something? Post it in Lost and found', where: 'Campus' },
    ],
  },
  {
    id: 'orders-profile',
    tag: 'Orders and profile',
    title: 'Every order,',
    accent: 'followed live',
    line: 'Track each order as it moves, and manage Wallet, alerts and help.',
    art: require('../assets/onboarding/zcs-onboarding-orders-phone-bokeh-2026-10-31.webp'),
    glow: '#EDBE6C',
    features: [
      { icon: 'receipt-outline', text: 'Track live orders and your history', where: 'Orders' },
      { icon: 'person-circle-outline', text: 'Wallet, notifications, help and support', where: 'Profile' },
    ],
  },
];
const CAMPUS_PAGE = PAGES.findIndex((p) => p.id === 'campus');

// College choice on the last page: the student's default college for delivery and for which stores they see (same
// key and list as checkout.tsx; changeable any time). Each college's status comes from GET /api/config/campuses
// (owner, 31 Oct 2026: SRM AP and VIT AP live, Amrita "starts soon"): a coming-soon college cannot be picked yet.
const CHECKOUT_CAMPUS_KEY = 'zenvy_checkout_campus';
type CampusStatus = 'open' | 'paused' | 'soon';
const DEFAULT_STATUS: Record<string, CampusStatus> = { srmap: 'open', vitap: 'open', amrita: 'soon' };
const CAMPUSES: { key: string; label: string; sub: string }[] = [
  { key: 'srmap', label: 'SRM AP', sub: 'SRM University AP' },
  { key: 'vitap', label: 'VIT AP', sub: 'VIT-AP University' },
  { key: 'amrita', label: 'Amrita', sub: 'Amrita Vishwa Vidyapeetham' },
];

const DOT = 6;
const DOT_STEP = 18; // centre-to-centre spacing of the progress dots
const PILL = 20;
const FADE = 64; // how far the backdrop's fade reaches under the top of the copy
const EDGE = 24; // the plain solid strip the fade ends in
const KB_MS = 9000; // the backdrop's slow drift (one way)

const tick = () => { if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {}); };

export default function OnboardingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: W, height: H } = useWindowDimensions();
  const reduceMotion = useReduceMotion();
  // Short phones (under ~760 dp of height) get a tighter type scale so the copy never runs under the buttons.
  const c = H < 760 ? compact : null;
  const [index, setIndex] = useState(0);
  const [campus, setCampus] = useState<string | null>(null);
  const listRef = useRef<FlatList<Page>>(null);
  const scrollX = useRef(new Animated.Value(0)).current;
  const indexRef = useRef(0);

  // Campus switched off by the admins: its page is left out, if the answer comes before the student reaches it.
  const [campusOff, setCampusOff] = useState(false);
  useEffect(() => {
    let alive = true;
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = setTimeout(() => ctl?.abort(), 6000);
    fetch(`${API_URL}/api/config/sections`, ctl ? { signal: ctl.signal } : undefined)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        // Home reads the same answer from the shared cache, so its Campus button is right from the first frame
        // (no button that shows and then disappears on a new install while Campus is switched off).
        if (j && typeof j === 'object' && j.sections) writeCache('/api/config/sections', j);
        if (alive && j?.sections?.campus?.live === false && indexRef.current < CAMPUS_PAGE) setCampusOff(true);
      })
      .catch(() => {})
      .finally(() => clearTimeout(timer));
    return () => { alive = false; clearTimeout(timer); ctl?.abort(); };
  }, []);
  const pages = campusOff ? PAGES.filter((p) => p.id !== 'campus') : PAGES;
  const last = pages.length - 1;
  const isLast = index === last;

  // Colleges' status (open / paused / soon); the server's defaults until it answers.
  const [statuses, setStatuses] = useState<Record<string, CampusStatus>>(DEFAULT_STATUS);
  useEffect(() => {
    let alive = true;
    fetch(`${API_URL}/api/config/campuses`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!alive || !Array.isArray(j?.campuses)) return;
        const next: Record<string, CampusStatus> = { ...DEFAULT_STATUS };
        for (const c of j.campuses) if (c && typeof c.key === 'string' && ['open', 'paused', 'soon'].includes(c.status)) next[c.key] = c.status;
        setStatuses(next);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // Show the college already chosen (e.g. at checkout on an earlier install of this session).
  useEffect(() => {
    AsyncStorage.getItem(CHECKOUT_CAMPUS_KEY).then((v) => { if (v) setCampus(v); }).catch(() => {});
  }, []);
  // A college that is not open yet is never the selection.
  const chosen = campus && statuses[campus] !== 'soon' ? campus : null;

  const pickCampus = (key: string) => {
    if (statuses[key] === 'soon') return;
    tick();
    setCampus(key);
    if (isCollegeKey(key)) setCollege(key);
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

  // Slow, continuous motion: the photo drifts (a gentle scale). None with reduce motion.
  const kb = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduceMotion) { kb.setValue(0); return undefined; }
    const a = Animated.loop(Animated.sequence([
      Animated.timing(kb, { toValue: 1, duration: KB_MS, easing: Easing.inOut(Easing.sin), useNativeDriver: ND }),
      Animated.timing(kb, { toValue: 0, duration: KB_MS, easing: Easing.inOut(Easing.sin), useNativeDriver: ND }),
    ]));
    a.start();
    return () => { a.stop(); };
  }, [reduceMotion, kb]);
  const kbScale = kb.interpolate({ inputRange: [0, 1], outputRange: [1.04, 1.1] });

  // Art space from the real space: the pager height minus the tallest copy block, so tall phones get more art
  // instead of an empty gap, and short phones never push the copy under the buttons.
  const [pagerH, setPagerH] = useState(0);
  const [headerH, setHeaderH] = useState(0);
  const [copyH, setCopyH] = useState<Record<string, number>>({});
  const clamp = (v: number, lo: number, hi: number) => Math.round(Math.max(lo, Math.min(hi, v)));
  const copyMax = Math.max(0, ...pages.slice(0, last).map((p) => copyH[p.id] || 0));
  const GAP = 10; // breathing room between the art and the copy
  const measured = pagerH > 0 && copyMax > 0;
  const artH = measured ? clamp(pagerH - copyMax - GAP, W * 0.3, W * 0.95) : Math.round(Math.min(W * 0.62, H * 0.3));
  const lastCopy = copyH[pages[last].id] || 0;
  const lastArtH = measured && lastCopy > 0 ? clamp(pagerH - lastCopy - GAP, W * 0.18, artH) : Math.round(artH * 0.55);
  const onCopyLayout = (id: string, h: number) => {
    setCopyH((prev) => (Math.abs((prev[id] || 0) - h) > 1 ? { ...prev, [id]: h } : prev));
  };
  // The backdrop covers the status bar, the header and the art space, and fades under the top of the copy.
  const backdropH = insets.top + headerH + artH + FADE;

  // The last page's copy (with the campus choice) starts higher: its photo is darkened behind the copy.
  const lastShade = scrollX.interpolate({ inputRange: [(last - 1) * W, last * W], outputRange: [0, 1], extrapolate: 'clamp' });
  const lastTop = insets.top + headerH + lastArtH;

  const renderPage = ({ item, index: i }: { item: Page; index: number }) => {
    const range = [(i - 1) * W, i * W, (i + 1) * W];
    const copyOpacity = scrollX.interpolate({ inputRange: [(i - 0.6) * W, i * W, (i + 0.6) * W], outputRange: [0, 1, 0], extrapolate: 'clamp' });
    const copyY = reduceMotion ? 0 : scrollX.interpolate({ inputRange: range, outputRange: [18, 0, 18], extrapolate: 'clamp' });
    const pageIsLast = i === last;

    return (
      <ScrollView
        style={{ width: W }}
        contentContainerStyle={[s.pageContent, { paddingTop: (pageIsLast ? lastArtH : artH) + GAP }]}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        <Animated.View
          style={{ opacity: copyOpacity, transform: [{ translateY: copyY }] }}
          onLayout={(e) => onCopyLayout(item.id, e.nativeEvent.layout.height)}
        >
          <View style={[s.tagRow, c?.tagRow]}>
            <Text style={s.tagNum}>{String(i + 1).padStart(2, '0')}</Text>
            <View style={s.tagRule} />
            <Text style={s.tagText} numberOfLines={1}>{item.tag.toUpperCase()}</Text>
          </View>
          <Text style={[s.title, c?.title]} accessibilityRole="header">
            {item.title}
            {'\n'}
            <Text style={s.titleAccent}>{item.accent}</Text>
          </Text>
          <Text style={[s.line, c?.line]}>{item.line}</Text>

          <View style={[s.features, c?.features]}>
            {item.features.map((f, k) => (
              <View key={f.text} style={[s.featureRow, c?.featureRow, k > 0 && s.featureDivider]}>
                <LinearGradient
                  colors={['rgba(240,210,122,0.22)', 'rgba(212,175,55,0.06)']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={s.featureIcon}
                >
                  <Ionicons name={f.icon} size={16} color="#E9C766" />
                </LinearGradient>
                <Text style={[s.featureText, c?.featureText]}>{f.text}</Text>
                <Text style={s.featureWhere}>{f.where.toUpperCase()}</Text>
              </View>
            ))}
          </View>

          {pageIsLast && (
            <View style={s.campusBlock}>
              <Text style={s.campusTitle}>Choose your college</Text>
              <View style={s.campusRow}>
                {CAMPUSES.map((c) => {
                  const st = statuses[c.key] || 'open';
                  const soon = st === 'soon';
                  const on = chosen === c.key;
                  return (
                    <TouchableOpacity
                      key={c.key}
                      onPress={() => pickCampus(c.key)}
                      disabled={soon}
                      activeOpacity={0.85}
                      style={[s.campusCard, on && s.campusCardOn, soon && s.campusCardSoon]}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: on, checked: on, disabled: soon }}
                      accessibilityLabel={`${c.label}, ${c.sub}${soon ? ', coming soon' : st === 'paused' ? ', ordering paused for now' : ''}`}
                    >
                      {soon ? (
                        <View style={s.soonPill}><Text style={s.soonText}>SOON</Text></View>
                      ) : (
                        <Ionicons
                          name={on ? 'checkmark-circle' : 'ellipse-outline'}
                          size={18}
                          color={on ? GOLD : 'rgba(255,255,255,0.28)'}
                          style={s.campusCheck}
                        />
                      )}
                      <Text style={[s.campusName, on && { color: '#FFF6DC' }]}>{c.label}</Text>
                      <Text style={s.campusSub} numberOfLines={2}>{soon ? 'Coming soon' : st === 'paused' ? 'Paused for now' : c.sub}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={s.campusNote}>Your college is your default for delivery and stores. You can change it any time.</Text>
            </View>
          )}
        </Animated.View>
      </ScrollView>
    );
  };

  // Progress: faint gold dots, and one gold pill that slides to the active page and stretches mid-swipe.
  const pillX = scrollX.interpolate({ inputRange: [0, Math.max(1, last) * W], outputRange: [0, last * DOT_STEP], extrapolate: 'clamp' });
  const stretchIn: number[] = [];
  const stretchOut: number[] = [];
  pages.forEach((_, i) => {
    stretchIn.push(i * W);
    stretchOut.push(1);
    if (i < last) { stretchIn.push((i + 0.5) * W); stretchOut.push(reduceMotion ? 1 : 1.7); }
  });
  const pillStretch = scrollX.interpolate({ inputRange: stretchIn, outputRange: stretchOut, extrapolate: 'clamp' });
  const dotsW = last * DOT_STEP + PILL;

  return (
    <View style={s.screen}>
      {/* ── Backdrop: one layer per page, cross-faded and drifting with the swipe ── */}
      <View style={[s.backdrop, { height: backdropH }]} pointerEvents="none">
        {pages.map((p, i) => {
          const range = [(i - 1) * W, i * W, (i + 1) * W];
          const opacity = scrollX.interpolate({ inputRange: range, outputRange: [0, 1, 0], extrapolate: 'clamp' });
          const tx = reduceMotion ? 0 : scrollX.interpolate({ inputRange: range, outputRange: [W * 0.14, 0, -W * 0.14], extrapolate: 'clamp' });
          return (
            <Animated.View key={p.id} style={[StyleSheet.absoluteFill, { opacity }]}>
              <Animated.View style={[s.coverPhoto, { left: -W * 0.16, right: -W * 0.16, transform: [{ translateX: tx }, { scale: kbScale }] }]}>
                <Image source={p.art} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
              </Animated.View>
              {/* warm page tint, low and soft */}
              <LinearGradient colors={['rgba(0,0,0,0)', `${p.glow}26`]} locations={[0.45, 1]} style={StyleSheet.absoluteFill} />
            </Animated.View>
          );
        })}
        {/* legibility: darker behind the status bar and header, then a long fade into the page */}
        <LinearGradient colors={['rgba(10,10,11,0.82)', 'rgba(10,10,11,0.28)', 'rgba(10,10,11,0)']} locations={[0, 0.6, 1]} style={[s.topShade, { height: insets.top + headerH + 48 }]} />
        {/* The fade ends in a plain solid strip: a gradient's dithering (or the drifting photo's last row) never
            leaves a visible line where the backdrop meets the page. */}
        <LinearGradient
          colors={['rgba(10,10,11,0)', 'rgba(10,10,11,0.62)', BG]}
          locations={[0, 0.55, 1]}
          style={[s.bottomFade, { bottom: EDGE, height: Math.min(backdropH, artH * 0.55 + FADE) - EDGE }]}
        />
        <View style={[s.bottomFade, { height: EDGE, backgroundColor: BG }]} />
        <Animated.View style={[s.lastShade, { top: Math.max(0, lastTop - 40), opacity: lastShade }]}>
          <LinearGradient colors={['rgba(10,10,11,0)', BG]} locations={[0, 0.45]} style={StyleSheet.absoluteFill} />
        </Animated.View>
      </View>

      <SafeAreaView style={s.safe} edges={['top', 'bottom', 'left', 'right']}>
        {/* Header: the ZenWe badge + Skip (always visible) */}
        <View style={s.header} onLayout={(e) => setHeaderH(Math.round(e.nativeEvent.layout.height))}>
          <View style={s.brandRow} accessible accessibilityLabel="ZenWe">
            <ZenvBadge size={36} />
            <View style={s.brandText}>
              <Text allowFontScaling={false} style={s.brand}>ZenWe</Text>
            </View>
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
          data={pages}
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
          extraData={`${W}-${campus}-${reduceMotion}-${artH}-${lastArtH}-${pages.length}-${statuses.srmap}${statuses.vitap}${statuses.amrita}`}
          onLayout={(e) => setPagerH(e.nativeEvent.layout.height)}
          style={s.pager}
        />

        {/* Bottom: progress, Back + Next / Get started, Sign in */}
        <View style={s.bottom}>
          <View
            style={[s.dots, { width: dotsW }]}
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel={`Page ${index + 1} of ${pages.length}`}
          >
            {pages.map((p, i) => (
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
              style={s.primaryWrap}
              onPress={() => (isLast ? finish('/register') : goTo(index + 1))}
              activeOpacity={0.88}
              accessibilityRole="button"
              accessibilityLabel={isLast ? 'Get started' : 'Next'}
            >
              <LinearGradient colors={['#F2D47E', '#D9B04A', '#B98A2C']} locations={[0, 0.55, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.primary}>
                <View style={s.primarySheen} />
                <Text style={s.primaryText}>{isLast ? 'Get started' : 'Next'}</Text>
                {!isLast && <Ionicons name="arrow-forward" size={18} color={BG} style={{ marginLeft: 6 }} />}
              </LinearGradient>
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

const compact = StyleSheet.create({
  tagRow: { marginBottom: 7 },
  title: { fontSize: 26, lineHeight: 30 },
  line: { fontSize: 13.5, lineHeight: 19, marginTop: 7 },
  features: { marginTop: 12 },
  featureRow: { paddingVertical: 8 },
  featureText: { fontSize: 13.5, lineHeight: 18 },
});

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  safe: { flex: 1 },

  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, overflow: 'hidden' },
  coverPhoto: { position: 'absolute', top: 0, bottom: 0 },
  topShade: { position: 'absolute', top: 0, left: 0, right: 0 },
  bottomFade: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  lastShade: { position: 'absolute', left: 0, right: 0, bottom: 0 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SIDE,
    paddingTop: 8,
    paddingBottom: 10,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center' },
  brandText: { marginLeft: 10 },
  brand: { ...BRAND_FONT, color: '#E2C26E', fontSize: 18, letterSpacing: 3 },
  skip: {
    paddingHorizontal: 15,
    paddingVertical: 7,
    borderRadius: 18,
    backgroundColor: 'rgba(10,10,11,0.42)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  skipText: { color: TEXT, fontSize: 13, fontWeight: '500' },

  pager: { flex: 1 },
  pageContent: { paddingHorizontal: SIDE, paddingBottom: 10 },

  tagRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  tagNum: { color: GOLD, fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  tagRule: { width: 22, height: StyleSheet.hairlineWidth * 2, backgroundColor: 'rgba(212,175,55,0.6)', marginHorizontal: 10 },
  tagText: { flex: 1, color: 'rgba(235,211,154,0.9)', fontSize: 11.5, fontWeight: '600', letterSpacing: 1.6 },

  title: { color: TEXT, fontSize: 30, fontWeight: '700', lineHeight: 35, letterSpacing: -0.4 },
  titleAccent: { color: '#E6C36A', fontWeight: '600' },
  line: { color: MUTED, fontSize: 14.5, fontWeight: '400', lineHeight: 21, marginTop: 10 },

  features: {
    marginTop: 18,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.035)',
    borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.14)',
    paddingHorizontal: 14,
  },
  featureRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11 },
  featureDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.08)' },
  featureIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(233,199,102,0.32)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  featureText: { flex: 1, color: '#EEE9DE', fontSize: 14, fontWeight: '500', lineHeight: 19 },
  featureWhere: { color: 'rgba(255,255,255,0.4)', fontSize: 10.5, fontWeight: '600', letterSpacing: 1, marginLeft: 8 },

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
  campusCardSoon: { opacity: 0.55 },
  soonPill: { position: 'absolute', top: 9, right: 9, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(212,175,55,0.45)' },
  soonText: { color: '#E6C36A', fontSize: 9, fontWeight: '700', letterSpacing: 1 },
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
  primaryWrap: {
    flex: 1,
    height: 52,
    borderRadius: 16,
    shadowColor: '#D4AF37',
    shadowOpacity: 0.28,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  primary: {
    flex: 1,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  primarySheen: { position: 'absolute', top: 0, left: 0, right: 0, height: '48%', backgroundColor: 'rgba(255,255,255,0.14)' },
  primaryText: { color: BG, fontSize: 15.5, fontWeight: '700', letterSpacing: 0.2 },

  signInRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 14, gap: 6 },
  signInPrompt: { color: 'rgba(255,255,255,0.5)', fontSize: 13 },
  signIn: { color: '#E6C770', fontSize: 13, fontWeight: '600' },
});
