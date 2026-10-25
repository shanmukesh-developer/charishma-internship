/**
 * Registration / ticket flow (app/campus-events/register/:id), night look. Logic in useEventsV2Register (same
 * rules as before). Payment shows only the modes the server allows now (Free · Pay at the venue · ZCS Wallet when
 * switched on; online only if its server switch is on). A sample id never reaches the server.
 */
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../context/AuthContext';
import { KeyboardAvoidingView } from '../../components/KeyboardAvoidingView';
import { fmtClock, inr, mmss } from '../campusEvents/campusEventsApi';
import { NIGHT, W } from './eventsV2Theme';
import { CTA, Glass, NightHeader } from './EventsV2Kit';
import { Notice, StateBlock } from './EventsV2States';
import { SlideIn } from '../others/motion';
import { CheckRow, PayOption, QuestionInput, StepBar, Summary } from './EventsV2RegisterParts';
import { PAY_LABEL } from './EventsV2DetailParts';
import RegisterDone from './EventsV2RegisterDone';
import { IHourglass, ILock, IShield } from './EventsV2Icons';
import { useNav } from './eventsV2Nav';
import { useEventsV2Register } from './useEventsV2Register';
import { isSampleId } from './eventsV2Demo';
import { useLocalSearchParams } from 'expo-router';

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={s.kv}>
      <Text style={s.kvLabel}>{label}</Text>
      <Text style={[s.kvValue, strong ? { fontSize: 17, fontWeight: W.title } : null]}>{value}</Text>
    </View>
  );
}

