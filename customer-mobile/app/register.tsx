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

// Local premium 8K assets
const IMAGES = [
  require('../assets/steak.png'),
  require('../assets/sushi.png'),
  require('../assets/pizza.png'),
  require('../assets/drone.png'),
];

export default function RegisterScreen() {
  const router = useRouter();
  const { setUser } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Background Slideshow Animation State
  const [imgIndex, setImgIndex] = useState(1); // offset starting image
  const fadeAnim = useRef(new Animated.Value(1)).current;

  // 3D Parallax Hover/Drag Coordinates
  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;

  // Bottom Card Entrance Animation State
  const slideUp = useRef(new Animated.Value(300)).current;

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

  const handleRegister = async () => {
    if (!name || !phone || !password) { setError('Please fill in all required fields (Name, Phone, Password)'); return; }
    setLoading(true); setError('');
    try {
      const payload: any = { name, phone, password };
      if (email.trim()) payload.email = email.trim();

      const res = await fetch(ENDPOINTS.register, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok) {
        if (data.token) {
          await setToken(data.token);
        }
        await setUser(data.user || data);
        router.replace('/(tabs)' as any);
      } else {
        setError(data.message || 'Registration failed');
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
          source={IMAGES[imgIndex]} 
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
              <Text style={s.tagline}>CREATE YOUR ACCOUNT</Text>
            </StaggeredSection>
          </Animated.View>

          {/* Registration Form Sheet with Counter-Parallax */}
          <Animated.View style={[
            s.card, 
            { 
              transform: [
                { translateY: Animated.add(slideUp, Animated.multiply(pan.y, -0.4)) },
                { translateX: Animated.multiply(pan.x, -0.4) }
              ] 
            }
          ]}>
            <StaggeredSection delay={100} direction="up">
              <Text style={s.cardTitle}>Join Zenvy</Text>
              <Text style={s.cardSubtitle}>Get elite food and services delivered instantly</Text>

              <Text style={s.label}>FULL NAME</Text>
              <TextInput 
                style={s.input} 
                value={name} 
                onChangeText={setName} 
                placeholder="Sanya Gupta" 
                placeholderTextColor={COLORS.textMuted} 
              />

              <Text style={s.label}>EMAIL</Text>
              <TextInput 
                style={s.input} 
                value={email} 
                onChangeText={setEmail} 
                placeholder="your@email.com" 
                placeholderTextColor={COLORS.textMuted} 
                keyboardType="email-address" 
                autoCapitalize="none" 
              />

              <Text style={s.label}>PHONE</Text>
              <TextInput 
                style={s.input} 
                value={phone} 
                onChangeText={setPhone} 
                placeholder="+91 98765 43210" 
                placeholderTextColor={COLORS.textMuted} 
                keyboardType="phone-pad" 
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

              <TouchableOpacity style={s.regBtn} onPress={handleRegister} disabled={loading}>
                {loading ? (
                  <ActivityIndicator color="#000" size="small" />
                ) : (
                  <Text style={s.regBtnText}>CREATE ACCOUNT</Text>
                )}
              </TouchableOpacity>

              <DopaminePressable onPress={() => router.push('/login' as any)} style={s.switchLink} sound="click">
                <Text style={s.switchText}>Already have an account? <Text style={{ color: COLORS.gold, fontWeight: '800' }}>SIGN IN</Text></Text>
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
  
  logoWrap: { alignItems: 'center', marginBottom: 20, marginTop: 40, paddingHorizontal: 24, zIndex: 5 },
  iconBadge: { width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(201, 168, 76, 0.1)', borderWidth: 1.5, borderColor: COLORS.goldBorder, alignItems: 'center', justifyContent: 'center', ...SHADOWS.goldGlow },
  logoIcon: { fontSize: 28 },
  brand: { fontSize: 32, fontWeight: '900', color: COLORS.gold, letterSpacing: 8, marginTop: 10, textShadowColor: 'rgba(201,168,76,0.3)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 8 },
  tagline: { fontSize: 8, fontWeight: '800', color: COLORS.textSecondary, letterSpacing: 3, marginTop: 4, textTransform: 'uppercase' },
  
  card: {
    backgroundColor: 'rgba(26,26,28,0.92)',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: Platform.OS === 'ios' ? 44 : 32,
    ...SHADOWS.card,
    zIndex: 15,
  },
  cardTitle: { fontSize: 20, fontWeight: '900', color: '#fff', letterSpacing: 0.5 },
  cardSubtitle: { fontSize: 10, color: COLORS.textSecondary, fontWeight: '600', marginTop: 4, marginBottom: 8, letterSpacing: 0.5 },
  
  label: { fontSize: 8, fontWeight: '800', color: COLORS.textSecondary, letterSpacing: 2.5, marginBottom: 5, marginTop: 10 },
  input: { backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: COLORS.borderDark, borderRadius: 14, padding: 13, fontSize: 13, color: '#fff', fontWeight: '600' },
  error: { color: '#EF4444', fontSize: 11, fontWeight: '600', marginTop: 8 },
  
  regBtn: { backgroundColor: COLORS.gold, paddingVertical: 16, borderRadius: 14, alignItems: 'center', marginTop: 20, ...SHADOWS.goldGlow },
  regBtnText: { fontSize: 11, fontWeight: '900', color: '#000', letterSpacing: 3 },
  
  switchLink: { alignItems: 'center', marginTop: 20 },
  switchText: { fontSize: 11, color: COLORS.textSecondary },
});
