import React, { useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { COLORS, SHADOWS, RADIUS } from '../constants/theme';
import { API_URL } from '../constants/api';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  const otpRefs = useRef<(TextInput | null)[]>([]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  const handleSendOtp = async () => {
    const digits = phone.replace(/\D/g, '').slice(-10);
    if (digits.length < 10) {
      Alert.alert('Invalid Number', 'Enter a valid 10-digit phone number.');
      return;
    }

    setLoading(true);
    // Mimic the Firebase OTP flow with developer bypass and loading delay
    setTimeout(() => {
      setLoading(false);
      setStep(2);
      setResendCooldown(60);
      Alert.alert('OTP Sent', 'For testing, enter verification code: 000000');
    }, 1000);
  };

  const handleVerifyAndReset = async () => {
    const code = otp.join('');
    if (code.length < 6) {
      Alert.alert('Enter OTP', 'Please enter the complete 6-digit code.');
      return;
    }
    if (!newPassword || newPassword.length < 6) {
      Alert.alert('Password Too Short', 'Password must be at least 6 characters.');
      return;
    }

    const digits = phone.replace(/\D/g, '').slice(-10);
    if (code !== '000000') {
      Alert.alert('Incorrect OTP', 'For bypass testing, please enter OTP: 000000');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/users/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          phone: digits, 
          firebaseToken: 'E2E_MOCK_TOKEN', 
          newPassword 
        }),
      });
      const data = await response.json();

      if (response.ok) {
        Alert.alert('Password Reset', 'Your password has been successfully updated.');
        router.replace('/login' as any);
      } else {
        Alert.alert('Reset Failed', data.message || 'Could not reset password.');
      }
    } catch (err) {
      Alert.alert('Error', 'Failed to connect to reset servers.');
    } finally {
      setLoading(false);
    }
  };

  const handleOtpChange = (val: string, idx: number) => {
    if (!/^\d*$/.test(val)) return;
    const next = [...otp];
    next[idx] = val.slice(-1);
    setOtp(next);
    if (val && idx < 5) {
      otpRefs.current[idx + 1]?.focus();
    }
  };

  return (
    <KeyboardAvoidingView style={s.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        {/* Back Link */}
        <TouchableOpacity 
          style={s.backLink} 
          onPress={() => {
            if (step === 2) {
              setStep(1);
            } else if (router.canGoBack()) {
              router.back();
            } else {
              router.replace('/login' as any);
            }
          }}
        >
          <Text style={s.backText}>‹ BACK</Text>
        </TouchableOpacity>

        <View style={s.logoWrap}>
          <Text style={s.logo}>✨</Text>
          <Text style={s.brand}>ZENVY</Text>
          <Text style={s.tagline}>RESET CREDENTIALS</Text>
        </View>

        <View style={s.card}>
          <Text style={s.stepTitle}>
            {step === 1 ? 'Reset Password' : 'Verify & Reset'}
          </Text>
          <Text style={s.stepSub}>
            {step === 1
              ? "We'll send a one-time code to your phone number."
              : `Code sent to +91 ${phone.replace(/\D/g, '').slice(-10)}`}
          </Text>

          {/* Step 1: Phone number */}
          {step === 1 && (
            <View style={{ marginTop: 20 }}>
              <Text style={s.label}>PHONE NUMBER</Text>
              <View style={s.phoneInputWrap}>
                <Text style={s.prefix}>+91</Text>
                <TextInput 
                  style={s.phoneInput} 
                  keyboardType="phone-pad"
                  maxLength={10}
                  placeholder="Registered number"
                  placeholderTextColor={COLORS.textMuted}
                  value={phone}
                  onChangeText={setPhone}
                />
              </View>

              <TouchableOpacity style={s.actionBtn} onPress={handleSendOtp} disabled={loading}>
                {loading ? (
                  <ActivityIndicator size="small" color="#000" />
                ) : (
                  <Text style={s.actionBtnText}>SEND OTP</Text>
                )}
              </TouchableOpacity>
            </View>
          )}

          {/* Step 2: OTP + New Password */}
          {step === 2 && (
            <View style={{ marginTop: 20 }}>
              <Text style={s.label}>6-DIGIT CODE</Text>
              <View style={s.otpRow}>
                {otp.map((digit, i) => (
                  <TextInput
                    key={i}
                    ref={el => { otpRefs.current[i] = el; }}
                    style={[s.otpInput, digit !== '' && s.otpInputActive]}
                    keyboardType="number-pad"
                    maxLength={1}
                    value={digit}
                    onChangeText={(val) => handleOtpChange(val, i)}
                    onKeyPress={({ nativeEvent }) => {
                      if (nativeEvent.key === 'Backspace' && !otp[i] && i > 0) {
                        otpRefs.current[i - 1]?.focus();
                      }
                    }}
                  />
                ))}
              </View>

              {/* Resend Cooldown */}
              <View style={s.resendWrap}>
                {resendCooldown > 0 ? (
                  <Text style={s.resendText}>Resend in {resendCooldown}s</Text>
                ) : (
                  <TouchableOpacity onPress={handleSendOtp}>
                    <Text style={[s.resendText, { color: COLORS.gold }]}>Resend OTP</Text>
                  </TouchableOpacity>
                )}
              </View>

              <Text style={s.label}>NEW PASSWORD</Text>
              <TextInput 
                style={s.input} 
                secureTextEntry={!showPassword}
                placeholder="Choose a new password"
                placeholderTextColor={COLORS.textMuted}
                value={newPassword}
                onChangeText={setNewPassword}
              />

              <TouchableOpacity style={s.actionBtn} onPress={handleVerifyAndReset} disabled={loading}>
                {loading ? (
                  <ActivityIndicator size="small" color="#000" />
                ) : (
                  <Text style={s.actionBtnText}>RESET PASSWORD</Text>
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
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  backLink: { position: 'absolute', top: Platform.OS === 'ios' ? 60 : 40, left: 24, padding: 8 },
  backText: { color: COLORS.gold, fontSize: 10, fontWeight: '900', letterSpacing: 2 },
  logoWrap: { alignItems: 'center', marginBottom: 30, marginTop: 40 },
  logo: { fontSize: 40, marginBottom: 8 },
  brand: { fontSize: 28, fontWeight: '900', color: COLORS.gold, letterSpacing: 10 },
  tagline: { fontSize: 8, fontWeight: '700', color: COLORS.textSecondary, letterSpacing: 4, marginTop: 4 },

  card: { backgroundColor: COLORS.bgCard, borderWidth: 1, borderColor: COLORS.borderDark, borderRadius: 24, padding: 24 },
  stepTitle: { fontSize: 18, fontWeight: '900', color: '#FFF' },
  stepSub: { fontSize: 11, fontWeight: '700', color: COLORS.textSecondary, marginTop: 4 },

  label: { fontSize: 8, fontWeight: '900', color: COLORS.textSecondary, letterSpacing: 2, marginBottom: 8, marginTop: 16 },
  phoneInputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.bgDark, borderWidth: 1, borderColor: COLORS.borderDark, borderRadius: 14, height: 48 },
  prefix: { paddingHorizontal: 16, fontSize: 14, fontWeight: '900', color: COLORS.gold },
  phoneInput: { flex: 1, height: '100%', color: '#FFF', fontSize: 14, fontWeight: '600' },

  input: { backgroundColor: COLORS.bgDark, borderWidth: 1, borderColor: COLORS.borderDark, borderRadius: 14, padding: 14, fontSize: 14, color: '#fff', fontWeight: '600', height: 48 },

  otpRow: { flexDirection: 'row', gap: 6, justifyContent: 'center', marginTop: 10 },
  otpInput: { width: 40, height: 44, borderRadius: 12, borderWidth: 1, borderColor: COLORS.borderDark, backgroundColor: COLORS.bgDark, textAlign: 'center', fontSize: 18, fontWeight: '900', color: '#FFF' },
  otpInputActive: { borderColor: COLORS.gold, color: COLORS.gold },
  resendWrap: { alignItems: 'flex-end', marginTop: 8 },
  resendText: { fontSize: 9, fontWeight: '800', color: COLORS.textSecondary },

  actionBtn: { backgroundColor: COLORS.gold, paddingVertical: 14, borderRadius: 14, alignItems: 'center', marginTop: 24, ...SHADOWS.goldGlow },
  actionBtnText: { fontSize: 11, fontWeight: '900', color: '#000', letterSpacing: 2 }
});
