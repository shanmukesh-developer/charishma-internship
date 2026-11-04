import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, RefreshControl, ActivityIndicator, Alert, Modal, StyleSheet, Pressable } from 'react-native';
import { Image } from 'expo-image';
import {
  MoreHorizontal,
  Clock,
  MapPin,
  Globe,
  Users,
  MessageCircle,
  Send,
  CheckCircle2,
  Undo2,
  XCircle,
  Gavel,
  Star,
  Pencil,
  IndianRupee,
  Hourglass,
  Ban,
  Scale,
  Check,
  Lock,
  UserX,
  UserCheck,
} from '../../../../components/lucide';
import * as Haptics from 'expo-haptics';
import { FriendsColors, FS, FT, FR, fui } from '../friendsTheme';
import { FriendsSkeleton } from '../shared/FriendsSkeleton';
import { FriendsEmpty, FriendsError } from '../shared/FriendsEmpty';
import { IdentityChip } from '../shared/IdentityChip';
import { ActionMenu, ActionMenuExtra } from '../shared/ActionMenu';
import { AppealSheet } from '../shared/AppealSheet';
import { RelativeTime, formatLocal } from '../shared/RelativeTime';
import { getCampusSocket } from '../../campusSocketClient';
import { errorCode } from '../api/core';
import { fetchMyModeration, MyModerationAction } from '../api/modApi';
import {
  Task,
  TaskAction,
  acceptTask,
  applyToTask,
  cancelTask,
  confirmTask,
  declineTask,
  disputeTask,
  fetchTask,
  rejectSubmission,
  reviewTask,
  submitTask,
  unselectHelper,
  withdrawApplication,
  TASK_LIMITS,
} from '../api/tasksApi';
import { CATEGORY_META, FULFILLMENT_LABEL, STAGE_META, deadlineLabel, formatDeadline, formatInr, nameOf, taskBadge, taskCache, taskErrorMessage, taskLink } from './tasksShared';
import { ErrorBox, StatusPill, TaskHeader } from './TasksUi';
import { PaymentNoticeCard, UpiSheet } from './PaymentNoticeCard';
import { ApplicationsSheet } from './ApplicationsSheet';
import { DisputeSheet, ReasonSheet, ReputationStars, TaskReviewSheet } from './TaskSheets';
import { TaskTimeline } from './TaskTimeline';
import { useTasksNav } from './tasksNav';

type SheetKind = null | 'apply' | 'submit' | 'reject' | 'cancel' | 'dispute' | 'review' | 'applications' | 'upi' | 'menu';

const has = (t: Task | null, a: TaskAction) => !!t && t.actions.includes(a);

/**
 * One task: what is needed, where it stands (timeline), and only the buttons the server allows for
 * me right now. Poster and helper also get the private parts: helper / poster, task chat, submission,
 * reviews and the optional UPI hand-off. Live updates arrive over the campus socket.
 */
