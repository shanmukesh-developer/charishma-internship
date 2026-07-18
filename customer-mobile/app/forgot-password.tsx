import React, { useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator, Alert, Modal } from 'react-native';
import { WebView } from 'react-native-webview';
import { useRouter } from 'expo-router';
import { COLORS, SHADOWS, RADIUS } from '../constants/theme';
import { API_URL } from '../constants/api';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [phone, setPhone] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  
  // Real-Time Firebase Auth States
  const [authModalVisible, setAuthModalVisible] = useState(false);
  const [realtimeToken, setRealtimeToken] = useState('');

  const handleAuthMessage = (event: any) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === 'OTP_SUCCESS') {
        setRealtimeToken(msg.token);
        if (msg.phone) {
          setPhone(msg.phone.replace('+91', ''));
        }
        setAuthModalVisible(false);
        setStep(2);
        Alert.alert('Identity Verified', 'Your number is successfully verified in real-time! Please enter your new password below.');
      } else if (msg.type === 'AUTH_ERROR') {
        setAuthModalVisible(false);
        Alert.alert('Verification Failed', msg.error || 'Firebase could not verify this phone number.');
      }
    } catch (e) {
      console.warn('Could not parse webview message', e);
    }
  };

  const handleSendOtp = async () => {
    const digits = phone.replace(/\D/g, '').slice(-10);
    if (digits.length < 10) {
      Alert.alert('Invalid Number', 'Enter a valid 10-digit phone number.');
      return;
    }

    setAuthModalVisible(true);
  };

  const handleVerifyAndReset = async () => {
    const digits = phone.replace(/\D/g, '').slice(-10);

    if (!newPassword || newPassword.length < 6) {
      Alert.alert('Password Too Short', 'Password must be at least 6 characters.');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/users/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          phone: digits, 
          firebaseToken: realtimeToken, 
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
            {step === 1 ? 'Reset Password' : 'Choose New Password'}
          </Text>
          <Text style={s.stepSub}>
            {step === 1
              ? "Verify your mobile number using OTP to reset password."
              : 'Identity verified successfully! Enter your new password below.'}
          </Text>

          {/* Step 1: Phone Verification */}
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
                  <Text style={s.actionBtnText}>VERIFY VIA OTP</Text>
                )}
              </TouchableOpacity>
            </View>
          )}

          {/* Step 2: New Password Form */}
          {step === 2 && (
            <View style={{ marginTop: 20 }}>
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
            <Text style={{ fontSize: 13, fontWeight: '900', color: COLORS.gold, letterSpacing: 2 }}>ZENVY SECURE OTP</Text>
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
            startInLoadingState={true}
            renderLoading={() => (
              <View style={{ ...StyleSheet.absoluteFill, backgroundColor: '#0A0A0B', alignItems: 'center', justifyContent: 'center' }}>
                <ActivityIndicator size="large" color={COLORS.gold} />
              </View>
            )}
          />
        </KeyboardAvoidingView>
      </Modal>
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
  actionBtnText: { fontSize: 11, fontWeight: '900', color: '#000', letterSpacing: 2 },

  tabRow: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 12, padding: 4, marginVertical: 14, borderWidth: 1, borderColor: COLORS.borderDark },
  tabBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 8 },
  tabBtnActive: { backgroundColor: 'rgba(201,168,76,0.15)', borderWidth: 1, borderColor: 'rgba(201,168,76,0.3)' },
  tabText: { fontSize: 9, fontWeight: '800', color: COLORS.textMuted, letterSpacing: 1.5 },
  tabTextActive: { color: COLORS.gold },
});
