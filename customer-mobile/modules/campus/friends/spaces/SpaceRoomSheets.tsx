import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet, Alert } from 'react-native';
import { Flag, Ban, MicOff, UserPlus, UserMinus, Shield, ShieldOff, Hand, LogOut, Check, Circle, CircleCheck, ArrowDownToLine } from '../../../../components/lucide';
import * as Haptics from 'expo-haptics';
import { FriendsSheet } from '../shared/FriendsSheet';
import { FriendsAvatar } from '../shared/FriendsAvatar';
import { FriendsColors, FS, FR, FT, fui } from '../friendsTheme';
import { REPORT_CATEGORIES, REPORT_NOTE_MAX, ReportCategory } from '../api/modApi';
import { spaceErrorMessage, SpaceRole } from '../api/spacesApi';
import { blockCampusUser } from '../../campusApi';
import {
  SpaceParticipant,
  declineSpaceHand,
  inviteSpaceSpeaker,
  muteSpaceMember,
  removeSpaceMember,
  reportInSpace,
  setSpaceHand,
  setSpaceRole,
} from './spacesSocket';
import { ROLE_LABEL, isOnStage, isRoomMod } from './spacesShared';

import { themedSheet } from '../../../../utils/themeNow';
/** Host can act on anyone but the host; a co-host only on speakers and listeners (server rule, mirrored for the UI). */
const canActOn = (actor: SpaceRole | null, target: SpaceRole) => {
  if (target === 'host' || !actor) return false;
  if (actor === 'host') return true;
  return actor === 'cohost' && (target === 'speaker' || target === 'listener');
};

interface Row {
  key: string;
  label: string;
  hint?: string;
  icon: React.ReactNode;
  destructive?: boolean;
  run: () => Promise<void> | void;
  confirm?: { title: string; body: string; ok: string };
}

/**
 * Options for one person in the room. Host / co-host controls (invite to speak, decline a hand,
 * mute, move to listeners, co-host, remove) appear only when the server rules allow them;
 * everyone can report or block someone else. The server re-checks every action.
 */
