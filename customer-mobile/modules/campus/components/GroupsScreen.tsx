import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Alert, Share, RefreshControl, ScrollView, Switch } from 'react-native';
import { Users, Plus, KeyRound, MoreVertical, Globe2 } from '../../../components/lucide';
import * as Haptics from 'expo-haptics';
import { CampusColors } from '../../../constants/campusTheme';
import {
  CampusGroup,
  fetchMyGroups,
  createCampusGroup,
  resetCampusGroupCode,
  setGroupDiscoverable,
} from '../campusApi';
import { ScreenModal, Sheet, Avatar, ListRow, EmptyState, ErrorState, SkeletonRows, Button, T, S, R, ui } from '../ui';
import { ActionMenu } from '../friends/shared/ActionMenu';

const TYPE_OPTIONS: { key: string; label: string; hint: string }[] = [
  { key: 'study', label: 'Study group', hint: 'Friends, projects, lab partners' },
  { key: 'club', label: 'Club', hint: 'Clubs, teams and societies' },
  { key: 'hostel', label: 'Hostel', hint: 'Your block or floor' },
  { key: 'class', label: 'Class', hint: 'Your section or course' },
];

const TYPE_LABEL: Record<string, string> = {
  class: 'Class',
  club: 'Club',
  study: 'Study group',
  hostel: 'Hostel',
  ride: 'Ride group',
  group: 'Group',
};

const shareInvite = (name: string, code?: string) => {
  if (!code) return;
  Share.share({
    message: `Join "${name}" on ZENV Campus with code ${code}. Open ZENV > Campus > + > Join with code.`,
  }).catch(() => {});
};

