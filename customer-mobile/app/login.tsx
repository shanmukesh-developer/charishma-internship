import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Platform, ScrollView, Animated, Dimensions, ActivityIndicator, Modal, Keyboard } from 'react-native';
import { KeyboardAvoidingView } from '../components/KeyboardAvoidingView';
import { WebView } from 'react-native-webview';
import { GoogleSignin, isCancelledResponse, isErrorWithCode, statusCodes } from '@react-native-google-signin/google-signin';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, useIsFocused } from 'expo-router';
import { COLORS, SHADOWS } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { ENDPOINTS, API_URL } from '../constants/api';
import { useAuth } from '../context/AuthContext';
import { StaggeredSection, BounceIn } from '../components/AnimatedSection';
import { setToken, postAuth, normalizePhone, isValidIndianMobile, AuthResponse, NETWORK_ERROR_MESSAGE } from '../utils/auth';
import { usePhoneOtp, PhoneProof, isSmsSendFailure } from '../utils/phoneOtp';
import DopaminePressable, { ActionPressable } from '../components/DopaminePressable';
import ServerWakeupOverlay from '../components/ServerWakeupOverlay';
import CampusServicesMapModal from '../components/CampusServicesMapModal';
import TermsConsent from '../components/TermsConsent';
import { consentFields } from '../utils/legal';

const { width: SW, height: SH } = Dimensions.get('window');

const GOOGLE_WEB_CLIENT_ID = '785490473159-8u6m41d2u27icc02719pbdluouukru3t.apps.googleusercontent.com';

if (Platform.OS !== 'web') {
  try {
    GoogleSignin.configure({
      webClientId: GOOGLE_WEB_CLIENT_ID,
      offlineAccess: true,
    });
  } catch (e) {
    console.warn('[GOOGLE_SIGNIN] configure failed', e);
  }
}

// Zenvy brand visuals for the background slideshow
const IMAGES = [
  'https://images.unsplash.com/photo-1579871494447-9811cf80d66c?w=2000&q=90',
  'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=2000&q=90',
  'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=2000&q=90',
  'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=2000&q=90',
  'https://images.unsplash.com/photo-1551024709-8f23befc6f87?w=2000&q=90',
];

/** A Google sign-in that still needs a verified mobile number (POST /google-complete). */
interface GooglePending {
  googleToken: string;
  name: string;
  email: string;
}

