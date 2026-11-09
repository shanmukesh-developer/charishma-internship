import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, RefreshControl, ActivityIndicator, StyleSheet, Alert } from 'react-native';
import { Search, X, Bookmark, PenLine, ShieldCheck, Flag, ScrollText, Inbox } from '../../../../components/lucide';
import { FriendsColors, FS, FT, FR, fui, SectionTints } from '../friendsTheme';
import { FriendsEmpty, FriendsError } from '../shared/FriendsEmpty';
import { FriendsSkeleton } from '../shared/FriendsSkeleton';
import { RelativeTime } from '../shared/RelativeTime';
import { identityLabel } from '../shared/IdentityChip';
import { FriendsSheet } from '../shared/FriendsSheet';
import {
  ForumPost,
  ForumPostType,
  ForumModReport,
  ForumModLogItem,
  fetchForumBookmarks,
  fetchMyForumPosts,
  searchForum,
  fetchModReports,
  dismissModReport,
  fetchModLog,
  FORUM_LIMITS,
} from '../api/forumApi';
import { useForumNav } from './forumNav';
import { usePaged } from './usePaged';
import { Chips, ForumHeader, PostList, SoftError } from './ForumUi';
import { POST_TYPE_META, forumErrorMessage } from './forumShared';

import { themedSheet } from '../../../../utils/themeNow';
// ── Search ────────────────────────────────────────────────────────────────────
export const ForumSearchScreen: React.FC<{ communityId?: string | null; communityName?: string | null }> = ({ communityId, communityName }) => {
  const nav = useForumNav();
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [type, setType] = useState<ForumPostType | 'all'>('all');

  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);

  const ready = term.length >= 2;
  const paged = usePaged<ForumPost>(
    ready ? `search:${communityId || 'all'}:${type}:${term.toLowerCase()}` : null,
    (cursor) => searchForum(term, { communityId, type: type === 'all' ? null : type, cursor }),
    { onError: nav.onGateError }
  );

  const types = [{ key: 'all' as const, label: 'All' }, ...(Object.keys(POST_TYPE_META) as ForumPostType[]).map((t) => ({ key: t, label: POST_TYPE_META[t].short }))];

  return (
    <View style={fui.screen}>
      <ForumHeader title={communityName ? `Search ${communityName}` : 'Search Forum'} onBack={nav.back} />
      <View style={{ paddingHorizontal: FS.lg, paddingTop: FS.md, gap: FS.sm }}>
        <View style={[fui.input, styles.search]}>
          <Search size={16} color={FriendsColors.faint} />
          <TextInput
            style={styles.searchInput}
            value={q}
            onChangeText={setQ}
            placeholder="Search questions, guides, reviews"
            placeholderTextColor={FriendsColors.faint}
            autoFocus
            returnKeyType="search"
            accessibilityLabel="Search the Forum"
          />
          {q ? (
            <TouchableOpacity onPress={() => setQ('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear search">
              <X size={16} color={FriendsColors.muted} />
            </TouchableOpacity>
          ) : null}
        </View>
        <Chips label="Post type" options={types} value={type} onChange={(k) => setType(k as any)} />
      </View>
      {ready ? (
        <PostList
          paged={paged}
          showCommunity={!communityId}
          empty={<FriendsEmpty compact icon={<Search size={22} color={FriendsColors.accent} />} title="Nothing found" subtitle="Try other words, or ask it as a new question." actionLabel="Ask a question" onAction={() => nav.openComposer({ type: 'question' })} />}
        />
      ) : (
        <FriendsEmpty compact icon={<Search size={22} color={FriendsColors.accent} />} title="Search your campus Forum" subtitle="Type at least 2 characters." />
      )}
    </View>
  );
};

// ── My posts / Saved ──────────────────────────────────────────────────────────
export const ForumLibraryScreen: React.FC<{ tab: 'mine' | 'saved' }> = ({ tab: initialTab }) => {
  const nav = useForumNav();
  const [tab, setTab] = useState<'mine' | 'saved'>(initialTab);
  const paged = usePaged<ForumPost>(`library:${tab}`, (cursor) => (tab === 'mine' ? fetchMyForumPosts(cursor) : fetchForumBookmarks(cursor)), { onError: nav.onGateError });
  return (
    <View style={fui.screen}>
      <ForumHeader title={tab === 'mine' ? 'My posts' : 'Saved'} onBack={nav.back} />
      <View style={{ paddingHorizontal: FS.lg, paddingTop: FS.md }}>
        <Chips
          label="Library"
          options={[
            { key: 'mine', label: 'My posts' },
            { key: 'saved', label: 'Saved' },
          ]}
          value={tab}
          onChange={setTab}
        />
      </View>
      <PostList
        paged={paged}
        showCommunity
        keepRemoved={tab === 'mine'}
        empty={
          tab === 'mine' ? (
            <FriendsEmpty
              compact
              icon={<PenLine size={22} color={FriendsColors.accent} />}
              title="You haven't posted yet"
              subtitle="Posts under review or removed by moderators also show here, with the reason."
              actionLabel="Write a post"
              onAction={() => nav.openComposer({})}
            />
          ) : (
            <FriendsEmpty compact icon={<Bookmark size={22} color={FriendsColors.accent} />} title="Nothing saved" subtitle="Tap the bookmark on any post to keep it here." />
          )
        }
      />
    </View>
  );
};

// ── Moderator queue and mod log ───────────────────────────────────────────────
const SEVERITY_COLOR: Record<string, string> = {
  critical: FriendsColors.danger,
  high: FriendsColors.danger,
  medium: FriendsColors.warn,
  low: FriendsColors.muted,
};

export const ModQueueScreen: React.FC<{ communityId?: string | null }> = ({ communityId }) => {
  const nav = useForumNav();
  const moderated = nav.communities.filter((c) => !!c.myRole);
  const [scope, setScope] = useState<string>(communityId || 'all');
  const [tab, setTab] = useState<'reports' | 'log'>('reports');
  const [items, setItems] = useState<ForumModReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<any>(null);
  const [dismissing, setDismissing] = useState<ForumModReport | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [dError, setDError] = useState<string | null>(null);

  const logCommunity = scope === 'all' ? moderated[0]?.id || null : scope;
  const log = usePaged<ForumModLogItem>(tab === 'log' && logCommunity ? `modlog:${logCommunity}` : null, (cursor) => fetchModLog(logCommunity as string, cursor));

  const load = async (mode: 'initial' | 'refresh' = 'initial') => {
    if (mode === 'refresh') setRefreshing(true);
    else setLoading(true);
    try {
      setItems(await fetchModReports(scope === 'all' ? null : scope));
      setError(null);
    } catch (e: any) {
      nav.onGateError(e);
      setError(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (tab === 'reports') load();
  }, [scope, tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const dismiss = async () => {
    if (!dismissing || busy) return;
    setBusy(true);
    setDError(null);
    try {
      await dismissModReport(dismissing.reportId, reason.trim() || undefined);
      setItems((prev) => prev.filter((r) => r.reportId !== dismissing.reportId));
      setDismissing(null);
    } catch (e: any) {
      setDError(forumErrorMessage(e, "Couldn't dismiss."));
    } finally {
      setBusy(false);
    }
  };

  const scopeOptions = [{ key: 'all', label: 'All my communities' }, ...moderated.map((c) => ({ key: c.id, label: c.name }))];
  const logScopeOptions = moderated.map((c) => ({ key: c.id, label: c.name }));

  return (
    <View style={fui.screen}>
      <ForumHeader title="Moderation" subtitle="Your communities only" onBack={nav.back} />
      <View style={{ paddingHorizontal: FS.lg, paddingTop: FS.md, gap: FS.sm }}>
        <Chips
          label="View"
          options={[
            { key: 'reports', label: 'Reports', icon: <Flag size={13} color={tab === 'reports' ? SectionTints.forum.fg : FriendsColors.muted} /> },
            { key: 'log', label: 'Mod log', icon: <ScrollText size={13} color={tab === 'log' ? SectionTints.forum.fg : FriendsColors.muted} /> },
          ]}
          value={tab}
          onChange={setTab}
        />
        {tab === 'reports' && moderated.length > 1 ? <Chips label="Community" options={scopeOptions} value={scope} onChange={setScope} /> : null}
        {tab === 'log' && moderated.length > 1 ? <Chips label="Community" options={logScopeOptions} value={logCommunity || ''} onChange={setScope} /> : null}
      </View>

      {tab === 'reports' ? (
        <FlatList
          data={loading || error ? [] : items}
          keyExtractor={(r) => r.reportId}
          contentContainerStyle={{ padding: FS.lg, paddingBottom: 80 }}
          ItemSeparatorComponent={() => <View style={{ height: FS.sm }} />}
          renderItem={({ item }) => (
            <View style={styles.report}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={[styles.sev, { backgroundColor: SEVERITY_COLOR[item.severity] || FriendsColors.muted }]} />
                <Text style={[FT.small, { fontWeight: '800', color: SEVERITY_COLOR[item.severity] }]}>{item.severity.toUpperCase()}</Text>
                <Text style={FT.small}>
                  · {item.targetType === 'forum_post' ? 'Post' : item.targetType === 'forum_comment' ? 'Comment' : 'Review'} · {item.reportCount} report{item.reportCount > 1 ? 's' : ''}
                  {item.isSystem ? ' · automatic check' : ''}
                </Text>
                <View style={{ flex: 1 }} />
                <RelativeTime value={item.lastReportedAt} />
              </View>
              <Text style={[FT.small, { marginTop: 6 }]}>{item.categories.join(', ')}</Text>
              <Text style={[FT.body, { marginTop: 6 }]} numberOfLines={4}>
                {item.snapshot.anonymous ? `${item.snapshot.alias || 'Anonymous'}: ` : ''}
                {item.snapshot.excerpt || '(no text)'}
              </Text>
              <View style={{ flexDirection: 'row', gap: FS.sm, marginTop: FS.md }}>
                {item.postId ? (
                  <TouchableOpacity style={[fui.ghostBtn, { flex: 1 }]} onPress={() => nav.push({ name: 'post', id: item.postId as string })} accessibilityRole="button" accessibilityLabel="Open the reported content">
                    <Text style={fui.ghostBtnText}>Open</Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity
                  style={[fui.ghostBtn, { flex: 1 }]}
                  onPress={() => {
                    if (item.severity === 'critical') {
                      Alert.alert('Left to the ZenWe team', 'Reports about threats or self-harm are reviewed by the ZenWe team.');
                      return;
                    }
                    setReason('');
                    setDError(null);
                    setDismissing(item);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Dismiss these reports"
                >
                  <Text style={fui.ghostBtnText}>Dismiss</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
          ListHeaderComponent={
            <Text style={[FT.small, { marginBottom: FS.md }]}>
              Reporters are never shown. Open an item to remove or restore it with a reason. A report is not proof by itself.
            </Text>
          }
          ListEmptyComponent={
            loading ? (
              <FriendsSkeleton rows={3} variant="row" />
            ) : error ? (
              <FriendsError message={forumErrorMessage(error, "Couldn't load reports.")} onRetry={() => load()} />
            ) : (
              <FriendsEmpty compact icon={<ShieldCheck size={22} color={FriendsColors.accent} />} title="All clear" subtitle="No open reports in your communities." />
            )
          }
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} tintColor={FriendsColors.accent} colors={[FriendsColors.accent]} progressBackgroundColor={FriendsColors.card} />}
        />
      ) : (
        <FlatList
          data={log.loading || log.error ? [] : log.items}
          keyExtractor={(a) => a.id}
          contentContainerStyle={{ padding: FS.lg, paddingBottom: 80 }}
          ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: FriendsColors.lineSoft }} />}
          renderItem={({ item }) => (
            <View style={styles.logRow} accessible>
              <View style={{ flex: 1 }}>
                <Text style={FT.h3}>
                  {item.action.replace(/_/g, ' ')} · {item.targetType.replace(/_/g, ' ')}
                </Text>
                <Text style={FT.small}>
                  {item.moderator ? identityLabel(item.moderator as any) : 'Moderator'}
                  {item.reason ? ` · ${item.reason}` : ''}
                </Text>
              </View>
              <RelativeTime value={item.createdAt} />
            </View>
          )}
          ListEmptyComponent={
            log.loading ? (
              <FriendsSkeleton rows={3} variant="row" />
            ) : log.error ? (
              <FriendsError message={forumErrorMessage(log.error, "Couldn't load the mod log.")} onRetry={log.reload} />
            ) : (
              <FriendsEmpty compact icon={<Inbox size={22} color={FriendsColors.accent} />} title="No actions yet" />
            )
          }
          ListFooterComponent={log.softError ? <SoftError error={log.softError} onRetry={log.loadMore} /> : log.loadingMore ? <ActivityIndicator color={FriendsColors.accent} /> : null}
          onEndReached={log.loadMore}
          refreshControl={<RefreshControl refreshing={log.refreshing} onRefresh={log.refresh} tintColor={FriendsColors.accent} colors={[FriendsColors.accent]} progressBackgroundColor={FriendsColors.card} />}
        />
      )}

      <FriendsSheet visible={!!dismissing} onClose={() => setDismissing(null)} title="Dismiss reports" subtitle="Closes every open report on this item">
        <TextInput
          style={[fui.input, { minHeight: 80, textAlignVertical: 'top' }]}
          value={reason}
          onChangeText={(t) => setReason(t.slice(0, FORUM_LIMITS.modReason))}
          placeholder="Reason (optional), e.g. Doesn't break the rules"
          placeholderTextColor={FriendsColors.faint}
          multiline
          maxLength={FORUM_LIMITS.modReason}
          accessibilityLabel="Dismiss reason"
        />
        {dError ? <Text style={styles.error}>{dError}</Text> : null}
        <TouchableOpacity style={[fui.primaryBtn, { marginTop: FS.md }, busy && { opacity: 0.5 }]} onPress={dismiss} disabled={busy} accessibilityRole="button">
          {busy ? <ActivityIndicator color={FriendsColors.accentInk} /> : <Text style={fui.primaryBtnText}>Dismiss</Text>}
        </TouchableOpacity>
      </FriendsSheet>
    </View>
  );
};

const styles = themedSheet(() => ({
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 0 },
  searchInput: { flex: 1, color: FriendsColors.ink, fontSize: 15, minHeight: 44 },
  report: { padding: FS.md, borderRadius: FR.card, backgroundColor: FriendsColors.card, borderWidth: 1, borderColor: FriendsColors.line },
  sev: { width: 8, height: 8, borderRadius: 4 },
  logRow: { flexDirection: 'row', alignItems: 'center', gap: FS.md, paddingVertical: FS.md, minHeight: 52 },
  error: { marginTop: FS.md, padding: FS.md, borderRadius: FR.md, backgroundColor: FriendsColors.dangerSoft, color: FriendsColors.danger, fontSize: 13, fontWeight: '600' },
}));
