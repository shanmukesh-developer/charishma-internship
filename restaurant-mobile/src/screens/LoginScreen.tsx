// Real restaurant login (POST /api/restaurants/login). No presets, no pre-filled passwords.
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Image, Linking, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SUPPORT_PHONE } from '../config';
import { health, isStallAccount, login } from '../lib/api';
import { ApiError, NetworkError } from '../lib/http';
import { loadSavedId, setSavedId } from '../lib/storage';
import { useSession } from '../state/SessionProvider';
import { KeyboardAvoidingView } from '../ui/KeyboardAvoidingView';
import { color, font, radius, space, touch } from '../theme';
import { Button } from '../ui/kit';
import { LegalLine } from '../lib/legal';

type ServerState = 'checking' | 'up' | 'waking';

/** Which partner app a stall account belongs to: In-Campus Booking stalls use ZCS Campus Stall, the others ZCS Vendor. */
const stallAppMessage = (r: any) => (r && r.campusBookingEnabled === true
  ? 'This stall takes In-Campus Bookings. Please log in with the ZENV Campus Stall app.'
  : 'This is a stall account. Please log in with the ZENV Vendor app.');

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { signIn, notice, clearNotice } = useSession();
  const [identifier, setIdentifier] = useState('');
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
    loadSavedId().then((v) => { if (alive && v) setIdentifier((cur) => cur || v); });
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
    const id = identifier.trim();
    if (!id || !password) {
      setError('Enter your store login ID and password.');
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    clearNotice();
    try {
      const data = await login(id, password);
      if (!data?.token || !data?.restaurant) throw new Error('bad response');
      if (isStallAccount(data.restaurant)) {
        setError(stallAppMessage(data.restaurant));
        return;
      }
      await setSavedId(remember ? id : null);
      await signIn(data.token, data.restaurant);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'USE_VENDOR_APP') {
        // The server names the right app (ZCS Campus Stall for In-Campus Booking stalls, else ZCS Vendor).
        setError(e.message || 'This is a stall account. Please log in with the ZENV Vendor app.');
      } else if (e instanceof ApiError && e.status === 401 && /invalid credentials/i.test(e.message)) {
        setError('Wrong store login ID or password. Check and try again.');
      } else if (e instanceof ApiError) {
        setError(e.message);
        if (e.status === 429) {
          setLockedUntil(Date.now() + 60000);
          setNow(Date.now());
        }
      } else if (e instanceof NetworkError) {
        setError(server === 'waking' ? 'ZENV is waking up. Please try again in a few seconds.' : e.message);
      } else {
        setError('Something went wrong. Please try again.');
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const call = () => Linking.openURL(`tel:+${SUPPORT_PHONE}`).catch(() => {});
  const wa = () => Linking.openURL(`https://wa.me/${SUPPORT_PHONE}?text=${encodeURIComponent(`Hi ZENV, I forgot the password for the restaurant partner app. Please reset it.${identifier.trim() ? ` My store login ID: ${identifier.trim()}.` : ''}`)}`).catch(() => {});

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: color.bg }}>
      <ScrollView
        contentContainerStyle={[styles.wrap, { paddingTop: insets.top + space.xl, paddingBottom: insets.bottom + space.lg }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.brand}>
          <Image source={require('../../assets/zenv-brand-badge-2026-11-04.png')} style={styles.logo} accessibilityIgnoresInvertColors />
          <Text style={[font.h1, { color: color.text }]}>ZENV Partner</Text>
          <Text style={[font.body, { color: color.textSecondary }]}>Restaurant login</Text>
        </View>

        {notice ? (
          <View style={[styles.msg, { backgroundColor: color.warningTint }]}>
            <Ionicons name="time-outline" size={20} color={color.warning} />
            <Text style={[font.body, { color: color.warning, flex: 1 }]}>{notice}</Text>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.label}>Store login ID</Text>
          <Text style={[font.small, { color: color.textMuted, marginBottom: space.xxs }]}>From your ZENV welcome message. Your store name also works.</Text>
          <TextInput
            value={identifier}
            onChangeText={(t) => { setIdentifier(t); setError(null); }}
            placeholder="Store login ID"
            placeholderTextColor={color.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!submitting}
            returnKeyType="next"
            onSubmitEditing={() => pwRef.current?.focus()}
            style={styles.input}
            accessibilityLabel="Store login ID, from your ZENV welcome message"
          />

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
              editable={!submitting}
              returnKeyType="go"
              onSubmitEditing={submit}
              style={[styles.input, { flex: 1, borderWidth: 0 }]}
              accessibilityLabel="Password"
            />
            <Pressable onPress={() => setShowPw((v) => !v)} accessibilityRole="button" accessibilityLabel={showPw ? 'Hide password' : 'Show password'} style={styles.eye}>
              <Ionicons name={showPw ? 'eye-off' : 'eye'} size={22} color={color.textSecondary} />
            </Pressable>
          </View>

          <View style={styles.rememberRow}>
            <Text style={[font.body, { color: color.text, flex: 1 }]}>Remember my ID</Text>
            <Switch value={remember} onValueChange={setRemember} trackColor={{ true: color.open, false: color.border }} thumbColor={color.surface} accessibilityLabel="Remember my store login ID" />
          </View>

          {error ? (
            <View style={[styles.msg, { backgroundColor: color.alertTint, marginTop: space.sm }]} accessibilityLiveRegion="polite">
              <Ionicons name="alert-circle" size={20} color={color.alert} />
              <Text style={[font.body, { color: color.alertDark, flex: 1 }]}>{error}</Text>
            </View>
          ) : null}

          <Button
            label={locked ? `Try again in ${Math.max(1, Math.ceil((lockedUntil - now) / 1000))} s` : 'Log in'}
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
            {server === 'checking' ? 'Checking ZENV…' : server === 'up' ? 'ZENV is online' : 'ZENV is waking up — first login can take ~30 s'}
          </Text>
        </View>

        <View style={styles.help}>
          <Text style={[font.body, { color: color.text, fontWeight: '800', textAlign: 'center' }]}>Forgot password?</Text>
          <Text style={[font.small, { color: color.textSecondary, textAlign: 'center' }]}>Ask your ZENV admin to reset it. New partner? Contact us the same way.</Text>
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
  pwRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: color.border, borderRadius: radius.md },
  eye: { width: touch.icon, height: touch.icon, alignItems: 'center', justifyContent: 'center' },
  rememberRow: { flexDirection: 'row', alignItems: 'center', minHeight: touch.min, marginTop: space.sm },
  msg: { flexDirection: 'row', alignItems: 'center', gap: space.xs, borderRadius: radius.md, padding: space.sm },
  server: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs },
  dot: { width: 10, height: 10, borderRadius: 5 },
  help: { gap: space.sm, marginTop: 'auto' },
});
