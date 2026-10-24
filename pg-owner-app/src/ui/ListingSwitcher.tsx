// "Which PG?" picker for owners with more than one listing (header chip + sheet). One PG: nothing shown.
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { color, font, radius, space } from '../theme';
import { Sheet } from './kit';
import { useListing } from '../state/ListingProvider';

export function ListingSwitcher() {
  const { listings, current, select } = useListing();
  const [open, setOpen] = useState(false);
  if (listings.length < 2 || !current) return null;
  return (
    <>
      <Pressable onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel={`PG: ${current.name}. Change`} style={st.chip}>
        <Ionicons name="business-outline" size={15} color={color.primaryDark} />
        <Text style={[font.small, { color: color.primaryDark, fontWeight: '700', maxWidth: 140 }]} numberOfLines={1}>{current.name}</Text>
        <Ionicons name="chevron-down" size={14} color={color.primaryDark} />
      </Pressable>
      <Sheet visible={open} onClose={() => setOpen(false)} title="Choose your PG">
        <View style={{ gap: space.xs }}>
          {listings.map((l) => {
            const on = l.id === current.id;
            return (
              <Pressable key={l.id} onPress={() => { select(l.id); setOpen(false); }} accessibilityRole="radio" accessibilityState={{ selected: on }}
                style={[st.row, on && { borderColor: color.primary, backgroundColor: color.primaryTint }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[font.h3, { color: color.text }]}>{l.name}</Text>
                  {l.area || !l.isActive ? <Text style={[font.small, { color: color.textMuted }]}>{[l.area, l.isActive ? '' : 'Hidden from students'].filter(Boolean).join(' · ')}</Text> : null}
                </View>
                {on ? <Ionicons name="checkmark-circle" size={22} color={color.primary} /> : null}
              </Pressable>
            );
          })}
        </View>
      </Sheet>
    </>
  );
}

const st = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: color.primaryTint, borderRadius: radius.pill, paddingHorizontal: space.sm, minHeight: 34 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderWidth: 1.5, borderColor: color.border, borderRadius: radius.md, padding: space.sm, minHeight: 56 },
});
