/**
 * ZCS Auto booking: where the passenger is in the journey, driven only by the server's booking + trip state.
 *   Booked -> Go to the auto -> Show your PIN to the driver -> Checked in -> On the way -> Reached
 * - JourneyNow: the one "what to do now" card at the top (the big PIN when the auto is leaving and they are not
 *   checked in yet: "Show PIN 1234 to the driver now").
 * - JourneySteps: the same six steps as a vertical stepper (same dots + line look as the old trip timeline).
 * - MissedCard: a booking marked not here (NO_SHOW): what happened and what to do (the driver can still check them
 *   in with the PIN until lateCheckInUntil; otherwise Report a problem). There is no self check-in: the PIN shown to
 *   the driver is the only proof.
 */
import React from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card, Btn, usePalette } from './ui';
import { fmtClock, mmss, type Booking, type TripStatus } from './autoRideApi';

export type StepKey = 'booked' | 'go' | 'pin' | 'in' | 'way' | 'reached';
const STEPS: { key: StepKey; label: string }[] = [
  { key: 'booked', label: 'Booked' },
  { key: 'go', label: 'Go to the auto' },
  { key: 'pin', label: 'Show your PIN to the driver' },
  { key: 'in', label: 'Checked in' },
  { key: 'way', label: 'On the way' },
  { key: 'reached', label: 'Reached' },
];
const AT_STAND: TripStatus[] = ['PUBLISHED', 'OPEN_FOR_BOOKING', 'DEPARTURE_THRESHOLD_REACHED', 'FULL', 'DELAYED'];
const LEAVING: TripStatus[] = ['DRIVER_CONFIRMED', 'BOARDING', 'IN_PROGRESS'];
const seatWord = (ns: number[], count: number) => (ns.length ? `Seat${ns.length === 1 ? '' : 's'} ${ns.join(', ')}` : `${count} seat${count === 1 ? '' : 's'}`);

/** The current step (null = not a journey: hold, cancelled, expired, refunded, not checked in). */
export function currentStep(b: Booking): StepKey | null {
  const st = b.trip?.status;
  if (!st) return null;
  if (b.status === 'COMPLETED' || (b.status === 'BOARDED' && (st === 'COMPLETED' || !!b.trip?.arrivedAt))) return 'reached';
  if (b.status === 'BOARDED') return st === 'IN_PROGRESS' ? 'way' : 'in';
  if (b.status === 'CONFIRMED') {
    if (LEAVING.includes(st)) return 'pin';
    if (AT_STAND.includes(st)) return 'go';
  }
  return null;
}

/** "What to do now": title, one plain line, and whether the big PIN belongs in it. */
function nowCopy(b: Booking, step: StepKey, now: number) {
  const t = b.trip;
  const stand = t?.pickup?.name || 'the stand';
  const reg = t?.vehicle?.registration;
  const driver = t?.driver?.firstName || t?.driver?.name || 'the driver';
  const seats = seatWord(b.seatNumbers, b.seatCount);
  const left = b.arriveBy ? new Date(b.arriveBy).getTime() - now : null;
  switch (step) {
    case 'go': return {
      title: 'Go to the auto',
      line: `${t?.queueState === 'WAITING' ? 'Your auto is waiting in the line' : 'Your auto is'} at ${stand}${reg ? `, auto ${reg}` : ''}, driver ${driver}. When you sit in, show your PIN to the driver so you are checked in.${left !== null && left > 0 ? ` Reach it in ${mmss(left)}.` : ''}`,
      pin: false, tone: 'info' as const,
    };
    case 'pin': return {
      title: b.boardingPin ? `Show PIN ${b.boardingPin} to the driver now` : 'Show your PIN to the driver now',
      line: `${t?.status === 'IN_PROGRESS' ? 'Your auto has started.' : 'Your auto is leaving now.'} Show booking code ${b.bookingCode} and this PIN to ${driver}${reg ? ` (auto ${reg})` : ''}. Anyone not checked in is left behind.`,
      pin: true, tone: 'warn' as const,
    };
    case 'in': return { title: 'You are checked in', line: `${seats}. The trip starts when the driver leaves the stand.`, pin: false, tone: 'success' as const };
    case 'way': return { title: 'On the way', line: `${seats}. You are checked in. Use Report a problem below if anything feels wrong.`, pin: false, tone: 'success' as const };
    default: return { title: 'Reached', line: `${t?.destination ? `You reached ${t.destination}. ` : ''}Thanks for riding with ZENV Auto.`, pin: false, tone: 'success' as const };
  }
}

export function JourneyNow({ b, step, now }: { b: Booking; step: StepKey; now: number }) {
  const p = usePalette();
  const c = nowCopy(b, step, now);
  const fg = c.tone === 'warn' ? p.warn : c.tone === 'success' ? p.success : p.accent;
  const bg = c.tone === 'warn' ? p.warnSoft : c.tone === 'success' ? p.successSoft : p.accentSoft;
  return (
    <Card style={{ backgroundColor: bg, alignItems: c.pin ? 'center' : 'stretch' }}>
      <View accessibilityLiveRegion="polite" accessibilityLabel={`${c.title}. ${c.line}`}>
        <Text style={{ fontSize: 17, fontWeight: '900', color: fg, textAlign: c.pin ? 'center' : 'left' }}>{c.title}</Text>
        {c.pin && b.boardingPin ? (
          <Text style={{ fontSize: 48, fontWeight: '900', color: p.text, letterSpacing: 14, textAlign: 'center', marginTop: 6, fontVariant: ['tabular-nums'] }}
            accessibilityLabel={`PIN ${b.boardingPin.split('').join(' ')}`}>{b.boardingPin}</Text>
        ) : null}
        <Text style={{ fontSize: 13, color: p.text, lineHeight: 19, marginTop: 6, textAlign: c.pin ? 'center' : 'left' }}>{c.line}</Text>
      </View>
    </Card>
  );
}

