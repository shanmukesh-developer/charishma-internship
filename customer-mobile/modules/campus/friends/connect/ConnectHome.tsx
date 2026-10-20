import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, BackHandler, Alert, StyleSheet } from 'react-native';
import { KeyboardAvoidingView } from '../../../../components/KeyboardAvoidingView';
import * as Haptics from 'expo-haptics';
import { ShieldCheck, Eye, Compass, HeartHandshake, UserRound } from '../../../../components/lucide';
import { FriendsColors, FS, FT, FR, fui } from '../friendsTheme';
import { FriendsSkeleton } from '../shared/FriendsSkeleton';
import { FriendsError } from '../shared/FriendsEmpty';
import { FriendsScreenModal } from '../shared/FriendsSheet';
import { getCampusSocket, subscribeCampusConnection } from '../../campusSocketClient';
import { isGateError } from '../api/core';
import { ConnectCard, ConnectMatch, ConnectMyProfile, ConnectStatus, fetchConnectStatus, resumeConnect } from '../api/connectApi';
import { AgeGate, ConsentGate, RemovedGate } from './ConnectGate';
import { ConnectOnboarding } from './ConnectOnboarding';
import { ConnectPolicyScreen } from './ConnectPolicyScreen';
import { ConnectProfileEditor } from './ConnectProfileEditor';
import { ConnectCardView } from './ConnectCardView';
import { DiscoverDeck, clearConnectDeckCache } from './DiscoverDeck';
import { MatchesList, clearConnectMatchesCache } from './MatchesList';
import { MatchScreen } from './MatchScreen';
import { SafetyCenter } from './SafetyCenter';
import { ConnectHeart, Notice, StatusPill } from './ConnectUi';
import { connectBus, connectErrorMessage, isConnectGateError } from './connectShared';

export interface ConnectHomeProps {
  /** Match id from a deep link / CONNECT_MATCH notification (/friends?tab=friends&sub=connect&id=...). */
  focusId?: string | null;
  /** Open a campus chat (Connect match chats reuse ChatDetailScreen). */
  onOpenChat?: (chatId: string, name: string) => void;
  /** Signed-in user id (the status cache is per user). */
  userId?: string | null;
  /** True while Connect is the visible sub-tab (Android back pops the Connect stack only then). */
  active?: boolean;
  /** Ask the Friends shell to refetch eligibility (flag / restriction / guidelines changed). */
  onGateError?: () => void;
  /** Me › Friends privacy & safety (blocked list, decisions, appeals). */
  onOpenSafety?: () => void;
}

type Tab = 'discover' | 'matches' | 'profile';
const TABS: { key: Tab; label: string; icon: typeof Compass }[] = [
  { key: 'discover', label: 'Discover', icon: Compass },
  { key: 'matches', label: 'Matches', icon: HeartHandshake },
  { key: 'profile', label: 'Profile', icon: UserRound },
];

// Last status per user, so coming back to Connect renders instantly (refreshed in the background).
let statusCache: { userId: string; value: ConnectStatus } | null = null;

/**
 * Campus Buddy > Friends > Connect: optional, 18+, verified students on one campus.
 * Server-driven stages: age (DOB) → consent (+18+ declaration) → profile + selfie check → active.
 * Then Discover (Like / Pass), Matches (Daily Spark, chat after a match), Profile (photos, privacy,
 * hide lists) and a Safety centre (pause, delete, my data, helplines). No GPS, no calls.
 */
