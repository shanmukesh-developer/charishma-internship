/**
 * Registration pieces (diet look): the step bar, the event summary with its photo, check rows, payment option
 * cards, organiser question inputs and the dark text field.
 */
import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { fmtRange, type PaymentMode, type Question } from '../campusEvents/campusEventsApi';
import { NIGHT, QUICK, W, hexA } from './eventsV2Theme';
import { themedSheet } from '../../utils/themeNow';
import { Glass, IconSquare, Press } from './EventsV2Kit';
import { EventPhoto } from './EventsV2Media';
import { IBanknote, ICalendar, ICheck, IPin, IWallet, ILock } from './EventsV2Icons';
import { PAY_HINT, PAY_LABEL } from './EventsV2DetailParts';
import type { Step } from './useEventsV2Register';
import type { EvEvent } from './eventsV2Demo';

const NAMES: Record<Step, string> = { profile: 'You', questions: 'Questions', rules: 'Rules', payment: 'Payment', review: 'Confirm', done: 'Done' };

export function StepBar({ steps, idx }: { steps: Step[]; idx: number }) {
  return (
    <View style={{ marginBottom: 18 }} accessibilityLabel={`Step ${idx + 1} of ${steps.length}: ${NAMES[steps[idx]]}`}>
      <View style={{ flexDirection: 'row', gap: 5 }}>
        {steps.map((st, i) => (
          <View key={st} style={s.seg}>
            {i <= idx ? <LinearGradient colors={[NIGHT.violet, NIGHT.pink]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} /> : null}
          </View>
        ))}
      </View>
      <Text style={s.stepText}>Step {idx + 1} of {steps.length} · {NAMES[steps[idx]]}</Text>
    </View>
  );
}

export function Summary({ ev, slotLabel }: { ev: EvEvent; slotLabel?: string }) {
  return (
    <Glass style={{ flexDirection: 'row', padding: 10, marginBottom: 14 }}>
      <View style={s.thumb}><EventPhoto e={ev} scrim={false} iconSize={40} /></View>
      <View style={{ flex: 1, marginLeft: 12, justifyContent: 'center', gap: 4 }}>
        <Text style={s.sumTitle} numberOfLines={2}>{ev.title}</Text>
        <View style={s.row}><ICalendar size={12} color={NIGHT.violet} strokeWidth={1.8} /><Text style={s.rowText} numberOfLines={1}>{slotLabel ? `Your slot ${slotLabel}` : fmtRange(ev.startAt, ev.endAt)}</Text></View>
        {ev.venue ? <View style={s.row}><IPin size={12} color={NIGHT.violet} strokeWidth={1.8} /><Text style={s.rowText} numberOfLines={1}>{ev.venue}</Text></View> : null}
      </View>
    </Glass>
  );
}

export function CheckRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Press onPress={() => onChange(!value)} label={label} style={[s.check, value ? { borderColor: NIGHT.accLine, backgroundColor: NIGHT.accSoft } : null]} scaleTo={0.98}>
      <View style={[s.box, value ? { backgroundColor: NIGHT.violetDeep, borderColor: NIGHT.violet } : null]}>{value ? <ICheck size={15} color={NIGHT.onAcc} strokeWidth={2.4} /> : null}</View>
      <Text style={s.checkText}>{label}</Text>
    </Press>
  );
}

export function PayOption({ m, on, onPress }: { m: PaymentMode; on: boolean; onPress: () => void }) {
  const colors = m === 'WALLET' ? QUICK.regs : m === 'ONLINE' ? QUICK.tickets : QUICK.checkin;
  return (
    <Press onPress={onPress} label={`${PAY_LABEL[m]}. ${PAY_HINT[m]}`} style={[s.pay, on ? s.payOn : null]} scaleTo={0.98}>
      <IconSquare colors={colors} size={40}>
        {m === 'WALLET' ? <IWallet size={19} color={NIGHT.onAcc} strokeWidth={1.8} /> : m === 'ONLINE' ? <ILock size={19} color={NIGHT.onAcc} strokeWidth={1.8} /> : <IBanknote size={19} color={NIGHT.onAcc} strokeWidth={1.8} />}
      </IconSquare>
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={s.payTitle}>{PAY_LABEL[m]}</Text>
        <Text style={s.payHint}>{PAY_HINT[m]}</Text>
      </View>
      <View style={[s.radio, on ? { borderColor: NIGHT.violet } : null]}>{on ? <View style={s.radioDot} /> : null}</View>
    </Press>
  );
}

