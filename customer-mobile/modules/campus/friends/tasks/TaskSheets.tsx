import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { Star, Gavel, Circle, CircleCheck } from '../../../../components/lucide';
import * as Haptics from 'expo-haptics';
import { FriendsColors, FS, FT, FR, fui } from '../friendsTheme';
import { FriendsSheet } from '../shared/FriendsSheet';
import { FriendsSkeleton } from '../shared/FriendsSkeleton';
import { FriendsError } from '../shared/FriendsEmpty';
import { RelativeTime } from '../shared/RelativeTime';
import { TASK_LIMITS, UserTaskReputation, fetchTaskReputation } from '../api/tasksApi';
import { ErrorBox, ReputationLine, taskUi } from './TasksUi';
import { taskErrorMessage } from './tasksShared';

const len = (s: string) => Array.from(s.trim()).length;

/**
 * One text field + confirm button. Used for: apply (note), submit work (note), send back (reason),
 * cancel (reason). Server errors are shown inline; the sheet stays open so nothing typed is lost.
 */
export const ReasonSheet: React.FC<{
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  label: string;
  placeholder: string;
  confirmLabel: string;
  min?: number;
  max?: number;
  destructive?: boolean;
  intro?: React.ReactNode;
  onSubmit: (text: string) => Promise<void>;
}> = ({ visible, onClose, title, subtitle, icon, label, placeholder, confirmLabel, min = 0, max = TASK_LIMITS.noteMax, destructive, intro, onSubmit }) => {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setText('');
    setError(null);
    setBusy(false);
  }, [visible]);

  const n = len(text);
  const valid = n >= min && n <= max;

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(text.trim());
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onClose();
    } catch (e: any) {
      setError(taskErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <FriendsSheet visible={visible} onClose={onClose} title={title} subtitle={subtitle} icon={icon}>
      {intro}
      <Text style={taskUi.label}>
        {label}
        {min > 0 ? '' : ' (optional)'}
      </Text>
      <TextInput
        style={[fui.input, { minHeight: 100, textAlignVertical: 'top' }]}
        value={text}
        onChangeText={(t) => {
          setText(t.slice(0, max));
          setError(null);
        }}
        placeholder={placeholder}
        placeholderTextColor={FriendsColors.faint}
        multiline
        maxLength={max}
        accessibilityLabel={label}
      />
      <Text style={taskUi.counter}>
        {min > 0 && n < min ? `At least ${min} characters · ` : ''}
        {text.length}/{max}
      </Text>
      <ErrorBox message={error} />
      <TouchableOpacity
        style={[fui.primaryBtn, { marginTop: FS.md }, destructive && { backgroundColor: FriendsColors.danger }, (!valid || busy) && { opacity: 0.5 }]}
        onPress={submit}
        disabled={!valid || busy}
        accessibilityRole="button"
        accessibilityState={{ disabled: !valid || busy }}
      >
        {busy ? <ActivityIndicator color={FriendsColors.accentInk} /> : <Text style={fui.primaryBtnText}>{confirmLabel}</Text>}
      </TouchableOpacity>
    </FriendsSheet>
  );
};

const DISPUTE_CATEGORIES: { key: string; label: string }[] = [
  { key: 'other', label: 'Work not done as agreed' },
  { key: 'harassment', label: 'Harassment or pressure' },
  { key: 'spam', label: 'Scam or payment trouble' },
  { key: 'academic_integrity', label: 'Asked to break academic rules' },
  { key: 'privacy', label: 'Private info shared' },
];

/**
 * Open a dispute: the task moves to "In dispute" and a case reaches the Zenvy moderation team.
 * Zenvy can't move money; moderators decide what happens to the task.
 */
