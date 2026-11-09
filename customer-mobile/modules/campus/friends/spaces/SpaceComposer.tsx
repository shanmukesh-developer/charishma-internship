import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet, Alert } from 'react-native';
import { Radio, CalendarClock, Check, Info, Wifi } from '../../../../components/lucide';
import * as Haptics from 'expo-haptics';
import { FriendsColors, FS, FR, FT, fui } from '../friendsTheme';
import { FriendsScreenModal } from '../shared/FriendsSheet';
import { FriendsAvatar } from '../shared/FriendsAvatar';
import { errorCode, newClientId } from '../api/core';
import { fetchManagedEntities, PulseEntityOption } from '../api/pulseApi';
import { Space, SpaceParticipation, SpacePatch, SPACES_DEFAULT_META, createSpace, spaceErrorMessage, updateSpace } from '../api/spacesApi';
import { NotRecorded, Stepper } from './SpacesUi';
import { formatCountdown, formatSpaceTime, localZoneLabel, useSpacesNav } from './spacesShared';

import { themedSheet } from '../../../../utils/themeNow';
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

interface Draft {
  title: string;
  topic: string;
  description: string;
  participation: SpaceParticipation;
  mode: 'now' | 'later';
  at: number;
  entityId: string | null;
  clientId: string;
}

const roundUp = (t: number, step = 15 * MIN) => Math.ceil(t / step) * step;
const defaultAt = () => roundUp(Date.now() + HOUR);

const emptyDraft = (): Draft => ({
  title: '',
  topic: '',
  description: '',
  participation: 'request',
  mode: 'now',
  at: defaultAt(),
  entityId: null,
  clientId: newClientId(),
});

const fromSpace = (s: Space): Draft => ({
  title: s.title,
  topic: s.topic || '',
  description: s.description || '',
  participation: s.participation,
  mode: 'later',
  at: s.scheduledFor ? new Date(s.scheduledFor).getTime() : defaultAt(),
  entityId: null,
  clientId: newClientId(),
});

const presets = (): { key: string; label: string; at: number }[] => {
  const now = Date.now();
  const out: { key: string; label: string; at: number }[] = [
    { key: '30m', label: 'In 30 min', at: roundUp(now + 30 * MIN, 5 * MIN) },
    { key: '1h', label: 'In 1 hour', at: roundUp(now + HOUR) },
  ];
  const tonight = new Date();
  tonight.setHours(21, 0, 0, 0);
  if (tonight.getTime() - now > 90 * MIN) out.push({ key: 'tonight', label: 'Tonight 9 PM', at: tonight.getTime() });
  const tmr = new Date(now + DAY);
  tmr.setHours(19, 0, 0, 0);
  out.push({ key: 'tmr', label: 'Tomorrow 7 PM', at: tmr.getTime() });
  const sat = new Date(now);
  sat.setDate(sat.getDate() + ((6 - sat.getDay() + 7) % 7 || 7));
  sat.setHours(18, 0, 0, 0);
  out.push({ key: 'sat', label: 'Saturday 6 PM', at: sat.getTime() });
  return out;
};

const len = (s: string) => Array.from(s.trim()).length;

/**
 * Start a Space now or schedule one (times shown and picked in the device's local time, sent to
 * the server in UTC with a timezone). Also edits / reschedules a scheduled Space I host.
 * A retry never creates a second Space (clientId); the draft survives closing the composer.
 */
