import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ScrollView, Animated, Dimensions, ActivityIndicator, Alert, Modal } from 'react-native';
import { WebView } from 'react-native-webview';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { COLORS, SHADOWS } from '../constants/theme';
import { ENDPOINTS, API_URL } from '../constants/api';
import { useAuth } from '../context/AuthContext';
import { StaggeredSection, BounceIn } from '../components/AnimatedSection';
import { setToken } from '../utils/auth';
import DopaminePressable from '../components/DopaminePressable';
import ServerWakeupOverlay from '../components/ServerWakeupOverlay';

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
  const [showWakeup, setShowWakeup] = useState(false);

  // OTP Login Flow States
  const [loginMethod, setLoginMethod] = useState<'password' | 'otp'>('password');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [countdown, setCountdown] = useState(0);

  // WebView Real-time Auth Gateway States
  const [authModalVisible, setAuthModalVisible] = useState(false);

  useEffect(() => {
    if (countdown <= 0) return;
    const interval = setInterval(() => {
      setCountdown(c => c - 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [countdown]);

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

  const handleSendOtp = () => {
    const digits = phone.replace(/\D/g, '').slice(-10);
    if (digits.length < 10) {
      setError('Please enter a valid 10-digit phone number');
      return;
    }
    setError('');
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      setOtpSent(true);
      setCountdown(60);
      Alert.alert(
        'OTP Sent Successfully',
        `Verification code for ${digits === '9391955674' || digits === '919391955674' ? 'kunjamshanmukesh@gmail.com' : 'your phone number'} is: 000000`,
        [{ text: 'OK' }]
      );
    }, 1000);
  };

  const handleLogin = async () => {
    if (loginMethod === 'otp') {
      // Open the real Firebase auth-helper WebView for phone OTP verification
      const digits = phone.replace(/\D/g, '').slice(-10);
      if (digits.length < 10) { setError('Please enter a valid 10-digit phone number'); return; }
      setAuthModalVisible(true);
      return;
    }

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
    } catch (e: any) { 
      if (e.message && (e.message.includes('Network') || e.message.includes('Failed to fetch') || e.message.includes('JSON'))) {
        setShowWakeup(true);
      } else {
        setError(`Network error: ${e.message || 'Server waking up. Try again.'}`); 
      }
    }
    finally { setLoading(false); }
  };

  const handleAuthMessage = async (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'GOOGLE_SUCCESS') {
        setAuthModalVisible(false);
        setLoading(true);
        setError('');
        const res = await fetch(`${API_URL}/api/users/google-login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ firebaseToken: data.token }),
        });
        const resData = await res.json();
        if (res.ok && resData.token) {
          await setToken(resData.token);
          await setUser(resData.user || resData);
          const { playSound } = require('../utils/sounds');
          playSound('success');
          router.replace('/(tabs)' as any);
        } else {
          setError(resData.message || 'Google Sign-In failed');
        }
      } else if (data.type === 'OTP_SUCCESS') {
        setAuthModalVisible(false);
        setLoading(true);
        setError('');
        const res = await fetch(ENDPOINTS.login, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: data.phone, firebaseToken: data.token }),
        });
        const resData = await res.json();
        if (res.ok && resData.token) {
          await setToken(resData.token);
          await setUser(resData.user || resData);
          const { playSound } = require('../utils/sounds');
          playSound('success');
          router.replace('/(tabs)' as any);
        } else {
          setError(resData.message || 'OTP verification failed');
        }
      }
    } catch (e: any) {
      setError(`Auth failed: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setError('');
    setAuthModalVisible(true);
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
      <ServerWakeupOverlay 
        visible={showWakeup} 
        onWakeupComplete={() => {
          setShowWakeup(false);
          handleLogin();
        }} 
      />

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

      <KeyboardAvoidingView style={{ flex: 1, zIndex: 10 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
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

              {/* Login Method Tabs */}
              <View style={s.tabRow}>
                <TouchableOpacity 
                  style={[s.tabBtn, loginMethod === 'password' && s.tabBtnActive]} 
                  onPress={() => { setLoginMethod('password'); setError(''); }}
                >
                  <Text style={[s.tabText, loginMethod === 'password' && s.tabTextActive]}>PASSWORD LOGIN</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[s.tabBtn, loginMethod === 'otp' && s.tabBtnActive]} 
                  onPress={() => { setLoginMethod('otp'); setError(''); }}
                >
                  <Text style={[s.tabText, loginMethod === 'otp' && s.tabTextActive]}>OTP LOGIN</Text>
                </TouchableOpacity>
              </View>

              {loginMethod === 'password' ? (
                <>
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
                </>
              ) : (
                <>
                  <Text style={[s.label, { textAlign: 'center', marginTop: 12, fontSize: 10, color: COLORS.textSecondary }]}>
                    Authenticate securely using real-time Firebase SMS verification.
                  </Text>
                  
                  <TouchableOpacity 
                    style={s.realtimeOtpBtn} 
                    onPress={() => { setError(''); setAuthModalVisible(true); }}
                    disabled={loading}
                  >
                    <Text style={s.realtimeOtpBtnText}>START REAL-TIME SMS LOGIN</Text>
                  </TouchableOpacity>
                </>
              )}

              {error ? <Text style={s.error}>{error}</Text> : null}

              {loginMethod === 'password' && (
                <TouchableOpacity style={s.forgotBtn} onPress={() => router.push('/forgot-password' as any)}>
                  <Text style={s.forgotText}>FORGOT PASSWORD?</Text>
                </TouchableOpacity>
              )}

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

              <TouchableOpacity 
                style={s.googleBtn} 
                onPress={handleGoogleLogin} 
                disabled={loading}
              >
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

      {/* Real-time Auth Gateway Modal */}
      <Modal
        visible={authModalVisible}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setAuthModalVisible(false)}
      >
        <KeyboardAvoidingView 
          behavior={Platform.OS === 'ios' ? 'padding' : undefined} 
          style={{ flex: 1, backgroundColor: '#0A0A0B' }}
        >
          {/* Header */}
          <View style={{ 
            flexDirection: 'row', 
            alignItems: 'center', 
            justifyContent: 'space-between', 
            paddingHorizontal: 20, 
            paddingTop: Platform.OS === 'ios' ? 50 : 20, 
            paddingBottom: 15,
            borderBottomWidth: 1,
            borderBottomColor: 'rgba(255,255,255,0.08)'
          }}>
            <Text style={{ fontSize: 13, fontWeight: '900', color: COLORS.gold, letterSpacing: 2 }}>ZENVY SECURE AUTH</Text>
            <TouchableOpacity 
              onPress={() => setAuthModalVisible(false)}
              style={{ 
                paddingHorizontal: 12, 
                paddingVertical: 6, 
                borderRadius: 8, 
                backgroundColor: 'rgba(255,255,255,0.08)' 
              }}
            >
              <Text style={{ fontSize: 11, fontWeight: '800', color: '#fff' }}>CLOSE</Text>
            </TouchableOpacity>
          </View>
          
          <WebView
            source={{ uri: `${API_URL}/auth-helper?phone=${encodeURIComponent('+91' + phone.replace(/\D/g, '').slice(-10))}` }}
            onMessage={handleAuthMessage}
            style={{ flex: 1, backgroundColor: '#0A0A0B' }}
            javaScriptEnabled={true}
            domStorageEnabled={true}
            userAgent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
            startInLoadingState={true}
            renderLoading={() => (
              <View style={{ ...StyleSheet.absoluteFill, backgroundColor: '#0A0A0B', alignItems: 'center', justifyContent: 'center' }}>
                <ActivityIndicator size="large" color={COLORS.gold} />
              </View>
            )}
          />
        </KeyboardAvoidingView>
      </Modal>
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
    paddingBottom: Platform.OS === 'ios' ? 44 : 80,
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

  tabRow: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 12, padding: 4, marginVertical: 14, borderWidth: 1, borderColor: COLORS.borderDark },
  tabBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 8 },
  tabBtnActive: { backgroundColor: 'rgba(201,168,76,0.15)', borderWidth: 1, borderColor: 'rgba(201,168,76,0.3)' },
  tabText: { fontSize: 9, fontWeight: '800', color: COLORS.textMuted, letterSpacing: 1.5 },
  tabTextActive: { color: COLORS.gold },

  otpInputRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  sendOtpBtn: { backgroundColor: 'rgba(201,168,76,0.12)', borderWidth: 1, borderColor: 'rgba(201,168,76,0.4)', borderRadius: 14, paddingHorizontal: 16, height: 50, alignItems: 'center', justifyContent: 'center' },
  sendOtpText: { fontSize: 8.5, fontWeight: '900', color: COLORS.gold, letterSpacing: 1 },

  realtimeOtpBtn: { backgroundColor: COLORS.gold, paddingVertical: 16, borderRadius: 14, alignItems: 'center', marginTop: 12, ...SHADOWS.goldGlow },
  realtimeOtpBtnText: { fontSize: 10, fontWeight: '900', color: '#000', letterSpacing: 2 },
});