// ── Create group ────────────────────────────────────────────────────────────
export const CreateGroupSheet: React.FC<{
  visible: boolean;
  onClose: () => void;
  onCreated: (group: CampusGroup) => void;
}> = ({ visible, onClose, onCreated }) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState('study');
  const [isPublic, setIsPublic] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setName('');
      setDescription('');
      setType('study');
      setIsPublic(false);
      setError(null);
    }
  }, [visible]);

  const submit = async () => {
    if (busy) return;
    const n = name.trim();
    if (n.length < 2) {
      setError('Give your group a name (at least 2 characters).');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const group = await createCampusGroup({ name: n, description: description.trim() || undefined, type, discoverable: isPublic });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onCreated({ ...group, discoverable: isPublic, isAdmin: true });
    } catch (e: any) {
      setError(e?.code === 'CONTENT_BLOCKED'
        ? e?.message || "That name has words that aren't allowed on ZENV. Please rephrase it."
        : e?.message || "Couldn't create the group. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={() => !busy && onClose()} title="New group" icon={<Users size={20} color={CampusColors.accent} />}>
      {error && (
        <View style={ui.errorBox}>
          <Text style={ui.errorText}>{error}</Text>
        </View>
      )}
      <Text style={[ui.label, { marginTop: 0 }]}>Group name</Text>
      <TextInput
        style={ui.input}
        value={name}
        onChangeText={setName}
        placeholder="e.g. CSE-B Night Owls"
        placeholderTextColor={CampusColors.muted}
        maxLength={80}
        autoFocus
        editable={!busy}
      />
      <Text style={ui.label}>About (optional)</Text>
      <TextInput
        style={ui.input}
        value={description}
        onChangeText={setDescription}
        placeholder="What is this group for?"
        placeholderTextColor={CampusColors.muted}
        maxLength={250}
        editable={!busy}
      />
      <Text style={ui.label}>Type</Text>
      <View style={styles.chips}>
        {TYPE_OPTIONS.map((o) => {
          const active = o.key === type;
          return (
            <TouchableOpacity key={o.key} style={[styles.chip, active && styles.chipActive]} onPress={() => setType(o.key)} disabled={busy}>
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{o.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <Text style={[T.small, { marginTop: 6 }]}>{TYPE_OPTIONS.find((o) => o.key === type)?.hint}</Text>

      <View style={styles.switchRow}>
        <Globe2 size={18} color={CampusColors.accentDeep} />
        <View style={{ flex: 1 }}>
          <Text style={T.h3}>Public on campus</Text>
          <Text style={T.small}>Students on your campus can find it in search and join without a code.</Text>
        </View>
        <Switch value={isPublic} onValueChange={setIsPublic} disabled={busy} trackColor={{ true: CampusColors.accent }} />
      </View>

      <Button label="Create group" onPress={submit} loading={busy} style={{ marginTop: S.xl }} />
    </Sheet>
  );
};

// ── My groups page ──────────────────────────────────────────────────────────
interface GroupsScreenProps {
  visible: boolean;
  onClose: () => void;
  onOpenChat: (chatId: string, chatName: string) => void;
  onCreateGroup: () => void;
  onJoinWithCode: () => void;
  /** Bump to reload (after a create / join elsewhere). */
  refreshKey?: number;
}

export const GroupsScreen: React.FC<GroupsScreenProps> = ({ visible, onClose, onOpenChat, onCreateGroup, onJoinWithCode, refreshKey }) => {
  const [groups, setGroups] = useState<CampusGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // C2: Report a group you are in (admins have their manage menu instead).
  const [reportGroup, setReportGroup] = useState<CampusGroup | null>(null);
  const [reportMenuOpen, setReportMenuOpen] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const data = await fetchMyGroups();
      if (!mounted.current) return;
      setGroups(data);
      setError(null);
    } catch (e: any) {
      if (mounted.current) setError(e?.message || "Couldn't load your groups.");
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) load();
  }, [visible, refreshKey, load]);

  const resetCode = (group: CampusGroup) => {
    Alert.alert('Reset join code?', 'The old code stops working right away.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset',
        style: 'destructive',
        onPress: async () => {
          try {
            const newCode = await resetCampusGroupCode(group.id);
            setGroups((prev) => prev.map((g) => (g.id === group.id ? { ...g, joinCode: newCode } : g)));
            Alert.alert('New join code', newCode, [
              { text: 'OK', style: 'cancel' },
              { text: 'Share', onPress: () => shareInvite(group.name, newCode) },
            ]);
          } catch (e: any) {
            Alert.alert("Couldn't reset the code", e?.message || 'Please try again.');
          }
        },
      },
    ]);
  };

  const togglePublic = async (group: CampusGroup) => {
    const next = !group.discoverable;
    setGroups((prev) => prev.map((g) => (g.id === group.id ? { ...g, discoverable: next } : g)));
    try {
      await setGroupDiscoverable(group.id, next);
      Haptics.selectionAsync().catch(() => {});
    } catch (e: any) {
      setGroups((prev) => prev.map((g) => (g.id === group.id ? { ...g, discoverable: !next } : g)));
      Alert.alert("Couldn't update the group", e?.message || 'Please try again.');
    }
  };

  const manage = (group: CampusGroup) => {
    Alert.alert(group.name, group.joinCode ? `Join code: ${group.joinCode}` : undefined, [
      ...(group.joinCode ? [{ text: 'Share invite', onPress: () => shareInvite(group.name, group.joinCode) }] : []),
      { text: group.discoverable ? 'Make private' : 'Make public on campus', onPress: () => togglePublic(group) },
      { text: 'Reset join code', style: 'destructive' as const, onPress: () => resetCode(group) },
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  };

  return (
    <ScreenModal
      visible={visible}
      onClose={onClose}
      title="Groups & classrooms"
      subtitle={groups.length ? `${groups.length} group${groups.length === 1 ? '' : 's'}` : undefined}
      right={
        <TouchableOpacity onPress={onCreateGroup} style={ui.iconBtn} accessibilityLabel="New group">
          <Plus size={22} color={CampusColors.accent} />
        </TouchableOpacity>
      }
    >
      <ScrollView
        contentContainerStyle={{ padding: S.lg, paddingBottom: 40 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={CampusColors.accent}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              if (mounted.current) setRefreshing(false);
            }}
          />
        }
      >
        <View style={{ flexDirection: 'row', gap: S.sm, marginBottom: S.lg }}>
          <Button label="New group" onPress={onCreateGroup} icon={<Plus size={16} color="#FFFFFF" />} style={{ flex: 1 }} />
          <Button label="Join with code" variant="secondary" onPress={onJoinWithCode} icon={<KeyRound size={16} color={CampusColors.ink} />} style={{ flex: 1 }} />
        </View>

        {loading ? (
          <SkeletonRows rows={4} />
        ) : error && groups.length === 0 ? (
          <View style={ui.card}>
            <ErrorState
              message={error}
              onRetry={() => {
                setLoading(true);
                load();
              }}
            />
          </View>
        ) : groups.length === 0 ? (
          <View style={ui.card}>
            <EmptyState
              icon={<Users size={22} color={CampusColors.accent} />}
              title="No groups yet"
              subtitle="Create a study group, or join your class or club with the code your CR or club admin shared."
              actionLabel="Join with code"
              onAction={onJoinWithCode}
            />
          </View>
        ) : (
          <View style={ui.card}>
            {groups.map((g, i) => (
              <ListRow
                key={g.id}
                last={i === groups.length - 1}
                left={<Avatar name={g.name} uri={g.groupAvatar} size={44} rounded={false} bg={CampusColors.accentSoft} />}
                title={g.name}
                subtitle={[
                  TYPE_LABEL[g.type || ''] || 'Group',
                  typeof g.memberCount === 'number' ? `${g.memberCount} member${g.memberCount === 1 ? '' : 's'}` : null,
                  g.discoverable ? 'Public' : null,
                  g.isAdmin && g.joinCode ? `Code ${g.joinCode}` : null,
                ]
                  .filter(Boolean)
                  .join(' • ')}
                onPress={() => onOpenChat(g.id, g.name)}
                right={
                  g.isAdmin ? (
                    <TouchableOpacity onPress={() => manage(g)} hitSlop={10} style={{ padding: 6 }} accessibilityLabel={`Manage ${g.name}`}>
                      <MoreVertical size={18} color={CampusColors.muted} />
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      onPress={() => {
                        setReportGroup(g);
                        setReportMenuOpen(true);
                      }}
                      hitSlop={10}
                      style={{ padding: 6 }}
                      accessibilityLabel={`Options for ${g.name}`}
                    >
                      <MoreVertical size={18} color={CampusColors.muted} />
                    </TouchableOpacity>
                  )
                }
              />
            ))}
          </View>
        )}
      </ScrollView>
      <ActionMenu
        visible={reportMenuOpen}
        onClose={() => setReportMenuOpen(false)}
        title={reportGroup?.name || 'Group'}
        report={reportGroup ? { type: 'group', id: reportGroup.id, label: `the group "${reportGroup.name}"` } : null}
      />
    </ScreenModal>
  );
};

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: S.sm },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: R.pill, borderWidth: 1, borderColor: CampusColors.chipBorder, backgroundColor: CampusColors.card },
  chipActive: { backgroundColor: CampusColors.ink, borderColor: CampusColors.ink },
  chipText: { fontSize: 13, fontWeight: '600', color: CampusColors.ink },
  chipTextActive: { color: '#FFFFFF', fontWeight: '800' },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.md,
    marginTop: S.lg,
    padding: S.md,
    borderRadius: R.md,
    backgroundColor: CampusColors.paper,
    borderWidth: 1,
    borderColor: CampusColors.line,
  },
});
