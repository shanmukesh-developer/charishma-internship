import React, { useEffect, useRef, useMemo } from 'react';
import { View, StyleSheet, Animated, Dimensions, Platform, Easing, Image } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../context/ThemeContext';

const { width: SW, height: SH } = Dimensions.get('window');

// ── Premium Ambient Background ──────────────────────────────────────────
// Multi-layer living background with drifting aurora orbs, breathing dust
// particles, shooting meteors, and subtle luminous mesh lines. All animations
// run on the native driver for 60fps fluid performance.

const NUM_DUST = 5; // Reduced for 60fps performance
const NUM_MESH_LINES = 2;

interface MeteorProps {
  anim: Animated.Value;
  startLeft: number;
  startTop: number;
  color: string;
}

// Custom Meteor component rendering a native shooting star with a gradient tail
function MeteorComponent({ anim, startLeft, startTop, color }: MeteorProps) {
  const translateX = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -320],
  });
  const translateY = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 420],
  });
  const opacity = anim.interpolate({
    inputRange: [0, 0.1, 0.8, 1],
    outputRange: [0, 1, 1, 0],
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: startLeft,
        top: startTop,
        width: 100,
        height: 1.8,
        opacity,
        transform: [
          { translateX },
          { translateY },
          { rotate: '215deg' },
        ],
      }}
    >
      <LinearGradient
        colors={[color, 'transparent']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
      {/* Meteor Head Glowing Particle */}
      <View
        style={{
          position: 'absolute',
          left: 0,
          top: -1,
          width: 3.8,
          height: 3.8,
          borderRadius: 1.9,
          backgroundColor: '#FFF',
          ...Platform.select({
            ios: {
              shadowColor: color,
              shadowOffset: { width: 0, height: 0 },
              shadowOpacity: 0.9,
              shadowRadius: 3,
            },
            android: {
              elevation: 3,
            }
          })
        }}
      />
    </Animated.View>
  );
}