export const SpaceComposer: React.FC<{
  visible: boolean;
  edit: Space | null;
  onClose: () => void;
  onDone: (space: Space, info: { edited: boolean; underReview: boolean; rescheduled: boolean }) => void;
}> = ({ visible, edit, onClose, onDone }) => {
  const nav = useSpacesNav();
  const meta = nav.meta || SPACES_DEFAULT_META;
  const L = meta.text;
  const S = meta.schedule;
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entities, setEntities] = useState<PulseEntityOption[]>([]);
  const [now, setNow] = useState(Date.now());
  const saved = useRef<Draft | null>(null);
  const editId = edit?.id || null;

  useEffect(() => {
    if (!visible) return;
    setError(null);
    setNow(Date.now());
    setDraft(edit ? fromSpace(edit) : saved.current || emptyDraft());
    if (!edit) {
      fetchManagedEntities()
        .then((list) => setEntities(list.filter((e) => e.verified !== false)))
        .catch(() => setEntities([]));
    }
  }, [visible, editId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep "in 12 min" and the validity check current while the composer is open.
  useEffect(() => {
    if (!visible) return;
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, [visible]);

  const patch = (p: Partial<Draft>) => {
    setDraft((d) => {
      const next = { ...d, ...p };
      if (!editId) saved.current = next;
      return next;
    });
    setError(null);
  };

  const timeOk = draft.mode === 'now' || (draft.at - now >= S.minMinutes * MIN && draft.at - now <= S.maxDays * DAY);
  const problems = useMemo(() => {
    const p: string[] = [];
    if (len(draft.title) < L.titleMin) p.push(`Title needs at least ${L.titleMin} characters`);
    if (!timeOk) p.push(`Start time must be ${S.minMinutes} minutes to ${S.maxDays} days away`);
    return p;
  }, [draft.title, timeOk, L.titleMin, S.minMinutes, S.maxDays]);

  const submit = async () => {
    if (busy) return;
    if (problems.length) {
      setError(problems[0]);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (edit) {
        const body: SpacePatch = {};
        if (draft.title.trim() !== edit.title) body.title = draft.title.trim();
        if ((draft.topic.trim() || null) !== (edit.topic || null)) body.topic = draft.topic.trim() || null;
        if ((draft.description.trim() || null) !== (edit.description || null)) body.description = draft.description.trim() || null;
        if (draft.participation !== edit.participation) body.participation = draft.participation;
        const was = edit.scheduledFor ? new Date(edit.scheduledFor).getTime() : 0;
        if (Math.abs(draft.at - was) >= MIN) body.scheduledFor = new Date(draft.at).toISOString();
        if (!Object.keys(body).length) {
          onClose();
          return;
        }
        const r = await updateSpace(edit.id, body);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        onDone(r.space, { edited: true, underReview: !!r.space.underReview, rescheduled: !!r.rescheduled });
      } else {
        const r = await createSpace({
          title: draft.title.trim(),
          topic: draft.topic.trim() || null,
          description: draft.description.trim() || null,
          participation: draft.participation,
          ...(draft.mode === 'now' ? { startNow: true } : { scheduledFor: new Date(draft.at).toISOString() }),
          entityId: draft.entityId,
          clientId: draft.clientId,
        });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        saved.current = null;
        onDone(r.space, { edited: false, underReview: !!(r.underReview || r.space.underReview), rescheduled: false });
      }
    } catch (e: any) {
      nav.onGateError(e);
      const code = errorCode(e);
      if (code === 'ALREADY_HOSTING') {
        const id = e?.data?.spaceId;
        Alert.alert('You are already live', 'You can host one live Space at a time. End it before starting another.', [
          { text: 'OK', style: 'cancel' },
          ...(id
            ? [
                {
                  text: 'Open it',
                  onPress: () => {
                    onClose();
                    nav.push({ name: 'space', id });
                  },
                },
              ]
            : []),
        ]);
      } else {
        if (code === 'CONTENT_BLOCKED') patch({ clientId: newClientId() });
        setError(spaceErrorMessage(e, "Couldn't save your Space. Please try again."));
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  const shiftDay = (n: number) => patch({ at: draft.at + n * DAY });
  const shiftTime = (n: number) => patch({ at: draft.at + n * 15 * MIN });
  const primaryLabel = edit ? 'Save' : draft.mode === 'now' ? 'Go live' : 'Schedule';

  return (
    <FriendsScreenModal
      visible={visible}
      onClose={onClose}
      title={edit ? 'Edit Space' : 'New Space'}
      subtitle={edit ? 'Changes notify everyone with a reminder' : 'Live audio for your campus'}
      right={
        <TouchableOpacity
          style={[styles.post, (busy || !!problems.length) && { opacity: 0.5 }]}
          onPress={submit}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={primaryLabel}
          accessibilityState={{ disabled: busy || !!problems.length, busy }}
        >
          {busy ? <ActivityIndicator size="small" color={FriendsColors.accentInk} /> : <Text style={styles.postText}>{primaryLabel}</Text>}
        </TouchableOpacity>
      }
    >
      <ScrollView contentContainerStyle={{ padding: FS.lg, paddingBottom: 80 }} keyboardShouldPersistTaps="handled">
        {error ? (
          <View style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">
            <Info size={16} color={FriendsColors.danger} />
            <Text style={[FT.body, { flex: 1, color: FriendsColors.danger }]}>{error}</Text>
          </View>
        ) : null}

        {!edit ? (
          <View style={styles.modeRow} accessibilityRole="radiogroup" accessibilityLabel="When">
            {(['now', 'later'] as const).map((m) => {
              const on = draft.mode === m;
              return (
                <TouchableOpacity
                  key={m}
                  style={[styles.mode, on && styles.modeOn]}
                  onPress={() => patch({ mode: m })}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={m === 'now' ? 'Start now' : 'Schedule for later'}
                >
                  {m === 'now' ? <Radio size={18} color={on ? FriendsColors.danger : FriendsColors.muted} /> : <CalendarClock size={18} color={on ? FriendsColors.accent : FriendsColors.muted} />}
                  <View style={{ flex: 1 }}>
                    <Text style={[FT.h3, !on && { color: FriendsColors.muted }]}>{m === 'now' ? 'Start now' : 'Schedule'}</Text>
                    <Text style={FT.small} numberOfLines={1}>
                      {m === 'now' ? 'Go live right away' : 'People can set a reminder'}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        ) : null}

        <Text style={styles.label}>Title</Text>
        <TextInput
          style={fui.input}
          value={draft.title}
          onChangeText={(t) => patch({ title: t.slice(0, L.titleMax) })}
          placeholder="e.g. Placement prep: ask a senior anything"
          placeholderTextColor={FriendsColors.faint}
          maxLength={L.titleMax}
          accessibilityLabel={`Title, ${L.titleMin} to ${L.titleMax} characters`}
        />
        <Text style={styles.count}>
          {len(draft.title)}/{L.titleMax}
        </Text>

        <Text style={styles.label}>Topic (optional)</Text>
        <TextInput
          style={fui.input}
          value={draft.topic}
          onChangeText={(t) => patch({ topic: t.slice(0, L.topicMax) })}
          placeholder="e.g. Placements, Fests, Exams"
          placeholderTextColor={FriendsColors.faint}
          maxLength={L.topicMax}
          accessibilityLabel={`Topic, up to ${L.topicMax} characters`}
        />

        <Text style={styles.label}>Description (optional)</Text>
        <TextInput
          style={[fui.input, { minHeight: 90, textAlignVertical: 'top' }]}
          value={draft.description}
          onChangeText={(t) => patch({ description: t.slice(0, L.descriptionMax) })}
          placeholder="What will you talk about? Who should join?"
          placeholderTextColor={FriendsColors.faint}
          maxLength={L.descriptionMax}
          multiline
          accessibilityLabel={`Description, up to ${L.descriptionMax} characters`}
        />
        <Text style={styles.count}>
          {len(draft.description)}/{L.descriptionMax}
        </Text>

        {draft.mode === 'later' ? (
          <>
            <Text style={styles.label}>Starts</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: FS.sm }}>
              {presets().map((p) => {
                const on = Math.abs(p.at - draft.at) < MIN;
                return (
                  <TouchableOpacity key={p.key} style={[fui.pill, on && fui.pillActive]} onPress={() => patch({ at: p.at })} accessibilityRole="button" accessibilityState={{ selected: on }}>
                    <Text style={[fui.pillText, on && fui.pillTextActive]}>{p.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <View style={[styles.when, !timeOk && { borderColor: FriendsColors.danger }]}>
              <CalendarClock size={18} color={timeOk ? FriendsColors.accent : FriendsColors.danger} />
              <View style={{ flex: 1 }}>
                <Text style={FT.h3} accessibilityLiveRegion="polite">
                  {formatSpaceTime(new Date(draft.at).toISOString(), now)}
                </Text>
                <Text style={FT.small}>
                  {formatCountdown(new Date(draft.at).toISOString(), now)} · your time ({localZoneLabel()})
                </Text>
              </View>
            </View>
            <View style={styles.stepRow}>
              <Stepper label="Day" onMinus={() => shiftDay(-1)} onPlus={() => shiftDay(1)} />
              <Stepper label="Time" sub="15 min" onMinus={() => shiftTime(-1)} onPlus={() => shiftTime(1)} />
            </View>
            {!timeOk ? (
              <Text style={[FT.small, { color: FriendsColors.danger, marginTop: 4 }]}>
                Pick a time between {S.minMinutes} minutes and {S.maxDays} days from now.
              </Text>
            ) : (
              <Text style={[FT.small, { marginTop: 4 }]}>
                People with a reminder get a notification {S.reminderLeadMinutes} minutes before. If you don't start within {S.expireAfterMinutes} minutes of this time, the Space expires.
              </Text>
            )}
          </>
        ) : null}

        <Text style={styles.label}>Who can speak</Text>
        <View style={{ gap: FS.sm }} accessibilityRole="radiogroup" accessibilityLabel="Who can speak">
          {meta.participation.map((p) => {
            const on = draft.participation === p.key;
            return (
              <TouchableOpacity
                key={p.key}
                style={[styles.option, on && styles.optionOn]}
                onPress={() => patch({ participation: p.key })}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                accessibilityLabel={`${p.label}. ${p.hint}`}
              >
                <View style={[styles.radio, on && styles.radioOn]}>{on ? <Check size={12} color={FriendsColors.accentInk} /> : null}</View>
                <View style={{ flex: 1 }}>
                  <Text style={FT.h3}>{p.label}</Text>
                  <Text style={FT.small}>{p.hint}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={[FT.small, { marginTop: 6 }]}>
          Up to {meta.caps.maxSpeakers} people on stage (you included) and {meta.caps.maxListeners} listeners. Nobody is put on stage without saying yes.
        </Text>

        {!edit && entities.length ? (
          <>
            <Text style={styles.label}>Host as</Text>
            <View style={styles.wrap} accessibilityRole="radiogroup" accessibilityLabel="Host as">
              <TouchableOpacity style={[fui.pill, !draft.entityId && fui.pillActive]} onPress={() => patch({ entityId: null })} accessibilityRole="radio" accessibilityState={{ checked: !draft.entityId }}>
                <Text style={[fui.pillText, !draft.entityId && fui.pillTextActive]}>Me</Text>
              </TouchableOpacity>
              {entities.map((e) => {
                const on = draft.entityId === e.id;
                return (
                  <TouchableOpacity
                    key={e.id}
                    style={[fui.pill, on && fui.pillActive]}
                    onPress={() => patch({ entityId: e.id })}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={`Host as ${e.name}`}
                  >
                    <FriendsAvatar name={e.name} uri={e.avatarUrl} size={20} />
                    <Text style={[fui.pillText, on && fui.pillTextActive]}>{e.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={[FT.small, { marginTop: 4 }]}>Only verified clubs and accounts you manage are listed.</Text>
          </>
        ) : null}

        <View style={styles.notes}>
          <NotRecorded text={meta.notRecorded || 'Spaces are live only. They are never recorded or transcribed.'} />
          {meta.network?.note ? (
            <View style={styles.netNote}>
              <Wifi size={14} color={FriendsColors.muted} />
              <Text style={[FT.small, { flex: 1 }]}>{meta.network.note}</Text>
            </View>
          ) : null}
          <Text style={FT.small}>Your Space shows to verified students on your campus. Keep it kind: the community guidelines apply on stage too.</Text>
        </View>

        <TouchableOpacity
          style={[fui.primaryBtn, { marginTop: FS.xl }, (busy || !!problems.length) && { opacity: 0.5 }]}
          onPress={submit}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={primaryLabel}
        >
          {busy ? <ActivityIndicator color={FriendsColors.accentInk} /> : draft.mode === 'now' && !edit ? <Radio size={18} color={FriendsColors.accentInk} /> : null}
          <Text style={fui.primaryBtnText}>{edit ? 'Save changes' : draft.mode === 'now' ? 'Go live now' : 'Schedule Space'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </FriendsScreenModal>
  );
};

const styles = themedSheet(() => ({
  post: { minHeight: 36, paddingHorizontal: 16, borderRadius: FR.pill, backgroundColor: FriendsColors.accent, alignItems: 'center', justifyContent: 'center', marginRight: FS.sm },
  postText: { fontSize: 14, fontWeight: '800', color: FriendsColors.accentInk },
  error: { flexDirection: 'row', gap: 8, padding: FS.md, borderRadius: FR.md, backgroundColor: FriendsColors.dangerSoft, marginBottom: FS.md },
  modeRow: { flexDirection: 'row', gap: FS.sm },
  mode: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: FS.sm,
    padding: FS.md,
    minHeight: 64,
    borderRadius: FR.card,
    backgroundColor: FriendsColors.card,
    borderWidth: 1,
    borderColor: FriendsColors.line,
  },
  modeOn: { borderColor: FriendsColors.accent, backgroundColor: FriendsColors.cardHi },
  label: { fontSize: 13, fontWeight: '800', color: FriendsColors.ink, marginTop: FS.lg, marginBottom: FS.sm },
  count: { fontSize: 12, color: FriendsColors.faint, textAlign: 'right', marginTop: 4 },
  when: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: FS.md,
    marginTop: FS.md,
    padding: FS.md,
    borderRadius: FR.card,
    backgroundColor: FriendsColors.card,
    borderWidth: 1,
    borderColor: FriendsColors.line,
  },
  stepRow: { flexDirection: 'row', gap: FS.sm, marginTop: FS.sm },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: FS.md,
    padding: FS.md,
    minHeight: 56,
    borderRadius: FR.card,
    backgroundColor: FriendsColors.card,
    borderWidth: 1,
    borderColor: FriendsColors.line,
  },
  optionOn: { borderColor: FriendsColors.accent },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: FriendsColors.line, alignItems: 'center', justifyContent: 'center' },
  radioOn: { backgroundColor: FriendsColors.accent, borderColor: FriendsColors.accent },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: FS.sm },
  notes: { marginTop: FS.xl, gap: FS.sm, padding: FS.md, borderRadius: FR.card, backgroundColor: FriendsColors.card, borderWidth: 1, borderColor: FriendsColors.lineSoft },
  netNote: { flexDirection: 'row', gap: 6, alignItems: 'flex-start' },
}));