export const TaskDetail: React.FC<{ id: string; initial?: Task | null }> = ({ id, initial }) => {
  const nav = useTasksNav();
  const [task, setTask] = useState<Task | null>(() => initial || taskCache.get<Task>(`task:${id}`) || null);
  const [loading, setLoading] = useState(!task);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<any>(null);
  const [gone, setGone] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [viewer, setViewer] = useState<string | null>(null);
  const [appealAction, setAppealAction] = useState<MyModerationAction | null>(null);
  const [appealLookup, setAppealLookup] = useState(false);
  const mounted = useRef(true);
  const gen = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const apply = useCallback(
    (t: Task) => {
      if (!mounted.current) return;
      setTask(t);
      taskCache.set(`task:${t.id}`, t);
      nav.publish(t);
    },
    [nav]
  );

  const load = useCallback(
    async (mode: 'initial' | 'refresh' | 'silent' = 'initial') => {
      const my = ++gen.current;
      if (mode === 'refresh') setRefreshing(true);
      try {
        const t = await fetchTask(id);
        if (my !== gen.current || !mounted.current) return;
        setError(null);
        setGone(false);
        apply(t);
      } catch (e: any) {
        if (my !== gen.current || !mounted.current) return;
        nav.onGateError(e);
        if (errorCode(e) === 'TASK_NOT_FOUND' || e?.status === 404) setGone(true);
        else setError(e);
      } finally {
        if (my === gen.current && mounted.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [id, apply, nav]
  );

  useEffect(() => {
    load('initial');
  }, [load]);

  // Live: the server tells poster / helper (and the poster on new applications) that this task changed.
  useEffect(() => {
    const s = getCampusSocket();
    const onUpdate = (p: { id?: string }) => {
      if (p && p.id === id) load('silent');
    };
    const onConnect = () => load('silent');
    s.on('friends:task_updated', onUpdate);
    s.on('connect', onConnect);
    return () => {
      s.off('friends:task_updated', onUpdate);
      s.off('connect', onConnect);
    };
  }, [id, load]);

  const run = async (key: string, fn: () => Promise<{ task: Task; duplicate?: boolean }>, success?: string) => {
    if (busy) return;
    setBusy(key);
    setActionError(null);
    try {
      const r = await fn();
      apply(r.task);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      if (success) Alert.alert(success.split('|')[0], success.split('|')[1] || undefined);
    } catch (e: any) {
      nav.onGateError(e);
      setActionError(taskErrorMessage(e));
      if (['STATE_CHANGED', 'TASK_NOT_OPEN', 'APPLICATION_NOT_AVAILABLE', 'USE_DECLINE', 'USE_CANCEL'].includes(errorCode(e))) load('silent');
    } finally {
      if (mounted.current) setBusy(null);
    }
  };

  /** Sheets throw so they can show the error inline; success refreshes the task here. */
  const sheetRun = async (fn: () => Promise<{ task: Task }>) => {
    try {
      const r = await fn();
      apply(r.task);
    } catch (e: any) {
      nav.onGateError(e);
      if (errorCode(e) === 'STATE_CHANGED') load('silent');
      throw e;
    }
  };

  const confirmAlert = (title: string, body: string, cta: string, fn: () => void, destructive = false) =>
    Alert.alert(title, body, [
      { text: 'Not now', style: 'cancel' },
      { text: cta, style: destructive ? 'destructive' : 'default', onPress: fn },
    ]);

  const openAppeal = async () => {
    if (!task || appealLookup) return;
    setAppealLookup(true);
    try {
      const mod = await fetchMyModeration();
      const a = mod.actions.find((x) => x.targetType === 'task' && x.targetId === task.id && ['reject', 'remove', 'hide'].includes(x.action));
      if (!a) Alert.alert('Nothing to appeal', "We couldn't find the decision for this task. See Me › Friends privacy & safety.");
      else if (a.appeal) Alert.alert('Appeal already sent', `Status: ${a.appeal.status.replace(/_/g, ' ')}. You'll get a notification with the result.`);
      else if (!a.appealable) Alert.alert("Can't appeal", 'This decision can no longer be appealed.');
      else setAppealAction(a);
    } catch (e: any) {
      Alert.alert("Couldn't load the decision", taskErrorMessage(e));
    } finally {
      if (mounted.current) setAppealLookup(false);
    }
  };

  // ── States ────────────────────────────────────────────────────────────────
  if (gone) {
    return (
      <View style={fui.screen}>
        <TaskHeader title="Task" onBack={nav.back} />
        <FriendsEmpty
          icon={<Ban size={22} color={FriendsColors.muted} />}
          title="This task isn't available"
          subtitle="It may have been completed, cancelled, removed, or posted by someone you blocked."
          actionLabel="Back to Tasks"
          onAction={nav.back}
        />
      </View>
    );
  }
  if (!task) {
    return (
      <View style={fui.screen}>
        <TaskHeader title="Task" onBack={nav.back} />
        {loading ? <FriendsSkeleton rows={2} /> : <FriendsError message={taskErrorMessage(error, "Couldn't load this task.")} onRetry={() => load('initial')} />}
      </View>
    );
  }

  const t = task;
  const cat = CATEGORY_META[t.category] || CATEGORY_META.other;
  const CatIcon = cat.icon;
  const badge = taskBadge(t);
  const isPoster = t.myRole === 'poster';
  const isHelper = t.myRole === 'helper';
  const participant = isPoster || isHelper;
  const poster: any = t.poster;
  const helper: any = t.helper;
  const other: any = isPoster ? helper : poster;
  const otherName = nameOf(other);
  const live = ['open', 'assigned'].includes(t.status);
  const dl = live ? deadlineLabel(t.deadlineAt) : null;
  const mod = t.modStatus;

  const menuExtra: ActionMenuExtra[] = [];
  if (has(t, 'edit')) menuExtra.push({ key: 'edit', label: 'Edit task', icon: <Pencil size={18} color={FriendsColors.ink} />, onPress: () => nav.openComposer(t) });
  // Block the other side: the helper (for the poster) or the poster (for everyone else).
  const blockWho: any = isPoster ? helper : poster;
  const blockTarget = blockWho?.userId ? { userId: blockWho.userId as string, name: nameOf(blockWho) } : null;

  const openChat = () => {
    if (!t.chat?.conversationId) return;
    nav.openChat(t.chat.conversationId, otherName);
  };

  // ── Role panel ────────────────────────────────────────────────────────────
  const panel = (() => {
    const blocks: React.ReactNode[] = [];

    if (isPoster && mod === 'rejected') {
      blocks.push(
        <View key="rej" style={[styles.banner, styles.bannerDanger]} accessibilityRole="alert">
          <View style={styles.bannerHead}>
            <Ban size={16} color={FriendsColors.danger} />
            <Text style={[FT.h3, { color: FriendsColors.danger }]}>Refused by the academic-integrity check</Text>
          </View>
          {(t.integrity?.details || []).map((d, i) => (
            <Text key={i} style={[FT.body, { marginTop: 6 }]}>
              {d}
            </Text>
          ))}
          <Text style={[FT.small, { marginTop: 6 }]}>Only you can see this task. If we got it wrong, appeal and a moderator will review it.</Text>
          <TouchableOpacity style={[fui.ghostBtn, { marginTop: FS.md, alignSelf: 'flex-start' }]} onPress={openAppeal} disabled={appealLookup} accessibilityRole="button" accessibilityLabel="Appeal this decision">
            {appealLookup ? <ActivityIndicator size="small" color={FriendsColors.ink} /> : <Scale size={14} color={FriendsColors.ink} />}
            <Text style={fui.ghostBtnText}>Appeal</Text>
          </TouchableOpacity>
        </View>
      );
    } else if (isPoster && (mod === 'removed' || mod === 'hidden')) {
      blocks.push(
        <View key="mod" style={[styles.banner, styles.bannerDanger]} accessibilityRole="alert">
          <View style={styles.bannerHead}>
            <Ban size={16} color={FriendsColors.danger} />
            <Text style={[FT.h3, { color: FriendsColors.danger }]}>{mod === 'removed' ? 'Removed by a moderator' : 'Hidden by a moderator'}</Text>
          </View>
          {t.removedReason ? <Text style={[FT.body, { marginTop: 6 }]}>{t.removedReason}</Text> : null}
          <TouchableOpacity style={[fui.ghostBtn, { marginTop: FS.md, alignSelf: 'flex-start' }]} onPress={openAppeal} disabled={appealLookup} accessibilityRole="button" accessibilityLabel="Appeal this decision">
            {appealLookup ? <ActivityIndicator size="small" color={FriendsColors.ink} /> : <Scale size={14} color={FriendsColors.ink} />}
            <Text style={fui.ghostBtnText}>Appeal</Text>
          </TouchableOpacity>
        </View>
      );
    } else if (isPoster && mod === 'pending_review') {
      blocks.push(
        <View key="pr" style={[styles.banner, styles.bannerWarn]}>
          <View style={styles.bannerHead}>
            <Hourglass size={16} color={FriendsColors.warn} />
            <Text style={[FT.h3, { color: FriendsColors.warn }]}>Waiting for a moderator</Text>
          </View>
          <Text style={[FT.small, { marginTop: 6 }]}>Part of this task needs a quick human check before it shows on the board. You'll get a notification.</Text>
        </View>
      );
    }

    if (t.status === 'cancelled') {
      blocks.push(
        <View key="c" style={styles.banner}>
          <View style={styles.bannerHead}>
            <XCircle size={16} color={FriendsColors.muted} />
            <Text style={FT.h3}>
              Cancelled{t.cancelledBy === 'moderator' ? ' by a moderator' : t.cancelledBy && participant ? ` by ${t.cancelledBy === t.myRole ? 'you' : t.cancelledBy === 'poster' ? 'the poster' : 'the helper'}` : ''}
            </Text>
          </View>
          {participant && t.cancelReason ? <Text style={[FT.body, { marginTop: 6 }]}>{t.cancelReason}</Text> : null}
          {participant && t.cancelledAt ? <Text style={[FT.small, { marginTop: 4 }]}>{formatLocal(t.cancelledAt)}</Text> : null}
        </View>
      );
    } else if (t.status === 'expired') {
      blocks.push(
        <View key="e" style={styles.banner}>
          <View style={styles.bannerHead}>
            <Clock size={16} color={FriendsColors.muted} />
            <Text style={FT.h3}>Expired</Text>
          </View>
          <Text style={[FT.small, { marginTop: 6 }]}>The deadline passed before work started.{isPoster ? ' Post it again with a new deadline if you still need help.' : ''}</Text>
        </View>
      );
    } else if (t.status === 'disputed') {
      blocks.push(
        <View key="d" style={[styles.banner, styles.bannerDanger]}>
          <View style={styles.bannerHead}>
            <Gavel size={16} color={FriendsColors.danger} />
            <Text style={[FT.h3, { color: FriendsColors.danger }]}>In dispute</Text>
          </View>
          <Text style={[FT.small, { marginTop: 6 }]}>
            {participant
              ? `Opened by ${t.disputedBy === t.myRole ? 'you' : t.disputedBy === 'poster' ? 'the poster' : 'the helper'}. A moderator will decide whether the task is completed, cancelled or reopened. You'll both be notified.`
              : 'A moderator is reviewing this task.'}
          </Text>
          {participant && t.disputeReason ? <Text style={[FT.body, { marginTop: 6 }]}>"{t.disputeReason}"</Text> : null}
        </View>
      );
    }

    if (participant && t.disputeResolution && t.status !== 'disputed') {
      blocks.push(
        <View key="dr" style={styles.banner}>
          <Text style={FT.kicker}>Moderator decision</Text>
          <Text style={[FT.body, { marginTop: 4 }]}>{t.disputeResolution}</Text>
        </View>
      );
    }

    // Poster: applications.
    if (isPoster && t.status === 'open' && mod === 'visible') {
      blocks.push(
        <TouchableOpacity key="apps" style={styles.appsCard} onPress={() => setSheet('applications')} accessibilityRole="button" accessibilityLabel={`View ${t.applicationCount} applications`}>
          <View style={styles.appsIcon}>
            <Users size={20} color={FriendsColors.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={FT.h3}>{t.applicationCount ? `${t.applicationCount} application${t.applicationCount > 1 ? 's' : ''}` : 'No applications yet'}</Text>
            <Text style={FT.small}>{t.applicationCount ? 'Review notes and ratings, then choose one helper.' : "You'll get a notification when someone applies."}</Text>
          </View>
          {t.applicationCount ? <Text style={styles.link}>View</Text> : null}
        </TouchableOpacity>
      );
    }

    // Helper / poster: the other person.
    if (participant && helper && t.status !== 'open') {
      const label = isPoster ? (t.status === 'assigned' ? 'You chose' : 'Your helper') : 'Posted by';
      blocks.push(
        <View key="who" style={fui.cardPad}>
          <Text style={[FT.kicker, { marginBottom: FS.sm }]}>{label}</Text>
          <IdentityChip identity={isPoster ? t.helper : t.poster} onPress={other?.userId ? (uid) => nav.openReputation(uid, otherName) : undefined} />
          {t.status === 'assigned' ? (
            <Text style={[FT.small, { marginTop: FS.sm }]}>
              {isPoster ? `Waiting for ${otherName} to accept. You can choose someone else until then.` : `${nameOf(poster)} chose you. Accept to start, or decline so they can pick someone else.`}
            </Text>
          ) : null}
          {t.chat ? (
            <TouchableOpacity style={[fui.ghostBtn, { marginTop: FS.md }]} onPress={openChat} accessibilityRole="button" accessibilityLabel={`Open task chat with ${otherName}`}>
              {t.chat.canSend ? <MessageCircle size={16} color={FriendsColors.ink} /> : <Lock size={14} color={FriendsColors.muted} />}
              <Text style={fui.ghostBtnText}>{t.chat.canSend ? 'Task chat' : 'Task chat (read only)'}</Text>
            </TouchableOpacity>
          ) : null}
          {t.chat?.closesAt && t.chat.canSend ? <Text style={[FT.small, { marginTop: 6, textAlign: 'center' }]}>Chat stays open until {formatLocal(t.chat.closesAt)}</Text> : null}
        </View>
      );
    }

    // Submission.
    if (participant && (t.status === 'submitted' || t.lastRejectionNote || t.submissionNote)) {
      blocks.push(
        <View key="sub" style={fui.cardPad}>
          {t.status === 'submitted' ? (
            <>
              <View style={styles.bannerHead}>
                <Send size={16} color={FriendsColors.warn} />
                <Text style={FT.h3}>{isPoster ? `${otherName} marked this done` : 'Waiting for the poster to confirm'}</Text>
              </View>
              {t.submissionNote ? <Text style={[FT.body, { marginTop: 6 }]}>{t.submissionNote}</Text> : null}
              {t.autoConfirmAt ? (
                <Text style={[FT.small, { marginTop: 6 }]}>
                  {isPoster ? 'If you do nothing, it completes automatically on ' : 'Completes automatically on '}
                  {formatLocal(t.autoConfirmAt)}.
                </Text>
              ) : null}
            </>
          ) : t.lastRejectionNote && t.status === 'in_progress' ? (
            <>
              <View style={styles.bannerHead}>
                <Undo2 size={16} color={FriendsColors.warn} />
                <Text style={FT.h3}>Sent back{t.submissionRejections ? ` (${t.submissionRejections}/${TASK_LIMITS.maxSubmissionRejections})` : ''}</Text>
              </View>
              <Text style={[FT.body, { marginTop: 6 }]}>{t.lastRejectionNote}</Text>
            </>
          ) : t.submissionNote && t.status === 'completed' ? (
            <>
              <Text style={FT.kicker}>Helper's note</Text>
              <Text style={[FT.body, { marginTop: 4 }]}>{t.submissionNote}</Text>
            </>
          ) : null}
        </View>
      );
    }

    // Completed: reviews.
    if (participant && t.status === 'completed') {
      const r = t.reviews;
      blocks.push(
        <View key="rev" style={fui.cardPad}>
          <View style={styles.bannerHead}>
            <CheckCircle2 size={16} color={FriendsColors.success} />
            <Text style={FT.h3}>Completed{t.autoConfirmed ? ' automatically' : ''}</Text>
          </View>
          {t.completedAt ? <Text style={[FT.small, { marginTop: 4 }]}>{formatLocal(t.completedAt)}</Text> : null}
          <View style={{ marginTop: FS.md, gap: FS.sm }}>
            <ReviewRow label="Your review" review={r?.mine || null} empty={has(t, 'review') ? 'Not reviewed yet' : 'No review'} />
            <ReviewRow label={`${otherName}'s review of you`} review={r?.theirs || null} empty="Not reviewed yet" />
          </View>
        </View>
      );
    }

    // Applicant: my application.
    if (!participant && t.myApplication && t.myApplication.status !== 'withdrawn') {
      const a = t.myApplication;
      blocks.push(
        <View key="app" style={fui.cardPad}>
          <View style={styles.bannerHead}>
            {a.status === 'pending' ? <Hourglass size={16} color={FriendsColors.accent} /> : a.status === 'rejected' || a.status === 'declined' ? <UserX size={16} color={FriendsColors.muted} /> : <UserCheck size={16} color={FriendsColors.gold} />}
            <Text style={FT.h3}>{a.status === 'pending' ? 'You applied' : a.status === 'rejected' ? 'Someone else was chosen' : a.status === 'declined' ? 'You declined' : 'Application'}</Text>
          </View>
          {a.note ? <Text style={[FT.body, { marginTop: 6 }]}>{a.note}</Text> : null}
          {a.createdAt ? <RelativeTime value={a.createdAt} prefix="Sent" style={{ marginTop: 4 }} /> : null}
        </View>
      );
    }

    return blocks;
  })();

  // ── Buttons (exactly the server's actions) ───────────────────────────────
  const buttons: React.ReactNode[] = [];
  const primary = (key: string, label: string, icon: React.ReactNode, onPress: () => void, tone: 'accent' | 'danger' = 'accent') =>
    buttons.push(
      <TouchableOpacity
        key={key}
        style={[fui.primaryBtn, tone === 'danger' && { backgroundColor: FriendsColors.danger }, !!busy && { opacity: 0.6 }]}
        onPress={onPress}
        disabled={!!busy}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        {busy === key ? <ActivityIndicator color={FriendsColors.accentInk} /> : icon}
        <Text style={fui.primaryBtnText}>{label}</Text>
      </TouchableOpacity>
    );
  const ghost = (key: string, label: string, icon: React.ReactNode, onPress: () => void, danger = false) =>
    buttons.push(
      <TouchableOpacity key={key} style={[fui.ghostBtn, !!busy && { opacity: 0.6 }]} onPress={onPress} disabled={!!busy} accessibilityRole="button" accessibilityLabel={label}>
        {busy === key ? <ActivityIndicator size="small" color={FriendsColors.ink} /> : icon}
        <Text style={[fui.ghostBtnText, danger && { color: FriendsColors.danger }]}>{label}</Text>
      </TouchableOpacity>
    );

  if (has(t, 'apply')) primary('apply', t.myApplication?.status === 'withdrawn' ? 'Apply again' : 'Apply to help', <Send size={16} color={FriendsColors.accentInk} />, () => setSheet('apply'));
  if (has(t, 'accept'))
    primary('accept', 'Accept and start', <Check size={16} color={FriendsColors.accentInk} />, () =>
      run('accept', () => acceptTask(t.id), 'You are the helper|A private task chat with the poster is ready.')
    );
  if (has(t, 'submit')) primary('submit', 'Mark as done', <Send size={16} color={FriendsColors.accentInk} />, () => setSheet('submit'));
  if (has(t, 'confirm'))
    primary('confirm', 'Confirm completed', <CheckCircle2 size={16} color={FriendsColors.accentInk} />, () =>
      confirmAlert('Confirm the work is done?', `This completes the task and counts towards ${otherName}'s reputation. Pay them directly as you agreed.`, 'Confirm', () =>
        run('confirm', () => confirmTask(t.id))
      )
    );
  if (has(t, 'review')) primary('review', `Rate ${otherName}`, <Star size={16} color={FriendsColors.accentInk} />, () => setSheet('review'));
  if (has(t, 'reject_submission')) ghost('reject', 'Send back', <Undo2 size={16} color={FriendsColors.ink} />, () => setSheet('reject'));
  if (has(t, 'decline'))
    ghost('decline', 'Decline', <XCircle size={16} color={FriendsColors.ink} />, () =>
      confirmAlert('Decline this task?', "The poster can choose someone else. You can't apply to it again.", 'Decline', () => run('decline', () => declineTask(t.id)), true)
    );
  if (has(t, 'unselect'))
    ghost('unselect', 'Choose someone else', <Undo2 size={16} color={FriendsColors.ink} />, () =>
      confirmAlert(`Unselect ${otherName}?`, 'Their application goes back to the list and the task reopens.', 'Unselect', () => run('unselect', () => unselectHelper(t.id)))
    );
  if (has(t, 'withdraw'))
    ghost('withdraw', 'Withdraw application', <Undo2 size={16} color={FriendsColors.ink} />, () =>
      confirmAlert('Withdraw your application?', 'You can apply again while the task is open.', 'Withdraw', () =>
        run('withdraw', async () => {
          await withdrawApplication(t.id);
          return { task: await fetchTask(t.id) };
        })
      )
    );
  if (has(t, 'cancel'))
    ghost('cancel', 'Cancel task', <XCircle size={16} color={FriendsColors.danger} />, () => {
      if (t.status === 'in_progress') setSheet('cancel');
      else
        confirmAlert(
          'Cancel this task?',
          t.status === 'assigned' ? `${otherName} and everyone who applied will be told.` : 'Everyone who applied will be told.',
          'Cancel task',
          () => run('cancel', () => cancelTask(t.id)),
          true
        );
    }, true);
  if (has(t, 'dispute')) ghost('dispute', 'Open a dispute', <Gavel size={16} color={FriendsColors.danger} />, () => setSheet('dispute'), true);

  const canPay = isPoster && !!helper && ['in_progress', 'submitted', 'completed'].includes(t.status);

  return (
    <View style={fui.screen}>
      <TaskHeader
        title={cat.short}
        subtitle={STAGE_META[t.stage]?.label || t.status}
        onBack={nav.back}
        right={
          <TouchableOpacity onPress={() => setSheet('menu')} style={styles.round} accessibilityRole="button" accessibilityLabel="Task options: report, block, copy link">
            <MoreHorizontal size={20} color={FriendsColors.ink} />
          </TouchableOpacity>
        }
      />
      <ScrollView
        contentContainerStyle={{ padding: FS.lg, paddingBottom: 120, gap: FS.lg }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} tintColor={FriendsColors.accent} colors={[FriendsColors.accent]} progressBackgroundColor={FriendsColors.card} />}
      >
        {error ? (
          <TouchableOpacity style={styles.stale} onPress={() => load('refresh')} accessibilityRole="button">
            <Text style={[FT.small, { color: FriendsColors.warn }]}>{taskErrorMessage(error, "Couldn't refresh.")} Showing what was loaded. Tap to retry.</Text>
          </TouchableOpacity>
        ) : null}

        {/* Hero */}
        <View style={styles.hero}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: FS.sm }}>
            <View style={styles.cat}>
              <CatIcon size={14} color={FriendsColors.accent} />
              <Text style={styles.catText}>{cat.label}</Text>
            </View>
            <View style={{ flex: 1 }} />
            <StatusPill label={badge.label} tone={badge.tone} />
          </View>
          <Text style={[FT.h1, { marginTop: FS.md }]} accessibilityRole="header">
            {t.title}
          </Text>
          <View style={styles.rewardRow} accessible accessibilityLabel={t.rewardInr > 0 ? `Reward ${t.rewardInr} rupees, paid directly between students` : 'No payment offered'}>
            <Text style={[styles.reward, t.rewardInr > 0 ? null : { color: FriendsColors.muted }]}>{formatInr(t.rewardInr)}</Text>
            <Text style={FT.small}>{t.rewardInr > 0 ? 'paid directly, outside ZenWe' : 'a favour'}</Text>
          </View>
          <View style={styles.facts}>
            <Fact icon={<Clock size={14} color={dl?.urgent ? FriendsColors.warn : FriendsColors.muted} />} text={`${formatDeadline(t.deadlineAt)}${dl ? ` · ${dl.text}` : ''}`} warn={!!dl?.urgent} label="Deadline" />
            <Fact
              icon={t.fulfillment === 'online' ? <Globe size={14} color={FriendsColors.muted} /> : <MapPin size={14} color={FriendsColors.muted} />}
              text={`${FULFILLMENT_LABEL[t.fulfillment]}${t.areaHint ? ` · ${t.areaHint}` : ''}`}
              label="Where"
            />
            {t.status === 'open' ? <Fact icon={<Users size={14} color={FriendsColors.muted} />} text={`${t.applicationCount} applied`} label="Applications" /> : null}
          </View>
        </View>

        <View style={fui.cardPad}>
          <Text style={FT.body} selectable>
            {t.description}
          </Text>
          {t.skills.length ? (
            <View style={styles.skills}>
              {t.skills.map((s) => (
                <View key={s} style={styles.skill}>
                  <Text style={styles.skillText}>{s}</Text>
                </View>
              ))}
            </View>
          ) : null}
          {t.media.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: FS.sm, marginTop: FS.md }}>
              {t.media.map((m, i) => (
                <TouchableOpacity key={m.mediaId} onPress={() => setViewer(m.url)} accessibilityRole="imagebutton" accessibilityLabel={`Photo ${i + 1} of ${t.media.length}, open full screen`}>
                  <Image source={{ uri: m.url }} style={styles.thumb} contentFit="cover" transition={150} />
                </TouchableOpacity>
              ))}
            </ScrollView>
          ) : null}
          <View style={styles.posterRow}>
            <IdentityChip identity={t.poster} time={t.createdAt} size="sm" onPress={!isPoster && poster?.userId ? (uid) => nav.openReputation(uid, nameOf(poster)) : undefined} />
            {t.editedAt ? <Text style={[FT.small, { marginTop: 2 }]}>Edited</Text> : null}
          </View>
        </View>

        <TaskTimeline task={t} />

        {panel}

        <ErrorBox message={actionError} />
        {buttons.length ? <View style={{ gap: FS.sm }}>{buttons}</View> : null}

        <PaymentNoticeCard text={t.paymentNotice}>
          {canPay ? (
            <TouchableOpacity style={[fui.ghostBtn, { marginTop: FS.md, alignSelf: 'flex-start' }]} onPress={() => setSheet('upi')} accessibilityRole="button" accessibilityLabel="Pay with a UPI app (optional)">
              <IndianRupee size={14} color={FriendsColors.ink} />
              <Text style={fui.ghostBtnText}>Pay with a UPI app</Text>
            </TouchableOpacity>
          ) : null}
        </PaymentNoticeCard>
      </ScrollView>

      {/* Sheets */}
      <ReasonSheet
        visible={sheet === 'apply'}
        onClose={() => setSheet(null)}
        title="Apply to help"
        subtitle={`${nameOf(poster)} sees your note, name and task rating.`}
        icon={<Send size={18} color={FriendsColors.accent} />}
        label="Why you're a good fit"
        placeholder="Your experience, when you're free, how you'd approach it. No phone numbers or UPI ids."
        confirmLabel="Send application"
        max={TASK_LIMITS.noteMax}
        onSubmit={(note) =>
          sheetRun(async () => {
            await applyToTask(t.id, note);
            return { task: await fetchTask(t.id) };
          })
        }
      />
      <ReasonSheet
        visible={sheet === 'submit'}
        onClose={() => setSheet(null)}
        title="Mark as done"
        subtitle={`${nameOf(poster)} confirms, or sends it back with a note.`}
        icon={<Send size={18} color={FriendsColors.accent} />}
        label="What you delivered"
        placeholder="e.g. Shared the notes in the chat, explained chapters 3 and 4"
        confirmLabel="Submit"
        onSubmit={(note) => sheetRun(() => submitTask(t.id, note))}
      />
      <ReasonSheet
        visible={sheet === 'reject'}
        onClose={() => setSheet(null)}
        title="Send back"
        subtitle={`${t.submissionRejections || 0} of ${TASK_LIMITS.maxSubmissionRejections} used. After that, confirm or open a dispute.`}
        icon={<Undo2 size={18} color={FriendsColors.warn} />}
        label="What's still missing"
        placeholder="Be specific so your helper can fix it"
        confirmLabel="Send back"
        min={TASK_LIMITS.reasonMin}
        max={TASK_LIMITS.reasonMax}
        onSubmit={(reason) => sheetRun(() => rejectSubmission(t.id, reason))}
      />
      <ReasonSheet
        visible={sheet === 'cancel'}
        onClose={() => setSheet(null)}
        title="Cancel task"
        subtitle={`${otherName} is told why. If you disagree about the work, open a dispute instead.`}
        icon={<XCircle size={18} color={FriendsColors.danger} />}
        label="Reason"
        placeholder="Tell the other person why you're cancelling"
        confirmLabel="Cancel task"
        destructive
        min={TASK_LIMITS.reasonMin}
        max={TASK_LIMITS.reasonMax}
        onSubmit={(reason) => sheetRun(() => cancelTask(t.id, reason))}
      />
      <DisputeSheet visible={sheet === 'dispute'} onClose={() => setSheet(null)} onSubmit={(reason, category) => sheetRun(() => disputeTask(t.id, reason, category))} />
      <TaskReviewSheet
        visible={sheet === 'review'}
        onClose={() => setSheet(null)}
        revieweeName={otherName}
        revieweeRole={isPoster ? 'helper' : 'poster'}
        onSubmit={(rating, text) => sheetRun(() => reviewTask(t.id, rating, text))}
      />
      <ApplicationsSheet task={t} visible={sheet === 'applications'} onClose={() => setSheet(null)} onChanged={apply} />
      <UpiSheet visible={sheet === 'upi'} onClose={() => setSheet(null)} amountInr={t.rewardInr} payeeName={otherName} taskTitle={t.title} notice={t.paymentNotice} />
      <ActionMenu
        visible={sheet === 'menu'}
        onClose={() => setSheet(null)}
        title="Task"
        copyLink={mod === 'visible' || !isPoster ? taskLink(t.id) : null}
        extra={menuExtra}
        report={
          !isPoster
            ? { type: 'task', id: t.id, label: `the task "${t.title.slice(0, 40)}"` }
            : blockTarget
              ? { type: 'profile', id: blockTarget.userId, label: `your helper ${blockTarget.name}` }
              : null
        }
        block={blockTarget}
        onBlocked={(uid) => {
          nav.onBlocked(uid);
          if (!participant) nav.back();
          else load('silent');
        }}
      />
      <AppealSheet visible={!!appealAction} onClose={() => setAppealAction(null)} action={appealAction} onAppealed={() => load('silent')} />

      <Modal visible={!!viewer} transparent animationType="fade" onRequestClose={() => setViewer(null)}>
        <Pressable style={styles.viewer} onPress={() => setViewer(null)} accessibilityRole="button" accessibilityLabel="Close photo">
          {viewer ? <Image source={{ uri: viewer }} style={{ width: '100%', height: '80%' }} contentFit="contain" /> : null}
        </Pressable>
      </Modal>
    </View>
  );
};

