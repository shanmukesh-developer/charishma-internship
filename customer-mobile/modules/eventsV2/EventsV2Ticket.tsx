/**
 * QR ticket (app/campus-events/ticket/:id), night look: a glossy ticket with the event photo band, the QR
 * (TicketQR: opaque signed token, black on white, only for an ACTIVE ticket), the grouped code, a perforated
 * divider and the entry details. A QR never guarantees entry: staff validate it against the server at the gate.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams } from 'expo-router';
import { campusEventsApi, CampusEventsError, fmtClock, fmtRange, fmtWhen, inr, TICKET_STATUS_META, type Ticket } from '../campusEvents/campusEventsApi';
import TicketQR, { groupCode } from '../campusEvents/TicketQR';
import { useCampusEventsLive } from '../campusEvents/useCampusEventsLive';
import { NIGHT, W, shadow } from './eventsV2Theme';
import { CTA, NightHeader, SampleTag, Tag, usePageW } from './EventsV2Kit';
import { EventPhoto } from './EventsV2Media';
import { Notice, StateBlock } from './EventsV2States';
import { Sparkle } from './EventsV2Decor';
import { useNav } from './eventsV2Nav';
import { demoEvent, demoEvents, isSampleId } from './eventsV2Demo';

function devSampleTicket(id: string): Ticket | null {
  const ev = demoEvent(id) || demoEvents()[0];
  if (!ev) return null;
  return {
    id, kind: 'INDIVIDUAL', status: 'ACTIVE', ticketCode: 'SAMPLE00TICKET', qrToken: 'SAMPLE-TICKET-NOT-VALID-FOR-ENTRY', holder: 'Sample student',
    event: { id: ev.id, title: ev.title, startAt: ev.startAt, endAt: ev.endAt, venue: ev.venue, posterUrl: null, instructions: ev.instructions, entryOpensBeforeMin: 30 },
    slot: null, registration: { id: 'sample-registration', code: 'SAMPLE01', status: 'CONFIRMED', paymentDue: false, total: 0 }, team: null, usedAt: null,
    entryNote: 'Sample ticket: not valid for entry.',
  };
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.kv}><Text style={s.kvLabel}>{label}</Text><Text style={s.kvValue}>{value}</Text></View>
  );
}

export default function EventsV2Ticket() {
  const p = useLocalSearchParams<{ id: string | string[] }>();
  const id = String(Array.isArray(p.id) ? p.id[0] : p.id || '');
  const nav = useNav();
  const w = usePageW();
  const [t, setT] = useState<Ticket | null>(null);
  const [err, setErr] = useState<CampusEventsError | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    // Development only: /campus-events/ticket/sample-<event> draws a labelled sample ticket (screenshots, QA).
    if (__DEV__ && isSampleId(id)) { setT(devSampleTicket(id)); return; }
    try { const r = await campusEventsApi.ticket(id); setT(r.ticket); setErr(null); } catch (e: any) {
      setErr(e instanceof CampusEventsError ? e : new CampusEventsError(e?.message || 'Could not load this ticket.'));
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useCampusEventsLive((e) => { if (!e.id || e.id === t?.registration?.id || e.id === t?.event?.id || e.kind === 'reconnect') load(); });

  if (!t) {
    return (
      <View style={{ flex: 1 }}>
        <NightHeader title="Ticket" />
        {!err ? <StateBlock kind="loading" />
          : err.code === 'TICKETS_NOT_CONFIGURED' ? <StateBlock kind="error" title="Tickets unavailable" body="Tickets cannot be shown right now. Your registration is safe; please try again later." action="Retry" onAction={load} />
            : err.status === 404 ? <StateBlock kind="empty" title="Ticket not found" action="My tickets" onAction={() => nav.replace({ name: 'tickets' })} />
              : err.status === 401 ? <StateBlock kind="signin" title="Sign in to see this ticket" action="Sign in" onAction={() => nav.go('/login')} />
                : <StateBlock kind={err.isNetwork ? 'offline' : 'error'} title={err.isNetwork ? undefined : 'Could not load the ticket'} action="Retry" onAction={load} />}
      </View>
    );
  }
  const m = TICKET_STATUS_META[t.status];
  const ev = t.event;
  const opensAt = ev?.startAt && ev.entryOpensBeforeMin ? new Date(new Date(t.slot?.startAt || ev.startAt).getTime() - ev.entryOpensBeforeMin * 60000).toISOString() : null;
  const qr = Math.min(220, w - 120);
  return (
    <View style={{ flex: 1 }}>
      <NightHeader title="Your ticket" sub={ev?.title} right={isSampleId(id) ? <SampleTag /> : <Tag label={m.label} color={t.status === 'ACTIVE' ? NIGHT.green : t.status === 'USED' ? NIGHT.sky : NIGHT.red} />} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }} showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={NIGHT.violet} />}>
        <View style={[s.ticket, shadow(3, '#090726')]}>
          <View style={s.band}>
            <EventPhoto e={{ category: 'OTHER', posterUrl: ev?.posterUrl || null, art: isSampleId(id) ? demoEvent(id)?.art : undefined }} iconSize={56} iconRight />
            <LinearGradient colors={['rgba(91,47,214,0.55)', 'rgba(19,18,58,0.2)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
            <View style={{ position: 'absolute', left: 16, right: 16, bottom: 14 }}>
              <Text style={s.kind}>{t.kind === 'TEAM' ? 'Team ticket' : t.kind === 'SLOT' ? 'Slot ticket' : t.kind === 'MEMBER' ? 'Player ticket' : 'Entry ticket'}</Text>
              <Text style={s.title} numberOfLines={2}>{ev?.title}</Text>
              <Text style={s.holder}>{t.holder}</Text>
            </View>
            <Sparkle size={14} style={{ position: 'absolute', left: 18, top: 16 }} />
            <Sparkle size={9} color="#F0ABFC" style={{ position: 'absolute', left: 40, top: 34 }} />
          </View>
          <View style={s.qrWrap}>
            <TicketQR token={t.qrToken} status={t.status} code={t.ticketCode} size={qr} />
            <Text style={s.codeLabel}>Ticket code</Text>
            <Text style={s.code} selectable accessibilityLabel={`Ticket code ${t.ticketCode.split('').join(' ')}`}>{groupCode(t.ticketCode)}</Text>
            {t.status === 'ACTIVE' ? <Text style={s.hint}>Turn your screen brightness up at the gate so the QR scans first time.</Text> : null}
          </View>
          <View style={s.perfRow}>
            <View style={[s.notch, { left: -12 }]} />
            <View style={s.dash} />
            <View style={[s.notch, { right: -12 }]} />
          </View>
          <View style={{ padding: 16, paddingTop: 6 }}>
            <Row label="When" value={t.slot ? `${fmtWhen(t.slot.startAt)} – ${fmtClock(t.slot.endAt)}` : fmtRange(ev?.startAt, ev?.endAt)} />
            {t.slot?.label ? <Row label="Slot" value={t.slot.label} /> : null}
            {ev?.venue ? <Row label="Venue" value={ev.venue} /> : null}
            {t.registration ? <Row label="Registration code" value={t.registration.code} /> : null}
            {opensAt && t.status === 'ACTIVE' ? <Row label="Entry opens" value={fmtWhen(opensAt)} /> : null}
            {t.usedAt ? <Row label="Checked in" value={fmtWhen(t.usedAt)} /> : null}
          </View>
        </View>

        {t.status === 'ACTIVE' && t.registration?.paymentDue ? <Notice tone="warn">Pay {inr(t.registration.total)} at the venue desk. Staff admit you only after collecting the fee.</Notice> : null}
        {t.status === 'USED' ? <Notice tone="success">You already checked in. This ticket cannot be used again.</Notice> : null}
        {t.status === 'CANCELLED' || t.status === 'VOID' ? <Notice tone="danger">This ticket is not valid for entry.</Notice> : null}
        {ev?.instructions ? <Notice>{ev.instructions}</Notice> : null}
        <Notice>{t.entryNote ? `${t.entryNote} ` : ''}If your phone has no signal, show the ticket code: staff check it online.</Notice>
        {t.registration ? <CTA label="Registration details" tone="glass" onPress={() => nav.go(`/campus-events/registration/${t.registration!.id}`)} style={{ marginTop: 4 }} /> : null}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  ticket: { borderRadius: 26, backgroundColor: NIGHT.card, marginBottom: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.18)' },
  band: { height: 150, borderTopLeftRadius: 26, borderTopRightRadius: 26, overflow: 'hidden' },
  kind: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: W.label },
  title: { color: '#FFFFFF', fontSize: 21, lineHeight: 25, fontWeight: W.display, fontStyle: 'italic', marginTop: 2 },
  holder: { color: 'rgba(255,255,255,0.9)', fontSize: 13, marginTop: 3 },
  qrWrap: { alignItems: 'center', paddingTop: 18, paddingHorizontal: 16 },
  codeLabel: { color: NIGHT.faint, fontSize: 12, marginTop: 14 },
  code: { color: NIGHT.ink, fontSize: 23, fontWeight: W.hero, letterSpacing: 3, marginTop: 2 },
  hint: { color: NIGHT.sub, fontSize: 12, textAlign: 'center', marginTop: 8 },
  perfRow: { height: 30, justifyContent: 'center', marginTop: 8 },
  dash: { marginHorizontal: 18, borderTopWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.22)' },
  notch: { position: 'absolute', width: 24, height: 24, borderRadius: 12, backgroundColor: NIGHT.page, top: 3 },
  kv: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, gap: 12 },
  kvLabel: { color: NIGHT.sub, fontSize: 13, flexShrink: 0 },
  kvValue: { color: NIGHT.ink, fontSize: 13.5, fontWeight: W.label, textAlign: 'right', flexShrink: 1 },
});
