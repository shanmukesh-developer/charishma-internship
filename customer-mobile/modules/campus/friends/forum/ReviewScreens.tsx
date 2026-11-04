import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, FlatList, RefreshControl, ActivityIndicator, StyleSheet } from 'react-native';
import { Search, Star, PenLine, ChevronRight, Hourglass } from '../../../../components/lucide';
import { FriendsColors, FS, FT, FR, fui } from '../friendsTheme';
import { FriendsEmpty, FriendsError } from '../shared/FriendsEmpty';
import { FriendsSkeleton } from '../shared/FriendsSkeleton';
import { ForumPost, ReviewKind, ReviewTarget, ReviewStatus, REVIEW_KINDS, fetchReviewTarget, fetchReviewTargets } from '../api/forumApi';
import { useForumNav } from './forumNav';
import { usePaged } from './usePaged';
import { Chips, ForumHeader, PostList, SoftError } from './ForumUi';
import { Stars } from './Stars';
import { REVIEW_KIND_META, forumErrorMessage } from './forumShared';

const KIND_OPTIONS = REVIEW_KINDS.map((k) => ({ key: k, label: REVIEW_KIND_META[k].plural }));

/** Browse review pages by kind with search; tap opens the page with its average and reviews. */
export const ReviewsBrowseScreen: React.FC = () => {
  const nav = useForumNav();
  const [kind, setKind] = useState<ReviewKind>('course');
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const paged = usePaged<ReviewTarget>(`targets:${kind}:${term}`, (cursor) => fetchReviewTargets({ kind, q: term || undefined, cursor }), { onError: nav.onGateError });

  return (
    <View style={fui.screen}>
      <ForumHeader title="Reviews" subtitle="Courses, professors, hostels, mess, clubs, placements" onBack={nav.back} />
      <FlatList
        data={paged.loading || paged.error ? [] : paged.items}
        keyExtractor={(t) => t.id}
        contentContainerStyle={{ padding: FS.lg, paddingBottom: 120 }}
        ListHeaderComponent={
          <View style={{ gap: FS.md, marginBottom: FS.md }}>
            <Chips label="Kind" options={KIND_OPTIONS} value={kind} onChange={setKind} />
            <View style={[fui.input, styles.search]}>
              <Search size={16} color={FriendsColors.faint} />
              <TextInput
                style={styles.searchInput}
                value={q}
                onChangeText={setQ}
                placeholder={`Search ${REVIEW_KIND_META[kind].plural.toLowerCase()}`}
                placeholderTextColor={FriendsColors.faint}
                accessibilityLabel={`Search ${REVIEW_KIND_META[kind].plural}`}
                returnKeyType="search"
              />
            </View>
          </View>
        }
        ItemSeparatorComponent={() => <View style={{ height: FS.sm }} />}
        renderItem={({ item }) => <TargetRow target={item} onPress={() => nav.push({ name: 'target', id: item.id, target: item })} />}
        ListEmptyComponent={
          paged.loading ? (
            <FriendsSkeleton rows={4} variant="row" />
          ) : paged.error ? (
            <FriendsError message={forumErrorMessage(paged.error, "Couldn't load review pages.")} onRetry={paged.reload} />
          ) : (
            <FriendsEmpty
              compact
              icon={<Star size={22} color={FriendsColors.accent} />}
              title={term ? 'No match' : `No ${REVIEW_KIND_META[kind].plural.toLowerCase()} listed yet`}
              subtitle="Missing something? Start a review and request a page; the ZenWe team adds it after a check."
              actionLabel="Write a review"
              onAction={() => nav.openComposer({ type: 'review' })}
            />
          )
        }
        ListFooterComponent={
          paged.softError ? <SoftError error={paged.softError} onRetry={paged.hasMore ? paged.loadMore : paged.refresh} /> : paged.loadingMore ? <ActivityIndicator color={FriendsColors.accent} style={{ margin: FS.lg }} /> : null
        }
        onEndReached={paged.loadMore}
        onEndReachedThreshold={0.4}
        refreshControl={<RefreshControl refreshing={paged.refreshing} onRefresh={paged.refresh} tintColor={FriendsColors.accent} colors={[FriendsColors.accent]} progressBackgroundColor={FriendsColors.card} />}
        keyboardShouldPersistTaps="handled"
      />
    </View>
  );
};

