import React, { useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Platform, ScrollView, ActivityIndicator, Alert, Keyboard } from 'react-native';
import { KeyboardAvoidingView } from '../components/KeyboardAvoidingView';
import { useRouter } from 'expo-router';
import { COLORS, SHADOWS } from '../constants/theme';
import { ENDPOINTS } from '../constants/api';
import { postAuth, normalizePhone, isValidIndianMobile, NETWORK_ERROR_MESSAGE } from '../utils/auth';
import { usePhoneOtp, PhoneProof, isSmsSendFailure } from '../utils/phoneOtp';

/**
 * Password reset: real SMS code (POST /send-otp purpose "reset_password", Firebase fallback on native),
 * then POST /reset-password { phone, newPassword, otp | firebaseToken }.
 */
export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
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
    Keyboard.dismiss();
    runGuarded(async () => {
      const proof = autoProof || await phoneOtp.getProof(otp);
      const r = await postAuth(ENDPOINTS.resetPassword, { phone: phone10, newPassword, ...proof });
      if (r.ok) {
        try { require('../utils/sounds').playSound('success'); } catch {}
        Alert.alert('Password updated 🎉', 'You can now sign in with your new password.');
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
    <KeyboardAvoidingView style={s.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        contentContainerStyle={[s.scroll, { paddingBottom: 220 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        {/* Back Link */}
        <TouchableOpacity
          style={s.backLink}
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
        >
          <Text style={s.backText}>{step === 2 ? 'Change number' : 'Back to sign in'}</Text>
        </TouchableOpacity>

        <View style={s.logoWrap}>
          <Text style={s.logo}>✨</Text>
          <Text style={s.brand}>ZENVY</Text>
          <Text style={s.tagline}>Reset password</Text>
        </View>

        <View style={s.card}>
          <Text style={s.stepTitle}>
            {step === 1 ? 'Reset Password' : 'Choose New Password'}
          </Text>
          <Text style={s.stepSub}>
            {step === 1
              ? "We'll text a 6-digit code to your registered mobile number."
              : phoneOtp.mode === 'email'
                ? `Enter the code we emailed to ${phoneOtp.emailSentTo || 'you'} and pick a new password.`
                : `Enter the code sent to +91 ${phoneOtp.sentTo} and pick a new password.`}
          </Text>

          {/* Step 1: Phone */}
          {step === 1 && (
            <View style={{ marginTop: 20 }}>
              <Text style={s.label}>Phone number</Text>
              <View style={s.phoneInputWrap}>
                <Text style={s.prefix}>+91</Text>
                <TextInput
                  style={s.phoneInput}
                  keyboardType="phone-pad"
                  textContentType="telephoneNumber"
                  autoComplete="tel"
                  placeholder="Registered number"
                  placeholderTextColor={COLORS.textMuted}
                  value={phone}
                  onChangeText={(t) => { setPhone(t); if (error) setError(''); }}
                  returnKeyType="done"
                  onSubmitEditing={handleSendOtp}
                  editable={!busy}
                />
              </View>

              {error ? <Text style={s.error}>{error}</Text> : null}

              <TouchableOpacity style={[s.actionBtn, busy && { opacity: 0.7 }]} onPress={handleSendOtp} disabled={busy}>
                {busy ? (
                  <ActivityIndicator size="small" color="#000" />
                ) : (
                  <Text style={s.actionBtnText}>Send code</Text>
                )}
              </TouchableOpacity>
              {smsFailed && (
                <TouchableOpacity
                  onPress={() => { const d = normalizePhone(phone); if (isValidIndianMobile(d)) sendCode(d, true); }}
                  disabled={busy}
                  style={{ marginTop: 14, alignSelf: 'center' }}
                  accessibilityRole="button"
                >
                  <Text style={[s.resendText, { color: COLORS.gold }]}>Send the code by email instead</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Step 2: Code + New Password */}
          {step === 2 && (
            <View style={{ marginTop: 20 }}>
              {!autoProof && (
                <>
                  <Text style={s.label}>6-digit code</Text>
                  <TextInput
                    style={[s.input, { letterSpacing: 8, textAlign: 'center', fontSize: 18, fontWeight: '900' }]}
                    value={otp}
                    onChangeText={(t) => { setOtp(t.replace(/\D/g, '')); if (error) setError(''); }}
                    placeholder="••••••"
                    placeholderTextColor={COLORS.textMuted}
                    keyboardType="number-pad"
                    textContentType="oneTimeCode"
                    autoComplete="sms-otp"
                    maxLength={6}
                    autoFocus
                    editable={!busy}
                  />
                  <View style={s.resendWrap}>
                    <TouchableOpacity
                      disabled={phoneOtp.countdown > 0 || busy}
                      onPress={() => { const p = phoneOtp.sentTo; if (p) sendCode(p, phoneOtp.mode === 'email'); }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Text style={[s.resendText, !(phoneOtp.countdown > 0 || busy) && { color: COLORS.gold }]}>
                        {phoneOtp.countdown > 0 ? `Resend OTP in ${phoneOtp.countdown}s` : 'Resend OTP'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}

              <Text style={s.label}>New password</Text>
              <View style={[s.phoneInputWrap, { paddingRight: 14 }]}>
                <TextInput
                  style={[s.phoneInput, { paddingHorizontal: 14 }]}
                  secureTextEntry={!showPassword}
                  placeholder="At least 6 characters"
                  placeholderTextColor={COLORS.textMuted}
                  value={newPassword}
                  onChangeText={(t) => { setNewPassword(t); if (error) setError(''); }}
                  textContentType="newPassword"
                  autoComplete="password-new"
                  returnKeyType="go"
                  onSubmitEditing={handleVerifyAndReset}
                  editable={!busy}
                />
                <TouchableOpacity onPress={() => setShowPassword(!showPassword)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={{ fontSize: 16 }}>{showPassword ? '👁️' : '🔒'}</Text>
                </TouchableOpacity>
              </View>

              {info && !error ? <Text style={s.info}>{info}</Text> : null}
              {error ? <Text style={s.error}>{error}</Text> : null}

              <TouchableOpacity style={[s.actionBtn, busy && { opacity: 0.7 }]} onPress={handleVerifyAndReset} disabled={busy}>
                {busy ? (
                  <ActivityIndicator size="small" color="#000" />
                ) : (
                  <Text style={s.actionBtnText}>Reset password</Text>
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
  container: { flex: 1, backgroundColor: COLORS.bgDark },
  scroll: { flexGrow: 1, paddingTop: 40, padding: 24, maxWidth: 520, width: '100%', alignSelf: 'center' },
  backLink: { position: 'absolute', top: Platform.OS === 'ios' ? 60 : 40, left: 24, padding: 8 },
  backText: { color: COLORS.gold, fontSize: 13, fontWeight: '700' },
  logoWrap: { alignItems: 'center', marginBottom: 30, marginTop: 40 },
  logo: { fontSize: 40, marginBottom: 8 },
  brand: { fontSize: 28, fontWeight: '900', color: COLORS.gold, letterSpacing: 10 },
  tagline: { fontSize: 13, fontWeight: '600', color: COLORS.textSecondary, marginTop: 4 },

  card: { backgroundColor: COLORS.bgCard, borderWidth: 1, borderColor: COLORS.borderDark, borderRadius: 24, padding: 24, maxWidth: 520, width: '100%', alignSelf: 'center' },
  stepTitle: { fontSize: 18, fontWeight: '900', color: '#FFF' },
  stepSub: { fontSize: 12, fontWeight: '700', color: COLORS.textSecondary, marginTop: 4 },

  label: { fontSize: 13, fontWeight: '700', color: COLORS.textSecondary, marginBottom: 8, marginTop: 16 },
  phoneInputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.bgDark, borderWidth: 1, borderColor: COLORS.borderDark, borderRadius: 14, height: 48 },
  prefix: { paddingHorizontal: 16, fontSize: 14, fontWeight: '900', color: COLORS.gold },
  phoneInput: { flex: 1, height: '100%', color: '#FFF', fontSize: 14, fontWeight: '600' },

  input: { backgroundColor: COLORS.bgDark, borderWidth: 1, borderColor: COLORS.borderDark, borderRadius: 14, padding: 14, fontSize: 14, color: '#fff', fontWeight: '600', height: 48 },

  otpRow: { flexDirection: 'row', gap: 6, justifyContent: 'center', marginTop: 10 },
  otpInput: { width: 40, height: 44, borderRadius: 12, borderWidth: 1, borderColor: COLORS.borderDark, backgroundColor: COLORS.bgDark, textAlign: 'center', fontSize: 18, fontWeight: '900', color: '#FFF' },
  otpInputActive: { borderColor: COLORS.gold, color: COLORS.gold },
  resendWrap: { alignItems: 'flex-end', marginTop: 8 },
  resendText: { fontSize: 12, fontWeight: '800', color: COLORS.textSecondary },
  error: { color: '#EF4444', fontSize: 12, fontWeight: '600', marginTop: 10 },
  info: { color: '#10B981', fontSize: 12, fontWeight: '700', marginTop: 10 },

  actionBtn: { backgroundColor: COLORS.gold, paddingVertical: 14, borderRadius: 14, alignItems: 'center', marginTop: 24, ...SHADOWS.goldGlow },
  actionBtnText: { fontSize: 15, fontWeight: '800', color: '#000' },

  tabRow: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 12, padding: 4, marginVertical: 14, borderWidth: 1, borderColor: COLORS.borderDark },
  tabBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 8 },
  tabBtnActive: { backgroundColor: 'rgba(201,168,76,0.15)', borderWidth: 1, borderColor: 'rgba(201,168,76,0.3)' },
  tabText: { fontSize: 13, fontWeight: '700', color: COLORS.textMuted },
  tabTextActive: { color: COLORS.gold },
});
