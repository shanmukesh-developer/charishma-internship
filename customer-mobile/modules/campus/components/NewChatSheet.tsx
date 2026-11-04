import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { Search, Users, KeyRound, UserPlus, MessageSquarePlus, BadgeCheck } from '../../../components/lucide';
import * as Haptics from 'expo-haptics';
import { CampusColors } from '../../../constants/campusTheme';
import {
  searchCampus,
  openCampusDm,
  joinOpenGroup,
  sendFriendRequest,
  acceptFriendRequest,
  CampusPerson,
  CampusClub,
} from '../campusApi';
import { Sheet, Avatar, ListRow, EmptyState, ErrorState, Button, T, S, R, ui } from '../ui';

interface NewChatSheetProps {
  visible: boolean;
  onClose: () => void;
  onOpenChat: (chatId: string, name: string) => void;
  onCreateGroup: () => void;
  onJoinWithCode: () => void;
  onAddFriendByCode: () => void;
  onOpenProfile: () => void;
  /** Opens college verification (people search needs a verified student). */
  onOpenVerify?: () => void;
  /** Called after a friend request is sent or accepted, so badges refresh. */
  onFriendsChanged?: () => void;
}

/**
 * The header "+" and the Chats "New chat" button: start a 1:1 chat with a classmate,
 * join a public club, create a group, join with a code, or add a friend by code.
 */
