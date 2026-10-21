import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet, Alert, AppState, BackHandler, Linking, Animated } from 'react-native';
import { ChevronDown, Ellipsis, Mic, MicOff, Hand, LogOut, Wifi, WifiOff, Users, Radio, UserPlus, X, Hourglass, Ban, Headphones, RotateCcw } from '../../../../components/lucide';
import * as Haptics from 'expo-haptics';
import { requestRecordingPermissionsAsync } from 'expo-audio';
import { FriendsColors, FS, FR, FT, fui, SectionTints } from '../friendsTheme';
import { BrandFill, CardGlow } from '../shared/FriendsUi';
import { FriendsEmpty } from '../shared/FriendsEmpty';
import { FriendsAvatar } from '../shared/FriendsAvatar';
import { ActionMenu } from '../shared/ActionMenu';
import { Space, SpaceRole, spaceErrorMessage } from '../api/spacesApi';
import { SpaceAudioEngine, SpaceAudioEngineHandle, SpaceEngineMessage } from './SpaceAudioEngine';
import {
  SpaceJoinAck,
  SpaceParticipant,
  SpaceRoomState,
  SpaceSocketError,
  declineSpaceHand,
  endSpaceRoom,
  inviteSpaceSpeaker,
  joinSpaceRoom,
  keepSpaceJoined,
  leaveSpaceRoom,
  onSpaceEvent,
  respondSpaceInvite,
  selfMuteSpace,
  sendSpaceSignal,
  setSpaceHand,
} from './spacesSocket';
import { AudienceSeat, LiveDot, NotRecorded, StageSeat } from './SpacesUi';
import { HostLeaveSheet, ParticipantSheet, SpaceReportSheet } from './SpaceRoomSheets';
import { endReasonText, formatLiveFor, hostName, hostUserId, isOnStage, isRoomMod, plural, spaceBus, spaceLink, useSpacesNav } from './spacesShared';

type Phase = 'joining' | 'live' | 'ended' | 'removed' | 'replaced' | 'error';
type Conn = 'ok' | 'connecting' | 'reconnecting' | 'failed';

export interface SpaceRoomScreenProps {
  space: Space;
  /** False while minimized (the room keeps running; audio continues). */
  visible: boolean;
  /** Friends > Spaces is the visible sub-tab (Android back minimizes only then). */
  active: boolean;
  onMinimize: () => void;
  /** The room is closed for good (left, ended, removed). */
  onExit: () => void;
}

/**
 * The live room. Joins over the `/campus` socket, renders the server's room state (stage, raised
 * hands, audience), and drives the WebRTC audio engine from the server's peer plan. Every role
 * change, mute and removal is decided by the server; this screen only asks.
 * Nothing is recorded: audio flows only between phones and is never stored.
 */
