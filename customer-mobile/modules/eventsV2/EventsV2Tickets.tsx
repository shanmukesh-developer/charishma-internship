/**
 * My tickets (app/campus-events/tickets), night look: ticket-shaped cards (photo stub, perforation notches,
 * event, time, holder, code, status). "All tickets" adds used, cancelled and void ones. Opens the QR ticket.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { campusEventsApi, CampusEventsError, fmtClock, fmtWhen, TICKET_STATUS_META, type Ticket } from '../campusEvents/campusEventsApi';
import { useCampusEventsLive } from '../campusEvents/useCampusEventsLive';
import { NIGHT, W, shadow } from './eventsV2Theme';
import { ChipRow, NightHeader, Press, Tag, FadeInUp } from './EventsV2Kit';
import { EventPhoto } from './EventsV2Media';
import { Notice, StateBlock } from './EventsV2States';
import { ICalendar, IChevronRight, IUser } from './EventsV2Icons';
import { useNav } from './eventsV2Nav';

const statusColor = (t: Ticket) => (t.status === 'ACTIVE' ? NIGHT.green : t.status === 'USED' ? NIGHT.sky : t.status === 'VOID' ? NIGHT.red : '#CFCBEA');

function TicketCard({ t, index }: { t: Ticket; index: number }) {
  const nav = useNav();
  const m = TICKET_STATUS_META[t.status];
  return (
    <FadeInUp index={index} style={{ marginHorizontal: 16, marginBottom: 14 }}>
      <Press onPress={() => nav.push({ name: 'ticket', id: t.id })} label={`${t.event?.title}, ${m.label} ticket, opens the QR`} style={[s.card, shadow(2), t.status !== 'ACTIVE' ? { opacity: 0.78 } : null]} scaleTo={0.98}>
        <LinearGradient colors={['#2A266C', '#1C1A4A']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        <View style={s.stub}><EventPhoto e={{ category: 'OTHER', posterUrl: t.event?.posterUrl || null }} scrim={false} iconSize={44} /></View>
        <View style={s.perf}>{Array.from({ length: 7 }).map((_, i) => <View key={i} style={s.dot} />)}</View>
        <View style={{ flex: 1, paddingVertical: 12, paddingRight: 8, gap: 4 }}>
          <Text style={s.title} numberOfLines={2}>{t.event?.title}</Text>
          <View style={s.row}><ICalendar size={12} color={NIGHT.violet} strokeWidth={1.8} /><Text style={s.rowText} numberOfLines={1}>{t.slot ? `${fmtWhen(t.slot.startAt)} – ${fmtClock(t.slot.endAt)}` : fmtWhen(t.event?.startAt)}</Text></View>
          <View style={s.row}><IUser size={12} color={NIGHT.violet} strokeWidth={1.8} /><Text style={s.rowText} numberOfLines={1}>{t.kind === 'TEAM' ? `Team: ${t.holder}` : t.holder} · {t.ticketCode}</Text></View>
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
            <Tag label={m.label} color={statusColor(t)} />
            {t.registration?.paymentDue && t.status === 'ACTIVE' ? <Tag label="Pay at the venue" color={NIGHT.amber} /> : null}
          </View>
        </View>
        <View style={{ justifyContent: 'center', paddingRight: 10 }}><IChevronRight size={18} color={NIGHT.violet} strokeWidth={1.8} /></View>
        <View style={[s.notch, { top: -11 }]} /><View style={[s.notch, { bottom: -11 }]} />
      </Press>
    </FadeInUp>
  );
}

export default function EventsV2Tickets() {
  const nav = useNav();
  const [all, setAll] = useState<'active' | 'all'>('active');
  const [list, setList] = useState<Ticket[] | null>(null);
  const [ready, setReady] = useState(true);
  const [err, setErr] = useState<CampusEventsError | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    try {
      const r = await campusEventsApi.myTickets(all === 'all');
      setList(r.tickets); setReady(r.ticketsReady); setErr(null);
    } catch (e: any) {
      setErr(e instanceof CampusEventsError ? e : new CampusEventsError(e?.message || 'Could not load tickets.'));
    }
  }, [all]);
  useEffect(() => { setList(null); load(); }, [load]);
  useCampusEventsLive(() => load());
  return (
    <View style={{ flex: 1 }}>
      <NightHeader title="My tickets" sub="Your bookings and entry QR codes" />
      <ChipRow items={[{ key: 'active', label: 'Active' }, { key: 'all', label: 'All tickets' }]} active={all} onSelect={setAll} style={{ paddingBottom: 14 }} />
      {err && !list ? (err.status === 401
        ? <StateBlock kind="signin" title="Sign in to see your tickets" body="Use your student account." action="Sign in" onAction={() => nav.go('/login')} />
        : <StateBlock kind={err.isNetwork ? 'offline' : 'error'} title={err.isNetwork ? undefined : 'Could not load tickets'} action="Retry" onAction={load} />)
        : !list ? <StateBlock kind="loading" /> : (
          <FlatList
            data={list}
            keyExtractor={(t) => t.id}
            contentContainerStyle={{ paddingTop: 4, paddingBottom: 40 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={NIGHT.violet} />}
            ListHeaderComponent={!ready ? <View style={{ paddingHorizontal: 16 }}><Notice tone="warn">Tickets are temporarily unavailable. Your registrations are safe; try again later.</Notice></View> : null}
            ListEmptyComponent={<StateBlock kind="empty" title="No tickets yet" body="Tickets appear here once a registration is confirmed." action="Find events" onAction={() => nav.push({ name: 'explore' })} />}
            renderItem={({ item, index }) => <TicketCard t={item} index={index} />}
          />
        )}
    </View>
  );
}

const s = StyleSheet.create({
  card: { flexDirection: 'row', borderRadius: 20, overflow: 'hidden', minHeight: 118, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.16)' },
  stub: { width: 92, overflow: 'hidden' },
  perf: { width: 16, alignItems: 'center', justifyContent: 'space-evenly', paddingVertical: 10 },
  dot: { width: 3, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.28)' },
  notch: { position: 'absolute', left: 92 + 8 - 11, width: 22, height: 22, borderRadius: 11, backgroundColor: NIGHT.page },
  title: { color: NIGHT.ink, fontSize: 15, fontWeight: W.display, fontStyle: 'italic', lineHeight: 19 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowText: { color: NIGHT.sub, fontSize: 12, flexShrink: 1 },
});
