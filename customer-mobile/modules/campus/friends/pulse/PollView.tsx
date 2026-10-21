import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { CircleCheck, BarChart3 } from '../../../../components/lucide';
import * as Haptics from 'expo-haptics';
import { FriendsColors, FS, FR, FT } from '../friendsTheme';
import { PulsePoll, votePulsePoll } from '../api/pulseApi';
import { errorCode } from '../api/core';
import { pollTimeLeft, pulseErrorMessage } from './pulseShared';

/**
 * Poll on a Pulse post. Results stay hidden until the viewer votes (or the poll ends, or it's
 * their own poll). One vote per person, no changes; the server is authoritative.
 */
export const PollView: React.FC<{
  poll: PulsePoll;
  /** False for removed / under-review posts and for space cards. */
  canVote: boolean;
  onChange: (poll: PulsePoll) => void;
  onGateError?: (e: any) => void;
}> = ({ poll, canVote, onChange, onGateError }) => {
  const [busy, setBusy] = useState<number | null>(null);
  const voted = poll.myVote !== null && poll.myVote !== undefined;
  const total = poll.totalVotes || 0;
  const votable = canVote && !poll.closed && !voted;

  const vote = async (idx: number) => {
    if (!votable || busy !== null) return;
    setBusy(idx);
    Haptics.selectionAsync().catch(() => {});
    try {
      const r = await votePulsePoll(poll.id, idx);
      onChange(r.poll);
    } catch (e: any) {
      onGateError?.(e);
      const code = errorCode(e);
      if (code === 'ALREADY_VOTED' && typeof e?.data?.myVote === 'number') {
        // Voted elsewhere: re-sending the same choice is idempotent and returns the poll with results.
        const mine = e.data.myVote;
        try {
          const again = await votePulsePoll(poll.id, mine);
          onChange(again.poll);
        } catch {
          onChange({ ...poll, myVote: mine });
        }
        return;
      } else if (code === 'POLL_CLOSED') {
        onChange({ ...poll, closed: true });
      }
      Alert.alert("Couldn't vote", pulseErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const max = Math.max(1, ...poll.options.map((o) => o.votes || 0));

  return (
    <View style={styles.wrap} accessibilityRole="radiogroup" accessibilityLabel="Poll">
      {poll.options.map((o) => {
        const mine = poll.myVote === o.idx;
        if (poll.showResults) {
          const votes = o.votes || 0;
          const pct = total ? Math.round((votes / total) * 100) : 0;
          const lead = votes === max && votes > 0;
          return (
            <View
              key={o.idx}
              style={styles.result}
              accessible
              accessibilityLabel={`${o.label}: ${pct} percent, ${votes} vote${votes === 1 ? '' : 's'}${mine ? ', your vote' : ''}`}
            >
              <View style={[styles.bar, { width: `${Math.max(pct, 2)}%` }, lead ? styles.barLead : null]} />
              <View style={styles.resultRow}>
                <Text style={[FT.body, { flex: 1, fontWeight: lead ? '800' : '600' }]} numberOfLines={2}>
                  {o.label}
                </Text>
                {mine ? <CircleCheck size={15} color={FriendsColors.accent} /> : null}
                <Text style={[styles.pct, lead && { color: FriendsColors.ink }]}>{pct}%</Text>
              </View>
            </View>
          );
        }
        return (
          <TouchableOpacity
            key={o.idx}
            style={[styles.option, !votable && { opacity: 0.6 }]}
            onPress={() => vote(o.idx)}
            disabled={!votable || busy !== null}
            activeOpacity={0.8}
            accessibilityRole="radio"
            accessibilityState={{ checked: false, disabled: !votable, busy: busy === o.idx }}
            accessibilityLabel={`Vote ${o.label}`}
          >
            {busy === o.idx ? <ActivityIndicator size="small" color={FriendsColors.accent} /> : null}
            <Text style={styles.optionText} numberOfLines={2}>
              {o.label}
            </Text>
          </TouchableOpacity>
        );
      })}
      <View style={styles.meta}>
        <BarChart3 size={12} color={FriendsColors.faint} />
        <Text style={FT.small}>
          {poll.showResults ? `${total} vote${total === 1 ? '' : 's'} · ` : 'Vote to see results · '}
          {pollTimeLeft(poll.closesAt, poll.closed)}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { marginTop: FS.sm, gap: 6 },
  option: {
    minHeight: 44,
    borderRadius: FR.pill,
    borderWidth: 1,
    borderColor: FriendsColors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: FS.lg,
    flexDirection: 'row',
    gap: 8,
  },
  optionText: { fontSize: 14, fontWeight: '700', color: FriendsColors.accent, textAlign: 'center' },
  result: { minHeight: 40, borderRadius: FR.sm, overflow: 'hidden', backgroundColor: FriendsColors.cardHi, justifyContent: 'center' },
  bar: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: 'rgba(212,175,122,0.16)' },
  barLead: { backgroundColor: 'rgba(212,175,122,0.32)' },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: FS.md, paddingVertical: 8 },
  pct: { fontSize: 13, fontWeight: '800', color: FriendsColors.muted, minWidth: 38, textAlign: 'right' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
});
