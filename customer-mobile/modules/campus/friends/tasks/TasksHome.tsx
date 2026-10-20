import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, RefreshControl, ActivityIndicator, BackHandler, Alert, StyleSheet } from 'react-native';
import { Plus, Search, X, ClipboardList, ChevronRight, LayoutGrid, Handshake } from '../../../../components/lucide';
import { FriendsColors, FS, FT, FR, fui, SectionTints } from '../friendsTheme';
import { BrandFill } from '../shared/FriendsUi';
import { FriendsSkeleton } from '../shared/FriendsSkeleton';
import { FriendsEmpty, FriendsError } from '../shared/FriendsEmpty';
import { ActionMenu } from '../shared/ActionMenu';
import { SUB_TAB_META } from '../shared/SubTabBar';
import { getCampusSocket } from '../../campusSocketClient';
import { isGateError } from '../api/core';
import { MyTasksTab, Task, TaskCategory, TaskMeta, TaskSort, TASK_CATEGORIES, fetchMyTasks, fetchTaskBoard, fetchTaskMeta } from '../api/tasksApi';
import { CATEGORY_META, nameOf, taskBus, taskCache, taskErrorMessage, taskLink } from './tasksShared';
import { TasksNav, TasksNavContext, TasksRoute } from './tasksNav';
import { useTaskPaged } from './useTaskPaged';
import { TaskCard } from './TaskCard';
import { TaskChips, TaskSoftError } from './TasksUi';
import { TaskDetail } from './TaskDetail';
import { MyTasksScreen } from './MyTasksScreen';
import { TaskComposer } from './TaskComposer';
import { ReputationSheet } from './TaskSheets';
import { PaymentNoticeCard } from './PaymentNoticeCard';

export interface TasksHomeProps {
  /** Task id from a deep link / notification (/friends?tab=friends&sub=tasks&id=...). */
  focusId?: string | null;
  /** Open a campus chat (task chats reuse ChatDetailScreen). */
  onOpenChat?: (chatId: string, name: string) => void;
  /** Signed-in user id. */
  userId?: string | null;
  /** True while Tasks is the visible sub-tab (Android back pops the Tasks stack only then). */
  active?: boolean;
  /** Ask the Friends shell to refetch eligibility (guidelines / flag / restriction changed). */
  onGateError?: () => void;
}

const SORTS: { key: TaskSort; label: string }[] = [
  { key: 'new', label: 'Newest' },
  { key: 'deadline', label: 'Due soon' },
  { key: 'reward', label: 'Highest reward' },
];

const META_KEY = 'meta';
const COUNTS_KEY = 'counts';

/**
 * Campus Buddy > Friends > Tasks: a commission-free help board for verified students on one campus.
 * The board lists open tasks (category chips, sort, search); a task opens in an in-tab stack, so the
 * Friends sub-tab bar stays put. Posting, applying, choosing a helper, the task chat, completion,
 * disputes and mutual reviews all run on the real API; the server decides every state change.
 */
