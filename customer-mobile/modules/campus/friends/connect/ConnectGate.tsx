import React, { useRef, useState } from 'react';
import { View, Text, TextInput, ScrollView, TouchableOpacity, Alert, StyleSheet } from 'react-native';
import { KeyboardAvoidingView } from '../../../../components/KeyboardAvoidingView';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { CalendarDays, Eye, HeartHandshake, MessageCircle, Database, Ban, Flag, Trash2, ShieldAlert, Lock, Circle, CircleCheck, FileText, ChevronRight } from '../../../../components/lucide';
import { FriendsColors, FS, FT, FR, fui } from '../friendsTheme';
import { errorCode } from '../api/core';
import { ConnectStatus, acceptConnectConsent, saveDateOfBirth } from '../api/connectApi';
import { ConnectHeart, Notice, PrimaryButton, GhostButton, StepDots } from './ConnectUi';
import { ageOn, connectErrorMessage, toIsoDate } from './connectShared';

export const ONBOARDING_STEPS = ['Age', 'Consent', 'Profile', 'Selfie'];

const GateFrame: React.FC<{ step?: number; children: React.ReactNode }> = ({ step, children }) => (
  <KeyboardAvoidingView style={{ flex: 1 }}>
    <ScrollView style={fui.screen} contentContainerStyle={{ paddingBottom: 80 }} keyboardShouldPersistTaps="handled">
      {step !== undefined ? <StepDots steps={ONBOARDING_STEPS} current={step} /> : null}
      <View style={{ padding: FS.lg, gap: FS.lg }}>{children}</View>
    </ScrollView>
  </KeyboardAvoidingView>
);

const Hero: React.FC<{ title: string; subtitle: string; icon?: React.ReactNode }> = ({ title, subtitle, icon }) => (
  <LinearGradient colors={['rgba(212,175,122,0.08)', 'rgba(212,175,122,0.08)']} style={styles.hero}>
    <View style={styles.heroIcon}>{icon || <ConnectHeart size={26} />}</View>
    <Text style={[FT.h1, { textAlign: 'center' }]} accessibilityRole="header">
      {title}
    </Text>
    <Text style={[FT.muted, { textAlign: 'center' }]}>{subtitle}</Text>
  </LinearGradient>
);

// ── Age ───────────────────────────────────────────────────────────────────────

