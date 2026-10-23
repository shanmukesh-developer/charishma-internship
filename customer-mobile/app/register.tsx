import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Platform, ScrollView, Animated, Dimensions, ActivityIndicator, Alert, Keyboard } from 'react-native';
import { KeyboardAvoidingView } from '../components/KeyboardAvoidingView';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, useIsFocused, useLocalSearchParams } from 'expo-router';
import { COLORS, SHADOWS } from '../constants/theme';
import { ENDPOINTS } from '../constants/api';
import { useAuth } from '../context/AuthContext';
import { StaggeredSection } from '../components/AnimatedSection';
import { setToken, postAuth, normalizePhone, isValidIndianMobile, NETWORK_ERROR_MESSAGE } from '../utils/auth';
import { usePhoneOtp, PhoneProof, isSmsSendFailure } from '../utils/phoneOtp';
import DopaminePressable, { ActionPressable } from '../components/DopaminePressable';
import ServerWakeupOverlay from '../components/ServerWakeupOverlay';
import TermsConsent from '../components/TermsConsent';
import { consentFields } from '../utils/legal';

import { useTheme } from '../context/ThemeContext';

const { width: SW, height: SH } = Dimensions.get('window');

// Zenvy brand visuals for the background slideshow
const IMAGES = [
  'https://images.unsplash.com/photo-1579871494447-9811cf80d66c?w=2000&q=90',
  'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=2000&q=90',
  'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=2000&q=90',
  'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=2000&q=90',
  'https://images.unsplash.com/photo-1551024709-8f23befc6f87?w=2000&q=90',
];

