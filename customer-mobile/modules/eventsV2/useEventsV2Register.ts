/**
 * Registration flow logic (same rules as before, moved out of the screen): profile → questions → rules →
 * payment (only the modes the server offers right now: Free / Pay at the venue / ZCS Wallet when switched on;
 * online only if the server switch is on) → review → done.
 * Modes (query): default = POST /:id/register; ?regId= confirms a HELD slot booking (hold countdown);
 * ?teamId= submits a team (captain); ?waitlist=1 joins the waitlist; ?slotId= waitlists a full slot.
 * Amount, availability and final status always come from the server; retries reuse one idempotency key.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, BackHandler } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import {
  campusEventsApi, CampusEventsError, errorCopy, needsVerification, newIdempotencyKey,
  type EventDetail, type PaymentMode, type Question, type RegisterBody, type Registration,
} from '../campusEvents/campusEventsApi';
import { refreshCampusEventsStatus, useNow } from '../campusEvents/ui';

export type Step = 'profile' | 'questions' | 'rules' | 'payment' | 'review' | 'done';
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || '';

export function useEventsV2Register() {
  const params = useLocalSearchParams<{ id: string | string[]; regId?: string; teamId?: string; waitlist?: string; slotId?: string }>();
  const id = one(params.id);
  const regId = one(params.regId);
  const teamId = one(params.teamId);
  const slotId = one(params.slotId);
  const wantWaitlist = one(params.waitlist) === '1';
  const router = useRouter();
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
      if (regId) setResult({ registration: (await campusEventsApi.confirm(regId, body)).registration });
      else if (teamId) { const r = await campusEventsApi.submitTeam(teamId, body, key.current); setResult({ registration: r.registration, waitlisted: r.waitlisted }); }
      else { const r = await campusEventsApi.register(ev.id, body, key.current); setResult({ registration: r.registration, waitlisted: r.waitlisted }); }
      setStep('done');
    } catch (e: any) {
      const err = e as CampusEventsError;
      if (err?.code === 'IDEMPOTENCY_KEY_REUSED') key.current = newIdempotencyKey();
      const f = err?.field || '';
      if (f.startsWith('answers.')) { setFieldErr({ [f.slice(8)]: err.message }); setStep('questions'); }
      else if (err?.code === 'RULES_CHANGED') { setAcceptRules(false); await load(); setStep('rules'); }
      else if (['PAYMENT_MODE_NOT_OFFERED', 'PAYMENT_METHOD_OFF', 'PAYMENT_NOT_CONFIGURED', 'INSUFFICIENT_WALLET'].includes(err?.code)) { await load(); setStep('payment'); }
      const c = errorCopy(err);
      const full = err?.code === 'EVENT_FULL' || err?.code === 'SLOT_FULL';
      if (err?.code === 'HOLD_EXPIRED') Alert.alert(c.title, c.message, [{ text: 'Pick a slot again', onPress: () => router.replace(`/campus-events/slots/${ev.id}` as any) }]);
      else if (err?.code === 'ALREADY_REGISTERED' && err.data?.registrationId) Alert.alert(c.title, c.message, [{ text: 'OK', style: 'cancel' }, { text: 'View registration', onPress: () => router.replace(`/campus-events/registration/${err.data.registrationId}` as any) }]);
      else if (full) Alert.alert(c.title, err.data?.waitlistEnabled ? `${c.message} You can join the waitlist instead.` : c.message);
      else if (needsVerification(err)) Alert.alert(c.title, c.message, [{ text: 'Later', style: 'cancel' }, { text: 'Verify now', onPress: () => router.push('/friends?screen=verification' as any) }]);
      else Alert.alert(c.title, err?.isNetwork ? `${c.message}\nTap confirm again: it will not register you twice.` : c.message);
    } finally {
      setBusy(false);
    }
  };

  const holdLeft = held?.holdExpiresAt ? new Date(held.holdExpiresAt).getTime() - now : null;
  const holdGone = !!held && (held.status !== 'HELD' || (holdLeft !== null && holdLeft <= 0));
  const title = step === 'done' ? 'You are in' : teamId ? 'Register your team' : regId ? 'Confirm your slot' : wantWaitlist || slotId ? 'Join the waitlist' : isFree ? 'Register' : 'Get your ticket';
  return {
    id, regId, teamId, slotId, wantWaitlist, ev, held, modes, error, step, setStep, steps, idx, answers, setAnswers, fieldErr, setFieldErr,
    acceptRules, setAcceptRules, acceptCancel, setAcceptCancel, mode, setMode, busy, result, load, back, next, submit, cleanAnswers,
    questions, isFree, total, holdLeft, holdGone, title, blockedPaid: !isFree && !modes.length,
  };
}
export type RegisterFlow = ReturnType<typeof useEventsV2Register>;
