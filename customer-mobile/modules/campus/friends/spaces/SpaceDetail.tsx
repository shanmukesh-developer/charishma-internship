import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, RefreshControl, ActivityIndicator, StyleSheet, Alert } from 'react-native';
import { Ellipsis, Radio, Pencil, CircleX, Play, Square, Users, CalendarClock, Headphones, Hourglass, Wifi, Ban } from '../../../../components/lucide';
import * as Haptics from 'expo-haptics';
import { FriendsColors, FS, FR, FT, fui } from '../friendsTheme';
import { IdentityChip } from '../shared/IdentityChip';
import { FriendsAvatar } from '../shared/FriendsAvatar';
import { FriendsSkeleton } from '../shared/FriendsSkeleton';
import { FriendsEmpty, FriendsError } from '../shared/FriendsEmpty';
import { ActionMenu } from '../shared/ActionMenu';
import { useCampusOffline } from '../shared/OfflineBanner';
import { useScreenActive } from '../shared/useScreenActive';
import { errorCode } from '../api/core';
import { Space, cancelSpace, endSpace, fetchSpace, spaceErrorMessage, startSpace } from '../api/spacesApi';
import { NotRecorded, SpaceHeader, SpaceSoftError, SpaceStatusBadge } from './SpacesUi';
import { ReminderButton } from './ReminderButton';
import {
  ROLE_LABEL,
  endReasonText,
  formatCountdown,
  formatLiveFor,
  formatSpaceTime,
  hostName,
  hostUserId,
  localZoneLabel,
  plural,
  spaceBus,
  spaceCache,
  spaceLink,
  useSpacesNav,
} from './spacesShared';

const POLL_LIVE_MS = 20000;

/**
 * One Space: what it is, who hosts it and when (local time), with the right action for me:
 * join / return (live), remind me (scheduled), or host controls (start, edit, cancel, end).
 */
