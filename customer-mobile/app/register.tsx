import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Platform, ScrollView, Animated, Dimensions, ActivityIndicator, Alert, Keyboard } from 'react-native';
import { KeyboardAvoidingView } from '../components/KeyboardAvoidingView';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, useIsFocused, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SHADOWS } from '../constants/theme';
import { useDietLight } from '../components/local/dietLightTheme';
import { ENDPOINTS, API_URL } from '../constants/api';
import { useAuth } from '../context/AuthContext';
import { StaggeredSection } from '../components/AnimatedSection';
import { setToken, postAuth, normalizePhone, isValidIndianMobile, NETWORK_ERROR_MESSAGE } from '../utils/auth';
import { usePhoneOtp, PhoneProof, isSmsSendFailure, EMAIL_SIGNUP_CODES } from '../utils/phoneOtp';
import DopaminePressable, { ActionPressable } from '../components/DopaminePressable';
import ServerWakeupOverlay from '../components/ServerWakeupOverlay';
import ZenvBadge from '../components/ZenvBadge';
import { consentFields, openLegal } from '../utils/legal';
import { getReferrerPromoCode, signupAttributionFields } from '../utils/promoInstall';

import { useTheme } from '../context/ThemeContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
  const { isDark, colors } = useTheme();
  const d = useDietLight();

  // A number already verified on the login screen (POST verify-otp / login → isNewUser)
  const [registrationToken, setRegistrationToken] = useState<string>(
    typeof params.registrationToken === 'string' ? params.registrationToken : ''
  );
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState(typeof params.phone === 'string' ? normalizePhone(params.phone) : '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  // Invite code from a friend (Profile → Invite friends). Prefilled from a ?ref= link.
  const [referralCode, setReferralCode] = useState(typeof params.ref === 'string' ? params.ref.trim().toUpperCase().slice(0, 20) : '');
  const [showReferral, setShowReferral] = useState(typeof params.ref === 'string' && !!params.ref);
  const [referralError, setReferralError] = useState('');
  // Promoter referral code (optional). Prefilled when the Play install link carried one (utils/promoInstall);
  // an invalid code is pointed out but never blocks sign-up.
  const [promoCode, setPromoCode] = useState('');
  const [promoError, setPromoError] = useState('');
  const promoTouchedRef = useRef(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);
  const [showWakeup, setShowWakeup] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [otp, setOtp] = useState('');
  // C4: required Terms / Privacy checkbox on account creation.
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [focusedField, setFocusedField] = useState<'name' | 'phone' | 'email' | 'password' | 'confirmPassword' | 'referral' | 'promo' | null>(null);

  const isNameValid = name.trim().length >= 2;
  const isPhoneValid = normalizePhone(phone).length === 10;
  const isEmailValid = !email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const isPasswordValid = password.length >= 6;
  const doPasswordsMatch = confirmPassword.length > 0 && confirmPassword === password;

  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  useEffect(() => {
    getReferrerPromoCode().then((code) => {
      if (code && mountedRef.current && !promoTouchedRef.current) setPromoCode(code);
    }).catch(() => {});
  }, []);

  const PROMO_INVALID = "That referral code isn't valid";
  const checkPromoCode = async () => {
    const code = promoCode.trim().toUpperCase();
    if (!code) { setPromoError(''); return; }
    if (!/^[A-Z0-9]{4,16}$/.test(code)) { setPromoError(PROMO_INVALID); return; }
    try {
      const res = await fetch(`${API_URL}/api/promo/check/${encodeURIComponent(code)}`);
      const data = await res.json().catch(() => null);
      if (mountedRef.current && res.ok && data && data.valid === false && promoCode.trim().toUpperCase() === code) setPromoError(PROMO_INVALID);
    } catch { /* offline: the server checks it at sign-up */ }
  };

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
    if (!password || password.length < 6) {
      setError('Password is required and must be at least 6 characters.');
      return false;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match. Please re-enter.');
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
    if (promoCode.trim()) payload.promoCode = promoCode.trim().toUpperCase();
    Object.assign(payload, await consentFields(), await signupAttributionFields().catch(() => ({})));

    const r = await postAuth(ENDPOINTS.register, payload);
    if (r.ok && r.data?.token) {
      await setToken(r.data.token);
      await setUser(r.data);
      try { require('../utils/sounds').playSound('success'); } catch {}
      if (r.data?.promo === 'invalid') Alert.alert('Account created', `${PROMO_INVALID}, so it wasn't applied.`);
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

  const insets = useSafeAreaInsets();
  const busy = loading || phoneOtp.sending;
  const fieldsLocked = isOtpSent || busy;

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
        offlineText="Still can't reach ZenWe. Check your internet and try again."
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

          {/* Clean Brand Header: the ZenWe badge (brand, 4 Nov 2026) */}
          <View style={s.brandHeaderWrap} accessible accessibilityRole="header" accessibilityLabel="ZenWe">
            <ZenvBadge size={56} lift />
            <Text style={s.brandTitle}>ZenWe</Text>
          </View>

          {/* Registration Form Sheet */}
          <Animated.View style={[
            s.card,
            {
              backgroundColor: isDark ? '#141417' : '#FFFFFF',
              borderColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)',
              transform: [
                { translateY: Animated.add(slideUp, Animated.multiply(pan.y, -0.4)) },
                { translateX: Animated.multiply(pan.x, -0.4) }
              ]
            }
          ]}>
            <StaggeredSection delay={100} direction="up">
              <Text style={[s.cardTitle, { color: isDark ? '#FFFFFF' : '#0F172A' }]}>
                {phoneVerified ? 'One last step' : 'Create Your Account'}
              </Text>
              <Text style={[s.cardSubtitle, { color: isDark ? '#94A3B8' : '#64748B' }]}>
                {phoneVerified
                  ? 'Your phone is verified. Enter your name to finish.'
                  : 'Join your campus food & essentials network'}
              </Text>

              {/* Full Name */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={[s.fieldLabel, { color: isDark ? '#E2E8F0' : '#334155' }]}>Full name</Text>
                {name.length > 0 && (
                  <Text style={{ fontSize: 11, fontWeight: '700', color: isNameValid ? '#10B981' : '#EF4444' }}>
                    {isNameValid ? '✓ Valid' : 'Min 2 characters'}
                  </Text>
                )}
              </View>
              <View style={[
                s.inputWrapper,
                {
                  backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : '#F8FAFC',
                  borderColor: focusedField === 'name' ? d.acc : (isDark ? 'rgba(255,255,255,0.1)' : '#E2E8F0')
                }
              ]}>
                <Ionicons name="person-outline" size={18} color={isDark ? '#94A3B8' : '#64748B'} style={{ marginLeft: 14, marginRight: 8 }} />
                <TextInput
                  style={[s.inputText, { color: isDark ? '#FFFFFF' : '#0F172A' }]}
                  value={name}
                  onChangeText={(t) => { setName(t); if (error) setError(''); }}
                  placeholder="Enter your full name"
                  placeholderTextColor={isDark ? '#71717A' : '#94A3B8'}
                  autoCapitalize="words"
                  textContentType="name"
                  autoComplete="name"
                  maxLength={60}
                  autoFocus={phoneVerified}
                  onFocus={() => setFocusedField('name')}
                  onBlur={() => setFocusedField(null)}
                  editable={!busy}
                />
                {isNameValid && (
                  <View style={{ paddingRight: 12 }}>
                    <Ionicons name="checkmark-circle" size={18} color="#10B981" />
                  </View>
                )}
              </View>

              {/* Phone Number */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
                <Text style={[s.fieldLabel, { color: isDark ? '#E2E8F0' : '#334155' }]}>Phone number</Text>
                {!phoneVerified && phone.length > 0 && (
                  <Text style={{ fontSize: 11, fontWeight: '700', color: isPhoneValid ? '#10B981' : '#EF4444' }}>
                    {isPhoneValid ? '✓ 10 digits' : `${phone.length}/10 digits`}
                  </Text>
                )}
              </View>

              {phoneVerified ? (
                <View style={[s.inputWrapper, { backgroundColor: isDark ? 'rgba(16, 185, 129, 0.08)' : '#ECFDF5', borderColor: '#10B981' }]}>
                  <Ionicons name="call-outline" size={18} color="#10B981" style={{ marginLeft: 14, marginRight: 8 }} />
                  <Text style={{ flex: 1, fontSize: 15, fontWeight: '700', color: isDark ? '#FFFFFF' : '#065F46' }}>+91 {normalizePhone(phone)}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingRight: 12 }}>
                    <Ionicons name="checkmark-circle" size={18} color="#10B981" />
                    <Text style={{ fontSize: 12, fontWeight: '800', color: '#10B981' }}>Verified</Text>
                  </View>
                </View>
              ) : (
                <View style={[
                  s.inputWrapper,
                  {
                    backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : '#F8FAFC',
                    borderColor: focusedField === 'phone' ? d.acc : (isDark ? 'rgba(255,255,255,0.1)' : '#E2E8F0')
                  }
                ]}>
                  <View style={s.countryCodeBox}>
                    <Ionicons name="call-outline" size={17} color={isDark ? '#94A3B8' : '#64748B'} style={{ marginRight: 6 }} />
                    <Text style={[s.countryCodeText, { color: isDark ? '#E2E8F0' : '#334155' }]}>+91</Text>
                    <View style={[s.countryCodeDivider, { backgroundColor: isDark ? 'rgba(255,255,255,0.12)' : '#CBD5E1' }]} />
                  </View>
                  <TextInput
                    style={[s.inputText, { color: isDark ? '#FFFFFF' : '#0F172A' }]}
                    value={phone}
                    onChangeText={(t) => { setPhone(t.replace(/\D/g, '').slice(0, 10)); if (error) setError(''); }}
                    placeholder="10-digit mobile number"
                    placeholderTextColor={isDark ? '#71717A' : '#94A3B8'}
                    keyboardType="phone-pad"
                    textContentType="telephoneNumber"
                    autoComplete="tel"
                    maxLength={10}
                    onFocus={() => setFocusedField('phone')}
                    onBlur={() => setFocusedField(null)}
                    editable={!fieldsLocked}
                  />
                  {isPhoneValid ? (
                    <View style={{ paddingRight: 12 }}>
                      <Ionicons name="checkmark-circle" size={19} color="#10B981" />
                    </View>
                  ) : phone.length > 0 ? (
                    <TouchableOpacity onPress={() => setPhone('')} style={{ paddingRight: 12 }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Ionicons name="close-circle" size={18} color={isDark ? '#71717A' : '#94A3B8'} />
                    </TouchableOpacity>
                  ) : null}
                </View>
              )}

              {/* Email (Optional) */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
                <Text style={[s.fieldLabel, { color: isDark ? '#E2E8F0' : '#334155' }]}>Email <Text style={{ fontWeight: '400', fontSize: 12, color: '#94A3B8' }}>(optional)</Text></Text>
                {email.trim().length > 0 && (
                  <Text style={{ fontSize: 11, fontWeight: '700', color: isEmailValid ? '#10B981' : '#EF4444' }}>
                    {isEmailValid ? '✓ Valid' : 'Invalid email'}
                  </Text>
                )}
              </View>
              <View style={[
                s.inputWrapper,
                {
                  backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : '#F8FAFC',
                  borderColor: focusedField === 'email' ? d.acc : (isDark ? 'rgba(255,255,255,0.1)' : '#E2E8F0')
                }
              ]}>
                <Ionicons name="mail-outline" size={18} color={isDark ? '#94A3B8' : '#64748B'} style={{ marginLeft: 14, marginRight: 8 }} />
                <TextInput
                  style={[s.inputText, { color: isDark ? '#FFFFFF' : '#0F172A' }]}
                  value={email}
                  onChangeText={(t) => { setEmail(t.trim()); if (error) setError(''); }}
                  placeholder="name@example.com"
                  placeholderTextColor={isDark ? '#71717A' : '#94A3B8'}
                  keyboardType="email-address"
                  textContentType="emailAddress"
                  autoComplete="email"
                  autoCapitalize="none"
                  onFocus={() => setFocusedField('email')}
                  onBlur={() => setFocusedField(null)}
                  editable={!busy}
                />
                {email.trim().length > 0 && (
                  <TouchableOpacity onPress={() => setEmail('')} style={{ paddingRight: 12 }}>
                    <Ionicons name="close-circle" size={18} color={isDark ? '#71717A' : '#94A3B8'} />
                  </TouchableOpacity>
                )}
              </View>

              {/* Password (Mandatory) */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
                <Text style={[s.fieldLabel, { color: isDark ? '#E2E8F0' : '#334155' }]}>
                  Create password <Text style={{ color: '#EF4444' }}>*</Text>
                </Text>
                {password.length > 0 && (
                  <Text style={{ fontSize: 11, fontWeight: '700', color: isPasswordValid ? '#10B981' : '#EF4444' }}>
                    {isPasswordValid ? '✓ Min 6 characters' : `${password.length}/6 characters`}
                  </Text>
                )}
              </View>
              <View style={[
                s.inputWrapper,
                {
                  backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : '#F8FAFC',
                  borderColor: focusedField === 'password' ? d.acc : (isDark ? 'rgba(255,255,255,0.1)' : '#E2E8F0')
                }
              ]}>
                <Ionicons name="lock-closed-outline" size={18} color={isDark ? '#94A3B8' : '#64748B'} style={{ marginLeft: 14, marginRight: 8 }} />
                <TextInput
                  style={[s.inputText, { color: isDark ? '#FFFFFF' : '#0F172A' }]}
                  value={password}
                  onChangeText={(t) => { setPassword(t); if (error) setError(''); }}
                  placeholder="At least 6 characters"
                  placeholderTextColor={isDark ? '#71717A' : '#94A3B8'}
                  secureTextEntry={!showPassword}
                  textContentType="newPassword"
                  autoComplete="password-new"
                  onFocus={() => setFocusedField('password')}
                  onBlur={() => setFocusedField(null)}
                  editable={!busy}
                />
                <TouchableOpacity
                  onPress={() => setShowPassword(!showPassword)}
                  style={{ paddingHorizontal: 12, paddingVertical: 10 }}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Toggle password visibility"
                >
                  <Ionicons
                    name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                    size={20}
                    color={isDark ? '#A1A1AA' : '#64748B'}
                  />
                </TouchableOpacity>
              </View>

              {/* Confirm Password (Mandatory) */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
                <Text style={[s.fieldLabel, { color: isDark ? '#E2E8F0' : '#334155' }]}>
                  Confirm password <Text style={{ color: '#EF4444' }}>*</Text>
                </Text>
                {confirmPassword.length > 0 && (
                  <Text style={{ fontSize: 11, fontWeight: '700', color: doPasswordsMatch ? '#10B981' : '#EF4444' }}>
                    {doPasswordsMatch ? '✓ Passwords match' : 'Passwords do not match'}
                  </Text>
                )}
              </View>
              <View style={[
                s.inputWrapper,
                {
                  backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : '#F8FAFC',
                  borderColor: focusedField === 'confirmPassword' ? d.acc : (isDark ? 'rgba(255,255,255,0.1)' : '#E2E8F0')
                }
              ]}>
                <Ionicons name="shield-checkmark-outline" size={18} color={isDark ? '#94A3B8' : '#64748B'} style={{ marginLeft: 14, marginRight: 8 }} />
                <TextInput
                  style={[s.inputText, { color: isDark ? '#FFFFFF' : '#0F172A' }]}
                  value={confirmPassword}
                  onChangeText={(t) => { setConfirmPassword(t); if (error) setError(''); }}
                  placeholder="Re-enter your password"
                  placeholderTextColor={isDark ? '#71717A' : '#94A3B8'}
                  secureTextEntry={!showConfirmPassword}
                  textContentType="newPassword"
                  autoComplete="password-new"
                  onFocus={() => setFocusedField('confirmPassword')}
                  onBlur={() => setFocusedField(null)}
                  editable={!busy}
                />
                <TouchableOpacity
                  onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                  style={{ paddingHorizontal: 12, paddingVertical: 10 }}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Toggle confirm password visibility"
                >
                  <Ionicons
                    name={showConfirmPassword ? 'eye-off-outline' : 'eye-outline'}
                    size={20}
                    color={isDark ? '#A1A1AA' : '#64748B'}
                  />
                </TouchableOpacity>
              </View>

              {/* Referral Code Pill */}
              {showReferral ? (
                <View style={{ marginTop: 12 }}>
                  <Text style={[s.fieldLabel, { color: isDark ? '#E2E8F0' : '#334155' }]}>Invite code</Text>
                  <View style={[
                    s.inputWrapper,
                    {
                      backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : '#F8FAFC',
                      borderColor: referralError ? '#EF4444' : (focusedField === 'referral' ? d.acc : (isDark ? 'rgba(255,255,255,0.1)' : '#E2E8F0'))
                    }
                  ]}>
                    <Ionicons name="pricetag-outline" size={18} color={isDark ? '#94A3B8' : '#64748B'} style={{ marginLeft: 14, marginRight: 8 }} />
                    <TextInput
                      style={[s.inputText, { textTransform: 'uppercase', color: isDark ? '#FFFFFF' : '#0F172A' }]}
                      value={referralCode}
                      onChangeText={(t) => { setReferralCode(t.toUpperCase().replace(/\s/g, '').slice(0, 20)); if (referralError) setReferralError(''); if (error) setError(''); }}
                      placeholder="e.g. ZV-ABC123"
                      placeholderTextColor={isDark ? '#71717A' : '#94A3B8'}
                      autoCapitalize="characters"
                      autoCorrect={false}
                      onFocus={() => setFocusedField('referral')}
                      onBlur={() => setFocusedField(null)}
                      editable={!busy}
                    />
                  </View>
                  {referralError ? (
                    <Text style={{ color: '#EF4444', fontSize: 12, fontWeight: '700', marginTop: 4 }}>{referralError}</Text>
                  ) : (
                    <Text style={{ color: isDark ? '#94A3B8' : '#64748B', fontSize: 12, fontWeight: '500', marginTop: 4 }}>
                      You and your friend each get 50 bonus points.
                    </Text>
                  )}
                </View>
              ) : (
                <TouchableOpacity
                  onPress={() => setShowReferral(true)}
                  disabled={busy}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                    marginTop: 14,
                    alignSelf: 'flex-start',
                    paddingVertical: 6,
                    paddingHorizontal: 10,
                    borderRadius: 8,
                    backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#F1F5F9'
                  }}
                  activeOpacity={0.7}
                >
                  <Ionicons name="pricetag-outline" size={15} color={d.acc} />
                  <Text style={{ color: d.acc, fontSize: 12, fontWeight: '700' }}>
                    Have an invite code?
                  </Text>
                </TouchableOpacity>
              )}

              {/* Promoter referral code (optional) */}
              <View style={{ marginTop: 12 }}>
                <Text style={[s.fieldLabel, { color: isDark ? '#E2E8F0' : '#334155' }]}>Referral code (optional)</Text>
                <View style={[
                  s.inputWrapper,
                  {
                    backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : '#F8FAFC',
                    borderColor: promoError ? '#EF4444' : (focusedField === 'promo' ? d.acc : (isDark ? 'rgba(255,255,255,0.1)' : '#E2E8F0'))
                  }
                ]}>
                  <Ionicons name="megaphone-outline" size={18} color={isDark ? '#94A3B8' : '#64748B'} style={{ marginLeft: 14, marginRight: 8 }} />
                  <TextInput
                    style={[s.inputText, { textTransform: 'uppercase', color: isDark ? '#FFFFFF' : '#0F172A' }]}
                    value={promoCode}
                    onChangeText={(t) => { promoTouchedRef.current = true; setPromoCode(t.toUpperCase().replace(/[^A-Za-z0-9]/g, '').slice(0, 16)); if (promoError) setPromoError(''); }}
                    placeholder="e.g. RAVI10"
                    placeholderTextColor={isDark ? '#71717A' : '#94A3B8'}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    onFocus={() => setFocusedField('promo')}
                    onBlur={() => { setFocusedField(null); checkPromoCode(); }}
                    editable={!busy}
                  />
                </View>
                {promoError ? (
                  <Text style={{ color: '#EF4444', fontSize: 12, fontWeight: '700', marginTop: 4 }}>{promoError}. You can still sign up.</Text>
                ) : null}
              </View>

              {/* OTP Verification Box */}
              {isOtpSent && !phoneVerified && (
                <View style={{ marginTop: 16, padding: 14, borderRadius: 14, backgroundColor: d.soft, borderWidth: 1, borderColor: d.line }}>
                  <Text style={{ fontSize: 13, fontWeight: '800', color: d.acc, marginBottom: 8, textAlign: 'center' }}>
                    {phoneOtp.mode === 'email' ? `Enter code sent to ${phoneOtp.emailSentTo || 'your email'}` : `Enter code sent to +91 ${phoneOtp.sentTo}`}
                  </Text>
                  <TextInput
                    style={[
                      s.inputText,
                      {
                        backgroundColor: isDark ? '#1E2024' : '#FFFFFF',
                        borderWidth: 1.5,
                        borderColor: d.acc,
                        borderRadius: 12,
                        paddingVertical: 12,
                        fontSize: 22,
                        letterSpacing: 8,
                        textAlign: 'center',
                        fontWeight: '900',
                        color: isDark ? '#FFFFFF' : '#0F172A'
                      }
                    ]}
                    value={otp}
                    onChangeText={(t) => { setOtp(t.replace(/\D/g, '')); if (error) setError(''); }}
                    placeholder="••••••"
                    placeholderTextColor={isDark ? '#71717A' : '#94A3B8'}
                    keyboardType="number-pad"
                    textContentType="oneTimeCode"
                    autoComplete="sms-otp"
                    maxLength={6}
                    autoFocus
                    returnKeyType="done"
                    onSubmitEditing={handleRegister}
                    editable={!busy}
                  />
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
                    <TouchableOpacity disabled={busy} onPress={editDetails} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Text style={{ fontSize: 12, fontWeight: '800', color: d.acc }}>← Edit details</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      disabled={phoneOtp.countdown > 0 || busy}
                      onPress={handleSendOtp}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Text style={{ fontSize: 12, fontWeight: '800', color: (phoneOtp.countdown > 0 || busy) ? (isDark ? '#71717A' : '#9CA3AF') : (d.acc) }}>
                        {phoneOtp.countdown > 0 ? `Resend in ${phoneOtp.countdown}s` : 'Resend code'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {info && !error ? <Text style={s.info}>{info}</Text> : null}
              {error ? <Text style={s.error}>{error}</Text> : null}

              {/* Terms Checkbox */}
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 16, paddingRight: 8 }}
                onPress={() => { setAcceptedTerms(!acceptedTerms); if (error) setError(''); }}
                activeOpacity={0.8}
              >
                <Ionicons
                  name={acceptedTerms ? 'checkbox' : 'square-outline'}
                  size={20}
                  color={acceptedTerms ? d.acc : (isDark ? '#71717A' : '#94A3B8')}
                  style={{ marginTop: 2 }}
                />
                <Text style={{ flex: 1, fontSize: 12, lineHeight: 18, color: isDark ? '#94A3B8' : '#64748B' }}>
                  I agree to the <Text style={{ color: d.acc, fontWeight: '700' }} onPress={() => openLegal('terms')} accessibilityRole="link">Terms of Service</Text> and <Text style={{ color: d.acc, fontWeight: '700' }} onPress={() => openLegal('privacy')} accessibilityRole="link">Privacy Policy</Text> (I am 18+ or have parent/guardian consent).
                </Text>
              </TouchableOpacity>

              {/* Primary Action Button */}
              <TouchableOpacity
                style={[
                  s.primaryBtn,
                  { backgroundColor: d.acc },
                  busy && { opacity: 0.7 }
                ]}
                onPress={phoneVerified || isOtpSent ? handleRegister : handleSendOtp}
                disabled={busy}
                activeOpacity={0.85}
              >
                {busy ? (
                  <ActivityIndicator color={d.onAcc} size="small" />
                ) : (
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                    <Text style={[s.primaryBtnText, { color: d.onAcc }]}>
                      {phoneVerified ? 'Create account' : isOtpSent ? 'Verify and create account' : 'Verify phone & continue'}
                    </Text>
                    <Ionicons name="arrow-forward" size={17} color={d.onAcc} />
                  </View>
                )}
              </TouchableOpacity>

              {EMAIL_SIGNUP_CODES && smsFailed && !isOtpSent && !phoneVerified && (
                <TouchableOpacity onPress={handleSendEmailCode} disabled={busy} style={{ marginTop: 14, alignSelf: 'center' }} accessibilityRole="button">
                  <Text style={{ fontSize: 13, fontWeight: '800', color: d.acc }}>Send verification code by email instead</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity onPress={goToLogin} style={s.switchLink} activeOpacity={0.8}>
                <Text style={[s.switchText, { color: isDark ? '#94A3B8' : '#64748B' }]}>
                  Already have an account? <Text style={{ color: d.acc, fontWeight: '800' }}>Sign in</Text>
                </Text>
              </TouchableOpacity>
            </StaggeredSection>
          </Animated.View>

        </ScrollView>
      </KeyboardAvoidingView>
      {/* Status-bar backdrop (QA 5 Nov): scrolled form text no longer runs under the clock. */}
      <LinearGradient
        pointerEvents="none"
        colors={['#0A0806', '#0A0806', 'rgba(10,8,6,0)']}
        locations={[0, 0.72, 1]}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: insets.top + 14 }}
      />
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
  
  brandHeaderWrap: { 
    alignItems: 'center', 
    marginBottom: 20, 
    marginTop: Platform.OS === 'web' ? 24 : 32, 
    paddingHorizontal: 24, 
    zIndex: 5 
  },
  brandTitle: { 
    fontSize: 26, 
    fontWeight: '900', 
    color: '#FFFFFF', 
    letterSpacing: 0.6, 
    // Web and iOS add the spacing after the last letter too: the same space in front keeps the word centred.
    paddingLeft: Platform.OS === 'android' ? 0 : 3,
    marginTop: 10,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },

  card: {
    borderRadius: 28,
    borderWidth: 1,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: Platform.OS === 'ios' ? 44 : 32,
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    marginBottom: Platform.OS === 'web' ? 32 : 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.35,
    shadowRadius: 24,
    elevation: 12,
    zIndex: 15,
  },
  cardTitle: { fontSize: 22, fontWeight: '800', letterSpacing: -0.3 },
  cardSubtitle: { fontSize: 13, fontWeight: '500', marginTop: 4, marginBottom: 16 },

  fieldLabel: { fontSize: 13, fontWeight: '700', marginBottom: 6 },

  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: 14,
    overflow: 'hidden',
  },
  inputText: {
    flex: 1,
    paddingVertical: 13,
    paddingHorizontal: 10,
    fontSize: 15,
    fontWeight: '600',
  },

  countryCodeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 14,
    paddingRight: 8,
  },
  countryCodeText: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  countryCodeDivider: {
    width: 1,
    height: 22,
    marginLeft: 10,
  },

  primaryBtn: {
    paddingVertical: 15,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  primaryBtnText: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.3,
  },

  error: { color: '#EF4444', fontSize: 12, fontWeight: '600', marginTop: 8 },
  info: { color: '#10B981', fontSize: 12, fontWeight: '700', marginTop: 8 },

  switchLink: { alignItems: 'center', marginTop: 20, paddingVertical: 4 },
  switchText: { fontSize: 13, fontWeight: '500' },
});
