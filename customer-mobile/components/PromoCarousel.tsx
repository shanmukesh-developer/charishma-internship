import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, PanResponder } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, SHADOWS } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import SafeImage from './SafeImage';
import DopaminePressable, { ActionPressable } from './DopaminePressable';

export interface PromoOffer {
  id: string;
  imageUrl: string;
  tagline: string;
  title1: string;
  title2: string;
  description: string;
  buttonText: string;
  redirectAction?: () => void;
}

interface PromoCarouselProps {
  offers: PromoOffer[];
  containerStyle?: any;
}

export default function PromoCarousel({ offers, containerStyle }: PromoCarouselProps) {
  const { isDark } = useTheme();
  const [currentIndex, setCurrentIndex] = useState(0);
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const timerRef = useRef<any>(null);
  const currentIndexRef = useRef(0);

  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  const goToSlide = (nextIndex: number) => {
    if (nextIndex === currentIndexRef.current || !offers || offers.length === 0) return;
    
    // Pure crossfade — no translate so content never bleeds outside borders
    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      setCurrentIndex(nextIndex);
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 250,
        useNativeDriver: true,
      }).start();
    });
  };

  const nextSlide = () => {
    if (!offers || offers.length <= 1) return;
    goToSlide((currentIndexRef.current + 1) % offers.length);
  };

  const prevSlide = () => {
    if (!offers || offers.length <= 1) return;
    goToSlide((currentIndexRef.current - 1 + offers.length) % offers.length);
  };

  // Auto-scroll loop (5 seconds)
  useEffect(() => {
    if (!offers || offers.length <= 1) return;

    timerRef.current = setInterval(() => {
      nextSlide();
    }, 5000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [offers?.length]);

  // Swipe gesture recognizer
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return Math.abs(gestureState.dx) > 15 && Math.abs(gestureState.dy) < 20;
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dx < -30) {
          nextSlide();
        } else if (gestureState.dx > 30) {
          prevSlide();
        }
      },
    })
  ).current;

  if (!offers || offers.length === 0) return null;
  const currentOffer = offers[currentIndex] || offers[0];

  const accent = isDark ? COLORS.gold : COLORS.red;
  const title1Color = isDark ? '#FFF' : '#111827';
  const descColor = isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.65)';
  const ctaBtnGradientColors: [string, string, ...string[]] = isDark 
    ? ['#D4AF37', '#F5DEB3', '#C9962C'] 
    : ['#EF4F5F', '#FF7E8B', '#E03546'];
  const ctaTextColor = isDark ? '#000' : '#FFF';
  const border = isDark ? 'rgba(212, 175, 122, 0.4)' : COLORS.borderLight;

  return (
    <View 
      {...panResponder.panHandlers}
      style={[s.container, { borderColor: border, borderWidth: isDark ? 1.5 : 1, backgroundColor: isDark ? '#0A0A0B' : '#FFF' }, containerStyle]}
    >
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: fadeAnim, overflow: 'hidden', borderRadius: 24 }]}>
        {/* Background Image */}
        <View style={StyleSheet.absoluteFill}>
          <SafeImage source={{ uri: currentOffer.imageUrl }} style={s.bgImage} maxWidth={800} />
          <LinearGradient 
            colors={isDark 
              ? ['rgba(10, 10, 11, 0.95)', 'rgba(10, 10, 11, 0.75)', 'rgba(10, 10, 11, 0.25)'] 
              : ['rgba(255, 255, 255, 0.98)', 'rgba(255, 255, 255, 0.85)', 'rgba(255, 255, 255, 0.35)']} 
            start={{ x: 0, y: 0 }} 
            end={{ x: 1, y: 0 }} 
            style={StyleSheet.absoluteFill} 
          />
        </View>

        {/* Content wrapper */}
        <View style={s.content}>
          <Text style={[s.tagline, { color: accent }]}>{currentOffer.tagline?.toUpperCase()}</Text>
          <Text style={[s.title1, { color: title1Color }]}>{currentOffer.title1?.toUpperCase()}</Text>
          <Text style={[s.title2, { color: accent }]}>{currentOffer.title2?.toUpperCase()}</Text>
          <Text style={[s.desc, { color: descColor }]}>{currentOffer.description?.toUpperCase()}</Text>

          <ActionPressable 
            style={[s.ctaBtnWrapper, !isDark && { shadowColor: COLORS.red }]} 
            onPress={() => currentOffer.redirectAction && currentOffer.redirectAction()}
            sound="click"
          >
            <LinearGradient
              colors={ctaBtnGradientColors}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={s.ctaBtnGradient}
            >
              <Text style={[s.ctaText, { color: ctaTextColor }]}>{currentOffer.buttonText?.toUpperCase()} →</Text>
            </LinearGradient>
          </ActionPressable>
        </View>
      </Animated.View>

      {/* Elongated pill indicators */}
      {offers.length > 1 && (
        <View style={s.dotsContainer}>
          {offers.map((_, idx) => (
            <TouchableOpacity 
              key={idx} 
              onPress={() => goToSlide(idx)}
              style={[
                s.dot, 
                idx === currentIndex ? [s.dotActive, { backgroundColor: accent }] : null
              ]} 
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
    borderRadius: 24,
    borderWidth: 1,
    height: 220,
    overflow: 'hidden',
    position: 'relative',
    ...SHADOWS.card,
  },
  bgImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    zIndex: 10,
  },
  tagline: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 4,
    marginBottom: 6,
  },
  title1: {
    fontSize: 22,
    fontWeight: '900',
    lineHeight: 24,
  },
  title2: {
    fontSize: 22,
    fontWeight: '900',
    lineHeight: 24,
    marginBottom: 6,
  },
  desc: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 2,
    marginBottom: 16,
    maxWidth: 240,
    lineHeight: 12,
  },
  ctaBtnWrapper: {
    alignSelf: 'flex-start',
    borderRadius: 20,
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 4,
  },
  ctaBtnGradient: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 2,
  },
  dotsContainer: {
    position: 'absolute',
    bottom: 16,
    left: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    zIndex: 20,
  },
  dot: {
    width: 8,
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
  },
  dotActive: {
    width: 28,
  },
});