export default function RegisterScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ phone?: string; registrationToken?: string; ref?: string }>();
  const { user, isLoading, setUser } = useAuth();
  const { isDark } = useTheme();

  // A number already verified on the login screen (POST verify-otp / login → isNewUser)
  const [registrationToken, setRegistrationToken] = useState<string>(
    typeof params.registrationToken === 'string' ? params.registrationToken : ''
  );
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState(typeof params.phone === 'string' ? normalizePhone(params.phone) : '');
  const [password, setPassword] = useState('');
  // Invite code from a friend (Profile → Invite friends). Prefilled from a ?ref= link.
  const [referralCode, setReferralCode] = useState(typeof params.ref === 'string' ? params.ref.trim().toUpperCase().slice(0, 20) : '');
  const [showReferral, setShowReferral] = useState(typeof params.ref === 'string' && !!params.ref);
  const [referralError, setReferralError] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);
  const [showWakeup, setShowWakeup] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [otp, setOtp] = useState('');
  // C4: required Terms / Privacy checkbox on account creation.
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const autoVerifyRef = useRef<(phone10: string, proof: PhoneProof) => void>(() => {});
  const phoneOtp = usePhoneOtp('auth', {
    onAutoVerified: (p, proof) => autoVerifyRef.current(p, proof),
  });
  const isOtpSent = !!phoneOtp.sentTo;
  const phoneVerified = !!registrationToken;

  // Once the account exists, go back to where sign-in started (login pops itself too)
  const isFocused = useIsFocused();
  const navigatedRef = useRef(false);
  useEffect(() => {
    if (isLoading || !user || !isFocused || navigatedRef.current) return;
    navigatedRef.current = true;
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)' as any);
  }, [user, isLoading, isFocused]);

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

  // Background Slideshow Animation State
  const [imgIndex, setImgIndex] = useState(1);
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const slideUp = useRef(new Animated.Value(300)).current;

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

  const validateForm = () => {
    setError('');
    if (!name || name.trim().length < 2) {
      setError('Please enter your full name (at least 2 letters).');
      return false;
    }
    const cleanedPhone = normalizePhone(phone);
    if (!isValidIndianMobile(cleanedPhone)) {
      setError('Please enter a valid 10-digit mobile number.');
      return false;
    }
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Please enter a valid email address, or leave it empty.');
      return false;
    }
    if (password && password.length < 6) {
      setError('Password must be at least 6 characters (or leave it empty to sign in with OTP).');
      return false;
    }
    if (!acceptedTerms) {
      setError('Please tick the box to agree to the Terms of Service and Privacy Policy.');
      return false;
    }
    return true;
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

  // The SMS could not be sent: offer the code by email (to the email in this form).
  const [smsFailed, setSmsFailed] = useState(false);
  const handleSendOtp = () => {
    if (!validateForm()) return;
    Keyboard.dismiss();
    setInfo('');
    const cleanedPhone = normalizePhone(phone);
    runGuarded(async () => {
      const r = phoneOtp.mode === 'email' ? await phoneOtp.sendEmail(cleanedPhone, email) : await phoneOtp.send(cleanedPhone);
      if (r.ok) {
        setOtp('');
        setSmsFailed(false);
        setInfo(r.message);
        try { require('../utils/sounds').playSound('success'); } catch {}
      } else {
        if (r.code === 'NETWORK') setShowWakeup(true);
        if (phoneOtp.mode !== 'email') setSmsFailed(isSmsSendFailure(r));
        setError(r.message);
      }
    });
  };

  const handleSendEmailCode = () => {
    if (!validateForm()) return;
    const mail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) {
      setError('Enter your email address above, then tap "Send the code by email instead".');
      return;
    }
    Keyboard.dismiss();
    setInfo('');
    runGuarded(async () => {
      const r = await phoneOtp.sendEmail(normalizePhone(phone), mail);
      if (r.ok) {
        setOtp('');
        setSmsFailed(false);
        setInfo(r.message);
      } else {
        setError(r.message);
      }
    });
  };

  const submitRegistration = async (proof: PhoneProof | { registrationToken: string }) => {
    const cleanedPhone = normalizePhone(phone);
    const payload: any = {
      name: name.trim(),
      phone: cleanedPhone,
      ...proof,
    };
    if (password) payload.password = password;
    if (email.trim()) payload.email = email.trim().toLowerCase();
    if (referralCode.trim()) payload.referralCode = referralCode.trim().toUpperCase();
    Object.assign(payload, await consentFields());

    const r = await postAuth(ENDPOINTS.register, payload);
    if (r.ok && r.data?.token) {
      await setToken(r.data.token);
      await setUser(r.data);
      try { require('../utils/sounds').playSound('success'); } catch {}
      return;
    }

    phoneOtp.allowAutoRetry();
    if (r.code === 'SERVER_BUSY') setShowWakeup(true);
    if (r.code === 'PHONE_TAKEN') {
      setError(r.message);
      Alert.alert('You already have an account', r.message, [
        { text: 'Not now', style: 'cancel' },
        {
          text: 'Sign in',
          onPress: () => {
            if (router.canGoBack()) router.back();
            else router.replace('/login' as any);
          },
        },
      ]);
      return;
    }
    if (r.code === 'VERIFICATION_EXPIRED' || r.code === 'PHONE_MISMATCH') {
      // Verify the number again (the form stays filled in)
      setRegistrationToken('');
      phoneOtp.reset();
      setOtp('');
    }
    if (r.code === 'OTP_EXPIRED' || r.code === 'OTP_LOCKED') setOtp('');
    if (r.code === 'INVALID_REFERRAL') {
      // The OTP / verification is not used up: fix or clear the code and submit again.
      setShowReferral(true);
      setReferralError(r.message || 'That invite code does not exist. Check it or leave it empty.');
      return;
    }
    setError(r.message);
  };

  const handleRegister = () => {
    if (!validateForm()) return;
    Keyboard.dismiss();
    if (phoneVerified) {
      runGuarded(() => submitRegistration({ registrationToken }));
      return;
    }
    if (phoneOtp.mode !== 'firebase' && otp.replace(/\D/g, '').length !== 6) {
      setError('Enter the 6-digit code we sent to your phone.');
      return;
    }
    runGuarded(async () => {
      const proof = await phoneOtp.getProof(otp);
      await submitRegistration(proof);
    });
  };

  // Android Firebase fallback verified the number in the background: finish without a typed code
  autoVerifyRef.current = (_phone10, proof) => {
    if (!validateForm()) return;
    runGuarded(() => submitRegistration(proof));
  };

  const editDetails = () => {
    phoneOtp.reset();
    setOtp('');
    setError('');
    setInfo('');
  };

  const goToLogin = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/login' as any);
  };

  const busy = loading || phoneOtp.sending;
  const fieldsLocked = isOtpSent || busy;
  const inputStyle = [
    s.input,
    {
      backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : '#F9FAFB',
      borderColor: isDark ? COLORS.borderDark : '#E5E7EB',
      color: isDark ? '#FFF' : '#111827'
    }
  ];
  const labelColor = { color: isDark ? COLORS.textSecondary : '#4B5563' };

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
      <ServerWakeupOverlay
        visible={showWakeup}
        onWakeupComplete={() => setShowWakeup(false)}
        offlineText="Still can't reach Zenvy. Check your internet and try again."
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
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
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

          {/* Header Branding */}
          <Animated.View style={[s.logoWrap, { transform: [{ translateX: pan.x }, { translateY: pan.y }] }]}>
            <StaggeredSection delay={0} direction="down">
              <View style={s.iconBadge}>
                <Text style={s.logoIcon}>✨</Text>
              </View>
              <Text style={s.brand}>ZENVY</Text>
              <Text style={s.tagline}>Create your account</Text>
            </StaggeredSection>
          </Animated.View>

          {/* Registration Form Sheet */}
          <Animated.View style={[
            s.card,
            {
              backgroundColor: isDark ? 'rgba(26,26,28,0.95)' : '#FFFFFF',
              borderColor: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.08)',
              transform: [
                { translateY: Animated.add(slideUp, Animated.multiply(pan.y, -0.4)) },
                { translateX: Animated.multiply(pan.x, -0.4) }
              ]
            }
          ]}>
            <StaggeredSection delay={100} direction="up">
              <Text style={[s.cardTitle, { color: isDark ? '#FFF' : '#111827' }]}>
                {phoneVerified ? 'One last step 🎉' : 'Create Your Account'}
              </Text>
              <Text style={[s.cardSubtitle, { color: isDark ? COLORS.textSecondary : '#6B7280' }]}>
                {phoneVerified
                  ? 'Your number is verified. Tell us your name to finish.'
                  : 'Get campus food & essentials delivered to your hostel room'}
              </Text>

              <Text style={[s.label, labelColor]}>Full name</Text>
              <TextInput
                style={inputStyle}
                value={name}
                onChangeText={(t) => { setName(t); if (error) setError(''); }}
                placeholder="Enter your full name"
                placeholderTextColor={isDark ? COLORS.textMuted : '#9CA3AF'}
                autoCapitalize="words"
                textContentType="name"
                autoComplete="name"
                maxLength={60}
                autoFocus={phoneVerified}
                editable={!busy}
              />

              <Text style={[s.label, labelColor]}>Phone number</Text>
              {phoneVerified ? (
                <View style={[inputStyle, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: isDark ? '#FFF' : '#111827' }}>+91 {normalizePhone(phone)}</Text>
                  <Text style={{ fontSize: 12, fontWeight: '800', color: '#10B981' }}>Verified</Text>
                </View>
              ) : (
                <TextInput
                  style={inputStyle}
                  value={phone}
                  onChangeText={(t) => { setPhone(t); if (error) setError(''); }}
                  placeholder="10-digit mobile number"
                  placeholderTextColor={isDark ? COLORS.textMuted : '#9CA3AF'}
                  keyboardType="phone-pad"
                  textContentType="telephoneNumber"
                  autoComplete="tel"
                  editable={!fieldsLocked}
                />
              )}

              <Text style={[s.label, labelColor]}>Email (optional)</Text>
              <TextInput
                style={inputStyle}
                value={email}
                onChangeText={(t) => { setEmail(t); if (error) setError(''); }}
                placeholder="name@example.com"
                placeholderTextColor={isDark ? COLORS.textMuted : '#9CA3AF'}
                keyboardType="email-address"
                textContentType="emailAddress"
                autoComplete="email"
                autoCapitalize="none"
                editable={!busy}
              />

              {showReferral ? (
                <>
                  <Text style={[s.label, labelColor]}>Invite code (optional)</Text>
                  <TextInput
                    style={[inputStyle, referralError ? { borderColor: '#EF4444', borderWidth: 1.5 } : null]}
                    value={referralCode}
                    onChangeText={(t) => { setReferralCode(t.toUpperCase().replace(/\s/g, '').slice(0, 20)); if (referralError) setReferralError(''); if (error) setError(''); }}
                    placeholder="e.g. ZV-ABC123"
                    placeholderTextColor={isDark ? COLORS.textMuted : '#9CA3AF'}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    editable={!busy}
                  />
                  {referralError ? (
                    <Text style={{ color: '#EF4444', fontSize: 12, fontWeight: '700', marginTop: 4 }}>{referralError}</Text>
                  ) : (
                    <Text style={{ color: isDark ? COLORS.textMuted : '#6B7280', fontSize: 12, fontWeight: '600', marginTop: 4 }}>
                      You and your friend both get 50 ZenPoints.
                    </Text>
                  )}
                </>
              ) : (
                <TouchableOpacity onPress={() => setShowReferral(true)} disabled={busy} style={{ marginTop: 12, alignSelf: 'flex-start' }}>
                  <Text style={{ color: COLORS.gold, fontSize: 12, fontWeight: '800' }}>🎁 Have an invite code?</Text>
                </TouchableOpacity>
              )}

              <Text style={[s.label, labelColor]}>Password (optional)</Text>
              <TextInput
                style={inputStyle}
                value={password}
                onChangeText={(t) => { setPassword(t); if (error) setError(''); }}
                placeholder="Min 6 characters — or just use OTP"
                placeholderTextColor={isDark ? COLORS.textMuted : '#9CA3AF'}
                secureTextEntry
                textContentType="newPassword"
                autoComplete="password-new"
                editable={!busy}
              />

              {isOtpSent && !phoneVerified && (
                <View style={{ marginTop: 12 }}>
                  <Text style={[s.label, { color: COLORS.gold, fontWeight: '900' }]}>
                    {phoneOtp.mode === 'email' ? `Enter the 6-digit code sent to ${phoneOtp.emailSentTo || 'your email'}` : `Enter the 6-digit code sent to +91 ${phoneOtp.sentTo}`}
                  </Text>
                  <TextInput
                    style={[
                      s.input,
                      {
                        backgroundColor: isDark ? 'rgba(201,168,76,0.1)' : '#FEF3C7',
                        borderColor: COLORS.gold,
                        fontSize: 20,
                        letterSpacing: 6,
                        textAlign: 'center',
                        fontWeight: '900',
                        color: isDark ? '#FFF' : '#78350F'
                      }
                    ]}
                    value={otp}
                    onChangeText={(t) => { setOtp(t.replace(/\D/g, '')); if (error) setError(''); }}
                    placeholder="••••••"
                    placeholderTextColor={isDark ? COLORS.textMuted : '#B45309'}
                    keyboardType="number-pad"
                    textContentType="oneTimeCode"
                    autoComplete="sms-otp"
                    maxLength={6}
                    autoFocus
                    returnKeyType="done"
                    onSubmitEditing={handleRegister}
                    editable={!busy}
                  />
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                    <TouchableOpacity disabled={busy} onPress={editDetails} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Text style={{ fontSize: 12, fontWeight: '800', color: COLORS.gold }}>← Edit details</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      disabled={phoneOtp.countdown > 0 || busy}
                      onPress={handleSendOtp}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Text style={{ fontSize: 12, fontWeight: '800', color: (phoneOtp.countdown > 0 || busy) ? (isDark ? COLORS.textMuted : '#9CA3AF') : COLORS.gold }}>
                        {phoneOtp.countdown > 0 ? `Resend in ${phoneOtp.countdown}s` : 'Resend code'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {info && !error ? <Text style={s.info}>{info}</Text> : null}
              {error ? <Text style={s.error}>{error}</Text> : null}

              <TermsConsent isDark={isDark} checked={acceptedTerms} onToggle={() => { setAcceptedTerms(v => !v); if (error) setError(''); }} disabled={busy} />

              {phoneVerified || isOtpSent ? (
                <ActionPressable style={[s.regBtn, busy && { opacity: 0.7 }]} onPress={handleRegister} disabled={busy} sound="click">
                  {busy ? (
                    <ActivityIndicator color="#000" size="small" />
                  ) : (
                    <Text style={s.regBtnText}>{phoneVerified ? 'Create account' : 'Verify and create account'}</Text>
                  )}
                </ActionPressable>
              ) : (
                <ActionPressable style={[s.regBtn, busy && { opacity: 0.7 }]} onPress={handleSendOtp} disabled={busy} sound="click">
                  {busy ? (
                    <ActivityIndicator color="#000" size="small" />
                  ) : (
                    <Text style={s.regBtnText}>Verify phone and continue</Text>
                  )}
                </ActionPressable>
              )}
              {smsFailed && !isOtpSent && !phoneVerified && (
                <TouchableOpacity onPress={handleSendEmailCode} disabled={busy} style={{ marginTop: 14, alignSelf: 'center' }} accessibilityRole="button">
                  <Text style={{ fontSize: 14, fontWeight: '800', color: COLORS.gold }}>Send the code by email instead</Text>
                </TouchableOpacity>
              )}

              <DopaminePressable onPress={goToLogin} style={s.switchLink} sound="click">
                <Text style={[s.switchText, { color: isDark ? COLORS.textSecondary : '#6B7280' }]}>
                  Already have an account? <Text style={{ color: COLORS.gold, fontWeight: '800' }}>Sign in</Text>
                </Text>
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
    marginTop: Platform.OS === 'web' ? 30 : 40, 
    paddingHorizontal: 24, 
    zIndex: 5 
  },
  iconBadge: { width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(212, 175, 122, 0.1)', borderWidth: 1.5, borderColor: COLORS.goldBorder, alignItems: 'center', justifyContent: 'center', ...SHADOWS.goldGlow },
  logoIcon: { fontSize: 28 },
  brand: { fontSize: 32, fontWeight: '900', color: COLORS.gold, letterSpacing: 8, marginTop: 10, textShadowColor: COLORS.borderGold, textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 8 },
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
    paddingTop: 24,
    paddingBottom: Platform.OS === 'ios' ? 44 : 36,
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    marginBottom: Platform.OS === 'web' ? 24 : 0,
    ...SHADOWS.card,
    zIndex: 15,
  },
  cardTitle: { fontSize: 20, fontWeight: '900', color: '#fff', letterSpacing: 0.5 },
  cardSubtitle: { fontSize: 12, color: COLORS.textSecondary, fontWeight: '600', marginTop: 4, marginBottom: 8, letterSpacing: 0.5 },
  
  label: { fontSize: 13, fontWeight: '700', color: COLORS.textSecondary, marginBottom: 5, marginTop: 10 },
  input: { backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: COLORS.borderDark, borderRadius: 14, padding: 13, fontSize: 13, color: '#fff', fontWeight: '600' },
  error: { color: '#EF4444', fontSize: 12, fontWeight: '600', marginTop: 8 },
  info: { color: '#10B981', fontSize: 12, fontWeight: '700', marginTop: 8 },
  
  regBtn: { backgroundColor: COLORS.gold, paddingVertical: 16, borderRadius: 14, alignItems: 'center', marginTop: 20, ...SHADOWS.goldGlow },
  regBtnText: { fontSize: 15, fontWeight: '800', color: '#000' },
  
  switchLink: { alignItems: 'center', marginTop: 20 },
  switchText: { fontSize: 12, color: COLORS.textSecondary },
});
