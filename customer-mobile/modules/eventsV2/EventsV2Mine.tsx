/**
 * My registrations (app/campus-events/my?tab), night look. Tabs Upcoming / Pending / Waitlisted / Completed /
 * Cancelled from GET /my/registrations?tab=. Each card: photo, title, date, venue, code, type, team, payment,
 * status and the actions that apply. Only the student's own real registrations (never samples).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { campusEventsApi, CampusEventsError, fmtWhen, inr, PAYMENT_STATUS_LABEL, REG_STATUS_META, type MyTab, type Registration } from '../campusEvents/campusEventsApi';
import { useCampusEventsStatus } from '../campusEvents/ui';
import { useCampusEventsLive } from '../campusEvents/useCampusEventsLive';
import { NIGHT, W } from './eventsV2Theme';
import { ChipRow, Glass, HeaderIcon, NightHeader, Press, Tag } from './EventsV2Kit';
import { EventPhoto } from './EventsV2Media';
import { StateBlock } from './EventsV2States';
import { ICalendar, IPin, ITicket } from './EventsV2Icons';
import { useNav } from './eventsV2Nav';

const TABS: { key: MyTab; label: string; empty: string }[] = [
  { key: 'upcoming', label: 'Upcoming', empty: 'Confirmed registrations for upcoming events show here.' },
  { key: 'pending', label: 'Pending', empty: 'Held slots, approvals and payments in progress show here.' },
  { key: 'waitlisted', label: 'Waitlisted', empty: 'Waitlist places show here. You are moved in automatically when a place opens.' },
  { key: 'completed', label: 'Completed', empty: 'Events you attended show here.' },
  { key: 'cancelled', label: 'Cancelled', empty: 'Cancelled, expired and rejected registrations show here.' },
];

function Btn({ label, onPress, solid }: { label: string; onPress: () => void; solid?: boolean }) {
  return (
    <Press onPress={onPress} label={label} style={[s.btn, solid ? s.btnSolid : null]} scaleTo={0.95}>
      <Text style={[s.btnText, solid ? { color: '#FFFFFF' } : null]}>{label}</Text>
    </Press>
  );
}

function RegCard({ r, index }: { r: Registration; index: number }) {
  const nav = useNav();
  const status = useCampusEventsStatus();
  const canPayOnline = r.status === 'PENDING_PAYMENT' && r.payment?.mode === 'ONLINE' && !!status?.onlinePayEnabled;
  const ticket = r.tickets.find((t) => t.status === 'ACTIVE');
  const details = () => nav.go(`/campus-events/registration/${r.id}`);
  const type = r.type === 'TEAM' ? 'Team' : r.type === 'SLOT' ? 'Slot booking' : 'Individual';
  const m = REG_STATUS_META[r.status];
  const good = r.status === 'CONFIRMED';
  return (
    <Glass index={index} style={{ marginHorizontal: 16, marginBottom: 12 }}>
      <Press onPress={details} label={`${r.event?.title || 'Event'}, ${m.label}, code ${r.code}`} hint="Opens registration details" style={{ flexDirection: 'row', padding: 10 }} scaleTo={0.99}>
        <View style={s.thumb}><EventPhoto e={{ category: 'OTHER', posterUrl: r.event?.posterUrl || null }} scrim={false} iconSize={44} /></View>
        <View style={{ flex: 1, marginLeft: 12, gap: 4 }}>
          <Text style={s.title} numberOfLines={2}>{r.event?.title || 'Event'}</Text>
          <View style={s.row}><ICalendar size={12} color={NIGHT.violet} strokeWidth={1.8} /><Text style={s.rowText} numberOfLines={1}>{fmtWhen(r.slot?.startAt || r.event?.startAt)}</Text></View>
          {r.event?.venue ? <View style={s.row}><IPin size={12} color={NIGHT.violet} strokeWidth={1.8} /><Text style={s.rowText} numberOfLines={1}>{r.event.venue}</Text></View> : null}
          <Text style={s.code} numberOfLines={1}>{r.code} · {type}{r.team ? ` · ${r.team.name}${r.team.isCaptain ? ' (captain)' : ''}` : ''}</Text>
        </View>
      </Press>
      <View style={{ paddingHorizontal: 12, paddingBottom: 12 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          <Tag label={m.label} color={good ? NIGHT.green : r.status === 'REJECTED' ? NIGHT.red : r.status === 'CANCELLED' || r.status === 'EXPIRED' ? '#CFCBEA' : NIGHT.amber} />
          {r.payment && r.payment.status !== 'NONE' ? <Tag label={`${inr(r.payment.total)} · ${PAYMENT_STATUS_LABEL[r.payment.status]}`} color={['DUE_AT_VENUE', 'PENDING', 'REFUND_PENDING'].includes(r.payment.status) ? NIGHT.amber : r.payment.status === 'FAILED' ? NIGHT.red : NIGHT.green} /> : null}
          {ticket ? <Tag label="Ticket ready" color={NIGHT.violet} /> : r.ticketStatus === 'USED' ? <Tag label="Checked in" color={NIGHT.sky} /> : null}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
          {ticket ? <Btn solid label="View ticket" onPress={() => nav.push({ name: 'ticket', id: ticket.id })} /> : null}
          {r.team ? <Btn label={r.team.isCaptain ? 'Manage team' : 'View team'} onPress={() => nav.go(`/campus-events/team/${r.team!.id}`)} /> : null}
          {r.status === 'HELD' && r.event ? <Btn solid label="Confirm booking" onPress={() => nav.push({ name: 'register', id: r.event!.id, regId: r.id })} /> : null}
          {r.status === 'OFFERED' ? <Btn solid label="Claim your place" onPress={details} /> : canPayOnline ? <Btn solid label="Complete payment" onPress={details} /> : null}
          <Btn label="Details" onPress={details} />
        </View>
      </View>
    </Glass>
  );
}

export default function EventsV2Mine() {
  const p = useLocalSearchParams<{ tab?: string }>();
  const nav = useNav();
  const [tab, setTab] = useState<MyTab>(TABS.some((t) => t.key === p.tab) ? (p.tab as MyTab) : 'upcoming');
  const [lists, setLists] = useState<Partial<Record<MyTab, Registration[]>>>({});
  const [err, setErr] = useState<CampusEventsError | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async (which: MyTab) => {
    try {
      const r = await campusEventsApi.myRegistrations(which);
      setLists((cur) => ({ ...cur, [which]: r.registrations })); setErr(null);
    } catch (e: any) {
      setErr(e instanceof CampusEventsError ? e : new CampusEventsError(e?.message || 'Could not load registrations.'));
    }
  }, []);
  useEffect(() => { load(tab); }, [tab, load]);
  useCampusEventsLive(() => load(tab));
  const list = lists[tab];
  const meta = TABS.find((t) => t.key === tab)!;
  return (
    <View style={{ flex: 1 }}>
      <NightHeader title="My registrations" sub="View and manage your events" right={<HeaderIcon onPress={() => nav.push({ name: 'tickets' })} label="My tickets"><ITicket size={18} color="#FFFFFF" strokeWidth={1.8} /></HeaderIcon>} />
      <ChipRow items={TABS} active={tab} onSelect={setTab} style={{ paddingBottom: 14 }} />
      {err && !list ? (err.status === 401
        ? <StateBlock kind="signin" title="Sign in to see your registrations" body="Use your student account." action="Sign in" onAction={() => nav.go('/login')} />
        : <StateBlock kind={err.isNetwork ? 'offline' : 'error'} action="Retry" onAction={() => load(tab)} />)
        : !list ? <StateBlock kind="loading" /> : (
          <FlatList
            data={list}
            keyExtractor={(r) => r.id}
            contentContainerStyle={{ paddingBottom: 40 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(tab); setRefreshing(false); }} tintColor={NIGHT.violet} />}
            ListEmptyComponent={<StateBlock kind="empty" title={`No ${meta.label.toLowerCase()} registrations`} body={meta.empty} action="Find events" onAction={() => nav.push({ name: 'explore' })} />}
            renderItem={({ item, index }) => <RegCard r={item} index={index} />}
          />
        )}
    </View>
  );
}

const s = StyleSheet.create({
  thumb: { width: 84, height: 96, borderRadius: 14, overflow: 'hidden' },
  title: { color: NIGHT.ink, fontSize: 15, fontWeight: W.display, fontStyle: 'italic', lineHeight: 19 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowText: { color: NIGHT.sub, fontSize: 12, flexShrink: 1 },
  code: { color: NIGHT.faint, fontSize: 11.5 },
  btn: { height: 36, paddingHorizontal: 14, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: NIGHT.glass, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.25)' },
  btnSolid: { backgroundColor: NIGHT.violetDeep, borderColor: NIGHT.violet },
  btnText: { color: '#E4DBFF', fontSize: 12.5, fontWeight: W.label },
});
