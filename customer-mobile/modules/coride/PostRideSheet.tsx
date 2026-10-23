/**
 * Co-Ride "Post a ride" sheet. The form state lives in app/(tabs)/others.tsx (so the submit handler and
 * the POST /api/bikepool/posts payload stay exactly as before); this file is the layout, quick picks and
 * inline validation. Autos are not offered here: they belong to Zenvy Auto (onOpenAuto).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TextInput, Modal, StyleSheet, Platform, useWindowDimensions } from 'react-native';
import { PressScale } from '../others/motion';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAvoidingView } from '../../components/KeyboardAvoidingView';
import { useCoRidePalette, Segmented, CoBtn } from './CoRideUI';
import { fmtRideWhen, inr, sameDestination } from './coRideFormat';

const FROM_PICKS = ['Campus Gate', 'Hostel Sector', 'Amaravathi Center', 'Vijayawada Stn', 'Guntur Bus Stand'];
const TO_PICKS = ['PVP Square Mall', 'Vijayawada Stn', 'Gannavaram Airport', 'Trendset Mall', 'Mangalagiri D-Mart', 'Main Campus'];

// Stored values are unchanged (the server keeps them as short text); only the labels are new.
const VIBES = [
  { key: 'Any', label: 'No preference' },
  { key: 'Silent Ride 🤫', label: 'Quiet' },
  { key: 'Chatty 💬', label: 'Chatty' },
] as const;

/** Seat limits per vehicle (the submit handler applies the same caps). */
export const maxSeatsFor = (vehicle: string) => (vehicle === 'Car' ? 4 : 1);

type TimePick = { key: string; label: string; make: () => Date };
const timePicks = (): TimePick[] => {
  const now = new Date();
  const at = (addDays: number, h: number) => () => { const d = new Date(); d.setDate(d.getDate() + addDays); d.setHours(h, 0, 0, 0); return d; };
  const list: TimePick[] = [
    { key: '15m', label: 'In 15 min', make: () => new Date(Date.now() + 15 * 60000) },
    { key: '1h', label: 'In 1 hour', make: () => new Date(Date.now() + 60 * 60000) },
  ];
  if (now.getHours() < 19) list.push({ key: 'tonight', label: 'Tonight, 8 pm', make: at(0, 20) });
  list.push({ key: 'tm8', label: 'Tomorrow, 8 am', make: at(1, 8) });
  list.push({ key: 'tm17', label: 'Tomorrow, 5 pm', make: at(1, 17) });
  return list;
};

export type PostRideSheetProps = {
  visible: boolean;
  onClose: () => void;
  creatorRole: 'rider' | 'passenger';
  setCreatorRole: (v: 'rider' | 'passenger') => void;
  origin: string; setOrigin: (v: string) => void;
  destination: string; setDestination: (v: string) => void;
  departureTime: string; setDepartureTime: (v: string) => void;
  setDepartureDate: (d: Date | null) => void;
  vehicleType: string; setVehicleType: (v: string) => void;
  availableSeats: string; setAvailableSeats: (v: string) => void;
  estimatedFuelCost: string; setEstimatedFuelCost: (v: string) => void;
  notes: string; setNotes: (v: string) => void;
  rideVibe: string; setRideVibe: (v: string) => void;
  autoApprove: boolean; setAutoApprove: (v: boolean) => void;
  submitting: boolean;
  onSubmit: () => void;
  onOpenAuto: () => void;
};

