import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { ArrowBigUp, ArrowBigDown } from '../../../../components/lucide';
import * as Haptics from 'expo-haptics';
import { voteForum } from '../api/forumApi';
import { FriendsColors, FR } from '../friendsTheme';
import { compactCount, forumErrorMessage } from './forumShared';
import { errorCode } from '../api/core';

import { themedSheet } from '../../../../utils/themeNow';
export interface VoteState {
  up: number;
  down: number;
  score: number;
  myVote: -1 | 0 | 1;
}

/**
 * Up / down vote with optimistic update. Tapping the active arrow removes the vote (value 0).
 * The server recounts totals after every write, so the response replaces the optimistic numbers.
 * Own content is not votable (disabled, explained to screen readers).
 */
export const VoteControl: React.FC<{
  targetType: 'forum_post' | 'forum_comment';
  targetId: string;
  value: VoteState;
  onChange?: (next: VoteState) => void;
  disabled?: boolean;
  disabledReason?: string;
  horizontal?: boolean;
  size?: 'sm' | 'md';
  onGateError?: (e: any) => void;
}> = ({ targetType, targetId, value, onChange, disabled, disabledReason, horizontal = true, size = 'md', onGateError }) => {
  const [state, setState] = useState<VoteState>(value);
  const seq = useRef(0);

  useEffect(() => setState(value), [value.up, value.down, value.score, value.myVote]); // eslint-disable-line react-hooks/exhaustive-deps

  const cast = async (dir: 1 | -1) => {
    if (disabled) return;
    const prev = state;
    const next: -1 | 0 | 1 = prev.myVote === dir ? 0 : dir;
    const up = prev.up - (prev.myVote === 1 ? 1 : 0) + (next === 1 ? 1 : 0);
    const down = prev.down - (prev.myVote === -1 ? 1 : 0) + (next === -1 ? 1 : 0);
    const optimistic: VoteState = { up, down, score: up - down, myVote: next };
    setState(optimistic);
    Haptics.selectionAsync().catch(() => {});
    const mine = ++seq.current;
    try {
      const r = await voteForum(targetType, targetId, next);
      if (mine !== seq.current) return;
      const fresh: VoteState = { up: r.up, down: r.down, score: r.score, myVote: r.myVote };
      setState(fresh);
      onChange?.(fresh);
    } catch (e: any) {
      if (mine !== seq.current) return;
      setState(prev);
      if (onGateError && ['GUIDELINES_REQUIRED', 'FEATURE_OFF', 'VERIFICATION_REQUIRED', 'FRIENDS_SANCTIONED'].includes(errorCode(e))) onGateError(e);
      Alert.alert("Couldn't vote", forumErrorMessage(e));
    }
  };

  const icon = size === 'sm' ? 18 : 22;
  const upOn = state.myVote === 1;
  const downOn = state.myVote === -1;
  const scoreColor = upOn ? FriendsColors.accent : downOn ? FriendsColors.danger : FriendsColors.ink;

  return (
    <View
      style={[styles.wrap, horizontal ? styles.row : styles.col, upOn && styles.wrapUp, downOn && styles.wrapDown, disabled && { opacity: 0.6 }]}
      accessibilityLabel={`Score ${state.score}`}
    >
      <TouchableOpacity
        onPress={() => cast(1)}
        disabled={disabled}
        style={styles.btn}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={upOn ? 'Remove upvote' : 'Upvote'}
        accessibilityState={{ selected: upOn, disabled: !!disabled }}
        accessibilityHint={disabled ? disabledReason : undefined}
      >
        <ArrowBigUp size={icon} color={upOn ? FriendsColors.accent : FriendsColors.muted} fill={upOn ? FriendsColors.accent : 'transparent'} />
      </TouchableOpacity>
      <Text style={[styles.score, size === 'sm' && { fontSize: 12 }, { color: scoreColor }]} accessibilityLiveRegion="polite">
        {compactCount(state.score)}
      </Text>
      <TouchableOpacity
        onPress={() => cast(-1)}
        disabled={disabled}
        style={styles.btn}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={downOn ? 'Remove downvote' : 'Downvote'}
        accessibilityState={{ selected: downOn, disabled: !!disabled }}
        accessibilityHint={disabled ? disabledReason : undefined}
      >
        <ArrowBigDown size={icon} color={downOn ? FriendsColors.danger : FriendsColors.muted} fill={downOn ? FriendsColors.danger : 'transparent'} />
      </TouchableOpacity>
    </View>
  );
};

const styles = themedSheet(() => ({
  wrap: { alignItems: 'center', backgroundColor: FriendsColors.cardHi, borderRadius: FR.pill, borderWidth: 1, borderColor: FriendsColors.lineSoft },
  row: { flexDirection: 'row', paddingHorizontal: 2 },
  col: { flexDirection: 'column', paddingVertical: 2 },
  btn: { minWidth: 40, minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  wrapUp: { backgroundColor: FriendsColors.accentSoft, borderColor: FriendsColors.accentLine },
  wrapDown: { backgroundColor: FriendsColors.dangerSoft, borderColor: 'rgba(243,139,128,0.3)' },
  score: { minWidth: 22, textAlign: 'center', fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] },
}));
