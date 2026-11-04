/**
 * Home hero carousel — "Zippy's Campus Day".
 *
 * Nine real Zenvy features (every CTA routes to a screen that exists) plus up to three
 * admin-featured restaurants (real fields only). Finger-following paging with a peek of the
 * next card, seamless wrap-around via cloned ends, auto-advance that pauses on touch / blur /
 * background, scroll-driven parallax + Zippy squash, and a scroll-interpolated "Zippy track"
 * pagination. All art lives in ./promo/FunnyPromoArt.
 */
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityActionEvent,
  AccessibilityInfo,
  Animated,
  AppState,
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useIsFocused, useRouter } from 'expo-router';
import { useTheme } from '../context/ThemeContext';
import { artForType, CARD_H, ZippySquashContext } from './promo/FunnyPromoArt';
import { featuredLabel } from '../utils/promoLabel';
import { storeEtaMins } from '../utils/storeEta';

export interface PromoSlide {
  id: string;
  type:
    | 'food'
    | 'tracking'
    | 'kirana'
    | 'print'
    | 'rewards'
    | 'gold'
    | 'biryani'
    | 'kfc'
    | 'afterdark'
    | 'campus'
    | 'ride'
    | 'stays'
    | 'express'
    | 'featured_restaurant'
    | 'custom';
  tagline: string;
  title1: string;
  title2: string;
  description: string;
  buttonText: string;
  imageUrl?: string;
  accentColor?: string;
  restaurantId?: string;
  /** Only ever set from real restaurant data. */
  rating?: number;
  /** Only ever set from real restaurant data. */
  time?: string;
  /** Only true when the restaurant explicitly reports isOpenNow === false. */
  closed?: boolean;
  redirectAction?: () => void;
}

interface HighClassPromoCarouselProps {
  slides?: PromoSlide[];
  featuredRestaurants?: any[];
  onSelectRestaurant?: (id: string) => void;
  onSelectSlide?: (slide: PromoSlide) => void;
  /** False while the carousel is scrolled off-screen: auto-advance and card animations pause. */
  visible?: boolean;
  /** Slide ids to leave out (sections switched off in /api/config/sections, e.g. 'ride'). */
  hiddenSlideIds?: string[];
}

const GAP = 10;
const PAD_LEFT = 16;
const SHADOW_PAD_TOP = 4;
const SHADOW_PAD_BOTTOM = 16;
const AUTO_MS = 4500;
const AUTO_MS_REDUCED = 9000;
const RESUME_MS = 2500;
const DOT = 6;
const DOT_GAP = 6;
const DOT_STEP = DOT + DOT_GAP;
const IS_WEB = Platform.OS === 'web';