export const ConnectHome: React.FC<ConnectHomeProps> = ({ focusId, onOpenChat, userId, active = true, onGateError, onOpenSafety }) => {
  const uid = userId || '';
  const [status, setStatus] = useState<ConnectStatus | null>(() => (statusCache && statusCache.userId === uid ? statusCache.value : null));
  const [loading, setLoading] = useState(!status);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('discover');
  const [stack, setStack] = useState<{ key: number; id: string; match?: ConnectMatch | null }[]>([]);
  const [safetyOpen, setSafetyOpen] = useState(false);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [matchCount, setMatchCount] = useState(0);
  const keySeq = useRef(0);
  const mounted = useRef(true);
  const reqId = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    const my = ++reqId.current;
    setError(null);
    try {
      const s = await fetchConnectStatus();
      if (!mounted.current || my !== reqId.current) return;
      setStatus(s);
      if (uid) statusCache = { userId: uid, value: s };
    } catch (e: any) {
      if (!mounted.current || my !== reqId.current) return;
      if (isGateError(e)) onGateError?.();
      setError(connectErrorMessage(e, "Couldn't load Connect right now."));
    } finally {
      if (mounted.current && my === reqId.current) setLoading(false);
    }
  }, [uid, onGateError]);

  useEffect(() => {
    load();
  }, [load]);

  // Coming back online: refresh (a moderator decision or selfie review may have landed meanwhile).
  useEffect(() => {
    let wasDown = false;
    return subscribeCampusConnection((st) => {
      if (st === 'connected') {
        if (wasDown) load();
        wasDown = false;
      } else if (st === 'disconnected') wasDown = true;
    });
  }, [load]);

  const patchStatus = useCallback(
    (patch: Partial<ConnectStatus>) =>
      setStatus((s) => {
        if (!s) return s;
        const next = { ...s, ...patch };
        if (uid) statusCache = { userId: uid, value: next };
        return next;
      }),
    [uid]
  );
  const setProfile = useCallback((p: ConnectMyProfile) => patchStatus({ profile: p, liveness: p.liveness }), [patchStatus]);

  /** An API call said our picture of the gate is stale: Friends-level → shell, Connect-level → reload. */
  const onGate = useCallback(
    (e: any) => {
      if (isGateError(e)) onGateError?.();
      if (isConnectGateError(e) || isGateError(e)) load();
    },
    [onGateError, load]
  );

  // Live: a new match / a match that ended (no names in either event).
  useEffect(() => {
    const s = getCampusSocket();
    const onMatch = (p: { matchId?: string }) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      connectBus.emit({ type: 'match', matchId: p?.matchId });
    };
    const onUpdated = (p: { matchId?: string; status?: string }) => {
      if (p?.matchId) connectBus.emit({ type: 'ended', matchId: p.matchId });
      if (p?.status === 'deleted') load();
    };
    s.on('friends:connect_match', onMatch);
    s.on('friends:connect_updated', onUpdated);
    return () => {
      s.off('friends:connect_match', onMatch);
      s.off('friends:connect_updated', onUpdated);
    };
  }, [load]);

  const push = useCallback((id: string, match?: ConnectMatch | null) => {
    setStack((prev) => (prev[prev.length - 1]?.id === id ? prev : [...prev.slice(-4), { key: ++keySeq.current, id, match }]));
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

  const stage = status?.stage || null;
  const inApp = stage === 'ready' || stage === 'paused';

  // Deep link / notification: open the match once Connect is usable.
  const lastFocus = useRef<string | null>(null);
  useEffect(() => {
    if (!focusId || !inApp || lastFocus.current === focusId) return;
    lastFocus.current = focusId;
    setTab('matches');
    push(focusId);
  }, [focusId, inApp, push]);

  const openChat = useCallback(
    (conversationId: string, name: string) => {
      if (onOpenChat) onOpenChat(conversationId, name);
      else Alert.alert('Chat unavailable', 'Please update the app to chat with your match.');
    },
    [onOpenChat]
  );

  const resume = useCallback(async () => {
    try {
      await resumeConnect();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      clearConnectDeckCache();
      load();
    } catch (e: any) {
      onGate(e);
      Alert.alert("Couldn't resume", connectErrorMessage(e));
    }
  }, [load, onGate]);

  const onStatusChanged = useCallback(() => {
    clearConnectDeckCache();
    connectBus.emit({ type: 'status' });
    load();
  }, [load]);

  const onDeleted = useCallback(() => {
    clearConnectDeckCache();
    clearConnectMatchesCache();
    setSafetyOpen(false);
    setStack([]);
    setTab('discover');
    load();
  }, [load]);

  // What others see of me: approved photos only.
  const previewCard = useMemo<ConnectCard | null>(() => {
    const p = status?.profile;
    if (!p) return null;
    return {
      profileId: p.profileId,
      displayName: p.displayName || 'You',
      age: p.age,
      ...(p.showYear && p.year ? { year: p.year } : {}),
      ...(p.showBranch && p.branch ? { branch: p.branch } : {}),
      bio: p.bio,
      interests: p.interests,
      lookingFor: p.lookingFor,
      photos: p.photos.filter((ph) => ph.status === 'approved').map((ph) => ({ id: ph.id, url: ph.url })),
    };
  }, [status?.profile]);

  const sheets = status ? (
    <>
      <SafetyCenter
        visible={safetyOpen}
        onClose={() => setSafetyOpen(false)}
        status={status}
        onChanged={onStatusChanged}
        onDeleted={onDeleted}
        onOpenPolicy={() => {
          setSafetyOpen(false);
          setTimeout(() => setPolicyOpen(true), 350);
        }}
        onOpenFriendsSafety={() => {
          setSafetyOpen(false);
          if (onOpenSafety) setTimeout(onOpenSafety, 350);
        }}
        onEditPrivacy={() => {
          setSafetyOpen(false);
          setStack([]);
          setTab('profile');
        }}
      />
      <ConnectPolicyScreen visible={policyOpen} onClose={() => setPolicyOpen(false)} />
    </>
  ) : null;

  // ── Loading / error ────────────────────────────────────────────────────────
  if (!status) {
    return (
      <View style={fui.screen}>
        {loading ? <FriendsSkeleton rows={2} /> : <FriendsError message={error || "Couldn't load Connect right now."} onRetry={() => { setLoading(true); load(); }} />}
      </View>
    );
  }

  // ── Gates ──────────────────────────────────────────────────────────────────
  if (stage === 'age') {
    return <AgeGate status={status} onChanged={load} />;
  }
  if (stage === 'consent') {
    return (
      <View style={{ flex: 1 }}>
        <ConsentGate status={status} onChanged={onStatusChanged} onOpenPolicy={() => setPolicyOpen(true)} />
        {sheets}
      </View>
    );
  }
  if (stage === 'removed') {
    return (
      <View style={{ flex: 1 }}>
        <RemovedGate onAppeal={() => onOpenSafety?.()} onOpenSafetyCenter={() => setSafetyOpen(true)} />
        {sheets}
      </View>
    );
  }
  if (!inApp) {
    // 'liveness' / 'profile': build the profile, pass the selfie check, turn Connect on.
    return (
      <View style={{ flex: 1 }}>
        <View style={styles.setupBar}>
          <Text style={[FT.small, { flex: 1 }]}>Setting up Connect</Text>
          <TouchableOpacity onPress={() => setSafetyOpen(true)} style={styles.setupLink} accessibilityRole="button" accessibilityLabel="Connect safety and privacy, including delete">
            <ShieldCheck size={14} color={FriendsColors.accent} />
            <Text style={[FT.small, { color: FriendsColors.accent, fontWeight: '700' }]}>Safety</Text>
          </TouchableOpacity>
        </View>
        <ConnectOnboarding status={status} onStatus={patchStatus} onChanged={onStatusChanged} />
        {sheets}
      </View>
    );
  }

  // ── Connect ────────────────────────────────────────────────────────────────
  const paused = stage === 'paused';
  const profile = status.profile;

  const content =
    tab === 'discover' ? (
      <DiscoverDeck status={status} paused={paused} onResume={resume} onGate={onGate} onOpenChat={openChat} onOpenMatch={(id) => push(id)} />
    ) : tab === 'matches' ? (
      <MatchesList onOpenMatch={(m) => push(m.id, m)} onGate={onGate} onDiscover={() => setTab('discover')} onCount={setMatchCount} />
    ) : profile ? (
      <KeyboardAvoidingView style={{ flex: 1 }}>
      <ScrollView style={fui.screen} contentContainerStyle={{ padding: FS.lg, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
        <ConnectProfileEditor
          status={status}
          profile={profile}
          mode="edit"
          onProfile={setProfile}
          onSaved={() => clearConnectDeckCache()}
          header={
            <View style={styles.profileHead}>
              <View style={{ flex: 1 }}>
                <Text style={FT.h2} accessibilityRole="header">
                  Your profile
                </Text>
                <Text style={FT.small}>Only approved photos and what you add here are shown.</Text>
              </View>
              <TouchableOpacity style={styles.previewBtn} onPress={() => setPreviewOpen(true)} accessibilityRole="button" accessibilityLabel="Preview how others see your card">
                <Eye size={16} color={FriendsColors.ink} />
                <Text style={[FT.small, { color: FriendsColors.ink, fontWeight: '700' }]}>Preview</Text>
              </TouchableOpacity>
            </View>
          }
        />
      </ScrollView>
      </KeyboardAvoidingView>
    ) : null;

  return (
    <View style={styles.root}>
      <View style={[styles.layer, stack.length ? styles.hidden : null]} importantForAccessibility={stack.length ? 'no-hide-descendants' : 'auto'} accessibilityElementsHidden={!!stack.length}>
        <View style={styles.top}>
          <ConnectHeart size={18} />
          <Text style={[FT.h1, { flex: 1 }]} accessibilityRole="header">
            Connect
          </Text>
          <StatusPill label={paused ? 'Paused' : '18+'} tone={paused ? 'warn' : 'accent'} />
          <TouchableOpacity style={styles.round} onPress={() => setSafetyOpen(true)} accessibilityRole="button" accessibilityLabel="Connect safety and privacy: pause, delete, helplines">
            <ShieldCheck size={19} color={FriendsColors.ink} />
          </TouchableOpacity>
        </View>
        <View style={styles.seg} accessibilityRole="tablist">
          {TABS.map((t) => {
            const on = t.key === tab;
            const Icon = t.icon;
            return (
              <TouchableOpacity
                key={t.key}
                style={[styles.segBtn, on && styles.segOn]}
                onPress={() => setTab(t.key)}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                accessibilityLabel={t.key === 'matches' && matchCount ? `${t.label}, ${matchCount}` : t.label}
              >
                <Icon size={15} color={on ? FriendsColors.ink : FriendsColors.muted} />
                <Text style={[styles.segText, on && { color: FriendsColors.ink }]}>{t.label}</Text>
                {t.key === 'matches' && matchCount ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{matchCount > 99 ? '99+' : matchCount}</Text>
                  </View>
                ) : null}
              </TouchableOpacity>
            );
          })}
        </View>
        {paused && tab !== 'discover' ? (
          <Notice tone="warn" text="Connect is paused: nobody new sees you. Matches and chats still work." actionLabel="Resume" onAction={resume} style={{ marginHorizontal: FS.lg, marginBottom: FS.sm }} />
        ) : null}
        {profile?.underReview && tab !== 'profile' ? (
          <Notice tone="warn" text="Your profile text is waiting for a moderator, so you're hidden from discovery for now." style={{ marginHorizontal: FS.lg, marginBottom: FS.sm }} />
        ) : null}
        <View style={{ flex: 1 }}>{content}</View>
      </View>

      {stack.map((s, i) => {
        const top = i === stack.length - 1;
        return (
          <View key={s.key} style={[styles.layer, !top && styles.hidden]} importantForAccessibility={top ? 'auto' : 'no-hide-descendants'} accessibilityElementsHidden={!top}>
            <MatchScreen id={s.id} initial={s.match} status={status} onBack={back} onOpenChat={openChat} onGate={onGate} />
          </View>
        );
      })}

      <FriendsScreenModal visible={previewOpen} onClose={() => setPreviewOpen(false)} title="How others see you" subtitle="Approved photos only">
        <ScrollView contentContainerStyle={{ padding: FS.lg, paddingBottom: 60 }}>
          {previewCard ? <ConnectCardView card={previewCard} status={status} /> : null}
          {previewCard && !previewCard.photos.length ? (
            <Notice tone="muted" text="None of your photos are approved yet, so others see your initial. Photos usually get checked within a day." style={{ marginTop: FS.lg }} />
          ) : null}
        </ScrollView>
      </FriendsScreenModal>
      {sheets}
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: FriendsColors.bg },
  layer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: FriendsColors.bg },
  hidden: { display: 'none' },
  top: { flexDirection: 'row', alignItems: 'center', gap: FS.sm, paddingHorizontal: FS.lg, paddingTop: FS.lg, paddingBottom: FS.sm },
  round: { width: 44, height: 44, borderRadius: 22, backgroundColor: FriendsColors.card, borderWidth: 1, borderColor: FriendsColors.line, alignItems: 'center', justifyContent: 'center' },
  seg: { flexDirection: 'row', gap: 4, marginHorizontal: FS.lg, marginBottom: FS.sm, padding: 4, borderRadius: FR.pill, backgroundColor: FriendsColors.card, borderWidth: 1, borderColor: FriendsColors.lineSoft },
  segBtn: { flex: 1, minHeight: 40, borderRadius: FR.pill, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 },
  segOn: { backgroundColor: FriendsColors.cardHi },
  segText: { fontSize: 13, fontWeight: '700', color: FriendsColors.muted },
  badge: { minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: FriendsColors.accent, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 12, fontWeight: '800', color: FriendsColors.accentInk },
  setupBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: FS.lg, paddingTop: FS.sm },
  setupLink: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 36, paddingHorizontal: 6 },
  profileHead: { flexDirection: 'row', alignItems: 'center', gap: FS.sm, marginBottom: FS.sm },
  previewBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingHorizontal: 14, borderRadius: FR.pill, borderWidth: 1, borderColor: FriendsColors.line },
});
