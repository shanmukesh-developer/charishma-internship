// Vendor login: phone number + password created by Zenvy admin (POST /api/restaurants/login).
// No presets, no pre-filled passwords.
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Image, Linking, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SUPPORT_PHONE } from '../config';
import { health, login, normalizePhone } from '../lib/api';
import { ApiError, NetworkError } from '../lib/http';
import { loadSavedPhone, setSavedPhone } from '../lib/storage';
import { useSession } from '../state/SessionProvider';
import { KeyboardAvoidingView } from '../ui/KeyboardAvoidingView';
import { color, font, radius, space, touch } from '../theme';
import { Button } from '../ui/kit';
import { LegalLine } from '../lib/legal';

type ServerState = 'checking' | 'up' | 'waking';

const LOCAL_TYPES = ['LOCAL_VENDOR', 'LOCAL', 'STALL'];
// The server already refuses restaurant accounts (403 NOT_A_VENDOR_ACCOUNT with app: 'vendor'); this guards older replies.
const isLocalVendor = (r: any) => !!r && (typeof r.isLocalVendor === 'boolean' ? r.isLocalVendor : LOCAL_TYPES.includes(String(r.vendorType || '').toUpperCase()));

/** Turns server replies into words a stall owner understands. */
function friendly(e: unknown, serverWaking: boolean): string {
  if (e instanceof ApiError) {
    if (e.status === 401) {
      if (/no password/i.test(e.message)) return 'Your password is not set yet. Call Zenvy support to set it.';
      return 'Wrong phone number or password. Check and try again.';
    }
    if (e.status === 403) return e.message || 'This account is not allowed to log in here. Call Zenvy support.';
    // The account lock lasts 15 minutes (the server says so); the network limiter is shorter.
    if (e.status === 423 || e.status === 429) return /minutes/i.test(e.message) ? e.message : 'Too many tries. Please wait a minute and try again.';
    if (e.status === 400) return 'Enter your phone number and password.';
    return e.message;
  }
  if (e instanceof NetworkError) return serverWaking ? 'Zenvy is waking up. Please try again in a few seconds.' : e.message;
  return 'Something went wrong. Please try again.';
}

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { signIn, notice, clearNotice } = useSession();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockedUntil, setLockedUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [server, setServer] = useState<ServerState>('checking');
  const pwRef = useRef<TextInput>(null);
  const submittingRef = useRef(false);

  useEffect(() => {
    let alive = true;
    loadSavedPhone().then((v) => { if (alive && v) setPhone((cur) => cur || v); });
    health().then((ok) => { if (alive) setServer(ok ? 'up' : 'waking'); });
    return () => { alive = false; };
  }, []);

  // Tick while locked so the button re-enables on time.
  useEffect(() => {
    if (lockedUntil <= Date.now()) return;
    const t = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= lockedUntil) clearInterval(t);
    }, 1000);
    return () => clearInterval(t);
  }, [lockedUntil]);
  const locked = lockedUntil > now;

  const submit = async () => {
    if (submittingRef.current || locked) return;
    const id = phone.trim();
    if (!id || !password) {
      setError('Enter your phone number and password.');
      return;
    }
    // Digits only and not 10 long = a typo, not a stall ID.
    if (/^[\d\s+-]+$/.test(id) && !normalizePhone(id)) {
      setError('Enter your 10-digit mobile number.');
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    clearNotice();
    try {
      const data = await login(id, password);
      if (!data?.token || !data?.restaurant) throw new Error('bad response');
      if (!isLocalVendor(data.restaurant)) {
        setError('This is a restaurant account. Please use the Zenvy Restaurant app.');
        return;
      }
      // Saved as 10 digits: the field already shows +91 in front ("+91 +91 98765…" otherwise).
      await setSavedPhone(remember ? (normalizePhone(id) || id) : null);
      await signIn(data.token, data.restaurant);
    } catch (e) {
      setError(friendly(e, server === 'waking'));
      if (e instanceof ApiError && (e.status === 429 || e.status === 423)) {
        setLockedUntil(Date.now() + 60000);
        setNow(Date.now());
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const call = () => Linking.openURL(`tel:+${SUPPORT_PHONE}`).catch(() => {});
  const wa = () => Linking.openURL(`https://wa.me/${SUPPORT_PHONE}?text=${encodeURIComponent('Hi Zenvy, I need help logging in to the Zenvy Vendor app.')}`).catch(() => {});

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: color.bg }}>
      <ScrollView
        contentContainerStyle={[styles.wrap, { paddingTop: insets.top + space.xl, paddingBottom: insets.bottom + space.lg }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.brand}>
          <Image source={require('../../assets/icon.png')} style={styles.logo} accessibilityIgnoresInvertColors />
          <Text style={[font.h1, { color: color.text }]}>Zenvy Vendor</Text>
          <Text style={[font.body, { color: color.textSecondary, textAlign: 'center' }]}>For campus stalls — tea, tiffin, juice and more</Text>
        </View>

        {notice ? (
          <View style={[styles.msg, { backgroundColor: color.warningTint }]}>
            <Ionicons name="time-outline" size={20} color={color.warning} />
            <Text style={[font.body, { color: color.warning, flex: 1 }]}>{notice}</Text>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.label}>Phone number</Text>
          <View style={styles.phoneRow}>
            <Text style={[font.h3, { color: color.textSecondary, paddingLeft: space.sm }]}>+91</Text>
            <TextInput
              value={phone}
              onChangeText={(t) => { setPhone(t.slice(0, 40)); setError(null); }}
              placeholder="98765 43210"
              placeholderTextColor={color.textMuted}
              keyboardType="phone-pad"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="tel"
              textContentType="telephoneNumber"
              editable={!submitting}
              returnKeyType="next"
              onSubmitEditing={() => pwRef.current?.focus()}
              style={[styles.input, { flex: 1, borderWidth: 0, fontSize: 20 }]}
              accessibilityLabel="Phone number"
            />
          </View>

          <Text style={[styles.label, { marginTop: space.md }]}>Password</Text>
          <View style={styles.pwRow}>
            <TextInput
              ref={pwRef}
              value={password}
              onChangeText={(t) => { setPassword(t); setError(null); }}
              placeholder="Password"
              placeholderTextColor={color.textMuted}
              secureTextEntry={!showPw}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="password"
              textContentType="password"
              editable={!submitting}
              returnKeyType="go"
              onSubmitEditing={submit}
              style={[styles.input, { flex: 1, borderWidth: 0 }]}
              accessibilityLabel="Password"
            />
            <Pressable onPress={() => setShowPw((v) => !v)} accessibilityRole="button" accessibilityLabel={showPw ? 'Hide password' : 'Show password'} style={styles.eye}>
              <Ionicons name={showPw ? 'eye-off' : 'eye'} size={24} color={color.textSecondary} />
              <Text style={[font.label, { color: color.textSecondary, fontSize: 11 }]}>{showPw ? 'HIDE' : 'SHOW'}</Text>
            </Pressable>
          </View>

          <View style={styles.rememberRow}>
            <Text style={[font.body, { color: color.text, flex: 1 }]}>Remember my phone number</Text>
            <Switch value={remember} onValueChange={setRemember} trackColor={{ true: color.open, false: color.border }} thumbColor={color.surface} accessibilityLabel="Remember my phone number" />
          </View>

          {error ? (
            <View style={[styles.msg, { backgroundColor: color.alertTint, marginTop: space.sm }]} accessibilityLiveRegion="polite">
              <Ionicons name="alert-circle" size={20} color={color.alert} />
              <Text style={[font.body, { color: color.alertDark, flex: 1 }]}>{error}</Text>
            </View>
          ) : null}

          <Button
            label={locked ? `Try again in ${Math.max(1, Math.ceil((lockedUntil - now) / 1000))} s` : 'LOG IN'}
            onPress={submit}
            loading={submitting}
            disabled={locked}
            style={{ marginTop: space.md }}
          />
          <View style={{ marginTop: space.sm }}>
            <LegalLine prefix="By logging in you agree to the" />
          </View>
        </View>

        <View style={styles.server}>
          {server === 'checking' ? <ActivityIndicator size="small" color={color.textMuted} /> : (
            <View style={[styles.dot, { backgroundColor: server === 'up' ? color.open : color.warning }]} />
          )}
          <Text style={[font.small, { color: color.textMuted }]}>
            {server === 'checking' ? 'Checking Zenvy…' : server === 'up' ? 'Zenvy is online' : 'Zenvy is waking up — first login can take ~30 s'}
          </Text>
        </View>

        <View style={styles.help}>
          <Text style={[font.body, { color: color.textSecondary, textAlign: 'center' }]}>Forgot password or want to join Zenvy?</Text>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button label="Call" icon="call" variant="secondary" size="secondary" onPress={call} style={{ flex: 1 }} />
            <Button label="WhatsApp" icon="logo-whatsapp" variant="secondary" size="secondary" onPress={wa} style={{ flex: 1 }} />
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: space.md, gap: space.lg, flexGrow: 1, maxWidth: 520, width: '100%', alignSelf: 'center' },
  brand: { alignItems: 'center', gap: space.xxs },
  logo: { width: 72, height: 72, borderRadius: radius.lg, marginBottom: space.xs },
  card: { backgroundColor: color.surface, borderRadius: radius.lg, padding: space.md, borderWidth: 1, borderColor: color.border },
  label: { ...font.label, color: color.textSecondary, marginBottom: space.xxs },
  input: {
    minHeight: touch.secondary + 4, borderWidth: 1, borderColor: color.border, borderRadius: radius.md, paddingHorizontal: space.sm,
    ...font.body, color: color.text, backgroundColor: color.surface,
  },
  phoneRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: color.border, borderRadius: radius.md },
  pwRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: color.border, borderRadius: radius.md },
  eye: { width: 64, height: touch.secondary, alignItems: 'center', justifyContent: 'center' },
  rememberRow: { flexDirection: 'row', alignItems: 'center', minHeight: touch.min, marginTop: space.sm },
  msg: { flexDirection: 'row', alignItems: 'center', gap: space.xs, borderRadius: radius.md, padding: space.sm },
  server: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs },
  dot: { width: 10, height: 10, borderRadius: 5 },
  help: { gap: space.sm, marginTop: 'auto' },
});
