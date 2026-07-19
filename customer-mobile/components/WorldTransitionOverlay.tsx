import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Dimensions, Animated, Easing, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useWorldTransition, WORLD_THEMES } from '../context/WorldTransitionContext';

const { width: W, height: H } = Dimensions.get('window');

// ── Cinematic Transition Overlay ─────────────────────────────────────
// All animations use useNativeDriver: true for 60fps GPU performance.
// Uses scale + opacity wipe instead of layout-dependent diamond wipe.

const NUM_PARTICLES = 8;
const NUM_RAYS = 4;

export default function WorldTransitionOverlay() {
  const { isTransitioning, targetWorld, phase } = useWorldTransition();
  const theme = targetWorld ? WORLD_THEMES[targetWorld] : null;

  // ── Core Wipe (opacity + scale based for native driver) ──
  const wipeOpacity = useRef(new Animated.Value(0)).current;
  const wipeScale = useRef(new Animated.Value(0.3)).current;
  const contentOpacity = useRef(new Animated.Value(0)).current;
  const contentScale = useRef(new Animated.Value(0.7)).current;
  const contentY = useRef(new Animated.Value(40)).current;

  // ── Luminous Ring ──
  const ringScale = useRef(new Animated.Value(0.3)).current;
  const ringOpacity = useRef(new Animated.Value(0)).current;
  const ringRotation = useRef(new Animated.Value(0)).current;

  // ── Radial Light Rays ──
  const rayAnims = useRef(
    [...Array(NUM_RAYS)].map(() => ({
      opacity: new Animated.Value(0),
      scaleX: new Animated.Value(0.2),
    }))
  ).current;

  // ── Ambient Particle Field ──
  const particles = useRef(
    [...Array(NUM_PARTICLES)].map(() => ({
      x: Math.random() * W,
      y: Math.random() * H,
      opacity: new Animated.Value(0),
      translateY: new Animated.Value(0),
      scale: new Animated.Value(0.3),
    }))
  ).current;

  // ── Gold Pulse Line ──
  const lineScaleX = useRef(new Animated.Value(0)).current;

  // ── Breath Glow ──
  const breathOpacity = useRef(new Animated.Value(0)).current;

  // Smooth exponential easing for premium feel
  const luxuryEase = Easing.bezier(0.22, 1, 0.36, 1);

  useEffect(() => {
    if (!isTransitioning || !theme) {
      // Reset all
      wipeOpacity.setValue(0);
      wipeScale.setValue(0.3);
      contentOpacity.setValue(0);
      contentScale.setValue(0.7);
      contentY.setValue(40);
      ringScale.setValue(0.3);
      ringOpacity.setValue(0);
      ringRotation.setValue(0);
      lineScaleX.setValue(0);
      breathOpacity.setValue(0);
      rayAnims.forEach(r => { r.opacity.setValue(0); r.scaleX.setValue(0.2); });
      particles.forEach(p => { p.opacity.setValue(0); p.translateY.setValue(0); p.scale.setValue(0.3); });
      return;
    }

    if (phase === 'covering') {
      // ── 1. Scale + Opacity Wipe In (native driver) ──
      Animated.parallel([
        Animated.timing(wipeOpacity, {
          toValue: 1,
          duration: 400,
          easing: luxuryEase,
          useNativeDriver: true,
        }),
        Animated.timing(wipeScale, {
          toValue: 3,
          duration: 500,
          easing: luxuryEase,
          useNativeDriver: true,
        }),
      ]).start();

      // ── 2. Ring Expansion ──
      Animated.parallel([
        Animated.timing(ringScale, {
          toValue: 1.8,
          duration: 900,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(ringOpacity, {
          toValue: 0.6,
          duration: 500,
          delay: 150,
          useNativeDriver: true,
        }),
        Animated.loop(
          Animated.timing(ringRotation, {
            toValue: 1,
            duration: 4000,
            easing: Easing.linear,
            useNativeDriver: true,
          })
        ),
      ]).start();

      // ── 3. Content Slide + Scale ──
      Animated.parallel([
        Animated.timing(contentOpacity, {
          toValue: 1,
          duration: 400,
          delay: 200,
          useNativeDriver: true,
        }),
        Animated.spring(contentScale, {
          toValue: 1,
          speed: 8,
          bounciness: 3,
          delay: 200,
          useNativeDriver: true,
        }),
        Animated.timing(contentY, {
          toValue: 0,
          duration: 450,
          delay: 200,
          easing: luxuryEase,
          useNativeDriver: true,
        }),
      ]).start();

      // ── 4. Gold Line Expand ──
      Animated.timing(lineScaleX, {
        toValue: 1,
        duration: 500,
        delay: 300,
        easing: luxuryEase,
        useNativeDriver: true,
      }).start();

      // ── 5. Radial Light Rays ──
      rayAnims.forEach((ray, i) => {
        Animated.parallel([
          Animated.timing(ray.opacity, {
            toValue: 0.15 + Math.random() * 0.2,
            duration: 600,
            delay: 100 + i * 60,
            useNativeDriver: true,
          }),
          Animated.timing(ray.scaleX, {
            toValue: 1,
            duration: 800,
            delay: 100 + i * 60,
            easing: luxuryEase,
            useNativeDriver: true,
          }),
        ]).start();
      });

      // ── 6. Particle Field Burst ──
      particles.forEach((p, i) => {
        p.translateY.setValue(0);
        p.opacity.setValue(0);
        p.scale.setValue(0.3);
        Animated.parallel([
          Animated.timing(p.scale, {
            toValue: 0.6 + Math.random() * 1.2,
            duration: 1000,
            delay: i * 50,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(p.translateY, {
            toValue: -60 - Math.random() * 120,
            duration: 1200,
            delay: i * 50,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.sequence([
            Animated.timing(p.opacity, {
              toValue: 0.3 + Math.random() * 0.5,
              duration: 350,
              delay: i * 50,
              useNativeDriver: true,
            }),
            Animated.timing(p.opacity, {
              toValue: 0,
              duration: 850,
              useNativeDriver: true,
            }),
          ]),
        ]).start();
      });

      // ── 7. Breath Glow ──
      Animated.loop(
        Animated.sequence([
          Animated.timing(breathOpacity, {
            toValue: 0.15,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(breathOpacity, {
            toValue: 0.04,
            duration: 800,
            useNativeDriver: true,
          }),
        ])
      ).start();

    } else if (phase === 'uncovering') {
      // ── Smooth Wipe Out ──
      Animated.parallel([
        Animated.timing(wipeOpacity, {
          toValue: 0,
          duration: 450,
          easing: luxuryEase,
          useNativeDriver: true,
        }),
        Animated.timing(wipeScale, {
          toValue: 0.3,
          duration: 450,
          easing: luxuryEase,
          useNativeDriver: true,
        }),
        Animated.timing(contentOpacity, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(ringOpacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(lineScaleX, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
        ...rayAnims.map(r =>
          Animated.timing(r.opacity, {
            toValue: 0,
            duration: 250,
            useNativeDriver: true,
          })
        ),
      ]).start();
    }
  }, [phase, isTransitioning, theme]);

  if (!isTransitioning || !theme) return null;

  const rotateInterp = ringRotation.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <View style={s.container} pointerEvents={phase === 'covering' ? 'auto' : 'none'}>
      {/* ── LAYER 1: Full-screen Scale+Opacity Wipe ── */}
      <Animated.View
        style={[
          s.wipeLayer,
          {
            backgroundColor: theme.colors[0],
            opacity: wipeOpacity,
            transform: [{ scale: wipeScale }],
          },
        ]}
      />

      {/* ── LAYER 2: Theme Gradient Overlay ── */}
      <Animated.View style={[s.gradientOverlay, { opacity: wipeOpacity }]}>
        <LinearGradient
          colors={[theme.colors[0], theme.colors[1] || theme.colors[0], '#000'] as [string, string, ...string[]]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>

      {/* ── LAYER 3: Radial Light Rays ── */}
      {rayAnims.map((ray, i) => (
        <View
          key={`ray-${i}`}
          style={[
            s.lightRay,
            { transform: [{ rotate: `${(i * 360) / NUM_RAYS}deg` }] }
          ]}
        >
          <Animated.View
            style={[
              StyleSheet.absoluteFill,
              {
                opacity: ray.opacity,
                transform: [{ scaleX: ray.scaleX }],
                backgroundColor: 'rgba(255,255,255,0.3)'
              },
            ]}
          />
        </View>
      ))}

      {/* ── LAYER 5: Breath Glow ── */}
      <Animated.View style={[s.breathGlow, { opacity: breathOpacity }]} />

      {/* ── LAYER 6: Particle Field ── */}
      {particles.map((p, i) => (
        <Animated.View
          key={`p-${i}`}
          style={[
            s.particle,
            {
              left: p.x,
              top: p.y,
              opacity: p.opacity,
              transform: [{ scale: p.scale }, { translateY: p.translateY }],
            },
          ]}
        />
      ))}

      {/* ── LAYER 7: Central Brand Content ── */}
      <Animated.View
        style={[
          s.content,
          {
            opacity: contentOpacity,
            transform: [{ scale: contentScale }, { translateY: contentY }],
          },
        ]}
      >
        {/* Crest Badge */}
        <View style={s.crestBadge}>
          <View style={s.crestInner}>
            <Text style={s.crestLetter}>Z</Text>
          </View>
        </View>

        <Text style={s.gatewayLabel}>• ZENVY PLATFORM GATEWAY •</Text>
        <Text style={s.worldTitle}>{theme.label}</Text>

        {/* Gold Line Divider */}
        <Animated.View style={[s.goldLine, { transform: [{ scaleX: lineScaleX }] }]} />

        {/* Pulsing Status */}
        <View style={s.statusRow}>
          <View style={s.statusDot} />
          <Text style={s.statusLabel}>INITIALIZING SECURE TUNNEL</Text>
        </View>
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 99999,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },

  // Scale+Opacity based wipe layer
  wipeLayer: {
    position: 'absolute',
    width: Math.max(W, H) * 1.5,
    height: Math.max(W, H) * 1.5,
    borderRadius: Math.max(W, H) * 0.75,
  },

  // Theme gradient
  gradientOverlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
  },

  // Light rays emanating from center
  lightRay: {
    position: 'absolute',
    width: W * 2,
    height: 2,
    alignSelf: 'center',
    top: H / 2 - 1,
    left: -W * 0.5,
    shadowColor: '#FFF',
    shadowRadius: 8,
    shadowOpacity: 0.5,
    elevation: 4,
  },

  // Breath glow
  breathGlow: {
    position: 'absolute',
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: '#FFF',
    ...Platform.select({
      ios: {
        shadowColor: '#FFF',
        shadowRadius: 60,
        shadowOpacity: 0.8,
        shadowOffset: { width: 0, height: 0 },
      },
      android: {
        elevation: 20,
      },
    }),
  },

  // Particles
  particle: {
    position: 'absolute',
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.6)',
    shadowColor: '#FFF',
    shadowRadius: 4,
    shadowOpacity: 0.6,
    elevation: 2,
  },

  // Central content
  content: {
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    paddingHorizontal: 24,
  },

  crestBadge: {
    width: 72,
    height: 72,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: 'rgba(201,168,76,0.5)',
    padding: 3,
    marginBottom: 20,
    shadowColor: '#C9A84C',
    shadowRadius: 20,
    shadowOpacity: 0.4,
    elevation: 10,
  },
  crestInner: {
    flex: 1,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderWidth: 1,
    borderColor: 'rgba(201,168,76,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  crestLetter: {
    fontSize: 28,
    fontWeight: '900',
    color: '#D4AF37',
    fontStyle: 'italic',
    textShadowColor: 'rgba(212,175,55,0.5)',
    textShadowRadius: 10,
    textShadowOffset: { width: 0, height: 2 },
  },

  gatewayLabel: {
    fontSize: 8,
    fontWeight: '900',
    color: 'rgba(201,168,76,0.8)',
    letterSpacing: 4,
    marginBottom: 8,
    textAlign: 'center',
  },

  worldTitle: {
    fontSize: 30,
    fontWeight: '900',
    color: '#FFF',
    letterSpacing: 3,
    fontStyle: 'italic',
    textTransform: 'uppercase',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 10,
  },

  goldLine: {
    width: W * 0.55,
    height: 2,
    backgroundColor: '#C9A84C',
    marginTop: 16,
    marginBottom: 20,
    shadowColor: '#C9A84C',
    shadowRadius: 8,
    shadowOpacity: 0.6,
    elevation: 4,
  },

  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(201,168,76,0.8)',
    shadowColor: '#C9A84C',
    shadowRadius: 6,
    shadowOpacity: 0.8,
    elevation: 4,
  },
  statusLabel: {
    fontSize: 8,
    fontWeight: '900',
    color: 'rgba(255,255,255,0.45)',
    letterSpacing: 2,
    textAlign: 'center',
  },
});
