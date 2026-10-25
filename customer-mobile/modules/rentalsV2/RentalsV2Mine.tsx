/**
 * Rentals v2 · My rentals: one place for the student's rentals.
 *   Renting      vehicles I rent or borrow      GET /api/rentals/bookings?role=renter&scope=open|past
 *   My vehicles  requests for my vehicles        GET /api/rentals/bookings?role=owner&scope=open|past
 *   Rooms        PG stay requests                GET /api/pg/bookings/mine
 * A vehicle booking opens its full flow (PIN, condition photos, charges) at /rentals/booking/:id;
 * a room request opens PG v2's My bookings. Live updates through the rentals socket.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useAuth } from '../../context/AuthContext';
import { rentalsApi, type Booking, BOOKING_STATUS_META, fmtDateTime, inr, wordsOf, bookingStatusLabel } from '../rentals/rentalsApi';
import { useRentalLive } from '../rentals/ui';
import { useMyBookings, dayText } from '../pgV2/pgV2Data';
import { roomTypeName } from '../pgV2/pgV2Data';
import { DAY, PLATE, W, shadow } from './rentalsV2Theme';
import { ChipRow, DayHeader, FadeInUp, Press, StateBlock } from './RentalsV2Kit';
import { IBed, IBike, ICar, IChevronRight } from './RentalsV2Icons';
import { useNav } from './rentalsV2Nav';

type Tab = 'renter' | 'owner' | 'rooms';

function VehicleRow({ b }: { b: Booking }) {
  const router = useRouter();
  const meta = BOOKING_STATUS_META[b.status] || BOOKING_STATUS_META.REQUESTED;
  const words = wordsOf(b);
  const Icon = b.vehicleType === 'CAR' ? ICar : IBike;
  const plate = PLATE[b.vehicleType === 'CAR' ? 'car' : 'bike'];
  return (
    <Press onPress={() => router.push(`/rentals/booking/${b.id}` as any)} label={`${b.vehicleTitle}, ${bookingStatusLabel(b.status, b)}`} style={[m.row, shadow(1)]}>
      {b.vehiclePhoto ? <Image source={{ uri: b.vehiclePhoto }} style={m.thumb} contentFit="cover" /> : (
        <View style={[m.thumb, { backgroundColor: plate.bg[1], alignItems: 'center', justifyContent: 'center' }]}><Icon size={30} color={plate.ink} strokeWidth={1.4} /></View>
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={m.title} numberOfLines={1}>{b.vehicleTitle}</Text>
        <Text style={m.sub} numberOfLines={1}>{fmtDateTime(b.startAt)}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
          <View style={[m.badge, { backgroundColor: meta.color + '1F' }]}><Text style={[m.badgeText, { color: meta.color }]}>{bookingStatusLabel(b.status, b)}</Text></View>
          <Text style={m.price}>{inr(b.finalAmount ?? b.rentAmount)}</Text>
        </View>
        <Text style={[m.sub, { marginTop: 4 }]} numberOfLines={1}>{words.badge}{b.counterpart?.name ? ` · ${b.role === 'OWNER' ? words.Taker : words.Giver} ${b.counterpart.name}` : ''}</Text>
      </View>
      <IChevronRight size={18} color={DAY.muted} strokeWidth={1.7} />
    </Press>
  );
}

export default function RentalsV2Mine() {
  const nav = useNav();
  const router = useRouter();
  const { user } = useAuth();
  const startRole = nav.route.name === 'mine' && nav.route.role === 'owner' ? 'owner' : 'renter';
  const [tab, setTab] = useState<Tab>(startRole);
  const [scope, setScope] = useState<'open' | 'past'>('open');
  const [items, setItems] = useState<Booking[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const pg = useMyBookings(!!user && tab === 'rooms');
  const req = useRef(0);

  const load = useCallback(async () => {
    if (!user || tab === 'rooms') return;
    const my = ++req.current;
    try {
      const r = await rentalsApi.bookings(tab, scope);
      if (my !== req.current) return;
      setItems(Array.isArray(r?.bookings) ? r.bookings : []);
      setError(null);
    } catch (e: any) {
      if (my === req.current) setError(e?.code === 'NETWORK' ? 'offline' : 'error');
    }
  }, [tab, scope, user]);
  useEffect(() => { setItems(null); setError(null); load(); }, [load]);
  useRentalLive(() => load(), !!user);
  const onRefresh = async () => { setRefreshing(true); try { await (tab === 'rooms' ? pg.reload() : load()); } finally { setRefreshing(false); } };

  if (!user) {
    return (
      <View style={{ flex: 1, backgroundColor: DAY.page }}>
        <DayHeader title="My rentals" />
        <StateBlock kind="empty" title="Sign in to see your rentals" body="Your vehicle trips and room requests show up here." action="Sign in" onAction={() => router.push('/login' as any)} style={{ marginTop: 24 }} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: DAY.page }}>
      <DayHeader title="My rentals" />
      <ChipRow items={[{ key: 'renter', label: 'Renting' }, { key: 'owner', label: 'My vehicles' }, { key: 'rooms', label: 'Rooms' }]} active={tab} onSelect={(k) => setTab(k as Tab)} style={{ paddingBottom: 10 }} />
      {tab !== 'rooms' ? (
        <View style={m.scope}>
          {(['open', 'past'] as const).map((s) => (
            <Press key={s} onPress={() => setScope(s)} label={s === 'open' ? 'Upcoming' : 'Past'} style={[m.scopeItem, scope === s ? m.scopeOn : null]}>
              <Text style={[m.scopeText, scope === s ? { color: DAY.accent } : null]}>{s === 'open' ? 'Upcoming' : 'Past'}</Text>
            </Press>
          ))}
        </View>
      ) : null}
      <ScrollView contentContainerStyle={{ paddingBottom: 40, paddingTop: 6, gap: 12 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={DAY.accent} colors={[DAY.accent]} />}>
        {tab === 'rooms' ? (
          pg.state === 'loading' ? <StateBlock kind="loading" />
            : pg.state === 'error' ? <StateBlock kind="error" action="Try again" onAction={pg.reload} />
              : !pg.items.length ? <StateBlock kind="empty" title="No room requests yet" body="Find a single or shared room near campus and send a request. No payment in the app." action="Browse rooms" onAction={() => nav.push({ name: 'list', category: 'room' })} />
                : pg.items.map((bk, i) => (
                  <FadeInUp key={bk.id} index={i}>
                    <Press onPress={() => router.push('/pg/bookings' as any)} label={`${bk.hostel?.name || 'PG stay'}, ${bk.status}`} style={[m.row, shadow(1)]}>
                      <View style={[m.thumb, { backgroundColor: PLATE.room.bg[1], alignItems: 'center', justifyContent: 'center' }]}><IBed size={30} color={PLATE.room.ink} strokeWidth={1.4} /></View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={m.title} numberOfLines={1}>{bk.hostel?.name || 'PG stay'}</Text>
                        <Text style={m.sub} numberOfLines={1}>{bk.room ? `${roomTypeName(bk.room.sharingType)} · ${inr(bk.room.pricePerBed)}/month` : 'Room request'}</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
                          <View style={[m.badge, { backgroundColor: bk.status === 'Confirmed' ? DAY.greenSoft : bk.status === 'Cancelled' ? DAY.lineSoft : DAY.amberSoft }]}>
                            <Text style={[m.badgeText, { color: bk.status === 'Confirmed' ? DAY.green : bk.status === 'Cancelled' ? DAY.muted : DAY.amber }]}>{bk.status === 'Pending' ? 'Waiting for the housing team' : bk.status}</Text>
                          </View>
                          <Text style={m.sub}>Move in {dayText(bk.checkInDate)}</Text>
                        </View>
                      </View>
                      <IChevronRight size={18} color={DAY.muted} strokeWidth={1.7} />
                    </Press>
                  </FadeInUp>
                ))
        ) : items === null && !error ? <StateBlock kind="loading" />
          : error && !items ? <StateBlock kind={error === 'offline' ? 'offline' : 'error'} action="Try again" onAction={load} />
            : !(items || []).length ? (
              <StateBlock kind="empty"
                title={tab === 'owner' ? (scope === 'open' ? 'No requests for your vehicles' : 'No past trips on your vehicles') : (scope === 'open' ? 'No upcoming rentals' : 'No past rentals')}
                body={tab === 'owner' ? 'List your bike or car and classmates can request it.' : 'Pick a bike or car near campus and send a request. You pay at pickup.'}
                action={tab === 'owner' ? 'My vehicles' : 'Find a ride'} onAction={() => (tab === 'owner' ? router.push('/rentals/my-listings' as any) : nav.push({ name: 'list', category: 'bike' }))} />
            ) : (items || []).map((b, i) => <FadeInUp key={b.id} index={i}><VehicleRow b={b} /></FadeInUp>)}
      </ScrollView>
    </View>
  );
}

const m = StyleSheet.create({
  scope: { flexDirection: 'row', marginHorizontal: 16, marginBottom: 6, padding: 4, borderRadius: 12, backgroundColor: DAY.lineSoft, gap: 4 },
  scopeItem: { flex: 1, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  scopeOn: { backgroundColor: '#FFFFFF', ...shadow(1) },
  scopeText: { fontSize: 13, color: DAY.ink2, fontWeight: W.label },
  row: { marginHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 18, backgroundColor: '#FFFFFF' },
  thumb: { width: 84, height: 74, borderRadius: 14 },
  title: { fontSize: 14.5, fontWeight: W.title, color: DAY.ink },
  sub: { fontSize: 12, color: DAY.muted, marginTop: 2 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 7, flexShrink: 1 },
  badgeText: { fontSize: 11.5, fontWeight: W.label },
  price: { fontSize: 13, color: DAY.accent, fontWeight: W.title },
});