/** Date of birth (when missing) or the under-18 state. Age is always computed by the server. */
export const AgeGate: React.FC<{ status: ConnectStatus; onChanged: () => void }> = ({ status, onChanged }) => {
  const notAdult = status.reasons.includes('NOT_ADULT');
  const [editing, setEditing] = useState(!notAdult);
  const [d, setD] = useState('');
  const [m, setM] = useState('');
  const [y, setY] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mRef = useRef<TextInput>(null);
  const yRef = useRef<TextInput>(null);

  const save = () => {
    const iso = toIsoDate(d, m, y);
    if (!iso) {
      setError('Enter a real date as DD / MM / YYYY.');
      return;
    }
    setError(null);
    const age = ageOn(iso);
    Alert.alert(
      'Is this right?',
      `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}${age >= 0 ? ` (age ${age})` : ''}. Your date of birth is locked once you turn on Connect.`,
      [
        { text: 'Edit', style: 'cancel' },
        {
          text: 'Save',
          onPress: async () => {
            setBusy(true);
            try {
              await saveDateOfBirth(iso);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
              setEditing(false);
              onChanged();
            } catch (e: any) {
              setError(connectErrorMessage(e, "Couldn't save your date of birth."));
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  };

  if (notAdult && !editing) {
    return (
      <GateFrame>
        <Hero title="Connect is for 18+" subtitle="Connect is only open to students who are 18 or older. Everything else in Friends stays open to you." icon={<Lock size={24} color={FriendsColors.accent} />} />
        {status.dob.locked ? (
          <Notice tone="muted" text="Your date of birth is locked. If it is wrong, contact ZCS support from Me › Help." />
        ) : (
          <GhostButton label="My date of birth is wrong" onPress={() => setEditing(true)} icon={<CalendarDays size={16} color={FriendsColors.ink} />} />
        )}
      </GateFrame>
    );
  }

  return (
    <GateFrame step={0}>
      <Hero title="Meet people on your campus" subtitle="Connect is an optional, 18+ space for verified students to find a date, friends, a study buddy or company for an event." />
      <View style={fui.cardPad}>
        <Text style={FT.h3}>Your date of birth</Text>
        <Text style={[FT.small, { marginTop: 2 }]}>Used only to check that you are 18+. Others see your age in years, never the date.</Text>
        <View style={styles.dobRow}>
          <DobField label="Day" placeholder="DD" value={d} max={2} onChange={(v) => { setD(v); if (v.length === 2) mRef.current?.focus(); }} />
          <Text style={styles.slash}>/</Text>
          <DobField refObj={mRef} label="Month" placeholder="MM" value={m} max={2} onChange={(v) => { setM(v); if (v.length === 2) yRef.current?.focus(); }} />
          <Text style={styles.slash}>/</Text>
          <DobField refObj={yRef} label="Year" placeholder="YYYY" value={y} max={4} onChange={setY} wide onSubmit={save} />
        </View>
        {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
        <PrimaryButton label="Save date of birth" onPress={save} busy={busy} disabled={!d || !m || y.length !== 4} style={{ marginTop: FS.lg }} />
        {notAdult ? <GhostButton label="Cancel" onPress={() => setEditing(false)} style={{ marginTop: FS.sm }} /> : null}
      </View>
      <Notice tone="muted" icon={<Lock size={14} color={FriendsColors.muted} />} text="It also updates your campus profile. Once you agree to Connect, it can't be changed without support." />
    </GateFrame>
  );
};

const DobField: React.FC<{
  label: string;
  placeholder: string;
  value: string;
  max: number;
  onChange: (v: string) => void;
  wide?: boolean;
  refObj?: React.RefObject<TextInput | null>;
  onSubmit?: () => void;
}> = ({ label, placeholder, value, max, onChange, wide, refObj, onSubmit }) => (
  <TextInput
    ref={refObj}
    style={[fui.input, styles.dobInput, wide && { flex: 1.6 }]}
    value={value}
    onChangeText={(t) => onChange(t.replace(/\D/g, '').slice(0, max))}
    placeholder={placeholder}
    placeholderTextColor={FriendsColors.faint}
    keyboardType="number-pad"
    maxLength={max}
    returnKeyType={onSubmit ? 'done' : 'next'}
    onSubmitEditing={onSubmit}
    accessibilityLabel={`Birth ${label.toLowerCase()}`}
  />
);

// ── Consent ───────────────────────────────────────────────────────────────────

const CONSENT_POINTS: { icon: React.ComponentType<{ size?: number; color?: string }>; title: string; text: string }[] = [
  { icon: Eye, title: 'Who sees you', text: 'Only verified, 18+ students on your campus who also use Connect. You can hide from branches or years, and pause any time.' },
  { icon: HeartHandshake, title: 'Matching', text: 'You see one profile at a time and choose Like or Pass. A match happens only when you both like each other.' },
  { icon: MessageCircle, title: 'Chat', text: 'Only matches can message. No calls. Unmatching or blocking ends the chat for both of you.' },
  { icon: Database, title: 'Your data', text: 'Your Connect name, bio, interests, photos and age in years. No location, ever. Photos are private and checked by a moderator first.' },
  { icon: Ban, title: 'Blocking', text: 'Block anyone from their card or your match. They are not told, and you will not see each other anywhere in Friends.' },
  { icon: Flag, title: 'Reporting', text: 'Report profiles, photos and messages. A person reviews every report; a report alone never removes anyone.' },
  { icon: Trash2, title: 'Deletion', text: 'Delete Connect any time. Your profile, photos, likes, matches and chats are erased. A record that you consented is kept.' },
];

export const ConsentGate: React.FC<{ status: ConnectStatus; onChanged: () => void; onOpenPolicy: () => void }> = ({ status, onChanged, onOpenPolicy }) => {
  const [agreed, setAgreed] = useState(false);
  const [adult, setAdult] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reconsent = !!status.consent.acceptedVersion && !status.consent.accepted;

  const submit = async () => {
    if (!agreed || !adult || busy) return;
    setBusy(true);
    setError(null);
    try {
      await acceptConnectConsent(status.consent.version);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onChanged();
    } catch (e: any) {
      if (errorCode(e) === 'CONSENT_VERSION_MISMATCH') {
        setError('The Connect terms were just updated. Please read them again.');
        onChanged();
      } else setError(connectErrorMessage(e, "Couldn't save your consent."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <GateFrame step={1}>
      <Hero
        title={reconsent ? 'Connect terms updated' : 'Before you start'}
        subtitle={reconsent ? 'We changed how Connect works. Please read and agree again to keep using it.' : 'Connect is opt-in. Here is exactly how it works and what happens with your data.'}
      />
      <View style={fui.card}>
        {CONSENT_POINTS.map((p, i) => {
          const Icon = p.icon;
          return (
            <View key={p.title} style={[styles.point, i === CONSENT_POINTS.length - 1 && { borderBottomWidth: 0 }]} accessible accessibilityLabel={`${p.title}. ${p.text}`}>
              <View style={styles.pointIcon}>
                <Icon size={16} color={FriendsColors.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={FT.h3}>{p.title}</Text>
                <Text style={[FT.small, { lineHeight: 17, marginTop: 2 }]}>{p.text}</Text>
              </View>
            </View>
          );
        })}
      </View>

      <TouchableOpacity style={styles.policyRow} onPress={onOpenPolicy} accessibilityRole="link" accessibilityLabel="Read the Connect privacy notice">
        <FileText size={18} color={FriendsColors.accent} />
        <Text style={[FT.h3, { flex: 1 }]}>Read the Connect privacy notice</Text>
        <ChevronRight size={18} color={FriendsColors.muted} />
      </TouchableOpacity>

      <View style={{ gap: FS.sm }}>
        <Checkbox checked={agreed} onToggle={() => setAgreed((v) => !v)} label="I have read the Connect privacy notice and agree to how my data is used." />
        <Checkbox checked={adult} onToggle={() => setAdult((v) => !v)} label="I confirm that I am 18 years or older." />
      </View>
      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
      <PrimaryButton label="Agree and continue" onPress={submit} busy={busy} disabled={!agreed || !adult} />
      <Text style={[FT.small, { textAlign: 'center' }]}>You can pause or delete Connect at any time. Agreeing locks your date of birth.</Text>
    </GateFrame>
  );
};

export const Checkbox: React.FC<{ checked: boolean; onToggle: () => void; label: string }> = ({ checked, onToggle, label }) => (
  <TouchableOpacity style={styles.check} onPress={onToggle} activeOpacity={0.8} accessibilityRole="checkbox" accessibilityState={{ checked }} accessibilityLabel={label}>
    {checked ? <CircleCheck size={22} color={FriendsColors.accent} /> : <Circle size={22} color={FriendsColors.faint} />}
    <Text style={[FT.body, { flex: 1 }]}>{label}</Text>
  </TouchableOpacity>
);

// ── Removed by a moderator ───────────────────────────────────────────────────

export const RemovedGate: React.FC<{ onAppeal: () => void; onOpenSafetyCenter: () => void }> = ({ onAppeal, onOpenSafetyCenter }) => (
  <GateFrame>
    <Hero title="Your Connect profile is down" subtitle="A moderator took your Connect profile down, so others can't see it. Your matches have ended." icon={<ShieldAlert size={24} color={FriendsColors.danger} />} />
    <PrimaryButton label="See the decision and appeal" onPress={onAppeal} />
    <GhostButton label="Delete my Connect data" onPress={onOpenSafetyCenter} danger icon={<Trash2 size={16} color={FriendsColors.danger} />} />
  </GateFrame>
);

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: FS.sm, padding: FS.xl, borderRadius: FR.hero, borderWidth: 1, borderColor: 'rgba(212,175,122,0.18)' },
  heroIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: FriendsColors.accentSoft, marginBottom: 4 },
  dobRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: FS.md },
  dobInput: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '700', minHeight: 50 },
  slash: { fontSize: 18, color: FriendsColors.faint },
  error: { marginTop: FS.sm, fontSize: 13, fontWeight: '600', color: FriendsColors.danger },
  point: { flexDirection: 'row', gap: FS.md, padding: FS.md, borderBottomWidth: 1, borderBottomColor: FriendsColors.lineSoft },
  pointIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: FriendsColors.accentSoft },
  policyRow: { flexDirection: 'row', alignItems: 'center', gap: FS.md, padding: FS.md, minHeight: 52, borderRadius: FR.md, backgroundColor: FriendsColors.card, borderWidth: 1, borderColor: FriendsColors.line },
  check: { flexDirection: 'row', alignItems: 'flex-start', gap: FS.md, paddingVertical: 8, minHeight: 44 },
});
