// Zenvy Campus Events: slot booking (spec §3). Date strip -> sessions -> slot grid (start–end, capacity,
// remaining, price, state) -> summary -> "Hold this slot" (server holds it for settings.holdMinutes) ->
// confirm on the registration screen with a live countdown. Handles SLOT_FULL (offer the slot waitlist),
// BOOKING_LIMIT (max bookings per student), ALREADY_REGISTERED, closed / started slots. Capacity and price are
// the server's; the grid refreshes live and every 20 s while open.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, Alert } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { campusEventsApi, CampusEventsError, errorCopy, newIdempotencyKey, fmtClock, dayLabel, istYmd, inr, REG_STATUS_META, type EventDetail, type Slot, type SlotsResponse } from '../../../modules/campusEvents/campusEventsApi';
import { EHeader, usePalette, Card, Btn, ErrorState, StateView, Notice, Row, useNow, useCampusEventsStatus, CE_HOME } from '../../../modules/campusEvents/ui';
import SlotPicker, { DateStrip } from '../../../modules/campusEvents/SlotPicker';
import { useCampusEventsLive } from '../../../modules/campusEvents/useCampusEventsLive';

export default function SlotBookingScreen() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = String(Array.isArray(params.id) ? params.id[0] : params.id || '');
  const router = useRouter();
  const p = usePalette();
  const status = useCampusEventsStatus();
  const [ev, setEv] = useState<EventDetail | null>(null);
  const [data, setData] = useState<SlotsResponse | null>(null);
  const [error, setError] = useState<CampusEventsError | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const key = useRef(newIdempotencyKey());
  const now = useNow(30000);

  const load = useCallback(async () => {
    try {
      const [e, s] = await Promise.all([campusEventsApi.event(id), campusEventsApi.slots(id)]);
      setEv(e.event);
      setData(s);
      setDate((cur) => (cur && s.days.some((d) => d.date === cur) ? cur : (s.days.find((d) => d.slots.some((x) => x.state === 'OPEN')) || s.days[0])?.date || null));
      setError(null);
    } catch (err: any) {
      setError(err instanceof CampusEventsError ? err : new CampusEventsError(err?.message || 'Could not load slots.'));
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useCampusEventsLive((e) => { if (!e.id || e.id === id || e.kind === 'reconnect' || e.kind === 'registration') load(); });
  useFocusEffect(useCallback(() => {
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [load]));

  const day = data?.days.find((d) => d.date === date) || null;
  const slot: Slot | null = useMemo(() => data?.slots.find((x) => x.id === sel) || null, [data, sel]);
  const waitlistOk = !!ev?.waitlistEnabled;
  useEffect(() => { if (slot && slot.state !== 'OPEN' && !(slot.state === 'FULL' && waitlistOk)) setSel(null); }, [slot, waitlistOk]);
  const myOpen = (data?.slots || []).filter((x) => x.myRegistration);
  const myHeld = myOpen.find((x) => x.myRegistration?.status === 'HELD');
  const limitReached = !!data && data.myBookings >= data.maxBookingsPerStudent;

  const hold = async () => {
    if (!slot || !ev) return;
    setBusy(true);
    try {
      const r = await campusEventsApi.hold(ev.id, slot.id, key.current);
      key.current = newIdempotencyKey();
      router.push(`/campus-events/register/${ev.id}?regId=${r.registration.id}` as any);
      load();
    } catch (e: any) {
      const err = e as CampusEventsError;
      const c = errorCopy(err);
      if (!err?.isNetwork) key.current = newIdempotencyKey();
      if (err?.code === 'SLOT_FULL' && err.data?.waitlistEnabled) {
        Alert.alert(c.title, 'Someone took the last place a moment ago. Join this slot\'s waitlist?', [
          { text: 'Pick another', style: 'cancel' },
          { text: 'Join waitlist', onPress: () => router.push(`/campus-events/register/${ev.id}?slotId=${slot.id}` as any) },
        ]);
      } else if (err?.code === 'ALREADY_REGISTERED' && err.data?.registrationId) {
        Alert.alert(c.title, c.message, [{ text: 'OK', style: 'cancel' }, { text: 'View booking', onPress: () => router.push(`/campus-events/registration/${err.data.registrationId}` as any) }]);
      } else if (err?.code === 'BOOKING_LIMIT') {
        Alert.alert(c.title, c.message, [{ text: 'OK', style: 'cancel' }, { text: 'My bookings', onPress: () => router.push('/campus-events/my?tab=upcoming' as any) }]);
      } else {
        Alert.alert(c.title, err?.isNetwork ? `${c.message}\nTry again: it will not book twice.` : c.message);
      }
      load();
    } finally {
      setBusy(false);
    }
  };

  if (!ev || !data) {
    return (
      <View style={{ flex: 1, backgroundColor: p.bg }}>
        <EHeader title="Book a slot" />
        {error ? <ErrorState error={error} onRetry={load} notFoundTitle="Event not found" onNotFound={() => router.replace(CE_HOME as any)} /> : <StateView kind="loading" message="Loading slots…" />}
      </View>
    );
  }

  const closed = ['CLOSED', 'COMPLETED', 'CANCELLED', 'NOT_OPEN'].includes(ev.registrationState);
  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <EHeader title="Book a slot" subtitle={ev.title} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 200 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={p.accent} />}>
        {closed ? <Notice tone="warn" icon="lock-closed-outline">{ev.cta?.label || 'Booking is not open.'}</Notice> : null}
        <Notice icon="information-circle-outline">You can book up to {data.maxBookingsPerStudent} slot{data.maxBookingsPerStudent === 1 ? '' : 's'} for this activity ({data.myBookings} booked). A picked slot is held for {status?.settings.holdMinutes || 10} minutes while you confirm.</Notice>
        {myHeld ? (
          <Card style={{ borderColor: p.warn }}>
            <Text style={{ fontWeight: '900', color: p.text }}><Ionicons name="hourglass-outline" size={14} color={p.warn} /> You are holding {fmtClock(myHeld.startAt)}–{fmtClock(myHeld.endAt)}</Text>
            <Btn label="Finish this booking" small onPress={() => router.push(`/campus-events/register/${ev.id}?regId=${myHeld.myRegistration!.id}` as any)} style={{ marginTop: 10 }} />
          </Card>
        ) : null}
        {myOpen.filter((x) => x.myRegistration?.status !== 'HELD').map((x) => (
          <Card key={x.id}>
            <Text style={{ fontWeight: '800', color: p.text }}><Ionicons name={REG_STATUS_META[x.myRegistration!.status].icon} size={14} color={p.accent} /> {dayLabel(istYmd(x.startAt))}: {fmtClock(x.startAt)}–{fmtClock(x.endAt)} · {REG_STATUS_META[x.myRegistration!.status].label}</Text>
            <Btn label="View booking" small kind="ghost" onPress={() => router.push(`/campus-events/registration/${x.myRegistration!.id}` as any)} style={{ marginTop: 8, alignSelf: 'flex-start' }} />
          </Card>
        ))}

        {!data.days.length ? (
          <StateView kind="empty" icon="calendar-outline" title="No slots yet" message="The organizer has not opened any slots. Check back later." />
        ) : (
          <>
            <Text style={{ fontSize: 12.5, fontWeight: '800', color: p.sub, letterSpacing: 0.2, marginBottom: 8 }}>1 · Pick a date</Text>
            <DateStrip days={data.days} value={date} onChange={(d) => { setDate(d); setSel(null); }} />
            <Text style={{ fontSize: 12.5, fontWeight: '800', color: p.sub, letterSpacing: 0.2, marginTop: 18, marginBottom: 8 }}>2 · Pick a slot{date ? ` · ${dayLabel(date)}` : ''}</Text>
            <SlotPicker slots={day?.slots || []} selectedId={sel} onSelect={(x) => setSel(x.id)} now={now} allowFull={waitlistOk} />
          </>
        )}
      </ScrollView>

      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16, paddingBottom: 24, backgroundColor: p.bg, borderTopWidth: 1, borderTopColor: p.border }}>
        {slot ? (
          <View style={{ marginBottom: 10 }} accessible accessibilityLabel={`Selected ${dayLabel(date || '')} ${fmtClock(slot.startAt)} to ${fmtClock(slot.endAt)}, ${slot.remaining} left, ${slot.price.isFree ? 'free' : slot.price.label}`}>
            <Row label={`${date ? dayLabel(date) : ''} · ${fmtClock(slot.startAt)}–${fmtClock(slot.endAt)}`} value={slot.price.isFree ? 'Free' : inr(slot.price.total)} strong />
            <Text style={{ fontSize: 12, color: p.sub }}>{slot.remaining} of {slot.capacity} places left{slot.label ? ` · ${slot.label}` : ''}</Text>
          </View>
        ) : (
          <Text style={{ fontSize: 12.5, color: p.sub, marginBottom: 10, textAlign: 'center' }}>{limitReached ? 'You have reached the booking limit for this activity.' : 'Select a slot to continue.'}</Text>
        )}
        {slot && slot.state === 'FULL' ? (
          <Btn label="Join this slot's waitlist" onPress={() => router.push(`/campus-events/register/${ev.id}?slotId=${slot.id}` as any)} disabled={closed || limitReached} />
        ) : (
          <Btn label={slot ? 'Hold this slot' : 'Select a slot'} onPress={hold} loading={busy} disabled={!slot || closed || limitReached || !!myHeld} />
        )}
      </View>
    </View>
  );
}
