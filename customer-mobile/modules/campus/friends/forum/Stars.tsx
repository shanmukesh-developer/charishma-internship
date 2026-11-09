import React from 'react';
import { View, TouchableOpacity, StyleSheet, Text } from 'react-native';
import { Star } from '../../../../components/lucide';
import * as Haptics from 'expo-haptics';
import { FriendsColors } from '../friendsTheme';

import { themedSheet } from '../../../../utils/themeNow';
const RATING_WORDS = ['', 'Poor', 'Below average', 'Okay', 'Good', 'Excellent'];

/** Read-only star row (rounded to the nearest half for display). */
export const Stars: React.FC<{ value: number | null | undefined; size?: number }> = ({ value, size = 14 }) => {
  const v = Math.max(0, Math.min(5, Number(value) || 0));
  return (
    <View style={styles.row} accessible accessibilityLabel={value ? `${v.toFixed(1)} out of 5 stars` : 'No rating yet'}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          size={size}
          color={i <= Math.round(v) ? FriendsColors.gold : FriendsColors.faint}
          fill={i <= Math.round(v) ? FriendsColors.gold : 'transparent'}
        />
      ))}
    </View>
  );
};

/** 1–5 rating picker (each star is a 44 pt radio button). */
export const StarPicker: React.FC<{ value: number; onChange: (v: number) => void }> = ({ value, onChange }) => (
  <View>
    <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel="Rating">
      {[1, 2, 3, 4, 5].map((i) => {
        const on = i <= value;
        return (
          <TouchableOpacity
            key={i}
            onPress={() => {
              onChange(i);
              Haptics.selectionAsync().catch(() => {});
            }}
            style={styles.pick}
            accessibilityRole="radio"
            accessibilityState={{ checked: value === i }}
            accessibilityLabel={`${i} star${i > 1 ? 's' : ''}, ${RATING_WORDS[i]}`}
          >
            <Star size={30} color={on ? FriendsColors.gold : FriendsColors.faint} fill={on ? FriendsColors.gold : 'transparent'} />
          </TouchableOpacity>
        );
      })}
    </View>
    <Text style={styles.word}>{value ? RATING_WORDS[value] : 'Tap to rate'}</Text>
  </View>
);

const styles = themedSheet(() => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  pick: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  word: { fontSize: 12, fontWeight: '700', color: FriendsColors.muted, marginTop: 2, marginLeft: 6 },
}));
