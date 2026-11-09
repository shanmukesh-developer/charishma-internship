import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { Users, MoreHorizontal, UserCheck } from '../../../../components/lucide';
import * as Haptics from 'expo-haptics';
import { FriendsColors, FS, FT, FR, fui } from '../friendsTheme';
import { FriendsSheet } from '../shared/FriendsSheet';
import { FriendsSkeleton } from '../shared/FriendsSkeleton';
import { FriendsEmpty, FriendsError } from '../shared/FriendsEmpty';
import { IdentityChip } from '../shared/IdentityChip';
import { ActionMenu } from '../shared/ActionMenu';
import { Task, TaskApplication, fetchTaskApplications, selectApplicant } from '../api/tasksApi';
import { APPLICATION_META, nameOf, taskErrorMessage } from './tasksShared';
import { ErrorBox, ReputationLine, StatusPill } from './TasksUi';
import { useTasksNav } from './tasksNav';

import { themedSheet } from '../../../../utils/themeNow';
/**
 * Poster only: everyone who applied, with their note and real task reputation. Choosing one moves
 * the task to "Helper selected"; the server guarantees a single helper even if two taps race.
 */
export const ApplicationsSheet: React.FC<{ task: Task | null; visible: boolean; onClose: () => void; onChanged: (t: Task) => void }> = ({ task, visible, onClose, onChanged }) => {
  const nav = useTasksNav();
  const [items, setItems] = useState<TaskApplication[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<any>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selecting, setSelecting] = useState<string | null>(null);
  const [menu, setMenu] = useState<TaskApplication | null>(null);
  const gen = useRef(0);
  const taskId = task?.id || null;

  const load = useCallback(async () => {
    if (!taskId) return;
    const my = ++gen.current;
    setLoading(true);
    setError(null);
    try {
      const r = await fetchTaskApplications(taskId);
      if (my !== gen.current) return;
      setItems(r.items);
      setCursor(r.nextCursor);
    } catch (e: any) {
      if (my !== gen.current) return;
      nav.onGateError(e);
      setError(e);
    } finally {
      if (my === gen.current) setLoading(false);
    }
  }, [taskId, nav]);

  useEffect(() => {
    if (!visible) return;
    setActionError(null);
    load();
  }, [visible, load]);

  const loadMore = async () => {
    if (!taskId || !cursor || more) return;
    setMore(true);
    try {
      const r = await fetchTaskApplications(taskId, cursor);
      setItems((prev) => {
        const seen = new Set(prev.map((x) => x.id));
        return [...prev, ...r.items.filter((x) => !seen.has(x.id))];
      });
      setCursor(r.nextCursor);
    } catch (e: any) {
      setActionError(taskErrorMessage(e));
    } finally {
      setMore(false);
    }
  };

  const choose = (a: TaskApplication) => {
    if (!task || selecting) return;
    const who = nameOf(a.applicant);
    Alert.alert(`Choose ${who}?`, `${who} gets a notification and has to accept before the task starts. You can change your mind until then.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Choose',
        onPress: async () => {
          setSelecting(a.id);
          setActionError(null);
          try {
            const r = await selectApplicant(task.id, a.id);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
            onChanged(r.task);
            onClose();
          } catch (e: any) {
            nav.onGateError(e);
            setActionError(taskErrorMessage(e));
            load();
          } finally {
            setSelecting(null);
          }
        },
      },
    ]);
  };

  const menuApplicant: any = menu?.applicant;

  return (
    <>
      <FriendsSheet
        visible={visible}
        onClose={onClose}
        title="Applications"
        subtitle={task ? task.title : undefined}
        icon={<Users size={18} color={FriendsColors.accent} />}
      >
        {task && task.status !== 'open' ? (
          <View style={styles.note}>
            <Text style={[FT.small, { color: FriendsColors.warn }]}>A helper is already selected. Unselect them on the task to choose someone else.</Text>
          </View>
        ) : null}
        <ErrorBox message={actionError} />
        {loading && !items.length ? (
          <FriendsSkeleton rows={3} variant="row" />
        ) : error && !items.length ? (
          <FriendsError compact message={taskErrorMessage(error, "Couldn't load the applications.")} onRetry={load} />
        ) : !items.length ? (
          <FriendsEmpty compact icon={<Users size={22} color={FriendsColors.accent} />} title="No applications yet" subtitle="You'll get a notification when someone applies." />
        ) : (
          <View style={{ gap: FS.sm, marginTop: FS.sm }}>
            {items.map((a) => {
              const st = APPLICATION_META[a.status];
              const applicant: any = a.applicant;
              return (
                <View key={a.id} style={styles.app}>
                  <IdentityChip
                    identity={a.applicant}
                    time={a.createdAt}
                    onPress={applicant?.userId ? (id) => nav.openReputation(id, nameOf(applicant)) : undefined}
                    right={
                      <TouchableOpacity onPress={() => setMenu(a)} hitSlop={10} style={styles.more} accessibilityRole="button" accessibilityLabel={`More options for ${nameOf(applicant)}'s application`}>
                        <MoreHorizontal size={18} color={FriendsColors.muted} />
                      </TouchableOpacity>
                    }
                  />
                  <View style={{ marginTop: 6 }}>
                    <ReputationLine rep={a.reputation} />
                  </View>
                  {a.note ? <Text style={[FT.body, { marginTop: FS.sm }]}>{a.note}</Text> : <Text style={[FT.small, { marginTop: FS.sm, color: FriendsColors.faint }]}>No note.</Text>}
                  <View style={styles.appFoot}>
                    {a.status !== 'pending' ? <StatusPill label={a.status === 'selected' ? 'Selected' : a.status === 'accepted' ? 'Helper' : st.label} tone={st.tone} /> : <View />}
                    {a.canSelect ? (
                      <TouchableOpacity
                        style={[styles.choose, selecting && { opacity: 0.5 }]}
                        onPress={() => choose(a)}
                        disabled={!!selecting}
                        accessibilityRole="button"
                        accessibilityLabel={`Choose ${nameOf(applicant)} as helper`}
                      >
                        {selecting === a.id ? <ActivityIndicator size="small" color={FriendsColors.accentInk} /> : <UserCheck size={15} color={FriendsColors.accentInk} />}
                        <Text style={styles.chooseText}>Choose</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </View>
              );
            })}
            {cursor ? (
              <TouchableOpacity style={[fui.ghostBtn, { marginTop: FS.sm }]} onPress={loadMore} disabled={more} accessibilityRole="button">
                {more ? <ActivityIndicator color={FriendsColors.muted} /> : <Text style={fui.ghostBtnText}>Load more</Text>}
              </TouchableOpacity>
            ) : null}
          </View>
        )}
      </FriendsSheet>
      <ActionMenu
        visible={!!menu}
        onClose={() => setMenu(null)}
        title="Application"
        report={menu ? { type: 'task_application', id: menu.id, label: `${nameOf(menuApplicant)}'s application` } : null}
        block={menuApplicant?.userId ? { userId: menuApplicant.userId, name: nameOf(menuApplicant) } : null}
        onBlocked={(uid) => {
          setItems((prev) => prev.filter((x) => (x.applicant as any)?.userId !== uid));
          nav.onBlocked(uid);
        }}
      />
    </>
  );
};

const styles = themedSheet(() => ({
  note: { padding: FS.md, borderRadius: FR.md, backgroundColor: FriendsColors.warnSoft, marginBottom: FS.sm },
  app: { padding: FS.md, borderRadius: FR.card, backgroundColor: FriendsColors.cardHi, borderWidth: 1, borderColor: FriendsColors.line },
  more: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  appFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: FS.md },
  choose: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingHorizontal: 16, borderRadius: FR.pill, backgroundColor: FriendsColors.accent },
  chooseText: { fontSize: 14, fontWeight: '800', color: FriendsColors.accentInk },
}));
