import React, { memo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Clock, MapPin, Users, Globe, MoreHorizontal } from '../../../../components/lucide';
import { FriendsColors, FS, FT, FR, SectionTints } from '../friendsTheme';
import { CardGlow } from '../shared/FriendsUi';
import type { Task } from '../api/tasksApi';
import { identityLabel } from '../shared/IdentityChip';
import { FriendsAvatar } from '../shared/FriendsAvatar';
import { RelativeTime } from '../shared/RelativeTime';
import { CATEGORY_META, FULFILLMENT_LABEL, deadlineLabel, formatInr, nameOf, taskBadge } from './tasksShared';
import { StatusPill } from './TasksUi';

/** One task on the board or in My Tasks. Tapping opens the detail; "…" opens report / block. */
export const TaskCard: React.FC<{ task: Task; onPress: (t: Task) => void; onMore?: (t: Task) => void; showPoster?: boolean }> = memo(
  ({ task, onPress, onMore, showPoster = true }) => {
    const cat = CATEGORY_META[task.category] || CATEGORY_META.other;
    const Icon = cat.icon;
    const badge = taskBadge(task);
    const live = ['open', 'assigned'].includes(task.status);
    const dl = live ? deadlineLabel(task.deadlineAt) : null;
    const poster: any = task.poster;
    const reward = formatInr(task.rewardInr);
    const a11y = [
      task.title,
      `${cat.label}.`,
      task.rewardInr > 0 ? `Reward ${task.rewardInr} rupees.` : 'No payment offered.',
      dl ? `${dl.text}.` : '',
      `Status ${badge.label}.`,
      showPoster ? `Posted by ${identityLabel(task.poster)}.` : '',
      task.status === 'open' ? `${task.applicationCount} applications.` : '',
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <TouchableOpacity style={styles.card} onPress={() => onPress(task)} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel={a11y} accessibilityHint="Opens the task">
        <CardGlow />
        <View style={styles.top}>
          <View style={styles.cat}>
            <Icon size={14} color={SectionTints.tasks.fg} />
            <Text style={styles.catText} numberOfLines={1}>
              {cat.short}
            </Text>
          </View>
          <View style={{ flex: 1 }} />
          <View style={[styles.reward, task.rewardInr > 0 ? null : styles.rewardFree]}>
            <Text style={[styles.rewardText, task.rewardInr > 0 ? null : { color: FriendsColors.muted }]}>{reward}</Text>
          </View>
          {onMore ? (
            <TouchableOpacity onPress={() => onMore(task)} hitSlop={10} style={styles.more} accessibilityRole="button" accessibilityLabel={`More options for ${task.title}`}>
              <MoreHorizontal size={18} color={FriendsColors.muted} />
            </TouchableOpacity>
          ) : null}
        </View>

        <Text style={[FT.h3, { marginTop: FS.sm }]} numberOfLines={2}>
          {task.title}
        </Text>
        <Text style={[FT.muted, { marginTop: 4 }]} numberOfLines={2}>
          {task.description}
        </Text>

        <View style={styles.metaRow}>
          <StatusPill label={badge.label} tone={badge.tone} />
          {dl ? (
            <View style={styles.meta}>
              <Clock size={12} color={dl.urgent ? FriendsColors.warn : FriendsColors.muted} />
              <Text style={[FT.small, dl.urgent && { color: FriendsColors.warn, fontWeight: '700' }]}>{dl.text}</Text>
            </View>
          ) : null}
          <View style={styles.meta}>
            {task.fulfillment === 'online' ? <Globe size={12} color={FriendsColors.muted} /> : <MapPin size={12} color={FriendsColors.muted} />}
            <Text style={FT.small} numberOfLines={1}>
              {task.fulfillment === 'on_campus' && task.areaHint ? task.areaHint : FULFILLMENT_LABEL[task.fulfillment]}
            </Text>
          </View>
          {task.status === 'open' && task.applicationCount > 0 ? (
            <View style={styles.meta}>
              <Users size={12} color={FriendsColors.muted} />
              <Text style={FT.small}>{task.applicationCount}</Text>
            </View>
          ) : null}
        </View>

        {showPoster ? (
          <View style={styles.posterRow}>
            <FriendsAvatar name={nameOf(poster)} uri={poster && !poster.anonymous ? poster.avatarUrl : null} size={22} />
            <Text style={[FT.small, { color: FriendsColors.ink, flexShrink: 1 }]} numberOfLines={1}>
              {task.myRole === 'poster' ? 'You' : nameOf(poster)}
            </Text>
            <Text style={FT.small}>·</Text>
            <RelativeTime value={task.createdAt} />
          </View>
        ) : null}
      </TouchableOpacity>
    );
  }
);

const styles = StyleSheet.create({
  card: {
    backgroundColor: FriendsColors.card,
    borderRadius: FR.card,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: FriendsColors.line,
    padding: FS.lg,
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: FS.sm },
  cat: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 4, borderRadius: FR.pill, backgroundColor: SectionTints.tasks.soft, maxWidth: '55%' },
  catText: { fontSize: 12, fontWeight: '800', color: SectionTints.tasks.fg },
  reward: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: FR.pill, backgroundColor: FriendsColors.goldSoft, borderWidth: 1, borderColor: 'rgba(232,196,127,0.3)' },
  rewardFree: { backgroundColor: FriendsColors.cardHi, borderColor: FriendsColors.line },
  rewardText: { fontSize: 13, fontWeight: '800', color: FriendsColors.gold },
  more: { width: 44, height: 44, margin: -6, alignItems: 'center', justifyContent: 'center' },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: FS.md, marginTop: FS.md },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: '60%' },
  posterRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: FS.md, paddingTop: FS.sm, borderTopWidth: 1, borderTopColor: FriendsColors.lineSoft },
});