export function JourneySteps({ b, step }: { b: Booking; step: StepKey }) {
  const p = usePalette();
  const at = STEPS.findIndex((x) => x.key === step);
  const done = step === 'reached';
  const sub = (k: StepKey): string | null => {
    const t = b.trip;
    if (k === 'booked') return `Booking ${b.bookingCode} · ${seatWord(b.seatNumbers, b.seatCount)}`;
    if (k === 'go') return [t?.pickup?.name, t?.vehicle?.registration ? `auto ${t.vehicle.registration}` : null, t?.driver?.firstName || t?.driver?.name].filter(Boolean).join(' · ') || null;
    if (k === 'pin') return b.boardingPin ? `PIN ${b.boardingPin} with code ${b.bookingCode}` : `Code ${b.bookingCode} and your PIN`;
    if (k === 'in') return b.boardedAt ? `${seatWord(b.seatNumbers, b.seatCount)} · at ${fmtClock(b.boardedAt)}` : seatWord(b.seatNumbers, b.seatCount);
    if (k === 'way') return t?.startedAt ? `Started at ${fmtClock(t.startedAt)}` : null;
    return t?.arrivedAt ? `At ${fmtClock(t.arrivedAt)}` : t?.destination || null;
  };
  return (
    <Card>
      <Text style={{ fontSize: 14, fontWeight: '900', color: p.text, marginBottom: 10 }}>Your trip</Text>
      {STEPS.map((x, i) => {
        const isDone = done || i < at;
        const current = !done && i === at;
        const line = sub(x.key);
        return (
          <View key={x.key} style={{ flexDirection: 'row', gap: 10, minHeight: 36 }} accessibilityLabel={`${x.label}${current ? ', now' : isDone ? ', done' : ''}`}>
            <View style={{ alignItems: 'center', width: 18 }}>
              <View style={{ width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: isDone || current ? p.button : p.border, backgroundColor: isDone ? p.button : current ? p.accentSoft : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                {isDone ? <Ionicons name="checkmark" size={11} color="#FFFFFF" /> : null}
              </View>
              {i < STEPS.length - 1 ? <View style={{ width: 2, flex: 1, backgroundColor: isDone ? p.button : p.border }} /> : null}
            </View>
            <View style={{ flex: 1, paddingBottom: 8 }}>
              <Text style={{ fontSize: 13, fontWeight: current ? '900' : '700', color: isDone || current ? p.text : p.muted }}>{x.label}</Text>
              {(current || isDone) && line ? <Text style={{ fontSize: 12, color: p.sub }}>{line}</Text> : null}
            </View>
          </View>
        );
      })}
      <Text style={{ fontSize: 12, color: p.muted }}>Steps move when the driver checks you in and starts the trip. Live location is not shown.</Text>
    </Card>
  );
}

/** NO_SHOW: what happened, and what to do now. */
export function MissedCard({ b, now, onReport }: { b: Booking; now: number; onReport: () => void }) {
  const p = usePalette();
  const st = b.trip?.status;
  const left = b.lateCheckInUntil ? new Date(b.lateCheckInUntil).getTime() - now : 0;
  const canLate = left > 0;
  const leftAuto = !!st && ['IN_PROGRESS', 'COMPLETED', 'BOARDING', 'DRIVER_CONFIRMED'].includes(st);
  const title = leftAuto ? 'Your auto left without checking you in' : 'Your seat was released';
  const why = leftAuto
    ? 'The driver started the trip before your booking code and PIN were checked.'
    : b.cancelReason ? `${b.cancelReason}.` : 'You were not checked in on time.';
  return (
    <Card style={{ backgroundColor: p.dangerSoft }}>
      <Text style={{ fontSize: 17, fontWeight: '900', color: p.danger }}>{title}</Text>
      <Text style={{ fontSize: 13, color: p.text, lineHeight: 19, marginTop: 6 }}>{why}</Text>
      {canLate ? (
        <>
          <Text style={{ fontSize: 13, color: p.text, lineHeight: 19, marginTop: 8, fontWeight: '700' }}>
            If you are in the auto, show the driver booking code {b.bookingCode} and this PIN. The driver can still check you in for {mmss(left)}.
          </Text>
          {b.boardingPin ? (
            <Text style={{ fontSize: 44, fontWeight: '900', color: p.text, letterSpacing: 12, textAlign: 'center', marginTop: 8, fontVariant: ['tabular-nums'] }}
              accessibilityLabel={`PIN ${b.boardingPin.split('').join(' ')}`}>{b.boardingPin}</Text>
          ) : null}
        </>
      ) : (
        <Text style={{ fontSize: 13, color: p.text, lineHeight: 19, marginTop: 8 }}>It is too late to be checked in on this auto now. If you were in the auto, tell us with Report a problem.</Text>
      )}
      <Btn label="Report a problem" kind="secondary" small style={{ marginTop: 12 }} onPress={onReport} />
    </Card>
  );
}