const TargetRow: React.FC<{ target: ReviewTarget; onPress: () => void }> = ({ target, onPress }) => {
  const meta = [target.meta?.code, target.meta?.department, target.meta?.block].filter(Boolean).join(' · ');
  const Icon = REVIEW_KIND_META[target.kind]?.icon || Star;
  return (
    <TouchableOpacity
      style={styles.row}
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={`${target.name}. ${target.average ? `${target.average} out of 5 from ${target.reviewCount} reviews` : 'No reviews yet'}`}
    >
      <View style={styles.rowIcon}>
        <Icon size={18} color={FriendsColors.accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={FT.h3} numberOfLines={1}>
          {target.name}
        </Text>
        {meta ? (
          <Text style={FT.small} numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
          <Stars value={target.average} size={12} />
          <Text style={FT.small}>{target.reviewCount ? `${target.average?.toFixed(1)} · ${target.reviewCount} reviews` : 'No reviews yet'}</Text>
        </View>
      </View>
      <ChevronRight size={18} color={FriendsColors.muted} />
    </TouchableOpacity>
  );
};

type TargetExtra = { target: ReviewTarget; myReview: { id: string; status: ReviewStatus } | null };

/** One review page: average, distribution, my review status, and every published review (reviewers never shown). */
export const ReviewTargetScreen: React.FC<{ id: string; initial?: ReviewTarget | null }> = ({ id, initial }) => {
  const nav = useForumNav();
  const paged = usePaged<ForumPost, TargetExtra>(
    `target:${id}`,
    async (cursor) => {
      const r = await fetchReviewTarget(id, cursor);
      return { items: r.items, nextCursor: r.nextCursor, extra: { target: r.target, myReview: r.myReview } };
    },
    { onError: nav.onGateError }
  );
  const target = paged.extra?.target || initial || null;
  const myReview = paged.extra?.myReview || null;

  if (!target) {
    return (
      <View style={fui.screen}>
        <ForumHeader title="Reviews" onBack={nav.back} />
        {paged.error ? <FriendsError message={forumErrorMessage(paged.error, "Couldn't load reviews.")} onRetry={paged.reload} /> : <FriendsSkeleton rows={3} />}
      </View>
    );
  }

  const dist = target.distribution;
  const total = dist ? Object.values(dist).reduce((a, b) => a + b, 0) : 0;
  const meta = [target.meta?.code, target.meta?.department, target.meta?.block].filter(Boolean).join(' · ');

  const header = (
    <View style={{ gap: FS.md, marginBottom: FS.md }}>
      <View style={styles.summary}>
        <Text style={FT.kicker}>{REVIEW_KIND_META[target.kind]?.label}</Text>
        <Text style={[FT.h1, { marginTop: 4 }]} accessibilityRole="header">
          {target.name}
        </Text>
        {meta ? <Text style={FT.small}>{meta}</Text> : null}
        <View style={styles.avgRow}>
          <View style={{ alignItems: 'center', minWidth: 84 }} accessible accessibilityLabel={target.average ? `Average ${target.average} out of 5 from ${target.reviewCount} reviews` : 'No reviews yet'}>
            <Text style={styles.avg}>{target.average ? target.average.toFixed(1) : '–'}</Text>
            <Stars value={target.average} size={13} />
            <Text style={[FT.small, { marginTop: 4 }]}>{target.reviewCount} reviews</Text>
          </View>
          {dist ? (
            <View style={{ flex: 1, gap: 4 }}>
              {[5, 4, 3, 2, 1].map((s) => {
                const n = (dist as any)[String(s)] || 0;
                const pct = total ? n / total : 0;
                return (
                  <View key={s} style={styles.barRow} accessible accessibilityLabel={`${s} stars: ${n}`}>
                    <Text style={styles.barLabel}>{s}</Text>
                    <View style={styles.barTrack}>
                      <View style={[styles.barFill, { width: `${Math.round(pct * 100)}%` }]} />
                    </View>
                    <Text style={styles.barCount}>{n}</Text>
                  </View>
                );
              })}
            </View>
          ) : null}
        </View>
      </View>

      {myReview ? (
        <View style={styles.mine} accessibilityRole="text">
          {myReview.status === 'pending_review' ? <Hourglass size={14} color={FriendsColors.warn} /> : <Star size={14} color={FriendsColors.accent} />}
          <Text style={[FT.small, { flex: 1 }]}>
            {myReview.status === 'pending_review'
              ? 'Your review is being checked by a person before it is published.'
              : myReview.status === 'published'
              ? 'You reviewed this. Use the … menu on your review to edit or delete it.'
              : 'Your review was taken down. You can appeal in Me › Friends privacy & safety.'}
          </Text>
        </View>
      ) : (
        <TouchableOpacity style={fui.primaryBtn} onPress={() => nav.openComposer({ type: 'review', reviewTarget: target })} accessibilityRole="button" accessibilityLabel={`Write a review of ${target.name}`}>
          <PenLine size={18} color={FriendsColors.accentInk} />
          <Text style={fui.primaryBtnText}>Write a review</Text>
        </TouchableOpacity>
      )}
      <Text style={FT.small}>Reviews are anonymous and reflect individual experiences, not verified facts. Faculty and official accounts can reply.</Text>
    </View>
  );

  return (
    <View style={fui.screen}>
      <ForumHeader title={target.name} subtitle={REVIEW_KIND_META[target.kind]?.label} onBack={nav.back} />
      <PostList
        paged={paged}
        header={header}
        empty={<FriendsEmpty compact icon={<Star size={22} color={FriendsColors.accent} />} title="No reviews yet" subtitle="Be the first to share an honest, respectful review." />}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 0 },
  searchInput: { flex: 1, color: FriendsColors.ink, fontSize: 15, minHeight: 44 },
  row: { flexDirection: 'row', alignItems: 'center', gap: FS.md, padding: FS.md, borderRadius: FR.card, backgroundColor: FriendsColors.card, borderWidth: 1, borderColor: FriendsColors.line },
  rowIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: FriendsColors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  summary: { padding: FS.lg, borderRadius: FR.card, backgroundColor: FriendsColors.card, borderWidth: 1, borderColor: FriendsColors.line },
  avgRow: { flexDirection: 'row', alignItems: 'center', gap: FS.lg, marginTop: FS.lg },
  avg: { fontSize: 34, fontWeight: '800', color: FriendsColors.ink },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  barLabel: { width: 10, fontSize: 12, fontWeight: '700', color: FriendsColors.muted },
  barTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: FriendsColors.cardHi, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3, backgroundColor: FriendsColors.gold },
  barCount: { width: 24, fontSize: 12, color: FriendsColors.muted, textAlign: 'right' },
  mine: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: FS.md, borderRadius: FR.md, backgroundColor: FriendsColors.accentSoft },
});
