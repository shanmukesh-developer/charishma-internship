// Zenvy Campus Events: registration flow (spec §4 + §6), one screen with steps:
//   1. Confirm profile (read-only: the verified Zenvy account is reused, nothing is re-typed)
//   2. Organizer questions (validated here and again on the server)
//   3. Rules + cancellation terms acceptance (rulesVersion from the server)
//   4. Payment choice: Free / Pay at venue / Zenvy Wallet (only when the server enables it) / Online (only when configured)
//   5. Review -> confirm -> confirmation with the registration code (+ ticket when confirmed)
// Modes (query): default = POST /:id/register (individual); ?regId= confirms a HELD slot booking (hold countdown);
// ?teamId= submits a team (captain); ?waitlist=1 joins the waitlist of a full event; ?slotId= waitlists a full slot.
// The amount, availability and final status always come from the server; retries reuse one idempotency key.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, Alert, BackHandler, TouchableOpacity } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { KeyboardAvoidingView } from '../../../components/KeyboardAvoidingView';
import { useAuth } from '../../../context/AuthContext';
import {
  campusEventsApi, CampusEventsError, errorCopy, newIdempotencyKey, inr, fmtRange, fmtClock, fmtWhen, mmss, PAYMENT_MODE_LABEL, REG_STATUS_META, PAYMENT_STATUS_LABEL,
  type EventDetail, type PaymentMode, type Question, type Registration, type RegisterBody,
} from '../../../modules/campusEvents/campusEventsApi';
import { EHeader, usePalette, Card, Btn, Field, Chips, CheckRow, ErrorState, StateView, Notice, Row, Pill, RegStatusPill, useNow, refreshCampusEventsStatus, useCampusEventsStatus, CE_HOME } from '../../../modules/campusEvents/ui';

type Step = 'profile' | 'questions' | 'rules' | 'payment' | 'review' | 'done';
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || '';

