// Booking requests (the core of the app): students' requests for the owner's PG with room type, check-in date,
// stay length, note and first name (never a phone number). Accept (optionally into another room with a free
// bed) or decline with a reason the student sees. The student gets a push + in-app notification from the
// server. Tabs: New / Accepted / Closed (declined, cancelled, moved out).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { color, font, radius, space } from '../theme';
import { Badge, Button, Card, Chip, EmptyState, ErrorStrip, Segmented, Sheet, SkeletonCard } from '../ui/kit';
import { Banner, Field, Screen } from '../ui/Screen';
import { ListingSwitcher } from '../ui/ListingSwitcher';
import { useListing } from '../state/ListingProvider';
import { useHome } from '../state/HomeProvider';
import { useToast } from '../ui/Toast';
import { ownerApi } from '../api/ownerApi';
import { ApiError, errorMessage } from '../lib/http';
import { ago, dateLabel, monthsLabel, rupees } from '../lib/format';
import { HOME_POLL_MS, LIMITS } from '../config';
import type { Booking, BookingStatus, Room } from '../types';
import type { ScreenProps } from '../nav';

type Tab = 'Pending' | 'Confirmed' | 'closed';
const QUICK_REASONS = ['No beds free for that date', 'Room type is full', 'Only for girls / boys', 'Check-in date not possible'];
const STATUS: Record<BookingStatus, { text: string; fg: string; bg: string }> = {
  Pending: { text: 'New', fg: color.primaryDark, bg: color.primaryTint },
  Confirmed: { text: 'Accepted', fg: color.ok, bg: color.okTint },
  Rejected: { text: 'Declined', fg: color.alertDark, bg: color.alertTint },
  Cancelled: { text: 'Cancelled by student', fg: color.textMuted, bg: color.surfaceAlt },
  MovedOut: { text: 'Moved out', fg: color.textMuted, bg: color.surfaceAlt },
};