const AmbientBackground = React.memo(function AmbientBackground({ isStatic = Platform.OS === 'android' }: { isStatic?: boolean }) {
  const { isDark } = useTheme();

  // ── Drifting Aurora Orbs ──
  const orb1X = useRef(new Animated.Value(-60)).current;
  const orb1Y = useRef(new Animated.Value(-40)).current;
  const orb2X = useRef(new Animated.Value(SW - 120)).current;
  const orb2Y = useRef(new Animated.Value(SH - 250)).current;
  // ── Gold/Red Dust Particles (reduced for perf) ──
  const dustAnims = useRef(
    [...Array(NUM_DUST)].map(() => ({
      opacity: new Animated.Value(0.1 + Math.random() * 0.2),
      translateY: new Animated.Value(0),
    }))
  ).current;

  // ── Mesh Grid Pulse Lines ──
  const meshAnims = useRef(
    [...Array(NUM_MESH_LINES)].map(() => new Animated.Value(0.02))
  ).current;

  // Dust positions (memoized)
  const dustPositions = useMemo(() =>
    [...Array(NUM_DUST)].map(() => ({
      left: Math.random() * SW,
      top: Math.random() * SH,
      size: 2 + Math.random() * 3,
    })),
  []);

  useEffect(() => {
    if (isStatic) return;

    const activeAnims: Animated.CompositeAnimation[] = [];

    // ── Orb Drift Loops ──
    const orb1Loop = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(orb1X, { toValue: SW * 0.2, duration: 18000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(orb1Y, { toValue: SH * 0.15, duration: 18000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(orb1X, { toValue: -80, duration: 22000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(orb1Y, { toValue: -60, duration: 22000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ]),
      ])
    );
    orb1Loop.start();
    activeAnims.push(orb1Loop);

    const orb2Loop = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(orb2X, { toValue: SW * 0.45, duration: 20000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(orb2Y, { toValue: SH * 0.55, duration: 20000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(orb2X, { toValue: SW - 120, duration: 18000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(orb2Y, { toValue: SH - 280, duration: 18000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ]),
      ])
    );
    orb2Loop.start();
    activeAnims.push(orb2Loop);

    // ── Dust Breathing Loops ──
    dustAnims.forEach((dust, i) => {
      const opacityLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(dust.opacity, {
            toValue: 0.5 + Math.random() * 0.3,
            duration: 3000 + i * 800,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(dust.opacity, {
            toValue: 0.05,
            duration: 3000 + i * 800,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      );
      opacityLoop.start();
      activeAnims.push(opacityLoop);

      const translateLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(dust.translateY, {
            toValue: -12,
            duration: 4000 + i * 600,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(dust.translateY, {
            toValue: 8,
            duration: 4000 + i * 600,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      );
      translateLoop.start();
      activeAnims.push(translateLoop);
    });

    // ── Mesh Line Pulse ──
    meshAnims.forEach((mesh, i) => {
      const meshLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(mesh, {
            toValue: 0.09 + Math.random() * 0.07,
            duration: 4000 + i * 1000,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(mesh, {
            toValue: 0.01,
            duration: 4000 + i * 1000,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      );
      meshLoop.start();
      activeAnims.push(meshLoop);
    });

    return () => {
      activeAnims.forEach(anim => anim.stop());
    };
  }, [isStatic]);

  // ── Theme Colors ──
  const gradientColors: [string, string] = isDark
    ? ['#0A0A0B', '#0E0D10']
    : ['#FFFFFF', '#F8F7FA'];

  // Base64 transparent 1x1 image that allows high-performance native blurRadius on both platforms
  const blurDotSource = { uri: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=' };

  const orb1Color = isDark ? 'rgba(201, 168, 76, 0.11)' : 'rgba(255, 230, 180, 0.45)';
  const orb2Color = isDark ? 'rgba(239, 79, 95, 0.08)' : 'rgba(255, 200, 200, 0.35)';
  const orb3Color = isDark ? 'rgba(99, 102, 241, 0.07)' : 'rgba(200, 210, 255, 0.35)';
  const dustColor = isDark ? 'rgba(201, 168, 76, 0.5)' : 'rgba(239, 79, 95, 0.3)';
  const meshColor = isDark ? 'rgba(201, 168, 76, 0.07)' : 'rgba(239, 79, 95, 0.04)';

  const meteorColor = isDark ? '#C9A84C' : '#EF4F5F';

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* Base Gradient */}
      <LinearGradient colors={gradientColors} style={StyleSheet.absoluteFill} />

      {/* ── Aurora Orb 1 (Gold/Red Metamorphosis) ── */}
      <Animated.Image
        source={blurDotSource}
        blurRadius={Platform.OS === 'ios' ? 70 : 0}
        style={[
          styles.orb,
          {
            width: 280,
            height: 280,
            borderRadius: 140,
            tintColor: orb1Color,
            transform: [{ translateX: orb1X }, { translateY: orb1Y }],
          },
        ]}
      />

      {/* ── Aurora Orb 2 (Rose/Red) ── */}
      <Animated.Image
        source={blurDotSource}
        blurRadius={Platform.OS === 'ios' ? 80 : 0}
        style={[
          styles.orb,
          {
            width: 340,
            height: 340,
            borderRadius: 170,
            tintColor: orb2Color,
            transform: [{ translateX: orb2X }, { translateY: orb2Y }],
          },
        ]}
      />

      {/* Orb 3 removed for performance */}

      {/* ── Mesh Grid Pulse Lines ── */}
      {meshAnims.map((anim, i) => (
        <Animated.View
          key={`mesh-${i}`}
          style={[
            styles.meshLine,
            {
              top: (SH / (NUM_MESH_LINES + 1)) * (i + 1),
              backgroundColor: meshColor,
              opacity: anim,
            },
          ]}
        />
      ))}

      {/* ── Dust Particles ── */}
      {dustAnims.map((dust, i) => {
        const pos = dustPositions[i];
        return (
          <Animated.View
            key={`dust-${i}`}
            style={[
              styles.dustParticle,
              {
                left: pos.left,
                top: pos.top,
                width: pos.size,
                height: pos.size,
                borderRadius: pos.size / 2,
                backgroundColor: dustColor,
                opacity: dust.opacity,
                transform: [
                  { translateY: dust.translateY },
                ],
              },
            ]}
          />
        );
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  orb: {
    position: 'absolute',
  },
  meshLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
  },
  dustParticle: {
    position: 'absolute',
    ...Platform.select({
      ios: {
        shadowColor: '#D4AF37',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.6,
        shadowRadius: 3,
      },
      android: {
        elevation: 1.5,
      }
    })
  },
});

export default AmbientBackground;