const Fact: React.FC<{ icon: React.ReactNode; text: string; warn?: boolean; label: string }> = ({ icon, text, warn, label }) => (
  <View style={styles.fact} accessible accessibilityLabel={`${label}: ${text}`}>
    {icon}
    <Text style={[FT.small, { flex: 1, color: warn ? FriendsColors.warn : FriendsColors.ink }]}>{text}</Text>
  </View>
);

const ReviewRow: React.FC<{ label: string; review: { rating: number; text: string; createdAt: string | null } | null; empty: string }> = ({ label, review, empty }) => (
  <View style={styles.reviewRow} accessible accessibilityLabel={review ? `${label}: ${review.rating} of 5. ${review.text}` : `${label}: ${empty}`}>
    <Text style={FT.small}>{label}</Text>
    {review ? (
      <>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
          <ReputationStars rating={review.rating} size={14} />
          {review.createdAt ? <RelativeTime value={review.createdAt} /> : null}
        </View>
        {review.text ? <Text style={[FT.body, { marginTop: 4 }]}>{review.text}</Text> : null}
      </>
    ) : (
      <Text style={[FT.small, { color: FriendsColors.faint, marginTop: 2 }]}>{empty}</Text>
    )}
  </View>
);

const styles = StyleSheet.create({
  round: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  stale: { padding: FS.md, borderRadius: FR.md, backgroundColor: FriendsColors.warnSoft, minHeight: 44, justifyContent: 'center' },
  hero: {
    padding: FS.lg,
    borderRadius: FR.card,
    backgroundColor: FriendsColors.card,
    borderWidth: 1,
    borderColor: 'rgba(212,175,122,0.22)',
  },
  cat: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 4, borderRadius: FR.pill, backgroundColor: FriendsColors.accentSoft, flexShrink: 1 },
  catText: { fontSize: 12, fontWeight: '800', color: FriendsColors.accent },
  rewardRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: FS.sm },
  reward: { fontSize: 26, fontWeight: '800', color: FriendsColors.gold, letterSpacing: -0.4 },
  facts: { marginTop: FS.md, gap: 8 },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  skills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: FS.md },
  skill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: FR.pill, backgroundColor: FriendsColors.cardHi, borderWidth: 1, borderColor: FriendsColors.line },
  skillText: { fontSize: 12, fontWeight: '700', color: FriendsColors.muted },
  thumb: { width: 120, height: 120, borderRadius: FR.md, backgroundColor: FriendsColors.cardHi },
  posterRow: { marginTop: FS.md, paddingTop: FS.md, borderTopWidth: 1, borderTopColor: FriendsColors.lineSoft },
  banner: { padding: FS.lg, borderRadius: FR.card, backgroundColor: FriendsColors.card, borderWidth: 1, borderColor: FriendsColors.line },
  bannerDanger: { backgroundColor: 'rgba(243,139,128,0.06)', borderColor: 'rgba(243,139,128,0.3)' },
  bannerWarn: { backgroundColor: 'rgba(242,178,126,0.06)', borderColor: 'rgba(242,178,126,0.3)' },
  bannerHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  appsCard: { flexDirection: 'row', alignItems: 'center', gap: FS.md, padding: FS.lg, borderRadius: FR.card, backgroundColor: FriendsColors.card, borderWidth: 1, borderColor: FriendsColors.line, minHeight: 72 },
  appsIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: FriendsColors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  link: { fontSize: 14, fontWeight: '800', color: FriendsColors.accent },
  reviewRow: { padding: FS.md, borderRadius: FR.md, backgroundColor: FriendsColors.cardHi },
  viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
});
