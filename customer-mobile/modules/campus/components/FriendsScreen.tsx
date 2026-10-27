import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, RefreshControl, Alert, Share } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { UserPlus, Copy, Share2, Users, MoreVertical, Inbox } from '../../../components/lucide';
import * as Haptics from 'expo-haptics';
import { CampusColors } from '../../../constants/campusTheme';
import {
  fetchFriends,
  fetchBlockedUsers,
  acceptFriendRequest,
  declineFriendRequest,
  cancelFriendRequest,
  removeFriend,
  blockCampusUser,
  unblockCampusUser,
  openCampusDm,
  sendFriendRequest,
  FriendItem,
  BlockedItem,
} from '../campusApi';
import { FriendRequestsState } from '../useFriendRequests';
import { ScreenModal, Sheet, Avatar, ListRow, EmptyState, ErrorState, SkeletonRows, SectionTitle, Button, T, S, R, ui } from '../ui';

// ── Add friend by code ──────────────────────────────────────────────────────
export const AddFriendSheet: React.FC<{
  visible: boolean;
  onClose: () => void;
  myCode?: string | null;
  onDone?: () => void;
}> = ({ visible, onClose, myCode, onDone }) => {
  const [code, setCode] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [incomingId, setIncomingId] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setCode('');
      setNote('');
      setError(null);
      setIncomingId(null);
    }
  }, [visible]);

  const submit = async () => {
    if (busy) return;
    setError(null);
    // Accept "ZNV-AB12C", "znv ab12c" or a shared link ending in code=...
    const raw = code.trim();
    const fromLink = raw.match(/code=([A-Za-z0-9_-]+)/i);
    const clean = (fromLink ? fromLink[1] : raw).replace(/\s+/g, '').toUpperCase();
    if (clean.length < 4) {
      setError('Enter the friend code shown on their ZCS profile.');
      return;
    }
    if (myCode && clean === String(myCode).toUpperCase()) {
      setError("That's your own code. Ask your friend for theirs.");
      return;
    }
    setBusy(true);
    try {
      await sendFriendRequest({ friendCode: clean, icebreaker: note.trim() || undefined });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onDone?.();
      onClose();
      Alert.alert('Request sent', "We'll let you know when they accept.");
    } catch (e: any) {
      if (e?.code === 'REQUEST_INCOMING' && e?.data?.friendshipId) {
        setIncomingId(e.data.friendshipId);
        setError('They already sent you a request.');
      } else {
        setError(e?.message || "Couldn't send the request. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  };

  const acceptIncoming = async () => {
    if (!incomingId) return;
    setBusy(true);
    try {
      await acceptFriendRequest(incomingId);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onDone?.();
      onClose();
      Alert.alert("You're friends now", 'Say hi in Chats.');
    } catch (e: any) {
      setError(e?.message || "Couldn't accept. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Add a friend" icon={<UserPlus size={20} color={CampusColors.accent} />}>
      <Text style={T.body}>Ask your friend for the friend code on their ZCS profile (Campus › Me).</Text>
      {error && (
        <View style={[ui.errorBox, { marginTop: S.md }]}>
          <Text style={ui.errorText}>{error}</Text>
        </View>
      )}
      <Text style={ui.label}>Friend code</Text>
      <TextInput
        style={[ui.input, { fontWeight: '800', letterSpacing: 1.5 }]}
        value={code}
        onChangeText={setCode}
        placeholder="e.g. ZNV-AB12C"
        placeholderTextColor={CampusColors.muted}
        autoCapitalize="characters"
        autoCorrect={false}
        autoFocus
        maxLength={80}
        editable={!busy}
      />
      <Text style={ui.label}>Say something (optional)</Text>
      <TextInput
        style={ui.input}
        value={note}
        onChangeText={setNote}
        placeholder="Hey, it's me from CSE-B!"
        placeholderTextColor={CampusColors.muted}
        maxLength={120}
        editable={!busy}
      />
      {incomingId ? (
        <Button label="Accept their request" onPress={acceptIncoming} loading={busy} style={{ marginTop: S.xl }} />
      ) : (
        <Button label="Send request" onPress={submit} loading={busy} style={{ marginTop: S.xl }} />
      )}
    </Sheet>
  );
};

// ── Friends page ────────────────────────────────────────────────────────────
interface FriendsScreenProps {
  visible: boolean;
  onClose: () => void;
  myCode?: string | null;
  myName?: string | null;
  requests: FriendRequestsState;
  onOpenChat: (chatId: string, name: string) => void;
}

export const FriendsScreen: React.FC<FriendsScreenProps> = ({ visible, onClose, myCode, myName, requests, onOpenChat }) => {
  // Rendered inside this page's Modal so iOS can present it on top.
  const [addOpen, setAddOpen] = useState(false);
  const onAddFriend = () => setAddOpen(true);
  const [friends, setFriends] = useState<FriendItem[]>([]);
  const [blocked, setBlocked] = useState<BlockedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    const [f, b] = await Promise.allSettled([fetchFriends(), fetchBlockedUsers()]);
    if (!mounted.current) return;
    if (f.status === 'fulfilled') {
      setFriends(f.value);
      setError(null);
    } else {
      setError((f.reason as any)?.message || "Couldn't load your friends.");
    }
    if (b.status === 'fulfilled') setBlocked(b.value);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (visible) {
      setLoading(friends.length === 0);
      load();
      requests.reload();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // A request accepted elsewhere (or by them) should show up in the list.
  const acceptedSeen = useRef(requests.outgoing.length);
  useEffect(() => {
    if (visible && requests.outgoing.length < acceptedSeen.current) load();
    acceptedSeen.current = requests.outgoing.length;
  }, [requests.outgoing.length, visible, load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([load(), requests.reload()]);
    if (mounted.current) setRefreshing(false);
  };

  const run = async (id: string, fn: () => Promise<any>, after?: () => void) => {
    if (busyId) return;
    setBusyId(id);
    try {
      await fn();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      after?.();
    } catch (e: any) {
      Alert.alert('Something went wrong', e?.message || 'Please try again.');
    } finally {
      if (mounted.current) setBusyId(null);
    }
  };

  const accept = (id: string) =>
    run(id, () => acceptFriendRequest(id), () => {
      requests.setIncoming((prev) => prev.filter((r) => r.friendshipId !== id));
      load();
    });
  const decline = (id: string) =>
    run(id, () => declineFriendRequest(id), () => requests.setIncoming((prev) => prev.filter((r) => r.friendshipId !== id)));
  const withdraw = (id: string) =>
    run(id, () => cancelFriendRequest(id), () => requests.setOutgoing((prev) => prev.filter((r) => r.friendshipId !== id)));

  const message = (f: FriendItem) =>
    run(f.friendshipId, async () => {
      const { chatId, name } = await openCampusDm(f.friendId);
      onOpenChat(chatId, f.name || name);
    });

  const friendMenu = (f: FriendItem) => {
    Alert.alert(f.name, undefined, [
      { text: 'Message', onPress: () => message(f) },
      {
        text: 'Remove friend',
        style: 'destructive',
        onPress: () =>
          Alert.alert('Remove friend?', `${f.name} won't be notified.`, [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Remove',
              style: 'destructive',
              onPress: () => run(f.friendshipId, () => removeFriend(f.friendshipId), () => setFriends((p) => p.filter((x) => x.friendshipId !== f.friendshipId))),
            },
          ]),
      },
      {
        text: 'Block',
        style: 'destructive',
        onPress: () =>
          Alert.alert(`Block ${f.name}?`, 'They will not be able to message you or send requests.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Block', style: 'destructive', onPress: () => run(f.friendshipId, () => blockCampusUser(f.friendId), load) },
          ]),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const copyCode = () => {
    if (!myCode) return;
    Clipboard.setString(myCode);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert('Copied', 'Your friend code is copied. Paste it in a chat to share.');
  };
  const shareCode = () => {
    if (!myCode) return;
    Share.share({
      message: `Add me on ZCS Campus${myName ? ` (${myName})` : ''}! My friend code is ${myCode}. Open ZCS > Campus > Me > Friends > Add friend.`,
    }).catch(() => {});
  };

  const { incoming, outgoing } = requests;

  return (
    <ScreenModal
      visible={visible}
      onClose={onClose}
      title="Your friends"
      subtitle={friends.length ? `${friends.length} friend${friends.length === 1 ? '' : 's'}` : undefined}
      right={
        <TouchableOpacity onPress={onAddFriend} style={ui.iconBtn} accessibilityLabel="Add friend">
          <UserPlus size={22} color={CampusColors.accent} />
        </TouchableOpacity>
      }
    >
      <ScrollView
        contentContainerStyle={{ padding: S.lg, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={CampusColors.accent} />}
      >
        {/* My code */}
        <View style={styles.codeCard}>
          <Text style={[T.kicker, { color: CampusColors.inkMuted }]}>Your friend code</Text>
          <Text style={styles.code}>{myCode || 'Not available'}</Text>
          <Text style={[T.small, { color: CampusColors.inkMuted }]}>Share it so classmates can add you.</Text>
          <View style={{ flexDirection: 'row', gap: S.sm, marginTop: S.md }}>
            <Button small label="Copy" variant="secondary" onPress={copyCode} disabled={!myCode} icon={<Copy size={14} color={CampusColors.ink} />} style={{ flex: 1 }} />
            <Button small label="Share" onPress={shareCode} disabled={!myCode} icon={<Share2 size={14} color="#FFFFFF" />} style={{ flex: 1 }} />
          </View>
        </View>

        <Button label="Add a friend by code" variant="secondary" onPress={onAddFriend} icon={<UserPlus size={16} color={CampusColors.ink} />} style={{ marginTop: S.md }} />

        {/* Requests */}
        {incoming.length > 0 && (
          <>
            <SectionTitle title={`Requests (${incoming.length})`} />
            <View style={ui.card}>
              {incoming.map((r, i) => (
                <ListRow
                  key={r.friendshipId}
                  last={i === incoming.length - 1}
                  left={<Avatar name={r.user?.name} uri={r.user?.avatarUrl} />}
                  title={r.user?.name || 'Student'}
                  subtitle={r.icebreaker ? `“${r.icebreaker}”` : 'Wants to be friends'}
                  right={
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      <Button small variant="secondary" label="Decline" onPress={() => decline(r.friendshipId)} disabled={busyId === r.friendshipId} />
                      <Button small label="Accept" onPress={() => accept(r.friendshipId)} loading={busyId === r.friendshipId} />
                    </View>
                  }
                />
              ))}
            </View>
          </>
        )}
        {outgoing.length > 0 && (
          <>
            <SectionTitle title="Sent requests" />
            <View style={ui.card}>
              {outgoing.map((r, i) => (
                <ListRow
                  key={r.friendshipId}
                  last={i === outgoing.length - 1}
                  left={<Avatar name={r.user?.name} uri={r.user?.avatarUrl} />}
                  title={r.user?.name || 'Student'}
                  subtitle="Waiting for them to accept"
                  right={<Button small variant="ghost" label="Withdraw" onPress={() => withdraw(r.friendshipId)} loading={busyId === r.friendshipId} />}
                />
              ))}
            </View>
          </>
        )}

        {/* Friends */}
        <SectionTitle title="Your friends" />
        {loading ? (
          <SkeletonRows rows={3} />
        ) : error && friends.length === 0 ? (
          <View style={ui.card}>
            <ErrorState compact message={error} onRetry={load} />
          </View>
        ) : friends.length === 0 ? (
          <View style={ui.card}>
            <EmptyState
              compact
              icon={<Users size={22} color={CampusColors.accent} />}
              title="No friends yet"
              subtitle="Add classmates with their friend code, or find them with New chat in Chats."
              actionLabel="Add a friend"
              onAction={onAddFriend}
            />
          </View>
        ) : (
          <View style={ui.card}>
            {friends.map((f, i) => (
              <ListRow
                key={f.friendshipId}
                last={i === friends.length - 1}
                left={<Avatar name={f.name} uri={f.avatarUrl || f.profileImage} />}
                title={f.name}
                subtitle={f.streakCount ? `🔥 ${f.streakCount}-day streak` : f.vibe || null}
                onPress={() => message(f)}
                right={
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Button small label="Message" onPress={() => message(f)} loading={busyId === f.friendshipId} />
                    <TouchableOpacity onPress={() => friendMenu(f)} hitSlop={10} style={{ padding: 4 }} accessibilityLabel={`More options for ${f.name}`}>
                      <MoreVertical size={18} color={CampusColors.muted} />
                    </TouchableOpacity>
                  </View>
                }
              />
            ))}
          </View>
        )}

        {incoming.length === 0 && outgoing.length === 0 && !loading && friends.length > 0 && (
          <View style={styles.hint}>
            <Inbox size={14} color={CampusColors.muted} />
            <Text style={T.small}>No pending requests.</Text>
          </View>
        )}

        {blocked.length > 0 && (
          <>
            <SectionTitle title="Blocked" />
            <View style={ui.card}>
              {blocked.map((b, i) => (
                <ListRow
                  key={b.friendshipId}
                  last={i === blocked.length - 1}
                  left={<Avatar name={b.user.name} />}
                  title={b.user.name}
                  right={
                    <Button
                      small
                      variant="secondary"
                      label="Unblock"
                      loading={busyId === b.friendshipId}
                      onPress={() => run(b.friendshipId, () => unblockCampusUser(b.user.id, b.friendshipId), () => setBlocked((p) => p.filter((x) => x.friendshipId !== b.friendshipId)))}
                    />
                  }
                />
              ))}
            </View>
          </>
        )}
      </ScrollView>
      <AddFriendSheet visible={addOpen} onClose={() => setAddOpen(false)} myCode={myCode} onDone={() => requests.reload()} />
    </ScreenModal>
  );
};

const styles = StyleSheet.create({
  codeCard: { backgroundColor: CampusColors.inkCard, borderRadius: R.card, padding: S.lg },
  code: { fontSize: 28, fontWeight: '800', color: '#FFFFFF', letterSpacing: 2, marginVertical: 4 },
  hint: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: S.md, justifyContent: 'center' },
});
