// Splash, Login and Pending approval.
import React, { useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { C, R, S, T, useInsets } from '../theme';
import { Btn, Spinner } from '../ui/kit';
import { useRider } from '../state/RiderStore';
import { ApiError, NetworkError, errorMessage } from '../services/apiClient';
import * as links from '../services/links';
import { SUPPORT_PHONE } from '../config';
import { LegalLine } from '../services/legal';

const logo = require('../../assets/icon.png');

export function SplashScreen() {
  const { phase, retryBoot } = useRider();
  const insets = useInsets();
  return (
    <View style={[styles.center, { backgroundColor: C.bg, paddingTop: insets.top }]}>
      <Image source={logo} style={styles.logo} accessibilityLabel="Zenvy Rider" />
      <Text style={[T.h2, { color: C.ink }]}>Zenvy Rider</Text>
      {phase === 'splash-error' ? (
        <View style={{ gap: S.md, alignItems: 'stretch', paddingHorizontal: S.xl, alignSelf: 'stretch' }}>
          <Text style={[T.body, { color: C.ink2, textAlign: 'center' }]}>Can't reach Zenvy. Check your internet and try again.</Text>
          <Btn title="Try again" icon="refresh" onPress={retryBoot} />
        </View>
      ) : (
        <Spinner />
      )}
    </View>
  );
}

function cleanPhone(v: string): string {
  let d = v.replace(/\D/g, '');
  if (d.length > 10 && d.startsWith('91')) d = d.slice(2);
  if (d.length > 10 && d.startsWith('0')) d = d.slice(1);
  return d.slice(0, 10);
}

export function LoginScreen() {
  const { login } = useRider();
  const insets = useInsets();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = /^[6-9]\d{9}$/.test(phone) && password.length > 0 && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await login(phone, password);
    } catch (e) {
      if (e instanceof NetworkError) setError('No internet. Check your connection and try again.');
      else if (e instanceof ApiError && e.status === 401) setError(e.message || 'Wrong phone number or password.');
      else setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={[styles.loginWrap, { paddingTop: insets.top + S.xl, paddingBottom: insets.bottom + S.xl }]} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center', gap: S.sm }}>
          <Image source={logo} style={styles.logo} accessibilityLabel="Zenvy Rider" />
          <Text style={[T.h1, { color: C.ink }]}>Zenvy Rider</Text>
          <Text style={[T.body, { color: C.ink2, textAlign: 'center' }]}>Log in with the number your Zenvy fleet admin registered.</Text>
        </View>

        <View style={{ gap: S.sm }}>
          <Text style={[T.label, { color: C.ink2 }]}>PHONE NUMBER</Text>
          <View style={styles.inputRow}>
            <Text style={[T.h3, { color: C.ink2 }]}>+91</Text>
            <TextInput
              value={phone}
              onChangeText={(v) => {
                setPhone(cleanPhone(v));
                setError(null);
              }}
              keyboardType="phone-pad"
              textContentType="telephoneNumber"
              autoComplete="tel"
              placeholder="10-digit mobile"
              placeholderTextColor={C.muted}
              style={[T.h3, styles.input]}
              accessibilityLabel="Phone number"
              maxLength={14}
            />
          </View>
        </View>

        <View style={{ gap: S.sm }}>
          <Text style={[T.label, { color: C.ink2 }]}>PASSWORD</Text>
          <View style={styles.inputRow}>
            <TextInput
              value={password}
              onChangeText={(v) => {
                setPassword(v);
                setError(null);
              }}
              secureTextEntry={!show}
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="password"
              placeholder="Password"
              placeholderTextColor={C.muted}
              style={[T.h3, styles.input]}
              accessibilityLabel="Password"
              returnKeyType="go"
              onSubmitEditing={submit}
            />
            <Pressable accessibilityRole="button" accessibilityLabel={show ? 'Hide password' : 'Show password'} onPress={() => setShow((s) => !s)} hitSlop={12}>
              <MaterialCommunityIcons name={show ? 'eye-off-outline' : 'eye-outline'} size={28} color={C.ink2} />
            </Pressable>
          </View>
        </View>

        {error ? (
          <View style={styles.error} accessibilityRole="alert">
            <MaterialCommunityIcons name="alert-circle" size={22} color={C.red} />
            <Text style={[T.body, { color: C.red, flex: 1, fontWeight: '700' }]}>{error}</Text>
          </View>
        ) : null}

        <Btn title="Log in" icon="login" onPress={submit} loading={busy} disabled={!canSubmit} />
        <LegalLine />
        <Btn
          title="Forgot password? Call Zenvy"
          icon="phone"
          variant="outline"
          size="mid"
          onPress={() => links.callNumber(`+${SUPPORT_PHONE}`)}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function PendingScreen() {
  const { recheckApproval, logout, profile, showToast } = useRider();
  const insets = useInsets();
  return (
    <View style={[styles.center, { backgroundColor: C.bg, paddingHorizontal: S.xl, gap: S.lg, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.pendingIcon}>
        <MaterialCommunityIcons name="shield-account-outline" size={48} color={C.amber} />
      </View>
      <Text style={[T.h2, { color: C.ink, textAlign: 'center' }]}>
        {profile?.name ? `Hi ${profile.name.split(' ')[0]}, almost there` : 'Almost there'}
      </Text>
      <Text style={[T.body, { color: C.ink2, textAlign: 'center' }]}>
        Zenvy is checking your documents. You can go online as soon as you are approved.
      </Text>
      <View style={{ alignSelf: 'stretch', gap: S.md, marginTop: S.md }}>
        <Btn
          title="Check again"
          icon="refresh"
          onPress={async () => {
            try {
              await recheckApproval();
            } catch (e) {
              showToast(errorMessage(e), 'error');
            }
          }}
        />
        <Btn title="Call Zenvy" icon="phone" variant="outline" size="mid" onPress={() => links.callNumber(`+${SUPPORT_PHONE}`)} />
        <Btn title="Log out" icon="logout" variant="soft" size="mid" onPress={logout} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: S.lg },
  logo: { width: 92, height: 92, borderRadius: 24 },
  loginWrap: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: S.xl,
    gap: S.xl,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.md,
    minHeight: 62,
    borderRadius: R.md,
    borderWidth: 2,
    borderColor: C.line,
    backgroundColor: C.card,
    paddingHorizontal: S.lg,
  },
  input: { flex: 1, color: C.ink, minHeight: 54 },
  error: { flexDirection: 'row', gap: S.sm, alignItems: 'center', backgroundColor: C.redTint, padding: S.md, borderRadius: R.md },
  pendingIcon: { width: 96, height: 96, borderRadius: 48, backgroundColor: C.amberTint, alignItems: 'center', justifyContent: 'center' },
});
