import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, PanResponder } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { dietNow } from '../utils/themeNow';
import { useTheme } from '../context/ThemeContext';
import { useReduceMotion } from '../utils/reduceMotion';
import SafeImage from './SafeImage';
import { ActionPressable } from './DopaminePressable';

export interface PromoOffer {
  id: string;
  imageUrl: string;
  /** Small label above the title (sentence case, shown as written). */
  tagline: string;
  title1: string;
  /** Optional second title line; most slides leave it empty. */
  title2?: string;
  description: string;
  buttonText: string;
  redirectAction?: () => void;
}

interface PromoCarouselProps {
  offers: PromoOffer[];
  containerStyle?: any;
  /** Section accent for the button (Others sections); the app accent when omitted. */
  accent?: string;
}

const AUTO_ADVANCE_MS = 5000;

/**
 * Others-tab hero card: a full photo under a dark gradient scrim, so white text reads on any image in
 * both themes. Text is shown as written (sentence case): small label, 21/700 title, 13/400 line and a
 * compact button. Swipe, dots and the 5 s auto-advance stay; with the OS "reduce motion" setting on,
 * slides switch without the crossfade and never advance on their own.
 */
export default function PromoCarousel({ offers, containerStyle, accent: sectionAccent }: PromoCarouselProps) {
  const { isDark } = useTheme();
  const reduceMotion = useReduceMotion();
  const [currentIndex, setCurrentIndex] = useState(0);
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const currentIndexRef = useRef(0);
  const reduceMotionRef = useRef(reduceMotion);
  const offersRef = useRef(offers);
  offersRef.current = offers;
  reduceMotionRef.current = reduceMotion;

  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  // A shorter list (tab switch) must not leave the index past the end.
  useEffect(() => {
    if (currentIndex >= (offers?.length || 0)) setCurrentIndex(0);
  }, [offers?.length]);

  const goToSlide = (nextIndex: number) => {
    const list = offersRef.current;
    if (nextIndex === currentIndexRef.current || !list || list.length === 0) return;
    if (reduceMotionRef.current) {
      setCurrentIndex(nextIndex);
      return;
    }
    // Pure crossfade: no translate, so content never bleeds outside the card.
    Animated.timing(fadeAnim, { toValue: 0, duration: 180, useNativeDriver: true }).start(() => {
      setCurrentIndex(nextIndex);
      Animated.timing(fadeAnim, { toValue: 1, duration: 240, useNativeDriver: true }).start();
    });
  };

  const step = (dir: 1 | -1) => {
    const n = offersRef.current?.length || 0;
    if (n <= 1) return;
    goToSlide((currentIndexRef.current + dir + n) % n);
  };

  // Auto-advance (off while reduce motion is on). Restarts after a manual change so a swipe is never
  // followed by an instant jump.
  useEffect(() => {
    if (!offers || offers.length <= 1 || reduceMotion) return;
    const t = setTimeout(() => step(1), AUTO_ADVANCE_MS);
    return () => clearTimeout(t);
  }, [offers?.length, reduceMotion, currentIndex]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 15 && Math.abs(g.dy) < 20,
      onPanResponderRelease: (_, g) => {
        if (g.dx < -30) step(1);
        else if (g.dx > 30) step(-1);
      },
    })
  ).current;

  if (!offers || offers.length === 0) return null;
  const currentOffer = offers[currentIndex] || offers[0];

  const accent = sectionAccent || dietNow().acc;
  const ctaText = sectionAccent ? '#FFFFFF' : dietNow().onAcc;
  const labelColor = 'rgba(255,255,255,0.9)';

  return (
    <View
      {...panResponder.panHandlers}
      style={[s.container, { backgroundColor: isDark ? '#111113' : '#1F2937' }, containerStyle]}
      accessibilityRole="adjustable"
      accessibilityLabel={`${currentOffer.title1}. Slide ${currentIndex + 1} of ${offers.length}`}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => step(e.nativeEvent.actionName === 'decrement' ? -1 : 1)}
    >
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: fadeAnim }]}>
        {/* Every slide's photo stays mounted (only the current one shows), so a slide change never
            fades in on an empty card while its photo downloads. */}
        {offers.map((o, idx) => (
          <View key={o.id || idx} style={[StyleSheet.absoluteFill, { opacity: idx === currentIndex ? 1 : 0 }]} pointerEvents="none">
            <SafeImage source={{ uri: o.imageUrl }} style={s.bgImage} maxWidth={800} />
          </View>
        ))}
        {/* Scrim: strong at the bottom-left where the text sits, clear at the top-right. */}
        <LinearGradient
          colors={['rgba(0,0,0,0.08)', 'rgba(0,0,0,0.38)', 'rgba(0,0,0,0.8)']}
          locations={[0, 0.4, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <LinearGradient
          colors={['rgba(0,0,0,0.42)', 'rgba(0,0,0,0)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 0.75, y: 0 }}
          style={StyleSheet.absoluteFill}
        />

        <View style={s.content}>
          {!!currentOffer.tagline && (
            <Text style={[s.label, { color: labelColor }]} numberOfLines={1}>{currentOffer.tagline}</Text>
          )}
          <Text style={s.title} numberOfLines={2}>
            {currentOffer.title1}{currentOffer.title2 ? ` ${currentOffer.title2}` : ''}
          </Text>
          {!!currentOffer.description && (
            <Text style={s.desc} numberOfLines={2}>{currentOffer.description}</Text>
          )}

          <ActionPressable
            style={[s.cta, { backgroundColor: accent }]}
            onPress={() => currentOffer.redirectAction && currentOffer.redirectAction()}
            sound="click"
            accessibilityRole="button"
            accessibilityLabel={`${currentOffer.buttonText}: ${currentOffer.title1}`}
          >
            <Text style={[s.ctaText, { color: ctaText }]}>{currentOffer.buttonText}</Text>
          </ActionPressable>
        </View>
      </Animated.View>

      {offers.length > 1 && (
        <View style={s.dotsContainer} pointerEvents="box-none">
          {offers.map((o, idx) => (
            <TouchableOpacity
              key={o.id || idx}
              onPress={() => goToSlide(idx)}
              hitSlop={{ top: 10, bottom: 10, left: 4, right: 4 }}
              accessibilityRole="button"
              accessibilityLabel={`Show slide ${idx + 1} of ${offers.length}`}
              style={[s.dot, idx === currentIndex && [s.dotActive, { backgroundColor: '#FFFFFF' }]]}
            />
          ))}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    borderRadius: 20,
    height: 196,
    overflow: 'hidden',
    position: 'relative',
  },
  bgImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  content: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: 18,
    paddingBottom: 18,
    paddingRight: 72,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.3,
    marginBottom: 4,
  },
  title: {
    fontSize: 21,
    fontWeight: '700',
    lineHeight: 26,
    color: '#FFFFFF',
    letterSpacing: 0.1,
  },
  desc: {
    fontSize: 13,
    fontWeight: '400',
    lineHeight: 18,
    color: 'rgba(255,255,255,0.86)',
    marginTop: 4,
    maxWidth: 280,
  },
  cta: {
    alignSelf: 'flex-start',
    height: 32,
    paddingHorizontal: 16,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  ctaText: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  dotsContainer: {
    position: 'absolute',
    bottom: 22,
    right: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.45)',
  },
  dotActive: {
    width: 18,
  },
});
