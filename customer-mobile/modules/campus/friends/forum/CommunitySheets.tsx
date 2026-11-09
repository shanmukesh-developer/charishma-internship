import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Switch, ActivityIndicator, StyleSheet, Alert } from 'react-native';
import { ScrollText, Check, Settings2, Plus } from '../../../../components/lucide';
import * as Haptics from 'expo-haptics';
import { FriendsSheet } from '../shared/FriendsSheet';
import { IdentityChip } from '../shared/IdentityChip';
import { FriendsColors, FS, FT, FR, fui } from '../friendsTheme';
import {
  ForumCommunity,
  ForumPostType,
  FORUM_POST_TYPES,
  FORUM_LIMITS,
  fetchCommunity,
  requestCommunity,
  updateCommunity,
} from '../api/forumApi';
import { POST_TYPE_META, blockedDetails, forumErrorMessage } from './forumShared';

import { themedSheet } from '../../../../utils/themeNow';
/** Community rules + moderators. */
export const RulesSheet: React.FC<{ community: ForumCommunity | null; visible: boolean; onClose: () => void }> = ({ community, visible, onClose }) => {
  const [full, setFull] = useState<ForumCommunity | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible || !community) return;
    let alive = true;
    setLoading(true);
    fetchCommunity(community.id)
      .then((c) => alive && setFull(c))
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [visible, community]);

  const c = full || community;
  if (!c) return null;
  return (
    <FriendsSheet visible={visible} onClose={onClose} title={`${c.name} rules`} icon={<ScrollText size={18} color={FriendsColors.accent} />}>
      {c.description ? <Text style={[FT.muted, { marginBottom: FS.md }]}>{c.description}</Text> : null}
      {c.rules.length ? (
        <View style={{ gap: FS.sm }}>
          {c.rules.map((r, i) => (
            <View key={i} style={styles.rule} accessible accessibilityLabel={`Rule ${i + 1}: ${r}`}>
              <Text style={styles.ruleNo}>{i + 1}</Text>
              <Text style={[FT.body, { flex: 1 }]}>{r}</Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={FT.muted}>This community follows the Friends community guidelines.</Text>
      )}
      <Text style={[FT.small, { marginTop: FS.md }]}>
        Allowed here: {c.allowedTypes.map((t) => POST_TYPE_META[t]?.label || t).join(', ')}. {c.allowAnonymous ? 'Anonymous posting is allowed.' : 'Posts show your verified name.'}
      </Text>
      <Text style={[FT.kicker, { marginTop: FS.lg, marginBottom: FS.sm }]}>Moderators</Text>
      {loading && !full ? (
        <ActivityIndicator color={FriendsColors.accent} />
      ) : full?.moderators?.length ? (
        <View style={{ gap: FS.sm }}>
          {full.moderators.map((m, i) => (
            <IdentityChip key={i} identity={m.user} size="sm" right={<Text style={FT.small}>{m.role === 'owner' ? 'Owner' : 'Moderator'}</Text>} />
          ))}
        </View>
      ) : (
        <Text style={FT.muted}>Moderated by the ZenWe Friends team.</Text>
      )}
    </FriendsSheet>
  );
};

const rulesFromText = (t: string) =>
  t
    .split('\n')
    .map((r) => r.trim())
    .filter(Boolean)
    .slice(0, 10);

/** Ask the Zenvy team to create a new community (pending until an admin approves). */
export const RequestCommunitySheet: React.FC<{ visible: boolean; onClose: () => void; onRequested: (c: ForumCommunity) => void }> = ({ visible, onClose, onRequested }) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [rules, setRules] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setName('');
    setDescription('');
    setRules('');
    setError(null);
  }, [visible]);

  const ruleList = rulesFromText(rules);
  const badRule = ruleList.find((r) => r.length < 3 || r.length > 200);
  const valid = name.trim().length >= FORUM_LIMITS.communityName.min && !badRule;

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await requestCommunity({ name: name.trim(), description: description.trim() || undefined, rules: ruleList });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onRequested(r.community);
      onClose();
      Alert.alert('Request sent', 'The ZenWe team reviews new communities. You will be its owner once it is approved.');
    } catch (e: any) {
      setError(blockedDetails(e) || forumErrorMessage(e, "Couldn't send the request."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <FriendsSheet visible={visible} onClose={onClose} title="Request a community" subtitle="Reviewed by the ZenWe team before it goes live" icon={<Plus size={18} color={FriendsColors.accent} />}>
      <Text style={styles.label}>Name</Text>
      <TextInput
        style={fui.input}
        value={name}
        onChangeText={(t) => setName(t.slice(0, FORUM_LIMITS.communityName.max))}
        placeholder="e.g. Robotics Club"
        placeholderTextColor={FriendsColors.faint}
        maxLength={FORUM_LIMITS.communityName.max}
        accessibilityLabel="Community name"
      />
      <Text style={styles.label}>What is it for? (optional)</Text>
      <TextInput
        style={[fui.input, { minHeight: 70, textAlignVertical: 'top' }]}
        value={description}
        onChangeText={(t) => setDescription(t.slice(0, FORUM_LIMITS.communityDescription))}
        placeholder="One or two lines"
        placeholderTextColor={FriendsColors.faint}
        multiline
        maxLength={FORUM_LIMITS.communityDescription}
        accessibilityLabel="Community description"
      />
      <Text style={styles.label}>Rules, one per line (optional, up to 10)</Text>
      <TextInput
        style={[fui.input, { minHeight: 90, textAlignVertical: 'top' }]}
        value={rules}
        onChangeText={setRules}
        placeholder={'Be respectful\nNo selling graded work'}
        placeholderTextColor={FriendsColors.faint}
        multiline
        accessibilityLabel="Community rules, one per line"
      />
      {badRule ? <Text style={[FT.small, { color: FriendsColors.danger, marginTop: 4 }]}>Each rule needs 3 to 200 characters.</Text> : null}
      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
      <TouchableOpacity
        style={[fui.primaryBtn, { marginTop: FS.lg }, (!valid || busy) && { opacity: 0.5 }]}
        onPress={submit}
        disabled={!valid || busy}
        accessibilityRole="button"
        accessibilityState={{ disabled: !valid || busy }}
      >
        {busy ? <ActivityIndicator color={FriendsColors.accentInk} /> : <Text style={fui.primaryBtnText}>Send request</Text>}
      </TouchableOpacity>
    </FriendsSheet>
  );
};

/** Owner settings: description, rules, anonymity, allowed post types (name too for custom communities). */
export const EditCommunitySheet: React.FC<{ community: ForumCommunity | null; visible: boolean; onClose: () => void; onSaved: (c: ForumCommunity) => void }> = ({
  community,
  visible,
  onClose,
  onSaved,
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [rules, setRules] = useState('');
  const [anon, setAnon] = useState(true);
  const [types, setTypes] = useState<ForumPostType[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || !community) return;
    setName(community.name);
    setDescription(community.description || '');
    setRules((community.rules || []).join('\n'));
    setAnon(community.allowAnonymous);
    setTypes(community.allowedTypes);
    setError(null);
  }, [visible, community]);

  if (!community) return null;
  const ruleList = rulesFromText(rules);
  const badRule = ruleList.find((r) => r.length < 3 || r.length > 200);
  const valid = !!types.length && !badRule && (community.kind !== 'custom' || name.trim().length >= 3);

  const save = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const patch: any = { description: description.trim(), rules: ruleList, allowAnonymous: anon, allowedTypes: types };
      if (community.kind === 'custom') patch.name = name.trim();
      const c = await updateCommunity(community.id, patch);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      // The update response has no membership / guide fields: keep the ones already on screen.
      onSaved({ ...community, ...c, isMember: community.isMember, freshersGuide: community.freshersGuide, myRole: c.myRole ?? community.myRole });
      onClose();
    } catch (e: any) {
      setError(blockedDetails(e) || forumErrorMessage(e, "Couldn't save."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <FriendsSheet visible={visible} onClose={onClose} title="Community settings" icon={<Settings2 size={18} color={FriendsColors.accent} />}>
      {community.kind === 'custom' ? (
        <>
          <Text style={styles.label}>Name</Text>
          <TextInput style={fui.input} value={name} onChangeText={(t) => setName(t.slice(0, 60))} maxLength={60} accessibilityLabel="Community name" placeholderTextColor={FriendsColors.faint} />
        </>
      ) : null}
      <Text style={styles.label}>Description</Text>
      <TextInput
        style={[fui.input, { minHeight: 70, textAlignVertical: 'top' }]}
        value={description}
        onChangeText={(t) => setDescription(t.slice(0, 300))}
        multiline
        maxLength={300}
        accessibilityLabel="Description"
        placeholderTextColor={FriendsColors.faint}
      />
      <Text style={styles.label}>Rules, one per line</Text>
      <TextInput style={[fui.input, { minHeight: 100, textAlignVertical: 'top' }]} value={rules} onChangeText={setRules} multiline accessibilityLabel="Rules, one per line" />
      {badRule ? <Text style={[FT.small, { color: FriendsColors.danger, marginTop: 4 }]}>Each rule needs 3 to 200 characters.</Text> : null}
      <View style={[fui.row, { paddingHorizontal: 0, borderBottomWidth: 0 }]}>
        <Text style={[FT.h3, { flex: 1 }]}>Allow anonymous posts</Text>
        <Switch
          value={anon}
          onValueChange={setAnon}
          trackColor={{ true: FriendsColors.accent, false: FriendsColors.line }}
          thumbColor={FriendsColors.ink}
          accessibilityLabel="Allow anonymous posts"
        />
      </View>
      <Text style={styles.label}>Post types</Text>
      <View style={styles.typeWrap}>
        {FORUM_POST_TYPES.map((t) => {
          const on = types.includes(t);
          return (
            <TouchableOpacity
              key={t}
              style={[fui.pill, on && fui.pillActive]}
              onPress={() => setTypes((prev) => (on ? prev.filter((x) => x !== t) : [...prev, t]))}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={POST_TYPE_META[t].label}
            >
              {on ? <Check size={12} color={FriendsColors.accentInk} /> : null}
              <Text style={[fui.pillText, on && fui.pillTextActive]}>{POST_TYPE_META[t].label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
      <TouchableOpacity
        style={[fui.primaryBtn, { marginTop: FS.lg }, (!valid || busy) && { opacity: 0.5 }]}
        onPress={save}
        disabled={!valid || busy}
        accessibilityRole="button"
        accessibilityState={{ disabled: !valid || busy }}
      >
        {busy ? <ActivityIndicator color={FriendsColors.accentInk} /> : <Text style={fui.primaryBtnText}>Save</Text>}
      </TouchableOpacity>
    </FriendsSheet>
  );
};

const styles = themedSheet(() => ({
  label: { ...FT.kicker, marginTop: FS.md, marginBottom: 6 } as any,
  rule: { flexDirection: 'row', gap: FS.md, padding: FS.md, borderRadius: FR.md, backgroundColor: FriendsColors.cardHi },
  ruleNo: { width: 20, fontSize: 14, fontWeight: '800', color: FriendsColors.accent },
  typeWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: FS.sm },
  error: { marginTop: FS.md, padding: FS.md, borderRadius: FR.md, backgroundColor: FriendsColors.dangerSoft, color: FriendsColors.danger, fontSize: 13, fontWeight: '600' },
}));
