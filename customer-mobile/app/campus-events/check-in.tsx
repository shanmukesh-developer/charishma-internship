// Zenvy Campus Events: entry check-in for the event's organizer, admins and granted staff only (the server
// decides: GET /check-in/events lists the events this account may check in; anyone else gets an empty list
// and every call answers 403 NOT_EVENT_STAFF). v1 is typed-code check-in (no camera scanner in this app build):
// pick event -> type the 10-character ticket code -> Validate (read-only verdict) -> colour + words result
// Valid / Already used / Cancelled / Invalid / Not yet valid / … -> collect the fee when one is due ->
// Confirm entry (atomic, single use). Online only: if the server cannot be reached, do not admit.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, TextInput, TouchableOpacity, RefreshControl } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { KeyboardAvoidingView } from '../../components/KeyboardAvoidingView';
import { campusEventsApi, CampusEventsError, CHECKIN_META, fmtWhen, fmtClock, inr, type CheckInEvent, type CheckInReply, type CeIconName } from '../../modules/campusEvents/campusEventsApi';
import { EHeader, usePalette, Card, Btn, CheckRow, ErrorState, StateView, Notice, Row, SectionTitle } from '../../modules/campusEvents/ui';

type Recent = { id: string; action: string; result: string; method: string; at: string | null; ticketCode: string | null; collectedPayment: boolean };

