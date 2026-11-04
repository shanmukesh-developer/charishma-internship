// Login (phone + password) and Register (phone -> SMS code -> name + password -> account). Layout from
// delivery-boy-app/src/screens/Auth.tsx. The code is sent by Firebase phone auth (free; src/lib/phoneVerify.ts):
// the typed code (or Android auto-verify) is confirmed with Firebase on the code step and the Firebase ID token
// goes to POST /api/auto-ride/driver/auth/register { firebaseToken }. Only when Firebase cannot run on this
// device does the app fall back to POST /api/users/send-otp (Fast2SMS) and send { otp } instead.
import React, { useEffect, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, font, radius, space } from '../theme';
import { Button } from '../ui/kit';
import { Banner, Field } from '../ui/Screen';
import { KeyboardAwareScrollView } from '../ui/KeyboardAvoidingView';
import { call } from '../ui/Sos';
import { useSession } from '../state/SessionProvider';
import { driverApi, normalizePhone, passwordProblem } from '../api/driverApi';
import { ApiError, NetworkError, errorMessage } from '../lib/http';
import { loadSavedPhone, setSavedPhone } from '../lib/storage';
import { SUPPORT_PHONE } from '../config';
import type { ScreenProps } from '../nav';
import { LegalLine, getPolicyVersion, openLegal } from '../lib/legal';
import {
  FIREBASE_NUMBER_ERRORS, confirmFirebaseCode, firebaseIdToken, firebaseVerified, onFirebaseVerified, sendFirebaseCode, signOutFirebase,
} from '../lib/phoneVerify';

const logo = require('../../assets/zenv-brand-badge-2026-11-04.png');

const digits = (v: string) => {
  let d = v.replace(/\D/g, '');
  if (d.length > 10 && d.startsWith('91')) d = d.slice(2);
  if (d.length > 10 && d.startsWith('0')) d = d.slice(1);
  return d.slice(0, 10);
};

function Shell({ children, subtitle }: { children: React.ReactNode; subtitle: string }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <KeyboardAwareScrollView contentContainerStyle={[styles.wrap, { paddingTop: insets.top + space.xl, paddingBottom: insets.bottom + space.xl }]}>
        <View style={{ alignItems: 'center', gap: space.xs }}>
          <Image source={logo} style={styles.logo} accessibilityLabel="ZENV Auto Driver" />
          <Text style={[font.h1, { color: color.text }]}>ZENV Auto Driver</Text>
          <Text style={[font.body, { color: color.textSecondary, textAlign: 'center' }]}>{subtitle}</Text>
        </View>
        {children}
      </KeyboardAwareScrollView>
    </View>
  );
}

function PasswordField({ label, value, onChange, onSubmit, error }: { label: string; value: string; onChange: (v: string) => void; onSubmit?: () => void; error?: string | null }) {
  const [show, setShow] = useState(false);
  return (
    <View style={{ gap: space.xxs }}>
      <Text style={[font.label, { color: color.textSecondary }]}>{label}</Text>
      <View style={[styles.inputRow, error ? { borderColor: color.alert } : null]}>
        <TextInput
          value={value}
          onChangeText={onChange}
          secureTextEntry={!show}
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="password"
          placeholder="Password"
          placeholderTextColor={color.textMuted}
          style={[font.h3, { flex: 1, color: color.text, minHeight: 54 }]}
          accessibilityLabel={label}
          returnKeyType="go"
          onSubmitEditing={onSubmit}
        />
        <Pressable accessibilityRole="button" accessibilityLabel={show ? 'Hide password' : 'Show password'} onPress={() => setShow((s) => !s)} hitSlop={12}>
          <Ionicons name={show ? 'eye-off-outline' : 'eye-outline'} size={28} color={color.textSecondary} />
        </Pressable>
      </View>
      {error ? <Text style={[font.small, { color: color.alertDark, fontWeight: '700' }]}>{error}</Text> : null}
    </View>
  );
}

