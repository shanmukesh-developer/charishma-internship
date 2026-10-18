// C4: non-blocking "We've updated our Terms" sheet. Shown once to a signed-in user whose accepted
// version differs from the current one (server flag termsUpdateRequired). "Later" hides it for 3 days;
// nothing in the app is ever locked behind it.
import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { COLORS } from '../constants/theme';
import { ENDPOINTS } from '../constants/api';
import { apiFetch } from '../utils/auth';
import { openLegal, LEGAL_LABELS, LegalPage } from '../utils/legal';

const SNOOZE_KEY = 'zenvy.termsSheetSnooze';
const SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;

export default function TermsUpdateSheet() {
  const { user, setUser } = useAuth();
  const { isDark } = useTheme();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const version = user?.termsCurrentVersion || '';
  const needed = !!user && user.termsUpdateRequired === true && !!version;

  useEffect(() => {
    let alive = true;
    if (!needed) { setVisible(false); return; }
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(SNOOZE_KEY);
        const snooze = raw ? JSON.parse(raw) : null;
        if (snooze && snooze.version === version && Date.now() - Number(snooze.at) < SNOOZE_MS) return;
      } catch { /* show it */ }
      if (alive) setVisible(true);
    })();
    return () => { alive = false; };
  }, [needed, version]);

  const later = async () => {
    setVisible(false);
    try { await AsyncStorage.setItem(SNOOZE_KEY, JSON.stringify({ version, at: Date.now() })); } catch { /* fine */ }
  };

  const accept = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await apiFetch(ENDPOINTS.legalAccept, { method: 'POST', body: JSON.stringify({ version }) });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setUser({ termsAcceptedVersion: data.termsAcceptedVersion, termsAcceptedAt: data.termsAcceptedAt, termsCurrentVersion: data.termsCurrentVersion, termsUpdateRequired: false });
        setVisible(false);
      } else if (res.status === 409 && data.termsCurrentVersion) {
        setUser({ termsCurrentVersion: data.termsCurrentVersion, termsUpdateRequired: true });
        setError(data.message || 'The Terms changed again. Please review the latest version.');
      } else {
        setError(data.message || 'Could not save right now. You can keep using Zenvy and try again later.');
      }
    } catch {
      setError('You seem to be offline. You can keep using Zenvy and accept later.');
    } finally {
      setBusy(false);
    }
  };

  if (!needed) return null;
  const bg = isDark ? '#141416' : '#FFFFFF';
  const fg = isDark ? '#FFFFFF' : '#1A1A2E';
  const muted = isDark ? COLORS.textSecondary : '#617088';
  const links: LegalPage[] = ['terms', 'privacy', 'refunds', 'community'];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={later}>
      <View style={s.backdrop}>
        <View style={[s.sheet, { backgroundColor: bg }]}>
          <Text style={[s.title, { color: fg }]}>We&apos;ve updated our Terms</Text>
          <Text style={[s.body, { color: muted }]}>
            Please take a moment to read our Terms of Service and Privacy Policy (version {version}). They explain how
            orders, cancellations, refunds, the Zenvy Wallet and community features work, and how we handle your data.
          </Text>
          <View style={s.links}>
            {links.map((p) => (
              <TouchableOpacity key={p} onPress={() => openLegal(p)} accessibilityRole="link" style={s.linkBtn}>
                <Text style={s.link}>{LEGAL_LABELS[p]} ↗</Text>
              </TouchableOpacity>
            ))}
          </View>
          {error ? <Text style={s.error}>{error}</Text> : null}
          <TouchableOpacity onPress={accept} disabled={busy} style={[s.accept, busy && { opacity: 0.7 }]} accessibilityRole="button">
            {busy ? <ActivityIndicator color="#000" size="small" /> : <Text style={s.acceptText}>ACCEPT</Text>}
          </TouchableOpacity>
          <TouchableOpacity onPress={later} disabled={busy} style={s.later} accessibilityRole="button">
            <Text style={[s.laterText, { color: muted }]}>Later</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 32 },
  title: { fontSize: 18, fontWeight: '900', marginBottom: 8 },
  body: { fontSize: 13, lineHeight: 19, fontWeight: '500' },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  linkBtn: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(245,158,11,0.4)' },
  link: { color: COLORS.gold, fontSize: 12, fontWeight: '800' },
  error: { color: '#EF4444', fontSize: 12, fontWeight: '600', marginTop: 12 },
  accept: { marginTop: 18, backgroundColor: COLORS.gold, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  acceptText: { color: '#000', fontSize: 13, fontWeight: '900', letterSpacing: 1 },
  later: { marginTop: 8, paddingVertical: 10, alignItems: 'center' },
  laterText: { fontSize: 13, fontWeight: '700' },
});