export const NewChatSheet: React.FC<NewChatSheetProps> = ({
  visible,
  onClose,
  onOpenChat,
  onCreateGroup,
  onJoinWithCode,
  onAddFriendByCode,
  onOpenProfile,
  onOpenVerify,
  onFriendsChanged,
}) => {
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [people, setPeople] = useState<CampusPerson[]>([]);
  const [clubs, setClubs] = useState<CampusClub[]>([]);
  const [needsCampus, setNeedsCampus] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const reqSeq = useRef(0);

  useEffect(() => {
    if (!visible) {
      setQ('');
      setPeople([]);
      setClubs([]);
      setError(null);
      setNeedsCampus(false);
      setNeedsVerification(false);
    }
  }, [visible]);

  const runSearch = async (query: string) => {
    const seq = ++reqSeq.current;
    setLoading(true);
    setError(null);
    try {
      const res = await searchCampus(query, 'all');
      if (seq !== reqSeq.current) return;
      setPeople(res.people);
      setClubs(res.clubs);
      setNeedsCampus(!!res.needsCampus);
      setNeedsVerification(!!res.needsVerification);
    } catch (e: any) {
      if (seq !== reqSeq.current) return;
      setError(e?.message || "Couldn't search right now.");
    } finally {
      if (seq === reqSeq.current) setLoading(false);
    }
  };

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      reqSeq.current++;
      setLoading(false);
      setPeople([]);
      setClubs([]);
      setError(null);
      return;
    }
    const t = setTimeout(() => runSearch(term), 350);
    return () => clearTimeout(t);
  }, [q]);

  const updatePerson = (userId: string, patch: Partial<CampusPerson>) =>
    setPeople((prev) => prev.map((p) => (p.userId === userId ? { ...p, ...patch } : p)));

  const message = async (p: CampusPerson) => {
    if (busyId) return;
    setBusyId(p.userId);
    try {
      const { chatId, name } = await openCampusDm(p.userId);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onOpenChat(chatId, name || p.name);
    } catch (e: any) {
      if (e?.code === 'NOT_CONNECTED') {
        Alert.alert(
          "Can't message yet",
          `You can chat with friends and verified students on your campus. Send ${p.name} a friend request first.`,
          [
            { text: 'Not now', style: 'cancel' },
            { text: 'Add friend', onPress: () => addFriend(p) },
          ]
        );
      } else if (e?.code === 'VERIFY_FIRST') {
        Alert.alert(
          'Verify to message classmates',
          e?.message || 'Verify your college first. Friends can always chat.',
          onOpenVerify
            ? [
                { text: 'Not now', style: 'cancel' },
                { text: 'Verify now', onPress: onOpenVerify },
              ]
            : undefined
        );
      } else {
        Alert.alert("Couldn't open chat", e?.message || 'Please try again.');
      }
    } finally {
      setBusyId(null);
    }
  };

  const addFriend = async (p: CampusPerson) => {
    setBusyId(p.userId);
    try {
      if (p.friendshipStatus === 'pending_in' && p.friendshipId) {
        await acceptFriendRequest(p.friendshipId);
        updatePerson(p.userId, { friendshipStatus: 'accepted' });
      } else {
        await sendFriendRequest({ recipientId: p.userId });
        updatePerson(p.userId, { friendshipStatus: 'pending_out' });
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onFriendsChanged?.();
    } catch (e: any) {
      if (e?.code === 'REQUEST_ALREADY_SENT') updatePerson(p.userId, { friendshipStatus: 'pending_out' });
      else if (e?.code === 'ALREADY_FRIENDS') updatePerson(p.userId, { friendshipStatus: 'accepted' });
      else if (e?.code === 'REQUEST_INCOMING') updatePerson(p.userId, { friendshipStatus: 'pending_in', friendshipId: e?.data?.friendshipId });
      else Alert.alert("Couldn't send request", e?.message || 'Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  const joinClub = async (c: CampusClub) => {
    if (c.isMember) {
      onOpenChat(c.id, c.name);
      return;
    }
    setBusyId(c.id);
    try {
      await joinOpenGroup(c.id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onOpenChat(c.id, c.name);
    } catch (e: any) {
      Alert.alert("Couldn't join", e?.message || 'Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  const friendLabel = (s: CampusPerson['friendshipStatus']) =>
    s === 'accepted' ? 'Friends' : s === 'pending_out' ? 'Requested' : s === 'pending_in' ? 'Accept' : 'Add friend';

  const term = q.trim();

  return (
    <Sheet visible={visible} onClose={onClose} title="New chat" icon={<MessageSquarePlus size={20} color={CampusColors.accent} />}>
      <View style={styles.searchWrap}>
        <Search size={18} color={CampusColors.muted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search classmates or clubs by name"
          placeholderTextColor={CampusColors.muted}
          value={q}
          onChangeText={setQ}
          autoCorrect={false}
          returnKeyType="search"
        />
        {loading && <ActivityIndicator size="small" color={CampusColors.accent} />}
      </View>

      {term.length < 2 ? (
        <View style={[ui.card, { marginTop: S.md }]}>
          <ListRow
            left={<View style={styles.actionIcon}><Users size={18} color={CampusColors.accentDeep} /></View>}
            title="New group"
            subtitle="Classroom, club or study group"
            onPress={onCreateGroup}
          />
          <ListRow
            left={<View style={styles.actionIcon}><KeyRound size={18} color={CampusColors.accentDeep} /></View>}
            title="Join with code or link"
            subtitle="6-character code from your CR or club admin"
            onPress={onJoinWithCode}
          />
          <ListRow
            left={<View style={styles.actionIcon}><UserPlus size={18} color={CampusColors.accentDeep} /></View>}
            title="Add friend by code"
            subtitle="Use the friend code from their ZENV profile"
            onPress={onAddFriendByCode}
            last
          />
        </View>
      ) : error ? (
        <ErrorState compact message={error} onRetry={() => runSearch(term)} />
      ) : needsCampus ? (
        <EmptyState
          compact
          title="Set your campus first"
          subtitle="Choose your campus in Me so we can show classmates and clubs."
          actionLabel="Open Me"
          onAction={onOpenProfile}
        />
      ) : needsVerification && people.length === 0 && clubs.length === 0 && !loading ? (
        <EmptyState
          compact
          title="Verify to find classmates"
          subtitle="Classmate search is only for verified students. You can still add friends by their code."
          actionLabel={onOpenVerify ? 'Verify my college' : 'Add by friend code'}
          onAction={onOpenVerify || onAddFriendByCode}
        />
      ) : !loading && people.length === 0 && clubs.length === 0 ? (
        <EmptyState
          compact
          title={`No one found for "${term}"`}
          subtitle="Only verified students on your campus show up here. You can also add a friend by their code."
          actionLabel="Add by friend code"
          onAction={onAddFriendByCode}
        />
      ) : (
        <>
          {people.length > 0 && <Text style={[T.kicker, { marginTop: S.lg, marginBottom: S.sm }]}>People</Text>}
          {people.length > 0 && (
            <View style={ui.card}>
              {people.map((p, i) => (
                <ListRow
                  key={p.userId}
                  last={i === people.length - 1}
                  left={<Avatar name={p.name} uri={p.avatarUrl} size={44} />}
                  title={p.name}
                  subtitle={[p.branch, p.year ? `Year ${p.year}` : null].filter(Boolean).join(' • ') || (p.verified ? 'Verified student' : null)}
                  right={
                    <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                      {p.friendshipStatus !== 'accepted' && p.friendshipStatus !== 'blocked' && (
                        <TouchableOpacity
                          style={[styles.smallBtn, p.friendshipStatus === 'pending_out' && styles.smallBtnMuted]}
                          disabled={p.friendshipStatus === 'pending_out' || busyId === p.userId}
                          onPress={() => addFriend(p)}
                        >
                          <Text style={[styles.smallBtnText, p.friendshipStatus === 'pending_out' && { color: CampusColors.muted }]}>
                            {friendLabel(p.friendshipStatus)}
                          </Text>
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity
                        style={[styles.smallBtn, styles.smallBtnPrimary]}
                        disabled={busyId === p.userId}
                        onPress={() => message(p)}
                      >
                        {busyId === p.userId ? (
                          <ActivityIndicator size="small" color="#FFFFFF" />
                        ) : (
                          <Text style={[styles.smallBtnText, { color: '#FFFFFF' }]}>Message</Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  }
                />
              ))}
            </View>
          )}

          {clubs.length > 0 && <Text style={[T.kicker, { marginTop: S.lg, marginBottom: S.sm }]}>Clubs & public groups</Text>}
          {clubs.length > 0 && (
            <View style={ui.card}>
              {clubs.map((c, i) => (
                <ListRow
                  key={c.id}
                  last={i === clubs.length - 1}
                  left={<Avatar name={c.name} uri={c.avatarUrl} size={44} rounded={false} bg={CampusColors.warmSoft} />}
                  title={c.name}
                  subtitle={[c.memberCount ? `${c.memberCount} members` : null, c.description].filter(Boolean).join(' • ')}
                  right={
                    <Button small label={c.isMember ? 'Open' : 'Join'} variant={c.isMember ? 'secondary' : 'primary'} loading={busyId === c.id} onPress={() => joinClub(c)} />
                  }
                />
              ))}
            </View>
          )}
          <View style={styles.note}>
            <BadgeCheck size={14} color={CampusColors.muted} />
            <Text style={[T.small, { flex: 1 }]}>Only verified students on your campus appear. Phone numbers are never shown.</Text>
          </View>
        </>
      )}
    </Sheet>
  );
};

const styles = StyleSheet.create({
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.sm,
    height: 48,
    paddingHorizontal: 14,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: CampusColors.line,
    backgroundColor: CampusColors.paper,
  },
  searchInput: { flex: 1, fontSize: 15, color: CampusColors.ink },
  actionIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: CampusColors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  smallBtn: {
    height: 32,
    minWidth: 64,
    paddingHorizontal: 10,
    borderRadius: R.pill,
    borderWidth: 1,
    borderColor: CampusColors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallBtnPrimary: { backgroundColor: CampusColors.accent, borderColor: CampusColors.accent },
  smallBtnMuted: { backgroundColor: CampusColors.paper },
  smallBtnText: { fontSize: 12, fontWeight: '700', color: CampusColors.ink },
  note: { flexDirection: 'row', gap: 6, alignItems: 'center', marginTop: S.md },
});