export const SpaceRoomScreen: React.FC<SpaceRoomScreenProps> = ({ space, visible, active, onMinimize, onExit }) => {
  const nav = useSpacesNav();
  const me = nav.me;
  const spaceId = space.id;
  const engine = useRef<SpaceAudioEngineHandle>(null);
  const [phase, setPhase] = useState<Phase>('joining');
  const [joinError, setJoinError] = useState<any>(null);
  const [endReason, setEndReason] = useState<string | null>(null);
  const [room, setRoom] = useState<SpaceRoomState | null>(null);
  const [myRole, setMyRole] = useState<SpaceRole | null>(null);
  const [myMuted, setMyMuted] = useState(true);
  const [socketDown, setSocketDown] = useState(false);
  const [peerStates, setPeerStates] = useState<Record<string, string>>({});
  const [talking, setTalking] = useState<Set<string>>(() => new Set());
  const [micError, setMicError] = useState<string | null>(null);
  const [invite, setInvite] = useState<{ byRole: SpaceRole } | null>(null);
  const [sheet, setSheet] = useState<SpaceParticipant | null>(null);
  const [reportTarget, setReportTarget] = useState<{ userId: string | null; name: string } | null>(null);
  const [menu, setMenu] = useState(false);
  const [hostLeave, setHostLeave] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [turn, setTurn] = useState(false);
  const [now, setNow] = useState(Date.now());
  const toastAnim = useRef(new Animated.Value(0)).current;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const joined = useRef(false);
  const closed = useRef(false);
  const roleRef = useRef<SpaceRole | null>(null);
  const mutedRef = useRef(true);
  roleRef.current = myRole;
  mutedRef.current = myMuted;

  const showToast = useCallback(
    (text: string) => {
      setToast(text);
      if (toastTimer.current) clearTimeout(toastTimer.current);
      Animated.timing(toastAnim, { toValue: 1, duration: 180, useNativeDriver: true }).start();
      toastTimer.current = setTimeout(() => {
        Animated.timing(toastAnim, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => setToast(null));
      }, 3200);
    },
    [toastAnim]
  );

  /** Ask the OS for the microphone before the engine needs it (speakers only). */
  const ensureMicPermission = useCallback(async () => {
    try {
      const r = await requestRecordingPermissionsAsync();
      if (!r.granted) {
        setMicError('Zenvy needs microphone access for you to speak. You can still listen.');
        return false;
      }
      setMicError(null);
      return true;
    } catch {
      return true; // Let the WebView ask instead.
    }
  }, []);

  const applyRole = useCallback(
    async (role: SpaceRole, muted: boolean) => {
      const was = roleRef.current;
      setMyRole(role);
      roleRef.current = role;
      setMyMuted(muted);
      mutedRef.current = muted;
      engine.current?.send({ cmd: 'role', role, muted });
      // Joining the stage: make sure the OS lets us use the mic, then let the engine retry it.
      if (isOnStage(role) && !isOnStage(was) && (await ensureMicPermission()) && roleRef.current === role) {
        engine.current?.send({ cmd: 'role', role, muted: mutedRef.current });
      }
    },
    [ensureMicPermission]
  );

  const finish = useCallback(
    (next: Phase, reason?: string | null) => {
      if (closed.current) return;
      closed.current = true;
      joined.current = false;
      engine.current?.send({ cmd: 'hangup' });
      setPhase(next);
      if (reason !== undefined) setEndReason(reason);
      setInvite(null);
      setSheet(null);
      spaceBus.emitStale();
    },
    []
  );

  const applyAck = useCallback(
    async (ack: SpaceJoinAck, first: boolean) => {
      joined.current = true;
      setRoom(ack.state);
      setTurn(!!ack.turn);
      const mine = ack.state.participants.find((p) => p.userId === me);
      const muted = mine ? mine.muted : true;
      if (first) {
        // Start right away (the peer plan follows the ack); the mic permission is asked in parallel.
        engine.current?.send({ cmd: 'start', iceServers: ack.iceServers, role: ack.role, muted });
        setMyRole(ack.role);
        roleRef.current = ack.role;
        setMyMuted(muted);
        mutedRef.current = muted;
        if (isOnStage(ack.role) && (await ensureMicPermission()) && roleRef.current === ack.role) {
          engine.current?.send({ cmd: 'role', role: ack.role, muted: mutedRef.current });
        }
      } else {
        engine.current?.send({ cmd: 'ice_servers', iceServers: ack.iceServers });
        await applyRole(ack.role, muted);
      }
      setPeerStates({});
      setPhase('live');
    },
    [me, applyRole, ensureMicPermission]
  );

  const joinErrorToPhase = useCallback(
    (e: any) => {
      const code = e?.code;
      if (code === 'SPACE_REMOVED') finish('removed');
      else if (code === 'SPACE_NOT_LIVE' || code === 'NOT_FOUND') finish('ended', e?.data?.status === 'scheduled' ? null : 'host_ended');
      else {
        setJoinError(e);
        setPhase('error');
      }
      nav.onGateError(e);
    },
    [finish, nav]
  );

  const join = useCallback(async () => {
    setPhase('joining');
    setJoinError(null);
    try {
      const ack = await joinSpaceRoom(spaceId);
      if (closed.current) return;
      await applyAck(ack, !joined.current);
    } catch (e: any) {
      if (!closed.current) joinErrorToPhase(e);
    }
  }, [spaceId, applyAck, joinErrorToPhase]);

  // ── Socket wiring (subscribe before joining so the peer plan after the ack is never missed) ──
  useEffect(() => {
    closed.current = false;
    const offs = [
      onSpaceEvent('space:state', spaceId, (st) => {
        setRoom(st);
        const mine = st.participants.find((p) => p.userId === me);
        if (!mine) return;
        if (mine.role !== roleRef.current) applyRole(mine.role, mine.muted);
        else if (mine.muted !== mutedRef.current) {
          setMyMuted(mine.muted);
          mutedRef.current = mine.muted;
          engine.current?.send({ cmd: 'mute', muted: mine.muted });
        }
        if (!mine.invited) setInvite(null);
      }),
      onSpaceEvent('space:peer_connect', spaceId, (p) => {
        setPeerStates((s) => ({ ...s, [p.peerUserId]: 'connecting' }));
        engine.current?.send({ cmd: 'connect', peer: p.peerUserId, initiator: p.initiator, direction: p.direction });
      }),
      onSpaceEvent('space:peer_close', spaceId, (p) => {
        setPeerStates((s) => {
          const n = { ...s };
          delete n[p.peerUserId];
          return n;
        });
        engine.current?.send({ cmd: 'close', peer: p.peerUserId });
      }),
      onSpaceEvent('space:signal', spaceId, (p) => engine.current?.send({ cmd: 'signal', peer: p.fromUserId, payload: p.payload })),
      onSpaceEvent('space:role', spaceId, (p) => {
        const muted = isOnStage(p.role) ? (p.forced ? true : mutedRef.current) : true;
        const was = roleRef.current;
        applyRole(p.role, muted);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        if (p.role === 'cohost') showToast("You're a co-host now. You can invite, mute and remove people.");
        else if (p.role === 'speaker' && was === 'cohost') showToast('You are a speaker again.');
        else if (p.role === 'speaker') showToast(muted ? "You're on stage. Tap the mic when you're ready to talk." : "You're on stage. Your mic is on.");
        else if (p.role === 'listener' && p.forced) showToast('You were moved to the listeners.');
      }),
      onSpaceEvent('space:invited', spaceId, (p) => {
        setInvite({ byRole: p.byRole });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      }),
      onSpaceEvent('space:muted_by_host', spaceId, () => {
        setMyMuted(true);
        mutedRef.current = true;
        engine.current?.send({ cmd: 'mute', muted: true });
        showToast('The host muted you. Tap the mic to talk again.');
      }),
      onSpaceEvent('space:removed', spaceId, () => finish('removed')),
      onSpaceEvent('space:replaced', spaceId, () => finish('replaced')),
      onSpaceEvent('space:ended', spaceId, (p) => finish('ended', p.reason)),
    ];
    const offConn = keepSpaceJoined(
      spaceId,
      (ack, err) => {
        setSocketDown(false);
        if (closed.current) return;
        if (ack) applyAck(ack, false);
        else if (err) joinErrorToPhase(err);
      },
      () => {
        if (!closed.current) setSocketDown(true);
      }
    );
    join();
    return () => {
      offs.forEach((off) => off());
      offConn();
      // Unmounted while still in the room (sign-out, Friends closed): leave cleanly.
      if (joined.current && !closed.current) {
        leaveSpaceRoom(spaceId).catch(() => {});
        engine.current?.send({ cmd: 'hangup' });
      }
      closed.current = true;
      joined.current = false;
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, [spaceId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Back from the background: nudge audio playback (the WebView may have paused it).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') engine.current?.send({ cmd: 'resume' });
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  // ── Engine messages ──
  const onEngine = useCallback(
    (m: SpaceEngineMessage) => {
      switch (m.type) {
        case 'signal':
          sendSpaceSignal(spaceId, m.peer, m.payload);
          break;
        case 'peer_state':
          setPeerStates((s) => {
            if (m.state === 'closed') {
              if (!(m.peer in s)) return s;
              const n = { ...s };
              delete n[m.peer];
              return n;
            }
            return s[m.peer] === m.state ? s : { ...s, [m.peer]: m.state };
          });
          break;
        case 'speaking':
          setTalking(new Set(m.ids.map((id) => (id === 'me' ? me || 'me' : id))));
          break;
        case 'mic':
          if (!m.ok) {
            setMicError('Zenvy needs microphone access for you to speak. You can still listen.');
            // Be honest with the room: we can't send audio, so show as muted.
            if (isOnStage(roleRef.current) && !mutedRef.current) selfMuteSpace(spaceId, true).catch(() => {});
          } else setMicError(null);
          break;
        case 'reset':
          // The WebView restarted: every connection is gone. Re-join to rebuild them.
          if (joined.current && !closed.current) {
            joinSpaceRoom(spaceId)
              .then((ack) => applyAck(ack, true))
              .catch(joinErrorToPhase);
          }
          break;
        default:
          break;
      }
    },
    [spaceId, me, applyAck, joinErrorToPhase]
  );

  // ── Android back minimizes (the room keeps running) ──
  useEffect(() => {
    if (!visible || !active) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (phase === 'live' || phase === 'joining') onMinimize();
      else onExit();
      return true;
    });
    return () => sub.remove();
  }, [visible, active, phase, onMinimize, onExit]);

  // ── Derived ──
  const participants = room?.participants || [];
  const stage = participants.filter((p) => isOnStage(p.role));
  const hands = participants.filter((p) => p.role === 'listener' && (p.hand || p.invited));
  const audience = participants.filter((p) => p.role === 'listener');
  const mine = participants.find((p) => p.userId === me) || null;
  const amMod = isRoomMod(myRole);
  const onStage = isOnStage(myRole);
  const hasCohost = participants.some((p) => p.role === 'cohost');

  const conn: Conn = useMemo(() => {
    if (socketDown) return 'reconnecting';
    const states = Object.values(peerStates);
    if (states.some((s) => s === 'failed')) return 'failed';
    if (states.some((s) => s === 'new' || s === 'connecting' || s === 'checking')) return 'connecting';
    return 'ok';
  }, [socketDown, peerStates]);

  // ── Actions ──
  const act = async (key: string, fn: () => Promise<any>) => {
    if (busy) return;
    setBusy(key);
    try {
      await fn();
    } catch (e: any) {
      if (e instanceof SpaceSocketError && (e.code === 'NOT_IN_SPACE' || e.code === 'SPACE_NOT_LIVE')) join();
      else Alert.alert("Couldn't do that", spaceErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const toggleMic = () =>
    act('mic', async () => {
      const next = !myMuted;
      if (!next && !(await ensureMicPermission())) {
        Alert.alert('Microphone is off for Zenvy', 'Allow microphone access in Settings to speak in Spaces.', [
          { text: 'Not now', style: 'cancel' },
          { text: 'Open Settings', onPress: () => Linking.openSettings().catch(() => {}) },
        ]);
        return;
      }
      setMyMuted(next);
      mutedRef.current = next;
      // Unmuting retries the mic too (it may have been refused or busy earlier).
      if (!next && myRole) engine.current?.send({ cmd: 'role', role: myRole, muted: false });
      engine.current?.send({ cmd: 'mute', muted: next });
      Haptics.selectionAsync().catch(() => {});
      try {
        const r = await selfMuteSpace(spaceId, next);
        setMyMuted(r.muted);
        mutedRef.current = r.muted;
        engine.current?.send({ cmd: 'mute', muted: r.muted });
      } catch (e) {
        setMyMuted(!next);
        mutedRef.current = !next;
        engine.current?.send({ cmd: 'mute', muted: !next });
        throw e;
      }
    });

  const toggleHand = () =>
    act('hand', async () => {
      const raise = !(mine?.hand || mine?.invited);
      // Ask for the mic before asking to speak (an open stage seats you straight away).
      if (raise) await ensureMicPermission();
      const r = await setSpaceHand(spaceId, raise);
      Haptics.selectionAsync().catch(() => {});
      if (raise && isOnStage(r.role)) showToast('A seat was free, so you are on stage. Tap the mic to talk.');
      else if (raise) showToast(space.participation === 'open' ? 'Stage is full. Your hand is up for the next free seat.' : 'Hand raised. The host will see it.');
    });

  const answerInvite = (accept: boolean) =>
    act('invite', async () => {
      // Ask for the mic first. Joining the stage still works without it (muted; fix it in Settings later).
      if (accept) await ensureMicPermission();
      setInvite(null);
      await respondSpaceInvite(spaceId, accept);
    });

  const leave = () => {
    if (myRole === 'host') {
      setHostLeave(true);
      return;
    }
    act('leave', async () => {
      try {
        await leaveSpaceRoom(spaceId);
      } catch {
        // Leaving locally is enough; the server drops us after its grace period.
      }
      finish('ended', null);
      onExit();
    });
  };

  const hostEnd = () =>
    act('end', async () => {
      await endSpaceRoom(spaceId);
      setHostLeave(false);
      finish('ended', 'host_ended');
    });

  const hostJustLeave = () =>
    act('leave', async () => {
      try {
        await leaveSpaceRoom(spaceId);
      } catch {}
      setHostLeave(false);
      finish('ended', null);
      onExit();
    });

  const retryAudio = () => act('retry', async () => join());

  // ── Rendering ──
  const header = (
    <View style={styles.header}>
      <TouchableOpacity style={styles.iconBtn} onPress={phase === 'live' || phase === 'joining' ? onMinimize : onExit} accessibilityRole="button" accessibilityLabel={phase === 'live' ? 'Minimize the room. Audio keeps playing' : 'Close'}>
        <ChevronDown size={24} color={FriendsColors.ink} />
      </TouchableOpacity>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {phase === 'live' ? <LiveDot size={7} /> : null}
          <Text style={[FT.kicker, phase === 'live' && { color: FriendsColors.danger }]}>{phase === 'live' ? `Live · ${formatLiveFor(space.startedAt, now)}` : 'Space'}</Text>
        </View>
        <Text style={FT.h2} numberOfLines={1} accessibilityRole="header">
          {space.title}
        </Text>
      </View>
      <TouchableOpacity style={styles.iconBtn} onPress={() => setMenu(true)} accessibilityRole="button" accessibilityLabel="Room options">
        <Ellipsis size={20} color={FriendsColors.ink} />
      </TouchableOpacity>
    </View>
  );

  let body: React.ReactNode;
  if (phase === 'ended' || phase === 'removed' || phase === 'replaced') {
    body = (
      <View style={styles.center}>
        <FriendsEmpty
          icon={phase === 'removed' ? <Ban size={22} color={FriendsColors.danger} /> : <Hourglass size={22} color={FriendsColors.accent} />}
          title={phase === 'removed' ? 'You were removed' : phase === 'replaced' ? 'Opened somewhere else' : 'This Space has ended'}
          subtitle={
            phase === 'removed'
              ? "The host removed you from this Space, so you can't rejoin it. If something wasn't right, you can report it."
              : phase === 'replaced'
                ? 'You joined this Space from another screen or device, so audio moved there.'
                : `${endReasonText(endReason || 'host_ended')} Nothing was recorded.`
          }
          actionLabel="Back to Spaces"
          onAction={onExit}
          secondaryLabel={phase === 'removed' ? 'Report this Space' : phase === 'replaced' ? 'Use this screen instead' : undefined}
          onSecondary={
            phase === 'removed'
              ? () => setReportTarget({ userId: null, name: space.title })
              : phase === 'replaced'
                ? () => {
                    closed.current = false;
                    join();
                  }
                : undefined
          }
        />
      </View>
    );
  } else if (phase === 'error') {
    body = (
      <View style={styles.center}>
        <FriendsEmpty
          icon={<WifiOff size={22} color={FriendsColors.warn} />}
          title={joinError?.code === 'ROOM_FULL' ? 'This Space is full' : "Couldn't join"}
          subtitle={spaceErrorMessage(joinError, "Couldn't join the Space. Check your connection and try again.")}
          actionLabel="Try again"
          onAction={join}
          secondaryLabel="Back to Spaces"
          onSecondary={onExit}
        />
      </View>
    );
  } else if (phase === 'joining' && !room) {
    body = (
      <View style={styles.center} accessibilityLiveRegion="polite">
        <ActivityIndicator color={FriendsColors.accent} size="large" />
        <Text style={[FT.muted, { marginTop: FS.md }]}>Joining the Space…</Text>
        <View style={{ marginTop: FS.lg }}>
          <NotRecorded />
        </View>
      </View>
    );
  } else {
    body = (
      <>
        <ScrollView contentContainerStyle={{ paddingBottom: 140 }}>
          <View style={styles.metaRow}>
            <NotRecorded compact />
            <ConnBadge conn={conn} turn={turn} onRetry={retryAudio} />
          </View>
          {space.topic ? <Text style={[FT.small, { paddingHorizontal: FS.lg, color: FriendsColors.accent, fontWeight: '700' }]}>{space.topic}</Text> : null}

          {conn === 'failed' ? (
            <TouchableOpacity style={styles.netWarn} onPress={retryAudio} accessibilityRole="button" accessibilityLabel="Audio couldn't connect on this network. Tap to retry">
              <WifiOff size={16} color={FriendsColors.danger} />
              <Text style={[FT.small, { flex: 1, color: FriendsColors.danger }]}>
                Couldn't connect audio with someone on this network.{turn ? '' : ' Strict campus Wi-Fi can block direct audio; try mobile data.'} Tap to retry.
              </Text>
            </TouchableOpacity>
          ) : null}
          {micError && onStage ? (
            <TouchableOpacity style={styles.netWarn} onPress={() => Linking.openSettings().catch(() => {})} accessibilityRole="button" accessibilityLabel={`${micError} Open Settings`}>
              <MicOff size={16} color={FriendsColors.danger} />
              <Text style={[FT.small, { flex: 1, color: FriendsColors.danger }]}>{micError} Open Settings.</Text>
            </TouchableOpacity>
          ) : null}

          {invite ? (
            <View style={styles.invite} accessibilityRole="alert" accessibilityLiveRegion="assertive">
              <CardGlow tint="rgba(212,175,122,0.12)" />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <UserPlus size={18} color={FriendsColors.accent} />
                <Text style={[FT.h3, { flex: 1 }]}>The {invite.byRole === 'host' ? 'host' : 'co-host'} invited you to speak</Text>
              </View>
              <Text style={[FT.small, { marginTop: 4 }]}>You'll join the stage muted. Turn your mic on when you're ready.</Text>
              <View style={{ flexDirection: 'row', gap: FS.sm, marginTop: FS.md }}>
                <TouchableOpacity style={[fui.ghostBtn, { flex: 1 }]} onPress={() => answerInvite(false)} disabled={!!busy} accessibilityRole="button" accessibilityLabel="Decline the invitation">
                  <Text style={fui.ghostBtnText}>Not now</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[fui.primaryBtn, { flex: 1, minHeight: 44 }]} onPress={() => answerInvite(true)} disabled={!!busy} accessibilityRole="button" accessibilityLabel="Accept and join the stage">
                  {busy === 'invite' ? <ActivityIndicator color={FriendsColors.accentInk} /> : <Mic size={16} color={FriendsColors.accentInk} />}
                  <Text style={fui.primaryBtnText}>Join stage</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}

          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <Text style={FT.kicker}>On stage</Text>
              <Text style={FT.small}>
                {room?.speakerCount ?? stage.length}/{room?.limits.maxSpeakers ?? space.limits.maxSpeakers}
              </Text>
            </View>
            <View style={styles.grid}>
              {stage.map((p) => (
                <StageSeat
                  key={p.userId}
                  name={p.name}
                  avatarUrl={p.avatarUrl}
                  verified={p.verified}
                  role={p.role}
                  muted={p.userId === me ? myMuted : p.muted}
                  mutedByHost={p.mutedByHost}
                  talking={talking.has(p.userId)}
                  connected={p.connected}
                  isMe={p.userId === me}
                  onPress={() => setSheet(p)}
                />
              ))}
            </View>
          </View>

          {amMod && hands.length ? (
            <View style={styles.section}>
              <View style={styles.sectionHead}>
                <Text style={[FT.kicker, { color: FriendsColors.gold }]}>Requests to speak · {hands.length}</Text>
              </View>
              <View style={fui.card}>
                {hands.map((p, i) => (
                  <View key={p.userId} style={[fui.row, i === hands.length - 1 && { borderBottomWidth: 0 }]}>
                    <FriendsAvatar name={p.name} uri={p.avatarUrl} size={36} />
                    <View style={{ flex: 1 }}>
                      <Text style={FT.h3} numberOfLines={1}>
                        {p.name}
                      </Text>
                      <Text style={FT.small}>{p.invited ? 'Invited · waiting for them' : 'Hand raised'}</Text>
                    </View>
                    <TouchableOpacity
                      style={styles.smallGhost}
                      onPress={() => act(`decline:${p.userId}`, () => declineSpaceHand(spaceId, p.userId))}
                      disabled={!!busy}
                      accessibilityRole="button"
                      accessibilityLabel={p.invited ? `Withdraw invitation for ${p.name}` : `Decline ${p.name}'s request`}
                    >
                      <X size={16} color={FriendsColors.muted} />
                    </TouchableOpacity>
                    {!p.invited ? (
                      <TouchableOpacity
                        style={styles.smallPrimary}
                        onPress={() =>
                          act(`invite:${p.userId}`, async () => {
                            await inviteSpaceSpeaker(spaceId, p.userId);
                            showToast(`Invited ${p.name.split(' ')[0]} to speak.`);
                          })
                        }
                        disabled={!!busy}
                        accessibilityRole="button"
                        accessibilityLabel={`Invite ${p.name} to speak`}
                      >
                        {busy === `invite:${p.userId}` ? <ActivityIndicator size="small" color={FriendsColors.accentInk} /> : <Text style={styles.smallPrimaryText}>Invite</Text>}
                      </TouchableOpacity>
                    ) : null}
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <Text style={FT.kicker}>Listening</Text>
              <Text style={FT.small}>
                {plural(room?.listenerCount ?? audience.length, 'listener')} · max {room?.limits.maxListeners ?? space.limits.maxListeners}
              </Text>
            </View>
            {audience.length ? (
              <View style={styles.grid}>
                {audience.map((p) => (
                  <AudienceSeat
                    key={p.userId}
                    name={p.name}
                    avatarUrl={p.avatarUrl}
                    verified={p.verified}
                    hand={p.hand}
                    invited={p.invited}
                    connected={p.connected}
                    isMe={p.userId === me}
                    onPress={() => setSheet(p)}
                  />
                ))}
              </View>
            ) : (
              <View style={styles.emptyAud}>
                <Headphones size={16} color={FriendsColors.faint} />
                <Text style={[FT.small, { flex: 1 }]}>No listeners yet. Share the Space so people can find it.</Text>
              </View>
            )}
          </View>
        </ScrollView>

        {/* ── Control bar ── */}
        <View style={styles.bar}>
          <TouchableOpacity style={styles.leave} onPress={leave} disabled={!!busy} accessibilityRole="button" accessibilityLabel={myRole === 'host' ? 'Leave or end your Space' : 'Leave quietly'}>
            {busy === 'leave' ? <ActivityIndicator size="small" color={FriendsColors.danger} /> : <LogOut size={18} color={FriendsColors.danger} />}
            <Text style={styles.leaveText}>{myRole === 'host' ? 'End' : 'Leave'}</Text>
          </TouchableOpacity>
          <View style={{ flex: 1 }} />
          {amMod && hands.length ? (
            <View style={styles.handCount} accessible accessibilityLabel={`${hands.length} requests to speak`}>
              <Hand size={14} color={FriendsColors.gold} />
              <Text style={[FT.small, { color: FriendsColors.gold, fontWeight: '800' }]}>{hands.length}</Text>
            </View>
          ) : null}
          {onStage ? (
            <TouchableOpacity
              style={[styles.mic, !myMuted && styles.micOn]}
              onPress={toggleMic}
              disabled={busy === 'mic'}
              accessibilityRole="button"
              accessibilityState={{ checked: !myMuted }}
              accessibilityLabel={myMuted ? (mine?.mutedByHost ? 'Muted by the host. Tap to unmute' : 'Microphone off. Tap to talk') : 'Microphone on. Tap to mute'}
            >
              {!myMuted ? <BrandFill radius={30} /> : null}
              {myMuted ? <MicOff size={24} color={FriendsColors.ink} /> : <Mic size={24} color={FriendsColors.accentInk} />}
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.handBtn, (mine?.hand || mine?.invited) && styles.handOn]}
              onPress={toggleHand}
              disabled={busy === 'hand' || !!mine?.invited}
              accessibilityRole="button"
              accessibilityState={{ selected: !!mine?.hand }}
              accessibilityLabel={mine?.invited ? 'You were invited to speak' : mine?.hand ? 'Hand raised. Tap to lower it' : space.participation === 'open' ? 'Raise hand to take a free seat' : 'Raise hand to ask to speak'}
            >
              {busy === 'hand' ? <ActivityIndicator size="small" color={FriendsColors.accentInk} /> : <Hand size={20} color={mine?.hand ? FriendsColors.accentInk : FriendsColors.ink} />}
              <Text style={[styles.handText, mine?.hand && { color: FriendsColors.accentInk }]}>{mine?.invited ? 'Invited' : mine?.hand ? 'Hand up' : 'Raise hand'}</Text>
            </TouchableOpacity>
          )}
        </View>
      </>
    );
  }

  const hostId = hostUserId(space.host);

  return (
    <View style={[styles.root, !visible && styles.hidden]} pointerEvents={visible ? 'auto' : 'none'} importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'} accessibilityElementsHidden={!visible}>
      <SpaceAudioEngine ref={engine} onMessage={onEngine} />
      {header}
      {body}

      {toast ? (
        <Animated.View style={[styles.toast, { opacity: toastAnim, transform: [{ translateY: toastAnim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }]} pointerEvents="none">
          <Text style={styles.toastText} accessibilityLiveRegion="polite">
            {toast}
          </Text>
        </Animated.View>
      ) : null}

      <ParticipantSheet
        spaceId={spaceId}
        target={sheet}
        me={me}
        myRole={myRole}
        onClose={() => setSheet(null)}
        onReport={(p) => {
          setSheet(null);
          setTimeout(() => setReportTarget({ userId: p.userId, name: p.name }), 450);
        }}
        onToast={showToast}
        onBlocked={(p) => {
          nav.onBlocked(p.userId);
          if (p.role === 'host') {
            leaveSpaceRoom(spaceId).catch(() => {});
            finish('ended', null);
            onExit();
          }
        }}
      />
      <SpaceReportSheet spaceId={spaceId} target={reportTarget} onClose={() => setReportTarget(null)} />
      <HostLeaveSheet visible={hostLeave} hasCohost={hasCohost} busy={busy} onEnd={hostEnd} onLeave={hostJustLeave} onClose={() => setHostLeave(false)} />
      <ActionMenu
        visible={menu}
        onClose={() => setMenu(false)}
        title={space.title}
        copyLink={spaceLink(space.id)}
        extra={
          !space.isHost && phase === 'live'
            ? [
                {
                  key: 'report-space',
                  label: 'Report this Space',
                  icon: <Radio size={18} color={FriendsColors.danger} />,
                  destructive: true,
                  onPress: () => {
                    setMenu(false);
                    setTimeout(() => setReportTarget({ userId: null, name: space.title }), 450);
                  },
                },
              ]
            : []
        }
        report={!space.isHost && phase !== 'live' ? { type: 'space', id: space.id, label: `the Space "${space.title.slice(0, 40)}"` } : null}
        block={!space.isHost && hostId && phase !== 'live' ? { userId: hostId, name: hostName(space.host) } : null}
        onBlocked={(uid) => nav.onBlocked(uid)}
      />
    </View>
  );
};

const ConnBadge: React.FC<{ conn: Conn; turn: boolean; onRetry: () => void }> = ({ conn, onRetry }) => {
  const map: Record<Conn, { text: string; color: string; icon: React.ReactNode }> = {
    ok: { text: 'Connected', color: FriendsColors.success, icon: <Wifi size={12} color={FriendsColors.success} /> },
    connecting: { text: 'Connecting audio…', color: FriendsColors.muted, icon: <ActivityIndicator size="small" color={FriendsColors.muted} style={{ transform: [{ scale: 0.6 }] }} /> },
    reconnecting: { text: 'Reconnecting…', color: FriendsColors.warn, icon: <RotateCcw size={12} color={FriendsColors.warn} /> },
    failed: { text: 'Audio issue · Retry', color: FriendsColors.danger, icon: <WifiOff size={12} color={FriendsColors.danger} /> },
  };
  const m = map[conn];
  return (
    <TouchableOpacity
      style={[styles.conn, { borderColor: m.color }]}
      onPress={conn === 'failed' ? onRetry : undefined}
      disabled={conn !== 'failed'}
      accessibilityRole={conn === 'failed' ? 'button' : 'text'}
      accessibilityLabel={`Connection: ${m.text}`}
      accessibilityLiveRegion="polite"
    >
      {m.icon}
      <Text style={[styles.connText, { color: m.color }]}>{m.text}</Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  root: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: FriendsColors.bg, zIndex: 20 },
  hidden: { opacity: 0, zIndex: -1, transform: [{ translateY: 4000 }] },
  header: { flexDirection: 'row', alignItems: 'center', gap: FS.sm, paddingHorizontal: FS.sm, paddingVertical: FS.sm, minHeight: 56, borderBottomWidth: StyleSheet.hairlineWidth * 2, borderBottomColor: SectionTints.spaces.line },
  iconBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: FS.lg },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: FS.sm, paddingHorizontal: FS.lg, paddingTop: FS.md, paddingBottom: FS.sm },
  conn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, minHeight: 28, borderRadius: FR.pill, borderWidth: 1 },
  connText: { fontSize: 12, fontWeight: '800' },
  netWarn: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: FS.lg, marginTop: FS.sm, padding: FS.md, borderRadius: FR.md, backgroundColor: FriendsColors.dangerSoft },
  invite: { marginHorizontal: FS.lg, marginTop: FS.md, padding: FS.lg, borderRadius: FR.card, backgroundColor: FriendsColors.cardHi, borderWidth: 1, borderColor: FriendsColors.accentLine },
  section: { marginTop: FS.lg, paddingHorizontal: FS.lg },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: FS.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  emptyAud: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: FS.md, borderRadius: FR.md, backgroundColor: FriendsColors.card, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: FriendsColors.lineSoft },
  smallGhost: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: FriendsColors.line, alignItems: 'center', justifyContent: 'center' },
  smallPrimary: { minWidth: 72, height: 44, borderRadius: FR.pill, backgroundColor: FriendsColors.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  smallPrimaryText: { fontSize: 13, fontWeight: '800', color: FriendsColors.accentInk },
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: FS.md,
    paddingHorizontal: FS.lg,
    paddingTop: FS.md,
    paddingBottom: FS.xl,
    backgroundColor: FriendsColors.overlaySurface,
    borderTopWidth: StyleSheet.hairlineWidth * 2,
    borderTopColor: FriendsColors.lineStrong,
    borderTopLeftRadius: FR.sheet,
    borderTopRightRadius: FR.sheet,
  },
  leave: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 48, paddingHorizontal: 16, borderRadius: FR.pill, borderWidth: 1, borderColor: 'rgba(243,139,128,0.45)', backgroundColor: FriendsColors.dangerSoft },
  leaveText: { fontSize: 14, fontWeight: '800', color: FriendsColors.danger },
  handCount: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, minHeight: 32, borderRadius: FR.pill, backgroundColor: FriendsColors.goldSoft },
  mic: { width: 60, height: 60, borderRadius: 30, backgroundColor: FriendsColors.cardHi, borderWidth: 1, borderColor: FriendsColors.line, alignItems: 'center', justifyContent: 'center' },
  micOn: { backgroundColor: FriendsColors.accent, borderColor: FriendsColors.accent },
  handBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 52, paddingHorizontal: 20, borderRadius: FR.pill, backgroundColor: FriendsColors.cardHi, borderWidth: 1, borderColor: FriendsColors.line },
  handOn: { backgroundColor: FriendsColors.gold, borderColor: FriendsColors.gold },
  handText: { fontSize: 14, fontWeight: '800', color: FriendsColors.ink },
  toast: { position: 'absolute', left: FS.lg, right: FS.lg, bottom: 112, padding: FS.md, borderRadius: FR.pill, backgroundColor: FriendsColors.overlaySurface, borderWidth: 1, borderColor: FriendsColors.lineStrong, shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 8 },
  toastText: { fontSize: 13, fontWeight: '600', color: FriendsColors.ink, textAlign: 'center' },
});
