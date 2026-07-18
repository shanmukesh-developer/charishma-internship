import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Dimensions, Platform, Easing } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

const { width: SW, height: SH } = Dimensions.get('window');

interface IntroOverlayProps {
  onComplete: () => void;
}

export default function IntroOverlay({ onComplete }: IntroOverlayProps) {
  // Container & Logo Zoom Animations — ALL useNativeDriver: false
  const fadeOutAnim = useRef(new Animated.Value(1)).current;
  const logoScale = useRef(new Animated.Value(0.4)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;

  // Staggered letters for Z E N V Y
  const letters = ['Z', 'E', 'N', 'V', 'Y'];
  const letterOpacityAnims = useRef(letters.map(() => new Animated.Value(0))).current;
  const letterYAnims = useRef(letters.map(() => new Animated.Value(20))).current;
  const letterScaleAnims = useRef(letters.map(() => new Animated.Value(0.3))).current;

  // Tagline Entrance
  const tagOpacity = useRef(new Animated.Value(0)).current;
  const tagY = useRef(new Animated.Value(15)).current;

  // Concentric Gold Shockwaves
  const wave1 = useRef(new Animated.Value(0.3)).current;
  const wave2 = useRef(new Animated.Value(0.3)).current;
  const wave1Opacity = useRef(new Animated.Value(0.6)).current;
  const wave2Opacity = useRef(new Animated.Value(0.6)).current;

  // 8 Particle Embers (reduced from 16 for Android perf)
  const embers = useRef(
    Array.from({ length: 8 }).map(() => ({
      y: new Animated.Value(0),
      xOffset: Math.random() * SW,
      scale: new Animated.Value(Math.random() * 1.2 + 0.4),
      opacity: new Animated.Value(0),
    }))
  ).current;

  useEffect(() => {
    // 1. Central Crest Reveal
    Animated.parallel([
      Animated.timing(logoOpacity, {
        toValue: 1,
        duration: 1200,
        useNativeDriver: false,
      }),
      Animated.spring(logoScale, {
        toValue: 1.0,
        friction: 6,
        tension: 30,
        useNativeDriver: false,
      }),
    ]).start();

    // 2. Concentric Gold Ripples
    Animated.loop(
      Animated.parallel([
        Animated.timing(wave1, { toValue: 2.2, duration: 2800, easing: Easing.out(Easing.ease), useNativeDriver: false }),
        Animated.timing(wave1Opacity, { toValue: 0, duration: 2800, useNativeDriver: false }),
      ])
    ).start();

    setTimeout(() => {
      Animated.loop(
        Animated.parallel([
          Animated.timing(wave2, { toValue: 2.2, duration: 2800, easing: Easing.out(Easing.ease), useNativeDriver: false }),
          Animated.timing(wave2Opacity, { toValue: 0, duration: 2800, useNativeDriver: false }),
        ])
      ).start();
    }, 900);

    // 3. Staggered Letters Sequence (Z E N V Y)
    letters.forEach((_, idx) => {
      const delay = 800 + idx * 160;
      setTimeout(() => {
        Animated.parallel([
          Animated.timing(letterOpacityAnims[idx], { toValue: 1, duration: 600, useNativeDriver: false }),
          Animated.spring(letterYAnims[idx], { toValue: 0, friction: 5, tension: 50, useNativeDriver: false }),
          Animated.spring(letterScaleAnims[idx], { toValue: 1, friction: 5, tension: 50, useNativeDriver: false }),
        ]).start();
      }, delay);
    });

    // 4. Tagline Slide in
    setTimeout(() => {
      Animated.parallel([
        Animated.timing(tagOpacity, { toValue: 0.7, duration: 1000, useNativeDriver: false }),
        Animated.timing(tagY, { toValue: 0, duration: 1000, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
      ]).start();
    }, 1800);

    // 5. Floating particles movement
    embers.forEach((ember, idx) => {
      ember.y.setValue(0);
      ember.opacity.setValue(0);
      const duration = 5000 + Math.random() * 4000;
      const delay = idx * 250;

      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.parallel([
            Animated.timing(ember.y, { toValue: -(SH * 0.6), duration, easing: Easing.linear, useNativeDriver: false }),
            Animated.sequence([
              Animated.timing(ember.opacity, { toValue: Math.random() * 0.6 + 0.2, duration: 1200, useNativeDriver: false }),
              Animated.delay(Math.max(0, duration - 2400)),
              Animated.timing(ember.opacity, { toValue: 0, duration: 1200, useNativeDriver: false }),
            ]),
          ]),
        ])
      ).start();
    });

    // 6. Zoom-Through Portal Fade-Out
    const zoomTimeout = setTimeout(() => {
      Animated.parallel([
        Animated.timing(logoScale, {
          toValue: 4.5,
          duration: 1400,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: false,
        }),
        Animated.timing(fadeOutAnim, {
          toValue: 0,
          duration: 1200,
          easing: Easing.out(Easing.ease),
          useNativeDriver: false,
        }),
      ]).start();
    }, 4500);

    // 7. Completion callback
    const doneTimeout = setTimeout(() => {
      onComplete();
    }, 5700);

    return () => {
      clearTimeout(zoomTimeout);
      clearTimeout(doneTimeout);
    };
  }, []);

  return (
    <Animated.View style={[styles.container, { opacity: fadeOutAnim }]}>
      {/* ── SOLID BACKGROUND ── */}
      <View style={StyleSheet.absoluteFill}>
        <LinearGradient colors={['#060608', '#0F0D12', '#060608']} style={StyleSheet.absoluteFill} />

        {/* Static color blobs (no filter, no animation — purely decorative) */}
        <View style={[styles.auroraBlob, styles.blobGold]} />
        <View style={[styles.auroraBlob, styles.blobCrimson]} />
        <View style={[styles.auroraBlob, styles.blobIndigo]} />
      </View>

      {/* Floating Spark Embers */}
      {embers.map((ember, i) => (
        <Animated.View
          key={i}
          style={[
            styles.ember,
            {
              opacity: ember.opacity,
              left: ember.xOffset,
              bottom: 0,
              transform: [
                { translateY: ember.y },
                { scale: ember.scale }
              ]
            },
          ]}
        />
      ))}

      {/* ── CENTRAL SHIELD & RIPPLES ── */}
      <Animated.View style={[styles.centerShieldArea, { transform: [{ scale: logoScale }], opacity: logoOpacity }]}>
        {/* Rippling Shockwaves */}
        <Animated.View style={[styles.shockwaveRing, { transform: [{ scale: wave1 }], opacity: wave1Opacity }]} />
        <Animated.View style={[styles.shockwaveRing, { transform: [{ scale: wave2 }], opacity: wave2Opacity }]} />

        {/* Primary Geometric Crest Shield */}
        <View style={styles.outerGlowRing}>
          <View style={styles.glassCrest}>
            {/* Stylized Z Logo */}
            <Text style={styles.logoCrestText}>Z</Text>
          </View>
        </View>
      </Animated.View>

      {/* ── STAGGERED BRAND TYPOGRAPHY ── */}
      <View style={styles.brandTitleContainer}>
        <View style={styles.lettersRow}>
          {letters.map((char, i) => (
            <Animated.Text
              key={i}
              style={[
                styles.brandLetter,
                {
                  opacity: letterOpacityAnims[i],
                  transform: [{ translateY: letterYAnims[i] }, { scale: letterScaleAnims[i] }],
                },
              ]}
            >
              {char}
            </Animated.Text>
          ))}
        </View>

        {/* Tagline text */}
        <Animated.View style={{ opacity: tagOpacity, transform: [{ translateY: tagY }] }}>
          <Text style={styles.brandTagline}>THE LUXURY OF CONVENIENCE</Text>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#060608',
    zIndex: 999999,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Aurora Blobs — static on Android (no filter/blur, just large opacity circles)
  auroraBlob: {
    position: 'absolute',
    width: SW * 1.1,
    height: SW * 1.1,
    borderRadius: (SW * 1.1) / 2,
    opacity: 0.5,
  },
  blobGold: {
    top: SH * 0.1,
    left: -SW * 0.4,
    backgroundColor: 'rgba(201, 168, 76, 0.08)',
  },
  blobCrimson: {
    bottom: SH * 0.15,
    right: -SW * 0.4,
    backgroundColor: 'rgba(239, 79, 95, 0.05)',
  },
  blobIndigo: {
    top: SH * 0.4,
    right: -SW * 0.1,
    backgroundColor: 'rgba(99, 102, 241, 0.04)',
  },

  ember: {
    position: 'absolute',
    width: 3.5,
    height: 3.5,
    borderRadius: 1.75,
    backgroundColor: '#D4AF37',
    ...Platform.select({
      ios: {
        shadowColor: '#D4AF37',
        shadowOpacity: 0.7,
        shadowRadius: 5,
        shadowOffset: { width: 0, height: 0 },
      },
      android: {
        elevation: 3,
      },
    }),
    zIndex: 15,
  },

  // Central Shield
  centerShieldArea: {
    width: 250,
    height: 250,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    marginBottom: 50,
  },
  shockwaveRing: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: 70,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.25)',
    ...Platform.select({
      ios: {
        shadowColor: '#D4AF37',
        shadowOpacity: 0.15,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 0 },
      },
      android: {
        elevation: 2,
      },
    }),
  },
  outerGlowRing: {
    width: 110,
    height: 110,
    borderRadius: 55,
    borderWidth: 2,
    borderColor: '#D4AF37',
    padding: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.01)',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#D4AF37',
        shadowOpacity: 0.4,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: 0 },
      },
      android: {
        elevation: 10,
      },
    }),
    zIndex: 25,
  },
  glassCrest: {
    width: '100%',
    height: '100%',
    borderRadius: 50,
    backgroundColor: 'rgba(12, 12, 16, 0.92)',
    borderWidth: 1.2,
    borderColor: 'rgba(212, 175, 55, 0.22)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'relative',
  },
  logoCrestText: {
    color: '#D4AF37',
    fontSize: 58,
    fontWeight: '300',
    fontStyle: 'italic',
    marginTop: 4,
    ...Platform.select({
      ios: {
        textShadowColor: 'rgba(212, 175, 55, 0.75)',
        textShadowOffset: { width: 0, height: 0 },
        textShadowRadius: 18,
      },
    }),
  },

  // Typography
  brandTitleContainer: {
    alignItems: 'center',
    zIndex: 40,
  },
  lettersRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  brandLetter: {
    color: '#D4AF37',
    fontSize: 38,
    fontWeight: '900',
    letterSpacing: 2,
    marginHorizontal: 6,
    ...Platform.select({
      ios: {
        textShadowColor: 'rgba(212, 175, 55, 0.45)',
        textShadowOffset: { width: 0, height: 4 },
        textShadowRadius: 15,
      },
    }),
  },
  brandTagline: {
    color: '#EBE3CE',
    fontSize: 8.5,
    fontWeight: '900',
    letterSpacing: 5.5,
    opacity: 0.6,
    marginTop: 6,
    textAlign: 'center',
  },
});