export const DisputeSheet: React.FC<{ visible: boolean; onClose: () => void; onSubmit: (reason: string, category: string) => Promise<void> }> = ({ visible, onClose, onSubmit }) => {
  const [category, setCategory] = useState('other');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setCategory('other');
    setText('');
    setError(null);
    setBusy(false);
  }, [visible]);

  const n = len(text);
  const valid = n >= TASK_LIMITS.disputeMin && n <= TASK_LIMITS.reasonMax;

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(text.trim(), category);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      onClose();
    } catch (e: any) {
      setError(taskErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <FriendsSheet visible={visible} onClose={onClose} title="Open a dispute" subtitle="A moderator reviews it. ZenWe can't move or refund money." icon={<Gavel size={18} color={FriendsColors.danger} />}>
      <Text style={FT.muted}>Try the task chat first. A dispute pauses the task until a moderator decides to complete, cancel or reopen it.</Text>
      <Text style={taskUi.label}>What went wrong?</Text>
      <View style={fui.card} accessibilityRole="radiogroup">
        {DISPUTE_CATEGORIES.map((c, i) => {
          const on = c.key === category;
          return (
            <TouchableOpacity
              key={c.key}
              style={[fui.row, i === DISPUTE_CATEGORIES.length - 1 && { borderBottomWidth: 0 }, on && { backgroundColor: FriendsColors.cardHi }]}
              onPress={() => setCategory(c.key)}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={c.label}
            >
              {on ? <CircleCheck size={20} color={FriendsColors.accent} /> : <Circle size={20} color={FriendsColors.faint} />}
              <Text style={FT.h3}>{c.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <Text style={taskUi.label}>Describe the problem</Text>
      <TextInput
        style={[fui.input, { minHeight: 110, textAlignVertical: 'top' }]}
        value={text}
        onChangeText={(t) => {
          setText(t.slice(0, TASK_LIMITS.reasonMax));
          setError(null);
        }}
        placeholder="What was agreed, what happened, and what you'd like (at least 10 characters)"
        placeholderTextColor={FriendsColors.faint}
        multiline
        maxLength={TASK_LIMITS.reasonMax}
        accessibilityLabel="Describe the problem"
      />
      <Text style={taskUi.counter}>
        {n < TASK_LIMITS.disputeMin ? `At least ${TASK_LIMITS.disputeMin} characters · ` : ''}
        {text.length}/{TASK_LIMITS.reasonMax}
      </Text>
      <ErrorBox message={error} />
      <TouchableOpacity
        style={[fui.primaryBtn, { marginTop: FS.md, backgroundColor: FriendsColors.danger }, (!valid || busy) && { opacity: 0.5 }]}
        onPress={submit}
        disabled={!valid || busy}
        accessibilityRole="button"
        accessibilityState={{ disabled: !valid || busy }}
      >
        {busy ? <ActivityIndicator color={FriendsColors.accentInk} /> : <Text style={fui.primaryBtnText}>Open dispute</Text>}
      </TouchableOpacity>
    </FriendsSheet>
  );
};

/** Rate the other person once the task is completed (one review each, within the review window). */
export const TaskReviewSheet: React.FC<{
  visible: boolean;
  onClose: () => void;
  revieweeName: string;
  revieweeRole: 'poster' | 'helper';
  onSubmit: (rating: number, text: string) => Promise<void>;
}> = ({ visible, onClose, revieweeName, revieweeRole, onSubmit }) => {
  const [rating, setRating] = useState(0);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setRating(0);
    setText('');
    setError(null);
    setBusy(false);
  }, [visible]);

  const submit = async () => {
    if (!rating || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(rating, text.trim());
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onClose();
    } catch (e: any) {
      setError(taskErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const words = ['', 'Poor', 'Below expectations', 'Okay', 'Good', 'Excellent'];

  return (
    <FriendsSheet
      visible={visible}
      onClose={onClose}
      title={`Rate ${revieweeName}`}
      subtitle={`As ${revieweeRole === 'helper' ? 'your helper' : 'the poster'}. Others see it on their task profile without your name.`}
      icon={<Star size={18} color={FriendsColors.gold} />}
    >
      <View style={styles.stars} accessibilityRole="adjustable" accessibilityLabel={`Rating ${rating} of 5`}>
        {[1, 2, 3, 4, 5].map((n) => (
          <TouchableOpacity
            key={n}
            onPress={() => {
              setRating(n);
              Haptics.selectionAsync().catch(() => {});
            }}
            style={styles.star}
            accessibilityRole="button"
            accessibilityLabel={`${n} star${n > 1 ? 's' : ''}`}
            accessibilityState={{ selected: rating === n }}
          >
            <Star size={34} color={n <= rating ? FriendsColors.gold : FriendsColors.faint} fill={n <= rating ? FriendsColors.gold : 'transparent'} />
          </TouchableOpacity>
        ))}
      </View>
      <Text style={[FT.h3, { textAlign: 'center', minHeight: 20, color: rating ? FriendsColors.gold : FriendsColors.faint }]}>{rating ? words[rating] : 'Tap a star'}</Text>
      <Text style={taskUi.label}>A few words (optional)</Text>
      <TextInput
        style={[fui.input, { minHeight: 90, textAlignVertical: 'top' }]}
        value={text}
        onChangeText={(t) => {
          setText(t.slice(0, TASK_LIMITS.reviewTextMax));
          setError(null);
        }}
        placeholder="Was it on time? Clear? Friendly? Stick to the task."
        placeholderTextColor={FriendsColors.faint}
        multiline
        maxLength={TASK_LIMITS.reviewTextMax}
        accessibilityLabel="Review text"
      />
      <Text style={taskUi.counter}>
        {text.length}/{TASK_LIMITS.reviewTextMax}
      </Text>
      <ErrorBox message={error} />
      <TouchableOpacity
        style={[fui.primaryBtn, { marginTop: FS.md }, (!rating || busy) && { opacity: 0.5 }]}
        onPress={submit}
        disabled={!rating || busy}
        accessibilityRole="button"
        accessibilityState={{ disabled: !rating || busy }}
      >
        {busy ? <ActivityIndicator color={FriendsColors.accentInk} /> : <Text style={fui.primaryBtnText}>Post review</Text>}
      </TouchableOpacity>
      <Text style={[FT.small, { textAlign: 'center', marginTop: FS.sm }]}>One review per task. It can't be edited later.</Text>
    </FriendsSheet>
  );
};

/** Task history of a student: completed count and ratings (never who wrote them). */
export const ReputationSheet: React.FC<{ userId: string | null; name: string; onClose: () => void }> = ({ userId, name, onClose }) => {
  const [data, setData] = useState<UserTaskReputation | null>(null);
  const [error, setError] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const load = React.useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      setData(await fetchTaskReputation(userId));
    } catch (e: any) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    setData(null);
    if (userId) load();
  }, [userId, load]);

  return (
    <FriendsSheet visible={!!userId} onClose={onClose} title={name} subtitle="Task reputation on your campus" icon={<Star size={18} color={FriendsColors.gold} />}>
      {loading && !data ? (
        <FriendsSkeleton rows={2} variant="row" />
      ) : error && !data ? (
        <FriendsError compact message={taskErrorMessage(error, "Couldn't load this student's task history.")} onRetry={load} />
      ) : data ? (
        <>
          <View style={styles.statRow}>
            <Stat label="Helped" value={String(data.tasksCompleted)} />
            <Stat label="As helper" value={data.asHelper.ratingAvg !== null ? `${data.asHelper.ratingAvg.toFixed(1)}★` : '–'} sub={`${data.asHelper.ratingCount} ratings`} />
            <Stat label="As poster" value={data.asPoster.ratingAvg !== null ? `${data.asPoster.ratingAvg.toFixed(1)}★` : '–'} sub={`${data.asPoster.ratingCount} ratings`} />
          </View>
          <Text style={[FT.small, { marginTop: FS.sm }]}>{data.tasksPostedCompleted} of their posted tasks were completed.</Text>
          <Text style={[taskUi.label, { marginTop: FS.xl }]}>Recent reviews</Text>
          {data.recent.length ? (
            <View style={fui.card}>
              {data.recent.map((r, i) => (
                <View key={i} style={[styles.review, i === data.recent.length - 1 && { borderBottomWidth: 0 }]} accessible accessibilityLabel={`${r.rating} of 5 as ${r.role}. ${r.text}`}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <ReputationStars rating={r.rating} />
                    <Text style={FT.small}>as {r.role}</Text>
                    <View style={{ flex: 1 }} />
                    <RelativeTime value={r.createdAt} />
                  </View>
                  {r.text ? <Text style={[FT.body, { marginTop: 4 }]}>{r.text}</Text> : null}
                </View>
              ))}
            </View>
          ) : (
            <Text style={FT.muted}>No reviews yet.</Text>
          )}
        </>
      ) : null}
    </FriendsSheet>
  );
};

const Stat: React.FC<{ label: string; value: string; sub?: string }> = ({ label, value, sub }) => (
  <View style={styles.stat} accessible accessibilityLabel={`${label}: ${value}${sub ? `, ${sub}` : ''}`}>
    <Text style={[FT.h2, { color: FriendsColors.gold }]}>{value}</Text>
    <Text style={FT.small}>{label}</Text>
    {sub ? <Text style={[FT.small, { color: FriendsColors.faint }]}>{sub}</Text> : null}
  </View>
);

export const ReputationStars: React.FC<{ rating: number; size?: number }> = ({ rating, size = 12 }) => (
  <View style={{ flexDirection: 'row', gap: 1 }}>
    {[1, 2, 3, 4, 5].map((n) => (
      <Star key={n} size={size} color={n <= rating ? FriendsColors.gold : FriendsColors.faint} fill={n <= rating ? FriendsColors.gold : 'transparent'} />
    ))}
  </View>
);

export { ReputationLine };

const styles = StyleSheet.create({
  stars: { flexDirection: 'row', justifyContent: 'center', gap: 4, marginVertical: FS.md },
  star: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center' },
  statRow: { flexDirection: 'row', gap: FS.sm },
  stat: { flex: 1, padding: FS.md, borderRadius: FR.md, backgroundColor: FriendsColors.cardHi, alignItems: 'center' },
  review: { padding: FS.md, borderBottomWidth: 1, borderBottomColor: FriendsColors.lineSoft },
});
