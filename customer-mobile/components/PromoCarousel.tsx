import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Image, Dimensions, TouchableOpacity, FlatList } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, SHADOWS } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';

const { width: SW } = Dimensions.get('window');
const SLIDE_WIDTH = SW - 32;

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
  const flatListRef = useRef<FlatList>(null);

  // Auto-scroll loop
  useEffect(() => {
    if (offers.length <= 1) return;

    const interval = setInterval(() => {
      const nextIndex = (currentIndex + 1) % offers.length;
      setCurrentIndex(nextIndex);
      flatListRef.current?.scrollToIndex({
        index: nextIndex,
        animated: true,
      });
    }, 4000);

    return () => clearInterval(interval);
  }, [currentIndex, offers.length]);

  const onMomentumScrollEnd = (e: any) => {
    const contentOffset = e.nativeEvent.contentOffset.x;
    const index = Math.round(contentOffset / SLIDE_WIDTH);
    if (index >= 0 && index < offers.length) {
      setCurrentIndex(index);
    }
  };

  const accent = isDark ? COLORS.gold : COLORS.red;
  const overlayColors: [string, string, ...string[]] = isDark 
    ? ['rgba(10, 10, 11, 0.98)', 'rgba(10, 10, 11, 0.70)', 'rgba(10, 10, 11, 0.20)']
    : ['rgba(255, 255, 255, 0.98)', 'rgba(255, 255, 255, 0.75)', 'rgba(255, 255, 255, 0.25)'];
  const title1Color = isDark ? '#FFF' : '#111827';
  const descColor = isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)';
  const ctaBtnGradientColors: [string, string, ...string[]] = isDark 
    ? ['#D4AF37', '#F5DEB3', '#C9962C'] 
    : ['#EF4F5F', '#FF7E8B', '#E03546'];
  const ctaTextColor = isDark ? '#000' : '#FFF';
  const border = isDark ? 'rgba(212, 175, 122, 0.4)' : COLORS.borderLight;

  return (
    <View style={[s.container, { borderColor: border, borderWidth: isDark ? 1.5 : 1, backgroundColor: isDark ? '#0A0A0B' : '#FFF' }, containerStyle]}>
      <FlatList
        ref={flatListRef}
        data={offers}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        snapToInterval={SLIDE_WIDTH}
        decelerationRate="fast"
        onMomentumScrollEnd={onMomentumScrollEnd}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={{ width: SLIDE_WIDTH, height: 220, position: 'relative' }}>
            {/* Background Image */}
            <View style={StyleSheet.absoluteFill}>
              <Image source={{ uri: item.imageUrl }} style={s.bgImage} />
              <LinearGradient 
                colors={overlayColors} 
                start={{ x: 0, y: 1 }} 
                end={{ x: 0, y: 0 }} 
                style={StyleSheet.absoluteFill} 
              />
            </View>

            {/* Content wrapper */}
            <View style={s.content}>
              <Text style={[s.tagline, { color: accent }]}>{item.tagline.toUpperCase()} 🌆</Text>
              <Text style={[s.title1, { color: title1Color }]}>{item.title1.toUpperCase()}</Text>
              <Text style={[s.title2, { color: accent }]}>{item.title2.toUpperCase()}</Text>
              <Text style={[s.desc, { color: descColor }]}>{item.description.toUpperCase()}</Text>

              <TouchableOpacity 
                style={[s.ctaBtnWrapper, !isDark && { shadowColor: COLORS.red }]} 
                activeOpacity={0.8}
                onPress={() => item.redirectAction && item.redirectAction()}
              >
                <LinearGradient
                  colors={ctaBtnGradientColors}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={s.ctaBtnGradient}
                >
                  <Text style={[s.ctaText, { color: ctaTextColor }]}>{item.buttonText.toUpperCase()} →</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        )}
      />

      {/* Elongated pill indicators */}
      {offers.length > 1 && (
        <View style={s.dotsContainer}>
          {offers.map((_, idx) => (
            <TouchableOpacity 
              key={idx} 
              onPress={() => {
                setCurrentIndex(idx);
                flatListRef.current?.scrollToIndex({ index: idx, animated: true });
              }}
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
    fontSize: 9,
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
    fontSize: 8,
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
    fontSize: 9,
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
