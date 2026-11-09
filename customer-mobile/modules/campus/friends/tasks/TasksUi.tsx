import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { ChevronLeft, RotateCcw, Star } from '../../../../components/lucide';
import { FriendsColors, FS, FT, FR, fui, SectionTints } from '../friendsTheme';
import { FriendsHeader } from '../shared/FriendsUi';
import { taskErrorMessage, toneColor, toneSoft } from './tasksShared';
import type { TaskReputation } from '../api/tasksApi';

import { themedSheet } from '../../../../utils/themeNow';
/** Header for screens inside the Tasks stack. */
export const TaskHeader: React.FC<{ title: string; subtitle?: string | null; onBack: () => void; right?: React.ReactNode }> = (props) => (
  <FriendsHeader {...props} section="tasks" />
);

/** Small coloured status pill. */
export const StatusPill: React.FC<{ label: string; tone: Parameters<typeof toneColor>[0]; icon?: React.ReactNode }> = ({ label, tone, icon }) => (
  <View style={[styles.pill, { backgroundColor: toneSoft(tone) }]} accessible accessibilityLabel={`Status: ${label}`}>
    {icon}
    <Text style={[styles.pillText, { color: toneColor(tone) }]} numberOfLines={1}>
      {label}
    </Text>
  </View>
);

/** Horizontal single-select chips. */
export function TaskChips<K extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { key: K; label: string; icon?: React.ReactNode; count?: number }[];
  value: K;
  onChange: (k: K) => void;
  label: string;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityRole="tablist" accessibilityLabel={label}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <TouchableOpacity
            key={o.key}
            onPress={() => onChange(o.key)}
            style={[fui.pill, on && { backgroundColor: SectionTints.tasks.soft, borderColor: SectionTints.tasks.line }]}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${label}: ${o.label}${o.count ? `, ${o.count}` : ''}`}
          >
            {o.icon}
            <Text style={[fui.pillText, on && { color: SectionTints.tasks.fg }]}>{o.label}</Text>
            {o.count ? (
              <View style={[styles.count, on && { backgroundColor: SectionTints.tasks.line }]}>
                <Text style={[styles.countText, on && { color: SectionTints.tasks.fg }]}>{o.count > 99 ? '99+' : o.count}</Text>
              </View>
            ) : null}
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

/** Inline "couldn't refresh / load more" row with Retry (list stays on screen). */
export const TaskSoftError: React.FC<{ error: any; onRetry: () => void }> = ({ error, onRetry }) => (
  <TouchableOpacity style={styles.soft} onPress={onRetry} accessibilityRole="button" accessibilityLabel={`${taskErrorMessage(error)} Retry`}>
    <RotateCcw size={14} color={FriendsColors.warn} />
    <Text style={styles.softText} numberOfLines={2}>
      {taskErrorMessage(error, "Couldn't refresh.")} Tap to retry.
    </Text>
  </TouchableOpacity>
);

/** "4.6 ★ · 12 done" — real task reputation only; "New helper" when there is none. */
export const ReputationLine: React.FC<{ rep: TaskReputation | null | undefined }> = ({ rep }) => {
  if (!rep || (!rep.tasksCompleted && !rep.ratingCount)) {
    return <Text style={[FT.small, { color: FriendsColors.faint }]}>No completed tasks yet</Text>;
  }
  const label = `${rep.ratingAvg !== null ? `Rated ${rep.ratingAvg} out of 5 from ${rep.ratingCount} reviews. ` : ''}${rep.tasksCompleted} tasks completed.`;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }} accessible accessibilityLabel={label}>
      {rep.ratingAvg !== null ? (
        <>
          <Star size={12} color={FriendsColors.gold} fill={FriendsColors.gold} />
          <Text style={[FT.small, { color: FriendsColors.ink, fontWeight: '700' }]}>{rep.ratingAvg.toFixed(1)}</Text>
          <Text style={FT.small}>({rep.ratingCount})</Text>
          <Text style={FT.small}> · </Text>
        </>
      ) : null}
      <Text style={FT.small}>{rep.tasksCompleted} done</Text>
    </View>
  );
};

/** Inline error box used by sheets and forms. */
export const ErrorBox: React.FC<{ message: string | null }> = ({ message }) =>
  message ? (
    <View style={styles.errorBox} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Text style={styles.errorText}>{message}</Text>
    </View>
  ) : null;

export const taskUi = themedSheet(() => ({
  section: { fontSize: 12, fontWeight: '800', letterSpacing: 0.8, color: FriendsColors.muted, textTransform: 'uppercase', marginBottom: FS.sm },
  label: { fontSize: 12, fontWeight: '800', letterSpacing: 0.4, color: FriendsColors.muted, marginBottom: 6, marginTop: FS.lg },
  counter: { fontSize: 12, color: FriendsColors.faint, textAlign: 'right', marginTop: 4 },
}));

const styles = themedSheet(() => ({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: FS.sm,
    paddingHorizontal: FS.sm,
    paddingVertical: FS.sm,
    borderBottomWidth: 1,
    borderBottomColor: FriendsColors.line,
    backgroundColor: FriendsColors.bg,
  },
  back: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: FR.pill, alignSelf: 'flex-start' },
  pillText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.2 },
  chips: { gap: FS.sm, paddingHorizontal: FS.lg, paddingVertical: FS.sm },
  count: { minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: FriendsColors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  countText: { fontSize: 12, fontWeight: '800', color: FriendsColors.accent },
  soft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: FS.lg,
    marginVertical: FS.sm,
    padding: FS.md,
    minHeight: 44,
    borderRadius: FR.md,
    backgroundColor: FriendsColors.warnSoft,
  },
  softText: { flex: 1, fontSize: 12, fontWeight: '600', color: FriendsColors.warn },
  errorBox: { marginTop: FS.md, padding: FS.md, borderRadius: FR.md, backgroundColor: FriendsColors.dangerSoft },
  errorText: { fontSize: 13, lineHeight: 18, fontWeight: '600', color: FriendsColors.danger },
}));
