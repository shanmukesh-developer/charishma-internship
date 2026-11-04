import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Platform, ScrollView, Dimensions, ActivityIndicator, Alert, Keyboard } from 'react-native';
import { KeyboardAvoidingView } from '../components/KeyboardAvoidingView';
import { useRouter, useIsFocused } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants/theme';
import { ENDPOINTS } from '../constants/api';
import { useAuth } from '../context/AuthContext';
import { setToken, postAuth, normalizePhone, isValidIndianMobile, NETWORK_ERROR_MESSAGE } from '../utils/auth';
import { usePhoneOtp, PhoneProof, isSmsSendFailure, EMAIL_SIGNUP_CODES } from '../utils/phoneOtp';
import ServerWakeupOverlay from '../components/ServerWakeupOverlay';
import TermsConsent from '../components/TermsConsent';
import ZenvBadge from '../components/ZenvBadge';
import { consentFields, openLegal } from '../utils/legal';
import { useTheme } from '../context/ThemeContext';

interface GooglePending {
  googleToken: string;
  name: string;
  email: string;
}

interface AuthResponse {
  ok: boolean;
  code?: string;
  message?: string;
  status?: number;
  data?: any;
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

  // Once signed in, return to previous screen
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
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);
  const [showWakeup, setShowWakeup] = useState(false);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const [loginMethod, setLoginMethod] = useState<'password' | 'otp'>('password');
  const [otp, setOtp] = useState('');
  const [focusedField, setFocusedField] = useState<'phone' | 'password' | 'otp' | null>(null);

  // Google sign-in waiting for a verified phone number
  const [googlePending, setGooglePending] = useState<GooglePending | null>(null);
  const [googleTermsAccepted, setGoogleTermsAccepted] = useState(false);
  const [googleName, setGoogleName] = useState('');

  const autoVerifyRef = useRef<(phone10: string, proof: PhoneProof) => void>(() => {});
  const phoneOtp = usePhoneOtp('auth', {
    onAutoVerified: (p, proof) => autoVerifyRef.current(p, proof),
  });

  const [smsFailed, setSmsFailed] = useState(false);

  const playSuccess = () => {
    try { require('../utils/sounds').playSound('success'); } catch {}
  };

  const isPhoneValid = normalizePhone(phone).length === 10;
  const otpSent = !!phoneOtp.sentTo;
  const busy = loading || phoneOtp.sending;

  const runGuarded = async (fn: () => Promise<void>) => {
    if (busyRef.current) return;
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

  const handleAuthResult = async (r: AuthResponse, phone10: string) => {
    if (r.ok && r.data?.token) {
      await startSession(r.data);
      return;
    }
    if (r.ok && r.data?.isNewUser && r.data?.registrationToken) {
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
    setError(r.message || 'Authentication failed. Please try again.');
  };

  // ── Password login ──────────────────────────────────────────────────────────
  const handleLogin = () => {
    const digits = normalizePhone(phone);
    if (!digits) { setError('Please enter your 10-digit mobile number.'); return; }
    if (!isValidIndianMobile(digits)) { setError('Please enter a valid 10-digit mobile number.'); return; }
    if (!password) { setError('Please enter your password.'); return; }
    Keyboard.dismiss();
    setInfo('');
    runGuarded(async () => {
      const r = await postAuth(ENDPOINTS.login, { phone: digits, password });
      await handleAuthResult(r, digits);
      if (!r.ok && !r.code && (r.status === 401 || r.status === 429)) {
        setError(`${r.message} Signed up with a code or Google? Use the One-time code tab.`);
      }
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

  const handleGoogleToken = async (googleToken: string) => {
    const r = await postAuth(ENDPOINTS.googleLogin, { firebaseToken: googleToken });
    if (r.ok && r.data?.token) {
      await startSession(r.data);
      return;
    }
    if (r.ok && r.data?.needsPhone) {
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

  return (
    <View style={[s.container, { backgroundColor: isDark ? '#090D16' : '#F8FAFC' }]}>
      {/* Server wake-up banner */}
      {showWakeup && (
        <ServerWakeupOverlay
          visible={showWakeup}
          onWakeupComplete={() => setShowWakeup(false)}
          offlineText="Connecting to campus server..."
        />
      )}

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={[
            s.scroll,
            { paddingBottom: Math.max(80, keyboardHeight + 40) }
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          showsVerticalScrollIndicator={false}
        >
          {/* Top Brand Header — Stable, never cut off. The ZenWe badge (brand, 4 Nov 2026). */}
          <View style={s.brandHeaderWrap} accessible accessibilityRole="header" accessibilityLabel="ZenWe">
            <ZenvBadge size={56} lift />
            <Text style={[s.brandTitle, { color: isDark ? '#FFFFFF' : '#0F172A' }]}>ZenWe</Text>
          </View>

          {/* Clean Card Surface */}
          <View style={[
            s.card,
            {
              backgroundColor: isDark ? '#121722' : '#FFFFFF',
              borderColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)',
            }
          ]}>
            {googlePending ? (
              <>
                <Text style={[s.cardTitle, { color: isDark ? '#FFFFFF' : '#0F172A' }]}>
                  Almost there{googlePending.name ? `, ${googlePending.name.split(' ')[0]}` : ''}
                </Text>
                <Text style={[s.cardSubtitle, { color: isDark ? '#94A3B8' : '#64748B' }]}>
                  Verify your mobile number to complete your Google account.
                </Text>

                <View style={{ marginTop: 8 }}>
                  <Text style={[s.fieldLabel, { color: isDark ? '#E2E8F0' : '#334155' }]}>Mobile number</Text>
                  <View style={[
                    s.phoneInputWrapper,
                    {
                      backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : '#F8FAFC',
                      borderColor: focusedField === 'phone' ? (isDark ? COLORS.gold : '#0F172A') : (isDark ? 'rgba(255,255,255,0.1)' : '#E2E8F0')
                    }
                  ]}>
                    <View style={s.countryCodeBox}>
                      <Ionicons name="call-outline" size={17} color={isDark ? '#94A3B8' : '#64748B'} style={{ marginRight: 6 }} />
                      <Text style={[s.countryCodeText, { color: isDark ? '#E2E8F0' : '#334155' }]}>+91</Text>
                      <View style={[s.countryCodeDivider, { backgroundColor: isDark ? 'rgba(255,255,255,0.12)' : '#CBD5E1' }]} />
                    </View>
                    <TextInput
                      style={[s.phoneInputText, { color: isDark ? '#FFFFFF' : '#0F172A' }]}
                      value={phone}
                      onChangeText={(t) => { setPhone(t.replace(/\D/g, '').slice(0, 10)); if (error) setError(''); }}
                      placeholder="10-digit mobile number"
                      placeholderTextColor={isDark ? '#71717A' : '#94A3B8'}
                      keyboardType="phone-pad"
                      maxLength={10}
                      editable={!busy}
                    />
                  </View>
                </View>

                <TermsConsent isDark={isDark} checked={googleTermsAccepted} onToggle={() => { setGoogleTermsAccepted(v => !v); if (error) setError(''); }} disabled={busy} />

                {info && !error ? <Text style={s.info}>{info}</Text> : null}
                {error ? <Text style={s.error}>{error}</Text> : null}

                <TouchableOpacity
                  style={[s.primaryBtn, { backgroundColor: isDark ? COLORS.gold : '#0F172A' }, busy && { opacity: 0.7 }]}
                  onPress={handleSendOtp}
                  disabled={busy}
                  activeOpacity={0.85}
                >
                  {busy ? <ActivityIndicator color={isDark ? '#000' : '#FFF'} size="small" /> : <Text style={[s.primaryBtnText, { color: isDark ? '#000' : '#FFF' }]}>Verify Phone</Text>}
                </TouchableOpacity>

                <TouchableOpacity onPress={cancelGoogle} disabled={busy} style={{ alignSelf: 'center', marginTop: 14, padding: 6 }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: isDark ? '#A1A1AA' : '#64748B' }}>Cancel Google sign-in</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={[s.cardTitle, { color: isDark ? '#FFFFFF' : '#0F172A' }]}>Welcome back</Text>
                <Text style={[s.cardSubtitle, { color: isDark ? '#94A3B8' : '#64748B' }]}>Sign in to your campus account</Text>

                {/* Segmented Method Switcher */}
                <View style={[s.segmentedContainer, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : '#F1F5F9', borderColor: isDark ? 'rgba(255,255,255,0.08)' : '#E2E8F0' }]}>
                  <TouchableOpacity
                    style={[
                      s.segmentedBtn,
                      loginMethod === 'password' && [s.segmentedBtnActive, { backgroundColor: isDark ? '#1F2937' : '#FFFFFF' }]
                    ]}
                    onPress={() => { setLoginMethod('password'); setError(''); setInfo(''); }}
                    activeOpacity={0.8}
                  >
                    <Text style={[s.segmentedText, loginMethod === 'password' && [s.segmentedTextActive, { color: isDark ? '#FFFFFF' : '#0F172A' }]]}>
                      Password
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      s.segmentedBtn,
                      loginMethod === 'otp' && [s.segmentedBtnActive, { backgroundColor: isDark ? '#1F2937' : '#FFFFFF' }]
                    ]}
                    onPress={() => { setLoginMethod('otp'); setError(''); setInfo(''); }}
                    activeOpacity={0.8}
                  >
                    <Text style={[s.segmentedText, loginMethod === 'otp' && [s.segmentedTextActive, { color: isDark ? '#FFFFFF' : '#0F172A' }]]}>
                      One-time code
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Unified Mobile Number Input (Used by BOTH Password & OTP) */}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                  <Text style={[s.fieldLabel, { color: isDark ? '#E2E8F0' : '#334155' }]}>Mobile number</Text>
                  {phone.length > 0 && (
                    <Text style={{ fontSize: 11, fontWeight: '700', color: isPhoneValid ? '#10B981' : '#EF4444' }}>
                      {isPhoneValid ? '✓ 10 digits' : `${phone.length}/10 digits`}
                    </Text>
                  )}
                </View>
                <View style={[
                  s.phoneInputWrapper,
                  {
                    backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : '#F8FAFC',
                    borderColor: focusedField === 'phone' ? (isDark ? COLORS.gold : '#0F172A') : (isDark ? 'rgba(255,255,255,0.1)' : '#E2E8F0')
                  }
                ]}>
                  <View style={s.countryCodeBox}>
                    <Ionicons name="call-outline" size={17} color={isDark ? '#94A3B8' : '#64748B'} style={{ marginRight: 6 }} />
                    <Text style={[s.countryCodeText, { color: isDark ? '#E2E8F0' : '#334155' }]}>+91</Text>
                    <View style={[s.countryCodeDivider, { backgroundColor: isDark ? 'rgba(255,255,255,0.12)' : '#CBD5E1' }]} />
                  </View>
                  <TextInput
                    style={[s.phoneInputText, { color: isDark ? '#FFFFFF' : '#0F172A' }]}
                    value={phone}
                    onChangeText={(t) => { setPhone(t.replace(/\D/g, '').slice(0, 10)); if (error) setError(''); }}
                    placeholder="10-digit mobile number"
                    placeholderTextColor={isDark ? '#71717A' : '#94A3B8'}
                    keyboardType="phone-pad"
                    textContentType="telephoneNumber"
                    autoComplete="tel"
                    autoCapitalize="none"
                    maxLength={10}
                    onFocus={() => setFocusedField('phone')}
                    onBlur={() => setFocusedField(null)}
                    editable={!busy && !otpSent}
                  />
                  {isPhoneValid ? (
                    <View style={{ paddingRight: 12 }}>
                      <Ionicons name="checkmark-circle" size={19} color="#10B981" />
                    </View>
                  ) : phone.length > 0 ? (
                    <TouchableOpacity onPress={() => setPhone('')} style={{ paddingRight: 12 }}>
                      <Ionicons name="close-circle" size={18} color={isDark ? '#71717A' : '#94A3B8'} />
                    </TouchableOpacity>
                  ) : null}
                </View>

                {/* Method Branch: Password */}
                {loginMethod === 'password' && (
                  <View style={{ marginTop: 14 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <Text style={[s.fieldLabel, { color: isDark ? '#E2E8F0' : '#334155', marginBottom: 0 }]}>Password</Text>
                      <TouchableOpacity onPress={() => router.push('/forgot-password' as any)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Text style={[s.forgotLink, { color: isDark ? COLORS.gold : '#2563EB' }]}>Forgot password?</Text>
                      </TouchableOpacity>
                    </View>
                    <View style={[
                      s.phoneInputWrapper,
                      {
                        backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : '#F8FAFC',
                        borderColor: focusedField === 'password' ? (isDark ? COLORS.gold : '#0F172A') : (isDark ? 'rgba(255,255,255,0.1)' : '#E2E8F0'),
                      }
                    ]}>
                      <Ionicons name="lock-closed-outline" size={18} color={isDark ? '#94A3B8' : '#64748B'} style={{ marginLeft: 14, marginRight: 8 }} />
                      <TextInput
                        style={[s.phoneInputText, { paddingHorizontal: 0, color: isDark ? '#FFFFFF' : '#0F172A' }]}
                        value={password}
                        onChangeText={(t) => { setPassword(t); if (error) setError(''); }}
                        placeholder="Enter your password"
                        placeholderTextColor={isDark ? '#71717A' : '#94A3B8'}
                        secureTextEntry={!showPassword}
                        textContentType="password"
                        autoComplete="password"
                        returnKeyType="go"
                        onSubmitEditing={handleLogin}
                        onFocus={() => setFocusedField('password')}
                        onBlur={() => setFocusedField(null)}
                        editable={!busy}
                      />
                      <TouchableOpacity
                        onPress={() => setShowPassword(!showPassword)}
                        style={{ paddingHorizontal: 14, paddingVertical: 12 }}
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

                    {info && !error ? <Text style={s.info}>{info}</Text> : null}
                    {error ? <Text style={s.error}>{error}</Text> : null}

                    <TouchableOpacity
                      style={[s.primaryBtn, { backgroundColor: isDark ? COLORS.gold : '#0F172A' }, busy && { opacity: 0.7 }]}
                      onPress={handleLogin}
                      disabled={busy}
                      activeOpacity={0.85}
                    >
                      {busy ? (
                        <ActivityIndicator color={isDark ? '#000000' : '#FFFFFF'} size="small" />
                      ) : (
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                          <Text style={[s.primaryBtnText, { color: isDark ? '#000000' : '#FFFFFF' }]}>Sign In</Text>
                          <Ionicons name="arrow-forward" size={17} color={isDark ? '#000000' : '#FFFFFF'} />
                        </View>
                      )}
                    </TouchableOpacity>
                  </View>
                )}

                {/* Method Branch: One-Time Code (OTP) */}
                {loginMethod === 'otp' && (
                  <View style={{ marginTop: 14 }}>
                    {!otpSent ? (
                      <>
                        <Text style={{ fontSize: 13, color: isDark ? '#94A3B8' : '#64748B', lineHeight: 18, marginBottom: 8 }}>
                          We will text a 6-digit verification code to your phone number.
                        </Text>

                        {info && !error ? <Text style={s.info}>{info}</Text> : null}
                        {error ? <Text style={s.error}>{error}</Text> : null}

                        <TouchableOpacity
                          style={[s.primaryBtn, { backgroundColor: isDark ? COLORS.gold : '#0F172A' }, busy && { opacity: 0.7 }]}
                          onPress={handleSendOtp}
                          disabled={busy}
                          activeOpacity={0.85}
                        >
                          {busy ? (
                            <ActivityIndicator color={isDark ? '#000000' : '#FFFFFF'} size="small" />
                          ) : (
                            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                              <Text style={[s.primaryBtnText, { color: isDark ? '#000000' : '#FFFFFF' }]}>Send verification code</Text>
                              <Ionicons name="arrow-forward" size={17} color={isDark ? '#000000' : '#FFFFFF'} />
                            </View>
                          )}
                        </TouchableOpacity>

                        {smsFailed && (
                          <TouchableOpacity onPress={handleSendEmailCode} disabled={busy} style={{ marginTop: 14, alignSelf: 'center' }} accessibilityRole="button">
                            <Text style={{ fontSize: 13, fontWeight: '800', color: isDark ? COLORS.gold : '#2563EB' }}>Send code by email instead</Text>
                          </TouchableOpacity>
                        )}
                      </>
                    ) : (
                      <>
                        <Text style={[s.fieldLabel, { color: isDark ? '#E2E8F0' : '#334155' }]}>
                          {phoneOtp.mode === 'email' ? `Code sent to ${phoneOtp.emailSentTo || 'your email'}` : `Enter 6-digit code sent to +91 ${phoneOtp.sentTo}`}
                        </Text>
                        <View style={[
                          s.phoneInputWrapper,
                          {
                            backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : '#F8FAFC',
                            borderColor: focusedField === 'otp' ? (isDark ? COLORS.gold : '#0F172A') : (isDark ? 'rgba(255,255,255,0.1)' : '#E2E8F0')
                          }
                        ]}>
                          <TextInput
                            style={[
                              s.phoneInputText,
                              {
                                letterSpacing: 8,
                                textAlign: 'center',
                                fontSize: 20,
                                fontWeight: '900',
                                color: isDark ? '#FFFFFF' : '#0F172A'
                              }
                            ]}
                            value={otp}
                            onChangeText={(t) => { setOtp(t.replace(/\D/g, '').slice(0, 6)); if (error) setError(''); }}
                            placeholder="••••••"
                            placeholderTextColor={isDark ? '#71717A' : '#94A3B8'}
                            keyboardType="number-pad"
                            textContentType="oneTimeCode"
                            autoComplete="sms-otp"
                            maxLength={6}
                            autoFocus
                            returnKeyType="done"
                            onSubmitEditing={handleVerifyOtp}
                            onFocus={() => setFocusedField('otp')}
                            onBlur={() => setFocusedField(null)}
                            editable={!busy}
                          />
                        </View>

                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
                          <TouchableOpacity onPress={changeNumber} disabled={busy} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                            <Text style={{ fontSize: 12, fontWeight: '800', color: isDark ? '#D4AF7A' : '#2563EB' }}>← Change number</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={handleSendOtp}
                            disabled={phoneOtp.countdown > 0 || busy}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          >
                            <Text style={{ fontSize: 12, fontWeight: '800', color: (phoneOtp.countdown > 0 || busy) ? (isDark ? '#71717A' : '#9CA3AF') : (isDark ? COLORS.gold : '#2563EB') }}>
                              {phoneOtp.countdown > 0 ? `Resend in ${phoneOtp.countdown}s` : 'Resend code'}
                            </Text>
                          </TouchableOpacity>
                        </View>

                        {info && !error ? <Text style={s.info}>{info}</Text> : null}
                        {error ? <Text style={s.error}>{error}</Text> : null}

                        <TouchableOpacity
                          style={[s.primaryBtn, { backgroundColor: isDark ? COLORS.gold : '#0F172A' }, busy && { opacity: 0.7 }]}
                          onPress={handleVerifyOtp}
                          disabled={busy}
                          activeOpacity={0.85}
                        >
                          {busy ? (
                            <ActivityIndicator color={isDark ? '#000000' : '#FFFFFF'} size="small" />
                          ) : (
                            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                              <Text style={[s.primaryBtnText, { color: isDark ? '#000000' : '#FFFFFF' }]}>Verify & Sign In</Text>
                              <Ionicons name="checkmark-circle" size={18} color={isDark ? '#000000' : '#FFFFFF'} />
                            </View>
                          )}
                        </TouchableOpacity>
                      </>
                    )}
                  </View>
                )}

                {/* Footer disclaimer and sign up link */}
                <Text style={{ textAlign: 'center', fontSize: 12, color: isDark ? '#71717A' : '#94A3B8', marginTop: 18, lineHeight: 18 }}>
                  By continuing you agree to the{' '}
                  <Text style={{ color: isDark ? COLORS.gold : '#2563EB', fontWeight: '700' }} onPress={() => openLegal('terms')} accessibilityRole="link">Terms of Service</Text> and{' '}
                  <Text style={{ color: isDark ? COLORS.gold : '#2563EB', fontWeight: '700' }} onPress={() => openLegal('privacy')} accessibilityRole="link">Privacy Policy</Text>.
                </Text>

                <TouchableOpacity onPress={() => router.push('/register' as any)} style={s.switchLink} activeOpacity={0.8}>
                  <Text style={[s.switchText, { color: isDark ? '#94A3B8' : '#64748B' }]}>
                    Don't have an account? <Text style={{ color: isDark ? COLORS.gold : '#2563EB', fontWeight: '800' }}>Sign up</Text>
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
    width: '100%',
    maxWidth: 460,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'web' ? 36 : 24,
  },

  brandHeaderWrap: {
    alignItems: 'center',
    marginBottom: 24,
  },
  brandTitle: {
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: 3,
    // Web and iOS add the spacing after the last letter too: the same space in front keeps the word centred.
    paddingLeft: Platform.OS === 'android' ? 0 : 3,
    marginTop: 10,
  },

  card: {
    borderRadius: 24,
    borderWidth: 1,
    paddingHorizontal: 22,
    paddingTop: 24,
    paddingBottom: 28,
    width: '100%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 6,
  },
  cardTitle: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  cardSubtitle: {
    fontSize: 13,
    fontWeight: '500',
    marginTop: 4,
    marginBottom: 16,
  },

  fieldLabel: {
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 6,
  },

  segmentedContainer: {
    flexDirection: 'row',
    borderRadius: 12,
    padding: 3,
    marginBottom: 12,
    borderWidth: 1,
  },
  segmentedBtn: {
    flex: 1,
    paddingVertical: 9,
    alignItems: 'center',
    borderRadius: 9,
  },
  segmentedBtnActive: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  segmentedText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
  },
  segmentedTextActive: {
    fontWeight: '800',
  },

  phoneInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: 12,
    overflow: 'hidden',
  },
  countryCodeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 12,
    paddingRight: 6,
  },
  countryCodeText: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  countryCodeDivider: {
    width: 1,
    height: 20,
    marginLeft: 8,
  },
  phoneInputText: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 10,
    fontSize: 15,
    fontWeight: '600',
  },

  forgotLink: {
    fontSize: 13,
    fontWeight: '700',
  },

  primaryBtn: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 3,
  },
  primaryBtnText: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.2,
  },

  error: { color: '#EF4444', fontSize: 12, fontWeight: '600', marginTop: 8 },
  info: { color: '#10B981', fontSize: 12, fontWeight: '700', marginTop: 8 },

  switchLink: { alignItems: 'center', marginTop: 18, paddingVertical: 4 },
  switchText: { fontSize: 13, fontWeight: '500' },
});