export const TasksHome: React.FC<TasksHomeProps> = ({ focusId, onOpenChat, userId, active = true, onGateError }) => {
  const [meta, setMeta] = useState<TaskMeta | null>(() => taskCache.get<TaskMeta>(META_KEY) || null);
  const [category, setCategory] = useState<TaskCategory | 'all'>('all');
  const [sort, setSort] = useState<TaskSort>('new');
  const [query, setQuery] = useState('');
  const [q, setQ] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [stack, setStack] = useState<{ key: number; route: TasksRoute }[]>([]);
  const [composer, setComposer] = useState<{ edit: Task | null } | null>(null);
  const [rep, setRep] = useState<{ userId: string; name: string } | null>(null);
  const [menuTask, setMenuTask] = useState<Task | null>(null);
  const [counts, setCounts] = useState<Partial<Record<MyTasksTab, number>>>(() => taskCache.get(COUNTS_KEY) || {});
  const keySeq = useRef(0);

  const gate = useCallback(
    (e: any) => {
      if (isGateError(e)) onGateError?.();
    },
    [onGateError]
  );

  // Composer limits, categories, integrity guidance and the payment notice.
  const loadMeta = useCallback(async () => {
    try {
      const m = await fetchTaskMeta();
      setMeta(m);
      taskCache.set(META_KEY, m);
    } catch (e: any) {
      gate(e);
    }
  }, [gate]);

  const loadCounts = useCallback(async () => {
    try {
      const r = await fetchMyTasks('helping');
      setCounts(r.counts || {});
      taskCache.set(COUNTS_KEY, r.counts || {});
    } catch {
      // Counts are a hint; the My Tasks screen shows its own errors.
    }
  }, []);

  useEffect(() => {
    loadMeta();
    loadCounts();
  }, [loadMeta, loadCounts]);

  // Debounced search (server needs 2+ characters).
  useEffect(() => {
    const t = setTimeout(() => setQ(query.trim().length >= 2 ? query.trim() : ''), 350);
    return () => clearTimeout(t);
  }, [query]);

  const boardKey = `board:${category}:${sort}:${q}`;
  const fetchPage = useCallback(
    async (cursor: string | null) => {
      const r = await fetchTaskBoard({ category: category === 'all' ? null : category, sort, q, cursor });
      return { items: r.items, nextCursor: r.nextCursor };
    },
    [category, sort, q]
  );
  const board = useTaskPaged(boardKey, fetchPage, { onError: gate, keep: (t) => t.status === 'open' && (t.modStatus === undefined || t.modStatus === 'visible') });

  // Live: a task I'm part of changed, or someone applied to mine. Lists refetch quietly.
  useEffect(() => {
    const s = getCampusSocket();
    const onUpdate = (p: { id?: string }) => {
      taskBus.emitStale(p?.id || null);
      loadCounts();
    };
    s.on('friends:task_updated', onUpdate);
    return () => {
      s.off('friends:task_updated', onUpdate);
    };
  }, [loadCounts]);

  const push = useCallback((route: TasksRoute) => {
    setStack((prev) => {
      const top = prev[prev.length - 1]?.route;
      if (top && top.name === route.name && (top as any).id === (route as any).id) return prev;
      return [...prev.slice(-7), { key: ++keySeq.current, route }];
    });
  }, []);
  const back = useCallback(() => setStack((prev) => prev.slice(0, -1)), []);

  useEffect(() => {
    if (!active || !stack.length) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      back();
      return true;
    });
    return () => sub.remove();
  }, [active, stack.length, back]);

  // Deep link / notification: open the task once per id.
  const lastFocus = useRef<string | null>(null);
  useEffect(() => {
    if (!focusId || lastFocus.current === focusId) return;
    lastFocus.current = focusId;
    push({ name: 'task', id: focusId });
  }, [focusId, push]);

  const nav: TasksNav = useMemo(
    () => ({
      push,
      back,
      openComposer: (edit) => setComposer({ edit: edit || null }),
      openChat: (conversationId, name) => {
        if (onOpenChat) onOpenChat(conversationId, name);
        else Alert.alert('Chat unavailable', 'Open Campus Buddy › Chats to find the task chat.');
      },
      openReputation: (uid, name) => setRep({ userId: uid, name }),
      onGateError: gate,
      publish: (t) => {
        taskBus.emitTask(t);
        loadCounts();
      },
      onBlocked: (uid) => {
        taskBus.emitBlocked(uid);
        taskCache.clear();
        if (meta) taskCache.set(META_KEY, meta);
      },
      meta,
      me: userId || null,
    }),
    [push, back, onOpenChat, gate, loadCounts, meta, userId]
  );

  const onPublished = (task: Task, info: { edited: boolean; underReview: boolean }) => {
    setComposer(null);
    taskCache.set(`task:${task.id}`, task);
    taskBus.emitTask(task);
    loadCounts();
    if (!info.edited) {
      board.refresh();
      taskBus.emitStale(null);
      push({ name: 'task', id: task.id, task });
    }
    if (info.underReview) {
      setTimeout(
        () => Alert.alert('Waiting for a quick check', "Part of your task needs a moderator's look before it shows on the board. You'll get a notification."),
        400
      );
    }
  };

  const renderRoute = (r: TasksRoute) => {
    switch (r.name) {
      case 'task':
        return <TaskDetail id={r.id} initial={r.task} />;
      case 'mine':
        return <MyTasksScreen initialTab={r.tab} />;
      default:
        return null;
    }
  };

  const TasksIcon = SUB_TAB_META.tasks.icon;
  const myActive = (counts.posted || 0) + (counts.helping || 0) + (counts.applied || 0);
  const filtered = category !== 'all' || !!q;
  const menuPoster: any = menuTask?.poster;

  const header = (
    <View>
      <View style={styles.titleRow}>
        <View style={{ flex: 1 }}>
          <Text style={FT.h1} accessibilityRole="header">
            Tasks
          </Text>
          <Text style={FT.small}>Get help or lend a hand. No fees, ever.</Text>
        </View>
        <TouchableOpacity
          style={[styles.round, searchOpen && { borderColor: FriendsColors.accent }]}
          onPress={() => {
            if (searchOpen) setQuery('');
            setSearchOpen((v) => !v);
          }}
          accessibilityRole="button"
          accessibilityLabel={searchOpen ? 'Close search' : 'Search tasks'}
        >
          {searchOpen ? <X size={20} color={FriendsColors.ink} /> : <Search size={20} color={FriendsColors.ink} />}
        </TouchableOpacity>
      </View>

      {searchOpen ? (
        <View style={styles.searchBox}>
          <Search size={16} color={FriendsColors.muted} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={(t) => setQuery(t.slice(0, 60))}
            placeholder="Search titles and descriptions"
            placeholderTextColor={FriendsColors.faint}
            autoFocus
            returnKeyType="search"
            accessibilityLabel="Search tasks"
          />
        </View>
      ) : null}

      <View style={styles.quickRow}>
        <TouchableOpacity style={styles.askBtn} onPress={() => setComposer({ edit: null })} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel="Ask for help: post a task">
          <View style={styles.askPlus}>
            <BrandFill radius={20} />
            <Plus size={18} color={FriendsColors.accentInk} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={FT.h3}>Ask for help</Text>
            <Text style={FT.small} numberOfLines={1}>
              Notes, tutoring, errands…
            </Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.mineBtn}
          onPress={() => push({ name: 'mine', tab: (counts.helping || 0) > 0 ? 'helping' : 'posted' })}
          accessibilityRole="button"
          accessibilityLabel={`My tasks. ${counts.posted || 0} posted, ${counts.helping || 0} helping, ${counts.applied || 0} applied.`}
        >
          <ClipboardList size={18} color={FriendsColors.accent} />
          <Text style={FT.h3}>My tasks</Text>
          {myActive ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{myActive > 99 ? '99+' : myActive}</Text>
            </View>
          ) : (
            <ChevronRight size={16} color={FriendsColors.muted} />
          )}
        </TouchableOpacity>
      </View>

      <TaskChips
        label="Category"
        value={category}
        onChange={setCategory}
        options={[
          { key: 'all' as const, label: 'All', icon: <LayoutGrid size={13} color={category === 'all' ? SectionTints.tasks.fg : FriendsColors.muted} /> },
          ...TASK_CATEGORIES.map((c) => {
            const Icon = CATEGORY_META[c].icon;
            return { key: c, label: CATEGORY_META[c].short, icon: <Icon size={13} color={category === c ? SectionTints.tasks.fg : FriendsColors.muted} /> };
          }),
        ]}
      />
      <View style={styles.sortRow} accessibilityRole="tablist" accessibilityLabel="Sort">
        {SORTS.map((s) => {
          const on = s.key === sort;
          return (
            <TouchableOpacity key={s.key} onPress={() => setSort(s.key)} style={[styles.sort, on && styles.sortOn]} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={`Sort by ${s.label}`}>
              <Text style={[styles.sortText, on && { color: FriendsColors.ink }]}>{s.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {board.softError ? <TaskSoftError error={board.softError} onRetry={board.refresh} /> : null}
    </View>
  );

  const home = (
    <FlatList
      style={fui.screen}
      data={board.items}
      keyExtractor={(t) => t.id}
      renderItem={({ item }) => (
        <View style={{ paddingHorizontal: FS.lg }}>
          <TaskCard task={item} onPress={(t) => push({ name: 'task', id: t.id, task: t })} onMore={item.myRole === 'poster' ? undefined : setMenuTask} />
        </View>
      )}
      ItemSeparatorComponent={Sep}
      ListHeaderComponent={header}
      ListHeaderComponentStyle={{ marginBottom: FS.sm }}
      keyboardShouldPersistTaps="handled"
      onEndReached={board.loadMore}
      onEndReachedThreshold={0.4}
      refreshControl={
        <RefreshControl
          refreshing={board.refreshing}
          onRefresh={() => {
            board.refresh();
            loadCounts();
            loadMeta();
          }}
          tintColor={FriendsColors.accent}
          colors={[FriendsColors.accent]}
          progressBackgroundColor={FriendsColors.card}
        />
      }
      ListEmptyComponent={
        board.loading ? (
          <FriendsSkeleton rows={3} />
        ) : board.error ? (
          <FriendsError message={taskErrorMessage(board.error, "Couldn't load tasks.")} onRetry={board.reload} />
        ) : filtered ? (
          <FriendsEmpty
            tint={SectionTints.tasks.fg}
          icon={<Search size={26} color={SectionTints.tasks.fg} />}
            title="No matching tasks"
            subtitle={q ? `Nothing open matches "${q}".` : 'Nothing open in this category right now.'}
            actionLabel="Show all tasks"
            onAction={() => {
              setCategory('all');
              setQuery('');
              setSearchOpen(false);
            }}
          />
        ) : (
          <FriendsEmpty
            tint={SectionTints.tasks.fg}
          icon={<TasksIcon size={26} color={SectionTints.tasks.fg} />}
            title="No open tasks yet"
            subtitle="Be the first: ask for notes, a printout, a quick explanation or an errand. Helpers on your campus will apply."
            actionLabel="Ask for help"
            onAction={() => setComposer({ edit: null })}
          />
        )
      }
      ListFooterComponent={
        <View style={{ padding: FS.lg, paddingBottom: 120, gap: FS.md }}>
          {board.loadingMore ? <ActivityIndicator color={FriendsColors.accent} /> : null}
          {board.items.length && !board.hasMore ? (
            <View style={styles.endRow}>
              <Handshake size={14} color={FriendsColors.faint} />
              <Text style={[FT.small, { color: FriendsColors.faint }]}>That's every open task on your campus.</Text>
            </View>
          ) : null}
          <PaymentNoticeCard text={meta?.paymentNotice} compact />
        </View>
      }
    />
  );

  return (
    <TasksNavContext.Provider value={nav}>
      <View style={styles.root}>
        <View style={[styles.layer, stack.length ? styles.hidden : null]} importantForAccessibility={stack.length ? 'no-hide-descendants' : 'auto'} accessibilityElementsHidden={!!stack.length}>
          {home}
        </View>
        {stack.map((s, i) => {
          const top = i === stack.length - 1;
          return (
            <View key={s.key} style={[styles.layer, !top && styles.hidden]} importantForAccessibility={top ? 'auto' : 'no-hide-descendants'} accessibilityElementsHidden={!top}>
              {renderRoute(s.route)}
            </View>
          );
        })}
      </View>

      <TaskComposer visible={!!composer} edit={composer?.edit || null} onClose={() => setComposer(null)} onPublished={onPublished} />
      <ReputationSheet userId={rep?.userId || null} name={rep?.name || ''} onClose={() => setRep(null)} />
      <ActionMenu
        visible={!!menuTask}
        onClose={() => setMenuTask(null)}
        title={menuTask ? menuTask.title : 'Task'}
        copyLink={menuTask ? taskLink(menuTask.id) : null}
        report={menuTask ? { type: 'task', id: menuTask.id, label: `the task "${menuTask.title.slice(0, 40)}"` } : null}
        block={menuPoster?.userId ? { userId: menuPoster.userId, name: nameOf(menuPoster) } : null}
        onBlocked={nav.onBlocked}
      />
    </TasksNavContext.Provider>
  );
};

const Sep = () => <View style={{ height: FS.md }} />;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: FriendsColors.bg },
  layer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: FriendsColors.bg },
  hidden: { display: 'none' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: FS.md, paddingHorizontal: FS.lg, paddingTop: FS.lg },
  round: { width: 44, height: 44, borderRadius: 22, backgroundColor: FriendsColors.card, borderWidth: 1, borderColor: FriendsColors.line, alignItems: 'center', justifyContent: 'center' },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: FS.sm,
    marginHorizontal: FS.lg,
    marginTop: FS.md,
    paddingHorizontal: FS.md,
    minHeight: 46,
    borderRadius: FR.pill,
    backgroundColor: FriendsColors.cardHi,
    borderWidth: 1,
    borderColor: FriendsColors.line,
  },
  searchInput: { flex: 1, color: FriendsColors.ink, fontSize: 15, paddingVertical: 8 },
  quickRow: { flexDirection: 'row', gap: FS.sm, paddingHorizontal: FS.lg, marginTop: FS.lg },
  askBtn: {
    flex: 1.4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: FS.md,
    padding: FS.md,
    minHeight: 64,
    borderRadius: FR.card,
    backgroundColor: FriendsColors.card,
    borderWidth: 1,
    borderColor: 'rgba(200,182,255,0.3)',
  },
  askPlus: { width: 40, height: 40, borderRadius: 20, backgroundColor: FriendsColors.accent, alignItems: 'center', justifyContent: 'center' },
  mineBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: FS.md,
    minHeight: 64,
    borderRadius: FR.card,
    backgroundColor: FriendsColors.card,
    borderWidth: 1,
    borderColor: FriendsColors.line,
  },
  badge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, backgroundColor: FriendsColors.accent, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 12, fontWeight: '800', color: FriendsColors.accentInk },
  sortRow: { flexDirection: 'row', gap: 4, marginHorizontal: FS.lg, padding: 4, borderRadius: FR.pill, backgroundColor: FriendsColors.card, borderWidth: 1, borderColor: FriendsColors.lineSoft },
  sort: { flex: 1, minHeight: 36, borderRadius: FR.pill, alignItems: 'center', justifyContent: 'center' },
  sortOn: { backgroundColor: FriendsColors.cardHi },
  sortText: { fontSize: 12, fontWeight: '700', color: FriendsColors.muted },
  endRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
});