export default function RequestsScreen({ navigation, route }: ScreenProps<'Requests'>) {
  const { current, detail, reload: reloadListing } = useListing();
  const { refresh: refreshHome } = useHome();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>(route.params?.status || 'Pending');
  const [list, setList] = useState<Booking[] | null>(null);
  const [counts, setCounts] = useState({ pending: 0, confirmed: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState<Booking | null>(null);
  const [rejecting, setRejecting] = useState<Booking | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!current) return;
    if (!quiet) setLoading(true);
    try {
      const r = await ownerApi.bookings(tab, current.id);
      setList(r.bookings);
      setCounts(r.counts);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [tab, current]);
  useEffect(() => { setList(null); load(); }, [load]);
  useEffect(() => {
    const t = setInterval(() => load(true), HOME_POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const afterChange = (msg: string) => {
    toast.show(msg, 'success');
    load(true);
    refreshHome();
    reloadListing();
  };

  return (
    <Screen title="Booking requests" subtitle={current?.name} onBack={() => navigation.goBack()} right={<ListingSwitcher />} refreshing={loading && !!list} onRefresh={() => load()}>
      <Segmented<Tab> value={tab} onChange={setTab} options={[
        { key: 'Pending', label: 'New', count: counts.pending },
        { key: 'Confirmed', label: 'Accepted' },
        { key: 'closed', label: 'Closed' },
      ]} />
      {error && !list ? <ErrorStrip text={error} onRetry={() => load()} busy={loading} /> : null}
      {!list && !error ? <><SkeletonCard /><SkeletonCard /></> : null}
      {list && !list.length ? (
        <EmptyState
          icon={tab === 'Pending' ? 'mail-open-outline' : 'file-tray-outline'}
          title={tab === 'Pending' ? 'No new requests' : tab === 'Confirmed' ? 'No accepted requests' : 'Nothing closed yet'}
          body={tab === 'Pending' ? 'When a student asks for a bed, it shows here and your phone rings.' : undefined}
        />
      ) : null}
      {list?.map((b) => (
        <RequestCard key={b.id} b={b} onAccept={() => setAccepting(b)} onReject={() => setRejecting(b)} />
      ))}
      <Text style={[font.small, { color: color.textMuted, textAlign: 'center' }]}>
        Students' phone numbers are never shown. The ZCS housing desk connects you once a bed is accepted.
      </Text>

      <AcceptSheet booking={accepting} rooms={detail?.rooms || []} onClose={() => setAccepting(null)}
        onDone={(msg) => { setAccepting(null); afterChange(msg); }} />
      <RejectSheet booking={rejecting} onClose={() => setRejecting(null)} onDone={(msg) => { setRejecting(null); afterChange(msg); }} />
    </Screen>
  );
}

function RequestCard({ b, onAccept, onReject }: { b: Booking; onAccept: () => void; onReject: () => void }) {
  const s = STATUS[b.status] || STATUS.Cancelled;
  return (
    <Card style={{ gap: space.sm }}>
      <View style={st.top}>
        <View style={st.avatar}><Text style={[font.h3, { color: color.primaryDark }]}>{(b.student.firstName || 'S').slice(0, 1)}</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={[font.h3, { color: color.text }]}>{b.student.firstName}</Text>
          <Text style={[font.small, { color: color.textMuted }]}>#{b.code} · {ago(b.createdAt)}</Text>
        </View>
        <Badge text={s.text} fg={s.fg} bg={s.bg} />
      </View>
      <View style={st.facts}>
        <Fact icon="bed-outline" text={b.room ? `${b.room.label} · Room ${b.room.roomNumber}` : 'Room removed'} />
        {b.room?.pricePerBed ? <Fact icon="pricetag-outline" text={`${rupees(b.room.pricePerBed)} /month`} /> : null}
        <Fact icon="calendar-outline" text={b.checkInDate ? `Check-in ${dateLabel(b.checkInDate)}` : 'Check-in not given'} />
        {b.durationMonths ? <Fact icon="time-outline" text={`Stay ${monthsLabel(b.durationMonths)}`} /> : null}
      </View>
      {b.note ? (
        <View style={st.note}>
          <Ionicons name="chatbubble-ellipses-outline" size={16} color={color.textSecondary} />
          <Text style={[font.body, { color: color.textSecondary, flex: 1 }]}>{b.note}</Text>
        </View>
      ) : null}
      {b.status === 'Rejected' && b.decisionReason ? <Text style={[font.small, { color: color.alertDark }]}>Reason: {b.decisionReason}</Text> : null}
      {b.status === 'Pending' ? (
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Button label="Decline" variant="dangerOutline" size="secondary" onPress={onReject} style={{ flex: 1 }} />
          <Button label="Accept" variant="success" size="secondary" icon="checkmark" onPress={onAccept} style={{ flex: 1.4 }} />
        </View>
      ) : null}
    </Card>
  );
}

function Fact({ icon, text }: { icon: React.ComponentProps<typeof Ionicons>['name']; text: string }) {
  return (
    <View style={st.fact}>
      <Ionicons name={icon} size={15} color={color.primary} />
      <Text style={[font.small, { color: color.textSecondary, fontWeight: '600' }]}>{text}</Text>
    </View>
  );
}

function AcceptSheet({ booking, rooms, onClose, onDone }: { booking: Booking | null; rooms: Room[]; onClose: () => void; onDone: (msg: string) => void }) {
  const [roomId, setRoomId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (booking) { setRoomId(booking.room?.id || null); setError(null); } }, [booking]);
  const choices = useMemo(() => rooms.filter((r) => r.isActive && (r.availableBeds > 0 || r.id === booking?.room?.id)), [rooms, booking]);
  const chosen = rooms.find((r) => r.id === roomId);
  const full = !!chosen && chosen.availableBeds <= 0;
  const submit = async () => {
    if (!booking || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await ownerApi.accept(booking.id, roomId && roomId !== booking.room?.id ? roomId : undefined);
      onDone(r.message);
    } catch (e) {
      setError(e instanceof ApiError && e.code === 'NO_BEDS' ? 'That room has no free bed now. Pick another room, or free a bed in Rooms first.' : errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet visible={!!booking} onClose={onClose} title={booking ? `Accept ${booking.student.firstName}?` : 'Accept'}>
      <View style={{ gap: space.md }}>
        <Text style={[font.body, { color: color.textSecondary }]}>
          One bed is reserved and {booking?.student.firstName || 'the student'} is told right away. Pick the room:
        </Text>
        <View style={{ gap: space.xs }}>
          {choices.map((r) => {
            const on = r.id === roomId;
            return (
              <Pressable key={r.id} onPress={() => setRoomId(r.id)} accessibilityRole="radio" accessibilityState={{ selected: on }}
                style={[st.roomChoice, on && { borderColor: color.primary, backgroundColor: color.primaryTint }]}>
                <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={20} color={on ? color.primary : color.textMuted} />
                <View style={{ flex: 1 }}>
                  <Text style={[font.body, { color: color.text, fontWeight: '700' }]}>Room {r.roomNumber}{r.id === booking?.room?.id ? ' (asked for)' : ''}</Text>
                  <Text style={[font.small, { color: color.textMuted }]}>{r.label} · {r.availableBeds} of {r.totalBeds} free</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
        {full ? <Banner tone="warn" text="This room is full. Pick a room with a free bed." /> : null}
        {error ? <Banner tone="error" text={error} /> : null}
        <Button label="Accept and reserve the bed" variant="success" icon="checkmark-circle-outline" onPress={submit} loading={busy} disabled={!roomId || full} />
      </View>
    </Sheet>
  );
}

function RejectSheet({ booking, onClose, onDone }: { booking: Booking | null; onClose: () => void; onDone: (msg: string) => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (booking) { setReason(''); setError(null); } }, [booking]);
  const ok = reason.trim().length >= LIMITS.REASON_MIN;
  const submit = async () => {
    if (!booking || !ok || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await ownerApi.reject(booking.id, reason.trim());
      onDone(r.message);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet visible={!!booking} onClose={onClose} title={booking ? `Decline ${booking.student.firstName}'s request?` : 'Decline'}>
      <View style={{ gap: space.md }}>
        <Text style={[font.body, { color: color.textSecondary }]}>The student sees your reason and can look at other PGs.</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
          {QUICK_REASONS.map((q) => <Chip key={q} label={q} selected={reason === q} onPress={() => setReason(q)} />)}
        </View>
        <Field label="Reason" value={reason} onChangeText={(v) => setReason(v.slice(0, LIMITS.REASON_MAX))} placeholder="Write a short, polite reason" multiline
          hint="No phone numbers: students reach you through the ZCS housing desk." />
        {error ? <Banner tone="error" text={error} /> : null}
        <Button label="Decline request" variant="danger" onPress={submit} loading={busy} disabled={!ok} />
      </View>
    </Sheet>
  );
}

const st = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: color.primaryTint, alignItems: 'center', justifyContent: 'center' },
  facts: { gap: 6 },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  note: { flexDirection: 'row', gap: space.xs, backgroundColor: color.surfaceAlt, borderRadius: radius.md, padding: space.sm },
  roomChoice: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderWidth: 1.5, borderColor: color.border, borderRadius: radius.md, padding: space.sm },
});
