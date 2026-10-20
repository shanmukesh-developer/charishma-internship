// Zenvy Campus Events: My Tickets. Active + used tickets (GET /my/tickets), team tickets included for accepted
// members; "Show past" adds cancelled / void ones. Opening a ticket shows the QR (active only).
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, RefreshControl, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { campusEventsApi, CampusEventsError, fmtWhen, fmtClock, TICKET_STATUS_META, type Ticket } from '../../modules/campusEvents/campusEventsApi';
import { EHeader, usePalette, Card, ErrorState, StateView, Pill, Toggle, Notice, Poster, CE_HOME } from '../../modules/campusEvents/ui';
import { useCampusEventsLive } from '../../modules/campusEvents/useCampusEventsLive';

export default function TicketsScreen() {
  const router = useRouter();
  const p = usePalette();
  const [all, setAll] = useState(false);
  const [list, setList] = useState<Ticket[] | null>(null);
  const [ready, setReady] = useState(true);
  const [error, setError] = useState<CampusEventsError | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await campusEventsApi.myTickets(all);
      setList(r.tickets);
      setReady(r.ticketsReady);
      setError(null);
    } catch (e: any) {
      setError(e instanceof CampusEventsError ? e : new CampusEventsError(e?.message || 'Could not load tickets.'));
    }
  }, [all]);
  useEffect(() => { setList(null); load(); }, [load]);
  useCampusEventsLive(() => load());

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <EHeader title="My tickets" />
      {error && !list ? <ErrorState error={error} onRetry={load} onNotFound={() => router.replace(CE_HOME as any)} /> : !list ? <StateView kind="loading" /> : (
        <FlatList
          data={list}
          keyExtractor={(t) => t.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={p.accent} />}
          ListHeaderComponent={
            <View>
              {!ready ? <Notice tone="warn" icon="warning-outline">Tickets are temporarily unavailable. Your registrations are safe; try again later.</Notice> : null}
              <Toggle label="Show past and cancelled tickets" value={all} onChange={setAll} />
            </View>
          }
          ListEmptyComponent={<StateView kind="empty" icon="ticket-outline" title="No tickets yet" message="Tickets appear here once a registration is confirmed." actionLabel="Find events" onAction={() => router.push('/campus-events' as any)} />}
          renderItem={({ item }) => {
            const m = TICKET_STATUS_META[item.status];
            return (
              <TouchableOpacity onPress={() => router.push(`/campus-events/ticket/${item.id}` as any)} accessibilityRole="button" accessibilityLabel={`${item.event?.title}, ${m.label} ticket, opens QR`} activeOpacity={0.9}>
                <Card style={{ padding: 0, overflow: 'hidden', opacity: item.status === 'ACTIVE' ? 1 : 0.75 }}>
                  <View style={{ flexDirection: 'row' }}>
                    <View style={{ width: 86 }}><Poster uri={item.event?.posterUrl} category="OTHER" height={104} radius={0} /></View>
                    <View style={{ flex: 1, padding: 12, gap: 3 }}>
                      <Text style={{ fontSize: 14.5, fontWeight: '900', color: p.text }} numberOfLines={2}>{item.event?.title}</Text>
                      <Text style={{ fontSize: 12, color: p.sub }} numberOfLines={1}><Ionicons name="calendar-outline" size={12} color={p.sub} /> {item.slot ? `${fmtWhen(item.slot.startAt)} – ${fmtClock(item.slot.endAt)}` : fmtWhen(item.event?.startAt)}</Text>
                      <Text style={{ fontSize: 11.5, color: p.muted }} numberOfLines={1}>{item.kind === 'TEAM' ? `Team: ${item.holder}` : item.holder} · {item.ticketCode}</Text>
                      <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
                        <Pill label={m.label} color={m.color} />
                        {item.registration?.paymentDue && item.status === 'ACTIVE' ? <Pill label="Pay at venue" color="#D97706" icon="cash-outline" /> : null}
                      </View>
                    </View>
                    <View style={{ justifyContent: 'center', paddingRight: 12 }}><Text style={{ fontSize: 22, color: p.accent }}>›</Text></View>
                  </View>
                </Card>
              </TouchableOpacity>
            );
          }}
        />
      )}
    </View>
  );
}
