// Sign-in (phone + password) for accounts the ZCS team created in the admin dashboard (no self sign-up: SMS
// OTP is unreliable, so PG owners get "Plan B" accounts with a temporary password). After the first sign-in
// the owner MUST pick an own password (FirstPasswordScreen); the server refuses every other owner endpoint
// with 403 PASSWORD_CHANGE_REQUIRED until then. Also the Suspended screen.
import React, { useEffect, useState } from 'react';
import { Image, Linking, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, font, radius, space } from '../theme';
import { Button, Card } from '../ui/kit';
import { Banner, Field } from '../ui/Screen';
import { PasswordField } from '../ui/PasswordField';
import { KeyboardAwareScrollView } from '../ui/KeyboardAvoidingView';
import { useSession } from '../state/SessionProvider';
import { ownerApi, normalizePhone, passwordProblem } from '../api/ownerApi';
import { ApiError, NetworkError, errorMessage } from '../lib/http';
import { loadSavedPhone, setSavedPhone } from '../lib/storage';
import { LegalLine } from '../lib/legal';
import { SUPPORT_PHONE, SUPPORT_PHONE_DISPLAY } from '../config';

const logo = require('../../assets/icon.png');

const digits = (v: string) => {
  let d = v.replace(/\D/g, '');
  if (d.length > 10 && d.startsWith('91')) d = d.slice(2);
  if (d.length > 10 && d.startsWith('0')) d = d.slice(1);
  return d.slice(0, 10);
};
const callSupport = () => { Linking.openURL(`tel:+${SUPPORT_PHONE}`).catch(() => {}); };

function Shell({ children, title, subtitle }: { children: React.ReactNode; title: string; subtitle: string }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <KeyboardAwareScrollView contentContainerStyle={[st.wrap, { paddingTop: insets.top + space.xl, paddingBottom: insets.bottom + space.xl }]}>
        <View style={st.brand}>
          <Image source={logo} style={st.logo} accessibilityLabel="ZCS PG Partner" />
          <Text style={[font.h1, { color: color.text, textAlign: 'center' }]}>{title}</Text>
          <Text style={[font.body, { color: color.textMuted, textAlign: 'center' }]}>{subtitle}</Text>
        </View>
        {children}
      </KeyboardAwareScrollView>
    </View>
  );
}

export function LoginScreen() {
  const { signIn, notice, clearNotice } = useSession();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { loadSavedPhone().then((p) => { if (p) setPhone(p); }); }, []);

  const valid = !!normalizePhone(phone) && password.length > 0;
  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    clearNotice();
    try {
      const p = normalizePhone(phone)!;
      const r = await ownerApi.login(p, password);
      await setSavedPhone(p);
      await signIn(r.token, r.owner);
    } catch (e) {
      if (e instanceof NetworkError) setError('No internet, or ZCS is waking up. Try again in a moment.');
      else setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell title="ZCS PG Partner" subtitle="Manage your PG: booking requests, rooms, mess and rent.">
      <Card style={{ gap: space.md }}>
        {notice ? <Banner tone="warn" text={notice} /> : null}
        <Field label="Mobile number" prefix="+91" value={phone} onChangeText={(v) => { setPhone(digits(v)); setError(null); }}
          keyboardType="phone-pad" autoComplete="tel" placeholder="10-digit mobile" maxLength={14} />
        <PasswordField label="Password" value={password} onChange={(v) => { setPassword(v); setError(null); }} onSubmit={submit}
          hint="First time? Use the temporary password from the ZCS team." />
        {error ? <Banner tone="error" text={error} /> : null}
        <Button label="Sign in" icon="log-in-outline" onPress={submit} loading={busy} disabled={!valid} />
      </Card>
      <Text style={[font.small, { color: color.textMuted, textAlign: 'center' }]}>
        No account yet? PG owner accounts are set up by the ZCS housing team for listed PGs.
      </Text>
      <Button label={`Forgot password? Call ${SUPPORT_PHONE_DISPLAY}`} icon="call-outline" variant="ghost" size="secondary" onPress={callSupport} />
      <LegalLine />
    </Shell>
  );
}

/** Shown until the temporary password from the admin is replaced. */
export function FirstPasswordScreen() {
  const { owner, replaceSession, signOut } = useSession();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const problem = next ? passwordProblem(next) : null;
  const mismatch = confirm.length > 0 && confirm !== next;
  const same = next.length > 0 && next === current;
  const ready = current.length > 0 && next.length > 0 && !problem && !mismatch && !same && confirm === next;

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await ownerApi.changePassword(current, next, true);
      await replaceSession(r.token, r.owner);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'INVALID_CREDENTIALS') setError('The temporary password is wrong. Check the one the ZCS team gave you.');
      else setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Shell title={`Welcome${owner?.name ? `, ${owner.name.split(' ')[0]}` : ''}`} subtitle="Set your own password to start. Only you will know it.">
      <Card style={{ gap: space.md }}>
        <PasswordField label="Temporary password" value={current} onChange={(v) => { setCurrent(v); setError(null); }} placeholder="From the ZCS team" />
        <PasswordField label="New password" value={next} onChange={(v) => { setNext(v); setError(null); }} autoComplete="new-password"
          placeholder="8+ characters, letters and numbers" error={problem || (same ? 'Choose a password different from the temporary one.' : null)} />
        <PasswordField label="Confirm new password" value={confirm} onChange={(v) => { setConfirm(v); setError(null); }} onSubmit={submit}
          autoComplete="new-password" placeholder="Type it again" error={mismatch ? 'The passwords do not match.' : null} />
        {error ? <Banner tone="error" text={error} /> : null}
        <Button label="Save password and continue" icon="shield-checkmark-outline" onPress={submit} loading={busy} disabled={!ready} />
      </Card>
      <Button label="Sign out" variant="ghost" size="secondary" onPress={() => signOut()} />
    </Shell>
  );
}

export function SuspendedScreen({ message, onSignOut }: { message: string; onSignOut: () => void }) {
  return (
    <Shell title="Account suspended" subtitle="Your PG listing is not affected by this screen.">
      <Banner tone="error" text={message} />
      <Button label={`Call ZCS support (${SUPPORT_PHONE_DISPLAY})`} icon="call-outline" onPress={callSupport} />
      <Button label="Sign out" variant="secondary" onPress={onSignOut} />
    </Shell>
  );
}

const st = StyleSheet.create({
  wrap: { paddingHorizontal: space.lg, gap: space.lg, flexGrow: 1, justifyContent: 'center' },
  brand: { alignItems: 'center', gap: space.xs },
  logo: { width: 96, height: 96, borderRadius: radius.xl, marginBottom: space.xs },
});