export const SpaceDetail: React.FC<{ id: string; initial?: Space | null; active?: boolean }> = ({ id, initial, active = true }) => {
  const nav = useSpacesNav();
  const offline = useCampusOffline();
  const [space, setSpace] = useState<Space | null>(() => spaceCache.get<Space>(`space:${id}`) || initial || null);
  const [loading, setLoading] = useState(!space);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<any>(null);
  const [softError, setSoftError] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [now, setNow] = useState(Date.now());
  const alive = useRef(true);
  const spaceRef = useRef(space);
  spaceRef.current = space;
  const gateRef = useRef(nav.onGateError);
  gateRef.current = nav.onGateError;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const apply = useCallback((s: Space) => {
    setSpace(s);
    spaceBus.emit(s);
  }, []);

  const load = useCallback(
    async (mode: 'initial' | 'refresh' | 'silent') => {
      if (mode === 'refresh') setRefreshing(true);
      try {
        const s = await fetchSpace(id);
        if (!alive.current) return;
        setSpace(s);
        spaceCache.set(`space:${s.id}`, s);
        setError(null);
        setSoftError(null);
      } catch (e: any) {
        if (!alive.current) return;
        gateRef.current(e);
        const gone = ['SPACE_NOT_FOUND', 'INVALID_ID', 'NOT_FOUND'].includes(errorCode(e));
        if (gone || !spaceRef.current) {
          setError(e);
          if (gone) setSpace(null);
        } else if (mode !== 'silent') setSoftError(e);
      } finally {
        if (alive.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [id]
  );

  useEffect(() => {
    load('initial');
  }, [load]);

  // Fresh copies from elsewhere (list, room, reminder) and a gentle refresh while live.
  useEffect(() => spaceBus.on((s) => s.id === id && setSpace(s)), [id]);
  // Polls only while this detail is the visible page (Spaces tab showing, on top, app in the
  // foreground and the screen focused). Coming back catches up at once, then every POLL_LIVE_MS.
  const screenActive = useScreenActive();
  const polling = active && screenActive;
  const pausedRef = useRef(false);
  useEffect(() => {
    if (!polling) {
      pausedRef.current = true;
      return;
    }
    const tick = () => {
      setNow(Date.now());
      if (spaceRef.current?.status === 'live' || spaceRef.current?.status === 'scheduled') load('silent');
    };
    if (pausedRef.current) {
      pausedRef.current = false;
      tick();
    }
    const t = setInterval(tick, POLL_LIVE_MS);
    return () => clearInterval(t);
  }, [load, polling]);

  const run = async (key: string, fn: () => Promise<Space | null>) => {
    if (busy) return;
    setBusy(key);
    try {
      const s = await fn();
      if (s && alive.current) {
        apply(s);
        spaceBus.emitStale();
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      return s;
    } catch (e: any) {
      nav.onGateError(e);
      Alert.alert("Couldn't do that", spaceErrorMessage(e));
      if (['STATE_CHANGED', 'NOT_SCHEDULED', 'NOT_LIVE', 'UNDER_REVIEW'].includes(errorCode(e))) load('silent');
      return null;
    } finally {
      if (alive.current) setBusy(null);
    }
  };

  const doStart = () =>
    run('start', async () => {
      const r = await startSpace(id);
      return r.space;
    }).then((s) => {
      if (s && s.status === 'live') nav.openRoom(s);
    });

  const doCancel = () =>
    Alert.alert('Cancel this Space?', 'Everyone with a reminder will be told it is cancelled.', [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Cancel Space', style: 'destructive', onPress: () => run('cancel', async () => (await cancelSpace(id)).space) },
    ]);

  const doEnd = () =>
    Alert.alert('End this Space for everyone?', 'Everyone in the room will be disconnected.', [
      { text: 'Not yet', style: 'cancel' },
      { text: 'End Space', style: 'destructive', onPress: () => run('end', async () => (await endSpace(id)).space) },
    ]);

  const moreBtn = space ? (
    <TouchableOpacity style={styles.round} onPress={() => setMenu(true)} accessibilityRole="button" accessibilityLabel="More options">
      <Ellipsis size={20} color={FriendsColors.ink} />
    </TouchableOpacity>
  ) : null;

  if (!space) {
    return (
      <View style={fui.screen}>
        <SpaceHeader title="Space" onBack={nav.back} />
        {loading ? (
          <FriendsSkeleton rows={2} />
        ) : error && ['SPACE_NOT_FOUND', 'INVALID_ID', 'NOT_FOUND'].includes(errorCode(error)) ? (
          <FriendsEmpty
            icon={<Ban size={22} color={FriendsColors.accent} />}
            title="This Space isn't available"
            subtitle="It may have been removed, or it's from another campus."
            actionLabel="Back to Spaces"
            onAction={nav.back}
          />
        ) : (
          <FriendsError message={spaceErrorMessage(error, "Couldn't load this Space.")} onRetry={() => load('initial')} />
        )}
      </View>
    );
  }

  const live = space.status === 'live';
  const scheduled = space.status === 'scheduled';
  const finished = !live && !scheduled;
  const inRoom = nav.roomSpaceId === space.id;
  const hostId = hostUserId(space.host);
  const amHost = space.isHost;

  return (
    <View style={fui.screen}>
      <SpaceHeader title={live ? 'Live Space' : scheduled ? 'Upcoming Space' : 'Space'} subtitle={space.topic} onBack={nav.back} right={moreBtn} />
      <ScrollView
        contentContainerStyle={{ padding: FS.lg, paddingBottom: 120 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} tintColor={FriendsColors.accent} colors={[FriendsColors.accent]} progressBackgroundColor={FriendsColors.card} />
        }
      >
        {softError ? <SpaceSoftError error={softError} onRetry={() => load('refresh')} /> : null}

        <View style={[styles.hero, live && styles.heroLive]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: FS.sm }}>
            <SpaceStatusBadge space={space} />
            <View style={{ flex: 1 }} />
            <NotRecorded compact />
          </View>
          <Text style={[FT.h1, { marginTop: FS.md }]} accessibilityRole="header">
            {space.title}
          </Text>
          {space.description ? <Text style={[FT.body, { marginTop: FS.sm, color: FriendsColors.muted }]}>{space.description}</Text> : null}
          <View style={{ marginTop: FS.lg }}>
            <IdentityChip identity={space.host} />
          </View>

          <View style={styles.facts}>
            {live ? (
              <>
                <Fact icon={<Headphones size={15} color={FriendsColors.danger} />} text={`Live for ${formatLiveFor(space.startedAt, now)}`} />
                <Fact icon={<Users size={15} color={FriendsColors.muted} />} text={`${space.speakerCount} on stage · ${plural(space.listenerCount, 'listener')}`} />
              </>
            ) : scheduled ? (
              <>
                <Fact
                  icon={<CalendarClock size={15} color={FriendsColors.accent} />}
                  text={`${formatSpaceTime(space.scheduledFor, now)} (${localZoneLabel()})`}
                  sub={formatCountdown(space.scheduledFor, now)}
                />
                <Fact icon={<Users size={15} color={FriendsColors.muted} />} text={`${space.interestedCount} interested`} />
              </>
            ) : (
              <Fact icon={<Hourglass size={15} color={FriendsColors.muted} />} text={endReasonText(space.status === 'cancelled' ? 'cancelled' : space.status === 'expired' ? 'expired' : space.endReason)} />
            )}
            <Fact
              icon={<Radio size={15} color={FriendsColors.muted} />}
              text={space.participation === 'open' ? 'Open stage: raise a hand to take a free seat' : 'Raise your hand to ask to speak'}
            />
          </View>
        </View>

        {amHost && space.underReview ? (
          <View style={styles.review} accessibilityRole="alert">
            <Hourglass size={16} color={FriendsColors.warn} />
            <Text style={[FT.small, { flex: 1, color: FriendsColors.warn }]}>
              Your Space is waiting for a quick moderator check. Only you can see it until then, and it can't start yet.
            </Text>
          </View>
        ) : null}

        {live && space.speakers.length ? (
          <View style={{ marginTop: FS.xl }}>
            <Text style={FT.kicker}>On stage</Text>
            <View style={styles.speakers}>
              {space.speakers.map((s) => (
                <View key={s.userId} style={styles.speaker} accessible accessibilityLabel={`${s.name}, ${ROLE_LABEL[s.role]}`}>
                  <FriendsAvatar name={s.name} uri={s.avatarUrl} size={52} />
                  <Text style={styles.speakerName} numberOfLines={1}>
                    {s.name.split(' ')[0]}
                  </Text>
                  <Text style={FT.small}>{ROLE_LABEL[s.role]}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {/* ── Primary action ─────────────────────────────────────────────── */}
        <View style={{ marginTop: FS.xl, gap: FS.sm }}>
          {live ? (
            space.removed ? (
              <View style={styles.note}>
                <Ban size={16} color={FriendsColors.danger} />
                <Text style={[FT.small, { flex: 1, color: FriendsColors.danger }]}>You were removed from this Space by the host, so you can't rejoin.</Text>
              </View>
            ) : (
              <>
                <TouchableOpacity
                  style={[fui.primaryBtn, (offline || (!inRoom && !amHost && space.full.listeners)) && { opacity: 0.55 }]}
                  onPress={() => nav.openRoom(space)}
                  disabled={!inRoom && !amHost && space.full.listeners}
                  accessibilityRole="button"
                  accessibilityLabel={inRoom ? 'Return to the room' : amHost ? 'Open your room' : space.full.listeners ? 'Room full' : 'Join as a listener'}
                >
                  <Headphones size={18} color={FriendsColors.accentInk} />
                  <Text style={fui.primaryBtnText}>{inRoom ? 'Return to the room' : amHost ? 'Open your room' : space.full.listeners ? 'Room full' : 'Join as a listener'}</Text>
                </TouchableOpacity>
                {!inRoom && !amHost ? (
                  <Text style={[FT.small, { textAlign: 'center' }]}>
                    {space.full.listeners ? 'All listener seats are taken. Try again in a bit.' : "You'll join muted as a listener. Raise your hand to ask to speak."}
                  </Text>
                ) : null}
              </>
            )
          ) : null}

          {scheduled && !amHost ? <ReminderButton space={space} onChanged={apply} block /> : null}
          {scheduled && !amHost && space.reminded ? (
            <Text style={[FT.small, { textAlign: 'center' }]}>We'll notify you shortly before it starts, and if the time changes.</Text>
          ) : null}

          {amHost && space.canStart ? (
            <TouchableOpacity style={fui.primaryBtn} onPress={doStart} disabled={!!busy} accessibilityRole="button" accessibilityLabel="Start the Space now">
              {busy === 'start' ? <ActivityIndicator color={FriendsColors.accentInk} /> : <Play size={18} color={FriendsColors.accentInk} />}
              <Text style={fui.primaryBtnText}>Start now</Text>
            </TouchableOpacity>
          ) : null}
          {amHost && (space.canEdit || space.canCancel) ? (
            <View style={{ flexDirection: 'row', gap: FS.sm }}>
              {space.canEdit ? (
                <TouchableOpacity style={[fui.ghostBtn, { flex: 1 }]} onPress={() => nav.openComposer(space)} disabled={!!busy} accessibilityRole="button" accessibilityLabel="Edit or reschedule">
                  <Pencil size={16} color={FriendsColors.ink} />
                  <Text style={fui.ghostBtnText}>Edit / reschedule</Text>
                </TouchableOpacity>
              ) : null}
              {space.canCancel ? (
                <TouchableOpacity style={[fui.ghostBtn, { flex: 1, borderColor: 'rgba(243,139,128,0.4)' }]} onPress={doCancel} disabled={!!busy} accessibilityRole="button" accessibilityLabel="Cancel this Space">
                  {busy === 'cancel' ? <ActivityIndicator size="small" color={FriendsColors.danger} /> : <CircleX size={16} color={FriendsColors.danger} />}
                  <Text style={[fui.ghostBtnText, { color: FriendsColors.danger }]}>Cancel</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}
          {amHost && space.canEnd && !inRoom ? (
            <TouchableOpacity style={[fui.ghostBtn, { borderColor: 'rgba(243,139,128,0.4)' }]} onPress={doEnd} disabled={!!busy} accessibilityRole="button" accessibilityLabel="End this Space for everyone">
              {busy === 'end' ? <ActivityIndicator size="small" color={FriendsColors.danger} /> : <Square size={16} color={FriendsColors.danger} />}
              <Text style={[fui.ghostBtnText, { color: FriendsColors.danger }]}>End for everyone</Text>
            </TouchableOpacity>
          ) : null}

          {finished ? (
            <FriendsEmpty
              compact
              icon={<Hourglass size={22} color={FriendsColors.accent} />}
              title={space.status === 'cancelled' ? 'Cancelled' : space.status === 'expired' ? 'Expired' : 'This Space has ended'}
              subtitle="Spaces are live only. Nothing was recorded, so there's no replay."
            />
          ) : null}
        </View>

        {!finished && nav.meta?.network?.note ? (
          <View style={[styles.note, { marginTop: FS.xl, backgroundColor: FriendsColors.card }]}>
            <Wifi size={14} color={FriendsColors.muted} />
            <Text style={[FT.small, { flex: 1 }]}>{nav.meta.network.note}</Text>
          </View>
        ) : null}
        <View style={{ marginTop: FS.lg }}>
          <NotRecorded text={nav.meta?.notRecorded || 'Spaces are live only. They are never recorded or transcribed.'} />
        </View>
      </ScrollView>

      <ActionMenu
        visible={menu}
        onClose={() => setMenu(false)}
        title={space.title}
        copyLink={spaceLink(space.id)}
        report={amHost ? null : { type: 'space', id: space.id, label: `the Space "${space.title.slice(0, 40)}"` }}
        block={!amHost && hostId ? { userId: hostId, name: hostName(space.host) } : null}
        onBlocked={(uid) => {
          nav.onBlocked(uid);
          nav.back();
        }}
      />
    </View>
  );
};

const Fact: React.FC<{ icon: React.ReactNode; text: string; sub?: string }> = ({ icon, text, sub }) => (
  <View style={styles.fact}>
    {icon}
    <View style={{ flex: 1 }}>
      <Text style={[FT.body, { fontWeight: '600' }]}>{text}</Text>
      {sub ? <Text style={FT.small}>{sub}</Text> : null}
    </View>
  </View>
);

const styles = StyleSheet.create({
  round: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  hero: { backgroundColor: FriendsColors.card, borderRadius: FR.card, borderWidth: 1, borderColor: 'rgba(212,175,122,0.3)', padding: FS.lg },
  heroLive: { borderColor: 'rgba(243,139,128,0.45)' },
  facts: { marginTop: FS.lg, gap: FS.md, paddingTop: FS.md, borderTopWidth: 1, borderTopColor: FriendsColors.lineSoft },
  fact: { flexDirection: 'row', alignItems: 'flex-start', gap: FS.sm },
  review: { flexDirection: 'row', gap: 8, marginTop: FS.md, padding: FS.md, borderRadius: FR.md, backgroundColor: FriendsColors.warnSoft },
  speakers: { flexDirection: 'row', flexWrap: 'wrap', marginTop: FS.sm },
  speaker: { width: '25%', alignItems: 'center', paddingVertical: FS.sm },
  speakerName: { fontSize: 13, fontWeight: '700', color: FriendsColors.ink, marginTop: 6, maxWidth: '92%' },
  note: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', padding: FS.md, borderRadius: FR.md, backgroundColor: FriendsColors.dangerSoft },
});
