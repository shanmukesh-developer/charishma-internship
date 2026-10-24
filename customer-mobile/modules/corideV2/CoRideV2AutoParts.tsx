/** Co-Ride v2 · Shared auto: the seat-count stepper (the seat map itself is modules/autoRide/SeatMap). */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { CR, W } from './coRideV2Theme';
import { Tap } from './CoRideV2Kit';
import { IMinus, IPlus, STROKE } from './CoRideV2Icons';

export function SeatStepper({ value, max, onChange }: { value: number; max: number; onChange: (n: number) => void }) {
  return (
    <View style={st.stepper} accessibilityRole="adjustable" accessibilityLabel={`Seats to book: ${value}`}>
      <Tap onPress={() => onChange(Math.max(1, value - 1))} disabled={value <= 1} label="Fewer seats" style={st.stepBtn}><IMinus size={17} color={CR.ink} strokeWidth={STROKE} /></Tap>
      <Text style={st.stepVal}>{value}</Text>
      <Tap onPress={() => onChange(Math.min(max, value + 1))} disabled={value >= max} label="More seats" style={st.stepBtn}><IPlus size={17} color={CR.ink} strokeWidth={STROKE} /></Tap>
    </View>
  );
}

const st = StyleSheet.create({
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: CR.field, borderRadius: 999, padding: 3 },
  stepBtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  stepVal: { fontSize: 17, fontWeight: W.title, color: CR.ink, minWidth: 18, textAlign: 'center' },
});
