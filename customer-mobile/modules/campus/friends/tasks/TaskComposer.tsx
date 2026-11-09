import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { Check, X, Minus, Plus, ShieldCheck, Ban, Scale, CalendarClock, Hourglass } from '../../../../components/lucide';
import * as Haptics from 'expo-haptics';
import { FriendsColors, FS, FT, FR, fui } from '../friendsTheme';
import { FriendsScreenModal } from '../shared/FriendsSheet';
import { ImagePickerRow } from '../shared/ImagePickerRow';
import { AppealSheet } from '../shared/AppealSheet';
import { newClientId, errorCode } from '../api/core';
import type { MyModerationAction } from '../api/modApi';
import type { UploadedImage } from '../../../../utils/imageUpload';
import { TASK_CATEGORIES, TASK_FULFILLMENT, TASK_LIMITS, Task, TaskCategory, TaskFulfillment, TaskInput, createTask, updateTask } from '../api/tasksApi';
import { CATEGORY_META, FULFILLMENT_LABEL, formatDeadline, taskErrorMessage } from './tasksShared';
import { ErrorBox, taskUi } from './TasksUi';
import { PaymentNoticeCard } from './PaymentNoticeCard';
import { useTasksNav } from './tasksNav';

import { themedSheet } from '../../../../utils/themeNow';
interface Draft {
  title: string;
  description: string;
  category: TaskCategory | null;
  reward: string;
  deadline: number;
  skills: string[];
  fulfillment: TaskFulfillment;
  areaHint: string;
  images: UploadedImage[];
  clientId: string;
}

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const roundUp = (ms: number, step = 30 * MIN) => Math.ceil(ms / step) * step;
const defaultDeadline = () => {
  const d = new Date(Date.now() + DAY);
  d.setHours(18, 0, 0, 0);
  return d.getTime();
};

const emptyDraft = (): Draft => ({
  title: '',
  description: '',
  category: null,
  reward: '',
  deadline: defaultDeadline(),
  skills: [],
  fulfillment: 'either',
  areaHint: '',
  images: [],
  clientId: newClientId(),
});

const fromTask = (t: Task): Draft => ({
  title: t.title,
  description: t.description,
  category: t.category,
  reward: t.rewardInr ? String(t.rewardInr) : '',
  deadline: t.deadlineAt ? new Date(t.deadlineAt).getTime() : defaultDeadline(),
  skills: [...(t.skills || [])],
  fulfillment: t.fulfillment,
  areaHint: t.areaHint || '',
  images: (t.media || []).map((m) => ({ url: m.url, absoluteUrl: m.url, localUri: '', id: m.mediaId })),
  clientId: newClientId(),
});

const presets = (): { key: string; label: string; at: number }[] => {
  const now = Date.now();
  const out: { key: string; label: string; at: number }[] = [{ key: '3h', label: 'In 3 hours', at: roundUp(now + 3 * HOUR) }];
  const tonight = new Date();
  tonight.setHours(21, 0, 0, 0);
  if (tonight.getTime() - now > 60 * MIN) out.push({ key: 'tonight', label: 'Tonight 9 PM', at: tonight.getTime() });
  const tmr = new Date(now + DAY);
  tmr.setHours(18, 0, 0, 0);
  out.push({ key: 'tomorrow', label: 'Tomorrow 6 PM', at: tmr.getTime() });
  const d3 = new Date(now + 3 * DAY);
  d3.setHours(18, 0, 0, 0);
  out.push({ key: '3d', label: 'In 3 days', at: d3.getTime() });
  const w = new Date(now + 7 * DAY);
  w.setHours(18, 0, 0, 0);
  out.push({ key: '1w', label: 'In a week', at: w.getTime() });
  return out;
};

const len = (s: string) => Array.from(s.trim()).length;

/**
 * Post or edit a task. Shows what is and isn't allowed (academic integrity) before writing; the
 * server decides and its reasons are shown inline, with an appeal path for an integrity refusal.
 * The draft survives closing the composer, and a retry never creates a second task (clientId).
 */
