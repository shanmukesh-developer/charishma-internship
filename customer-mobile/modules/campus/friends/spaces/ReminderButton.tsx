import React, { useState } from 'react';
import { Text, TouchableOpacity, ActivityIndicator, StyleSheet, Alert } from 'react-native';
import { Bell, BellRing } from '../../../../components/lucide';
import * as Haptics from 'expo-haptics';
import { FriendsColors, FR } from '../friendsTheme';
import { Space, setSpaceRemind, spaceErrorMessage } from '../api/spacesApi';
import { spaceBus, useSpacesNav } from './spacesShared';

import { themedSheet } from '../../../../utils/themeNow';
/**
 * "Remind me" for a scheduled Space (one push about 10 minutes before it starts, and one if the
 * time changes or it is cancelled). Optimistic; rolls back on error. Hidden for the host.
 */
export const ReminderButton: React.FC<{ space: Space; onChanged?: (s: Space) => void; block?: boolean }> = ({ space, onChanged, block }) => {
  const nav = useSpacesNav();
  const [busy, setBusy] = useState(false);
  if (!space.canRemind && !space.reminded) return null;
  if (space.status !== 'scheduled') return null;

  const toggle = async () => {
    if (busy) return;
    const on = !space.reminded;
    const optimistic: Space = { ...space, reminded: on, interestedCount: Math.max(0, space.interestedCount + (on ? 1 : -1)) };
    onChanged?.(optimistic);
    setBusy(true);
    Haptics.selectionAsync().catch(() => {});
    try {
      const r = await setSpaceRemind(space.id, on);
      const next: Space = { ...optimistic, reminded: !!r.reminded, interestedCount: typeof r.interestedCount === 'number' ? r.interestedCount : optimistic.interestedCount };
      onChanged?.(next);
      spaceBus.emit(next);
    } catch (e: any) {
      onChanged?.(space);
      nav.onGateError(e);
      Alert.alert("Couldn't update the reminder", spaceErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const on = space.reminded;
  return (
    <TouchableOpacity
      style={[styles.btn, on && styles.on, block && { alignSelf: 'stretch', minHeight: 48 }]}
      onPress={toggle}
      disabled={busy}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityState={{ selected: on, busy }}
      accessibilityLabel={on ? 'Reminder on. Tap to turn it off' : 'Remind me before it starts'}
    >
      {busy ? (
        <ActivityIndicator size="small" color={on ? FriendsColors.accentInk : FriendsColors.accent} />
      ) : on ? (
        <BellRing size={15} color={FriendsColors.accentInk} />
      ) : (
        <Bell size={15} color={FriendsColors.accent} />
      )}
      <Text style={[styles.text, on && { color: FriendsColors.accentInk }]}>{on ? 'Reminder on' : 'Remind me'}</Text>
    </TouchableOpacity>
  );
};

const styles = themedSheet(() => ({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: FR.pill,
    borderWidth: 1,
    borderColor: FriendsColors.accent,
  },
  on: { backgroundColor: FriendsColors.accent },
  text: { fontSize: 13, fontWeight: '800', color: FriendsColors.accent },
}));
