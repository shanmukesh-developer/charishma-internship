// Zenvy Campus Events: My Registrations (spec §7). Tabs Upcoming / Pending / Waitlisted / Completed / Cancelled
// from GET /my/registrations?tab=. Each row: poster, name, date + venue, registration code, type, team, amount +
// payment status (registrant only), registration status, ticket status, and the actions that apply.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, RefreshControl, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { campusEventsApi, CampusEventsError, fmtWhen, inr, PAYMENT_STATUS_LABEL, type MyTab, type Registration } from '../../modules/campusEvents/campusEventsApi';
import { EHeader, usePalette, Card, Btn, Chips, ErrorState, StateView, Pill, RegStatusPill, Poster, CE_HOME, useCampusEventsStatus } from '../../modules/campusEvents/ui';
import { useCampusEventsLive } from '../../modules/campusEvents/useCampusEventsLive';

const TABS: { key: MyTab; label: string; empty: string }[] = [
  { key: 'upcoming', label: 'Upcoming', empty: 'Confirmed registrations for upcoming events show here.' },
  { key: 'pending', label: 'Pending', empty: 'Held slots, approvals and payments in progress show here.' },
  { key: 'waitlisted', label: 'Waitlisted', empty: 'Waitlist places show here. You are moved in automatically when a place opens.' },
  { key: 'completed', label: 'Completed', empty: 'Events you attended show here.' },
  { key: 'cancelled', label: 'Cancelled', empty: 'Cancelled, expired and rejected registrations show here.' },
];

export default function MyRegistrations() {
  const params = useLocalSearchParams<{ tab?: string }>();
  const router = useRouter();
  const p = usePalette();
  const [tab, setTab] = useState<MyTab>(TABS.some((t) => t.key === params.tab) ? (params.tab as MyTab) : 'upcoming');
  const [lists, setLists] = useState<Partial<Record<MyTab, Registration[]>>>({});
  const [error, setError] = useState<CampusEventsError | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (which: MyTab = tab) => {
    try {
      const r = await campusEventsApi.myRegistrations(which);
      setLists((cur) => ({ ...cur, [which]: r.registrations }));
      setError(null);
    } catch (e: any) {
      setError(e instanceof CampusEventsError ? e : new CampusEventsError(e?.message || 'Could not load registrations.'));
    }
  }, [tab]);
  useEffect(() => { load(tab); }, [tab, load]);
  useCampusEventsLive(() => load(tab));

  const list = lists[tab];
  const meta = TABS.find((t) => t.key === tab)!;

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <EHeader title="My registrations" right={
        <TouchableOpacity onPress={() => router.push('/campus-events/tickets' as any)} accessibilityRole="button" accessibilityLabel="My tickets" style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="ticket-outline" size={22} color={p.text} />
        </TouchableOpacity>
      } />
      <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
        <Chips<MyTab> wrap={false} value={tab} onChange={setTab} accessibilityLabel="Registration status" options={TABS.map((t) => ({ key: t.key, label: t.label }))} />
      </View>
      {error && !list ? <ErrorState error={error} onRetry={() => load(tab)} onNotFound={() => router.replace(CE_HOME as any)} /> : !list ? <StateView kind="loading" /> : (
        <FlatList
          data={list}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(tab); setRefreshing(false); }} tintColor={p.accent} />}
          ListEmptyComponent={<StateView kind="empty" icon="receipt-outline" title={`No ${meta.label.toLowerCase()} registrations`} message={meta.empty} actionLabel={tab === 'upcoming' ? 'Find events' : undefined} onAction={() => router.push('/campus-events' as any)} />}
          renderItem={({ item }) => <RegRow r={item} />}
        />
      )}
    </View>
  );
}

function RegRow({ r }: { r: Registration }) {
  const p = usePalette();
  const router = useRouter();
  const status = useCampusEventsStatus();
  // Online pay (Razorpay) shows only while the server switch is on; it is off in production for now.
  const canPayOnline = r.status === 'PENDING_PAYMENT' && r.payment?.mode === 'ONLINE' && !!status?.onlinePayEnabled;
  const ticket = r.tickets.find((t) => t.status === 'ACTIVE');
  const go = () => router.push(`/campus-events/registration/${r.id}` as any);
  const typeLabel = r.type === 'TEAM' ? 'Team' : r.type === 'SLOT' ? 'Slot booking' : 'Individual';
  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      <TouchableOpacity onPress={go} accessibilityRole="button" accessibilityLabel={`${r.event?.title}, ${r.code}, opens details`} activeOpacity={0.9}>
        <View style={{ flexDirection: 'row' }}>
          <View style={{ width: 92 }}>
            <Poster uri={r.event?.posterUrl} category="OTHER" height={118} radius={0} />
          </View>
          <View style={{ flex: 1, padding: 12, gap: 3 }}>
            <Text style={{ fontSize: 14.5, fontWeight: '900', color: p.text }} numberOfLines={2}>{r.event?.title || 'Event'}</Text>
            <Text style={{ fontSize: 12, color: p.sub }} numberOfLines={1}><Ionicons name="calendar-outline" size={12} color={p.sub} /> {fmtWhen(r.slot?.startAt || r.event?.startAt)}</Text>
            {r.event?.venue ? <Text style={{ fontSize: 12, color: p.sub }} numberOfLines={1}><Ionicons name="location-outline" size={12} color={p.sub} /> {r.event.venue}</Text> : null}
            <Text style={{ fontSize: 11.5, color: p.muted }} numberOfLines={1}>{r.code} · {typeLabel}{r.team ? ` · Team: ${r.team.name}${r.team.isCaptain ? ' (captain)' : ''}` : ''}</Text>
          </View>
        </View>
      </TouchableOpacity>
      <View style={{ paddingHorizontal: 12, paddingBottom: 12 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          <RegStatusPill status={r.status} />
          {r.payment && r.payment.status !== 'NONE' ? <Pill label={`${inr(r.payment.total)} · ${PAYMENT_STATUS_LABEL[r.payment.status]}`} color={['DUE_AT_VENUE', 'PENDING', 'REFUND_PENDING'].includes(r.payment.status) ? '#D97706' : r.payment.status === 'FAILED' ? '#DC2626' : '#059669'} /> : null}
          {ticket ? <Pill label="Ticket ready" color="#7C3AED" icon="ticket-outline" /> : r.ticketStatus === 'USED' ? <Pill label="Checked in" color="#2563EB" icon="checkmark" /> : null}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
          {ticket ? <Btn label="View ticket" small icon="ticket-outline" onPress={() => router.push(`/campus-events/ticket/${ticket.id}` as any)} /> : null}
          {r.team ? <Btn label={r.team.isCaptain ? 'Manage team' : 'View team'} small kind="secondary" onPress={() => router.push(`/campus-events/team/${r.team!.id}` as any)} /> : null}
          {r.status === 'HELD' && r.event ? <Btn label="Confirm booking" small onPress={() => router.push(`/campus-events/register/${r.event!.id}?regId=${r.id}` as any)} /> : null}
          {r.status === 'OFFERED' ? <Btn label="Claim your place" small onPress={go} /> : canPayOnline ? <Btn label="Complete payment" small onPress={go} /> : null}
          <Btn label="Details" small kind="ghost" onPress={go} />
        </View>
      </View>
    </Card>
  );
}
