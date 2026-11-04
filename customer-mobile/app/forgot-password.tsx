import React, { useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Platform, ScrollView, ActivityIndicator, Alert, Keyboard } from 'react-native';
import { KeyboardAvoidingView } from '../components/KeyboardAvoidingView';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants/theme';
import { ENDPOINTS } from '../constants/api';
import { postAuth, normalizePhone, isValidIndianMobile, NETWORK_ERROR_MESSAGE } from '../utils/auth';
import { usePhoneOtp, PhoneProof, isSmsSendFailure } from '../utils/phoneOtp';
import { useTheme } from '../context/ThemeContext';
import ZenvBadge from '../components/ZenvBadge';

/**
 * Password reset: real SMS code (POST /send-otp purpose "reset_password", Firebase fallback on native),
 * then POST /reset-password { phone, newPassword, otp | firebaseToken }.
 */
export default function ForgotPasswordScreen() {
  const router = useRouter();
  const { isDark } = useTheme();
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [focusedField, setFocusedField] = useState<'phone' | 'otp' | 'newPassword' | 'confirmPassword' | null>(null);

  const isPhoneValid = normalizePhone(phone).length === 10;
  const isPasswordValid = newPassword.length >= 6;
  const doPasswordsMatch = confirmPassword.length > 0 && confirmPassword === newPassword;

  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // Android Firebase fallback can verify the number in the background (no code typed)
  const [autoProof, setAutoProof] = useState<PhoneProof | null>(null);
  const phoneOtp = usePhoneOtp('reset_password', {
    onAutoVerified: (_p, proof) => {
      if (!mountedRef.current) return;
      setAutoProof(proof);
      setInfo('Number verified automatically. Choose your new password.');
    },
  });
  const step: 1 | 2 = phoneOtp.sentTo ? 2 : 1;
  const busy = loading || phoneOtp.sending;

  const runGuarded = async (fn: () => Promise<void>) => {
    if (busyRef.current) return; // double-tap protection
    busyRef.current = true;
    setLoading(true);
    setError('');
    try {
      await fn();
    } catch (e: any) {
      setError(e?.isNetwork ? NETWORK_ERROR_MESSAGE
        : (e?.message && typeof e.message === 'string' && e.message.length < 140 ? e.message : 'Something went wrong. Please try again.'));
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setLoading(false);
    }
  };

  // The SMS could not be sent: offer the code by email (to the address on the account).
  const [smsFailed, setSmsFailed] = useState(false);
  const sendCode = (digits: string, viaEmail = false) => {
    runGuarded(async () => {
      const r = viaEmail ? await phoneOtp.sendEmail(digits) : await phoneOtp.send(digits);
      if (r.ok) {
        setAutoProof(null);
        setOtp('');
        setSmsFailed(false);
        setInfo(r.message);
      } else {
        if (!viaEmail) setSmsFailed(isSmsSendFailure(r));
        setError(r.message);
      }
    });
  };

  const handleSendOtp = () => {
    const digits = normalizePhone(phone);
    if (!isValidIndianMobile(digits)) {
      setError('Please enter a valid 10-digit mobile number.');
      return;
    }
    Keyboard.dismiss();
    setInfo('');
    sendCode(digits);
  };

  const changeNumber = () => {
    phoneOtp.reset();
    setAutoProof(null);
    setOtp('');
    setNewPassword('');
    setConfirmPassword('');
    setError('');
    setInfo('');
  };

  const handleVerifyAndReset = () => {
    const phone10 = phoneOtp.sentTo;
    if (!phone10) return;
    if (!autoProof && phoneOtp.mode !== 'firebase' && otp.replace(/\D/g, '').length !== 6) {
      setError('Enter the 6-digit code we sent you.');
      return;
    }
    if (!newPassword || newPassword.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match. Please re-enter.');
      return;
    }
    Keyboard.dismiss();
    runGuarded(async () => {
      const proof = autoProof || await phoneOtp.getProof(otp);
      const r = await postAuth(ENDPOINTS.resetPassword, { phone: phone10, newPassword, ...proof });
      if (r.ok) {
        try { require('../utils/sounds').playSound('success'); } catch {}
        Alert.alert('Password updated', 'You can now sign in with your new password.');
        if (router.canGoBack()) router.back();
        else router.replace('/login' as any);
        return;
      }
      if (r.code === 'OTP_EXPIRED' || r.code === 'OTP_LOCKED' || r.code === 'VERIFICATION_EXPIRED' || r.code === 'PHONE_MISMATCH') {
        setAutoProof(null);
        setOtp('');
      }
      phoneOtp.allowAutoRetry();
      setError(r.message);
    });
  };

  return (
    <KeyboardAvoidingView style={[s.container, { backgroundColor: isDark ? COLORS.bgDark : '#F8FAFC' }]} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        contentContainerStyle={[s.scroll, { paddingBottom: 180 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        {/* Top Back Navigation Bar */}
        <TouchableOpacity
          style={s.backBar}
          disabled={busy}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          onPress={() => {
            if (step === 2) {
              changeNumber();
            } else if (router.canGoBack()) {
              router.back();
            } else {
              router.replace('/login' as any);
            }
          }}
          activeOpacity={0.7}
        >
          <Ionicons name="arrow-back" size={20} color={isDark ? COLORS.gold : '#0F172A'} />
          <Text style={[s.backText, { color: isDark ? COLORS.gold : '#0F172A' }]}>
            {step === 2 ? 'Change number' : 'Back to sign in'}
          </Text>
        </TouchableOpacity>

        {/* Clean Brand Header: the ZenWe badge (brand, 4 Nov 2026) */}
        <View style={s.brandHeaderWrap} accessible accessibilityRole="header" accessibilityLabel="ZenWe, Account Recovery">
          <ZenvBadge size={56} lift />
          <Text style={[s.brandTitle, { color: isDark ? '#FFFFFF' : '#0F172A' }]}>ZenWe</Text>
          <Text style={[s.brandSubtitle, { color: isDark ? '#94A3B8' : '#64748B' }]}>Account Recovery</Text>
        </View>

        {/* Card */}
        <View style={[
          s.card,
          {
            backgroundColor: isDark ? '#141417' : '#FFFFFF',
            borderColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)',
          }
        ]}>
          <Text style={[s.cardTitle, { color: isDark ? '#FFFFFF' : '#0F172A' }]}>
            {step === 1 ? 'Reset password' : 'Choose a new password'}
          </Text>
          <Text style={[s.cardSubtitle, { color: isDark ? '#94A3B8' : '#64748B' }]}>
            {step === 1
              ? "We'll send a 6-digit verification code to your registered mobile number."
              : phoneOtp.mode === 'email'
                ? `Enter the code sent to ${phoneOtp.emailSentTo || 'your email'} and set a new password.`
                : `Enter the code sent to +91 ${phoneOtp.sentTo} and set a new password.`}
          </Text>

          {/* Step 1: Phone */}
          {step === 1 && (
            <View style={{ marginTop: 8 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={[s.fieldLabel, { color: isDark ? '#E2E8F0' : '#334155' }]}>Registered mobile number</Text>
                {phone.length > 0 && (
                  <Text style={{ fontSize: 11, fontWeight: '700', color: isPhoneValid ? '#10B981' : '#EF4444' }}>
                    {isPhoneValid ? '✓ 10 digits' : `${phone.length}/10 digits`}
                  </Text>
                )}
              </View>

              <View style={[
                s.inputWrapper,
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
                  style={[s.inputText, { color: isDark ? '#FFFFFF' : '#0F172A' }]}
                  keyboardType="phone-pad"
                  textContentType="telephoneNumber"
                  autoComplete="tel"
                  placeholder="10-digit mobile number"
                  placeholderTextColor={isDark ? '#71717A' : '#94A3B8'}
                  value={phone}
                  onChangeText={(t) => { setPhone(t.replace(/\D/g, '').slice(0, 10)); if (error) setError(''); }}
                  returnKeyType="done"
                  onSubmitEditing={handleSendOtp}
                  onFocus={() => setFocusedField('phone')}
                  onBlur={() => setFocusedField(null)}
                  editable={!busy}
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

              {info && !error ? <Text style={s.info}>{info}</Text> : null}
              {error ? <Text style={s.error}>{error}</Text> : null}

              <TouchableOpacity
                style={[
                  s.primaryBtn,
                  { backgroundColor: isDark ? COLORS.gold : '#0F172A' },
                  busy && { opacity: 0.7 }
                ]}
                onPress={handleSendOtp}
                disabled={busy}
                activeOpacity={0.85}
              >
                {busy ? (
                  <ActivityIndicator size="small" color={isDark ? '#000000' : '#FFFFFF'} />
                ) : (
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                    <Text style={[s.primaryBtnText, { color: isDark ? '#000000' : '#FFFFFF' }]}>Send verification code</Text>
                    <Ionicons name="arrow-forward" size={17} color={isDark ? '#000000' : '#FFFFFF'} />
                  </View>
                )}
              </TouchableOpacity>

              {smsFailed && (
                <TouchableOpacity
                  onPress={() => { const d = normalizePhone(phone); if (isValidIndianMobile(d)) sendCode(d, true); }}
                  disabled={busy}
                  style={{ marginTop: 14, alignSelf: 'center' }}
                  accessibilityRole="button"
                >
                  <Text style={{ fontSize: 13, fontWeight: '800', color: isDark ? COLORS.gold : '#2563EB' }}>
                    Send the code by email instead
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Step 2: Code + New Password */}
          {step === 2 && (
            <View style={{ marginTop: 8 }}>
              {!autoProof && (
                <>
                  <Text style={[s.fieldLabel, { color: isDark ? '#E2E8F0' : '#334155' }]}>6-digit verification code</Text>
                  <View style={[
                    s.inputWrapper,
                    {
                      backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : '#F8FAFC',
                      borderColor: focusedField === 'otp' ? (isDark ? COLORS.gold : '#0F172A') : (isDark ? 'rgba(255,255,255,0.1)' : '#E2E8F0')
                    }
                  ]}>
                    <TextInput
                      style={[
                        s.inputText,
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
                      onFocus={() => setFocusedField('otp')}
                      onBlur={() => setFocusedField(null)}
                      editable={!busy}
                    />
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 8 }}>
                    <TouchableOpacity
                      disabled={phoneOtp.countdown > 0 || busy}
                      onPress={() => { const p = phoneOtp.sentTo; if (p) sendCode(p, phoneOtp.mode === 'email'); }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Text style={{ fontSize: 12, fontWeight: '800', color: (phoneOtp.countdown > 0 || busy) ? (isDark ? '#71717A' : '#9CA3AF') : (isDark ? COLORS.gold : '#2563EB') }}>
                        {phoneOtp.countdown > 0 ? `Resend OTP in ${phoneOtp.countdown}s` : 'Resend OTP'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}

              {/* New Password */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
                <Text style={[s.fieldLabel, { color: isDark ? '#E2E8F0' : '#334155' }]}>New password</Text>
                {newPassword.length > 0 && (
                  <Text style={{ fontSize: 11, fontWeight: '700', color: isPasswordValid ? '#10B981' : '#EF4444' }}>
                    {isPasswordValid ? '✓ Min 6 characters' : `${newPassword.length}/6 characters`}
                  </Text>
                )}
              </View>
              <View style={[
                s.inputWrapper,
                {
                  backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : '#F8FAFC',
                  borderColor: focusedField === 'newPassword' ? (isDark ? COLORS.gold : '#0F172A') : (isDark ? 'rgba(255,255,255,0.1)' : '#E2E8F0')
                }
              ]}>
                <Ionicons name="lock-closed-outline" size={18} color={isDark ? '#94A3B8' : '#64748B'} style={{ marginLeft: 14, marginRight: 8 }} />
                <TextInput
                  style={[s.inputText, { color: isDark ? '#FFFFFF' : '#0F172A' }]}
                  secureTextEntry={!showPassword}
                  placeholder="At least 6 characters"
                  placeholderTextColor={isDark ? '#71717A' : '#94A3B8'}
                  value={newPassword}
                  onChangeText={(t) => { setNewPassword(t); if (error) setError(''); }}
                  textContentType="newPassword"
                  autoComplete="password-new"
                  onFocus={() => setFocusedField('newPassword')}
                  onBlur={() => setFocusedField(null)}
                  editable={!busy}
                />
                <TouchableOpacity
                  onPress={() => setShowPassword(!showPassword)}
                  style={{ paddingHorizontal: 12, paddingVertical: 10 }}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Toggle new password visibility"
                >
                  <Ionicons
                    name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                    size={20}
                    color={isDark ? '#A1A1AA' : '#64748B'}
                  />
                </TouchableOpacity>
              </View>

              {/* Confirm New Password */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
                <Text style={[s.fieldLabel, { color: isDark ? '#E2E8F0' : '#334155' }]}>Confirm new password</Text>
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
                  borderColor: focusedField === 'confirmPassword' ? (isDark ? COLORS.gold : '#0F172A') : (isDark ? 'rgba(255,255,255,0.1)' : '#E2E8F0')
                }
              ]}>
                <Ionicons name="shield-checkmark-outline" size={18} color={isDark ? '#94A3B8' : '#64748B'} style={{ marginLeft: 14, marginRight: 8 }} />
                <TextInput
                  style={[s.inputText, { color: isDark ? '#FFFFFF' : '#0F172A' }]}
                  secureTextEntry={!showConfirmPassword}
                  placeholder="Re-enter your new password"
                  placeholderTextColor={isDark ? '#71717A' : '#94A3B8'}
                  value={confirmPassword}
                  onChangeText={(t) => { setConfirmPassword(t); if (error) setError(''); }}
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

              {info && !error ? <Text style={s.info}>{info}</Text> : null}
              {error ? <Text style={s.error}>{error}</Text> : null}

              <TouchableOpacity
                style={[
                  s.primaryBtn,
                  { backgroundColor: isDark ? COLORS.gold : '#0F172A' },
                  busy && { opacity: 0.7 }
                ]}
                onPress={handleVerifyAndReset}
                disabled={busy}
                activeOpacity={0.85}
              >
                {busy ? (
                  <ActivityIndicator size="small" color={isDark ? '#000000' : '#FFFFFF'} />
                ) : (
                  <Text style={[s.primaryBtnText, { color: isDark ? '#000000' : '#FFFFFF' }]}>Reset password</Text>
                )}
              </TouchableOpacity>
            </View>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  scroll: { 
    flexGrow: 1, 
    width: '100%', 
    maxWidth: 480, 
    alignSelf: 'center', 
    paddingHorizontal: 24, 
    paddingTop: Platform.OS === 'web' ? 24 : 16 
  },
  backBar: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    gap: 8, 
    paddingVertical: 10, 
    marginBottom: 10,
    alignSelf: 'flex-start' 
  },
  backText: { fontSize: 14, fontWeight: '700' },

  brandHeaderWrap: { 
    alignItems: 'center', 
    marginBottom: 20, 
    marginTop: 10,
    paddingHorizontal: 24 
  },
  brandTitle: { 
    fontSize: 26, 
    fontWeight: '900', 
    letterSpacing: 0.6, 
    // Web and iOS add the spacing after the last letter too: the same space in front keeps the word centred.
    paddingLeft: Platform.OS === 'android' ? 0 : 3,
    marginTop: 10,
  },
  brandSubtitle: { 
    fontSize: 13, 
    fontWeight: '600', 
    marginTop: 4,
    letterSpacing: 0.5,
  },

  card: {
    borderRadius: 28,
    borderWidth: 1,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 32,
    width: '100%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 8,
  },
  cardTitle: { fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
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
    paddingHorizontal: 12,
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
});
