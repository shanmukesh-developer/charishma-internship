// C9: Settings -> Delete account (Google Play account-deletion requirement). Shows what is deleted / kept,
// any blockers from the server (trip in progress, open full-auto request), then asks for the password (or an
// SMS code sent to the account's own number) and DELETE. Backend: /api/auto-ride/driver/account/*.
import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { color, font, space } from '../theme';
import { Button, Card, ErrorStrip, SkeletonCard } from '../ui/kit';
import { Banner, Field, Screen } from '../ui/Screen';
import { useSession } from '../state/SessionProvider';
import { driverApi } from '../api/driverApi';
import { errorMessage } from '../lib/http';
import { openLegal } from '../lib/legal';
import type { ScreenProps } from '../nav';

type Check = { canDelete: boolean; blockers: { code: string; message: string }[]; phoneMasked: string };

export function DeleteAccountScreen({ navigation }: ScreenProps<'DeleteAccount'>) {
  const { signOut } = useSession();
  const [check, setCheck] = useState<Check | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [useCode, setUseCode] = useState(false);
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [confirm, setConfirm] = useState('');
  const [codeInfo, setCodeInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoadError(null);
    try { setCheck(await driverApi.deletionCheck()); } catch (e) { setLoadError(errorMessage(e)); }
  };
  useEffect(() => { load(); }, []);

  const sendCode = async () => {
    setError(null);
    setBusy(true);
    try {
      const r = await driverApi.sendDeleteOtp();
      setCodeInfo(r.message || 'We sent a 6-digit code to your number.');
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };

  const proof = useCode ? /^\d{6}$/.test(otp) : password.length > 0;
  const ready = !!check?.canDelete && proof && confirm.trim().toUpperCase() === 'DELETE';

  const remove = async () => {
    setError(null);
    setBusy(true);
    try {
      await driverApi.deleteAccount(useCode ? { otp } : { password });
      await signOut('Your Zenvy Auto Driver account has been deleted.');
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Screen title="Delete account" onBack={() => navigation.goBack()} keyboard>
      <Card style={{ gap: space.xs }}>
        <Text style={[font.h3, { color: color.text }]}>What is deleted</Text>
        <Text style={[font.body, { color: color.textSecondary }]}>
          Your name, mobile number, password, licence and badge numbers, emergency contact, your photo and document photos, auto
          photos and papers, notifications and push tokens. You are signed out on every phone.
        </Text>
        <Text style={[font.h3, { color: color.text, marginTop: space.xs }]}>What is kept</Text>
        <Text style={[font.body, { color: color.textSecondary }]}>
          Past trips, bookings, fares, incidents and the auto's registration, without your personal details, because the law
          requires them for accounts, tax and passenger safety.
        </Text>
        <Text style={[font.body, { color: color.primary, fontWeight: '700' }]} onPress={() => openLegal('deleteAccount')} accessibilityRole="link">
          Read the full details
        </Text>
      </Card>

      {!check && !loadError ? <SkeletonCard lines={2} /> : null}
      {loadError ? <ErrorStrip text={loadError} onRetry={load} /> : null}
      {check && check.blockers.length ? (
        <View style={{ gap: space.xs }}>
          {check.blockers.map((b) => <Banner key={b.code} tone="warn" text={b.message} />)}
        </View>
      ) : null}

      {check?.canDelete ? (
        <View style={{ gap: space.sm }}>
          {useCode ? (
            <>
              <Button label={codeInfo ? 'Send the code again' : `Send a code to ${check.phoneMasked || 'my number'}`} variant="secondary" onPress={sendCode} loading={busy && !otp} />
              {codeInfo ? <Text style={[font.small, { color: color.textSecondary }]}>{codeInfo}</Text> : null}
              <Field label="SMS code" value={otp} onChangeText={(t) => setOtp(t.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" maxLength={6} />
            </>
          ) : (
            <Field label="Your password" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" />
          )}
          <Text style={[font.body, { color: color.primary, fontWeight: '700' }]} onPress={() => { setUseCode(!useCode); setError(null); }} accessibilityRole="button">
            {useCode ? 'Use my password instead' : 'Forgot your password? Use an SMS code'}
          </Text>
          <Field label="Type DELETE to confirm" value={confirm} onChangeText={setConfirm} autoCapitalize="characters" />
          {error ? <Banner tone="error" text={error} /> : null}
          <Button label="Delete my account" icon="trash" variant="reject" onPress={remove} disabled={!ready} loading={busy && ready} />
        </View>
      ) : null}
    </Screen>
  );
}
