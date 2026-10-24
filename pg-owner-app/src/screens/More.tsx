// More tab (every section in one list) + Notifications inbox, Settings, Change password and Delete account.
import React, { useCallback, useEffect, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { color, font, space } from '../theme';
import { Button, Card, EmptyState, ErrorStrip, Sheet, SkeletonCard } from '../ui/kit';
import { Banner, Field, KeyValue, MenuGroup, MenuRow, Screen, SectionTitle } from '../ui/Screen';
import { PasswordField } from '../ui/PasswordField';
import { useSession } from '../state/SessionProvider';
import { useHome } from '../state/HomeProvider';
import { useToast } from '../ui/Toast';
import { ownerApi, passwordProblem } from '../api/ownerApi';
import { ApiError, errorMessage } from '../lib/http';
import { markReadOrQueue } from '../lib/offlineQueue';
import { LEGAL_LABELS, SETTINGS_PAGES, openLegal } from '../lib/legal';
import { ago, dateLabel } from '../lib/format';
import { SUPPORT_EMAIL, SUPPORT_PHONE, SUPPORT_PHONE_DISPLAY } from '../config';
import type { OwnerNotification } from '../types';
import type { ScreenProps } from '../nav';
import type { TabProps } from './Home';

const call = () => { Linking.openURL(`tel:+${SUPPORT_PHONE}`).catch(() => {}); };
const email = (subject: string) => { Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`).catch(() => {}); };

export default function MoreTab({ open, go }: TabProps) {
  const { home } = useHome();
  const c = home?.counts;
  return (
    <Screen title="More" tabBarSpace>
      <MenuGroup>
        <MenuRow icon="file-tray-full-outline" title="Booking Requests" badge={c?.pendingRequests || 0} onPress={() => open('Requests')} />
        <MenuRow icon="people-outline" title="Tenants" onPress={() => open('Tenants')} />
        <MenuRow icon="bed-outline" title="Rooms & availability" onPress={() => go('rooms')} />
        <MenuRow icon="calendar-outline" title="Mess Timetable & Menu" onPress={() => go('mess')} />
        <MenuRow icon="wallet-outline" title="Rent & Payments" onPress={() => go('payments')} />
        <MenuRow icon="chatbox-ellipses-outline" title="Complaints" badge={c?.openComplaints || 0} onPress={() => open('Complaints')} />
        <MenuRow icon="business-outline" title="Building Info" onPress={() => open('Building')} last />
      </MenuGroup>
      <MenuGroup>
        <MenuRow icon="notifications-outline" title="Notifications" onPress={() => open('Notifications')} />
        <MenuRow icon="settings-outline" title="Settings" sub="Profile, password, alerts, delete account" onPress={() => open('Settings')} />
        <MenuRow icon="call-outline" title="Call ZCS support" sub={SUPPORT_PHONE_DISPLAY} onPress={call} last />
      </MenuGroup>
    </Screen>
  );
}

export function NotificationsScreen({ navigation }: ScreenProps<'Notifications'>) {
  const [list, setList] = useState<OwnerNotification[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await ownerApi.notifications();
      setList(r.notifications);
      setError(null);
      if (r.unread) markReadOrQueue();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  const target = (n: OwnerNotification) => (n.type === 'PG_OWNER_COMPLAINT' ? 'Complaints' : n.type === 'PG_OWNER_BOOKING' ? 'Requests' : null);
  return (
    <Screen title="Notifications" onBack={() => navigation.goBack()} refreshing={loading && !!list} onRefresh={load}>
      {error && !list ? <ErrorStrip text={error} onRetry={load} busy={loading} /> : null}
      {!list && !error ? <SkeletonCard /> : null}
      {list && !list.length ? <EmptyState icon="notifications-off-outline" title="No notifications yet" body="New booking requests and complaints show here." /> : null}
      {list?.length ? (
        <MenuGroup>
          {list.map((n, i) => {
            const t = target(n);
            return (
              <MenuRow key={n.id} icon={n.type === 'PG_OWNER_COMPLAINT' ? 'chatbox-ellipses-outline' : 'mail-unread-outline'} title={n.title}
                sub={`${n.body || ''}${n.body ? ' · ' : ''}${ago(n.createdAt)}`} badge={n.readAt ? 0 : 1} last={i === list.length - 1}
                onPress={() => { if (t) navigation.navigate(t); }} />
            );
          })}
        </MenuGroup>
      ) : null}
    </Screen>
  );
}

const PUSH_TEXT: Record<string, { tone: 'ok' | 'warn' | 'info'; text: string }> = {
  ok: { tone: 'ok', text: 'On. Your phone rings for new booking requests and complaints.' },
  blocked: { tone: 'warn', text: 'Notifications are off for ZCS PG Partner. Turn them on in phone Settings so you never miss a request.' },
  unavailable: { tone: 'info', text: 'Push alerts are not set up on this build yet. Requests and complaints still show in the app (Home badges and Notifications).' },
  unknown: { tone: 'info', text: 'Checking notifications…' },
};

export function SettingsScreen({ navigation }: ScreenProps<'Settings'>) {
  const { owner, pushState, signOut } = useSession();
  const [confirmOut, setConfirmOut] = useState(false);
  const [busy, setBusy] = useState(false);
  const push = PUSH_TEXT[pushState || 'unknown'];
  const version = `${Constants.expoConfig?.version || '1.0.0'} (${Constants.expoConfig?.android?.versionCode ?? 1})`;
  return (
    <Screen title="Settings" onBack={() => navigation.goBack()}>
      <SectionTitle text="Profile" />
      <Card>
        <KeyValue k="Name" v={owner?.name || ''} strong />
        <KeyValue k="Mobile" v={owner?.phone ? `+91 ${owner.phone}` : ''} />
        <KeyValue k="PGs" v={String(owner?.listings.length || 0)} />
        <Text style={[font.small, { color: color.textMuted, marginTop: space.xs }]}>To change your name or number, call ZCS support.</Text>
      </Card>

      <SectionTitle text="Security" />
      <MenuGroup>
        <MenuRow icon="key-outline" title="Change password" sub="Other phones are signed out" onPress={() => navigation.navigate('ChangePassword')} last />
      </MenuGroup>

      <SectionTitle text="Notifications" />
      <Banner tone={push.tone} text={push.text} />
      {pushState === 'blocked' ? <Button label="Open phone settings" variant="secondary" size="secondary" icon="settings-outline" onPress={() => Linking.openSettings().catch(() => {})} /> : null}

      <SectionTitle text="Legal" />
      <MenuGroup>
        {SETTINGS_PAGES.map((p, i) => <MenuRow key={p} icon="document-text-outline" title={LEGAL_LABELS[p]} onPress={() => openLegal(p)} last={i === SETTINGS_PAGES.length - 1} />)}
      </MenuGroup>

      <SectionTitle text="Account" />
      <MenuGroup>
        <MenuRow icon="help-buoy-outline" title="Email ZCS support" sub={SUPPORT_EMAIL} onPress={() => email(`ZCS PG Partner help (${owner?.name || ''})`)} />
        <MenuRow icon="trash-outline" title="Delete account" sub="Ask ZCS to close this account" onPress={() => navigation.navigate('DeleteAccount')} danger last />
      </MenuGroup>
      <Button label="Sign out" icon="log-out-outline" variant="dangerOutline" onPress={() => setConfirmOut(true)} />
      <Text style={[font.small, { color: color.textMuted, textAlign: 'center' }]}>ZCS PG Partner {version}</Text>

      <Sheet visible={confirmOut} onClose={() => setConfirmOut(false)} title="Sign out?">
        <Text style={[font.body, { color: color.textSecondary, marginBottom: space.md }]}>New booking requests will not ring on this phone until you sign in again.</Text>
        <View style={{ gap: space.xs }}>
          <Button label="Sign out" variant="danger" loading={busy} onPress={async () => { setBusy(true); await signOut(); }} />
          <Button label="Stay signed in" variant="secondary" onPress={() => setConfirmOut(false)} />
        </View>
      </Sheet>
    </Screen>
  );
}

export function ChangePasswordScreen({ navigation }: ScreenProps<'ChangePassword'>) {
  const { replaceSession } = useSession();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problem = next ? passwordProblem(next) : null;
  const mismatch = confirm.length > 0 && confirm !== next;
  const ready = current.length > 0 && !!next && !problem && confirm === next && next !== current;
  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await ownerApi.changePassword(current, next);
      await replaceSession(r.token, r.owner);
      toast.show(r.message, 'success');
      navigation.goBack();
    } catch (e) {
      setError(e instanceof ApiError && e.code === 'INVALID_CREDENTIALS' ? 'Your current password is wrong.' : errorMessage(e));
      setBusy(false);
    }
  };
  return (
    <Screen title="Change password" onBack={() => navigation.goBack()} keyboard>
      <Card style={{ gap: space.md }}>
        <PasswordField label="Current password" value={current} onChange={(v) => { setCurrent(v); setError(null); }} />
        <PasswordField label="New password" value={next} onChange={(v) => { setNext(v); setError(null); }} autoComplete="new-password"
          error={problem || (next && next === current ? 'Choose a new password, not the current one.' : null)} hint="8 or more characters with letters and numbers" />
        <PasswordField label="Confirm new password" value={confirm} onChange={(v) => { setConfirm(v); setError(null); }} onSubmit={submit} autoComplete="new-password"
          error={mismatch ? 'The passwords do not match.' : null} />
        {error ? <Banner tone="error" text={error} /> : null}
        <Button label="Change password" icon="key-outline" onPress={submit} loading={busy} disabled={!ready} />
      </Card>
      <Text style={[font.small, { color: color.textMuted, textAlign: 'center' }]}>Every other phone signed in to this account is signed out.</Text>
    </Screen>
  );
}

// Google Play account deletion: PG owner accounts are created by ZCS, so the ZCS team closes them. The request
// is recorded in-app (re-checked with the password) and the admins are told; email / call work too.
export function DeleteAccountScreen({ navigation }: ScreenProps<'DeleteAccount'>) {
  const { owner, refreshMe } = useSession();
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestedAt, setRequestedAt] = useState<string | null>(null);
  useEffect(() => {
    ownerApi.me().then((r) => setRequestedAt(r.owner.deletionRequestedAt)).catch(() => {});
  }, []);
  const ready = password.length > 0 && confirm.trim().toUpperCase() === 'DELETE';
  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await ownerApi.requestDeletion(password, reason.trim() || undefined);
      setRequestedAt(r.owner.deletionRequestedAt);
      toast.show('Deletion request sent.', 'success');
      refreshMe();
    } catch (e) {
      setError(e instanceof ApiError && e.code === 'WRONG_PASSWORD' ? 'That password is wrong.' : errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen title="Delete account" onBack={() => navigation.goBack()} keyboard>
      <Card style={{ gap: space.xs }}>
        <Text style={[font.h3, { color: color.text }]}>How it works</Text>
        <Text style={[font.body, { color: color.textSecondary }]}>
          PG owner accounts are set up by ZCS, so the ZCS team closes them. We confirm the request with you and close the account
          within 7 days: your name, number, password, push tokens and notifications are deleted and you are signed out everywhere.
        </Text>
        <Text style={[font.h3, { color: color.text, marginTop: space.xs }]}>What is kept</Text>
        <Text style={[font.body, { color: color.textSecondary }]}>
          Your PG listing stays with ZCS (it can be hidden on request). Booking and rent records are kept without your personal details, as the law requires.
        </Text>
        <Text style={[font.body, { color: color.primary, fontWeight: '700' }]} onPress={() => openLegal('deleteAccount')} accessibilityRole="link">Read the full details</Text>
      </Card>
      {requestedAt ? (
        <Banner tone="ok" title="Request received" text={`Sent on ${dateLabel(requestedAt.slice(0, 10))}. The ZCS team will contact you on +91 ${owner?.phone || ''}.`} />
      ) : (
        <Card style={{ gap: space.md }}>
          <PasswordField label="Your password" value={password} onChange={(v) => { setPassword(v); setError(null); }} />
          <Field label="Reason (optional)" value={reason} onChangeText={(v) => setReason(v.slice(0, 300))} placeholder="e.g. I sold the PG" />
          <Field label="Type DELETE to confirm" value={confirm} onChangeText={setConfirm} autoCapitalize="characters" />
          {error ? <Banner tone="error" text={error} /> : null}
          <Button label="Request account deletion" icon="trash-outline" variant="danger" onPress={submit} loading={busy} disabled={!ready} />
        </Card>
      )}
      <View style={{ gap: space.xs }}>
        <Button label="Email ZCS instead" icon="mail-outline" variant="secondary" size="secondary" onPress={() => email(`Close my ZCS PG Partner account (${owner?.name || ''})`)} />
        <Button label={`Call ZCS support (${SUPPORT_PHONE_DISPLAY})`} icon="call-outline" variant="secondary" size="secondary" onPress={call} />
      </View>
    </Screen>
  );
}
