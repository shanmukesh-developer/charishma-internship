// Notifications, Trip history, Earnings, Queue, Profile, Help & Support, Settings.
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';
import Constants from 'expo-constants';
import { color, font, radius, space } from '../theme';
import { Badge, Button, Card, Chip, EmptyState, ErrorStrip, SkeletonCard } from '../ui/kit';
import { Banner, Field, KeyValue, ListRow, Screen, SectionTitle } from '../ui/Screen';
import { call } from '../ui/Sos';
import { useToast } from '../ui/Toast';
import { useSession } from '../state/SessionProvider';
import { useDriverEvents } from '../state/SocketProvider';
import { useLoad } from '../state/useLoad';
import { driverApi, normalizePhone, passwordProblem } from '../api/driverApi';
import { ApiError, NetworkError, errorMessage, serverNow } from '../lib/http';
import { enqueue } from '../lib/offlineQueue';
import { dateTimeIst, dayIst, relative, rupees, timeIst, ymdInput } from '../lib/format';
import { istYmd } from '../lib/tripRules';
import { API_URL, EMERGENCY_NUMBER, SUPPORT_PHONE, SUPPORT_PHONE_DISPLAY } from '../config';
import { INCIDENT_CATEGORIES, type DriverNotification, type IncidentCategory } from '../types';
import { STATUS_TONE } from './Home';
import type { ScreenProps } from '../nav';
import { LEGAL_LABELS, SETTINGS_PAGES, openLegal } from '../lib/legal';