export const ParticipantSheet: React.FC<{
  spaceId: string;
  target: SpaceParticipant | null;
  me: string | null;
  myRole: SpaceRole | null;
  onClose: () => void;
  onReport: (p: SpaceParticipant) => void;
  onToast: (text: string) => void;
  onBlocked: (p: SpaceParticipant) => void;
}> = ({ spaceId, target, me, myRole, onClose, onReport, onToast, onBlocked }) => {
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => setBusy(null), [target?.userId]);
  if (!target) return <FriendsSheet visible={false} onClose={onClose} title="">{null}</FriendsSheet>;

  const isMe = !!me && target.userId === me;
  const rows: Row[] = [];
  const mod = isRoomMod(myRole) && !isMe && canActOn(myRole, target.role);

  if (isMe) {
    if (target.role === 'listener' && (target.hand || target.invited)) {
      rows.push({ key: 'lower', label: 'Lower my hand', icon: <Hand size={18} color={FriendsColors.ink} />, run: async () => void (await setSpaceHand(spaceId, false)) });
    }
    if (target.role === 'speaker' || target.role === 'cohost') {
      rows.push({
        key: 'stepdown',
        label: 'Move to listeners',
        hint: 'Your mic turns off. You can raise your hand again later.',
        icon: <ArrowDownToLine size={18} color={FriendsColors.ink} />,
        run: async () => {
          await setSpaceRole(spaceId, target.userId, 'listener');
          onToast('You moved to the listeners.');
        },
      });
    }
  }

  if (mod) {
    if (target.role === 'listener') {
      if (!target.invited) {
        rows.push({
          key: 'invite',
          label: 'Invite to speak',
          hint: 'They choose whether to come on stage.',
          icon: <UserPlus size={18} color={FriendsColors.accent} />,
          run: async () => {
            await inviteSpaceSpeaker(spaceId, target.userId);
            onToast(`Invited ${target.name.split(' ')[0]} to speak.`);
          },
        });
      }
      if (target.hand || target.invited) {
        rows.push({
          key: 'decline',
          label: target.invited ? 'Withdraw invitation' : 'Decline request to speak',
          icon: <Hand size={18} color={FriendsColors.ink} />,
          run: async () => void (await declineSpaceHand(spaceId, target.userId)),
        });
      }
    } else {
      if (!target.muted) {
        rows.push({
          key: 'mute',
          label: 'Mute',
          hint: 'They stay muted until they unmute themselves.',
          icon: <MicOff size={18} color={FriendsColors.ink} />,
          run: async () => {
            await muteSpaceMember(spaceId, target.userId);
            onToast(`${target.name.split(' ')[0]} is muted.`);
          },
        });
      }
      if (myRole === 'host' && target.role === 'speaker') {
        rows.push({ key: 'cohost', label: 'Make co-host', hint: 'Co-hosts can invite, mute and remove people.', icon: <Shield size={18} color={FriendsColors.accent} />, run: async () => void (await setSpaceRole(spaceId, target.userId, 'cohost')) });
      }
      if (myRole === 'host' && target.role === 'cohost') {
        rows.push({ key: 'uncohost', label: 'Remove co-host role', icon: <ShieldOff size={18} color={FriendsColors.ink} />, run: async () => void (await setSpaceRole(spaceId, target.userId, 'speaker')) });
      }
      rows.push({ key: 'demote', label: 'Move to listeners', icon: <ArrowDownToLine size={18} color={FriendsColors.ink} />, run: async () => void (await setSpaceRole(spaceId, target.userId, 'listener')) });
    }
    rows.push({
      key: 'remove',
      label: 'Remove from Space',
      hint: "They can't rejoin this Space.",
      icon: <UserMinus size={18} color={FriendsColors.danger} />,
      destructive: true,
      confirm: { title: `Remove ${target.name.split(' ')[0]}?`, body: "They'll be disconnected and can't rejoin this Space.", ok: 'Remove' },
      run: async () => {
        await removeSpaceMember(spaceId, target.userId);
        onToast(`${target.name.split(' ')[0]} was removed.`);
      },
    });
  }

  if (!isMe) {
    rows.push({ key: 'report', label: 'Report', icon: <Flag size={18} color={FriendsColors.danger} />, destructive: true, run: () => onReport(target) });
    rows.push({
      key: 'block',
      label: `Block ${target.name.split(' ')[0]}`,
      hint: target.role === 'host' ? 'You will leave this Space and stop seeing their Spaces.' : 'You stop seeing their content. They are not told.',
      icon: <Ban size={18} color={FriendsColors.danger} />,
      destructive: true,
      confirm: {
        title: `Block ${target.name}?`,
        body: "They won't be able to message or call you, and you won't see each other's posts in Friends. They aren't told.",
        ok: 'Block',
      },
      run: async () => {
        await blockCampusUser(target.userId);
        onToast(`${target.name.split(' ')[0]} is blocked.`);
        onBlocked(target);
      },
    });
  }

  const exec = (r: Row) => {
    const go = async () => {
      if (busy) return;
      setBusy(r.key);
      try {
        await r.run();
        Haptics.selectionAsync().catch(() => {});
        onClose();
      } catch (e: any) {
        Alert.alert("Couldn't do that", spaceErrorMessage(e));
      } finally {
        setBusy(null);
      }
    };
    if (r.confirm) {
      Alert.alert(r.confirm.title, r.confirm.body, [
        { text: 'Cancel', style: 'cancel' },
        { text: r.confirm.ok, style: 'destructive', onPress: go },
      ]);
    } else go();
  };

  const status = !target.connected
    ? 'Reconnecting…'
    : isOnStage(target.role)
      ? target.muted
        ? target.mutedByHost
          ? 'Muted by the host'
          : 'Muted'
        : 'Mic on'
      : target.invited
        ? 'Invited to speak'
        : target.hand
          ? 'Hand raised'
          : 'Listening';

  return (
    <FriendsSheet visible={!!target} onClose={onClose} title={isMe ? 'You' : target.name} subtitle={`${ROLE_LABEL[target.role]} · ${status}`} icon={<FriendsAvatar name={target.name} uri={target.avatarUrl} size={36} />}>
      <View style={fui.card}>
        {rows.map((r, i) => (
          <TouchableOpacity
            key={r.key}
            style={[fui.row, i === rows.length - 1 && { borderBottomWidth: 0 }]}
            onPress={() => exec(r)}
            disabled={!!busy}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel={r.hint ? `${r.label}. ${r.hint}` : r.label}
          >
            {busy === r.key ? <ActivityIndicator size="small" color={FriendsColors.muted} /> : r.icon}
            <View style={{ flex: 1 }}>
              <Text style={[FT.h3, r.destructive && { color: FriendsColors.danger }]}>{r.label}</Text>
              {r.hint ? <Text style={FT.small}>{r.hint}</Text> : null}
            </View>
          </TouchableOpacity>
        ))}
        {!rows.length ? (
          <View style={[fui.row, { borderBottomWidth: 0 }]}>
            <Text style={FT.muted}>{isMe && target.role === 'host' ? 'You are hosting. Use the controls below to end or leave.' : 'No actions available.'}</Text>
          </View>
        ) : null}
      </View>
      <TouchableOpacity style={[fui.ghostBtn, { marginTop: FS.md }]} onPress={onClose} accessibilityRole="button">
        <Text style={fui.ghostBtnText}>Close</Text>
      </TouchableOpacity>
    </FriendsSheet>
  );
};

