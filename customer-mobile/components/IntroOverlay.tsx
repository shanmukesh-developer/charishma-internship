import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Dimensions, Platform, Easing } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

const { width: SW, height: SH } = Dimensions.get('window');

interface IntroOverlayProps {
  onComplete: () => void;
}

export default function IntroOverlay({ onComplete }: IntroOverlayProps) {
  // Container & Logo Zoom Animations
  const fadeOutAnim = useRef(new Animated.Value(1)).current;
  const logoScale = useRef(new Animated.Value(0.4)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;

  // Gold Sheen Reflection Animation
  const sheenAnim = useRef(new Animated.Value(-150)).current;

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
  const wave3 = useRef(new Animated.Value(0.3)).current;
  const wave1Opacity = useRef(new Animated.Value(0.6)).current;
  const wave2Opacity = useRef(new Animated.Value(0.6)).current;
  const wave3Opacity = useRef(new Animated.Value(0.6)).current;

  // Dynamic Floating Color Blobs (Mesh Aurora)
  const blob1X = useRef(new Animated.Value(0)).current;
  const blob1Y = useRef(new Animated.Value(0)).current;
  const blob2X = useRef(new Animated.Value(0)).current;
  const blob2Y = useRef(new Animated.Value(0)).current;
  const blob3X = useRef(new Animated.Value(0)).current;
  const blob3Y = useRef(new Animated.Value(0)).current;

  // 16 Particle Embers
  const embers = useRef(
    Array.from({ length: 16 }).map(() => ({
      y: new Animated.Value(SH * 1.1),
      x: Math.random() * SW,
      scale: new Animated.Value(Math.random() * 1.6 + 0.4),
      opacity: new Animated.Value(0),
    }))
  ).current;

  useEffect(() => {
    // 1. Aurora Mesh Floating Loops
    const startAuroraLoops = () => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(blob1X, { toValue: SW * 0.2, duration: 8000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(blob1X, { toValue: -SW * 0.1, duration: 8000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ])
      ).start();
      Animated.loop(
        Animated.sequence([
          Animated.timing(blob1Y, { toValue: SH * 0.15, duration: 9000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(blob1Y, { toValue: -SH * 0.05, duration: 9000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ])
      ).start();

      Animated.loop(
        Animated.sequence([
          Animated.timing(blob2X, { toValue: -SW * 0.2, duration: 11000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(blob2X, { toValue: SW * 0.15, duration: 11000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ])
      ).start();
      Animated.loop(
        Animated.sequence([
          Animated.timing(blob2Y, { toValue: -SH * 0.1, duration: 10000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(blob2Y, { toValue: SH * 0.2, duration: 10000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ])
      ).start();

      Animated.loop(
        Animated.sequence([
          Animated.timing(blob3X, { toValue: SW * 0.1, duration: 13000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(blob3X, { toValue: -SW * 0.15, duration: 13000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ])
      ).start();
      Animated.loop(
        Animated.sequence([
          Animated.timing(blob3Y, { toValue: SH * 0.1, duration: 12000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(blob3Y, { toValue: -SH * 0.15, duration: 12000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ])
      ).start();
    };
    startAuroraLoops();

    // 2. Central Crest Spring Reveal
    Animated.parallel([
      Animated.timing(logoOpacity, {
        toValue: 1,
        duration: 1200,
        useNativeDriver: true,
      }),
      Animated.spring(logoScale, {
        toValue: 1.0,
        friction: 6,
        tension: 30,
        useNativeDriver: true,
      }),
    ]).start();

    // 3. Metallic Light Sheen Loop
    Animated.loop(
      Animated.sequence([
        Animated.timing(sheenAnim, {
          toValue: 250,
          duration: 1800,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(sheenAnim, {
          toValue: -150,
          duration: 1,
          useNativeDriver: true,
        }),
        Animated.delay(1600), // delay between sweeps
      ])
    ).start();

    // 4. Concentric Gold Ripples Loops
    const startRippleLoops = () => {
      Animated.loop(
        Animated.parallel([
          Animated.timing(wave1, { toValue: 2.2, duration: 2800, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          Animated.timing(wave1Opacity, { toValue: 0, duration: 2800, useNativeDriver: true }),
        ])
      ).start();

      setTimeout(() => {
        Animated.loop(
          Animated.parallel([
            Animated.timing(wave2, { toValue: 2.2, duration: 2800, easing: Easing.out(Easing.ease), useNativeDriver: true }),
            Animated.timing(wave2Opacity, { toValue: 0, duration: 2800, useNativeDriver: true }),
          ])
        ).start();
      }, 900);

      setTimeout(() => {
        Animated.loop(
          Animated.parallel([
            Animated.timing(wave3, { toValue: 2.2, duration: 2800, easing: Easing.out(Easing.ease), useNativeDriver: true }),
            Animated.timing(wave3Opacity, { toValue: 0, duration: 2800, useNativeDriver: true }),
          ])
        ).start();
      }, 1800);
    };
    startRippleLoops();

    // 5. Staggered Letters Sequence (Z E N V Y)
    letters.forEach((_, idx) => {
      const delay = 800 + idx * 160;
      setTimeout(() => {
        Animated.parallel([
          Animated.timing(letterOpacityAnims[idx], { toValue: 1, duration: 600, useNativeDriver: true }),
          Animated.spring(letterYAnims[idx], { toValue: 0, friction: 5, tension: 50, useNativeDriver: true }),
          Animated.spring(letterScaleAnims[idx], { toValue: 1, friction: 5, tension: 50, useNativeDriver: true }),
        ]).start();
      }, delay);
    });

    // 6. Tagline Slide in
    setTimeout(() => {
      Animated.parallel([
        Animated.timing(tagOpacity, { toValue: 0.7, duration: 1000, useNativeDriver: true }),
        Animated.timing(tagY, { toValue: 0, duration: 1000, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]).start();
    }, 1800);

    // 7. Floating particles movement
    embers.forEach((ember, idx) => {
      const runEmber = () => {
        ember.y.setValue(SH * (1.0 + Math.random() * 0.1));
        ember.opacity.setValue(0);
        const duration = 5000 + Math.random() * 4000;
        const delay = idx * 200;

        Animated.loop(
          Animated.sequence([
            Animated.delay(delay),
            Animated.parallel([
              Animated.timing(ember.y, { toValue: -50, duration, easing: Easing.linear, useNativeDriver: true }),
              Animated.sequence([
                Animated.timing(ember.opacity, { toValue: Math.random() * 0.8 + 0.2, duration: 1200, useNativeDriver: true }),
                Animated.delay(duration - 2400),
                Animated.timing(ember.opacity, { toValue: 0, duration: 1200, useNativeDriver: true }),
              ]),
            ]),
          ])
        ).start();
      };
      runEmber();
    });

    // 8. Zoom-Through Portal Fade-Out
    const zoomTimeout = setTimeout(() => {
      Animated.parallel([
        Animated.timing(logoScale, {
          toValue: 4.5,
          duration: 1400,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(fadeOutAnim, {
          toValue: 0,
          duration: 1200,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
      ]).start();
    }, 4500);

    // 9. Completion callback
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
      {/* ── SOLID MESH AURORA BACKGROUND ── */}
      <View style={StyleSheet.absoluteFill}>
        <LinearGradient colors={['#060608', '#0F0D12', '#060608']} style={StyleSheet.absoluteFill} />

        {/* Shifting Gradient Blobs */}
        <Animated.View style={[styles.auroraBlob, styles.blobGold, { transform: [{ translateX: blob1X }, { translateY: blob1Y }] }]} />
        <Animated.View style={[styles.auroraBlob, styles.blobCrimson, { transform: [{ translateX: blob2X }, { translateY: blob2Y }] }]} />
        <Animated.View style={[styles.auroraBlob, styles.blobIndigo, { transform: [{ translateX: blob3X }, { translateY: blob3Y }] }]} />
      </View>

      {/* Floating Spark Embers */}
      {embers.map((ember, i) => (
        <Animated.View
          key={i}
          style={[
            styles.ember,
            {
              opacity: ember.opacity,
              left: ember.x,
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
        <Animated.View style={[styles.shockwaveRing, { transform: [{ scale: wave3 }], opacity: wave3Opacity }]} />

        {/* Primary Geometric Crest Shield */}
        <View style={styles.outerGlowRing}>
          <View style={styles.glassCrest}>
            {/* Stylized Interlocking Z Logo */}
            <Text style={styles.logoCrestText}>Z</Text>

            {/* Sweeping Light Ray Beam */}
            <Animated.View style={[styles.lightRayWrap, { transform: [{ translateX: sheenAnim }] }]}>
              <LinearGradient
                colors={['transparent', 'rgba(255,255,255,0.0)', 'rgba(255, 255, 255, 0.28)', 'rgba(255,255,255,0.0)', 'transparent']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
            </Animated.View>
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

  // Aurora Blobs
  auroraBlob: {
    position: 'absolute',
    width: SW * 1.1,
    height: SW * 1.1,
    borderRadius: (SW * 1.1) / 2,
    opacity: 0.5,
    filter: Platform.OS === 'ios' ? 'blur(110px)' : undefined,
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
    shadowColor: '#D4AF37',
    shadowOpacity: 0.7,
    shadowRadius: 5,
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
    shadowColor: '#D4AF37',
    shadowOpacity: 0.15,
    shadowRadius: 12,
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
    shadowColor: '#D4AF37',
    shadowOpacity: 0.4,
    shadowRadius: 24,
    elevation: 10,
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
  crownGlyph: {
    fontSize: 10,
    color: '#D4AF37',
    position: 'absolute',
    top: 15,
    opacity: 0.85,
  },
  logoCrestText: {
    color: '#D4AF37',
    fontSize: 58,
    fontWeight: '300',
    fontStyle: 'italic',
    marginTop: 4,
    textShadowColor: 'rgba(212, 175, 55, 0.75)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 18,
  },
  lightRayWrap: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 80,
    zIndex: 30,
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
    gap: 12,
    marginBottom: 8,
  },
  brandLetter: {
    color: '#D4AF37',
    fontSize: 38,
    fontWeight: '900',
    letterSpacing: 2,
    textShadowColor: 'rgba(212, 175, 55, 0.45)',
    textShadowOffset: { width: 0, height: 4 },
    textShadowRadius: 15,
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