// ── Notifications (GET /notifications; every push is also saved here) ───────────
export function NotificationsScreen({ navigation }: ScreenProps<'Notifications'>) {
  const q = useLoad(() => driverApi.notifications(), []);
  useDriverEvents(() => q.reload());
  const list = q.data?.notifications || [];
  // Mark read once seen (idempotent: queued when offline).
  useEffect(() => {
    if (!q.data?.unread) return;
    driverApi.markRead().catch((e) => { if (e instanceof NetworkError) enqueue('MARK_READ'); });
  }, [q.data?.unread]);
  const open = (n: DriverNotification) => {
    const tripId = n.data && typeof n.data.tripId === 'string' ? n.data.tripId : null;
    // Same targets as a push tap (App.tsx routePush): an on-charge alert opens the stand view.
    if (n.type === 'AUTO_PRIVATE_REQUEST' || (n.data && n.data.requestId)) navigation.navigate('Requests');
    else if (tripId && n.type === 'AUTO_ON_CHARGE') navigation.navigate('Charge', { tripId });
    else if (tripId) navigation.navigate('TripDetail', { tripId });
    else if (n.type && /VEHICLE/.test(n.type)) navigation.navigate('Vehicles');
  };
  return (
    <Screen title="Notifications" onBack={() => navigation.goBack()} refreshing={q.refreshing} onRefresh={q.refresh}>
      {q.loading && !q.data ? <><SkeletonCard lines={1} /><SkeletonCard lines={1} /></> : null}
      {q.error && !q.data ? <ErrorStrip text={q.error} onRetry={q.refresh} busy={q.refreshing} /> : null}
      {q.data && !list.length ? <EmptyState icon="notifications-off" title="No notifications yet" body="Bookings, full-auto requests and verification news show here." /> : null}
      {list.map((n) => (
        <Pressable key={n.id} onPress={() => open(n)} accessibilityRole="button" style={({ pressed }) => [pressed && { opacity: 0.8 }]}>
          <Card style={{ gap: 4, borderColor: n.readAt ? color.border : color.brand, borderWidth: n.readAt ? 1 : 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
              <Text style={[font.h3, { color: color.text, flex: 1 }]}>{n.title}</Text>
              {!n.readAt ? <Badge text="NEW" fg={color.brandDark} bg={color.brandTint} /> : null}
            </View>
            {n.body ? <Text style={[font.body, { color: color.textSecondary }]}>{n.body}</Text> : null}
            <Text style={[font.small, { color: color.textMuted }]}>{dateTimeIst(n.createdAt)}</Text>
          </Card>
        </Pressable>
      ))}
    </Screen>
  );
}

// ── Trip history (GET /trips?scope=past) ─────────────────────────────────────────
export function HistoryScreen({ navigation }: ScreenProps<'History'>) {
  const q = useLoad(() => driverApi.trips('past'), []);
  const trips = q.data?.trips || [];
  return (
    <Screen title="Trip history" onBack={() => navigation.goBack()} refreshing={q.refreshing} onRefresh={q.refresh}>
      {q.loading && !q.data ? <SkeletonCard /> : null}
      {q.error && !q.data ? <ErrorStrip text={q.error} onRetry={q.refresh} busy={q.refreshing} /> : null}
      {q.data && !trips.length ? <EmptyState icon="time" title="No finished trips yet" /> : null}
      {trips.map((t) => {
        const tone = STATUS_TONE(t.status);
        return (
          <Pressable key={t.id} onPress={() => navigation.navigate('TripDetail', { tripId: t.id })} accessibilityRole="button">
            <Card style={{ gap: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
                <Text style={[font.h3, { color: color.text, flex: 1 }]} numberOfLines={1}>{t.route ? `${t.route.origin} → ${t.destination || t.route.destination}` : t.destination}</Text>
                <Badge text={t.statusLabel} fg={tone.fg} bg={tone.bg} />
              </View>
              <Text style={[font.body, { color: color.textSecondary }]}>{dayIst(t.departureAt)} · {timeIst(t.departureAt)}{t.queueNumber ? ` · Queue #${t.queueNumber}` : ''}</Text>
              <Text style={[font.body, { color: color.textSecondary }]}>{t.boardedSeats} boarded · {t.confirmedSeats}/{t.capacity} confirmed · {rupees(t.seatFare)} per seat</Text>
            </Card>
          </Pressable>
        );
      })}
    </Screen>
  );
}

// ── Earnings (GET /earnings?from&to, recorded money only) ────────────────────────
type Range = 'today' | 'week' | 'month';
export function EarningsScreen({ navigation }: ScreenProps<'Earnings'>) {
  const [range, setRange] = useState<Range>('today');
  const { from, to } = useMemo(() => {
    const now = serverNow();
    const today = istYmd(now);
    if (range === 'today') return { from: today, to: today };
    if (range === 'week') return { from: istYmd(now - 6 * 86400000), to: today };
    return { from: `${today.slice(0, 7)}-01`, to: today };
  }, [range]);
  const q = useLoad(() => driverApi.earnings(from, to), [from, to]);
  return (
    <Screen title="Earnings" onBack={() => navigation.goBack()} refreshing={q.refreshing} onRefresh={q.refresh}>
      <View style={{ flexDirection: 'row', gap: space.xs }}>
        <Chip label="Today" selected={range === 'today'} onPress={() => setRange('today')} style={{ flex: 1 }} />
        <Chip label="7 days" selected={range === 'week'} onPress={() => setRange('week')} style={{ flex: 1 }} />
        <Chip label="This month" selected={range === 'month'} onPress={() => setRange('month')} style={{ flex: 1 }} />
      </View>
      {q.loading && !q.data ? <SkeletonCard /> : null}
      {q.error && !q.data ? <ErrorStrip text={q.error} onRetry={q.refresh} busy={q.refreshing} /> : null}
      {q.data ? (
        <>
          <Card style={{ alignItems: 'center', gap: 4, backgroundColor: color.openTint, borderColor: color.open }}>
            <Text style={[font.label, { color: color.openDark }]}>TOTAL</Text>
            <Text style={[font.big, { color: color.openDark }]}>{rupees(q.data.total)}</Text>
            <Text style={[font.small, { color: color.openDark }]}>{q.data.from === q.data.to ? dayIst(`${q.data.from}T06:30:00Z`) : `${dayIst(`${q.data.from}T06:30:00Z`)} – ${dayIst(`${q.data.to}T06:30:00Z`)}`}</Text>
          </Card>
          <Card style={{ gap: 2 }}>
            <KeyValue k="Cash you collected" v={rupees(q.data.cashCollected)} strong />
            <KeyValue k="ZENV Wallet payments" v={rupees(q.data.walletPayments)} />
          </Card>
          <Banner tone="info" text={q.data.note} />
        </>
      ) : null}
    </Screen>
  );
}

// ── Queue ─────────────────────────────────────────────────────────────────────
// The driver's own queue numbers from GET /home (current trip + today's trips), plus the whole queue at the
// current trip's pickup point (GET /driver/pickup-points/:id/queue: trip cards only, no passenger data).
export function QueueScreen({ navigation }: ScreenProps<'Queue'>) {
  const q = useLoad(async () => {
    const home = await driverApi.home();
    const cur0 = home.currentTrip;
    const atPickup = cur0 && cur0.pickupPointId
      ? await driverApi.pickupQueue(cur0.pickupPointId, cur0.operatingDate || undefined).catch(() => null)
      : null;
    return { ...home, atPickup };
  }, [], { pollMs: 30000 });
  useDriverEvents(() => q.reload());
  const cur = q.data?.currentTrip;
  const today = (q.data?.todayTrips || []).filter((t) => t.queueNumber);
  return (
    <Screen title="Your queue" onBack={() => navigation.goBack()} refreshing={q.refreshing} onRefresh={q.refresh}>
      {q.loading && !q.data ? <SkeletonCard /> : null}
      {q.error && !q.data ? <ErrorStrip text={q.error} onRetry={q.refresh} busy={q.refreshing} /> : null}
      {q.data ? (
        cur && cur.queueNumber ? (
          <Card style={{ alignItems: 'center', gap: space.xs, borderColor: color.brand, borderWidth: 2 }}>
            <Text style={[font.label, { color: color.textMuted }]}>YOUR QUEUE NUMBER</Text>
            <Text style={[font.big, { color: color.text, fontSize: 64, lineHeight: 70 }]}>#{cur.queueNumber}</Text>
            <Text style={[font.h3, { color: color.text, textAlign: 'center' }]}>{cur.pickup?.name || ''}</Text>
            <Text style={[font.body, { color: color.textSecondary, textAlign: 'center' }]}>{cur.statusLabel} · {cur.confirmedSeats}/{cur.capacity} passengers · leaves {timeIst(cur.departureAt)} ({relative(cur.departureAt)})</Text>
            <Button label="Open trip" icon="open" variant="secondary" size="secondary" onPress={() => navigation.navigate('TripDetail', { tripId: cur.id })} />
          </Card>
        ) : <EmptyState icon="people" title="Not in a queue" body="ZENV gives you a queue number when you publish a trip at a pickup point." />
      ) : null}
      {q.data?.atPickup && q.data.atPickup.queue.length ? <SectionTitle text={`At ${q.data.atPickup.pickupPoint.name}`} /> : null}
      {(q.data?.atPickup?.queue || []).map((t) => (
        <Card key={t.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, ...(t.mine ? { borderColor: color.brand, borderWidth: 2 } : {}) }}>
          <Text style={[font.h2, { color: color.text, width: 64 }]}>#{t.queueNumber}</Text>
          <View style={{ flex: 1 }}>
            <Text style={[font.body, { color: color.text, fontWeight: '700' }]}>{t.mine ? 'You' : t.driver?.name || 'Auto'} · {t.statusLabel}</Text>
            <Text style={[font.small, { color: color.textSecondary }]}>{timeIst(t.departureAt)} · {t.confirmedSeats}/{t.capacity} · {t.remainingSeats} left</Text>
          </View>
        </Card>
      ))}
      {today.length ? <SectionTitle text="Today" /> : null}
      {today.map((t) => (
        <Card key={t.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Text style={[font.h2, { color: color.text, width: 64 }]}>#{t.queueNumber}</Text>
          <View style={{ flex: 1 }}>
            <Text style={[font.body, { color: color.text, fontWeight: '700' }]}>{t.statusLabel}</Text>
            <Text style={[font.small, { color: color.textSecondary }]}>{timeIst(t.departureAt)} · {t.confirmedSeats}/{t.capacity}</Text>
          </View>
        </Card>
      ))}
      <Banner tone="info" text="Queue numbers show the order autos checked in at the pickup point. The departure order can differ (for example, a full auto may leave first)." />
    </Screen>
  );
}

// ── Profile (PATCH /me/profile, POST /auth/password) ─────────────────────────────
export function ProfileScreen({ navigation }: ScreenProps<'Profile'>) {
  const { me, refreshMe, replaceToken } = useSession();
  const toast = useToast();
  const routesQ = useLoad(() => driverApi.routes(), []);
  const d = me?.driver;
  const [name, setName] = useState(d?.name || '');
  const [ecName, setEcName] = useState(d?.emergencyContactName || '');
  const [ecPhone, setEcPhone] = useState(d?.emergencyContactPhone || '');
  const [licence, setLicence] = useState(d?.licenceNumber || '');
  const [licenceExp, setLicenceExp] = useState(d?.licenceExpiresOn || '');
  const [badge, setBadge] = useState(d?.badgeNumber || '');
  const [routes, setRoutes] = useState<string[]>(d?.preferredRouteIds || []);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [pwBusy, setPwBusy] = useState(false);

  useEffect(() => {
    if (!d) return;
    setName(d.name); setEcName(d.emergencyContactName || ''); setEcPhone(d.emergencyContactPhone || '');
    setLicence(d.licenceNumber || ''); setLicenceExp(d.licenceExpiresOn || ''); setBadge(d.badgeNumber || ''); setRoutes(d.preferredRouteIds || []);
  }, [d?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!d) return <Screen title="Profile" onBack={() => navigation.goBack()}><SkeletonCard lines={5} /></Screen>;

  const save = async () => {
    const e: Record<string, string> = {};
    if (name.trim().length < 2) e.name = 'Enter your full name.';
    const lic = licence.toUpperCase().replace(/[^A-Z0-9-]/g, '');
    if (lic && lic.length < 8) e.licenceNumber = 'Enter the full driving licence number.';
    const exp = ymdInput(licenceExp);
    if (exp === false) e.licenceExpiresOn = 'Use the format YYYY-MM-DD.';
    else if (exp && exp < istYmd(serverNow())) e.licenceExpiresOn = 'This licence has already expired.';
    const ec = ecPhone.trim() ? normalizePhone(ecPhone) : '';
    if (ec === null) e.emergencyContactPhone = 'Enter a valid 10-digit number.';
    setErrors(e);
    if (Object.keys(e).length) return;
    const sensitive = d.status === 'VERIFIED' && (name.trim() !== d.name || lic !== (d.licenceNumber || '') || (exp || null) !== (d.licenceExpiresOn || null));
    const run = async () => {
      setBusy(true);
      try {
        await driverApi.updateProfile({ name: name.trim(), emergencyContactName: ecName.trim() || null, emergencyContactPhone: ec || null, licenceNumber: lic || null, licenceExpiresOn: (exp || null) as string | null, badgeNumber: badge.trim() || null, preferredRouteIds: routes });
        await refreshMe();
        toast.show('Saved.', 'success');
      } catch (err) {
        if (err instanceof ApiError && err.data?.field) setErrors({ [String(err.data.field)]: err.message });
        toast.show(errorMessage(err), 'error');
      } finally { setBusy(false); }
    };
    if (sensitive) {
      Alert.alert('Send for checking again?', 'Changing your name or licence sends your account back to ZENV for checking. You go offline until then.', [
        { text: 'Cancel', style: 'cancel' }, { text: 'Save', onPress: run },
      ]);
    } else run();
  };

  const changePw = async () => {
    const p = passwordProblem(newPw);
    if (p) { toast.show(p, 'error'); return; }
    setPwBusy(true);
    try {
      const r = await driverApi.changePassword(curPw, newPw);
      await replaceToken(r.token);
      setCurPw(''); setNewPw('');
      toast.show(r.message, 'success');
    } catch (e) { toast.show(errorMessage(e), 'error'); } finally { setPwBusy(false); }
  };

  return (
    <Screen title="Profile and vehicle" onBack={() => navigation.goBack()} keyboard>
      <Card style={{ gap: 2 }}>
        <KeyValue k="Mobile" v={`+91 ${d.phone}`} />
        <KeyValue k="Status" v={d.status.replace('_', ' ')} />
      </Card>
      <ListRow icon="car" title="Your autos" sub={(me?.vehicles || []).map((v) => v.registration || v.registrationNumber).join(', ') || 'Add your auto'} onPress={() => navigation.navigate('Vehicles')} />
      <ListRow icon="document-text" title="Documents" onPress={() => navigation.navigate('Documents')} />
      <ListRow icon="shield-checkmark" title="Verification status" onPress={() => navigation.navigate('Verification')} />
      <SectionTitle text="Your details" />
      <Field label="Full name" value={name} onChangeText={(v) => setName(v.slice(0, 80))} error={errors.name} autoCapitalize="words" />
      <Field label="Driving licence number" value={licence} onChangeText={(v) => setLicence(v.toUpperCase().slice(0, 24))} autoCapitalize="characters" placeholder="AP02 2019 0012345" error={errors.licenceNumber} />
      <Field label="Licence valid until" value={licenceExp} onChangeText={(v) => setLicenceExp(v.replace(/[^\d-]/g, '').slice(0, 10))} keyboardType="numbers-and-punctuation" placeholder="YYYY-MM-DD" error={errors.licenceExpiresOn} />
      <Field label="PSV badge number (optional)" value={badge} onChangeText={(v) => setBadge(v.slice(0, 30))} autoCapitalize="characters" />
      <Field label="Emergency contact name" value={ecName} onChangeText={(v) => setEcName(v.slice(0, 80))} autoCapitalize="words" />
      <Field label="Emergency contact number" prefix="+91" value={ecPhone} onChangeText={(v) => setEcPhone(v.replace(/\D/g, '').slice(0, 12))} keyboardType="phone-pad" error={errors.emergencyContactPhone} />
      {routesQ.data?.routes.length ? (
        <>
          <SectionTitle text="Routes you usually drive (optional)" />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
            {routesQ.data.routes.map((r) => (
              <Chip key={r.id} label={`${r.origin} → ${r.destination}`} selected={routes.includes(r.id)} onPress={() => setRoutes((c) => (c.includes(r.id) ? c.filter((x) => x !== r.id) : [...c, r.id]))} style={{ flexGrow: 1 }} />
            ))}
          </View>
        </>
      ) : null}
      <Button label="Save details" icon="save" onPress={save} loading={busy} />
      <SectionTitle text="Change password" />
      <Field label="Current password" value={curPw} onChangeText={setCurPw} secureTextEntry autoCapitalize="none" />
      <Field label="New password" value={newPw} onChangeText={setNewPw} secureTextEntry autoCapitalize="none" hint="8+ characters with letters and numbers. Other phones are signed out." />
      <Button label="Change password" icon="key" variant="secondary" onPress={changePw} loading={pwBusy} disabled={!curPw || !newPw} />
    </Screen>
  );
}

// ── Help & Support + incident report (POST /incidents) ───────────────────────────
const CAT_LABEL: Record<IncidentCategory, string> = {
  SAFETY: 'Safety', HARASSMENT: 'Harassment', OVERCHARGE: 'Fare dispute', RASH_DRIVING: 'Rash driving', NO_SHOW: 'Passenger did not come',
  VEHICLE_ISSUE: 'Auto problem', PAYMENT: 'Payment', LOST_ITEM: 'Lost item', OTHER: 'Other',
};
export function SupportScreen({ navigation }: ScreenProps<'Support'>) {
  const toast = useToast();
  const home = useLoad(() => driverApi.home(), []);
  const cur = home.data?.currentTrip || null;
  const [cat, setCat] = useState<IncidentCategory | null>(null);
  const [text, setText] = useState('');
  const [linkTrip, setLinkTrip] = useState(true);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!cat || text.trim().length < 5) return;
    setBusy(true);
    try {
      const r = await driverApi.reportIncident({ category: cat, description: text.trim(), ...(cur && linkTrip ? { tripId: cur.id } : {}) });
      toast.show(r.message, 'success');
      setCat(null); setText('');
    } catch (e) { toast.show(errorMessage(e), 'error'); } finally { setBusy(false); }
  };
  return (
    <Screen title="Help and support" onBack={() => navigation.goBack()} keyboard>
      <Button label={`Emergency: call ${EMERGENCY_NUMBER}`} icon="call" variant="reject" size="huge" onPress={() => call(EMERGENCY_NUMBER)} />
      <Button label={`Call ZENV (${SUPPORT_PHONE_DISPLAY})`} icon="headset" variant="secondary" onPress={() => call(`+${SUPPORT_PHONE}`)} />
      <SectionTitle text="Report a problem" />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
        {INCIDENT_CATEGORIES.map((c) => <Chip key={c} label={CAT_LABEL[c]} selected={cat === c} tone={c === 'SAFETY' || c === 'HARASSMENT' ? 'red' : 'dark'} onPress={() => setCat(c)} style={{ flexGrow: 1, minWidth: 140 }} />)}
      </View>
      <TextInput value={text} onChangeText={(v) => setText(v.slice(0, 2000))} placeholder="What happened? (at least 5 characters)" placeholderTextColor={color.textMuted} multiline
        style={[font.body, { minHeight: 110, textAlignVertical: 'top', borderWidth: 2, borderColor: color.border, borderRadius: radius.md, padding: space.md, color: color.text, backgroundColor: color.surface }]} accessibilityLabel="Problem description" />
      {cur ? (
        <Chip label={linkTrip ? `About my current trip (${timeIst(cur.departureAt)}) ✓` : 'Not about my current trip'} selected={linkTrip} onPress={() => setLinkTrip(!linkTrip)} />
      ) : null}
      <Button label="Send to ZENV" icon="send" onPress={send} loading={busy} disabled={!cat || text.trim().length < 5} />
      <Text style={[font.small, { color: color.textMuted }]}>ZENV reads every report. For danger, call {EMERGENCY_NUMBER} first.</Text>
    </Screen>
  );
}

// ── Settings (logout removes the FCM token: POST /fcm-token/remove) ─────────────
export function SettingsScreen({ navigation }: ScreenProps<'Settings'>) {
  const { signOut, pushState, driver } = useSession();
  const [busy, setBusy] = useState(false);
  const logout = () => {
    Alert.alert('Sign out?', 'You will stop getting booking alerts on this phone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: async () => {
        setBusy(true);
        try { await driverApi.setOnline(false).catch(() => {}); await signOut(); } finally { setBusy(false); }
      } },
    ]);
  };
  const pushText = pushState === 'ok' ? 'On. Booking alerts reach this phone even when the app is closed.'
    : pushState === 'blocked' ? 'Blocked. Allow notifications for ZENV Auto Driver in phone Settings.'
      : pushState === 'unavailable' ? 'Not available in this build (no Firebase setup). Alerts show only while the app is open, and in Notifications.'
        : 'Checking…';
  return (
    <Screen title="Settings" onBack={() => navigation.goBack()}>
      <Card style={{ gap: 2 }}>
        <KeyValue k="Signed in as" v={driver ? `${driver.name} (+91 ${driver.phone})` : '—'} />
        <KeyValue k="App version" v={String(Constants.expoConfig?.version || '1.0.0')} />
        <KeyValue k="Server" v={API_URL.replace(/^https?:\/\//, '')} />
      </Card>
      <Banner tone={pushState === 'ok' ? 'ok' : 'warn'} title="Push notifications" text={pushText} />
      <Banner tone="info" text="This app does not use your location. Trip actions are only for when the auto is stopped." />
      <ListRow icon="person-circle" title="Profile and password" onPress={() => navigation.navigate('Profile')} />
      {SETTINGS_PAGES.map((p) => (
        <ListRow key={p} icon="document-text" title={LEGAL_LABELS[p]} onPress={() => openLegal(p)} />
      ))}
      <ListRow icon="trash" title="Delete account" sub="Close your driver account and delete your details" onPress={() => navigation.navigate('DeleteAccount')} />
      <Button label="Sign out" icon="log-out" variant="rejectOutline" onPress={logout} loading={busy} />
    </Screen>
  );
}