export default function LoginScreen() {
  const router = useRouter();
  const { user, isLoading, setUser } = useAuth();
  const { isDark } = useTheme();
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (e) => setKeyboardHeight(e.endCoordinates.height)
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setKeyboardHeight(0)
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // Once signed in, return to the screen that sent the user here (basket, checkout...),
  // or to Home when login was the first screen. This is the only place that navigates away.
  const isFocused = useIsFocused();
  const navigatedRef = useRef(false);
  useEffect(() => {
    if (isLoading || !user || !isFocused || navigatedRef.current) return;
    navigatedRef.current = true;
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)' as any);
  }, [user, isLoading, isFocused]);

  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);
  const [showWakeup, setShowWakeup] = useState(false);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const [loginMethod, setLoginMethod] = useState<'password' | 'otp'>('password');
  const [otp, setOtp] = useState('');

  // Google sign-in waiting for a verified phone number
  const [googlePending, setGooglePending] = useState<GooglePending | null>(null);
  const [googleTermsAccepted, setGoogleTermsAccepted] = useState(false);
  const [googleName, setGoogleName] = useState('');

  // WebView fallback (only when the native Google SDK genuinely fails)
  const [authModalVisible, setAuthModalVisible] = useState(false);
  const [showServicesMap, setShowServicesMap] = useState(false);

  // Refs so the background auto-verification callback always sees the latest handlers
  const autoVerifyRef = useRef<(phone10: string, proof: PhoneProof) => void>(() => {});
  const phoneOtp = usePhoneOtp('auth', {
    onAutoVerified: (p, proof) => autoVerifyRef.current(p, proof),
  });

  // The SMS code could not be sent while finishing a Google sign-in: offer the code by email (Google address).
  const [smsFailed, setSmsFailed] = useState(false);

  const playSuccess = () => {
    try { require('../utils/sounds').playSound('success'); } catch {}
  };

  const runGuarded = async (fn: () => Promise<void>) => {
    if (busyRef.current) return; // double-tap protection
    busyRef.current = true;
    setLoading(true);
    setError('');
    try {
      await fn();
    } catch (e: any) {
      if (e?.isNetwork) {
        setShowWakeup(true);
        setError(NETWORK_ERROR_MESSAGE);
      } else {
        setError(e?.message && typeof e.message === 'string' && e.message.length < 140 ? e.message : 'Something went wrong. Please try again.');
      }
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setLoading(false);
    }
  };

  const startSession = async (data: any) => {
    await setToken(data.token);
    await setUser(data);
    playSuccess();
  };

  /** Handles every login-type response: session, new number (go create the account), or error. */
  const handleAuthResult = async (r: AuthResponse, phone10: string) => {
    if (r.ok && r.data?.token) {
      await startSession(r.data);
      return;
    }
    if (r.ok && r.data?.isNewUser && r.data?.registrationToken) {
      // Verified number without an account: only the name is left to ask (no second OTP).
      // (Register shows its own "number verified" header; no stale banner here if the user comes back.)
      setInfo('');
      setOtp('');
      phoneOtp.reset();
      router.push({
        pathname: '/register',
        params: { phone: r.data.phone || phone10, registrationToken: r.data.registrationToken },
      } as any);
      return;
    }
    if (r.code === 'SERVER_BUSY') setShowWakeup(true);
    if (r.code === 'OTP_LOCKED' || r.code === 'OTP_EXPIRED' || r.code === 'VERIFICATION_EXPIRED') {
      setOtp('');
    }
    phoneOtp.allowAutoRetry();
    setError(r.message);
  };

  // ── Password login ──────────────────────────────────────────────────────────
  const handleLogin = () => {
    const digits = normalizePhone(phone);
    if (!digits || !password) { setError('Please enter your mobile number and password.'); return; }
    if (!isValidIndianMobile(digits)) { setError('Please enter a valid 10-digit mobile number.'); return; }
    Keyboard.dismiss();
    setInfo('');
    runGuarded(async () => {
      const r = await postAuth(ENDPOINTS.login, { phone: digits, password });
      await handleAuthResult(r, digits);
    });
  };

  // ── OTP login ───────────────────────────────────────────────────────────────
  const handleSendOtp = () => {
    const digits = normalizePhone(phone);
    if (!isValidIndianMobile(digits)) { setError('Please enter a valid 10-digit mobile number.'); return; }
    Keyboard.dismiss();
    setInfo('');
    runGuarded(async () => {
      const r = await phoneOtp.send(digits);
      if (r.ok) {
        setOtp('');
        setInfo(r.message);
        setSmsFailed(false);
        playSuccess();
      } else {
        if (r.code === 'NETWORK') setShowWakeup(true);
        setSmsFailed(isSmsSendFailure(r));
        setError(r.message);
      }
    });
  };

  // Email backup for a first Google sign-in (the code goes to the Google address)
  const handleSendEmailCode = () => {
    const digits = normalizePhone(phone);
    if (!googlePending || !googlePending.email || !isValidIndianMobile(digits)) return;
    Keyboard.dismiss();
    setInfo('');
    runGuarded(async () => {
      const r = await phoneOtp.sendEmail(digits, googlePending.email);
      if (r.ok) {
        setOtp('');
        setSmsFailed(false);
        setInfo(r.message);
      } else {
        setError(r.message);
      }
    });
  };

  const loginWithProof = async (phone10: string, proof: PhoneProof) => {
    if ('emailOtp' in proof) throw new Error('Please sign in with your password, or try the SMS code again.');
    const r = 'otp' in proof
      ? await postAuth(ENDPOINTS.verifyOtp, { phone: phone10, otp: proof.otp })
      : await postAuth(ENDPOINTS.login, { phone: phone10, firebaseToken: proof.firebaseToken });
    await handleAuthResult(r, phone10);
  };

  const handleVerifyOtp = () => {
    const phone10 = phoneOtp.sentTo;
    if (!phone10) return;
    if (phoneOtp.mode !== 'firebase' && otp.replace(/\D/g, '').length !== 6) {
      setError('Enter the 6-digit code we sent you.');
      return;
    }
    if (googlePending && !googleTermsAccepted) {
      setError('Please tick the box to agree to the Terms of Service and Privacy Policy.');
      return;
    }
    Keyboard.dismiss();
    runGuarded(async () => {
      const proof = await phoneOtp.getProof(otp);
      if (googlePending) await completeGoogle(phone10, proof);
      else await loginWithProof(phone10, proof);
    });
  };

  // Android Firebase fallback verified the number by itself: finish without a typed code
  autoVerifyRef.current = (phone10, proof) => {
    runGuarded(async () => {
      if (googlePending) await completeGoogle(phone10, proof);
      else await loginWithProof(phone10, proof);
    });
  };

  const changeNumber = () => {
    phoneOtp.reset();
    setOtp('');
    setError('');
    setInfo('');
  };

  // ── Google ──────────────────────────────────────────────────────────────────
  const handleGoogleToken = async (googleToken: string) => {
    const r = await postAuth(ENDPOINTS.googleLogin, { firebaseToken: googleToken });
    if (r.ok && r.data?.token) {
      await startSession(r.data);
      return;
    }
    if (r.ok && r.data?.needsPhone) {
      // First Google sign-in: verify a mobile number once (riders call it), then finish
      setGooglePending({ googleToken, name: r.data.name || '', email: r.data.email || '' });
      setGoogleName(r.data.name || '');
      setLoginMethod('otp');
      phoneOtp.reset();
      setOtp('');
      setInfo(r.data.message || 'Almost there. Verify your mobile number to finish signing in with Google.');
      return;
    }
    if (r.code === 'SERVER_BUSY') setShowWakeup(true);
    setError(r.message || 'Google sign-in failed. Please try again.');
  };

  const completeGoogle = async (phone10: string, proof: PhoneProof) => {
    if (!googlePending) return;
    // C4: finishing Google sign-in may create the account, so the Terms box is required here.
    if (!googleTermsAccepted) {
      setError('Please tick the box to agree to the Terms of Service and Privacy Policy.');
      phoneOtp.allowAutoRetry();
      return;
    }
    const r = await postAuth(ENDPOINTS.googleComplete, {
      googleToken: googlePending.googleToken,
      phone: phone10,
      ...proof,
      ...(googleName.trim() ? { name: googleName.trim() } : {}),
      ...(await consentFields()),
    });
    if (r.ok && r.data?.token) {
      setGooglePending(null);
      await startSession(r.data);
      return;
    }
    if (r.code === 'SERVER_BUSY') setShowWakeup(true);
    if (r.status === 401 && !r.code) {
      // The Google token expired while the user was verifying: start Google again
      setGooglePending(null);
      phoneOtp.reset();
    }
    phoneOtp.allowAutoRetry();
    setError(r.message);
  };

  const cancelGoogle = () => {
    setGooglePending(null);
    setGoogleName('');
    changeNumber();
  };

  const handleGoogleLogin = () => {
    if (busyRef.current) return;
    setError('');
    setInfo('');
    runGuarded(async () => {
      let idToken: string | null | undefined;
      try {
        await GoogleSignin.hasPlayServices();
        const response = await GoogleSignin.signIn();
        if (isCancelledResponse(response)) return; // user backed out: stay on the login form
        idToken = response.data?.idToken;
        if (!idToken) throw new Error('No ID token');
      } catch (err: any) {
        if (isErrorWithCode(err) && (err.code === statusCodes.SIGN_IN_CANCELLED || err.code === statusCodes.IN_PROGRESS)) {
          return;
        }
        // The native Google SDK genuinely failed (Play Services missing, config error...): secure web fallback
        console.warn('[GOOGLE_NATIVE_FALLBACK]', err?.code || err?.message);
        setAuthModalVisible(true);
        return;
      }
      await handleGoogleToken(idToken);
    });
  };

  const handleAuthMessage = (event: any) => {
    let data: any;
    try {
      data = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    if (data?.type === 'GOOGLE_SUCCESS' && data.token) {
      setAuthModalVisible(false);
      runGuarded(() => handleGoogleToken(data.token));
    } else if (data?.type === 'OTP_SUCCESS' && data.token) {
      setAuthModalVisible(false);
      const digits = normalizePhone(data.phone || phone);
      runGuarded(async () => {
        const r = await postAuth(ENDPOINTS.login, { phone: digits, firebaseToken: data.token });
        await handleAuthResult(r, digits);
      });
    } else if (data?.type === 'AUTH_ERROR') {
      setAuthModalVisible(false);
      setError('Sign-in could not be completed. Please try the one-time code or your password.');
    }
  };

  // Background Slideshow Animation State
  const [imgIndex, setImgIndex] = useState(0);
  const fadeAnim = useRef(new Animated.Value(1)).current;

  // 3D Parallax Hover/Drag Coordinates (web)
  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;

  // Bottom Card Entrance
  const slideUp = useRef(new Animated.Value(280)).current;

  useEffect(() => {
    let swapTimer: ReturnType<typeof setTimeout> | null = null;
    const interval = setInterval(() => {
      Animated.sequence([
        Animated.timing(fadeAnim, { toValue: 0.15, duration: 900, useNativeDriver: true }),
        Animated.timing(fadeAnim, { toValue: 1, duration: 900, useNativeDriver: true }),
      ]).start();
      swapTimer = setTimeout(() => {
        setImgIndex((prev) => (prev + 1) % IMAGES.length);
      }, 900);
    }, 5000);

    Animated.spring(slideUp, {
      toValue: 0,
      useNativeDriver: true,
      friction: 8,
      tension: 30,
    }).start();

    return () => {
      clearInterval(interval);
      if (swapTimer) clearTimeout(swapTimer);
    };
  }, []);

  const inputStyle = [
    s.input,
    {
      backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : '#F8FAFC',
      borderColor: isDark ? COLORS.borderDark : '#CBD5E1',
      color: isDark ? '#FFF' : '#0F172A',
    },
  ];
  const labelColor = { color: isDark ? COLORS.textSecondary : '#475569' };
  const otpSent = !!phoneOtp.sentTo;
  const busy = loading || phoneOtp.sending;

  const renderOtpSection = () => (
    !otpSent ? (
      <>
        <Text style={[s.label, labelColor]}>Phone number</Text>
        <TextInput
          style={[inputStyle, { fontSize: 15, fontWeight: '700' }]}
          value={phone}
          onChangeText={(t) => { setPhone(t); if (error) setError(''); }}
          placeholder="10-digit mobile number"
          placeholderTextColor={isDark ? COLORS.textMuted : '#617088'}
          keyboardType="phone-pad"
          textContentType="telephoneNumber"
          autoComplete="tel"
          autoCapitalize="none"
          returnKeyType="done"
          onSubmitEditing={handleSendOtp}
          editable={!busy}
        />

        <ActionPressable style={[s.realtimeOtpBtn, busy && { opacity: 0.7 }]} onPress={handleSendOtp} disabled={busy} sound="click">
          {busy ? (
            <ActivityIndicator color="#000" size="small" />
          ) : (
            <Text style={s.realtimeOtpBtnText}>Send code</Text>
          )}
        </ActionPressable>
        {smsFailed && !!googlePending?.email && (
          <TouchableOpacity onPress={handleSendEmailCode} disabled={busy} style={{ marginTop: 14, alignSelf: 'center' }} accessibilityRole="button">
            <Text style={[s.linkText, { color: COLORS.gold, fontWeight: '800' }]}>Send the code by email instead</Text>
          </TouchableOpacity>
        )}
      </>
    ) : (
      <>
        <Text style={[s.label, labelColor]}>
          {phoneOtp.mode === 'email' ? `Enter the 6-digit code sent to ${phoneOtp.emailSentTo || 'your email'}` : `Enter the 6-digit code sent to +91 ${phoneOtp.sentTo}`}
        </Text>
        <TextInput
          style={[inputStyle, { letterSpacing: 8, textAlign: 'center', fontSize: 20, fontWeight: '900' }]}
          value={otp}
          onChangeText={(t) => { setOtp(t.replace(/\D/g, '')); if (error) setError(''); }}
          placeholder="••••••"
          placeholderTextColor={isDark ? COLORS.textMuted : '#617088'}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="sms-otp"
          maxLength={6}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={handleVerifyOtp}
          editable={!busy}
        />
        <ActionPressable style={[s.realtimeOtpBtn, busy && { opacity: 0.7 }]} onPress={handleVerifyOtp} disabled={busy} sound="click">
          {busy ? (
            <ActivityIndicator color="#000" size="small" />
          ) : (
            <Text style={s.realtimeOtpBtnText}>{googlePending ? 'Verify and finish' : 'Verify code'}</Text>
          )}
        </ActionPressable>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
          <TouchableOpacity onPress={changeNumber} disabled={busy} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={[s.linkText, { color: COLORS.textSecondary }]}>← Change number</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => { const p = phoneOtp.sentTo; if (p) { setPhone(p); runGuarded(async () => { const r = phoneOtp.mode === 'email' && googlePending?.email ? await phoneOtp.sendEmail(p, googlePending.email) : await phoneOtp.send(p); if (r.ok) { setOtp(''); setInfo(r.message); } else setError(r.message); }); } }}
            disabled={phoneOtp.countdown > 0 || busy}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={[s.linkText, { color: (phoneOtp.countdown > 0 || busy) ? (isDark ? COLORS.textMuted : '#617088') : COLORS.gold, fontWeight: '800' }]}>
              {phoneOtp.countdown > 0 ? `Resend in ${phoneOtp.countdown}s` : 'Resend code'}
            </Text>
          </TouchableOpacity>
        </View>
      </>
    )
  );

  return (
    <View
      {...({
        style: s.container,
        onMouseMove: (e: any) => {
          if (Platform.OS === 'web') {
            const { clientX, clientY } = e;
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
      {/* Server wake-up banner (cold start / offline) */}
      {showWakeup && (
        <ServerWakeupOverlay
          visible={showWakeup}
          onWakeupComplete={() => setShowWakeup(false)}
          offlineText="Still can't reach ZCS. Check your internet and try again."
        />
      )}

      <CampusServicesMapModal
        visible={showServicesMap}
        onClose={() => setShowServicesMap(false)}
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
                { scale: 1.15 }
              ]
            }
          ]}
          resizeMode="cover"
        />
        <LinearGradient
          colors={['rgba(0,0,0,0.15)', 'rgba(10,8,6,0.4)', 'rgba(10,8,6,0.75)']}
          locations={[0, 0.4, 0.85]}
          style={StyleSheet.absoluteFill}
        />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1, zIndex: 10 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={[
            s.scroll,
            { paddingBottom: Math.max(120, keyboardHeight + 80) }
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          showsVerticalScrollIndicator={false}
        >

          {/* Logo & Brand */}
          <Animated.View style={[s.logoWrap, { transform: [{ translateX: Animated.multiply(pan.x, -0.3) }, { translateY: Animated.multiply(pan.y, -0.3) }] }]}>
            <BounceIn delay={200}>
              <View style={s.iconBadge}>
                <Text style={s.logoIcon}>Z</Text>
              </View>
            </BounceIn>
            <StaggeredSection delay={400} direction="down">
              <Text style={s.brand}>ZCS</Text>
              <Text style={s.tagline}>Campus food and more</Text>
            </StaggeredSection>
          </Animated.View>

          {/* Login Form Sheet */}
          <Animated.View style={[
            s.card,
            {
              backgroundColor: isDark ? 'rgba(26,26,28,0.94)' : 'rgba(255,255,255,0.97)',
              borderColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0,0,0,0.08)',
              transform: [
                { translateY: Animated.add(slideUp, Animated.multiply(pan.y, -0.4)) },
                { translateX: Animated.multiply(pan.x, -0.4) }
              ]
            }
          ]}>

            <StaggeredSection delay={100} direction="up">
              {googlePending ? (
                <>
                  <Text style={[s.cardTitle, { color: isDark ? '#fff' : '#1A1A2E' }]}>
                    Almost there{googlePending.name ? `, ${googlePending.name.split(' ')[0]}` : ''}
                  </Text>
                  <Text style={[s.cardSubtitle, { color: isDark ? COLORS.textSecondary : '#617088' }]}>
                    Verify your mobile number once to finish signing in with Google{googlePending.email ? ` (${googlePending.email})` : ''}.
                  </Text>

                  {!googlePending.name ? (
                    <>
                      <Text style={[s.label, labelColor]}>Your name</Text>
                      <TextInput
                        style={inputStyle}
                        value={googleName}
                        onChangeText={setGoogleName}
                        placeholder="Your full name"
                        placeholderTextColor={isDark ? COLORS.textMuted : '#617088'}
                        autoCapitalize="words"
                        textContentType="name"
                        editable={!busy}
                      />
                    </>
                  ) : null}

                  <TermsConsent isDark={isDark} checked={googleTermsAccepted} onToggle={() => { setGoogleTermsAccepted(v => !v); if (error) setError(''); }} disabled={busy} />

                  {renderOtpSection()}

                  {info && !error ? <Text style={s.info}>{info}</Text> : null}
                  {error ? <Text style={s.error}>{error}</Text> : null}

                  <TouchableOpacity onPress={cancelGoogle} disabled={busy} style={{ alignSelf: 'center', marginTop: 18, padding: 6 }}>
                    <Text style={[s.linkText, { color: COLORS.textSecondary }]}>Cancel Google sign-in</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <Text style={[s.cardTitle, { color: isDark ? '#fff' : '#1A1A2E' }]}>Welcome back</Text>
                  <Text style={[s.cardSubtitle, { color: isDark ? COLORS.textSecondary : '#617088' }]}>Sign in to your campus account</Text>

                  {/* Login Method Tabs */}
                  <View style={s.tabRow}>
                    <DopaminePressable
                      style={[s.tabBtn, loginMethod === 'password' && s.tabBtnActive]}
                      onPress={() => { setLoginMethod('password'); setError(''); setInfo(''); }}
                      sound="click"
                    >
                      <Text style={[s.tabText, loginMethod === 'password' && s.tabTextActive]}>Password</Text>
                    </DopaminePressable>
                    <DopaminePressable
                      style={[s.tabBtn, loginMethod === 'otp' && s.tabBtnActive]}
                      onPress={() => { setLoginMethod('otp'); setError(''); setInfo(''); }}
                      sound="click"
                    >
                      <Text style={[s.tabText, loginMethod === 'otp' && s.tabTextActive]}>One-time code</Text>
                    </DopaminePressable>
                  </View>

                  {loginMethod === 'password' ? (
                    <>
                      <Text style={[s.label, labelColor]}>Phone number</Text>
                      <TextInput
                        style={[s.input, { backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : '#F8FAFC', borderColor: isDark ? COLORS.borderDark : '#E2E8F0', color: isDark ? '#fff' : '#1E293B' }]}
                        value={phone}
                        onChangeText={(t) => { setPhone(t); if (error) setError(''); }}
                        placeholder="10-digit mobile number"
                        placeholderTextColor={isDark ? COLORS.textMuted : '#617088'}
                        keyboardType="phone-pad"
                        textContentType="telephoneNumber"
                        autoComplete="tel"
                        autoCapitalize="none"
                        returnKeyType="next"
                        editable={!busy}
                      />

                      <Text style={[s.label, labelColor]}>Password</Text>
                      <TextInput
                        style={[s.input, { backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : '#F8FAFC', borderColor: isDark ? COLORS.borderDark : '#E2E8F0', color: isDark ? '#fff' : '#1E293B' }]}
                        value={password}
                        onChangeText={(t) => { setPassword(t); if (error) setError(''); }}
                        placeholder="Enter password"
                        placeholderTextColor={isDark ? COLORS.textMuted : '#617088'}
                        secureTextEntry
                        textContentType="password"
                        autoComplete="password"
                        returnKeyType="go"
                        onSubmitEditing={handleLogin}
                        editable={!busy}
                      />
                    </>
                  ) : (
                    <>
                      <Text style={[s.label, { textAlign: 'center', marginTop: 12, fontSize: 12, color: COLORS.textSecondary }]}>
                        We'll text you a 6-digit code. New here? We'll set up your account.
                      </Text>
                      {renderOtpSection()}
                    </>
                  )}

                  {info && !error ? <Text style={s.info}>{info}</Text> : null}
                  {error ? <Text style={s.error}>{error}</Text> : null}

                  {loginMethod === 'password' && (
                    <>
                      <TouchableOpacity style={s.forgotBtn} onPress={() => router.push('/forgot-password' as any)}>
                        <Text style={s.forgotText}>Forgot password?</Text>
                      </TouchableOpacity>

                      <ActionPressable style={[s.loginBtn, busy && { opacity: 0.7 }]} onPress={handleLogin} disabled={busy} sound="click">
                        {busy ? (
                          <ActivityIndicator color="#000" size="small" />
                        ) : (
                          <Text style={s.loginBtnText}>Sign in</Text>
                        )}
                      </ActionPressable>
                    </>
                  )}

                  {Platform.OS !== 'web' && (
                    <>
                      <View style={s.orRow}>
                        <View style={[s.line, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)' }]} />
                        <Text style={[s.orText, { color: isDark ? COLORS.textMuted : '#617088' }]}>or</Text>
                        <View style={[s.line, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)' }]} />
                      </View>

                      <DopaminePressable
                        style={[s.googleBtn, busy && { opacity: 0.7 }]}
                        onPress={handleGoogleLogin}
                        disabled={busy}
                        sound="click"
                      >
                        <Text style={s.googleIconG}>G</Text>
                        <Text style={s.googleText}>Continue with Google</Text>
                      </DopaminePressable>
                    </>
                  )}

                  <TermsConsent isDark={isDark} />

                  <DopaminePressable onPress={() => router.push('/register' as any)} style={s.switchLink} sound="click">
                    <Text style={s.switchText}>Don't have an account? <Text style={{ color: COLORS.gold, fontWeight: '800' }}>Sign up</Text></Text>
                  </DopaminePressable>

                  <TouchableOpacity
                    style={{
                      marginTop: 14,
                      paddingVertical: 10,
                      paddingHorizontal: 14,
                      borderRadius: 14,
                      backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : '#F8FAFC',
                      borderWidth: 1,
                      borderColor: isDark ? 'rgba(255,255,255,0.1)' : '#E2E8F0',
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8
                    }}
                    onPress={() => setShowServicesMap(true)}
                    activeOpacity={0.8}
                  >
                    <Text style={{ fontSize: 13 }}>🗺️</Text>
                    <Text style={{ fontSize: 12, fontWeight: '800', color: isDark ? '#FFF' : '#334155' }}>
                      New here? <Text style={{ color: '#3B82F6', fontWeight: '900' }}>See what ZCS does ➔</Text>
                    </Text>
                  </TouchableOpacity>
                </>
              )}
            </StaggeredSection>
          </Animated.View>

        </ScrollView>
      </KeyboardAvoidingView>

      {/* Secure web sign-in fallback (native only, when the Google SDK is unavailable) */}
      {Platform.OS !== 'web' && (
        <Modal
          visible={authModalVisible}
          animationType="slide"
          transparent={false}
          onRequestClose={() => setAuthModalVisible(false)}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={{ flex: 1, backgroundColor: '#0A0A0B' }}
          >
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
              <Text style={{ fontSize: 15, fontWeight: '800', color: COLORS.gold }}>Sign in with Google</Text>
              <TouchableOpacity
                onPress={() => setAuthModalVisible(false)}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: 8,
                  backgroundColor: 'rgba(255,255,255,0.08)'
                }}
              >
                <Text style={{ fontSize: 12, fontWeight: '800', color: '#fff' }}>Close</Text>
              </TouchableOpacity>
            </View>

            {authModalVisible && (
              <WebView
                source={{ uri: `${API_URL}/auth-helper?phone=${encodeURIComponent('+91' + normalizePhone(phone))}` }}
                onMessage={handleAuthMessage}
                style={{ flex: 1, backgroundColor: '#0A0A0B' }}
                javaScriptEnabled={true}
                domStorageEnabled={true}
                userAgent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
                startInLoadingState={true}
                onError={() => { setAuthModalVisible(false); setError(NETWORK_ERROR_MESSAGE); }}
                renderLoading={() => (
                  <View style={[StyleSheet.absoluteFill, { backgroundColor: '#0A0A0B', alignItems: 'center', justifyContent: 'center' }]}>
                    <ActivityIndicator size="large" color={COLORS.gold} />
                  </View>
                )}
              />
            )}
          </KeyboardAvoidingView>
        </Modal>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgDark },
  scroll: { 
    flexGrow: 1, 
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    paddingTop: Platform.OS === 'web' ? 20 : 10,
  },
  
  logoWrap: { 
    alignItems: 'center', 
    marginBottom: 20, 
    marginTop: Platform.OS === 'web' ? 30 : 45, 
    paddingHorizontal: 24, 
    zIndex: 5 
  },
  iconBadge: { width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(212, 175, 122, 0.1)', borderWidth: 1.5, borderColor: COLORS.goldBorder, alignItems: 'center', justifyContent: 'center', ...SHADOWS.goldGlow },
  logoIcon: { fontSize: 40, fontWeight: '300', fontStyle: 'italic', color: COLORS.gold, marginTop: Platform.OS === 'ios' ? 4 : 0 },
  brand: { fontSize: 36, fontWeight: '900', color: COLORS.gold, letterSpacing: 8, marginTop: 12, textShadowColor: COLORS.borderGold, textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 8 },
  tagline: { fontSize: 13, fontWeight: '600', color: COLORS.textSecondary, marginTop: 4 },
  
  card: {
    backgroundColor: 'rgba(26,26,28,0.94)',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    borderBottomLeftRadius: Platform.OS === 'web' ? 32 : 0,
    borderBottomRightRadius: Platform.OS === 'web' ? 32 : 0,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 24,
    paddingTop: 18,
    paddingBottom: Platform.OS === 'ios' ? 44 : 36,
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    marginBottom: Platform.OS === 'web' ? 24 : 0,
    ...SHADOWS.card,
    zIndex: 15,
  },
  cardTitle: { fontSize: 20, fontWeight: '900', color: '#fff', letterSpacing: 0.5 },
  cardSubtitle: { fontSize: 12, color: COLORS.textSecondary, fontWeight: '600', marginTop: 4, marginBottom: 12, letterSpacing: 0.5 },
  
  label: { fontSize: 13, fontWeight: '700', marginBottom: 6, marginTop: 12 },
  input: { borderWidth: 1, borderRadius: 14, padding: 14, fontSize: 15, fontWeight: '700' },
  error: { color: '#EF4444', fontSize: 12, fontWeight: '600', marginTop: 8 },
  forgotBtn: { alignSelf: 'flex-end', marginTop: 10, padding: 2 },
  forgotText: { fontSize: 13, fontWeight: '700', color: COLORS.gold },
  
  loginBtn: { backgroundColor: COLORS.gold, paddingVertical: 16, borderRadius: 14, alignItems: 'center', marginTop: 16, ...SHADOWS.goldGlow },
  loginBtnText: { fontSize: 15, fontWeight: '800', color: '#000' },
  
  orRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 18, gap: 10 },
  line: { flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.08)' },
  orText: { fontSize: 12, fontWeight: '700', color: COLORS.textMuted },
  
  googleBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#fff', paddingVertical: 14, borderRadius: 14 },
  googleIconG: { fontSize: 16, fontWeight: '900', color: '#333' },
  googleText: { fontSize: 12, fontWeight: '700', color: '#111' },
  
  switchLink: { alignItems: 'center', marginTop: 20 },
  switchText: { fontSize: 12, color: COLORS.textSecondary },

  tabRow: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 12, padding: 4, marginVertical: 14, borderWidth: 1, borderColor: COLORS.borderDark },
  tabBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 8 },
  tabBtnActive: { backgroundColor: 'rgba(201,168,76,0.15)', borderWidth: 1, borderColor: 'rgba(201,168,76,0.3)' },
  tabText: { fontSize: 13, fontWeight: '700', color: COLORS.textMuted },
  tabTextActive: { color: COLORS.gold },

  otpInputRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  sendOtpBtn: { backgroundColor: 'rgba(201,168,76,0.12)', borderWidth: 1, borderColor: 'rgba(201,168,76,0.4)', borderRadius: 14, paddingHorizontal: 16, height: 50, alignItems: 'center', justifyContent: 'center' },
  sendOtpText: { fontSize: 13, fontWeight: '800', color: COLORS.gold },

  realtimeOtpBtn: { backgroundColor: COLORS.gold, paddingVertical: 16, borderRadius: 14, alignItems: 'center', marginTop: 12, ...SHADOWS.goldGlow },
  realtimeOtpBtnText: { fontSize: 14, fontWeight: '800', color: '#000' },
  info: { color: '#10B981', fontSize: 12, fontWeight: '700', marginTop: 8 },
  linkText: { fontSize: 12, fontWeight: '700' },
});