function mixHex(a: string, b: string, weightB: number) {
  const p = (h: string) => {
    const x = h.replace('#', '');
    return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16));
  };
  const [ca, cb] = [p(a), p(b)];
  const out = ca.map((v, i) => Math.round(v * (1 - weightB) + cb[i] * weightB));
  return `#${out.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function hapticSelect() {
  if (IS_WEB) return;
  Haptics.selectionAsync().catch(() => {});
}

function hapticLight() {
  if (IS_WEB) return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

function useReduceMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => mounted && setReduce(!!v))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v: boolean) => setReduce(!!v));
    let mq: any = null;
    const onChange = (ev: any) => setReduce(!!ev?.matches);
    if (IS_WEB && typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      if (mq?.matches) setReduce(true);
      mq?.addEventListener?.('change', onChange);
    }
    return () => {
      mounted = false;
      sub?.remove?.();
      mq?.removeEventListener?.('change', onChange);
    };
  }, []);
  return reduce;
}

function useAppActive() {
  const [activeApp, setActiveApp] = useState(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setActiveApp(s === 'active'));
    return () => sub.remove();
  }, []);
  return activeApp;
}

// ─────────────────────────────────────────────────────────────────────────────
// One card
// ─────────────────────────────────────────────────────────────────────────────

interface CardProps {
  slide: PromoSlide;
  index: number;
  S: number;
  cardW: number;
  scrollX: Animated.Value;
  active: boolean;
  reduceMotion: boolean;
  isDark: boolean;
  onAction: (slide: PromoSlide) => void;
  onHold: () => void;
  onRelease: () => void;
}

const PromoCard = memo(function PromoCard({
  slide,
  index,
  S,
  cardW,
  scrollX,
  active,
  reduceMotion,
  isDark,
  onAction,
  onHold,
  onRelease,
}: CardProps) {
  const accent = slide.accentColor || '#F97316';
  const Art = artForType(slide.type);

  // Scroll-position driven (native) — follows the finger, costs no JS.
  const drive = useMemo(() => {
    if (reduceMotion || !S) return null;
    const inputRange = [(index - 1) * S, index * S, (index + 1) * S];
    const ip = (out: number[]) => scrollX.interpolate({ inputRange, outputRange: out, extrapolate: 'clamp' });
    return {
      cardScale: ip([0.94, 1, 0.94]),
      artX: ip([48, 0, -48]),
      textO: ip([0.35, 1, 0.35]),
      textX: ip([14, 0, -14]),
      sx: ip([1.18, 1, 1.18]),
      sy: ip([0.86, 1, 0.86]),
      // -1 (next) … 0 (settled) … 1 (previous): drives per-layer depth parallax inside the art.
      p: ip([-1, 0, 1]),
    };
  }, [reduceMotion, S, index, scrollX]);
  const squash = useMemo(() => (drive ? { sx: drive.sx, sy: drive.sy, p: drive.p } : {}), [drive]);

  // Title "stamp" when the card settles.
  const stamp = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!active || reduceMotion) {
      stamp.setValue(1);
      return;
    }
    stamp.setValue(1.12);
    // Real spring (mass/stiffness/damping): lands with a small natural undershoot and settles.
    const a = Animated.spring(stamp, { toValue: 1, stiffness: 420, damping: 15, mass: 0.7, useNativeDriver: true });
    a.start();
    return () => a.stop();
  }, [active, reduceMotion, stamp]);

  // CTA spring press
  const press = useRef(new Animated.Value(1)).current;
  const pressTo = (v: number) =>
    Animated.spring(press, { toValue: v, stiffness: 380, damping: 17, mass: 0.6, useNativeDriver: true }).start();

  // Type: fixed scale, sized to the longest title so both lines match and fit (also on web,
  // where adjustsFontSizeToFit is a no-op).
  const colW = Math.round(cardW * 0.58);
  const longest = Math.max(slide.title1.length, slide.title2.length, 8);
  const titleFs = Math.max(15, Math.min(22, Math.floor(colW / (longest * 0.6))));
  const titleLh = Math.round(titleFs * 1.18);
  const isFeatured = slide.type === 'featured_restaurant';
  const chips: { label: string; muted?: boolean }[] = [];
  if (isFeatured) {
    if (typeof slide.rating === 'number' && slide.rating > 0) chips.push({ label: `★ ${slide.rating.toFixed(1)}` });
    if (slide.time) chips.push({ label: slide.time });
    if (slide.closed) chips.push({ label: 'Closed now', muted: true });
  }
  const ctaLabel = slide.buttonText;
  const a11yLabel = `${ctaLabel.replace(' →', '').replace('→', '').trim()}. ${slide.title1} ${slide.title2}`;

  const shadow = isDark
    ? { shadowColor: '#000', shadowOpacity: 0.45, shadowOffset: { width: 0, height: 8 }, shadowRadius: 14 }
    // Light mode: a neutral soft lift (no coloured glow), like every other light-mode card
    : { shadowColor: '#000', shadowOpacity: 0.12, shadowOffset: { width: 0, height: 6 }, shadowRadius: 16 };

  return (
    <Animated.View
      style={[
        styles.cardOuter,
        shadow,
        { width: cardW, marginRight: GAP },
        drive ? { transform: [{ scale: drive.cardScale }] } : null,
      ]}
    >
      <Pressable accessible={false} onPress={() => onAction(slide)} style={styles.cardInner}>
        <LinearGradient
          colors={['#0E0E14', mixHex(accent, '#0E0E14', 0.82)]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <View pointerEvents="none" style={[styles.accentWash, { backgroundColor: accent }]} />
        <LinearGradient
          pointerEvents="none"
          colors={['rgba(255,255,255,0.07)', 'rgba(255,255,255,0)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 0.6, y: 0.6 }}
          style={StyleSheet.absoluteFill}
        />

        {/* ART */}
        <Animated.View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[StyleSheet.absoluteFill, drive ? { transform: [{ translateX: drive.artX }] } : null]}
        >
          <ZippySquashContext.Provider value={squash}>
            <Art active={active} size={cardW} reduceMotion={reduceMotion} imageUrl={slide.imageUrl} />
          </ZippySquashContext.Provider>
        </Animated.View>

        {/* COPY */}
        <Animated.View
          pointerEvents="box-none"
          style={[
            styles.textCol,
            { width: colW },
            drive ? { opacity: drive.textO, transform: [{ translateX: drive.textX }] } : null,
          ]}
        >
          <Text numberOfLines={1} style={[styles.tagline, { color: accent }]}>
            {slide.tagline}
          </Text>
          <Animated.Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.78}
            style={[styles.title1, { fontSize: titleFs, lineHeight: titleLh, transform: [{ scale: stamp }] }]}
          >
            {slide.title1}
          </Animated.Text>
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.78}
            style={[styles.title2, { color: accent, fontSize: titleFs, lineHeight: titleLh }]}
          >
            {slide.title2}
          </Text>
          <Text numberOfLines={isFeatured ? 1 : 3} style={styles.description}>
            {slide.description}
          </Text>
          {chips.length > 0 ? (
            <View style={styles.chipRow}>
              {chips.map((c) => (
                <View key={c.label} style={[styles.chip, c.muted && styles.chipMuted]}>
                  <Text style={[styles.chipText, c.muted && { color: 'rgba(255,255,255,0.6)' }]}>{c.label}</Text>
                </View>
              ))}
            </View>
          ) : null}

          <Animated.View style={[styles.ctaWrap, { transform: [{ scale: press }] }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={a11yLabel}
              hitSlop={6}
              onPressIn={() => {
                onHold();
                pressTo(0.94);
              }}
              onPressOut={() => {
                pressTo(1);
                onRelease();
              }}
              onPress={() => {
                hapticLight();
                onAction(slide);
              }}
              style={[styles.cta, { backgroundColor: accent }]}
            >
              <Text numberOfLines={1} style={styles.ctaText}>
                {ctaLabel}
              </Text>
            </Pressable>
          </Animated.View>
        </Animated.View>

        <View pointerEvents="none" style={styles.innerBorder} />
      </Pressable>
    </Animated.View>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Carousel
// ─────────────────────────────────────────────────────────────────────────────

export default function HighClassPromoCarousel({
  slides: customSlides,
  featuredRestaurants = [],
  onSelectRestaurant,
  onSelectSlide,
  visible = true,
  hiddenSlideIds,
}: HighClassPromoCarouselProps) {
  const router = useRouter();
  const { isDark } = useTheme();
  const screenFocused = useIsFocused();
  // "Focused" here = on screen: tab focused AND not scrolled out of view
  const isFocused = screenFocused && visible;
  const appActive = useAppActive();
  const reduceMotion = useReduceMotion();

  // Parent passes inline callbacks; keep the slide list stable by reading them through refs.
  const selectSlideRef = useRef(onSelectSlide);
  const selectRestaurantRef = useRef(onSelectRestaurant);
  selectSlideRef.current = onSelectSlide;
  selectRestaurantRef.current = onSelectRestaurant;

  const slides: PromoSlide[] = useMemo(() => {
    if (customSlides && customSlides.length > 0) return customSlides;

    const tour: PromoSlide[] = [
      {
        id: 'food',
        type: 'food',
        tagline: '🍛 Mess menu again',
        title1: 'Skip the mess',
        title2: 'tonight.',
        description: 'Biryani, rolls and meals from kitchens near campus. Cash or Wallet.',
        buttonText: 'Order food',
        accentColor: '#F97316',
        // index.tsx: 'free-cash' → scrollToGrid() (the restaurant grid on Home)
        redirectAction: () => selectSlideRef.current?.({ ...tour[0], id: 'free-cash' }),
      },
      {
        id: 'tracking',
        type: 'tracking',
        tagline: '📍 Live tracking',
        title1: 'See where your',
        title2: 'order is.',
        description: 'An alert when it reaches the gate. Share the PIN only with the rider.',
        buttonText: 'Track orders',
        accentColor: '#22C55E',
        redirectAction: () => router.push('/(tabs)/orders' as any),
      },
      {
        id: 'ride',
        type: 'ride',
        tagline: '🏍️ Co-ride',
        title1: 'Class at 8,',
        title2: 'still in the room?',
        description: 'Share a bike or auto with someone going your way. The rider decides who joins.',
        buttonText: 'Find a ride',
        accentColor: '#22D3EE',
        redirectAction: () => router.push({ pathname: '/(tabs)/others', params: { tab: 'rides' } } as any),
      },
      {
        id: 'campus-buddy',
        type: 'campus',
        tagline: '🎓 Campus',
        title1: 'Missed class?',
        title2: 'Ask your batch.',
        description: 'Class groups, polls and chats with your batch.',
        buttonText: 'Open Campus',
        accentColor: '#A78BFA',
        redirectAction: () => router.push('/friends' as any),
      },
      {
        id: 'stays',
        type: 'stays',
        tagline: '🏠 PG stays',
        title1: 'Looking for a room',
        title2: 'near campus?',
        description: 'See rooms, rent, mess menu and photos, then send a booking request.',
        buttonText: 'See PGs',
        accentColor: '#34D399',
        redirectAction: () => router.push({ pathname: '/(tabs)/others', params: { tab: 'stays' } } as any),
      },
      {
        id: 'kirana',
        type: 'kirana',
        tagline: '🍜 Groceries',
        title1: 'Out of',
        title2: 'Maggi?',
        description: 'Snacks, noodles, drinks and daily needs from shops near you.',
        buttonText: 'Shop groceries',
        accentColor: '#EAB308',
        // The Groceries tab (shops, weights, real catalogue); the old /category page skipped weight choices.
        redirectAction: () => router.push({ pathname: '/(tabs)/others', params: { tab: 'food' } } as any),
      },
      {
        id: 'rewards',
        type: 'rewards',
        tagline: '🎡 Rewards',
        title1: 'Every 2 orders',
        title2: '= 1 spin.',
        description: 'Win ZENV Points or free delivery.',
        buttonText: 'See rewards',
        accentColor: '#F43F5E',
        redirectAction: () => router.push('/rewards' as any),
      },
    ];

    // Admin-featured restaurants — real fields only, no invented offers/ratings/times.
    const featured: PromoSlide[] = (featuredRestaurants || [])
      .filter((r: any) => r && r.isFeatured && (r.imageUrl || r.image))
      .slice(0, 3)
      .map((r: any) => {
        const id = String(r._id || r.id);
        const rating = Number(r.rating);
        const dt = storeEtaMins(r) || 0;
        const promo = typeof r.promoOffer === 'string' && r.promoOffer.trim() ? r.promoOffer.trim() : 'On ZENV now.';
        return {
          id: `feat-${id}`,
          type: 'featured_restaurant' as const,
          tagline: featuredLabel(r) || 'Featured',
          title1: String(r.name || 'Featured kitchen'),
          title2: promo,
          description: r.location ? `From ${r.location}` : 'Tap to see the full menu.',
          buttonText: 'View menu',
          imageUrl: r.imageUrl || r.image,
          restaurantId: id,
          rating: rating > 0 ? rating : undefined,
          time: Number.isInteger(dt) && dt > 0 ? `${dt} min` : undefined,
          closed: typeof r.isOpen === 'boolean' ? !r.isOpen : r.isOpenNow === false,
          accentColor: '#F59E0B',
          redirectAction: () => selectRestaurantRef.current?.(id),
        };
      });

    const hidden = hiddenSlideIds && hiddenSlideIds.length ? new Set(hiddenSlideIds) : null;
    return [...(hidden ? tour.filter((t) => !hidden.has(t.id)) : tour), ...featured];
  }, [customSlides, featuredRestaurants, router, hiddenSlideIds]);

  const n = slides.length;
  const loop = n > 1;
  const data = useMemo(() => (loop ? [slides[n - 1], ...slides, slides[0]] : slides), [slides, loop, n]);
  const realOf = useCallback((k: number) => (loop ? (k - 1 + n) % n : k), [loop, n]);

  const [width, setWidth] = useState(0);
  const cardW = Math.max(0, width - 48);
  // 0 until measured, so no auto-advance/settle runs against a zero-width layout.
  const S = cardW > 0 ? cardW + GAP : 0;

  const scrollX = useRef(new Animated.Value(0)).current;
  const listRef = useRef<any>(null);
  const [activeIdx, setActiveIdx] = useState(loop ? 1 : 0);
  const activeRef = useRef(activeIdx);
  const [paused, setPaused] = useState(false);
  const draggingRef = useRef(false);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoFallback = useRef<ReturnType<typeof setTimeout> | null>(null);
  const webSettleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastWebX = useRef(0);

  const scrollTo = useCallback((offset: number, animated: boolean) => {
    listRef.current?.scrollToOffset?.({ offset, animated });
  }, []);

  const settle = useCallback(
    (x: number, fromUser: boolean) => {
      if (!S || data.length === 0) return;
      let idx = Math.min(data.length - 1, Math.max(0, Math.round(x / S)));
      if (loop && idx === 0) {
        idx = n;
        scrollTo(n * S, false);
      } else if (loop && idx === n + 1) {
        idx = 1;
        scrollTo(S, false);
      } else if (IS_WEB && Math.abs(x - idx * S) > 2) {
        scrollTo(idx * S, true); // web: enforce the snap if CSS snapping did not
      }
      if (idx !== activeRef.current) {
        activeRef.current = idx;
        setActiveIdx(idx);
        if (fromUser) hapticSelect();
      }
    },
    [S, data.length, loop, n, scrollTo],
  );
  const settleRef = useRef(settle);
  settleRef.current = settle;

  const hold = useCallback(() => {
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    if (autoFallback.current) clearTimeout(autoFallback.current);
    setPaused(true);
  }, []);
  const release = useCallback(() => {
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    resumeTimer.current = setTimeout(() => setPaused(false), RESUME_MS);
  }, []);

  useEffect(
    () => () => {
      [resumeTimer, autoFallback, webSettleTimer].forEach((r) => r.current && clearTimeout(r.current));
    },
    [],
  );

  // Keep position correct on resize / data changes (e.g. featured restaurants arriving).
  const prevN = useRef(n);
  useEffect(() => {
    if (!S) return;
    let idx = activeRef.current;
    if (prevN.current !== n) {
      const prevLoop = prevN.current > 1;
      const real = prevLoop ? (idx - 1 + prevN.current) % prevN.current : idx;
      idx = Math.min(n - 1, Math.max(0, real)) + (loop ? 1 : 0);
      prevN.current = n;
    }
    if (idx !== activeRef.current) {
      activeRef.current = idx;
      setActiveIdx(idx);
    }
    scrollTo(idx * S, false);
  }, [S, n, loop, scrollTo]);

  // Auto-advance (setTimeout chain). Never haptic.
  useEffect(() => {
    if (!loop || !S || paused || !isFocused || !appActive) return;
    const target = activeIdx + 1;
    const id = setTimeout(() => {
      draggingRef.current = false;
      scrollTo(target * S, true);
      if (autoFallback.current) clearTimeout(autoFallback.current);
      // Some platforms do not emit onMomentumScrollEnd for programmatic scrolls.
      autoFallback.current = setTimeout(() => settleRef.current(target * S, false), 650);
    }, reduceMotion ? AUTO_MS_REDUCED : AUTO_MS);
    return () => clearTimeout(id);
  }, [activeIdx, paused, isFocused, appActive, reduceMotion, S, loop, scrollTo]);

  const onScroll = useMemo(
    () =>
      Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
        useNativeDriver: !IS_WEB,
        listener: IS_WEB
          ? (ev: NativeSyntheticEvent<NativeScrollEvent>) => {
              lastWebX.current = ev.nativeEvent.contentOffset.x;
              if (webSettleTimer.current) clearTimeout(webSettleTimer.current);
              webSettleTimer.current = setTimeout(() => settleRef.current(lastWebX.current, false), 140);
            }
          : undefined,
      }),
    [scrollX],
  );

  const goTo = useCallback(
    (real: number) => {
      if (!S) return;
      hold();
      hapticSelect();
      scrollTo((loop ? real + 1 : real) * S, true);
      if (autoFallback.current) clearTimeout(autoFallback.current);
      autoFallback.current = setTimeout(() => settleRef.current((loop ? real + 1 : real) * S, false), 650);
      release();
    },
    [S, loop, hold, release, scrollTo],
  );

  const onA11yAction = useCallback(
    (ev: AccessibilityActionEvent) => {
      const real = realOf(activeRef.current);
      if (ev.nativeEvent.actionName === 'increment') goTo((real + 1) % n);
      if (ev.nativeEvent.actionName === 'decrement') goTo((real - 1 + n) % n);
      // The adjustable container hides the cards' CTA from screen readers; double-tap opens the slide.
      if (ev.nativeEvent.actionName === 'activate' && slides[real]) onActionRef.current(slides[real]);
    },
    [goTo, realOf, n, slides],
  );

  const onAction = useCallback(
    (slide: PromoSlide) => {
      if (slide.redirectAction) slide.redirectAction();
      else selectSlideRef.current?.(slide);
    },
    [],
  );
  const onActionRef = useRef(onAction);
  onActionRef.current = onAction;

  // "Zippy track" pagination: one stretchy indicator driven by scroll offset.
  const indicator = useMemo(() => {
    if (!S || n <= 1) return null;
    const input: number[] = [];
    const tx: number[] = [];
    const sc: number[] = [];
    const ops: number[][] = slides.map(() => []);
    const pos = (k: number) => realOf(k) * DOT_STEP - 5;
    for (let k = 0; k < data.length; k++) {
      input.push(k * S);
      tx.push(pos(k));
      sc.push(1);
      ops.forEach((o, i) => o.push(realOf(k) === i ? 1 : 0));
      if (k < data.length - 1) {
        input.push((k + 0.5) * S);
        tx.push((pos(k) + pos(k + 1)) / 2);
        sc.push(1.6);
        ops.forEach((o, i) => o.push(((realOf(k) === i ? 1 : 0) + (realOf(k + 1) === i ? 1 : 0)) / 2));
      }
    }
    const ip = (out: number[]) => scrollX.interpolate({ inputRange: input, outputRange: out, extrapolate: 'clamp' });
    return { x: ip(tx), s: ip(sc), o: ops.map((o) => ip(o)) };
  }, [S, n, data.length, slides, realOf, scrollX]);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    setWidth((prev) => (Math.abs(prev - w) > 1 ? w : prev));
  }, []);

  if (n === 0) return null;

  const listH = CARD_H + SHADOW_PAD_TOP + SHADOW_PAD_BOTTOM;
  const realActive = realOf(activeIdx);
  const rowW = n * DOT_STEP - DOT_GAP;

  return (
    <View
      style={styles.outer}
      onLayout={onLayout}
      accessible={n > 1}
      accessibilityRole={n > 1 ? 'adjustable' : undefined}
      accessibilityLabel={
        n > 1
          ? `ZENV highlights, slide ${realActive + 1} of ${n}: ${slides[realActive]?.title1 ?? ''} ${slides[realActive]?.title2 ?? ''}. ${(slides[realActive]?.buttonText ?? '').replace('→', '').trim()}`
          : undefined
      }
      accessibilityHint={n > 1 ? 'Swipe up or down to change slide. Double tap to open.' : undefined}
      accessibilityActions={n > 1 ? [{ name: 'increment' }, { name: 'decrement' }, { name: 'activate' }] : undefined}
      onAccessibilityAction={n > 1 ? onA11yAction : undefined}
    >
      {width > 0 ? (
        <Animated.FlatList
          ref={listRef}
          data={data}
          horizontal
          keyExtractor={(item: PromoSlide, i: number) => `${item.id}-${i}`}
          renderItem={({ item, index }: { item: PromoSlide; index: number }) => (
            <PromoCard
              slide={item}
              index={index}
              S={S}
              cardW={cardW}
              scrollX={scrollX}
              active={index === activeIdx && isFocused && appActive}
              reduceMotion={reduceMotion}
              isDark={isDark}
              onAction={onAction}
              onHold={hold}
              onRelease={release}
            />
          )}
          extraData={`${activeIdx}|${reduceMotion}|${isDark}|${isFocused}|${appActive}|${S}`}
          getItemLayout={(_: unknown, index: number) => ({ length: S, offset: S * index, index })}
          initialScrollIndex={loop ? 1 : 0}
          showsHorizontalScrollIndicator={false}
          snapToInterval={S}
          snapToAlignment="start"
          decelerationRate="fast"
          disableIntervalMomentum
          scrollEventThrottle={16}
          onScroll={onScroll}
          onTouchStart={hold}
          onTouchEnd={release}
          onTouchCancel={release}
          onScrollBeginDrag={() => {
            draggingRef.current = true;
            hold();
          }}
          onScrollEndDrag={release}
          onMomentumScrollEnd={(ev: NativeSyntheticEvent<NativeScrollEvent>) => {
            if (autoFallback.current) clearTimeout(autoFallback.current);
            settle(ev.nativeEvent.contentOffset.x, draggingRef.current);
            draggingRef.current = false;
            release();
          }}
          windowSize={3}
          initialNumToRender={3}
          maxToRenderPerBatch={3}
          removeClippedSubviews={Platform.OS === 'android'}
          style={{ height: listH }}
          contentContainerStyle={{
            paddingLeft: PAD_LEFT,
            paddingRight: PAD_LEFT + 2 * GAP + 16,
            paddingTop: SHADOW_PAD_TOP,
            paddingBottom: SHADOW_PAD_BOTTOM,
          }}
        />
      ) : (
        <View style={{ height: listH }} />
      )}

      {n > 1 && indicator ? (
        <View style={styles.dotsWrap}>
          <View style={{ width: rowW, height: DOT }}>
            <View style={styles.dotsRow}>
              {slides.map((s, i) => (
                <Pressable
                  key={`${s.id}-dot`}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Slide ${i + 1} of ${n}`}
                  onPress={() => goTo(i)}
                  style={[
                    styles.dot,
                    { marginRight: i === n - 1 ? 0 : DOT_GAP, backgroundColor: isDark ? 'rgba(255,255,255,0.22)' : 'rgba(15,15,20,0.18)' },
                  ]}
                />
              ))}
            </View>
            <Animated.View
              pointerEvents="none"
              style={[styles.indicator, { transform: [{ translateX: indicator.x }, { scaleX: indicator.s }] }]}
            >
              {slides.map((s, i) => (
                <Animated.View
                  key={`${s.id}-pill`}
                  style={[StyleSheet.absoluteFill, { borderRadius: 3, backgroundColor: s.accentColor || '#F97316', opacity: indicator.o[i] }]}
                />
              ))}
              <View style={[styles.indicatorEye, { left: 5.5 }]} />
              <View style={[styles.indicatorEye, { left: 9.5 }]} />
            </Animated.View>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    marginTop: 4,
    marginBottom: 6,
  },
  cardOuter: {
    height: CARD_H,
    borderRadius: 22,
    backgroundColor: '#0E0E14',
    elevation: 8,
  },
  cardInner: {
    flex: 1,
    borderRadius: 22,
    overflow: 'hidden',
  },
  accentWash: {
    position: 'absolute',
    right: -70,
    top: -80,
    width: 240,
    height: 240,
    borderRadius: 120,
    opacity: 0.1,
  },
  innerBorder: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  textCol: {
    position: 'absolute',
    left: 18,
    top: 18,
    bottom: 16,
  },
  tagline: {
    fontSize: 12,
    lineHeight: 15,
    fontWeight: '800',
    letterSpacing: 0.8,
    opacity: 0.9,
    marginBottom: 4,
  },
  title1: {
    color: '#FFF8EE',
    fontWeight: '900',
    letterSpacing: -0.3,
    textShadowColor: 'rgba(0,0,0,0.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  title2: {
    fontWeight: '900',
    letterSpacing: -0.3,
    textShadowColor: 'rgba(0,0,0,0.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  description: {
    marginTop: 4,
    fontSize: 12.5,
    lineHeight: 17,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.72)',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 6,
    gap: 6,
  },
  chip: {
    height: 20,
    paddingHorizontal: 7,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center',
  },
  chipMuted: {
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  chipText: {
    color: '#FFF8EE',
    fontSize: 12,
    fontWeight: '800',
  },
  ctaWrap: {
    position: 'absolute',
    left: 0,
    bottom: 0,
  },
  cta: {
    height: 34,
    borderRadius: 12,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: {
    color: '#0B0B12',
    fontSize: 13,
    fontWeight: '800',
  },
  dotsWrap: {
    alignItems: 'center',
    marginTop: -4,
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
  },
  indicator: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 16,
    height: DOT,
    borderRadius: 3,
  },
  indicatorEye: {
    position: 'absolute',
    top: 2.25,
    width: 1.5,
    height: 1.5,
    borderRadius: 0.75,
    backgroundColor: '#0B0B12',
  },
});
