import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Sparkles, ShieldCheck, ChevronRight, Plus } from '../../../../components/lucide';
import { FriendsColors, FS, FT, FR } from '../friendsTheme';
import type { ForumCommunity } from '../api/forumApi';
import { RelativeTime } from '../shared/RelativeTime';
import { useForumNav } from './forumNav';

/**
 * Pinned Freshers Guide for a community. Always labelled: "Official" (written by the Zenvy team or an
 * official account) or "Student advice" (written by a student moderator), so nobody mistakes one for
 * the other. Community moderators without a guide get a "Write the Freshers Guide" prompt.
 */
export const FreshersGuideCard: React.FC<{ community: ForumCommunity }> = ({ community }) => {
  const nav = useForumNav();
  const guide = community.freshersGuide;

  if (!guide) {
    if (!community.myRole || !community.allowedTypes.includes('guidance') || community.status !== 'active') return null;
    return (
      <TouchableOpacity
        style={[styles.card, styles.empty]}
        onPress={() => nav.openComposer({ community, type: 'guidance', freshersGuide: true })}
        accessibilityRole="button"
        accessibilityLabel="Write the Freshers Guide for this community"
      >
        <Plus size={18} color={FriendsColors.accent} />
        <View style={{ flex: 1 }}>
          <Text style={FT.h3}>Write the Freshers Guide</Text>
          <Text style={FT.small}>As a moderator you can pin one guide. It will be labelled Student advice.</Text>
        </View>
      </TouchableOpacity>
    );
  }

  const official = guide.label === 'official';
  return (
    <TouchableOpacity
      style={[styles.card, official ? styles.official : styles.student]}
      onPress={() => nav.push({ name: 'post', id: guide.postId })}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={`Freshers Guide, ${official ? 'official' : 'student advice'}: ${guide.title}. Open`}
    >
      <View style={[styles.icon, { backgroundColor: official ? FriendsColors.goldSoft : FriendsColors.accentSoft }]}>
        {official ? <ShieldCheck size={18} color={FriendsColors.gold} /> : <Sparkles size={18} color={FriendsColors.accent} />}
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={FT.kicker}>Freshers Guide</Text>
          <View style={[styles.label, { backgroundColor: official ? FriendsColors.goldSoft : FriendsColors.accentSoft }]}>
            <Text style={[styles.labelText, { color: official ? FriendsColors.gold : FriendsColors.accent }]}>{official ? 'Official' : 'Student advice'}</Text>
          </View>
        </View>
        <Text style={[FT.h3, { marginTop: 4 }]} numberOfLines={2}>
          {guide.title}
        </Text>
        <RelativeTime value={guide.updatedAt} prefix="Updated" />
      </View>
      <ChevronRight size={18} color={FriendsColors.muted} />
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: FS.md, padding: FS.md, borderRadius: FR.card, borderWidth: 1, minHeight: 64 },
  official: { backgroundColor: 'rgba(232,196,127,0.06)', borderColor: 'rgba(232,196,127,0.35)' },
  student: { backgroundColor: 'rgba(212,175,122,0.06)', borderColor: 'rgba(212,175,122,0.3)' },
  empty: { backgroundColor: FriendsColors.card, borderColor: FriendsColors.line, borderStyle: 'dashed' },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  label: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: FR.pill },
  labelText: { fontSize: 12, fontWeight: '800' },
});
