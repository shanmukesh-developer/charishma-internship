import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, Switch, TouchableOpacity, RefreshControl, StyleSheet, Alert } from 'react-native';
import { ChevronRight, Ban, BookOpen, ShieldAlert, Flag, VolumeX, Scale } from '../../../../components/lucide';
import { FriendsScreenModal, FriendsSheet } from './FriendsSheet';
import { FriendsColors, FS, FT, FR, fui } from '../friendsTheme';
import {
  FriendsEligibility,
  FriendsSettings,
  FriendsSettingsPatch,
  FriendsNotifPrefs,
  FriendsMuteItem,
  fetchFriendsEligibility,
  fetchFriendsSettings,
  updateFriendsSettings,
  fetchMutes,
  unmuteTarget,
} from '../api/core';
import {
  fetchMyModeration,
  fetchMyReports,
  MyModeration,
  MyModerationAction,
  MyReport,
  moderationActionLabel,
  sanctionScopeLabel,
  REPORT_CATEGORIES,
} from '../api/modApi';
import { GuidelinesGate, EligibilityGate } from './gates';
import { AppealSheet } from './AppealSheet';
import { FriendsSkeleton } from './FriendsSkeleton';
import { RelativeTime, formatLocal } from './RelativeTime';
import { identityLabel } from './IdentityChip';

import { themedSheet } from '../../../../utils/themeNow';
const NOTIF_ROWS: { key: keyof FriendsNotifPrefs; label: string; hint: string }[] = [
  { key: 'replies', label: 'Replies', hint: 'Replies to your posts and comments' },
  { key: 'mentions', label: 'Mentions', hint: 'When someone mentions you' },
  { key: 'follows', label: 'New followers', hint: 'When someone follows you' },
  { key: 'forum', label: 'Forum', hint: 'Answers and best-answer picks' },
  { key: 'spaces', label: 'Spaces', hint: 'Reminders for Spaces you saved' },
  { key: 'tasks', label: 'Tasks', hint: 'Applications, selections and reviews' },
  { key: 'connect', label: 'Connect', hint: 'New matches' },
  { key: 'moderation', label: 'Safety updates', hint: 'Outcomes of your reports and appeals' },
  { key: 'lockScreenPreviews', label: 'Show previews on lock screen', hint: 'Off: notifications say only "New activity in Friends"' },
];

const REPORT_STATUS: Record<MyReport['status'], string> = {
  received: 'Received',
  in_review: 'In review',
  closed: 'Closed',
};

const categoryLabel = (c: string) => REPORT_CATEGORIES.find((x) => x.key === c)?.label || 'Report';

/**
 * Me › Friends privacy & safety: who sees what, notifications, muted and blocked people,
 * my reports, decisions about me (with appeal) and the guidelines.
 */