function Flow() {
  const f = useEventsV2Register();
  const nav = useNav();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const ev = f.ev;
  if (!ev) {
    return (
      <View style={{ flex: 1 }}>
        <NightHeader title="Register" onBack={f.back} />
        {f.error ? <StateBlock kind={f.error.isNetwork ? 'offline' : f.error.code === 'FEATURE_OFF' ? 'soon' : f.error.status === 404 ? 'empty' : 'error'} title={f.error.status === 404 ? 'Event not found' : undefined} action="Retry" onAction={f.load} /> : <StateBlock kind="loading" />}
      </View>
    );
  }
  const slotLabel = f.held?.slot ? `${fmtClock(f.held.slot.startAt)} – ${fmtClock(f.held.slot.endAt)}` : undefined;
  const confirmLabel = f.wantWaitlist || f.slotId ? 'Join waitlist' : f.isFree ? 'Confirm registration' : f.mode === 'VENUE' ? 'Reserve · pay at the venue' : f.mode === 'ONLINE' ? 'Continue to payment' : `Pay ${inr(f.total)} and confirm`;
  const policy = ev.cancellationPolicy || {};
  return (
    <View style={{ flex: 1 }}>
      <NightHeader title={f.title} sub={ev.title} onBack={f.back} />
      <KeyboardAvoidingView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {f.step !== 'done' ? <StepBar steps={f.steps} idx={f.idx} /> : null}
          {f.held && f.step !== 'done' ? (
            f.holdGone
              ? <Notice tone="danger" icon={<IHourglass size={16} color={NIGHT.red} strokeWidth={1.8} />}>Your hold has ended and the slot went back to others. <Text style={{ color: NIGHT.violet }} onPress={() => nav.go(`/campus-events/slots/${ev.id}`)}>Pick again</Text></Notice>
              : <Notice tone="warn" icon={<IHourglass size={16} color={NIGHT.amber} strokeWidth={1.8} />}>Slot {slotLabel} held for you: <Text style={{ fontWeight: W.title }}>{f.holdLeft !== null ? mmss(f.holdLeft) : '…'}</Text> left to confirm.</Notice>
          ) : null}

          <SlideIn stepKey={f.step}>
            {f.step === 'profile' ? (
              <>
                <Text style={s.h}>Is this you?</Text>
                <Text style={s.sub}>ZCS uses your verified student account. Nothing to type again.</Text>
                <Summary ev={ev} slotLabel={slotLabel} />
                <Glass style={{ padding: 14, marginBottom: 12 }}>
                  <Row label="Name" value={String((user as any)?.name || 'Your account')} />
                  {(user as any)?.email ? <Row label="Email" value={String((user as any).email)} /> : null}
                  <Row label="Account" value="Verified ZCS student" />
                </Glass>
                <Notice icon={<IShield size={16} color={NIGHT.violet} strokeWidth={1.8} />}>The organiser sees your name, your registration code and your answers only. Never your phone, email or payment details.</Notice>
                {f.wantWaitlist || f.slotId ? <Notice>This {f.slotId ? 'slot' : 'event'} is full. You will join the waitlist and be moved in automatically (or offered the place) when someone cancels.</Notice> : null}
                {f.blockedPaid ? <Notice tone="danger">No payment option is available for this event right now, so registration cannot be completed. Please try again later.</Notice> : null}
              </>
            ) : null}

            {f.step === 'questions' ? (
              <>
                <Text style={s.h}>A few questions from the organiser</Text>
                <Text style={s.sub}>Fields marked * are required.</Text>
                {f.questions.map((q) => <QuestionInput key={q.id} q={q} value={f.answers[q.id]} error={f.fieldErr[q.id]} onChange={(v) => { f.setAnswers((a) => ({ ...a, [q.id]: v })); f.setFieldErr((e) => ({ ...e, [q.id]: '' })); }} />)}
              </>
            ) : null}

            {f.step === 'rules' ? (
              <>
                <Text style={s.h}>Rules and cancellation</Text>
                {ev.rules ? <Glass style={{ padding: 14, marginBottom: 12 }}><Text style={s.body}>{ev.rules}</Text></Glass> : null}
                <Glass style={{ padding: 14, marginBottom: 14 }}>
                  <Text style={s.cardTitle}>Cancellation terms</Text>
                  <Text style={s.body}>{[policy.userCancelUntilHours != null ? `You can cancel up to ${policy.userCancelUntilHours} hour${policy.userCancelUntilHours === 1 ? '' : 's'} before the start.` : 'You can cancel until the cut-off set for this event.',
                    !f.isFree && policy.refundPct != null ? `Refund: ${policy.refundPct}% of what you paid.` : null, policy.text || null, 'After you check in, the registration cannot be cancelled.'].filter(Boolean).join(' ')}</Text>
                </Glass>
                {ev.rules ? <CheckRow label="I have read and accept the event rules" value={f.acceptRules} onChange={f.setAcceptRules} /> : null}
                <CheckRow label="I accept the cancellation and refund terms" value={f.acceptCancel} onChange={f.setAcceptCancel} />
              </>
            ) : null}

            {f.step === 'payment' ? (
              <>
                <Text style={s.h}>How will you pay?</Text>
                <Glass style={{ padding: 14, marginBottom: 14 }}>
                  <Row label={f.teamId ? 'Team fee' : 'Fee'} value={inr(ev.price.amount)} />
                  {ev.price.extraCharges.map((c, i) => <Row key={i} label={c.label} value={inr(c.amount)} />)}
                  <Row label="Total" value={inr(f.total)} strong />
                </Glass>
                {f.modes.length ? f.modes.map((m) => <PayOption key={m} m={m} on={f.mode === m} onPress={() => f.setMode(m)} />) : <Notice tone="danger">No payment option is available for this event right now.</Notice>}
                {f.mode === 'VENUE' ? <Notice tone="warn">Your place is reserved now. Pay {inr(f.total)} at the venue desk: you are admitted only after paying.</Notice> : null}
                {f.mode === 'ONLINE' ? <Notice icon={<ILock size={16} color={NIGHT.violet} strokeWidth={1.8} />}>Your place is confirmed only after the payment provider confirms the payment, never from the app screen alone.</Notice> : null}
              </>
            ) : null}

            {f.step === 'review' ? (
              <>
                <Text style={s.h}>Review and confirm</Text>
                <Summary ev={ev} slotLabel={slotLabel} />
                <Glass style={{ padding: 14 }}>
                  <Row label="Type" value={f.teamId ? 'Team registration' : f.regId || f.slotId ? 'Slot booking' : 'Individual'} />
                  {f.questions.length ? <Row label="Answers" value={`${Object.keys(f.cleanAnswers()).length} of ${f.questions.length}`} /> : null}
                  <Row label="Payment" value={f.isFree ? 'Free' : f.mode ? PAY_LABEL[f.mode] : '—'} />
                  <Row label="Total" value={f.isFree ? 'Free' : inr(f.total)} strong />
                  {ev.approvalRequired ? <Text style={[s.body, { color: NIGHT.amber, marginTop: 6 }]}>The organiser approves each registration. Your ticket appears once approved.</Text> : null}
                </Glass>
              </>
            ) : null}

            {f.step === 'done' && f.result ? <RegisterDone result={f.result} ev={ev} /> : null}
          </SlideIn>
        </ScrollView>

        {f.step !== 'done' ? (
          <View style={[s.bar, { paddingBottom: Math.max(insets.bottom, 10) + 10 }]}>
            {f.idx > 0 ? <CTA label="Back" tone="glass" onPress={f.back} style={{ flex: 1 }} /> : null}
            {f.step === 'review'
              ? <CTA label={confirmLabel} onPress={f.submit} busy={f.busy} disabled={f.holdGone || f.blockedPaid} style={{ flex: 2 }} />
              : <CTA label="Continue" onPress={f.next} disabled={f.holdGone || f.blockedPaid} style={{ flex: 2 }} />}
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </View>
  );
}

export default function EventsV2Register() {
  const p = useLocalSearchParams<{ id: string | string[] }>();
  const id = String(Array.isArray(p.id) ? p.id[0] : p.id || '');
  const nav = useNav();
  if (isSampleId(id)) {
    return (
      <View style={{ flex: 1 }}>
        <NightHeader title="Register" />
        <StateBlock kind="empty" title="This is a sample event" body="Registration and tickets open for real events as soon as your clubs publish them. Nothing was booked." action="Browse events" onAction={() => nav.replace({ name: 'explore' })} />
      </View>
    );
  }
  return <Flow />;
}

const s = StyleSheet.create({
  h: { color: NIGHT.ink, fontSize: 20, fontWeight: W.title, letterSpacing: -0.3, marginBottom: 4 },
  sub: { color: NIGHT.sub, fontSize: 13, marginBottom: 14 },
  cardTitle: { color: NIGHT.ink, fontSize: 14.5, fontWeight: W.title, marginBottom: 6 },
  body: { color: NIGHT.sub, fontSize: 13.5, lineHeight: 20 },
  kv: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, gap: 12 },
  kvLabel: { color: NIGHT.sub, fontSize: 13, flexShrink: 0, maxWidth: '45%' },
  kvValue: { color: NIGHT.ink, fontSize: 13.5, fontWeight: W.label, textAlign: 'right', flexShrink: 1 },
  bar: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 12, backgroundColor: 'rgba(19,18,58,0.97)', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: NIGHT.line },
});
