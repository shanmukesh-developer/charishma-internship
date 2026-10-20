// Zenvy Campus Events: QR ticket (spec §8). Event, ticket ID / code, student or team, date, venue, slot, status,
// QR (opaque signed token, no personal data) and entry instructions. The QR is drawn only for an ACTIVE ticket
// the server returned a token for; used / cancelled / void tickets show why instead. A QR never guarantees
// entry: staff validate it against the server at the gate.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, RefreshControl } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { campusEventsApi, CampusEventsError, fmtRange, fmtClock, fmtWhen, inr, TICKET_STATUS_META, type Ticket } from '../../../modules/campusEvents/campusEventsApi';
import { EHeader, usePalette, Card, Btn, ErrorState, StateView, Notice, Row, Pill } from '../../../modules/campusEvents/ui';
import TicketQR, { groupCode } from '../../../modules/campusEvents/TicketQR';
import { useCampusEventsLive } from '../../../modules/campusEvents/useCampusEventsLive';

export default function TicketScreen() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = String(Array.isArray(params.id) ? params.id[0] : params.id || '');
  const router = useRouter();
  const p = usePalette();
  const [t, setT] = useState<Ticket | null>(null);
  const [error, setError] = useState<CampusEventsError | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await campusEventsApi.ticket(id);
      setT(r.ticket);
      setError(null);
    } catch (e: any) {
      setError(e instanceof CampusEventsError ? e : new CampusEventsError(e?.message || 'Could not load this ticket.'));
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  // Checked in at the gate / cancelled elsewhere -> the QR disappears without a manual refresh.
  useCampusEventsLive((e) => { if (!e.id || e.id === t?.registration?.id || e.id === t?.event?.id || e.kind === 'reconnect') load(); });

  if (!t) {
    return (
      <View style={{ flex: 1, backgroundColor: p.bg }}>
        <EHeader title="Ticket" />
        {error ? (
          error.code === 'TICKETS_NOT_CONFIGURED'
            ? <StateView kind="error" icon="ticket-outline" title="Tickets unavailable" message="Tickets cannot be shown right now. Your registration is safe; please try again later." actionLabel="Retry" onAction={load} />
            : <ErrorState error={error} onRetry={load} notFoundTitle="Ticket not found" notFoundLabel="My tickets" onNotFound={() => router.replace('/campus-events/tickets' as any)} />
        ) : <StateView kind="loading" />}
      </View>
    );
  }

  const m = TICKET_STATUS_META[t.status];
  const ev = t.event;
  const opensAt = ev?.startAt && ev.entryOpensBeforeMin ? new Date(new Date(t.slot?.startAt || ev.startAt).getTime() - ev.entryOpensBeforeMin * 60000).toISOString() : null;

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <EHeader title="Your ticket" subtitle={ev?.title} right={<Pill label={m.label} color={m.color} />} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={p.accent} />}>
        <View style={{ borderRadius: 24, overflow: 'hidden', borderWidth: 1, borderColor: p.border, backgroundColor: p.card, marginBottom: 14 }}>
          <View style={{ padding: 16, backgroundColor: p.accentSoft }}>
            <Text style={{ fontSize: 12, fontWeight: '800', color: p.accent, letterSpacing: 0.3 }}>{t.kind === 'TEAM' ? 'Team ticket' : t.kind === 'SLOT' ? 'Slot ticket' : t.kind === 'MEMBER' ? 'Player ticket' : 'Entry ticket'}</Text>
            <Text style={{ fontSize: 19, fontWeight: '900', color: p.text, marginTop: 4 }}>{ev?.title}</Text>
            <Text style={{ fontSize: 13, color: p.text, marginTop: 4, fontWeight: '700' }}><Ionicons name={t.kind === 'TEAM' ? 'people-outline' : 'person-outline'} size={14} color={p.sub} /> {t.holder}</Text>
          </View>
          <View style={{ padding: 16, alignItems: 'center' }}>
            <TicketQR token={t.qrToken} status={t.status} code={t.ticketCode} />
            <Text style={{ fontSize: 12, fontWeight: '800', color: p.muted, letterSpacing: 0.2, marginTop: 14 }}>Ticket code</Text>
            <Text style={{ fontSize: 24, fontWeight: '900', color: p.text, letterSpacing: 3, marginTop: 2 }} selectable accessibilityLabel={`Ticket code ${t.ticketCode.split('').join(' ')}`}>{groupCode(t.ticketCode)}</Text>
            {t.status === 'ACTIVE' ? <Text style={{ fontSize: 12, color: p.sub, marginTop: 10, textAlign: 'center' }}>Turn your screen brightness up at the gate so the QR scans first time.</Text> : null}
          </View>
          <View style={{ borderTopWidth: 1, borderTopColor: p.border, borderStyle: 'dashed', padding: 16 }}>
            <Row label="When" value={t.slot ? `${fmtWhen(t.slot.startAt)} – ${fmtClock(t.slot.endAt)}` : fmtRange(ev?.startAt, ev?.endAt)} />
            {t.slot?.label ? <Row label="Slot" value={t.slot.label} /> : null}
            {ev?.venue ? <Row label="Venue" value={ev.venue} /> : null}
            {t.registration ? <Row label="Registration code" value={t.registration.code} /> : null}
            {opensAt && t.status === 'ACTIVE' ? <Row label="Entry opens" value={fmtWhen(opensAt)} /> : null}
            {t.usedAt ? <Row label="Checked in" value={fmtWhen(t.usedAt)} /> : null}
          </View>
        </View>

        {t.status === 'ACTIVE' && t.registration?.paymentDue ? <Notice tone="warn" icon="cash-outline">Pay {inr(t.registration.total)} at the venue desk. Staff admit you only after collecting the fee.</Notice> : null}
        {t.status === 'USED' ? <Notice tone="success" icon="checkmark-circle-outline">You already checked in. This ticket cannot be used again.</Notice> : null}
        {t.status === 'CANCELLED' || t.status === 'VOID' ? <Notice tone="danger" icon="ban-outline">This ticket is not valid for entry.</Notice> : null}
        {ev?.instructions ? <Card><Text style={{ fontSize: 13, fontWeight: '900', color: p.text, marginBottom: 4 }}>Entry instructions</Text><Text style={{ color: p.sub, fontSize: 13, lineHeight: 19 }}>{ev.instructions}</Text></Card> : null}
        <Notice icon="information-circle-outline">{t.entryNote ? `${t.entryNote} ` : ''}If your phone has no signal, show the ticket code: staff check it online.</Notice>
        {t.registration ? <Btn label="Registration details" kind="secondary" onPress={() => router.push(`/campus-events/registration/${t.registration!.id}` as any)} /> : null}
      </ScrollView>
    </View>
  );
}