export function LoginScreen({ navigation }: ScreenProps<'Login'>) {
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
      const r = await driverApi.login(p, password);
      await setSavedPhone(p);
      await signIn(r.token, r.driver);
    } catch (e) {
      if (e instanceof NetworkError) setError('No internet, or ZENV is waking up. Try again in a moment.');
      else setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell subtitle="Log in with the number your ZENV admin registered.">
      {notice ? <Banner tone="warn" text={notice} /> : null}
      <Field label="Mobile number" prefix="+91" value={phone} onChangeText={(v) => { setPhone(digits(v)); setError(null); }}
        keyboardType="phone-pad" autoComplete="tel" placeholder="10-digit mobile" maxLength={14} />
      <PasswordField label="Password" value={password} onChange={(v) => { setPassword(v); setError(null); }} onSubmit={submit} />
      {error ? <Banner tone="error" text={error} /> : null}
      <Button label="Sign in" icon="log-in" onPress={submit} loading={busy} disabled={!valid} />
      <LegalLine />
      <Button label="New driver? Sign up with your mobile number" variant="ghost" size="secondary" onPress={() => navigation.navigate('Register')} />
      <Button label="Forgot password? Call ZENV" icon="call" variant="ghost" size="secondary" onPress={() => call(`+${SUPPORT_PHONE}`)} />
    </Shell>
  );
}

type Step = 'phone' | 'otp' | 'details';

const NO_SMS_MESSAGE = "We couldn't send a code to this number. Ask your ZENV admin to create your account, then sign in with your number and password.";