export default function CheckInScreen() {
  const params = useLocalSearchParams<{ eventId?: string }>();
  const router = useRouter();
  const p = usePalette();
  const [events, setEvents] = useState<CheckInEvent[] | null>(null);
  const [error, setError] = useState<CampusEventsError | null>(null);
  const [eventId, setEventId] = useState<string | null>(params.eventId ? String(params.eventId) : null);
  const [code, setCode] = useState('');
  const [reply, setReply] = useState<CheckInReply | null>(null);
  const [admitted, setAdmitted] = useState<CheckInReply | null>(null);
  const [collect, setCollect] = useState(false);
  const [busy, setBusy] = useState<'validate' | 'confirm' | null>(null);
  const [offline, setOffline] = useState<string | null>(null);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const input = useRef<TextInput>(null);

  const load = useCallback(async () => {
    try {
      const r = await campusEventsApi.checkInEvents();
      setEvents(r.events);
      setError(null);
      setEventId((cur) => (cur && r.events.some((e) => e.id === cur) ? cur : r.events.length === 1 ? r.events[0].id : cur));
    } catch (e: any) {
      setError(e instanceof CampusEventsError ? e : new CampusEventsError(e?.message || 'Could not load events.'));
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  const loadRecent = useCallback(async () => {
    if (!eventId) return;
    try { setRecent((await campusEventsApi.recentCheckIns(eventId)).checkIns.slice(0, 15)); } catch { /* optional */ }
  }, [eventId]);
  useEffect(() => { loadRecent(); }, [loadRecent]);

  const clean = (v: string) => v.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 10);
  const reset = () => { setCode(''); setReply(null); setAdmitted(null); setCollect(false); setOffline(null); setTimeout(() => input.current?.focus(), 100); };

  const validate = async () => {
    if (!eventId || code.length !== 10) return;
    setBusy('validate');
    setReply(null); setAdmitted(null); setOffline(null); setCollect(false);
    try {
      setReply(await campusEventsApi.validate(eventId, { code }));
    } catch (e: any) {
      if (e?.isNetwork) setOffline(e.message);
      else setReply({ result: 'INVALID', label: e?.message || 'Could not check this ticket.', admit: false, ticket: null });
    } finally {
      setBusy(null);
    }
  };
  const confirm = async () => {
    if (!eventId || !reply) return;
    setBusy('confirm');
    try {
      const r = await campusEventsApi.confirmCheckIn(eventId, { code }, !!reply.paymentDue && collect);
      setAdmitted(r);
      setReply(null);
      loadRecent();
      load();
    } catch (e: any) {
      if (e?.isNetwork) setOffline(e.message);
      else if (e?.data?.result) setReply(e.data as CheckInReply);
      else setReply({ result: 'INVALID', label: e?.message || 'Could not admit.', admit: false, ticket: null });
    } finally {
      setBusy(null);
    }
  };

  if (!events) {
    return (
      <View style={{ flex: 1, backgroundColor: p.bg }}>
        <EHeader title="Entry check-in" />
        {error ? <ErrorState error={error} onRetry={load} onNotFound={() => router.back()} /> : <StateView kind="loading" />}
      </View>
    );
  }
  if (!events.length) {
    return (
      <View style={{ flex: 1, backgroundColor: p.bg }}>
        <EHeader title="Entry check-in" />
        <StateView kind="empty" icon="shield-checkmark-outline" title="No check-in access" message="Only an event's organizer and the staff they grant can check attendees in. Ask the organizer to add you as staff." actionLabel="Retry" onAction={load} />
      </View>
    );
  }

  const ev = events.find((e) => e.id === eventId) || null;
  const verdict = admitted || reply;
  const vm: { title: string; color: string; icon: CeIconName } | null = verdict ? (admitted ? { title: 'Admitted', color: '#16A34A', icon: 'checkmark-circle' } : verdict.result === 'VALID' && verdict.paymentDue ? CHECKIN_META.PAYMENT_DUE : CHECKIN_META[verdict.result] || CHECKIN_META.INVALID) : null;
  const tk = verdict?.ticket;

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <EHeader title="Entry check-in" subtitle={ev ? ev.title : 'Pick an event'} />
      <KeyboardAvoidingView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }} keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await Promise.all([load(), loadRecent()]); setRefreshing(false); }} tintColor={p.accent} />}>
          <Notice tone="warn" icon="wifi-outline">Check-in works online only. If the result does not load, do not admit: ask the student to wait until the connection is back.</Notice>

          <SectionTitle>Event</SectionTitle>
          {events.map((e) => {
            const on = e.id === eventId;
            return (
              <TouchableOpacity key={e.id} onPress={() => { setEventId(e.id); reset(); }} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={`${e.title}, ${e.checkedIn} of ${e.confirmed} checked in`}
                style={{ minHeight: 56, padding: 12, borderRadius: 14, borderWidth: 1.5, borderColor: on ? p.accent : p.border, backgroundColor: on ? p.accentSoft : p.card, marginBottom: 8 }}>
                <Text style={{ fontSize: 14, fontWeight: '900', color: p.text }}>{e.title}</Text>
                <Text style={{ fontSize: 12, color: p.sub, marginTop: 2 }}>{fmtWhen(e.startAt)}{e.venue ? ` · ${e.venue}` : ''} · {e.status === 'APPROVED' ? `scheduled${e.publishAt ? `, goes live ${fmtWhen(e.publishAt)}` : ''}` : `${e.checkedIn}/${e.confirmed} in`}</Text>
              </TouchableOpacity>
            );
          })}

          {ev ? (
            <>
              <SectionTitle>Ticket code</SectionTitle>
              <TextInput ref={input} value={code} onChangeText={(v) => { setCode(clean(v)); setReply(null); setAdmitted(null); setOffline(null); }}
                autoCapitalize="characters" autoCorrect={false} placeholder="10-character code" placeholderTextColor={p.muted} maxLength={14}
                onSubmitEditing={validate} returnKeyType="go" accessibilityLabel="Ticket code"
                style={{ minHeight: 60, borderRadius: 16, borderWidth: 1.5, borderColor: p.inputBorder, backgroundColor: p.input, color: p.text, fontSize: 26, fontWeight: '900', letterSpacing: 4, textAlign: 'center' }} />
              <Text style={{ fontSize: 11.5, color: p.muted, marginTop: 6, textAlign: 'center' }}>{code.length}/10 · O and 0, I and 1 are treated alike</Text>
              <Btn label="Validate ticket" onPress={validate} loading={busy === 'validate'} disabled={code.length !== 10} style={{ marginTop: 12 }} />

              {offline ? (
                <View style={{ marginTop: 14, borderRadius: 18, padding: 18, backgroundColor: '#DC2626' }} accessibilityRole="alert" accessibilityLiveRegion="assertive">
                  <Text style={{ color: '#fff', fontSize: 22, fontWeight: '900' }}><Ionicons name="cloud-offline-outline" size={22} color="#fff" /> Cannot verify</Text>
                  <Text style={{ color: '#fff', fontSize: 14, marginTop: 4, fontWeight: '700' }}>Do not admit. {offline}</Text>
                  <Btn label="Try again" kind="secondary" small onPress={admitted ? reset : reply ? confirm : validate} style={{ marginTop: 10, alignSelf: 'flex-start' }} />
                </View>
              ) : null}

              {verdict && vm ? (
                <View style={{ marginTop: 14, borderRadius: 18, padding: 18, backgroundColor: vm.color }} accessibilityRole="alert" accessibilityLiveRegion="assertive"
                  accessibilityLabel={`${vm.title}. ${verdict.label}`}>
                  <Text style={{ color: '#fff', fontSize: 26, fontWeight: '900', letterSpacing: 0.2 }}><Ionicons name={vm.icon} size={26} color="#fff" /> {vm.title}</Text>
                  <Text style={{ color: '#fff', fontSize: 14, marginTop: 4, fontWeight: '700' }}>{admitted ? (admitted.collected ? `Entry recorded · ${inr(admitted.collected)} collected` : 'Entry recorded') : verdict.label}</Text>
                  {verdict.entryOpensAt ? <Text style={{ color: '#fff', fontSize: 13, marginTop: 4 }}>Entry opens {fmtWhen(verdict.entryOpensAt)}</Text> : null}
                </View>
              ) : null}

              {tk ? (
                <Card style={{ marginTop: 12 }}>
                  <Row label={tk.kind === 'TEAM' ? 'Team' : 'Name'} value={tk.kind === 'TEAM' ? tk.team || 'Team' : tk.holder || '—'} strong />
                  {tk.team && tk.kind !== 'TEAM' ? <Row label="Team" value={tk.team} /> : null}
                  <Row label="Ticket" value={tk.ticketCode} />
                  {tk.registrationCode ? <Row label="Registration code" value={tk.registrationCode} /> : null}
                  {tk.slot ? <Row label="Slot" value={`${tk.slot.label ? `${tk.slot.label} · ` : ''}${fmtClock(tk.slot.startAt)}–${fmtClock(tk.slot.endAt)}`} /> : null}
                  {tk.usedAt ? <Row label="Used at" value={fmtWhen(tk.usedAt)} /> : null}
                </Card>
              ) : null}

              {reply && reply.result === 'VALID' && !admitted ? (
                <View style={{ marginTop: 4 }}>
                  {reply.paymentDue ? <CheckRow label={`I collected ${inr(reply.paymentDue)} from the student`} hint="Required before admitting. Recorded with your name." value={collect} onChange={setCollect} /> : null}
                  <Btn label={reply.paymentDue ? 'Confirm payment & admit' : 'Confirm entry'} kind="success" onPress={confirm} loading={busy === 'confirm'} disabled={!!reply.paymentDue && !collect} />
                </View>
              ) : null}
              {verdict ? <Btn label="Next ticket" kind="secondary" onPress={reset} style={{ marginTop: 10 }} /> : null}

              {recent.length ? (
                <>
                  <SectionTitle>Recent at this event</SectionTitle>
                  <Card>
                    {recent.map((r) => {
                      const m = CHECKIN_META[r.result as keyof typeof CHECKIN_META] || CHECKIN_META.INVALID;
                      return (
                        <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 5, gap: 8 }}>
                          <Ionicons name={m.icon} size={16} color={m.color} style={{ width: 20 }} />
                          <Text style={{ flex: 1, color: p.text, fontSize: 12.5 }} numberOfLines={1}>{r.ticketCode || 'Unknown code'} · {r.action === 'CONFIRM' ? 'entry' : 'check'}{r.collectedPayment ? ' · fee' : ''}</Text>
                          <Text style={{ color: p.sub, fontSize: 11.5 }}>{m.title} · {fmtClock(r.at)}</Text>
                        </View>
                      );
                    })}
                  </Card>
                </>
              ) : null}
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