export default function PostRideSheet(props: PostRideSheetProps) {
  const {
    visible, onClose, creatorRole, setCreatorRole, origin, setOrigin, destination, setDestination,
    departureTime, setDepartureTime, setDepartureDate, vehicleType, setVehicleType, availableSeats, setAvailableSeats,
    estimatedFuelCost, setEstimatedFuelCost, notes, setNotes, rideVibe, setRideVibe, autoApprove, setAutoApprove,
    submitting, onSubmit, onOpenAuto,
  } = props;
  const p = useCoRidePalette();
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const [tried, setTried] = useState(false);
  const [timeKey, setTimeKey] = useState<string | null>(null);
  const picks = useMemo(timePicks, [visible]);
  // Bike pool posts are Bike or Car only (autos are Zenvy Auto).
  useEffect(() => { if (visible && vehicleType !== 'Bike' && vehicleType !== 'Car') setVehicleType('Bike'); }, [visible, vehicleType, setVehicleType]);

  const vehicle = vehicleType === 'Car' ? 'Car' : 'Bike';
  const maxSeats = maxSeatsFor(vehicle);
  const seats = Math.min(maxSeats, Math.max(1, parseInt(availableSeats, 10) || 1));
  const fuel = Math.max(0, Math.round(Number(estimatedFuelCost) || 0));
  const isRider = creatorRole === 'rider';

  const errors = {
    origin: !origin.trim() ? 'Add where you start from.' : '',
    destination: !destination.trim() ? 'Add where you are going.'
      : origin.trim() && sameDestination(origin, destination) ? 'From and To are the same place.' : '',
    time: !departureTime.trim() ? 'Pick when you leave.' : '',
  };
  const hasErrors = !!(errors.origin || errors.destination || errors.time);

  const pickVehicle = (v: 'Bike' | 'Car') => {
    setVehicleType(v);
    const cap = maxSeatsFor(v);
    if ((parseInt(availableSeats, 10) || 1) > cap) setAvailableSeats(String(cap));
  };

  const submit = () => {
    setTried(true);
    if (hasErrors) return;
    if (String(seats) !== availableSeats) setAvailableSeats(String(seats));
    onSubmit();
  };

  const close = () => { setTried(false); onClose(); };

  const input = (extra?: object) => [st.input, { borderColor: p.border, backgroundColor: p.surfaceAlt, color: p.text }, extra];
  const errText = (msg: string) => (tried && msg ? (
    <View style={st.errRow} accessibilityLiveRegion="polite">
      <Ionicons name="alert-circle-outline" size={14} color={p.error} />
      <Text style={[st.err, { color: p.error }]}>{msg}</Text>
    </View>
  ) : null);

  const chips = (items: { key: string; label: string; on: boolean; onPress: () => void }[]) => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={st.chips}>
      {items.map(c => (
        <PressScale
          key={c.key}
          style={[st.chip, { backgroundColor: c.on ? p.button : p.surface, borderColor: c.on ? p.button : p.border }]}
          onPress={c.onPress}
          hitSlop={{ top: 6, bottom: 6 }}
          accessibilityRole="button"
          accessibilityState={{ selected: c.on }}
          accessibilityLabel={c.label}
        >
          <Text style={[st.chipText, { color: c.on ? '#FFFFFF' : p.text }]}>{c.label}</Text>
        </PressScale>
      ))}
    </ScrollView>
  );

  const label = (t: string, hint?: string) => (
    <View style={st.labelRow}>
      <Text style={[st.label, { color: p.text }]}>{t}</Text>
      {hint ? <Text style={[st.hint, { color: p.muted }]}>{hint}</Text> : null}
    </View>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <View style={[st.overlay, { backgroundColor: p.isDark ? 'rgba(0,0,0,0.65)' : 'rgba(0,0,0,0.45)' }]}>
          <PressScale style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close" accessibilityRole="button" />
          <View style={[st.sheet, { backgroundColor: p.surface, height: Math.round(winH * 0.92) }]}>
            <View style={[st.grabber, { backgroundColor: p.border }]} />
            <View style={[st.head, { borderBottomColor: p.divider }]}>
              <Text style={[st.title, { color: p.text }]} accessibilityRole="header">Post a ride</Text>
              <PressScale style={[st.close, { backgroundColor: p.surfaceAlt }]} onPress={close} accessibilityRole="button" accessibilityLabel="Close">
                <Ionicons name="close" size={20} color={p.text} />
              </PressScale>
            </View>

            <ScrollView style={{ flex: 1 }} contentContainerStyle={st.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
              {/* Role */}
              {label('You are')}
              <Segmented
                label="You are"
                value={creatorRole}
                onChange={setCreatorRole}
                options={[
                  { key: 'rider', label: 'I have a vehicle', icon: 'key-outline' },
                  { key: 'passenger', label: 'I need a ride', icon: 'person-outline' },
                ]}
              />
              <Text style={[st.helper, { color: p.sub }]}>
                {isRider ? 'You have a bike or car and seats to share.' : 'You need a seat. Students with a vehicle can ride with you.'}
              </Text>

              {/* Route */}
              <View style={st.section}>
                {label('From')}
                <TextInput
                  style={input(tried && errors.origin ? { borderColor: p.error } : undefined)}
                  placeholder="Pickup point, e.g. Campus Gate"
                  placeholderTextColor={p.muted}
                  maxLength={80}
                  value={origin}
                  onChangeText={setOrigin}
                  accessibilityLabel="From"
                />
                {errText(errors.origin)}
                {chips(FROM_PICKS.map(c => ({ key: c, label: c, on: origin === c, onPress: () => setOrigin(c) })))}
              </View>

              <View style={st.section}>
                {label('To')}
                <TextInput
                  style={input(tried && errors.destination ? { borderColor: p.error } : undefined)}
                  placeholder="Destination, e.g. PVP Square Mall"
                  placeholderTextColor={p.muted}
                  maxLength={80}
                  value={destination}
                  onChangeText={setDestination}
                  accessibilityLabel="To"
                />
                {errText(errors.destination)}
                {chips(TO_PICKS.map(c => ({ key: c, label: c, on: destination === c, onPress: () => setDestination(c) })))}
              </View>

              {/* Time */}
              <View style={st.section}>
                {label('Leaving')}
                <TextInput
                  style={input(tried && errors.time ? { borderColor: p.error } : undefined)}
                  placeholder="e.g. 18:30 or 6:30 pm"
                  placeholderTextColor={p.muted}
                  maxLength={40}
                  value={departureTime}
                  onChangeText={t => { setDepartureTime(t); setDepartureDate(null); setTimeKey(null); }}
                  accessibilityLabel="Departure time"
                />
                {errText(errors.time)}
                {chips(picks.map(t => ({
                  key: t.key, label: t.label, on: timeKey === t.key,
                  onPress: () => { const d = t.make(); setDepartureDate(d); setDepartureTime(fmtRideWhen(d).label); setTimeKey(t.key); },
                })))}
              </View>

              {/* Vehicle + seats */}
              <View style={st.section}>
                {label(isRider ? 'Vehicle' : 'Vehicle you prefer')}
                <Segmented
                  label="Vehicle"
                  value={vehicle}
                  onChange={pickVehicle}
                  options={[
                    { key: 'Bike', label: 'Bike', icon: 'motorbike', iconSet: 'mci' },
                    { key: 'Car', label: 'Car', icon: 'car-side', iconSet: 'mci' },
                  ]}
                />
                <PressScale style={st.autoLink} onPress={onOpenAuto} accessibilityRole="link" accessibilityLabel="Need an auto? Book a seat in Zenvy Auto">
                  <Text style={[st.helper, { color: p.sub, marginTop: 0 }]}>
                    Need an auto? <Text style={{ color: p.accent, fontWeight: '700' }}>Book a seat in Zenvy Auto</Text>
                  </Text>
                </PressScale>
              </View>

              <View style={[st.section, st.seatRow]}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[st.label, { color: p.text }]}>{isRider ? 'Seats you can offer' : 'Seats you need'}</Text>
                  <Text style={[st.helper, { color: p.sub, marginTop: 2 }]}>{vehicle === 'Bike' ? 'A bike takes one pillion rider.' : 'Up to 4 in a car.'}</Text>
                </View>
                <View style={st.stepper} accessibilityRole="adjustable" accessibilityLabel={`Seats: ${seats}`}
                  accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
                  onAccessibilityAction={e => {
                    if (e.nativeEvent.actionName === 'increment' && seats < maxSeats) setAvailableSeats(String(seats + 1));
                    if (e.nativeEvent.actionName === 'decrement' && seats > 1) setAvailableSeats(String(seats - 1));
                  }}>
                  {[
                    { icon: 'remove', next: seats - 1, off: seats <= 1, a11y: 'Fewer seats' },
                    null,
                    { icon: 'add', next: seats + 1, off: seats >= maxSeats, a11y: 'More seats' },
                  ].map((b, i) => b ? (
                    <PressScale
                      key={i}
                      style={[st.stepBtn, { borderColor: p.border, backgroundColor: p.surface, opacity: b.off ? 0.4 : 1 }]}
                      disabled={b.off}
                      onPress={() => setAvailableSeats(String(b.next))}
                      accessibilityRole="button"
                      accessibilityLabel={b.a11y}
                      accessibilityState={{ disabled: b.off }}
                    >
                      <Ionicons name={b.icon as any} size={18} color={p.text} />
                    </PressScale>
                  ) : (
                    <Text key={i} style={[st.stepVal, { color: p.text }]}>{seats}</Text>
                  ))}
                </View>
              </View>

              {/* Fuel */}
              <View style={st.section}>
                {label('Fuel cost to split (₹)')}
                <View style={[st.input, st.moneyBox, { borderColor: p.border, backgroundColor: p.surfaceAlt }]}>
                  <Text style={[st.rupee, { color: p.sub }]}>₹</Text>
                  <TextInput
                    style={[st.moneyInput, { color: p.text }]}
                    placeholder="0"
                    placeholderTextColor={p.muted}
                    value={estimatedFuelCost === '0' ? '' : estimatedFuelCost}
                    onChangeText={t => setEstimatedFuelCost(t.replace(/[^0-9]/g, '') || '0')}
                    keyboardType="number-pad"
                    maxLength={4}
                    accessibilityLabel="Fuel cost to split, in rupees"
                  />
                </View>
                <Text style={[st.helper, { color: p.sub }]}>Shown to riders as a per-person share</Text>
                <Text style={[st.helper, { color: p.muted, marginTop: 2 }]}>
                  {fuel > 0 ? `${inr(Math.ceil(fuel / (seats + 1)))} each when ${seats === 1 ? 'your seat is' : `all ${seats} seats are`} taken.` : 'Leave empty for a free ride.'}
                </Text>
              </View>

              {/* Preferences */}
              <View style={st.section}>
                {label('Ride preference')}
                <Segmented
                  label="Ride preference"
                  value={(VIBES.some(v => v.key === rideVibe) ? rideVibe : 'Any') as (typeof VIBES)[number]['key']}
                  onChange={setRideVibe}
                  options={VIBES.map(v => ({ key: v.key, label: v.label }))}
                />
              </View>

              <View style={st.section}>
                {label('Who can join')}
                <Segmented
                  label="Who can join"
                  value={autoApprove ? 'any' : 'approve'}
                  onChange={v => setAutoApprove(v === 'any')}
                  options={[
                    { key: 'approve', label: 'I approve' },
                    { key: 'any', label: 'Anyone' },
                  ]}
                />
                <Text style={[st.helper, { color: p.sub }]}>
                  {autoApprove ? 'Students join straight away while seats are left.' : 'You approve each request before someone joins.'}
                </Text>
              </View>

              <View style={st.section}>
                {label('Notes', 'Optional')}
                <TextInput
                  style={input({ minHeight: 80, textAlignVertical: 'top', paddingTop: 12 })}
                  placeholder="e.g. Extra helmet available, leaving on time"
                  placeholderTextColor={p.muted}
                  maxLength={200}
                  multiline
                  value={notes}
                  onChangeText={setNotes}
                  accessibilityLabel="Notes, optional"
                />
                <Text style={[st.hint, { color: p.muted, alignSelf: 'flex-end', marginTop: 4 }]}>{notes.length}/200</Text>
              </View>
            </ScrollView>

            <View style={[st.footer, { borderTopColor: p.divider, paddingBottom: 12 + Math.max(insets.bottom, 4) }]}>
              {tried && hasErrors ? (
                <Text style={[st.err, { color: p.error, marginBottom: 8, textAlign: 'center' }]}>Fill in the highlighted details to post.</Text>
              ) : null}
              <CoBtn label="Post ride" onPress={submit} loading={submitting} style={{ minHeight: 48 }} />
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const st = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, width: '100%', maxWidth: 600, alignSelf: 'center', overflow: 'hidden' },
  grabber: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginTop: 8 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth * 2 },
  title: { fontSize: 18, fontWeight: '600' },
  close: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  body: { padding: 16, paddingBottom: 24 },
  section: { marginTop: 20 },
  labelRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 },
  label: { fontSize: 14, fontWeight: '600' },
  hint: { fontSize: 12 },
  helper: { fontSize: 13, lineHeight: 18, marginTop: 8 },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, fontSize: 15 },
  errRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  err: { fontSize: 13 },
  chips: { gap: 8, paddingTop: 10, paddingRight: 16 },
  chip: { minHeight: 36, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, justifyContent: 'center' },
  chipText: { fontSize: 13, fontWeight: '500' },
  autoLink: { minHeight: 44, justifyContent: 'center', marginTop: 2 },
  seatRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  stepBtn: { width: 44, height: 44, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  stepVal: { minWidth: 32, textAlign: 'center', fontSize: 17, fontWeight: '600' },
  moneyBox: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rupee: { fontSize: 15, fontWeight: '500' },
  moneyInput: { flex: 1, minHeight: 46, fontSize: 15, fontWeight: '600' },
  footer: { paddingHorizontal: 16, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth * 2 },
});