/**
 * Report from inside the room (a person, or the Space itself). Sent over the room connection so
 * moderators see which Space it happened in. Reports are reviewed by people.
 */
export const SpaceReportSheet: React.FC<{
  spaceId: string;
  target: { userId: string | null; name: string } | null;
  onClose: () => void;
}> = ({ spaceId, target, onClose }) => {
  const [category, setCategory] = useState<ReportCategory | null>(null);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<null | { duplicate: boolean }>(null);

  useEffect(() => {
    if (!target) return;
    setCategory(null);
    setNote('');
    setError(null);
    setDone(null);
    setSending(false);
  }, [target]);

  const submit = async () => {
    if (!target || !category || sending) return;
    if (category === 'other' && !note.trim()) {
      setError('Please tell us briefly what is wrong.');
      return;
    }
    setSending(true);
    setError(null);
    try {
      const r = await reportInSpace(spaceId, { userId: target.userId, category, note: note.trim() || undefined });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setDone({ duplicate: !!r.duplicate });
    } catch (e: any) {
      setError(spaceErrorMessage(e, "Couldn't send the report. Please try again."));
    } finally {
      setSending(false);
    }
  };

  return (
    <FriendsSheet
      visible={!!target}
      onClose={onClose}
      title={target?.userId ? `Report ${target.name}` : 'Report this Space'}
      subtitle="Reviewed by people. Reporting doesn't remove anyone by itself."
      icon={<Flag size={18} color={FriendsColors.danger} />}
      footer={
        done ? null : (
          <TouchableOpacity
            style={[fui.primaryBtn, { marginTop: FS.md }, (!category || sending) && { opacity: 0.5 }]}
            onPress={submit}
            disabled={!category || sending}
            accessibilityRole="button"
            accessibilityLabel="Send report"
          >
            {sending ? <ActivityIndicator color={FriendsColors.accentInk} /> : <Text style={fui.primaryBtnText}>Send report</Text>}
          </TouchableOpacity>
        )
      }
    >
      {done ? (
        <View style={{ alignItems: 'center', paddingVertical: FS.xl }} accessibilityLiveRegion="polite">
          <View style={styles.doneIcon}>
            <Check size={22} color={FriendsColors.accentInk} />
          </View>
          <Text style={[FT.h3, { marginTop: FS.md }]}>{done.duplicate ? 'Already reported' : 'Thanks for telling us'}</Text>
          <Text style={[FT.muted, { textAlign: 'center', marginTop: 6 }]}>
            Our team will review it. You'll find the outcome in Me › Friends privacy & safety. If someone is in danger, call 112.
          </Text>
          <TouchableOpacity style={[fui.ghostBtn, { marginTop: FS.lg, alignSelf: 'stretch' }]} onPress={onClose} accessibilityRole="button">
            <Text style={fui.ghostBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View>
          <View accessibilityRole="radiogroup" accessibilityLabel="What's wrong">
            {REPORT_CATEGORIES.map((c) => {
              const on = category === c.key;
              return (
                <TouchableOpacity
                  key={c.key}
                  style={[styles.cat, on && styles.catOn]}
                  onPress={() => setCategory(c.key)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={`${c.label}. ${c.hint}`}
                >
                  {on ? <CircleCheck size={18} color={FriendsColors.accent} /> : <Circle size={18} color={FriendsColors.faint} />}
                  <View style={{ flex: 1 }}>
                    <Text style={FT.h3}>{c.label}</Text>
                    <Text style={FT.small}>{c.hint}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
          <TextInput
            style={[fui.input, { marginTop: FS.md, minHeight: 70, textAlignVertical: 'top' }]}
            value={note}
            onChangeText={(t) => setNote(t.slice(0, REPORT_NOTE_MAX))}
            placeholder={category === 'other' ? 'What happened? (required)' : 'Anything else? (optional)'}
            placeholderTextColor={FriendsColors.faint}
            multiline
            maxLength={REPORT_NOTE_MAX}
            accessibilityLabel="Report details"
          />
          {error ? (
            <Text style={[FT.small, { color: FriendsColors.danger, marginTop: 6 }]} accessibilityRole="alert">
              {error}
            </Text>
          ) : null}
        </View>
      )}
    </FriendsSheet>
  );
};

/** Host leaving: end for everyone, or step out (the room ends after ~2 min unless a co-host is there). */
export const HostLeaveSheet: React.FC<{
  visible: boolean;
  hasCohost: boolean;
  busy: string | null;
  onEnd: () => void;
  onLeave: () => void;
  onClose: () => void;
}> = ({ visible, hasCohost, busy, onEnd, onLeave, onClose }) => (
  <FriendsSheet visible={visible} onClose={onClose} title="Leave your Space?" icon={<LogOut size={18} color={FriendsColors.danger} />}>
    <TouchableOpacity style={[fui.primaryBtn, { backgroundColor: FriendsColors.danger }]} onPress={onEnd} disabled={!!busy} accessibilityRole="button" accessibilityLabel="End the Space for everyone">
      {busy === 'end' ? <ActivityIndicator color={FriendsColors.accentInk} /> : null}
      <Text style={fui.primaryBtnText}>End for everyone</Text>
    </TouchableOpacity>
    <TouchableOpacity style={[fui.ghostBtn, { marginTop: FS.sm }]} onPress={onLeave} disabled={!!busy} accessibilityRole="button" accessibilityLabel="Leave and keep the Space running">
      {busy === 'leave' ? <ActivityIndicator size="small" color={FriendsColors.ink} /> : null}
      <Text style={fui.ghostBtnText}>Just leave</Text>
    </TouchableOpacity>
    <Text style={[FT.small, { marginTop: FS.sm, textAlign: 'center' }]}>
      {hasCohost ? 'A co-host keeps the Space running while you are away.' : 'Without a co-host, the Space ends about 2 minutes after you leave unless you come back.'}
    </Text>
    <TouchableOpacity style={[fui.ghostBtn, { marginTop: FS.md, borderWidth: 0 }]} onPress={onClose} accessibilityRole="button">
      <Text style={[fui.ghostBtnText, { color: FriendsColors.muted }]}>Stay</Text>
    </TouchableOpacity>
  </FriendsSheet>
);

const styles = themedSheet(() => ({
  cat: { flexDirection: 'row', alignItems: 'center', gap: FS.md, paddingVertical: 10, paddingHorizontal: FS.sm, borderRadius: FR.md, minHeight: 48 },
  catOn: { backgroundColor: FriendsColors.accentSoft },
  doneIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: FriendsColors.accent, alignItems: 'center', justifyContent: 'center' },
}));