export default function RegisterScreen() {
  const params = useLocalSearchParams<{ id: string | string[]; regId?: string; teamId?: string; waitlist?: string; slotId?: string }>();
  const id = one(params.id);
  const regId = one(params.regId);
  const teamId = one(params.teamId);
  const slotId = one(params.slotId);
  const wantWaitlist = one(params.waitlist) === '1';
  const router = useRouter();
  const p = usePalette();
  const { user } = useAuth();
  const [ev, setEv] = useState<EventDetail | null>(null);
  const [held, setHeld] = useState<Registration | null>(null);
  const [modes, setModes] = useState<PaymentMode[]>([]);
  const [error, setError] = useState<CampusEventsError | null>(null);
  const [step, setStep] = useState<Step>('profile');
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const [acceptRules, setAcceptRules] = useState(false);
  const [acceptCancel, setAcceptCancel] = useState(false);
  const [mode, setMode] = useState<PaymentMode | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ registration: Registration; waitlisted?: boolean } | null>(null);
  const key = useRef(newIdempotencyKey());
  const now = useNow(1000, !!held && held.status === 'HELD' && step !== 'done');

  const load = useCallback(async () => {
    try {
      const [r, st, h] = await Promise.all([
        campusEventsApi.event(id),
        refreshCampusEventsStatus().catch(() => null),
        regId ? campusEventsApi.registration(regId) : Promise.resolve(null),
      ]);
      setEv(r.event);
      // Offered modes = the server's list for this event, double-checked against the live switches.
      const offered = (r.event.paymentModes || []).filter((m) => (m !== 'WALLET' || !!st?.walletEnabled) && (m !== 'ONLINE' || !!st?.onlinePayEnabled));
      setModes(offered);
      setMode((cur) => cur || offered[0] || null);
      if (h) setHeld(h.registration);
      setError(null);
    } catch (e: any) {
      setError(e instanceof CampusEventsError ? e : new CampusEventsError(e?.message || 'Could not load this event.'));
    }
  }, [id, regId]);
  useEffect(() => { load(); }, [load]);

  const questions: Question[] = ev?.questions || [];
  const isFree = !ev || ev.price.isFree;
  const total = held?.payment?.total ?? ev?.price.total ?? 0;
  const steps: Step[] = useMemo(() => {
    const list: Step[] = ['profile'];
    if (questions.length) list.push('questions');
    list.push('rules');
    if (!isFree) list.push('payment');
    list.push('review');
    return list;
  }, [questions.length, isFree]);
  const idx = steps.indexOf(step);

  const leave = useCallback(() => {
    if (held && held.status === 'HELD' && step !== 'done') {
      Alert.alert('Leave without confirming?', 'Your slot stays held until the timer runs out, then it goes back to others.', [
        { text: 'Stay', style: 'cancel' },
        { text: 'Release slot', style: 'destructive', onPress: async () => { try { await campusEventsApi.release(held.id); } catch { /* expires anyway */ } router.back(); } },
        { text: 'Leave', onPress: () => router.back() },
      ]);
      return;
    }
    if (router.canGoBack()) router.back(); else router.replace(`/campus-events/${id}` as any);
  }, [held, step, router, id]);
  const back = useCallback(() => {
    if (step === 'done' || idx <= 0) { leave(); return; }
    setStep(steps[idx - 1]);
  }, [step, idx, steps, leave]);
  // Android hardware back walks the steps backwards instead of dropping the whole form.
  useFocusEffect(useCallback(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { back(); return true; });
    return () => sub.remove();
  }, [back]));

  const validateQuestions = () => {
    const errs: Record<string, string> = {};
    for (const q of questions) {
      const v = answers[q.id];
      const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
      if (empty) { if (q.required) errs[q.id] = 'This answer is required.'; continue; }
      if ((q.type === 'TEXT' || q.type === 'LONG_TEXT') && String(v).trim().length > (q.maxLength || 1000)) errs[q.id] = `Keep it under ${q.maxLength || 1000} characters.`;
      if (q.type === 'NUMBER' && !Number.isFinite(Number(v))) errs[q.id] = 'Enter a number.';
    }
    setFieldErr(errs);
    return !Object.keys(errs).length;
  };

  const next = () => {
    if (step === 'questions' && !validateQuestions()) return;
    if (step === 'rules' && (!acceptCancel || (ev?.rules && !acceptRules))) {
      Alert.alert('Accept to continue', ev?.rules ? 'Please accept the event rules and the cancellation terms.' : 'Please accept the cancellation terms.');
      return;
    }
    if (step === 'payment' && !mode) { Alert.alert('Choose how to pay'); return; }
    setStep(steps[idx + 1]);
  };

  const cleanAnswers = () => {
    const out: Record<string, any> = {};
    for (const q of questions) {
      const v = answers[q.id];
      if (v === undefined || v === '' || v === null) continue;
      out[q.id] = q.type === 'NUMBER' ? Number(v) : typeof v === 'string' ? v.trim() : v;
    }
    return out;
  };

  const submit = async () => {
    if (!ev) return;
    setBusy(true);
    const body: RegisterBody = {
      answers: cleanAnswers(), acceptRules: true, rulesVersion: ev.rulesVersion,
      ...(isFree ? {} : { paymentMode: mode || undefined }),
      ...(slotId && !regId ? { slotId } : {}),
      ...(wantWaitlist || slotId ? { joinWaitlist: true } : {}),
    };
    try {
      if (regId) {
        const r = await campusEventsApi.confirm(regId, body);
        setResult({ registration: r.registration });
      } else if (teamId) {
        const r = await campusEventsApi.submitTeam(teamId, body, key.current);
        setResult({ registration: r.registration, waitlisted: r.waitlisted });
      } else {
        const r = await campusEventsApi.register(ev.id, body, key.current);
        setResult({ registration: r.registration, waitlisted: r.waitlisted });
      }
      setStep('done');
    } catch (e: any) {
      const err = e as CampusEventsError;
      if (err?.code === 'IDEMPOTENCY_KEY_REUSED') key.current = newIdempotencyKey();
      const f = err?.field || '';
      if (f.startsWith('answers.')) {
        setFieldErr({ [f.slice(8)]: err.message });
        setStep('questions');
      } else if (err?.code === 'RULES_CHANGED') {
        setAcceptRules(false);
        await load();
        setStep('rules');
      } else if (['PAYMENT_MODE_NOT_OFFERED', 'PAYMENT_METHOD_OFF', 'PAYMENT_NOT_CONFIGURED', 'INSUFFICIENT_WALLET'].includes(err?.code)) {
        await load();
        setStep('payment');
      }
      const c = errorCopy(err);
      const full = err?.code === 'EVENT_FULL' || err?.code === 'SLOT_FULL';
      if (err?.code === 'HOLD_EXPIRED') {
        Alert.alert(c.title, c.message, [{ text: 'Pick a slot again', onPress: () => router.replace(`/campus-events/slots/${ev.id}` as any) }]);
      } else if (err?.code === 'ALREADY_REGISTERED' && err.data?.registrationId) {
        Alert.alert(c.title, c.message, [{ text: 'OK', style: 'cancel' }, { text: 'View registration', onPress: () => router.replace(`/campus-events/registration/${err.data.registrationId}` as any) }]);
      } else if (full) {
        Alert.alert(c.title, err.data?.waitlistEnabled ? `${c.message} You can join the waitlist instead.` : c.message);
      } else if (needsVerify(err)) {
        Alert.alert(c.title, c.message, [{ text: 'Later', style: 'cancel' }, { text: 'Verify now', onPress: () => router.push('/friends?screen=verification' as any) }]);
      } else {
        Alert.alert(c.title, err?.isNetwork ? `${c.message}\nTap confirm again: it will not register you twice.` : c.message);
      }
    } finally {
      setBusy(false);
    }
  };

  if (!ev) {
    return (
      <View style={{ flex: 1, backgroundColor: p.bg }}>
        <EHeader title="Register" onBack={leave} />
        {error ? <ErrorState error={error} onRetry={load} notFoundTitle="Event not found" onNotFound={() => router.replace(CE_HOME as any)} /> : <StateView kind="loading" />}
      </View>
    );
  }

  const holdLeft = held?.holdExpiresAt ? new Date(held.holdExpiresAt).getTime() - now : null;
  const holdGone = held && (held.status !== 'HELD' || (holdLeft !== null && holdLeft <= 0));
  const title = step === 'done' ? 'You are in' : teamId ? 'Register your team' : regId ? 'Confirm your slot' : wantWaitlist || slotId ? 'Join the waitlist' : 'Register';
  const blockedPaid = !isFree && !modes.length;

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <EHeader title={title} subtitle={ev.title} onBack={back} />
      <KeyboardAvoidingView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          {step !== 'done' ? <Progress steps={steps} idx={idx} /> : null}

          {held && step !== 'done' ? (
            holdGone ? (
              <Notice tone="danger" icon="hourglass-outline">Your hold has ended and the slot went back to others. <Text style={{ fontWeight: '900', color: p.accent }} onPress={() => router.replace(`/campus-events/slots/${ev.id}` as any)}>Pick again ›</Text></Notice>
            ) : (
              <Notice tone="warn" icon="hourglass-outline">Slot {held.slot ? `${fmtClock(held.slot.startAt)}–${fmtClock(held.slot.endAt)}` : ''} held for you: <Text style={{ fontWeight: '900' }}>{holdLeft !== null ? mmss(holdLeft) : '…'}</Text> left to confirm.</Notice>
            )
          ) : null}

          {step === 'profile' ? (
            <>
              <Text style={styles(p).h}>Is this you?</Text>
              <Text style={styles(p).sub}>Zenvy uses your verified student account. Nothing to type again.</Text>
              <Card>
                <Row label="Name" value={String((user as any)?.name || 'Your account')} />
                {(user as any)?.email ? <Row label="Email" value={String((user as any).email)} /> : null}
                <Row label="Account" value="Verified Zenvy student" />
              </Card>
              <Notice icon="lock-closed-outline">The organizer sees your name, your registration code and your answers only. Never your phone, email or payment details.</Notice>
              <EventSummary ev={ev} p={p} />
              {wantWaitlist || slotId ? <Notice tone="info" icon="list-outline">This {slotId ? 'slot' : 'event'} is full. You will join the waitlist and be moved in automatically (or offered the place) when someone cancels.</Notice> : null}
              {blockedPaid ? <Notice tone="danger" icon="alert-circle-outline">No payment option is available for this event right now, so registration cannot be completed. Please try again later.</Notice> : null}
            </>
          ) : null}

          {step === 'questions' ? (
            <>
              <Text style={styles(p).h}>A few questions from the organizer</Text>
              <Text style={styles(p).sub}>Fields marked * are required.</Text>
              {questions.map((q) => <QuestionInput key={q.id} q={q} value={answers[q.id]} error={fieldErr[q.id]} onChange={(v) => { setAnswers((a) => ({ ...a, [q.id]: v })); setFieldErr((f) => ({ ...f, [q.id]: '' })); }} />)}
            </>
          ) : null}

          {step === 'rules' ? (
            <>
              <Text style={styles(p).h}>Rules & cancellation</Text>
              {ev.rules ? (
                <Card><Text style={{ color: p.text, fontSize: 13.5, lineHeight: 20 }}>{ev.rules}</Text></Card>
              ) : null}
              <Card>
                <Text style={{ fontSize: 13, fontWeight: '900', color: p.text, marginBottom: 4 }}>Cancellation terms</Text>
                <Text style={{ color: p.sub, fontSize: 13, lineHeight: 19 }}>
                  {[
                    ev.cancellationPolicy?.userCancelUntilHours != null ? `You can cancel up to ${ev.cancellationPolicy.userCancelUntilHours} hour${ev.cancellationPolicy.userCancelUntilHours === 1 ? '' : 's'} before the start.` : 'You can cancel until the cut-off Zenvy sets for this event.',
                    !isFree && ev.cancellationPolicy?.refundPct != null ? `Refund: ${ev.cancellationPolicy.refundPct}% of what you paid.` : null,
                    ev.cancellationPolicy?.text || null,
                    'After you check in, the registration cannot be cancelled.',
                  ].filter(Boolean).join(' ')}
                </Text>
              </Card>
              {ev.rules ? <CheckRow label="I have read and accept the event rules" value={acceptRules} onChange={setAcceptRules} /> : null}
              <CheckRow label="I accept the cancellation and refund terms" value={acceptCancel} onChange={setAcceptCancel} />
            </>
          ) : null}

          {step === 'payment' ? (
            <>
              <Text style={styles(p).h}>How will you pay?</Text>
              <Card>
                <Row label={teamId ? 'Team fee' : 'Fee'} value={inr(ev.price.amount)} />
                {ev.price.extraCharges.map((c, i) => <Row key={i} label={c.label} value={inr(c.amount)} />)}
                <Row label="Total" value={inr(total)} strong />
              </Card>
              {modes.length ? (
                <Chips<PaymentMode> value={mode} onChange={setMode}
                  options={modes.map((m) => ({ key: m, label: PAYMENT_MODE_LABEL[m], hint: m === 'VENUE' ? 'Pay at the desk before entry' : m === 'WALLET' ? 'Deducted now from your Zenvy Wallet' : 'Secure checkout by Razorpay' }))} />
              ) : <Notice tone="danger" icon="alert-circle-outline">No payment option is available for this event right now.</Notice>}
              {mode === 'VENUE' ? <View style={{ marginTop: 12 }}><Notice tone="warn" icon="cash-outline">Your place is reserved now. Pay {inr(total)} at the venue desk: you are admitted only after paying.</Notice></View> : null}
              {mode === 'ONLINE' ? <View style={{ marginTop: 12 }}><Notice icon="lock-closed-outline">You will pay on Razorpay's secure page. Zenvy confirms your place only after Razorpay confirms the payment, never from the app screen alone.</Notice></View> : null}
            </>
          ) : null}

          {step === 'review' ? (
            <>
              <Text style={styles(p).h}>Review & confirm</Text>
              <EventSummary ev={ev} p={p} slotLabel={held?.slot ? `${fmtClock(held.slot.startAt)}–${fmtClock(held.slot.endAt)}` : undefined} />
              <Card>
                <Row label="Type" value={teamId ? 'Team registration' : regId || slotId ? 'Slot booking' : 'Individual'} />
                {questions.length ? <Row label="Answers" value={`${Object.keys(cleanAnswers()).length} of ${questions.length}`} /> : null}
                <Row label="Payment" value={isFree ? 'Free' : mode ? PAYMENT_MODE_LABEL[mode] : '—'} />
                <Row label="Total" value={isFree ? 'Free' : inr(total)} strong />
                {ev.approvalRequired ? <Text style={{ color: p.warn, fontSize: 12, marginTop: 6, fontWeight: '700' }}>The organizer approves each registration. Your ticket appears once approved.</Text> : null}
              </Card>
            </>
          ) : null}

          {step === 'done' && result ? <Done result={result} ev={ev} /> : null}
        </ScrollView>

        {step !== 'done' ? (
          <View style={{ padding: 16, paddingBottom: 24, borderTopWidth: 1, borderTopColor: p.border, backgroundColor: p.bg, flexDirection: 'row', gap: 10 }}>
            {idx > 0 ? <Btn label="Back" kind="secondary" onPress={back} style={{ flex: 1 }} /> : null}
            {step === 'review'
              ? <Btn label={wantWaitlist || slotId ? 'Join waitlist' : isFree ? 'Confirm registration' : mode === 'VENUE' ? 'Reserve · pay at venue' : mode === 'ONLINE' ? 'Continue to payment' : `Pay ${inr(total)} & confirm`} onPress={submit} loading={busy} disabled={!!holdGone || blockedPaid} style={{ flex: 2 }} />
              : <Btn label="Continue" onPress={next} disabled={!!holdGone || blockedPaid} style={{ flex: 2 }} />}
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </View>
  );
}

const needsVerify = (e: any) => ['VERIFICATION_REQUIRED', 'CAMPUS_REQUIRED'].includes(e?.code) || ['VERIFICATION_REQUIRED', 'CAMPUS_REQUIRED'].includes(e?.data?.reason);

const styles = (p: ReturnType<typeof usePalette>) => ({
  h: { fontSize: 18, fontWeight: '900' as const, color: p.text, marginBottom: 4, letterSpacing: -0.3 },
  sub: { fontSize: 12.5, color: p.sub, marginBottom: 12 },
});

function Progress({ steps, idx }: { steps: Step[]; idx: number }) {
  const p = usePalette();
  const names: Record<Step, string> = { profile: 'Profile', questions: 'Questions', rules: 'Rules', payment: 'Payment', review: 'Confirm', done: 'Done' };
  return (
    <View style={{ marginBottom: 16 }} accessibilityLabel={`Step ${idx + 1} of ${steps.length}: ${names[steps[idx]]}`}>
      <View style={{ flexDirection: 'row', gap: 4 }}>
        {steps.map((s, i) => <View key={s} style={{ flex: 1, height: 5, borderRadius: 3, backgroundColor: i <= idx ? p.accent : p.card2 }} />)}
      </View>
      <Text style={{ fontSize: 12, color: p.sub, fontWeight: '800', marginTop: 6 }}>Step {idx + 1} of {steps.length} · {names[steps[idx]]}</Text>
    </View>
  );
}

function EventSummary({ ev, p, slotLabel }: { ev: EventDetail; p: ReturnType<typeof usePalette>; slotLabel?: string }) {
  return (
    <Card>
      <Text style={{ fontSize: 15, fontWeight: '900', color: p.text }}>{ev.title}</Text>
      <Text style={{ fontSize: 12.5, color: p.sub, marginTop: 4 }}><Ionicons name="calendar-outline" size={13} color={p.sub} /> {fmtRange(ev.startAt, ev.endAt)}</Text>
      {slotLabel ? <Text style={{ fontSize: 12.5, color: p.sub, marginTop: 2 }}><Ionicons name="timer-outline" size={13} color={p.sub} /> Your slot: {slotLabel}</Text> : null}
      {ev.venue ? <Text style={{ fontSize: 12.5, color: p.sub, marginTop: 2 }}><Ionicons name="location-outline" size={13} color={p.sub} /> {ev.venue}</Text> : null}
    </Card>
  );
}

function QuestionInput({ q, value, onChange, error }: { q: Question; value: any; onChange: (v: any) => void; error?: string }) {
  const p = usePalette();
  if (q.type === 'CHOICE' || q.type === 'MULTI_CHOICE' || q.type === 'YES_NO') {
    const opts = q.type === 'YES_NO' ? [{ key: 'yes', label: 'Yes' }, { key: 'no', label: 'No' }] : (q.options || []).map((o) => ({ key: o, label: o }));
    const v = q.type === 'YES_NO' ? (value === true ? 'yes' : value === false ? 'no' : null) : value ?? (q.type === 'MULTI_CHOICE' ? [] : null);
    return (
      <View style={{ marginBottom: 16 }}>
        <Text style={{ fontSize: 12, fontWeight: '800', letterSpacing: 0.2, marginBottom: 8, color: p.sub }}>{q.label}{q.required ? <Text style={{ color: p.danger }}> *</Text> : null}</Text>
        <Chips multi={q.type === 'MULTI_CHOICE'} value={v} options={opts} accessibilityLabel={q.label}
          onChange={(nv: any) => onChange(q.type === 'YES_NO' ? nv === 'yes' : nv)} />
        {error ? <Text style={{ color: p.danger, fontSize: 12, marginTop: 4 }} accessibilityLiveRegion="polite">{error}</Text> : null}
      </View>
    );
  }
  return (
    <Field label={q.label} required={q.required} error={error || null} value={value === undefined || value === null ? '' : String(value)} onChangeText={onChange}
      multiline={q.type === 'LONG_TEXT'} keyboardType={q.type === 'NUMBER' ? 'numeric' : 'default'} maxLength={q.type === 'NUMBER' ? 12 : q.maxLength || 1000}
      hint={q.type !== 'NUMBER' && q.maxLength ? `Up to ${q.maxLength} characters` : undefined} />
  );
}

function Done({ result, ev }: { result: { registration: Registration; waitlisted?: boolean }; ev: EventDetail }) {
  const p = usePalette();
  const router = useRouter();
  const r = result.registration;
  const m = REG_STATUS_META[r.status];
  const status = useCampusEventsStatus();
  // Online pay (Razorpay) shows only while the server switch is on; it is off in production for now.
  const canPayOnline = r.status === 'PENDING_PAYMENT' && r.payment?.mode === 'ONLINE' && !!status?.onlinePayEnabled;
  const ticket = r.tickets.find((t) => t.status === 'ACTIVE');
  const headline = r.status === 'CONFIRMED' ? "You're registered" : r.status === 'WAITLISTED' ? "You're on the waitlist" : r.status === 'PENDING_APPROVAL' ? 'Registration sent' : r.status === 'PENDING_PAYMENT' ? (canPayOnline ? 'Complete your payment' : 'Payment pending') : m.label;
  return (
    <View style={{ alignItems: 'stretch' }}>
      <View style={{ alignItems: 'center', paddingVertical: 16 }}>
        <Ionicons name={r.status === 'CONFIRMED' ? 'checkmark-circle' : m.icon} size={56} color={r.status === 'CONFIRMED' ? p.success : p.accent} />
        <Text style={{ fontSize: 22, fontWeight: '900', color: p.text, marginTop: 8, textAlign: 'center' }} accessibilityRole="header">{headline}</Text>
        <Text style={{ fontSize: 13, color: p.sub, marginTop: 4, textAlign: 'center' }}>{ev.title}</Text>
      </View>
      <Card style={{ alignItems: 'center' }}>
        <Text style={{ fontSize: 12, fontWeight: '800', color: p.muted, letterSpacing: 0.2 }}>Registration code</Text>
        <Text style={{ fontSize: 26, fontWeight: '900', color: p.text, letterSpacing: 2, marginTop: 4 }} selectable accessibilityLabel={`Registration code ${r.code.split('').join(' ')}`}>{r.code}</Text>
        <View style={{ flexDirection: 'row', gap: 6, marginTop: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
          <RegStatusPill status={r.status} />
          {r.payment && r.payment.status !== 'NONE' ? <Pill label={PAYMENT_STATUS_LABEL[r.payment.status]} color={r.payment.status === 'DUE_AT_VENUE' || r.payment.status === 'PENDING' ? '#D97706' : '#059669'} /> : null}
        </View>
      </Card>
      {r.status === 'CONFIRMED' && r.payment?.status === 'DUE_AT_VENUE' ? <Notice tone="warn" icon="cash-outline">Pay {inr(r.payment.total)} at the venue desk before entry.</Notice> : null}
      {r.status === 'PENDING_APPROVAL' ? <Notice icon="time-outline">The organizer will review your registration. You will get a notification, and your ticket appears here once approved.</Notice> : null}
      {r.status === 'WAITLISTED' ? <Notice icon="list-outline">If a place opens, you are moved in automatically{!ev.price.isFree ? ' or offered the place to confirm' : ''}. We will notify you.</Notice> : null}
      {r.status === 'PENDING_PAYMENT' ? <Notice tone="warn" icon="time-outline">{r.payment?.payBy ? `Your place is held until ${fmtWhen(r.payment.payBy)}. ` : ''}It is confirmed only after the payment succeeds.</Notice> : null}
      {ticket ? <Btn label="View my QR ticket" icon="ticket-outline" onPress={() => router.replace(`/campus-events/ticket/${ticket.id}` as any)} style={{ marginTop: 4 }} /> : null}
      {canPayOnline ? <Btn label="Pay now" onPress={() => router.replace(`/campus-events/registration/${r.id}?pay=1` as any)} style={{ marginTop: 4 }} /> : null}
      <Btn label="Registration details" kind="secondary" onPress={() => router.replace(`/campus-events/registration/${r.id}` as any)} style={{ marginTop: 10 }} />
      <TouchableOpacity onPress={() => router.replace('/campus-events/my' as any)} accessibilityRole="button" style={{ minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 6 }}>
        <Text style={{ color: p.accent, fontWeight: '900' }}>My registrations</Text>
      </TouchableOpacity>
    </View>
  );
}
