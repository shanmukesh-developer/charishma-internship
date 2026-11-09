/**
 * Registration result (diet look): a glowing check with sparkles, the headline for the server's status, the
 * registration code on a ticket stub, payment state, and the next actions (QR ticket, pay, details, my registrations).
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { fmtWhen, inr, PAYMENT_STATUS_LABEL, REG_STATUS_META, type EventDetail, type Registration } from '../campusEvents/campusEventsApi';
import { useCampusEventsStatus } from '../campusEvents/ui';
import { NIGHT, W, shadow } from './eventsV2Theme';
import { themedSheet } from '../../utils/themeNow';
import { CTA, Press, Tag } from './EventsV2Kit';
import { Notice } from './EventsV2States';
import { ICheck, IHourglass, IListChecks } from './EventsV2Icons';
import { useNav } from './eventsV2Nav';

export default function RegisterDone({ result, ev }: { result: { registration: Registration; waitlisted?: boolean }; ev: EventDetail }) {
  const nav = useNav();
  const status = useCampusEventsStatus();
  const r = result.registration;
  const ok = r.status === 'CONFIRMED';
  const canPayOnline = r.status === 'PENDING_PAYMENT' && r.payment?.mode === 'ONLINE' && !!status?.onlinePayEnabled;
  const ticket = r.tickets.find((t) => t.status === 'ACTIVE');
  const headline = ok ? "You're registered" : r.status === 'WAITLISTED' ? "You're on the waitlist" : r.status === 'PENDING_APPROVAL' ? 'Registration sent' : r.status === 'PENDING_PAYMENT' ? (canPayOnline ? 'Complete your payment' : 'Payment pending') : REG_STATUS_META[r.status].label;
  const Icon = ok ? ICheck : r.status === 'WAITLISTED' ? IListChecks : IHourglass;
  return (
    <View>
      <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 18 }}>
        <View>
          <View style={[s.badge, shadow(3, ok ? '#138A55' : NIGHT.violetDeep)]}>
            <LinearGradient colors={ok ? ['#6EE7B7', '#10935F'] : [NIGHT.go[0], NIGHT.go[1]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
            <LinearGradient colors={['rgba(255,255,255,0.4)', 'rgba(255,255,255,0)']} style={[StyleSheet.absoluteFill, { height: '50%' }]} />
            <View><Icon size={38} color={ok ? '#FFFFFF' : NIGHT.onAcc} strokeWidth={2.2} /></View>
          </View>
        </View>
        <Text style={s.head} accessibilityRole="header">{headline}</Text>
        <Text style={s.sub}>{ev.title}</Text>
      </View>

      <View style={[s.stub, shadow(2)]}>
        <LinearGradient colors={[NIGHT.card, NIGHT.card2]} style={[StyleSheet.absoluteFill, { borderRadius: 22 }]} />
        <Text style={s.codeLabel}>Registration code</Text>
        <Text style={s.code} selectable accessibilityLabel={`Registration code ${r.code.split('').join(' ')}`}>{r.code}</Text>
        <View style={{ flexDirection: 'row', gap: 6, marginTop: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
          <Tag label={REG_STATUS_META[r.status].label} color={ok ? NIGHT.green : NIGHT.violet} />
          {r.payment && r.payment.status !== 'NONE' ? <Tag label={PAYMENT_STATUS_LABEL[r.payment.status]} color={r.payment.status === 'DUE_AT_VENUE' || r.payment.status === 'PENDING' ? NIGHT.amber : NIGHT.green} /> : null}
        </View>
        <View style={[s.notch, { left: -12 }]} /><View style={[s.notch, { right: -12 }]} />
      </View>

      {ok && r.payment?.status === 'DUE_AT_VENUE' ? <Notice tone="warn">Pay {inr(r.payment.total)} at the venue desk before entry.</Notice> : null}
      {r.status === 'PENDING_APPROVAL' ? <Notice>The organiser will review your registration. You will get a notification, and your ticket appears once approved.</Notice> : null}
      {r.status === 'WAITLISTED' ? <Notice>If a place opens, you are moved in automatically{!ev.price.isFree ? ' or offered the place to confirm' : ''}. We will notify you.</Notice> : null}
      {r.status === 'PENDING_PAYMENT' ? <Notice tone="warn">{r.payment?.payBy ? `Your place is held until ${fmtWhen(r.payment.payBy)}. ` : ''}It is confirmed only after the payment succeeds.</Notice> : null}

      {ticket ? <CTA label="View my QR ticket" onPress={() => nav.replace({ name: 'ticket', id: ticket.id })} style={{ marginTop: 6 }} /> : null}
      {canPayOnline ? <CTA label="Pay now" onPress={() => nav.go(`/campus-events/registration/${r.id}?pay=1`)} style={{ marginTop: 10 }} /> : null}
      <CTA label="Registration details" tone="glass" onPress={() => nav.go(`/campus-events/registration/${r.id}`)} style={{ marginTop: 10 }} />
      <Press onPress={() => nav.replace({ name: 'mine' })} label="My registrations" style={s.link}><Text style={s.linkText}>My registrations</Text></Press>
    </View>
  );
}

const s = themedSheet(() => ({
  badge: { width: 84, height: 84, borderRadius: 42, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'rgba(255,255,255,0.5)' },
  head: { color: NIGHT.ink, fontSize: 24, fontWeight: W.display, marginTop: 16, textAlign: 'center' },
  sub: { color: NIGHT.sub, fontSize: 13.5, marginTop: 4, textAlign: 'center' },
  stub: { borderRadius: 22, padding: 18, alignItems: 'center', overflow: 'visible', marginBottom: 14, backgroundColor: NIGHT.card, borderWidth: StyleSheet.hairlineWidth, borderColor: NIGHT.line },
  codeLabel: { color: NIGHT.faint, fontSize: 12 },
  code: { color: NIGHT.ink, fontSize: 26, fontWeight: W.hero, letterSpacing: 3, marginTop: 4 },
  notch: { position: 'absolute', top: '50%', width: 24, height: 24, borderRadius: 12, backgroundColor: NIGHT.page, marginTop: -12 },
  link: { alignSelf: 'center', minHeight: 48, justifyContent: 'center', paddingHorizontal: 12, marginTop: 4 },
  linkText: { color: NIGHT.violet, fontSize: 14, fontWeight: W.label },
}));