export function Field({ label, value, onChange, error, multiline, numeric, maxLength, required }: { label: string; value: string; onChange: (v: string) => void; error?: string; multiline?: boolean; numeric?: boolean; maxLength?: number; required?: boolean }) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={s.label}>{label}{required ? <Text style={{ color: NIGHT.accInk }}> *</Text> : null}</Text>
      <TextInput value={value} onChangeText={onChange} placeholderTextColor={NIGHT.faint} accessibilityLabel={label} multiline={multiline} keyboardType={numeric ? 'numeric' : 'default'} maxLength={maxLength}
        style={[s.input, multiline ? { minHeight: 96, textAlignVertical: 'top', paddingTop: 12 } : null, error ? { borderColor: NIGHT.red } : null]} />
      {error ? <Text style={s.err} accessibilityLiveRegion="polite">{error}</Text> : null}
    </View>
  );
}

export function QuestionInput({ q, value, onChange, error }: { q: Question; value: any; onChange: (v: any) => void; error?: string }) {
  if (q.type === 'CHOICE' || q.type === 'MULTI_CHOICE' || q.type === 'YES_NO') {
    const opts = q.type === 'YES_NO' ? ['Yes', 'No'] : q.options || [];
    const isOn = (o: string) => (q.type === 'YES_NO' ? (o === 'Yes' ? value === true : value === false) : q.type === 'MULTI_CHOICE' ? Array.isArray(value) && value.includes(o) : value === o);
    const press = (o: string) => {
      if (q.type === 'YES_NO') onChange(o === 'Yes');
      else if (q.type === 'MULTI_CHOICE') { const arr: string[] = Array.isArray(value) ? value : []; onChange(arr.includes(o) ? arr.filter((x) => x !== o) : [...arr, o]); }
      else onChange(o);
    };
    return (
      <View style={{ marginBottom: 16 }}>
        <Text style={s.label}>{q.label}{q.required ? <Text style={{ color: NIGHT.accInk }}> *</Text> : null}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {opts.map((o) => {
            const on = isOn(o);
            return (
              <Press key={o} onPress={() => press(o)} label={o} style={[s.opt, on ? s.optOn : null]} scaleTo={0.95}>
                {on && q.type === 'MULTI_CHOICE' ? <ICheck size={13} color={NIGHT.onAcc} strokeWidth={2.2} /> : null}
                <Text style={[s.optText, on ? { color: NIGHT.onAcc } : null]}>{o}</Text>
              </Press>
            );
          })}
        </View>
        {error ? <Text style={s.err}>{error}</Text> : null}
      </View>
    );
  }
  return (
    <Field label={q.label} required={q.required} error={error} value={value === undefined || value === null ? '' : String(value)} onChange={onChange}
      multiline={q.type === 'LONG_TEXT'} numeric={q.type === 'NUMBER'} maxLength={q.type === 'NUMBER' ? 12 : q.maxLength || 1000} />
  );
}

const s = themedSheet(() => ({
  seg: { flex: 1, height: 5, borderRadius: 3, backgroundColor: NIGHT.track, overflow: 'hidden' },
  stepText: { color: NIGHT.sub, fontSize: 12, marginTop: 7 },
  thumb: { width: 78, height: 78, borderRadius: 14, overflow: 'hidden' },
  sumTitle: { color: NIGHT.ink, fontSize: 15, fontWeight: W.display },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowText: { color: NIGHT.sub, fontSize: 12, flexShrink: 1 },
  check: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: NIGHT.line, backgroundColor: NIGHT.glass, marginBottom: 10, minHeight: 54 },
  box: { width: 24, height: 24, borderRadius: 8, borderWidth: 1.5, borderColor: NIGHT.border, alignItems: 'center', justifyContent: 'center' },
  checkText: { flex: 1, color: NIGHT.ink, fontSize: 13.5, lineHeight: 19 },
  pay: { flexDirection: 'row', alignItems: 'center', padding: 13, borderRadius: 18, borderWidth: 1, borderColor: NIGHT.line, backgroundColor: NIGHT.card, marginBottom: 10 },
  payOn: { borderColor: NIGHT.violet, backgroundColor: NIGHT.accSoft },
  payTitle: { color: NIGHT.ink, fontSize: 14.5, fontWeight: W.title },
  payHint: { color: NIGHT.sub, fontSize: 12, marginTop: 2 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: NIGHT.border, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: NIGHT.violet },
  label: { color: NIGHT.sub, fontSize: 12.5, fontWeight: W.label, marginBottom: 7 },
  input: { minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: NIGHT.border, backgroundColor: NIGHT.glass, color: NIGHT.ink, paddingHorizontal: 14, fontSize: 14.5 },
  err: { color: NIGHT.red, fontSize: 12, marginTop: 5 },
  opt: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 40, paddingHorizontal: 14, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, borderColor: NIGHT.border, backgroundColor: NIGHT.glass },
  optOn: { backgroundColor: NIGHT.violetDeep, borderColor: NIGHT.violet },
  optText: { color: NIGHT.sub, fontSize: 13, fontWeight: W.label },
}));