export const FriendsSafetyScreen: React.FC<{
  visible: boolean;
  onClose: () => void;
  /** Opens the existing Friends & requests screen (Blocked tab lives there). */
  onOpenBlocked: () => void;
  onOpenVerify?: () => void;
}> = ({ visible, onClose, onOpenBlocked, onOpenVerify }) => {
  const [elig, setElig] = useState<FriendsEligibility | null>(null);
  const [settings, setSettings] = useState<FriendsSettings | null>(null);
  const [mutes, setMutes] = useState<FriendsMuteItem[]>([]);
  const [moderation, setModeration] = useState<MyModeration | null>(null);
  const [reports, setReports] = useState<MyReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [appealFor, setAppealFor] = useState<MyModerationAction | null>(null);
  const [guidelinesOpen, setGuidelinesOpen] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setLoadError(null);
    const [e, mod, rep] = await Promise.allSettled([fetchFriendsEligibility(), fetchMyModeration(), fetchMyReports()]);
    if (!mounted.current) return;
    const eligibility = e.status === 'fulfilled' ? e.value : null;
    setElig(eligibility);
    if (mod.status === 'fulfilled') setModeration(mod.value);
    if (rep.status === 'fulfilled') setReports(rep.value.items || []);
    if (e.status === 'rejected' && mod.status === 'rejected') {
      setLoadError((e.reason as any)?.message || "Couldn't load your Friends settings.");
    }
    // Privacy, notifications and mutes are for verified members only.
    if (eligibility?.eligible) {
      const [s, m] = await Promise.allSettled([fetchFriendsSettings(), fetchMutes()]);
      if (!mounted.current) return;
      if (s.status === 'fulfilled') setSettings(s.value);
      if (m.status === 'fulfilled') setMutes(m.value);
    } else {
      setSettings(null);
      setMutes([]);
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    load().finally(() => mounted.current && setLoading(false));
  }, [visible, load]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    if (mounted.current) setRefreshing(false);
  };

  const save = async (patch: FriendsSettingsPatch) => {
    if (!settings) return;
    const prev = settings;
    setSettings({ ...settings, ...patch, notifPrefs: { ...settings.notifPrefs, ...(patch.notifPrefs || {}) } } as FriendsSettings);
    try {
      const next = await updateFriendsSettings(patch);
      if (mounted.current) setSettings(next);
    } catch (e: any) {
      if (mounted.current) setSettings(prev);
      Alert.alert("Couldn't save", e?.message || 'Please try again.');
    }
  };

  const unmute = async (m: FriendsMuteItem) => {
    try {
      await unmuteTarget(m.targetType, m.targetId);
      if (mounted.current) setMutes((list) => list.filter((x) => !(x.targetType === m.targetType && x.targetId === m.targetId)));
    } catch (e: any) {
      Alert.alert("Couldn't unmute", e?.message || 'Please try again.');
    }
  };

  const sanctions = moderation?.sanctions || [];
  const actions = moderation?.actions || [];

  return (
    <FriendsScreenModal visible={visible} onClose={onClose} title="Friends privacy & safety" subtitle="Only you can see this page">
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: FS.lg, paddingBottom: FS.xxxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={FriendsColors.muted} />}
      >
        {loading ? (
          <FriendsSkeleton rows={3} variant="row" />
        ) : (
          <>
            {loadError ? (
              <TouchableOpacity style={styles.notice} onPress={refresh} accessibilityRole="button">
                <Text style={[FT.small, { color: FriendsColors.warn, flex: 1 }]}>{loadError}</Text>
                <Text style={[FT.small, { color: FriendsColors.warn, fontWeight: '800' }]}>Retry</Text>
              </TouchableOpacity>
            ) : null}

            {/* Restrictions */}
            {sanctions.length > 0 ? (
              <>
                <Text style={styles.section}>Restrictions</Text>
                <View style={fui.card}>
                  {sanctions.map((s, i) => (
                    <View key={s.id} style={[fui.row, i === sanctions.length - 1 && { borderBottomWidth: 0 }]}>
                      <ShieldAlert size={18} color={FriendsColors.danger} />
                      <View style={{ flex: 1 }}>
                        <Text style={FT.h3}>Restricted from {sanctionScopeLabel(s.scope)}</Text>
                        <Text style={FT.small}>{s.until ? `Until ${formatLocal(s.until)}` : 'No end date'}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              </>
            ) : null}

            {/* Decisions about me */}
            {actions.length > 0 ? (
              <>
                <Text style={styles.section}>Decisions about you</Text>
                <View style={fui.card}>
                  {actions.map((a, i) => (
                    <View key={a.id} style={[fui.row, i === actions.length - 1 && { borderBottomWidth: 0 }]}>
                      <Scale size={18} color={FriendsColors.muted} />
                      <View style={{ flex: 1 }}>
                        <Text style={FT.h3}>{moderationActionLabel(a.action)}</Text>
                        {a.reason ? (
                          <Text style={FT.small} numberOfLines={2}>
                            {a.reason}
                          </Text>
                        ) : null}
                        <RelativeTime value={a.createdAt} />
                      </View>
                      {a.appealable ? (
                        <TouchableOpacity style={fui.ghostBtn} onPress={() => setAppealFor(a)} accessibilityRole="button" accessibilityLabel="Appeal this decision">
                          <Text style={fui.ghostBtnText}>Appeal</Text>
                        </TouchableOpacity>
                      ) : a.appeal ? (
                        <Text style={FT.small}>Appeal: {a.appeal.status}</Text>
                      ) : null}
                    </View>
                  ))}
                </View>
              </>
            ) : null}

            {/* Not a member yet: explain, keep safety tools below */}
            {elig && !elig.eligible ? (
              <View style={[fui.card, { marginTop: FS.lg }]}>
                <EligibilityGate eligibility={elig} compact onVerify={onOpenVerify ? () => { onClose(); onOpenVerify(); } : undefined} />
              </View>
            ) : null}

            {/* Privacy */}
            {settings ? (
              <>
                <Text style={styles.section}>Who can see your profile</Text>
                <View style={fui.cardPad}>
                  <View style={{ flexDirection: 'row', gap: FS.sm }} accessibilityRole="radiogroup">
                    {(
                      [
                        { key: 'campus', label: 'Everyone on campus' },
                        { key: 'followers', label: 'Only followers' },
                      ] as const
                    ).map((o) => {
                      const active = settings.profileVisibility === o.key;
                      return (
                        <TouchableOpacity
                          key={o.key}
                          style={[fui.pill, { flex: 1, minHeight: 44 }, active && fui.pillActive]}
                          onPress={() => !active && save({ profileVisibility: o.key })}
                          accessibilityRole="radio"
                          accessibilityState={{ checked: active }}
                        >
                          <Text style={[fui.pillText, active && fui.pillTextActive]}>{o.label}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  <Text style={[FT.small, { marginTop: FS.sm }]}>
                    Only verified students of your campus can ever see you in Friends. "Only followers" hides your year and branch from everyone else.
                  </Text>
                </View>
                <View style={[fui.card, { marginTop: FS.md }]}>
                  <ToggleRow label="Show my year" value={settings.showYear} onChange={(v) => save({ showYear: v })} />
                  <ToggleRow label="Show my branch" value={settings.showBranch} onChange={(v) => save({ showBranch: v })} />
                  <ToggleRow
                    last
                    label="Post anonymously by default"
                    hint="You can still switch per post. ZenWe keeps the real author for safety."
                    value={settings.defaultAnonymous}
                    onChange={(v) => save({ defaultAnonymous: v })}
                  />
                </View>

                <Text style={styles.section}>Friends notifications</Text>
                <View style={fui.card}>
                  {NOTIF_ROWS.map((r, i) => (
                    <ToggleRow
                      key={r.key}
                      last={i === NOTIF_ROWS.length - 1}
                      label={r.label}
                      hint={r.hint}
                      value={!!settings.notifPrefs?.[r.key]}
                      onChange={(v) => save({ notifPrefs: { [r.key]: v } })}
                    />
                  ))}
                </View>
              </>
            ) : null}

            {/* People */}
            <Text style={styles.section}>People</Text>
            <View style={fui.card}>
              <NavRow
                icon={<Ban size={18} color={FriendsColors.ink} />}
                label="Blocked people"
                hint="Manage who you've blocked"
                onPress={() => {
                  onClose();
                  onOpenBlocked();
                }}
                last={!settings}
              />
              {settings ? (
                <View style={[fui.row, { borderBottomWidth: 0, alignItems: 'flex-start' }]}>
                  <VolumeX size={18} color={FriendsColors.ink} style={{ marginTop: 2 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={FT.h3}>Muted</Text>
                    {mutes.length === 0 ? (
                      <Text style={FT.small}>You haven't muted anyone. Muted people and topics disappear from your feeds; they aren't told.</Text>
                    ) : (
                      mutes.map((m) => (
                        <View key={`${m.targetType}:${m.targetId}`} style={styles.muteRow}>
                          <Text style={[FT.body, { flex: 1 }]} numberOfLines={1}>
                            {m.user ? identityLabel(m.user) : m.label || (m.targetType === 'hashtag' ? 'Hashtag' : m.targetType === 'community' ? 'Community' : m.targetType === 'entity' ? 'Page' : 'Student')}
                          </Text>
                          <TouchableOpacity onPress={() => unmute(m)} hitSlop={8} style={styles.smallBtn} accessibilityRole="button" accessibilityLabel="Unmute">
                            <Text style={{ color: FriendsColors.accent, fontWeight: '700', fontSize: 13 }}>Unmute</Text>
                          </TouchableOpacity>
                        </View>
                      ))
                    )}
                  </View>
                </View>
              ) : null}
            </View>

            {/* My reports */}
            <Text style={styles.section}>Your reports</Text>
            <View style={fui.card}>
              {reports.length === 0 ? (
                <View style={[fui.row, { borderBottomWidth: 0 }]}>
                  <Flag size={18} color={FriendsColors.muted} />
                  <Text style={[FT.small, { flex: 1 }]}>Reports you send appear here with their status. The person you report is never told who reported.</Text>
                </View>
              ) : (
                reports.map((r, i) => (
                  <View key={r.id} style={[fui.row, i === reports.length - 1 && { borderBottomWidth: 0 }]}>
                    <Flag size={18} color={FriendsColors.muted} />
                    <View style={{ flex: 1 }}>
                      <Text style={FT.h3}>{categoryLabel(r.category)}</Text>
                      <RelativeTime value={r.createdAt} />
                    </View>
                    <View style={styles.status}>
                      <Text style={styles.statusText}>
                        {r.status === 'closed' && r.outcome ? (r.outcome === 'action_taken' ? 'Action taken' : 'No action') : REPORT_STATUS[r.status] || r.status}
                      </Text>
                    </View>
                  </View>
                ))
              )}
            </View>

            <Text style={styles.section}>Guidelines</Text>
            <View style={fui.card}>
              <NavRow icon={<BookOpen size={18} color={FriendsColors.ink} />} label="Community guidelines" hint="What's allowed in Friends" onPress={() => setGuidelinesOpen(true)} last />
            </View>
          </>
        )}
      </ScrollView>

      <AppealSheet visible={!!appealFor} onClose={() => setAppealFor(null)} action={appealFor} onAppealed={load} />
      <FriendsSheet visible={guidelinesOpen} onClose={() => setGuidelinesOpen(false)} title="Community guidelines" scroll={false} maxHeight="90%">
        <View style={{ flexShrink: 1, marginHorizontal: -FS.lg }}>
          <GuidelinesGate readOnly />
        </View>
      </FriendsSheet>
    </FriendsScreenModal>
  );
};

const ToggleRow: React.FC<{ label: string; hint?: string; value: boolean; onChange: (v: boolean) => void; last?: boolean }> = ({
  label,
  hint,
  value,
  onChange,
  last,
}) => (
  <View style={[fui.row, last && { borderBottomWidth: 0 }]}>
    <View style={{ flex: 1 }}>
      <Text style={FT.h3}>{label}</Text>
      {hint ? <Text style={[FT.small, { marginTop: 2 }]}>{hint}</Text> : null}
    </View>
    <Switch
      value={value}
      onValueChange={onChange}
      trackColor={{ false: FriendsColors.line, true: FriendsColors.accent }}
      thumbColor={value ? FriendsColors.accentInk : FriendsColors.muted}
      accessibilityLabel={label}
    />
  </View>
);

const NavRow: React.FC<{ icon: React.ReactNode; label: string; hint?: string; onPress: () => void; last?: boolean }> = ({ icon, label, hint, onPress, last }) => (
  <TouchableOpacity style={[fui.row, last && { borderBottomWidth: 0 }]} onPress={onPress} activeOpacity={0.75} accessibilityRole="button" accessibilityLabel={label}>
    {icon}
    <View style={{ flex: 1 }}>
      <Text style={FT.h3}>{label}</Text>
      {hint ? <Text style={[FT.small, { marginTop: 2 }]}>{hint}</Text> : null}
    </View>
    <ChevronRight size={18} color={FriendsColors.muted} />
  </TouchableOpacity>
);

const styles = themedSheet(() => ({
  section: { ...StyleSheet.flatten(FT.kicker), marginTop: FS.xl, marginBottom: FS.sm },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: FS.sm,
    padding: FS.md,
    borderRadius: FR.md,
    backgroundColor: 'rgba(242,178,126,0.08)',
  },
  muteRow: { flexDirection: 'row', alignItems: 'center', gap: FS.sm, marginTop: FS.sm, minHeight: 36 },
  smallBtn: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 8 },
  status: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: FR.pill, backgroundColor: FriendsColors.cardHi },
  statusText: { fontSize: 12, fontWeight: '800', color: FriendsColors.muted },
}));
