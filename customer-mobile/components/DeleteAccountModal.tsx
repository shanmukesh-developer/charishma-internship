import React, { useEffect, useState } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet, ScrollView, Platform, Linking,
} from 'react-native';
import { KeyboardAvoidingView } from './KeyboardAvoidingView';
import { useTheme } from '../context/ThemeContext';
import { ENDPOINTS } from '../constants/api';
import { apiFetch, readJson, normalizePhone, NETWORK_ERROR_MESSAGE } from '../utils/auth';
import { usePhoneOtp, isSmsSendFailure } from '../utils/phoneOtp';

/**
 * Profile -> Delete my account (Google Play account-deletion requirement).
 * Steps: what happens -> type DELETE -> SMS code to the account's number -> POST /account/delete.
 * The server anonymises the account, deletes personal data and keeps order / payment records
 * without personal details. On success the caller signs the user out.
 */
interface Props {
  visible: boolean;
  phone?: string | null;
  onClose: () => void;
  onDeleted: () => void | Promise<void>;
}

type Step = 'info' | 'otp' | 'done';
const RED = '#EF4444';

export default function DeleteAccountModal({ visible, phone, onClose, onDeleted }: Props) {
  const { colors, isDark } = useTheme();
  const [step, setStep] = useState<Step>('info');
  const [checking, setChecking] = useState(false);
  const [blockers, setBlockers] = useState<{ code: string; message: string }[]>([]);
  const [wallet, setWallet] = useState(0);
  const [points, setPoints] = useState(0);
  const [confirmText, setConfirmText] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const otp = usePhoneOtp('delete_account');
  const phone10 = normalizePhone(String(phone || ''));

  useEffect(() => {
    if (!visible) return;
    setStep('info'); setConfirmText(''); setCode(''); setError(''); setInfo(''); setBlockers([]);
    otp.reset();
    let cancelled = false;
    (async () => {
      setChecking(true);
      try {
        const res = await apiFetch(ENDPOINTS.accountDeletionCheck);
        const data = await readJson(res);
        if (cancelled) return;
        if (res.ok && data) {
          setBlockers(Array.isArray(data.blockers) ? data.blockers : []);
          setWallet(Number(data.walletBalance) || 0);
          setPoints(Number(data.zenPoints) || 0);
        }
      } catch {
        // The delete call re-checks on the server; the screen still works offline-first.
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // The SMS could not be sent: offer the code by email (to the address on the account).
  const [smsFailed, setSmsFailed] = useState(false);
  const sendCode = async (viaEmail = false) => {
    setError(''); setInfo('');
    if (!/^[6-9]\d{9}$/.test(phone10)) {
      setError('Your account has no valid mobile number. Please email projectshanmukh@gmail.com to delete it.');
      return;
    }
    const r = viaEmail ? await otp.sendEmail(phone10) : await otp.send(phone10);
    if (r.ok) { setSmsFailed(false); setInfo(r.message); setStep('otp'); } else {
      if (!viaEmail) setSmsFailed(isSmsSendFailure(r));
      setError(r.message);
    }
  };

  const confirmDelete = async () => {
    setError('');
    setBusy(true);
    try {
      const proof = await otp.getProof(code);
      const res = await apiFetch(ENDPOINTS.accountDelete, {
        method: 'POST',
        body: JSON.stringify({ confirm: 'DELETE', ...proof }),
      });
      const data = await readJson(res);
      if (!res.ok) {
        setError((data && data.message) || 'Could not delete your account. Please try again.');
        otp.allowAutoRetry();
        return;
      }
      setStep('done');
    } catch (e: any) {
      setError(e?.message && !/network/i.test(e.message) ? e.message : NETWORK_ERROR_MESSAGE);
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    await onDeleted();
  };

  const card = colors.card;
  const txt = colors.text;
  const sub = colors.textSecondary;
  const border = colors.border;
  const inputBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';
  const canContinue = confirmText.trim().toUpperCase() === 'DELETE' && blockers.length === 0 && !checking && !otp.sending;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={step === 'done' ? finish : onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={s.overlay}>
          <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
            <View style={[s.card, { backgroundColor: card, borderColor: border }]}>
              {step === 'info' && (
                <>
                  <Text style={[s.title, { color: RED }]}>Delete my account</Text>
                  <Text style={[s.body, { color: txt }]}>This permanently closes your ZenWe account. It cannot be undone.</Text>
                  <Text style={[s.h, { color: txt }]}>We delete</Text>
                  <Text style={[s.body, { color: sub }]}>
                    {'• Your name, mobile number, email, hostel, room, address and profile photo\n'}
                    {'• Chats, Pulse posts, replies, votes and community posts\n'}
                    {'• Friends, Campus profile, verification, lost & found posts, photos, reviews and notifications'}
                  </Text>
                  <Text style={[s.h, { color: txt }]}>We keep (without your personal details)</Text>
                  <Text style={[s.body, { color: sub }]}>Order, wallet and payment records, as the law requires, and safety reports.</Text>
                  {(wallet > 0 || points > 0) && (
                    <View style={[s.warn, { borderColor: RED }]}>
                      <Text style={[s.body, { color: RED, marginTop: 0 }]}>
                        {wallet > 0 ? `Your wallet balance of ₹${wallet.toFixed(2)} ` : ''}
                        {wallet > 0 && points > 0 ? 'and ' : ''}
                        {points > 0 ? `${points} Zen points ` : ''}
                        will be lost. Please use them first.
                      </Text>
                    </View>
                  )}
                  {checking && <ActivityIndicator style={{ marginTop: 12 }} color={RED} />}
                  {blockers.map((b) => (
                    <View key={b.code} style={[s.warn, { borderColor: RED }]}>
                      <Text style={[s.body, { color: RED, marginTop: 0 }]}>{b.message}</Text>
                    </View>
                  ))}
                  <Text style={[s.h, { color: txt }]}>Type DELETE to confirm</Text>
                  <TextInput
                    value={confirmText}
                    onChangeText={setConfirmText}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    placeholder="DELETE"
                    placeholderTextColor={sub}
                    style={[s.input, { backgroundColor: inputBg, color: txt, borderColor: border }]}
                    accessibilityLabel="Type DELETE to confirm"
                  />
                  {!!error && <Text style={s.error}>{error}</Text>}
                  <TouchableOpacity
                    style={[s.dangerBtn, { opacity: canContinue ? 1 : 0.45 }]}
                    disabled={!canContinue}
                    onPress={() => sendCode(false)}
                    accessibilityRole="button"
                  >
                    {otp.sending ? <ActivityIndicator color="#fff" /> : <Text style={s.dangerText}>SEND CODE TO ******{phone10.slice(-4)}</Text>}
                  </TouchableOpacity>
                  {smsFailed && canContinue && (
                    <TouchableOpacity onPress={() => sendCode(true)} accessibilityRole="button">
                      <Text style={[s.link, { color: RED }]}>Send the code by email instead</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity onPress={() => Linking.openURL(ENDPOINTS.deleteAccountInfo).catch(() => {})}>
                    <Text style={[s.link, { color: sub }]}>More about account deletion</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.cancelBtn} onPress={onClose}>
                    <Text style={[s.cancelText, { color: txt }]}>Cancel</Text>
                  </TouchableOpacity>
                </>
              )}

              {step === 'otp' && (
                <>
                  <Text style={[s.title, { color: RED }]}>Confirm it's you</Text>
                  <Text style={[s.body, { color: sub }]}>{info || `Enter the 6-digit code we sent to ******${phone10.slice(-4)}.`}</Text>
                  <TextInput
                    value={code}
                    onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))}
                    keyboardType="number-pad"
                    textContentType="oneTimeCode"
                    autoComplete="sms-otp"
                    maxLength={6}
                    placeholder="6-digit code"
                    placeholderTextColor={sub}
                    style={[s.input, s.codeInput, { backgroundColor: inputBg, color: txt, borderColor: border }]}
                    accessibilityLabel="Verification code"
                  />
                  {!!error && <Text style={s.error}>{error}</Text>}
                  <TouchableOpacity
                    style={[s.dangerBtn, { opacity: busy ? 0.6 : 1 }]}
                    disabled={busy}
                    onPress={confirmDelete}
                    accessibilityRole="button"
                  >
                    {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.dangerText}>DELETE MY ACCOUNT</Text>}
                  </TouchableOpacity>
                  <TouchableOpacity disabled={otp.countdown > 0 || otp.sending} onPress={() => sendCode(otp.mode === 'email')}>
                    <Text style={[s.link, { color: sub }]}>{otp.countdown > 0 ? `Resend code in ${otp.countdown}s` : 'Resend code'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.cancelBtn} onPress={onClose} disabled={busy}>
                    <Text style={[s.cancelText, { color: txt }]}>Cancel</Text>
                  </TouchableOpacity>
                </>
              )}

              {step === 'done' && (
                <>
                  <Text style={[s.title, { color: txt }]}>Account deleted</Text>
                  <Text style={[s.body, { color: sub }]}>Your ZenWe account and personal data have been deleted. Thank you for using ZenWe.</Text>
                  <TouchableOpacity style={[s.dangerBtn, { backgroundColor: colors.gold }]} onPress={finish}>
                    <Text style={s.dangerText}>OK</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  scroll: { flexGrow: 1, justifyContent: 'flex-end' },
  card: { borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, padding: 22, paddingBottom: 36 },
  title: { fontSize: 20, fontWeight: '800', marginBottom: 6 },
  h: { fontSize: 14, fontWeight: '700', marginTop: 14 },
  body: { fontSize: 14, lineHeight: 21, marginTop: 4 },
  warn: { borderWidth: 1, borderRadius: 12, padding: 10, marginTop: 12 },
  input: { borderWidth: 1, borderRadius: 12, height: 48, paddingHorizontal: 14, fontSize: 16, marginTop: 8 },
  codeInput: { letterSpacing: 6, textAlign: 'center', fontSize: 20, marginTop: 14 },
  error: { color: RED, fontSize: 13, marginTop: 10 },
  dangerBtn: { backgroundColor: RED, borderRadius: 14, height: 50, alignItems: 'center', justifyContent: 'center', marginTop: 18 },
  dangerText: { color: '#fff', fontWeight: '800', letterSpacing: 0.5 },
  link: { textAlign: 'center', marginTop: 14, fontSize: 13, textDecorationLine: 'underline' },
  cancelBtn: { alignItems: 'center', marginTop: 10, padding: 10 },
  cancelText: { fontSize: 15, fontWeight: '600' },
});
