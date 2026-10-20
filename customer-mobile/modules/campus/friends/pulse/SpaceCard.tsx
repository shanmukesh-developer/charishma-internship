import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { Mic, Bell, BellRing, Users, Radio, ChevronRight } from '../../../../components/lucide';
import * as Haptics from 'expo-haptics';
import { FriendsColors, FS, FR, FT, SectionTints } from '../friendsTheme';
import { CardGlow } from '../shared/FriendsUi';
import { IdentityChip } from '../shared/IdentityChip';
import { PulseSpaceCard, setSpaceReminder } from '../api/pulseApi';
import { formatStartsAt, pulseErrorMessage } from './pulseShared';
import { usePulseNav } from './pulseNav';

/**
 * A scheduled or live Space in the Pulse feed. The server sends these only while Spaces is on,
 * so this renders whatever arrives; tapping opens the Space in Friends > Spaces.
 */
export const SpaceCard: React.FC<{ card: PulseSpaceCard; onChanged: (c: PulseSpaceCard) => void }> = ({ card, onChanged }) => {
  const nav = usePulseNav();
  const [busy, setBusy] = useState(false);
  const live = card.status === 'live';

  const toggleRemind = async () => {
    if (busy) return;
    setBusy(true);
    const prev = card;
    const next = { ...card, reminded: !card.reminded, interestedCount: Math.max(0, card.interestedCount + (card.reminded ? -1 : 1)) };
    onChanged(next);
    Haptics.selectionAsync().catch(() => {});
    try {
      const r = await setSpaceReminder(card.spaceId, next.reminded);
      onChanged({
        ...next,
        reminded: typeof r?.reminded === 'boolean' ? r.reminded : next.reminded,
        interestedCount: typeof r?.interestedCount === 'number' ? r.interestedCount : next.interestedCount,
      });
    } catch (e: any) {
      onChanged(prev);
      nav.onGateError(e);
      Alert.alert("Couldn't update the reminder", pulseErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const when = live ? 'Live now' : formatStartsAt(card.scheduledFor);
  const label = `${live ? 'Live Space' : 'Scheduled Space'}: ${card.title}. ${card.topic ? `Topic ${card.topic}. ` : ''}${when}. ${
    live ? `${card.participantCount} listening` : `${card.interestedCount} interested`
  }.`;

  return (
    <View style={[styles.card, live && styles.liveCard]}>
      <CardGlow tint={live ? 'rgba(243,139,128,0.10)' : 'rgba(127,222,196,0.08)'} />
      <TouchableOpacity onPress={() => nav.openSpace(card.spaceId)} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel={label} accessibilityHint="Opens the Space">
        <View style={styles.top}>
          <View style={[styles.badge, live ? styles.badgeLive : null]}>
            {live ? <Radio size={12} color={FriendsColors.danger} /> : <Mic size={12} color={SectionTints.spaces.fg} />}
            <Text style={[styles.badgeText, live && { color: FriendsColors.danger }]}>{live ? 'LIVE SPACE' : 'SPACE'}</Text>
          </View>
          <Text style={[FT.small, { flex: 1, textAlign: 'right' }]} numberOfLines={1}>
            {when}
          </Text>
        </View>
        <Text style={[FT.h2, { marginTop: FS.sm }]} numberOfLines={2}>
          {card.title}
        </Text>
        {card.topic ? (
          <Text style={[FT.muted, { marginTop: 2 }]} numberOfLines={1}>
            {card.topic}
          </Text>
        ) : null}
        <View style={{ marginTop: FS.sm }}>
          <IdentityChip identity={card.host} size="sm" />
        </View>
      </TouchableOpacity>
      <View style={styles.foot}>
        <View style={styles.stat}>
          <Users size={14} color={FriendsColors.muted} />
          <Text style={FT.small}>{live ? `${card.participantCount} listening` : `${card.interestedCount} interested`}</Text>
        </View>
        <View style={{ flex: 1 }} />
        {!live ? (
          <TouchableOpacity
            style={[styles.remind, card.reminded && styles.remindOn]}
            onPress={toggleRemind}
            disabled={busy}
            accessibilityRole="button"
            accessibilityState={{ selected: card.reminded, busy }}
            accessibilityLabel={card.reminded ? 'Reminder set. Tap to cancel' : 'Remind me when it starts'}
          >
            {busy ? (
              <ActivityIndicator size="small" color={FriendsColors.accent} />
            ) : card.reminded ? (
              <BellRing size={15} color={FriendsColors.accentInk} />
            ) : (
              <Bell size={15} color={FriendsColors.accent} />
            )}
            <Text style={[styles.remindText, card.reminded && { color: FriendsColors.accentInk }]}>{card.reminded ? 'Reminder on' : 'Remind me'}</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={[styles.remind, styles.remindOn]} onPress={() => nav.openSpace(card.spaceId)} accessibilityRole="button" accessibilityLabel="Join the Space">
            <Text style={[styles.remindText, { color: FriendsColors.accentInk }]}>Join</Text>
            <ChevronRight size={15} color={FriendsColors.accentInk} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: FriendsColors.card,
    borderRadius: FR.card,
    borderWidth: 1,
    borderColor: SectionTints.spaces.line,
    padding: FS.lg,
  },
  liveCard: { borderColor: 'rgba(243,139,128,0.45)' },
  top: { flexDirection: 'row', alignItems: 'center', gap: FS.sm },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: FR.pill, backgroundColor: SectionTints.spaces.soft },
  badgeLive: { backgroundColor: FriendsColors.dangerSoft },
  badgeText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.6, color: SectionTints.spaces.fg },
  foot: { flexDirection: 'row', alignItems: 'center', marginTop: FS.md, gap: FS.sm },
  stat: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  remind: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: FR.pill,
    borderWidth: 1,
    borderColor: FriendsColors.accent,
  },
  remindOn: { backgroundColor: FriendsColors.accent },
  remindText: { fontSize: 13, fontWeight: '800', color: FriendsColors.accent },
});