export const TaskComposer: React.FC<{
  visible: boolean;
  edit: Task | null;
  onClose: () => void;
  onPublished: (task: Task, info: { edited: boolean; underReview: boolean }) => void;
}> = ({ visible, edit, onClose, onPublished }) => {
  const nav = useTasksNav();
  const meta = nav.meta;
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [skillText, setSkillText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [integrity, setIntegrity] = useState<{ details: string[]; action: MyModerationAction | null } | null>(null);
  const [appeal, setAppeal] = useState<MyModerationAction | null>(null);
  const [showGuide, setShowGuide] = useState(true);
  const editId = edit?.id || null;
  const newDraft = useRef<Draft | null>(null);

  // Opening for edit loads the task; opening for a new task restores the unsent draft.
  useEffect(() => {
    if (!visible) return;
    setError(null);
    setIntegrity(null);
    if (edit) {
      setDraft(fromTask(edit));
    } else {
      setDraft(newDraft.current || emptyDraft());
    }
    setSkillText('');
  }, [visible, editId]); // eslint-disable-line react-hooks/exhaustive-deps

  const patch = (p: Partial<Draft>) => {
    setDraft((d) => {
      const next = { ...d, ...p };
      if (!editId) newDraft.current = next;
      return next;
    });
    setError(null);
  };

  const L = {
    titleMin: meta?.text.titleMin ?? TASK_LIMITS.titleMin,
    titleMax: meta?.text.titleMax ?? TASK_LIMITS.titleMax,
    descMin: meta?.text.descriptionMin ?? TASK_LIMITS.descriptionMin,
    descMax: meta?.text.descriptionMax ?? TASK_LIMITS.descriptionMax,
    rewardMax: meta?.reward.max ?? TASK_LIMITS.rewardMax,
    maxSkills: meta?.text.maxSkills ?? TASK_LIMITS.maxSkills,
    skillMax: meta?.text.skillMax ?? TASK_LIMITS.skillMax,
    areaMax: meta?.text.areaHintMax ?? TASK_LIMITS.areaHintMax,
    maxMedia: meta?.text.maxMedia ?? TASK_LIMITS.maxMedia,
    minMinutes: meta?.deadline.minMinutes ?? TASK_LIMITS.deadlineMinMinutes,
    maxDays: meta?.deadline.maxDays ?? TASK_LIMITS.deadlineMaxDays,
  };

  const rewardNum = draft.reward ? Number(draft.reward) : 0;
  const deadlineOk = draft.deadline - Date.now() >= L.minMinutes * MIN && draft.deadline - Date.now() <= L.maxDays * DAY;
  const problems = useMemo(() => {
    const p: string[] = [];
    if (len(draft.title) < L.titleMin) p.push(`Title needs at least ${L.titleMin} characters`);
    if (len(draft.description) < L.descMin) p.push(`Description needs at least ${L.descMin} characters`);
    if (!draft.category) p.push('Pick a category');
    if (!Number.isInteger(rewardNum) || rewardNum < 0 || rewardNum > L.rewardMax) p.push(`Reward must be ₹0 to ₹${L.rewardMax}`);
    if (!deadlineOk) p.push(`Deadline must be ${L.minMinutes} minutes to ${L.maxDays} days away`);
    return p;
  }, [draft, rewardNum, deadlineOk, L.titleMin, L.descMin, L.rewardMax, L.minMinutes, L.maxDays]);

  const addSkill = () => {
    const s = skillText.trim().replace(/^#/, '').slice(0, L.skillMax);
    if (!s) return;
    if (draft.skills.length >= L.maxSkills) {
      setError(`Up to ${L.maxSkills} skills.`);
      return;
    }
    if (draft.skills.some((x) => x.toLowerCase() === s.toLowerCase())) {
      setSkillText('');
      return;
    }
    patch({ skills: [...draft.skills, s] });
    setSkillText('');
  };

  const shiftDay = (n: number) => patch({ deadline: draft.deadline + n * DAY });
  const shiftTime = (n: number) => patch({ deadline: draft.deadline + n * 30 * MIN });

  const submit = async () => {
    if (busy) return;
    if (problems.length) {
      setError(problems[0] + '.');
      return;
    }
    setBusy(true);
    setError(null);
    setIntegrity(null);
    const input: TaskInput = {
      title: draft.title.trim(),
      description: draft.description.trim(),
      category: draft.category as TaskCategory,
      rewardInr: rewardNum,
      deadlineAt: new Date(draft.deadline).toISOString(),
      skills: draft.skills,
      fulfillment: draft.fulfillment,
      areaHint: draft.fulfillment === 'online' ? null : draft.areaHint.trim() || null,
      mediaIds: draft.images.map((i) => i.id).filter((x): x is string => !!x),
    };
    try {
      if (edit) {
        const changed: Partial<TaskInput> = {};
        (Object.keys(input) as (keyof TaskInput)[]).forEach((k) => {
          const before: any =
            k === 'mediaIds'
              ? (edit.media || []).map((m) => m.mediaId)
              : k === 'deadlineAt'
                ? edit.deadlineAt
                : k === 'areaHint'
                  ? edit.areaHint || null
                  : (edit as any)[k];
          if (JSON.stringify(before) !== JSON.stringify(input[k])) (changed as any)[k] = input[k];
        });
        if (!Object.keys(changed).length) {
          onClose();
          return;
        }
        const r = await updateTask(edit.id, changed);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        onPublished(r.task, { edited: true, underReview: r.underReview });
      } else {
        const r = await createTask(input, draft.clientId);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        newDraft.current = null;
        setDraft(emptyDraft());
        onPublished(r.task, { edited: false, underReview: r.underReview });
      }
    } catch (e: any) {
      nav.onGateError(e);
      if (errorCode(e) === 'ACADEMIC_INTEGRITY') {
        const d = e?.data || {};
        const details: string[] = Array.isArray(d.details) ? d.details.filter((x: any) => typeof x === 'string') : [];
        const actionId: string | null = d.appeal?.actionId || null;
        setIntegrity({
          details: details.length ? details : [e?.message || 'This task breaks the academic-integrity rules.'],
          action: actionId
            ? { id: actionId, action: 'reject', targetType: 'task', targetId: d.taskId || null, reason: details.join(' ') || null, createdAt: new Date().toISOString(), appealable: true, appeal: null }
            : null,
        });
        // A new attempt (after editing) must be a new task, not a replay of the refused one.
        patch({ clientId: newClientId() });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      } else {
        setError(taskErrorMessage(e, "Couldn't post your task. Please try again."));
      }
    } finally {
      setBusy(false);
    }
  };

  const guide = meta?.integrity;

  return (
    <FriendsScreenModal
      visible={visible}
      onClose={onClose}
      title={edit ? 'Edit task' : 'Ask for help'}
      subtitle={edit ? 'Only while nobody is selected' : 'Free to post. No fees or commission.'}
      right={
        <TouchableOpacity
          style={[styles.post, (busy || !!problems.length) && { opacity: 0.5 }]}
          onPress={submit}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={edit ? 'Save changes' : 'Post task'}
          accessibilityState={{ disabled: busy }}
        >
          {busy ? <ActivityIndicator size="small" color={FriendsColors.accentInk} /> : <Text style={styles.postText}>{edit ? 'Save' : 'Post'}</Text>}
        </TouchableOpacity>
      }
    >
      <ScrollView contentContainerStyle={{ padding: FS.lg, paddingBottom: 80 }} keyboardShouldPersistTaps="handled">
        {integrity ? (
          <View style={styles.refusal} accessibilityRole="alert">
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ban size={16} color={FriendsColors.danger} />
              <Text style={[FT.h3, { color: FriendsColors.danger }]}>This task can't be posted</Text>
            </View>
            {integrity.details.map((d, i) => (
              <Text key={i} style={[FT.body, { marginTop: 6 }]}>
                {d}
              </Text>
            ))}
            <Text style={[FT.small, { marginTop: 8 }]}>
              Tutoring, explaining, debugging and feedback on your own work are welcome. Reword the task around learning, or appeal if we got it wrong.
            </Text>
            {integrity.action ? (
              <TouchableOpacity style={[fui.ghostBtn, { marginTop: FS.md, alignSelf: 'flex-start' }]} onPress={() => setAppeal(integrity.action)} accessibilityRole="button" accessibilityLabel="Appeal this decision">
                <Scale size={14} color={FriendsColors.ink} />
                <Text style={fui.ghostBtnText}>Appeal</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}

        <TouchableOpacity style={styles.guideHead} onPress={() => setShowGuide((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: showGuide }} accessibilityLabel="Academic integrity guidance">
          <ShieldCheck size={16} color={FriendsColors.accent} />
          <Text style={[FT.h3, { flex: 1 }]}>Academic integrity</Text>
          <Text style={FT.small}>{showGuide ? 'Hide' : 'Show'}</Text>
        </TouchableOpacity>
        {showGuide ? (
          <View style={styles.guide}>
            <View style={{ flex: 1 }}>
              <Text style={[FT.kicker, { color: FriendsColors.success }]}>Welcome</Text>
              {(guide?.allowed || ['Tutoring and doubt clearing', 'Explaining concepts', 'Debugging and code review', 'Notes and printouts']).map((x) => (
                <View key={x} style={styles.guideRow}>
                  <Check size={13} color={FriendsColors.success} />
                  <Text style={[FT.small, { flex: 1, color: FriendsColors.ink }]}>{x}</Text>
                </View>
              ))}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[FT.kicker, { color: FriendsColors.danger }]}>Not allowed</Text>
              {(guide?.notAllowed || ['Taking an exam or quiz for someone', 'Proxy attendance', 'Doing graded work to submit', 'Fake certificates']).map((x) => (
                <View key={x} style={styles.guideRow}>
                  <X size={13} color={FriendsColors.danger} />
                  <Text style={[FT.small, { flex: 1, color: FriendsColors.ink }]}>{x}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        <Text style={taskUi.label}>Category</Text>
        <View style={styles.wrap} accessibilityRole="radiogroup" accessibilityLabel="Category">
          {TASK_CATEGORIES.map((c) => {
            const m = CATEGORY_META[c];
            const Icon = m.icon;
            const on = draft.category === c;
            return (
              <TouchableOpacity
                key={c}
                style={[fui.pill, on && fui.pillActive]}
                onPress={() => patch({ category: c })}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                accessibilityLabel={m.label}
              >
                <Icon size={14} color={on ? FriendsColors.accentInk : FriendsColors.muted} />
                <Text style={[fui.pillText, on && fui.pillTextActive]}>{m.short}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={taskUi.label}>Title</Text>
        <TextInput
          style={fui.input}
          value={draft.title}
          onChangeText={(t) => patch({ title: t.slice(0, L.titleMax) })}
          placeholder="e.g. Explain Fourier transforms before Friday's class"
          placeholderTextColor={FriendsColors.faint}
          maxLength={L.titleMax}
          accessibilityLabel="Task title"
        />
        <Text style={taskUi.counter}>
          {draft.title.length}/{L.titleMax}
        </Text>

        <Text style={taskUi.label}>What do you need?</Text>
        <TextInput
          style={[fui.input, { minHeight: 130, textAlignVertical: 'top' }]}
          value={draft.description}
          onChangeText={(t) => patch({ description: t.slice(0, L.descMax) })}
          placeholder="Describe the help you need, what's done already and what 'done' looks like. No phone numbers, room numbers or payment details."
          placeholderTextColor={FriendsColors.faint}
          multiline
          maxLength={L.descMax}
          accessibilityLabel="Task description"
        />
        <Text style={taskUi.counter}>
          {len(draft.description) < L.descMin ? `At least ${L.descMin} · ` : ''}
          {draft.description.length}/{L.descMax}
        </Text>

        <Text style={taskUi.label}>Reward (₹)</Text>
        <View style={styles.rewardRow}>
          <Text style={styles.rupee}>₹</Text>
          <TextInput
            style={[fui.input, { flex: 1 }]}
            value={draft.reward}
            onChangeText={(t) => patch({ reward: t.replace(/[^\d]/g, '').replace(/^0+(?=\d)/, '').slice(0, 5) })}
            placeholder="0 for a favour"
            placeholderTextColor={FriendsColors.faint}
            keyboardType="number-pad"
            accessibilityLabel={`Reward in rupees, 0 to ${L.rewardMax}`}
          />
        </View>
        <Text style={[FT.small, { marginTop: 4 }]}>Paid directly between you and your helper, after you're happy with the work.</Text>

        <Text style={taskUi.label}>Deadline</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: FS.sm }}>
          {presets().map((p) => {
            const on = Math.abs(p.at - draft.deadline) < MIN;
            return (
              <TouchableOpacity key={p.key} style={[fui.pill, on && fui.pillActive]} onPress={() => patch({ deadline: p.at })} accessibilityRole="button" accessibilityState={{ selected: on }}>
                <Text style={[fui.pillText, on && fui.pillTextActive]}>{p.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        <View style={[styles.deadline, !deadlineOk && { borderColor: FriendsColors.danger }]}>
          <CalendarClock size={18} color={deadlineOk ? FriendsColors.accent : FriendsColors.danger} />
          <Text style={[FT.h3, { flex: 1 }]} accessibilityLiveRegion="polite">
            {formatDeadline(new Date(draft.deadline).toISOString())}
          </Text>
        </View>
        <View style={styles.stepRow}>
          <Stepper label="Day" onMinus={() => shiftDay(-1)} onPlus={() => shiftDay(1)} />
          <Stepper label="Time" sub="30 min" onMinus={() => shiftTime(-1)} onPlus={() => shiftTime(1)} />
        </View>
        {!deadlineOk ? <Text style={[FT.small, { color: FriendsColors.danger, marginTop: 4 }]}>Pick a time between {L.minMinutes} minutes and {L.maxDays} days from now.</Text> : null}

        <Text style={taskUi.label}>How</Text>
        <View style={styles.wrap} accessibilityRole="radiogroup" accessibilityLabel="How the task is done">
          {TASK_FULFILLMENT.map((f) => {
            const on = draft.fulfillment === f;
            return (
              <TouchableOpacity key={f} style={[fui.pill, on && fui.pillActive]} onPress={() => patch({ fulfillment: f })} accessibilityRole="radio" accessibilityState={{ checked: on }}>
                <Text style={[fui.pillText, on && fui.pillTextActive]}>{FULFILLMENT_LABEL[f]}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {draft.fulfillment !== 'online' ? (
          <>
            <TextInput
              style={[fui.input, { marginTop: FS.sm }]}
              value={draft.areaHint}
              onChangeText={(t) => patch({ areaHint: t.slice(0, L.areaMax) })}
              placeholder="Rough area, e.g. Library, Block C, Main gate"
              placeholderTextColor={FriendsColors.faint}
              maxLength={L.areaMax}
              accessibilityLabel="Rough area on campus (optional)"
            />
            <Text style={[FT.small, { marginTop: 4 }]}>Never an exact room. Share details privately in the task chat.</Text>
          </>
        ) : null}

        <Text style={taskUi.label}>Skills (optional)</Text>
        {draft.skills.length ? (
          <View style={[styles.wrap, { marginBottom: FS.sm }]}>
            {draft.skills.map((s) => (
              <TouchableOpacity
                key={s}
                style={styles.skill}
                onPress={() => patch({ skills: draft.skills.filter((x) => x !== s) })}
                accessibilityRole="button"
                accessibilityLabel={`Remove skill ${s}`}
              >
                <Text style={styles.skillText}>{s}</Text>
                <X size={12} color={FriendsColors.accent} />
              </TouchableOpacity>
            ))}
          </View>
        ) : null}
        {draft.skills.length < L.maxSkills ? (
          <View style={{ flexDirection: 'row', gap: FS.sm }}>
            <TextInput
              style={[fui.input, { flex: 1 }]}
              value={skillText}
              onChangeText={(t) => setSkillText(t.slice(0, L.skillMax))}
              onSubmitEditing={addSkill}
              placeholder="e.g. Python, Canva, Thermodynamics"
              placeholderTextColor={FriendsColors.faint}
              returnKeyType="done"
              blurOnSubmit={false}
              accessibilityLabel="Add a skill"
            />
            <TouchableOpacity style={styles.addSkill} onPress={addSkill} accessibilityRole="button" accessibilityLabel="Add skill">
              <Plus size={18} color={FriendsColors.ink} />
            </TouchableOpacity>
          </View>
        ) : null}

        <Text style={taskUi.label}>Photos (optional)</Text>
        <ImagePickerRow value={draft.images} onChange={(images) => patch({ images })} purpose="task" max={L.maxMedia} />

        <View style={{ marginTop: FS.xl }}>
          <PaymentNoticeCard text={meta?.paymentNotice} />
        </View>

        {edit?.modStatus === 'pending_review' ? (
          <View style={[styles.refusal, { borderColor: 'rgba(242,178,126,0.3)', backgroundColor: 'rgba(242,178,126,0.06)', marginTop: FS.lg }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Hourglass size={14} color={FriendsColors.warn} />
              <Text style={[FT.small, { color: FriendsColors.warn, flex: 1 }]}>This task is waiting for a moderator. Edits are checked again.</Text>
            </View>
          </View>
        ) : null}

        <ErrorBox message={error} />

        <TouchableOpacity style={[fui.primaryBtn, { marginTop: FS.lg }, busy && { opacity: 0.5 }]} onPress={submit} disabled={busy} accessibilityRole="button">
          {busy ? <ActivityIndicator color={FriendsColors.accentInk} /> : <Text style={fui.primaryBtnText}>{edit ? 'Save changes' : 'Post task'}</Text>}
        </TouchableOpacity>
        {!edit ? (
          <Text style={[FT.small, { textAlign: 'center', marginTop: FS.sm }]}>Visible to verified students on your campus until the deadline.</Text>
        ) : null}
      </ScrollView>

      <AppealSheet
        visible={!!appeal}
        onClose={() => setAppeal(null)}
        action={appeal}
        onAppealed={() =>
          Alert.alert('Appeal sent', 'A moderator will look at it. You can follow it in Me › Friends privacy & safety, and the task stays in My Tasks › Posted.')
        }
      />
    </FriendsScreenModal>
  );
};

const Stepper: React.FC<{ label: string; sub?: string; onMinus: () => void; onPlus: () => void }> = ({ label, sub, onMinus, onPlus }) => (
  <View style={styles.stepper}>
    <TouchableOpacity style={styles.stepBtn} onPress={onMinus} accessibilityRole="button" accessibilityLabel={`${label} earlier${sub ? ` by ${sub}` : ''}`}>
      <Minus size={16} color={FriendsColors.ink} />
    </TouchableOpacity>
    <View style={{ alignItems: 'center', flex: 1 }}>
      <Text style={FT.h3}>{label}</Text>
      {sub ? <Text style={FT.small}>{sub}</Text> : null}
    </View>
    <TouchableOpacity style={styles.stepBtn} onPress={onPlus} accessibilityRole="button" accessibilityLabel={`${label} later${sub ? ` by ${sub}` : ''}`}>
      <Plus size={16} color={FriendsColors.ink} />
    </TouchableOpacity>
  </View>
);

const styles = themedSheet(() => ({
  post: { minWidth: 72, minHeight: 40, paddingHorizontal: 16, borderRadius: FR.pill, backgroundColor: FriendsColors.accent, alignItems: 'center', justifyContent: 'center', marginRight: FS.sm },
  postText: { fontSize: 14, fontWeight: '800', color: FriendsColors.accentInk },
  refusal: { padding: FS.lg, borderRadius: FR.card, borderWidth: 1, borderColor: 'rgba(243,139,128,0.35)', backgroundColor: 'rgba(243,139,128,0.06)', marginBottom: FS.lg },
  guideHead: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  guide: { flexDirection: 'row', gap: FS.md, padding: FS.md, borderRadius: FR.card, backgroundColor: FriendsColors.card, borderWidth: 1, borderColor: FriendsColors.line },
  guideRow: { flexDirection: 'row', gap: 6, marginTop: 6, alignItems: 'flex-start' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: FS.sm },
  rewardRow: { flexDirection: 'row', alignItems: 'center', gap: FS.sm },
  rupee: { fontSize: 22, fontWeight: '800', color: FriendsColors.gold, width: 20, textAlign: 'center' },
  deadline: { flexDirection: 'row', alignItems: 'center', gap: FS.sm, marginTop: FS.sm, padding: FS.md, borderRadius: FR.md, borderWidth: 1, borderColor: FriendsColors.line, backgroundColor: FriendsColors.card },
  stepRow: { flexDirection: 'row', gap: FS.sm, marginTop: FS.sm },
  stepper: { flex: 1, flexDirection: 'row', alignItems: 'center', padding: 4, borderRadius: FR.md, backgroundColor: FriendsColors.cardHi, borderWidth: 1, borderColor: FriendsColors.line },
  stepBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: FriendsColors.card },
  skill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, minHeight: 32, borderRadius: FR.pill, backgroundColor: FriendsColors.accentSoft },
  skillText: { fontSize: 12, fontWeight: '700', color: FriendsColors.accent },
  addSkill: { width: 46, borderRadius: FR.md, backgroundColor: FriendsColors.cardHi, borderWidth: 1, borderColor: FriendsColors.line, alignItems: 'center', justifyContent: 'center' },
}));