export function RegisterScreen({ navigation }: ScreenProps<'Register'>) {
  const { signIn } = useSession();
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [taken, setTaken] = useState(false);
  // Plan B: no code could be sent at all -> point the driver to Sign in with an admin-created account.
  const [noSms, setNoSms] = useState(false);
  // C4: required Terms / Privacy tick on account creation (recorded by the server with the policy version).
  const [agreed, setAgreed] = useState(false);
  // 'firebase' = Firebase sent the code (proof = Firebase ID token); 'sms' = Zenvy SMS fallback (proof = typed code).
  const [mode, setMode] = useState<'firebase' | 'sms' | null>(null);
  const confirmationRef = useRef<any>(null);

  useEffect(() => {
    if (step !== 'otp') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [step]);

  const p = normalizePhone(phone);

  // Android can verify the number in the background (reads the SMS or verifies instantly): skip typing.
  useEffect(() => {
    if (step !== 'otp' || mode !== 'firebase' || !p) return;
    return onFirebaseVerified(p, () => {
      setError(null);
      setInfo(null);
      setStep('details');
    });
  }, [step, mode, p]);

  const sendCode = async () => {
    if (!p || busy) return;
    setBusy(true);
    setError(null);
    setTaken(false);
    setNoSms(false);
    try {
      // Primary: Firebase phone auth (free). Only a problem with the number itself stops here; anything else
      // (Firebase missing in this build, app not authorised, quota, no internet) tries Zenvy SMS next.
      const fb = await sendFirebaseCode(p);
      if (fb && fb.ok) {
        confirmationRef.current = fb.confirmation;
        setMode('firebase');
        setInfo(`We sent a 6-digit code to +91 ${p}.`);
        setResendAt(Date.now() + 60 * 1000);
        setOtp('');
        setStep('otp');
        return;
      }
      if (fb && !fb.ok && FIREBASE_NUMBER_ERRORS.includes(String(fb.code))) {
        setError(fb.message);
        return;
      }
      let r;
      try {
        r = await driverApi.sendOtp(p);
      } catch (e) {
        // Plan B: neither Firebase nor Zenvy SMS could send. The admin creates the account instead (no SMS).
        const smsDown = !(e instanceof NetworkError) && !(e instanceof ApiError && ['OTP_COOLDOWN', 'INVALID_PHONE'].includes(String(e.code)));
        if (smsDown) {
          setNoSms(true);
          setError(NO_SMS_MESSAGE);
          return;
        }
        throw e;
      }
      confirmationRef.current = null;
      setMode('sms');
      setInfo(r.message || `We sent a 6-digit code to +91 ${p}.`);
      setResendAt(Date.now() + (Number(r.resendAfter) || 60) * 1000);
      setOtp('');
      setStep('otp');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'OTP_COOLDOWN') {
        confirmationRef.current = null;
        setMode('sms');
        setResendAt(Date.now() + (Number(e.data?.retryAfter) || 60) * 1000);
        setStep('otp');
      }
      if (e instanceof NetworkError) setError('No internet, or ZENV is waking up. Try again in a moment.');
      else if (e instanceof ApiError) setError(errorMessage(e));
      else setError(e instanceof Error && e.message ? e.message : errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  // Code step -> details. In Firebase mode the code is confirmed with Firebase here, so a wrong code is caught now.
  const checkCode = async () => {
    if (!p || busy) return;
    setError(null);
    if (mode !== 'firebase') { setStep('details'); return; }
    setBusy(true);
    try {
      await confirmFirebaseCode(confirmationRef.current, otp, p);
      setInfo(null);
      setStep('details');
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'We could not check the code. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const pwErr = password ? passwordProblem(password) : null;
  const confirmErr = confirm && confirm !== password ? 'The two passwords are different.' : null;
  const detailsOk = name.trim().length >= 2 && !!password && !pwErr && confirm === password && agreed;

  const create = async () => {
    if (!p || !detailsOk || busy) return;
    setBusy(true);
    setError(null);
    try {
      let proof: { firebaseToken: string } | { otp: string };
      if (mode === 'firebase') {
        const firebaseToken = await firebaseIdToken(p);
        if (!firebaseToken) {
          setStep('otp');
          setError('Your number is not verified yet. Type the code again, or tap Resend code.');
          return;
        }
        proof = { firebaseToken };
      } else {
        proof = { otp };
      }
      const termsVersion = await getPolicyVersion();
      const r = await driverApi.register({ name: name.trim(), phone: p, password, ...proof, acceptTerms: true, ...(termsVersion ? { termsVersion } : {}) });
      await signOutFirebase();
      await setSavedPhone(p);
      await signIn(r.token, r.driver);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : undefined;
      if (code === 'OTP_INVALID' || code === 'OTP_EXPIRED' || code === 'OTP_LOCKED' || code === 'PHONE_VERIFICATION_REQUIRED') setStep('otp');
      if (code === 'VERIFICATION_EXPIRED' || code === 'PHONE_MISMATCH') {
        // The Firebase proof was not accepted: back to the code step for a fresh code.
        await signOutFirebase();
        confirmationRef.current = null;
        setResendAt(0);
        setOtp('');
        setStep('otp');
      }
      if (code === 'PHONE_TAKEN') setTaken(true);
      if (e instanceof NetworkError) setError('No internet, or ZENV is waking up. Try again in a moment.');
      else setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const wait = Math.max(0, Math.ceil((resendAt - now) / 1000));
  return (
    <Shell subtitle={step === 'phone' ? 'Step 1 of 3: your mobile number' : step === 'otp' ? 'Step 2 of 3: SMS code' : 'Step 3 of 3: name and password'}>
      {step === 'phone' ? (
        <>
          <Field label="Mobile number" prefix="+91" value={phone} onChangeText={(v) => { setPhone(digits(v)); setError(null); setNoSms(false); }}
            keyboardType="phone-pad" autoComplete="tel" placeholder="10-digit mobile" maxLength={14}
            hint="We send a 6-digit code by SMS to prove the number is yours." />
          {error ? <Banner tone="error" text={error} /> : null}
          {noSms ? <Button label="Go to Sign in" icon="log-in" onPress={() => navigation.navigate('Login')} /> : null}
          <Button label={noSms ? 'Try sending the code again' : 'Send code'} icon="chatbubble-ellipses" variant={noSms ? 'secondary' : undefined}
            onPress={sendCode} loading={busy} disabled={!p} />
        </>
      ) : null}
      {step === 'otp' ? (
        <>
          {info ? <Banner tone="info" text={info} /> : null}
          <Field label="6-digit code" value={otp} onChangeText={(v) => { setOtp(v.replace(/\D/g, '').slice(0, 6)); setError(null); }}
            keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="sms-otp" placeholder="••••••" maxLength={6}
            hint={mode === 'firebase' ? 'On some phones the code is read automatically and this step is skipped.' : 'We check the code when you create the account in the next step.'} />
          {error ? <Banner tone="error" text={error} /> : null}
          <Button label="Next" icon="arrow-forward" onPress={checkCode} loading={busy && mode === 'firebase'}
            disabled={otp.length !== 6 && !(mode === 'firebase' && !!p && firebaseVerified(p))} />
          <Button label={wait ? `Resend code in ${wait}s` : 'Resend code'} icon="refresh" variant="secondary" onPress={sendCode} disabled={wait > 0} loading={busy} />
          <Button label="Change number" variant="ghost" size="secondary"
            onPress={() => { confirmationRef.current = null; setMode(null); setStep('phone'); setError(null); signOutFirebase(); }} />
        </>
      ) : null}
      {step === 'details' ? (
        <>
          <Field label="Full name (as on driving licence)" value={name} onChangeText={(v) => { setName(v.slice(0, 80)); setError(null); }} autoCapitalize="words" placeholder="Your full name" />
          <PasswordField label="New password" value={password} onChange={(v) => { setPassword(v); setError(null); }} error={pwErr} />
          <PasswordField label="Type the password again" value={confirm} onChange={(v) => { setConfirm(v); setError(null); }} error={confirmErr} onSubmit={create} />
          <Text style={[font.small, { color: color.textMuted }]}>8 or more characters, with letters and numbers.</Text>
          <Pressable
            onPress={() => setAgreed((v) => !v)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: agreed }}
            accessibilityLabel="I agree to the Terms of Service and Privacy Policy"
            style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, minHeight: 48 }}
          >
            <Ionicons name={agreed ? 'checkbox' : 'square-outline'} size={28} color={agreed ? color.openDark : color.textMuted} />
            <Text style={[font.small, { color: color.textSecondary, flex: 1 }]}>
              I agree to the{' '}
              <Text style={{ color: color.info, fontWeight: '800', textDecorationLine: 'underline' }} onPress={() => openLegal('terms')}>Terms of Service</Text>
              {' and '}
              <Text style={{ color: color.info, fontWeight: '800', textDecorationLine: 'underline' }} onPress={() => openLegal('privacy')}>Privacy Policy</Text>
              , including the Auto-Ride driver rules (valid licence and vehicle papers, cash fares collected by me, safe driving).
            </Text>
          </Pressable>
          {error ? <Banner tone="error" text={error} /> : null}
          <Button label="Create account" icon="checkmark-circle" variant="accept" onPress={create} loading={busy} disabled={!detailsOk} />
          {taken ? <Button label="Sign in instead" icon="log-in" variant="secondary" onPress={() => navigation.navigate('Login')} /> : null}
          <Button label="Back" variant="ghost" size="secondary" onPress={() => setStep('otp')} />
        </>
      ) : null}
      <Button label="Already have an account? Sign in" variant="ghost" size="secondary" onPress={() => navigation.navigate('Login')} />
    </Shell>
  );
}

const styles = StyleSheet.create({
  wrap: { flexGrow: 1, justifyContent: 'center', padding: space.xl, gap: space.lg },
  logo: { width: 88, height: 88, borderRadius: 22 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 58, borderRadius: radius.md, borderWidth: 2, borderColor: color.border, backgroundColor: color.surface, paddingHorizontal: space.md },
});
