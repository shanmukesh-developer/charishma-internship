import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ScrollView, Animated, Dimensions, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { COLORS, SHADOWS } from '../constants/theme';
import { ENDPOINTS } from '../constants/api';
import { useAuth } from '../context/AuthContext';
import { StaggeredSection, BounceIn } from '../components/AnimatedSection';
import { setToken } from '../utils/auth';
import DopaminePressable from '../components/DopaminePressable';

const { width: SW, height: SH } = Dimensions.get('window');

// Fresh, ultra-premium, dark-themed gourmet visual assets
const IMAGES = [
  'https://images.unsplash.com/photo-1544025162-d76694265947?w=1000&q=80', // Gourmet Truffle Ribs (dark background, golden highlights)
  'https://images.unsplash.com/photo-1611143669185-af224c5e3252?w=1000&q=80', // Frosted Glass Luxury Sushi Set
  'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=1000&q=80', // Artisanal bubbling Woodfired Pizza
  'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=1000&q=80', // Futuristic neon city logistics drone
];

export default function LoginScreen() {
  const router = useRouter();
  const { setUser } = useAuth();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Background Slideshow Animation State
  const [imgIndex, setImgIndex] = useState(0);
  const fadeAnim = useRef(new Animated.Value(1)).current;

  // 3D Parallax Hover/Drag Coordinates
  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;

  // Bottom Card Entrance & Peek Slider Animation State
  const slideUp = useRef(new Animated.Value(280)).current;
  const [isPeeked, setIsPeeked] = useState(false);

  useEffect(() => {
    // 1. Slideshow cycle loop
    const interval = setInterval(() => {
      Animated.sequence([
        Animated.timing(fadeAnim, {
          toValue: 0.15,
          duration: 900,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 900,
          useNativeDriver: true,
        })
      ]).start();

      setTimeout(() => {
        setImgIndex((prev) => (prev + 1) % IMAGES.length);
      }, 900);
    }, 5000);

    // 2. Card slide up on mount
    Animated.spring(slideUp, {
      toValue: 0,
      useNativeDriver: true,
      friction: 8,
      tension: 30,
    }).start();

    return () => clearInterval(interval);
  }, []);

  // VIP Sneak Peek sliding panel toggle
  const toggleSneakPeek = () => {
    const nextState = !isPeeked;
    setIsPeeked(nextState);
    Animated.spring(slideUp, {
      toValue: nextState ? 330 : 0, // slides the card down to expose the vault
      useNativeDriver: true,
      friction: 8,
      tension: 25,
    }).start();
  };

  const handleLogin = async () => {
    if (!phone || !password) { setError('Please fill in all fields'); return; }
    setLoading(true); setError('');
    try {
      const res = await fetch(ENDPOINTS.login, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, password }),
      });
      const data = await res.json();
      if (res.ok && data.token) {
        await setToken(data.token);
        await setUser(data.user || data);
        router.replace('/(tabs)' as any);
      } else {
        setError(data.message || 'Login failed');
      }
    } catch (e) { setError('Network error. Try again.'); }
    finally { setLoading(false); }
  };

  return (
    <View 
      {...({
        style: s.container,
        onMouseMove: (e: any) => {
          if (Platform.OS === 'web') {
            const { clientX, clientY } = e;
            // Calculate subtle spring shift offsets based on cursor position relative to screen center
            const x = (clientX - SW / 2) / 32; 
            const y = (clientY - SH / 2) / 32;
            Animated.spring(pan, {
              toValue: { x, y },
              useNativeDriver: true,
              friction: 12,
            }).start();
          }
        }
      } as any)}
    >
      {/* Background Slideshow with Parallax Shift */}
      <View style={StyleSheet.absoluteFill}>
        <Animated.Image 
          source={{ uri: IMAGES[imgIndex] }} 
          style={[
            StyleSheet.absoluteFill, 
            { 
              opacity: fadeAnim, 
              transform: [
                { translateX: pan.x },
                { translateY: pan.y },
                { scale: 1.15 } // Scaled up to hide viewport borders during shift
              ] 
            }
          ]} 
          resizeMode="cover"
        />
        <LinearGradient
          colors={['rgba(10,10,11,0.25)', 'rgba(10,10,11,0.65)', '#0A0A0B']}
          locations={[0, 0.45, 0.85]}
          style={StyleSheet.absoluteFill}
        />
      </View>

      {/* ── INTERACTIVE SNEAK PEEK VAULT (REVEALED ON SLIDE) ── */}
      <View style={s.peekContainer} pointerEvents="none">
        <LinearGradient
          colors={['rgba(201,168,76,0.15)', 'transparent']}
          style={s.peekGradient}
        />
        <Text style={s.peekTitle}>✨ ZENVY EXCLUSIVE VAULT</Text>
        <Text style={s.peekSubtitle}>Unlock the premium campus lifestyle</Text>

        <View style={s.peekCardRow}>
          <View style={s.peekMiniCard}>
            <Text style={{ fontSize: 22 }}>🍔</Text>
            <Text style={s.peekCardName}>Elite Bites</Text>
            <Text style={s.peekCardDesc}>Up to 50% Off</Text>
          </View>
          <View style={s.peekMiniCard}>
            <Text style={{ fontSize: 22 }}>🎁</Text>
            <Text style={s.peekCardName}>Daily Wheel</Text>
            <Text style={s.peekCardDesc}>Spin & Win coins</Text>
          </View>
          <View style={s.peekMiniCard}>
            <Text style={{ fontSize: 22 }}>⚡</Text>
            <Text style={s.peekCardName}>Supercharged</Text>
            <Text style={s.peekCardDesc}>Instant Delivery</Text>
          </View>
        </View>
      </View>

      <KeyboardAvoidingView style={{ flex: 1, zIndex: 10 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          
          {/* Logo & Brand Section with Parallax Effect */}
          <Animated.View style={[s.logoWrap, { transform: [{ translateX: Animated.multiply(pan.x, -0.3) }, { translateY: Animated.multiply(pan.y, -0.3) }] }]}>
            <BounceIn delay={200}>
              <View style={s.iconBadge}>
                <Text style={s.logoIcon}>✨</Text>
              </View>
            </BounceIn>
            <StaggeredSection delay={400} direction="down">
              <Text style={s.brand}>ZENVY</Text>
              <Text style={s.tagline}>PREMIUM CAMPUS DELIVERY</Text>
            </StaggeredSection>
          </Animated.View>

          {/* Login Form Sheet with Counter-Parallax and Spring sliding */}
          <Animated.View style={[
            s.card, 
            { 
              transform: [
                { translateY: Animated.add(slideUp, Animated.multiply(pan.y, -0.4)) },
                { translateX: Animated.multiply(pan.x, -0.4) }
              ] 
            }
          ]}>
            
            {/* Interactive Sneak Peek Trigger Pill */}
            <TouchableOpacity 
              style={[s.peekPill, isPeeked && { backgroundColor: 'rgba(239,79,95,0.12)', borderColor: 'rgba(239,79,95,0.4)' }]} 
              onPress={toggleSneakPeek}
              activeOpacity={0.8}
            >
              <Text style={[s.peekPillText, isPeeked && { color: COLORS.red }]}>
                {isPeeked ? '👇 CLOSE VAULT PREVIEW' : '✨ SNEAK PEEK INSIDE VAULT'}
              </Text>
            </TouchableOpacity>

            <StaggeredSection delay={100} direction="up">
              <Text style={s.cardTitle}>Welcome Back</Text>
              <Text style={s.cardSubtitle}>Sign in to your premium campus account</Text>

              <Text style={s.label}>PHONE NUMBER</Text>
              <TextInput 
                style={s.input} 
                value={phone} 
                onChangeText={setPhone} 
                placeholder="9876543210" 
                placeholderTextColor={COLORS.textMuted} 
                keyboardType="phone-pad" 
                autoCapitalize="none" 
              />

              <Text style={s.label}>PASSWORD</Text>
              <TextInput 
                style={s.input} 
                value={password} 
                onChangeText={setPassword} 
                placeholder="••••••••" 
                placeholderTextColor={COLORS.textMuted} 
                secureTextEntry 
              />

              {error ? <Text style={s.error}>{error}</Text> : null}

              <TouchableOpacity style={s.forgotBtn} onPress={() => router.push('/forgot-password' as any)}>
                <Text style={s.forgotText}>FORGOT PASSWORD?</Text>
              </TouchableOpacity>

              <TouchableOpacity style={s.loginBtn} onPress={handleLogin} disabled={loading}>
                {loading ? (
                  <ActivityIndicator color="#000" size="small" />
                ) : (
                  <Text style={s.loginBtnText}>SIGN IN</Text>
                )}
              </TouchableOpacity>

              <View style={s.orRow}>
                <View style={s.line} />
                <Text style={s.orText}>OR</Text>
                <View style={s.line} />
              </View>

              <TouchableOpacity style={s.googleBtn}>
                <Text style={s.googleIconG}>G</Text>
                <Text style={s.googleText}>Continue with Google</Text>
              </TouchableOpacity>

              <DopaminePressable onPress={() => router.push('/register' as any)} style={s.switchLink} sound="click">
                <Text style={s.switchText}>Don't have an account? <Text style={{ color: COLORS.gold, fontWeight: '800' }}>REGISTER</Text></Text>
              </DopaminePressable>
            </StaggeredSection>
          </Animated.View>

        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgDark },
  scroll: { flexGrow: 1, justifyContent: 'flex-end' },
  
  logoWrap: { alignItems: 'center', marginBottom: 20, marginTop: 45, paddingHorizontal: 24, zIndex: 5 },
  iconBadge: { width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(201, 168, 76, 0.1)', borderWidth: 1.5, borderColor: COLORS.goldBorder, alignItems: 'center', justifyContent: 'center', ...SHADOWS.goldGlow },
  logoIcon: { fontSize: 32 },
  brand: { fontSize: 36, fontWeight: '900', color: COLORS.gold, letterSpacing: 8, marginTop: 12, textShadowColor: 'rgba(201,168,76,0.3)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 8 },
  tagline: { fontSize: 8, fontWeight: '800', color: COLORS.textSecondary, letterSpacing: 4, marginTop: 4, textTransform: 'uppercase' },
  
  card: {
    backgroundColor: 'rgba(26,26,28,0.92)',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 24,
    paddingTop: 18,
    paddingBottom: Platform.OS === 'ios' ? 44 : 32,
    ...SHADOWS.card,
    zIndex: 15,
  },
  cardTitle: { fontSize: 20, fontWeight: '900', color: '#fff', letterSpacing: 0.5 },
  cardSubtitle: { fontSize: 10, color: COLORS.textSecondary, fontWeight: '600', marginTop: 4, marginBottom: 12, letterSpacing: 0.5 },
  
  // Interactive Sneak Peek
  peekPill: {
    alignSelf: 'center',
    backgroundColor: 'rgba(201,168,76,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(201,168,76,0.35)',
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 8,
    marginBottom: 16,
    shadowColor: COLORS.gold,
    shadowOpacity: 0.15,
    shadowRadius: 8,
  },
  peekPillText: { fontSize: 8, fontWeight: '900', color: COLORS.gold, letterSpacing: 1.5 },
  
  peekContainer: {
    position: 'absolute',
    bottom: 24,
    left: 0,
    right: 0,
    height: 310,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  peekGradient: {
    ...StyleSheet.absoluteFill,
    borderRadius: 24,
  },
  peekTitle: { fontSize: 13, fontWeight: '900', color: COLORS.gold, letterSpacing: 2, marginBottom: 4 },
  peekSubtitle: { fontSize: 8.5, color: COLORS.textSecondary, fontWeight: '700', marginBottom: 18 },
  peekCardRow: { flexDirection: 'row', gap: 10, width: '100%', justifyContent: 'center' },
  peekMiniCard: {
    flex: 1,
    backgroundColor: 'rgba(20,20,22,0.92)',
    padding: 14,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: 'rgba(201,168,76,0.22)',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 10,
  },
  peekCardName: { fontSize: 9.5, fontWeight: '900', color: '#fff', marginTop: 8 },
  peekCardDesc: { fontSize: 7.5, color: COLORS.textSecondary, fontWeight: '600', marginTop: 2 },

  label: { fontSize: 8, fontWeight: '800', color: COLORS.textSecondary, letterSpacing: 2.5, marginBottom: 6, marginTop: 12 },
  input: { backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: COLORS.borderDark, borderRadius: 14, padding: 14, fontSize: 13, color: '#fff', fontWeight: '600' },
  error: { color: '#EF4444', fontSize: 11, fontWeight: '600', marginTop: 8 },
  forgotBtn: { alignSelf: 'flex-end', marginTop: 10, padding: 2 },
  forgotText: { fontSize: 8, fontWeight: '900', color: COLORS.gold, letterSpacing: 1.5 },
  
  loginBtn: { backgroundColor: COLORS.gold, paddingVertical: 16, borderRadius: 14, alignItems: 'center', marginTop: 16, ...SHADOWS.goldGlow },
  loginBtnText: { fontSize: 11, fontWeight: '900', color: '#000', letterSpacing: 3 },
  
  orRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 18, gap: 10 },
  line: { flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.08)' },
  orText: { fontSize: 9, fontWeight: '900', color: COLORS.textMuted, letterSpacing: 1.5 },
  
  googleBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#fff', paddingVertical: 14, borderRadius: 14 },
  googleIconG: { fontSize: 16, fontWeight: '900', color: '#333' },
  googleText: { fontSize: 12, fontWeight: '700', color: '#111' },
  
  switchLink: { alignItems: 'center', marginTop: 20 },
  switchText: { fontSize: 11, color: COLORS.textSecondary },
});
