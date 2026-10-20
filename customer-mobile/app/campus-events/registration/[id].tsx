// Zenvy Campus Events: one registration (spec §7). Registration code, status, event + slot, team, ticket(s),
// payment status (registrant only), hold / payment / offer countdowns, cancel with the event policy (server
// decides canCancel + cancelUntil), refund request, accept / decline a waitlist offer, online payment, answers,
// and event updates (announcements) from the organizer.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  campusEventsApi, CampusEventsError, errorCopy, answerRows, fmtWhen, fmtRange, fmtClock, inr, mmss, PAYMENT_MODE_LABEL, PAYMENT_STATUS_LABEL, TICKET_STATUS_META,
  type Registration, type Announcement, type EventDetail, type PaymentMode,
} from '../../../modules/campusEvents/campusEventsApi';
import { EHeader, usePalette, Card, Btn, ErrorState, StateView, Notice, Row, Pill, RegStatusPill, SectionTitle, Chips, useNow, refreshCampusEventsStatus, useCampusEventsStatus } from '../../../modules/campusEvents/ui';
import PayOnline from '../../../modules/campusEvents/PayOnline';
import { useCampusEventsLive } from '../../../modules/campusEvents/useCampusEventsLive';

export default function RegistrationScreen() {
  const params = useLocalSearchParams<{ id: string | string[]; pay?: string }>();
  const id = String(Array.isArray(params.id) ? params.id[0] : params.id || '');
  const router = useRouter();
  const p = usePalette();
  const [r, setR] = useState<Registration | null>(null);
  const [ev, setEv] = useState<EventDetail | null>(null);
  const [updates, setUpdates] = useState<Announcement[]>([]);
  const [error, setError] = useState<CampusEventsError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [pay, setPay] = useState(false);
  const [offerMode, setOfferMode] = useState<PaymentMode | null>(null);
  const [modes, setModes] = useState<PaymentMode[]>([]);
  // Online pay (Razorpay) shows only while the server switch is on; it is off in production for now.
  const onlineOn = !!useCampusEventsStatus()?.onlinePayEnabled;
  const canPayOnline = onlineOn && r?.status === 'PENDING_PAYMENT' && r.payment?.mode === 'ONLINE';
  const timed = !!r && (r.status === 'HELD' || r.status === 'OFFERED' || r.status === 'PENDING_PAYMENT');
  const now = useNow(1000, timed);

  const load = useCallback(async () => {
    try {
      const x = await campusEventsApi.registration(id);
      setR(x.registration);
      setError(null);
      const eid = x.registration.event?.id;
      if (eid) {
        campusEventsApi.announcements(eid).then((a) => setUpdates(a.announcements)).catch(() => setUpdates([]));
        if (x.registration.status === 'OFFERED') {
          const [e, st] = await Promise.all([campusEventsApi.event(eid).catch(() => null), refreshCampusEventsStatus().catch(() => null)]);
          if (e) {
            setEv(e.event);
            const m = e.event.paymentModes.filter((k) => (k !== 'WALLET' || !!st?.walletEnabled) && (k !== 'ONLINE' || !!st?.onlinePayEnabled));
            setModes(m);
            setOfferMode((cur) => cur || x.registration.payment?.mode || m[0] || null);
          }
        }
      }
    } catch (e: any) {
      setError(e instanceof CampusEventsError ? e : new CampusEventsError(e?.message || 'Could not load this registration.'));
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (params.pay === '1' && canPayOnline) setPay(true); }, [params.pay, canPayOnline]);
  useCampusEventsLive((e) => { if (!e.id || e.id === id || e.id === r?.event?.id || e.kind === 'reconnect') load(); });

  const act = async (tag: string, fn: () => Promise<{ registration: Registration; message?: string; refunded?: number }>, okMsg?: (x: Registration) => string | null) => {
    setBusy(tag);
    try {
      const res = await fn();
      setR(res.registration);
      const m = res.message || (okMsg ? okMsg(res.registration) : null);
      if (m) Alert.alert('Done', m);
    } catch (e: any) {
      const c = errorCopy(e);
      Alert.alert(c.title, c.message);
      load();
    } finally {
      setBusy(null);
    }
  };

  if (!r) {
    return (
      <View style={{ flex: 1, backgroundColor: p.bg }}>
        <EHeader title="Registration" />
        {error ? <ErrorState error={error} onRetry={load} notFoundTitle="Registration not found" notFoundLabel="My registrations" onNotFound={() => router.replace('/campus-events/my' as any)} /> : <StateView kind="loading" />}
      </View>
    );
  }

  const pm = r.payment;
  const tickets = r.tickets;
  const active = tickets.find((t) => t.status === 'ACTIVE');
  const holdLeft = r.holdExpiresAt ? new Date(r.holdExpiresAt).getTime() - now : null;
  const offerLeft = r.offerExpiresAt ? new Date(r.offerExpiresAt).getTime() - now : null;
  const payLeft = pm?.payBy ? new Date(pm.payBy).getTime() - now : null;
  const paidSomething = !!pm && ['SUCCESS', 'PAID_AT_VENUE'].includes(pm.status);

  const cancel = () => {
    const refundLine = paidSomething ? 'Any refund follows the event policy and goes back the way you paid (pay-at-venue refunds at the desk).' : pm?.status === 'DUE_AT_VENUE' ? 'Nothing was charged.' : '';
    Alert.alert(r.status === 'WAITLISTED' ? 'Leave the waitlist?' : r.type === 'TEAM' ? 'Withdraw the team registration?' : 'Cancel this registration?', `${refundLine} Your place goes to the next person.`.trim(), [
      { text: 'Keep', style: 'cancel' },
      {
        text: r.status === 'WAITLISTED' ? 'Leave waitlist' : 'Cancel registration', style: 'destructive',
        onPress: () => act('cancel', () => campusEventsApi.cancel(r.id), (x) => x.payment && x.payment.refundAmount > 0 ? `${inr(x.payment.refundAmount)} ${x.payment.status === 'REFUNDED' ? 'refunded' : 'refund is on its way'}.` : 'Your registration was cancelled.'),
      },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <EHeader title={r.code} subtitle={r.event?.title} right={<RegStatusPill status={r.status} />} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={p.accent} />}>
        {r.status === 'HELD' ? (
          <Notice tone="warn" icon="hourglass-outline">Your slot is held{holdLeft !== null ? ` for ${mmss(holdLeft)}` : ''}. Confirm it before the timer ends.</Notice>
        ) : null}
        {r.status === 'PENDING_PAYMENT' ? <Notice tone="warn" icon="time-outline">Payment pending{payLeft !== null && payLeft > 0 ? `: pay within ${mmss(payLeft)}` : ''}. Your place is confirmed only after the payment succeeds.</Notice> : null}
        {r.status === 'PENDING_APPROVAL' ? <Notice icon="time-outline">Waiting for the organizer to approve. Your ticket appears here once approved.</Notice> : null}
        {r.status === 'WAITLISTED' ? <Notice icon="list-outline">You are on the waitlist{r.waitlistAt ? ` since ${fmtWhen(r.waitlistAt)}` : ''}. Places are given in order of joining.</Notice> : null}
        {r.status === 'OFFERED' ? <Notice tone="success" icon="checkmark-circle-outline">A place opened for you. Confirm it{offerLeft !== null && offerLeft > 0 ? ` within ${mmss(offerLeft)}` : ''} or it goes to the next person.</Notice> : null}
        {r.status === 'REJECTED' ? <Notice tone="danger" icon="close-circle-outline">Not approved{r.rejectedReason ? `: ${r.rejectedReason}` : ''}.</Notice> : null}
        {r.status === 'CANCELLED' ? <Notice icon="close-circle-outline">Cancelled{r.cancelledAt ? ` on ${fmtWhen(r.cancelledAt)}` : ''}{r.cancelReason ? `: ${r.cancelReason}` : ''}.</Notice> : null}
        {r.status === 'EXPIRED' ? <Notice icon="hourglass-outline">This registration expired (hold, payment or offer time ran out).</Notice> : null}
        {r.event?.status === 'CANCELLED' ? <Notice tone="danger" icon="close-circle-outline">The organizer cancelled this event.</Notice> : null}

        <Card>
          <Text style={{ fontSize: 12, fontWeight: '800', color: p.muted, letterSpacing: 0.2 }}>Registration code</Text>
          <Text style={{ fontSize: 24, fontWeight: '900', color: p.text, letterSpacing: 2, marginTop: 2 }} selectable>{r.code}</Text>
          <Text style={{ fontSize: 15, fontWeight: '900', color: p.text, marginTop: 10 }}>{r.event?.title}</Text>
          <Text style={{ fontSize: 12.5, color: p.sub, marginTop: 4 }}><Ionicons name="calendar-outline" size={13} color={p.sub} /> {fmtRange(r.event?.startAt, r.event?.endAt)}</Text>
          {r.slot ? <Text style={{ fontSize: 12.5, color: p.sub, marginTop: 2 }}><Ionicons name="timer-outline" size={13} color={p.sub} /> Slot {r.slot.label ? `${r.slot.label} · ` : ''}{fmtClock(r.slot.startAt)}–{fmtClock(r.slot.endAt)}</Text> : null}
          {r.event?.venue ? <Text style={{ fontSize: 12.5, color: p.sub, marginTop: 2 }}><Ionicons name="location-outline" size={13} color={p.sub} /> {r.event.venue}</Text> : null}
          <Row label="Type" value={r.type === 'TEAM' ? 'Team' : r.type === 'SLOT' ? 'Slot booking' : 'Individual'} />
          {r.team ? <Row label="Team" value={`${r.team.name}${r.team.isCaptain ? ' (you are captain)' : ''}`} /> : null}
          <Row label="Registered" value={fmtWhen(r.createdAt)} />
          {r.confirmedAt ? <Row label="Confirmed" value={fmtWhen(r.confirmedAt)} /> : null}
        </Card>

        {r.status === 'HELD' && r.event ? <Btn label="Confirm booking" onPress={() => router.push(`/campus-events/register/${r.event!.id}?regId=${r.id}` as any)} style={{ marginBottom: 10 }} /> : null}
        {r.status === 'HELD' ? <Btn label="Release this slot" kind="secondary" loading={busy === 'release'} onPress={() => act('release', () => campusEventsApi.release(r.id))} style={{ marginBottom: 12 }} /> : null}

        {r.status === 'OFFERED' ? (
          <Card>
            {pm && pm.total > 0 ? (
              <>
                <Row label="Amount" value={inr(pm.total)} strong />
                {modes.length ? <Chips<PaymentMode> value={offerMode} onChange={setOfferMode} options={modes.map((m) => ({ key: m, label: PAYMENT_MODE_LABEL[m] }))} /> : <Text style={{ color: p.danger, fontSize: 12.5 }}>No payment option is available right now.</Text>}
              </>
            ) : null}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <Btn label="Decline" kind="secondary" style={{ flex: 1 }} loading={busy === 'decline'} onPress={() => act('decline', () => campusEventsApi.declineOffer(r.id), () => 'The place went to the next person.')} />
              <Btn label="Confirm my place" style={{ flex: 2 }} loading={busy === 'accept'} disabled={!!pm && pm.total > 0 && !offerMode}
                onPress={() => act('accept', () => campusEventsApi.acceptOffer(r.id, pm && pm.total > 0 ? offerMode || undefined : undefined), (x) => (x.status === 'PENDING_PAYMENT' ? null : 'Your place is confirmed.')).then(() => load())} />
            </View>
            {ev?.approvalRequired ? <Text style={{ color: p.sub, fontSize: 12, marginTop: 6 }}>The organizer still approves each registration.</Text> : null}
          </Card>
        ) : null}

        <SectionTitle>Ticket</SectionTitle>
        {active ? (
          <Btn label="Show my QR ticket" icon="ticket-outline" onPress={() => router.push(`/campus-events/ticket/${active.id}` as any)} style={{ marginBottom: 12 }} />
        ) : tickets.length ? (
          <Card>
            {tickets.map((t) => (
              <View key={t.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 }}>
                <Text style={{ flex: 1, color: p.text, fontWeight: '800' }}>{t.kind === 'TEAM' ? 'Team ticket' : 'Ticket'} {t.ticketCode}</Text>
                <Pill label={TICKET_STATUS_META[t.status].label} color={TICKET_STATUS_META[t.status].color} />
              </View>
            ))}
            {tickets.some((t) => t.status === 'USED') ? <Text style={{ color: p.sub, fontSize: 12, marginTop: 4 }}>Checked in{tickets[0].usedAt ? ` at ${fmtWhen(tickets[0].usedAt)}` : ''}.</Text> : null}
          </Card>
        ) : (
          <Card><Text style={{ color: p.sub, fontSize: 12.5 }}>{r.status === 'CONFIRMED' ? 'Your ticket is being issued. Pull to refresh.' : 'A QR ticket is issued once the registration is confirmed.'}</Text></Card>
        )}

        {pm ? (
          <>
            <SectionTitle>Payment</SectionTitle>
            <Card>
              <Row label="Method" value={PAYMENT_MODE_LABEL[pm.mode]} />
              {pm.total > 0 ? <Row label="Fee" value={inr(pm.amount)} /> : null}
              {pm.extras > 0 ? <Row label="Extra charges" value={inr(pm.extras)} /> : null}
              <Row label="Total" value={pm.total > 0 ? inr(pm.total) : 'Free'} strong />
              <Row label="Status" value={PAYMENT_STATUS_LABEL[pm.status]} />
              {pm.paidAt ? <Row label="Paid" value={fmtWhen(pm.paidAt)} /> : null}
              {pm.refundAmount > 0 ? <Row label="Refund" value={`${inr(pm.refundAmount)}${pm.refundedAt ? ` · ${fmtWhen(pm.refundedAt)}` : ''}`} /> : null}
              {pm.status === 'DUE_AT_VENUE' ? <Text style={{ color: p.warn, fontSize: 12, marginTop: 6, fontWeight: '700' }}>Pay {inr(pm.total)} at the venue desk before entry.</Text> : null}
            </Card>
            {canPayOnline ? <Btn label={`Pay ${inr(pm.total)} online`} onPress={() => setPay(true)} style={{ marginBottom: 10 }} /> : null}
            {pm.status === 'REFUND_PENDING' ? <Btn label="Check refund status" kind="secondary" loading={busy === 'refund'} onPress={() => act('refund', () => campusEventsApi.requestRefund(r.id), (x) => (x.payment?.status === 'REFUNDED' ? 'Refund completed.' : 'Refund requested.'))} style={{ marginBottom: 10 }} /> : null}
          </>
        ) : r.type === 'TEAM' ? <Notice icon="lock-closed-outline">Payment details are visible to the captain who registered the team.</Notice> : null}

        {answerRows(r).length ? (
          <>
            <SectionTitle>Your answers</SectionTitle>
            <Card>{answerRows(r).map((a) => <Row key={a.id} label={a.label} value={a.text} />)}</Card>
          </>
        ) : null}

        {updates.length ? (
          <>
            <SectionTitle kicker="From the organizer">Event updates</SectionTitle>
            {updates.map((a) => (
              <Card key={a.id}>
                <Text style={{ fontSize: 13.5, fontWeight: '900', color: p.text }}><Ionicons name={a.kind === 'VENUE_CHANGE' ? 'location-outline' : a.kind === 'SCHEDULE_CHANGE' ? 'time-outline' : a.kind === 'CANCELLATION' ? 'close-circle-outline' : 'megaphone-outline'} size={14} color={a.kind === 'CANCELLATION' ? p.danger : p.accent} />{' '}{a.title}</Text>
                <Text style={{ fontSize: 12.5, color: p.sub, marginTop: 4, lineHeight: 18 }}>{a.body}</Text>
                <Text style={{ fontSize: 12, color: p.muted, marginTop: 6 }}>{fmtWhen(a.createdAt)}</Text>
              </Card>
            ))}
          </>
        ) : null}

        <View style={{ gap: 10, marginTop: 8 }}>
          {r.team ? <Btn label={r.team.isCaptain ? 'Manage team' : 'View team'} kind="secondary" onPress={() => router.push(`/campus-events/team/${r.team!.id}` as any)} /> : null}
          {r.event ? <Btn label="Event details" kind="secondary" onPress={() => router.push(`/campus-events/${r.event!.id}` as any)} /> : null}
          {r.canCancel && r.status !== 'HELD' ? (
            r.type === 'TEAM' && r.team?.isCaptain
              ? <Btn label="Withdraw team" kind="ghost" onPress={() => router.push(`/campus-events/team/${r.team!.id}` as any)} />
              : <Btn label={r.status === 'WAITLISTED' ? 'Leave waitlist' : 'Cancel registration'} kind="danger" loading={busy === 'cancel'} onPress={cancel} />
          ) : r.isOwner && ['CONFIRMED', 'PENDING_APPROVAL', 'WAITLISTED', 'PENDING_PAYMENT'].includes(r.status) ? (
            <Text style={{ color: p.sub, fontSize: 12, textAlign: 'center' }}>{r.cancelUntil ? `Cancellations closed on ${fmtWhen(r.cancelUntil)}.` : tickets.some((t) => t.status === 'USED') ? 'Checked-in registrations cannot be cancelled.' : 'This registration can no longer be cancelled.'}</Text>
          ) : null}
        </View>
      </ScrollView>

      {r.event && onlineOn ? <PayOnline visible={pay} registrationId={r.id} title={r.event.title} onClose={() => { setPay(false); load(); }} /> : null}
    </View>
  );
}

