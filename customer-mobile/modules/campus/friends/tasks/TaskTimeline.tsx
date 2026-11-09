import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Check, Circle } from '../../../../components/lucide';
import { FriendsColors, FS, FT, FR, SectionTints } from '../friendsTheme';
import { CardGlow } from '../shared/FriendsUi';

const TINT = SectionTints.tasks;
import { formatLocal } from '../shared/RelativeTime';
import type { Task } from '../api/tasksApi';

import { themedSheet } from '../../../../utils/themeNow';
interface Step {
  key: string;
  label: string;
  at?: string | null;
}

const STEPS: Step[] = [
  { key: 'open', label: 'Posted' },
  { key: 'applications', label: 'Applications received' },
  { key: 'assigned', label: 'Helper selected' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'submitted', label: 'Marked done' },
  { key: 'completed', label: 'Completed' },
  { key: 'reviewed', label: 'Mutual reviews' },
];

/** How far along the lifecycle a task is (index into STEPS). */
const reached = (t: Task): number => {
  switch (t.stage) {
    case 'open':
      return 0;
    case 'applications_received':
      return 1;
    case 'assigned':
      return 2;
    case 'in_progress':
      return 3;
    case 'submitted':
      return 4;
    case 'completed':
      return 5;
    case 'reviewed':
      return 6;
    default: {
      // cancelled / expired / disputed: show how far it got before stopping.
      if (t.submittedAt) return 4;
      if (t.startedAt) return 3;
      if (t.assignedAt) return 2;
      return t.applicationCount > 0 ? 1 : 0;
    }
  }
};

/**
 * Lifecycle timeline: Open → Applications → Assigned → In progress → Done → Completed → Reviews.
 * Cancelled, expired and disputed tasks show where they stopped. Times are in the phone's time zone.
 */
export const TaskTimeline: React.FC<{ task: Task }> = ({ task }) => {
  const idx = reached(task);
  const stopped = ['cancelled', 'expired', 'disputed'].includes(task.status);
  const times: Record<string, string | null | undefined> = {
    open: task.createdAt,
    assigned: task.assignedAt,
    in_progress: task.startedAt,
    submitted: task.submittedAt,
    completed: task.completedAt,
  };
  const stopLabel = task.status === 'cancelled' ? 'Cancelled' : task.status === 'expired' ? 'Expired' : 'In dispute';
  const stopAt = task.status === 'cancelled' ? task.cancelledAt : task.status === 'expired' ? task.expiredAt : task.disputedAt;
  const summary = `Progress: ${STEPS[idx].label}${stopped ? `, then ${stopLabel}` : ''}.`;

  return (
    <View style={styles.wrap} accessible accessibilityLabel={summary}>
      <CardGlow tint="rgba(242,192,126,0.07)" />
      <Text style={[FT.kicker, { marginBottom: FS.md }]}>Progress</Text>
      {STEPS.map((s, i) => {
        const done = i <= idx;
        const current = i === idx && !stopped && task.status !== 'completed';
        const last = i === STEPS.length - 1 && !stopped;
        const at = times[s.key];
        if (stopped && i > idx) return null;
        return (
          <View key={s.key} style={styles.row}>
            <View style={styles.rail}>
              <View style={[styles.dot, done && styles.dotDone, current && styles.dotCurrent]}>
                {done && !current ? <Check size={11} color={FriendsColors.accentInk} /> : current ? <Circle size={8} color={TINT.fg} fill={TINT.fg} /> : null}
              </View>
              {!last ? <View style={[styles.line, i < idx && styles.lineDone]} /> : null}
            </View>
            <View style={styles.body}>
              <Text style={[FT.body, { color: done ? FriendsColors.ink : FriendsColors.faint, fontWeight: current ? '800' : '600' }]}>{s.label}</Text>
              {done && at ? <Text style={FT.small}>{formatLocal(at)}</Text> : null}
            </View>
          </View>
        );
      })}
      {stopped ? (
        <View style={styles.row}>
          <View style={styles.rail}>
            <View style={[styles.dot, { backgroundColor: task.status === 'disputed' ? FriendsColors.danger : FriendsColors.faint, borderColor: 'transparent' }]} />
          </View>
          <View style={styles.body}>
            <Text style={[FT.body, { fontWeight: '800', color: task.status === 'disputed' ? FriendsColors.danger : FriendsColors.muted }]}>{stopLabel}</Text>
            {stopAt ? <Text style={FT.small}>{formatLocal(stopAt)}</Text> : null}
          </View>
        </View>
      ) : null}
    </View>
  );
};

const styles = themedSheet(() => ({
  wrap: { padding: FS.lg, borderRadius: FR.card, backgroundColor: FriendsColors.card, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: FriendsColors.line },
  row: { flexDirection: 'row', gap: FS.md },
  rail: { width: 20, alignItems: 'center' },
  dot: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: FriendsColors.lineStrong, alignItems: 'center', justifyContent: 'center', backgroundColor: FriendsColors.bg },
  dotDone: { backgroundColor: TINT.fg, borderColor: TINT.fg },
  dotCurrent: { width: 22, height: 22, borderRadius: 11, marginHorizontal: -1, backgroundColor: TINT.soft, borderColor: TINT.fg, borderWidth: 2 },
  line: { width: 2, flex: 1, minHeight: 18, borderRadius: 1, backgroundColor: FriendsColors.line, marginVertical: 3 },
  lineDone: { backgroundColor: TINT.line },
  body: { flex: 1, paddingBottom: FS.md },
}));
