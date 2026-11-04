/**
 * Screen 11 · My Bookings: Upcoming (pending, or confirmed with a check-in from today) and Past
 * (cancelled, or confirmed with an earlier check-in). Cards: photo, PG, room type, check-in date,
 * status pill, View Details and Cancel (PUT /api/pg/bookings/:id/cancel, after an inline confirm).
 * The stay end date is not stored yet, so only the check-in date shows.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, useWindowDimensions, RefreshControl } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { PG2, GUTTER, W } from './pgV2Theme';
import { Header, Photo, Pill, Segmented, OutlineButton, EmptyState, Loading, k } from './PgV2Kit';
import { IClock, ICheck, IX, ICalendar, IInbox, STROKE } from './PgV2Icons';
import { buildingPhoto } from './pgV2Photos';
import { useMyBookings, cancelBookingRequest, roomTypeName, dayText } from './pgV2Data';
import { useNav } from './pgV2Nav';
import { useAuth } from '../../context/AuthContext';
import { useUserLiveEvent } from '../../utils/useUserLiveEvent';
import type { MyPgBooking } from '../../modules/pg/pgApi';
import { themedSheet } from '../../utils/themeNow';

const todayYmd = () => new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10);
const isUpcoming = (b: MyPgBooking) => b.status === 'Pending' || (b.status === 'Confirmed' && String(b.checkInDate).slice(0, 10) >= todayYmd());

// Every server status with its own words and tone (a declined request used to look exactly like Pending).
const STATUS = {
  Pending: { ink: PG2.amber, soft: PG2.amberSoft, icon: IClock, label: 'Pending' },
  Confirmed: { ink: PG2.green, soft: PG2.greenSoft, icon: ICheck, label: 'Confirmed' },
  Cancelled: { ink: PG2.red, soft: PG2.redSoft, icon: IX, label: 'Cancelled' },
  Rejected: { ink: PG2.red, soft: PG2.redSoft, icon: IX, label: 'Declined by the PG' },
  MovedOut: { ink: PG2.muted, soft: PG2.lineSoft, icon: ICheck, label: 'Stay ended' },
} as const;

function BookingCard({ b, onView, onCancelled }: { b: MyPgBooking; onView: () => void; onCancelled: () => void }) {
  const { width } = useWindowDimensions();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const photoW = Math.round(Math.min(120, (width - GUTTER * 2) * 0.3));
  const tone = STATUS[b.status] || STATUS.Pending;
  const hostelId = b.hostel?.id || b.hostelId || b.id;
  const canCancel = isUpcoming(b);
  const doCancel = async () => {
    setBusy(true);
    const r = await cancelBookingRequest(b.id);
    setBusy(false);
    if (r.ok) onCancelled(); else { setError(r.message); setConfirming(false); }
  };
  return (
    <View style={[k.card, st.card]}>
      <View style={{ flexDirection: 'row', gap: 14 }}>
        <Photo photo={buildingPhoto({ id: hostelId })} style={{ width: photoW, height: Math.round(photoW * 0.84) }} radius={12} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={st.name} numberOfLines={2}>{b.hostel?.name || 'PG'}</Text>
          {b.room ? <Pill text={roomTypeName(b.room.sharingType)} ink="#B0478A" soft="#FBEFF7" style={{ marginTop: 6 }} /> : null}
          <View style={[k.row, { marginTop: 8, gap: 6 }]}>
            <ICalendar size={13} color={PG2.muted} strokeWidth={STROKE} />
            <Text style={st.date}>Check-in {dayText(b.checkInDate)}</Text>
          </View>
          <Pill icon={tone.icon} text={tone.label} ink={tone.ink} soft={tone.soft} style={{ marginTop: 9, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }} />
        </View>
      </View>
      {(b.status === 'Rejected' || b.status === 'MovedOut') && b.decisionReason ? (
        <Text style={[k.small, { color: PG2.muted, marginTop: 10 }]}>{b.status === 'Rejected' ? 'Reason' : 'Note'} from the PG: {b.decisionReason}</Text>
      ) : null}
      {error ? <Text style={[k.small, { color: PG2.red, marginTop: 10 }]}>{error}</Text> : null}
      {confirming ? (
        <View style={st.confirm}>
          <Text style={[k.body, { flex: 1 }]}>Cancel this booking request?</Text>
          <OutlineButton label="Keep" onPress={() => setConfirming(false)} style={st.smallBtn} />
          <OutlineButton label={busy ? 'Cancelling…' : 'Yes, cancel'} onPress={doCancel} color={PG2.red} border={PG2.redLine} style={st.smallBtn} />
        </View>
      ) : (
        <View style={st.actions}>
          <OutlineButton label="View Details" onPress={onView} style={{ flex: 1, height: 46 }} />
          {canCancel ? <OutlineButton label="Cancel" onPress={() => setConfirming(true)} color={PG2.red} border={PG2.redLine} style={{ flex: 1, height: 46 }} /> : null}
        </View>
      )}
    </View>
  );
}

export default function PgV2MyBookings() {
  const nav = useNav();
  const router = useRouter();
  const { user } = useAuth() as any;
  const { items, state, reload } = useMyBookings(!!user);
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
  // A PG decision made while this screen sat in the background shows when the student comes back to it.
  useFocusEffect(useCallback(() => { void reload(); }, [reload]));
  // ...and one made while it is open shows at once (server: pg:changed to this student's sockets).
  useUserLiveEvent('pg:changed', () => { void reload(); }, !!user);
  const shown = useMemo(() => items.filter((b) => (tab === 'upcoming' ? isUpcoming(b) : !isUpcoming(b))), [items, tab]);

  return (
    <View style={{ flex: 1, backgroundColor: PG2.page }}>
      <Header title="My Bookings" onBack={nav.back} />
      {!user ? (
        <EmptyState icon={IInbox} title="Sign in to see your bookings" body="Your PG booking requests show up here." action="Sign in" onAction={() => router.push('/login' as any)} />
      ) : (
        <>
          <View style={{ paddingHorizontal: GUTTER, paddingTop: 4 }}>
            <Segmented variant="underline" value={tab} onChange={setTab} options={[{ key: 'upcoming', label: 'Upcoming' }, { key: 'past', label: 'Past' }]} />
          </View>
          <ScrollView contentContainerStyle={{ padding: GUTTER, gap: 14, paddingBottom: 40 }}
            refreshControl={<RefreshControl refreshing={state === 'loading' && items.length > 0} onRefresh={reload} tintColor={PG2.primary} colors={[PG2.primary]} />}>
            {state === 'loading' && !items.length ? <Loading /> : null}
            {state === 'error' ? <EmptyState icon={IInbox} title="Couldn't load your bookings" body="Check your internet and try again." action="Try again" onAction={reload} /> : null}
            {state === 'ready' && !shown.length ? (
              <EmptyState icon={IInbox} title={tab === 'upcoming' ? 'No upcoming bookings' : 'No past bookings'} body={tab === 'upcoming' ? 'Requests you send to a PG appear here.' : 'Cancelled and earlier stays appear here.'}
                action={tab === 'upcoming' ? 'Browse PGs' : undefined} onAction={() => nav.push({ name: 'list' })} />
            ) : null}
            {shown.map((b) => (
              <BookingCard key={b.id} b={b} onCancelled={reload} onView={() => nav.push({ name: 'overview', pgId: b.hostel?.id || b.hostelId })} />
            ))}
          </ScrollView>
        </>
      )}
    </View>
  );
}

const st = themedSheet(() => ({
  card: { padding: 14 },
  name: { fontSize: 15, fontWeight: W.title, color: PG2.ink },
  date: { fontSize: 12.5, color: PG2.muted },
  actions: { flexDirection: 'row', gap: 12, marginTop: 14 },
  confirm: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 },
  smallBtn: { height: 40, paddingHorizontal: 12 },
}));
