import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  X,
  Sparkles,
  CheckCheck,
  Bell,
  MessageCircle,
  Users,
  RefreshCw,
} from '../../../components/lucide';
import * as Haptics from 'expo-haptics';
import { CampusColors, CampusLayout } from '../../../constants/campusTheme';
import {
  fetchChats,
  fetchChatMessages,
  fetchMyGroups,
  fetchAnnouncements,
} from '../campusApi';
import { markCampusMessagesRead } from '../campusSocketClient';
import { getUser } from '../../../utils/auth';

interface CatchMeUpModalProps {
  visible: boolean;
  onClose: () => void;
  onMarkAllRead: () => void;
}

type DigestItem = {
  key: string;
  kind: 'chat' | 'announcement';
  isGroup?: boolean;
  source: string;
  title: string;
  body: string;
  at: number;
  urgent?: boolean;
};

type UnreadBatch = { chatId: string; messageIds: string[] };

const WINDOW_HOURS = 24;
const MAX_CHATS = 10;
const MAX_GROUPS = 8;

const timeAgo = (ts: number) => {
  if (!ts) return '';
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
};

const toTs = (v: any) => {
  const t = v ? new Date(v).getTime() : 0;
  return Number.isNaN(t) ? 0 : t;
};

/**
 * Catch Me Up — a real digest built from the student's own data:
 * unread messages in their chats/groups and recent faculty announcements
 * from the groups they belong to. "Mark all read" sends real read receipts.
 */
export const CatchMeUpModal: React.FC<CatchMeUpModalProps> = ({
  visible,
  onClose,
  onMarkAllRead,
}) => {
  const [items, setItems] = useState<DigestItem[]>([]);
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [chatCount, setChatCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isCaughtUp, setIsCaughtUp] = useState(false);
  const batchesRef = useRef<UnreadBatch[]>([]);
  const mountedRef = useRef(true);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const me = await getUser().catch(() => null);
      const myId = me?.id ? String(me.id) : null;
      const chats = await fetchChats();
      const unreadChats = chats
        .filter((c) => (c.unreadCount || 0) > 0)
        .sort((a, b) => toTs(b.lastMessageAt) - toTs(a.lastMessageAt));

      const digest: DigestItem[] = [];
      const batches: UnreadBatch[] = [];

      const messageResults = await Promise.allSettled(
        unreadChats.slice(0, MAX_CHATS).map((c) =>
          fetchChatMessages(c.id, null, Math.min(Math.max(c.unreadCount, 1), 100))
        )
      );
      unreadChats.slice(0, MAX_CHATS).forEach((c, idx) => {
        const r = messageResults[idx];
        const msgs =
          r.status === 'fulfilled'
            ? (r.value.messages || []).filter(
                (m) => !m.isDeletedForEveryone && (!myId || String(m.senderId) !== myId)
              )
            : [];
        if (msgs.length) {
          batches.push({ chatId: c.id, messageIds: msgs.map((m) => m.id) });
        }
        const latest = msgs.reduce<(typeof msgs)[number] | null>(
          (acc, m) => (!acc || toTs(m.createdAt) > toTs(acc.createdAt) ? m : acc),
          null
        );
        const preview = latest
          ? latest.type && latest.type !== 'text'
            ? `${latest.senderName} sent ${latest.type === 'image' ? 'a photo' : latest.type === 'poll' ? 'a poll' : `a ${latest.type}`}`
            : `${c.isGroup ? `${latest.senderName}: ` : ''}${latest.text || ''}`
          : c.lastMessage || '';
        digest.push({
          key: `chat-${c.id}`,
          kind: 'chat',
          isGroup: c.isGroup,
          source: c.name || 'Chat',
          title: `${c.unreadCount} new message${c.unreadCount === 1 ? '' : 's'}`,
          body: preview,
          at: latest ? toTs(latest.createdAt) : toTs(c.lastMessageAt),
        });
      });

      // Recent faculty announcements from my groups (best effort).
      try {
        const groups = (await fetchMyGroups()).slice(0, MAX_GROUPS);
        const annResults = await Promise.allSettled(groups.map((g) => fetchAnnouncements(g.id)));
        const cutoff = Date.now() - WINDOW_HOURS * 3600 * 1000;
        groups.forEach((g, idx) => {
          const r = annResults[idx];
          if (r.status !== 'fulfilled') return;
          r.value.forEach((a: any) => {
            const at = toTs(a.createdAt);
            if (!at || at < cutoff) return;
            if (myId && Array.isArray(a.seenBy) && a.seenBy.map(String).includes(myId)) return;
            digest.push({
              key: `ann-${a.id}`,
              kind: 'announcement',
              source: g.name,
              title: a.title,
              body: `${a.facultyName ? `${a.facultyName}: ` : ''}${a.body || ''}`,
              at,
              urgent: a.priority === 'urgent' || a.priority === 'high',
            });
          });
        });
      } catch {
        // Announcements are optional in the digest; chats still show.
      }

      digest.sort((a, b) => {
        if (!!a.urgent !== !!b.urgent) return a.urgent ? -1 : 1;
        return b.at - a.at;
      });

      if (!mountedRef.current) return;
      batchesRef.current = batches;
      setItems(digest);
      setUnreadTotal(unreadChats.reduce((sum, c) => sum + (c.unreadCount || 0), 0));
      setChatCount(unreadChats.length);
    } catch (e: any) {
      if (!mountedRef.current) return;
      setError("We couldn't load your catch-up right now. Check your connection and try again.");
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    if (visible) {
      setIsCaughtUp(false);
      load();
    }
  }, [visible, load]);

  const handleMarkCaughtUp = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    batchesRef.current.forEach((b) => markCampusMessagesRead(b.chatId, b.messageIds));
    batchesRef.current = [];
    setIsCaughtUp(true);
    onMarkAllRead();
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => {
      if (mountedRef.current) onClose();
    }, 700);
  };

  const hasUnread = unreadTotal > 0;

  const renderBody = () => {
    if (loading && items.length === 0) {
      return (
        <View style={styles.stateWrap}>
          <ActivityIndicator color={CampusColors.accent} />
          <Text style={styles.summaryIntro}>Gathering what you missed…</Text>
        </View>
      );
    }
    if (error) {
      return (
        <View style={styles.stateWrap}>
          <Text style={styles.stateTitle}>Couldn't catch you up</Text>
          <Text style={[styles.summaryIntro, { textAlign: 'center' }]}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => load()}>
            <RefreshCw size={14} color="#FFFFFF" />
            <Text style={styles.caughtUpBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }
    if (items.length === 0) {
      return (
        <View style={styles.stateWrap}>
          <Text style={styles.stateEmoji}>🎉</Text>
          <Text style={styles.stateTitle}>You're all caught up</Text>
          <Text style={[styles.summaryIntro, { textAlign: 'center' }]}>
            No unread messages or new announcements. Enjoy the calm!
          </Text>
        </View>
      );
    }
    return (
      <>
        <Text style={styles.summaryIntro}>
          {hasUnread
            ? `${unreadTotal} unread message${unreadTotal === 1 ? '' : 's'} across ${chatCount} chat${chatCount === 1 ? '' : 's'}. Here's the latest:`
            : 'No unread messages. Recent announcements from your groups:'}
        </Text>
        {items.map((item) => {
          const isAnn = item.kind === 'announcement';
          return (
            <View key={item.key} style={styles.digestCard}>
              <View
                style={[
                  styles.iconWrap,
                  {
                    backgroundColor: isAnn
                      ? CampusColors.roseSoft
                      : item.isGroup
                        ? CampusColors.warmSoft
                        : CampusColors.accentSoft,
                  },
                ]}
              >
                {isAnn ? (
                  <Bell size={18} color={CampusColors.roseDeep} />
                ) : item.isGroup ? (
                  <Users size={18} color={CampusColors.warmDeep} />
                ) : (
                  <MessageCircle size={18} color={CampusColors.accentDeep} />
                )}
              </View>
              <View style={styles.cardContent}>
                <View style={styles.cardHeader}>
                  <Text style={styles.sourceText} numberOfLines={1}>
                    {isAnn ? `${item.urgent ? 'URGENT • ' : ''}${item.source}`.toUpperCase() : item.source.toUpperCase()}
                  </Text>
                  <Text style={styles.timeText}>{timeAgo(item.at)}</Text>
                </View>
                <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
                {!!item.body && (
                  <Text style={styles.cardBody} numberOfLines={3}>{item.body}</Text>
                )}
              </View>
            </View>
          );
        })}
      </>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn} accessibilityLabel="Close">
            <X size={22} color={CampusColors.ink} />
          </TouchableOpacity>
          <View style={styles.headerTitleWrap}>
            <View style={styles.badgeRow}>
              <Sparkles size={14} color="#B4561A" strokeWidth={2.4} />
              <Text style={styles.badgeText}>YOUR CAMPUS BRIEFING</Text>
            </View>
            <Text style={styles.headerTitle}>Catch Me Up</Text>
          </View>
          <View style={{ width: 36 }} />
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load(true)}
              tintColor={CampusColors.accent}
              colors={[CampusColors.accent]}
            />
          }
        >
          {renderBody()}
        </ScrollView>

        {/* Footer Button */}
        {hasUnread && !error && (
          <View style={styles.footer}>
            <TouchableOpacity
              style={[styles.caughtUpBtn, isCaughtUp && styles.caughtUpBtnDone]}
              onPress={handleMarkCaughtUp}
              disabled={isCaughtUp || loading}
            >
              <CheckCheck size={18} color="#FFFFFF" strokeWidth={2.4} />
              <Text style={styles.caughtUpBtnText}>
                {isCaughtUp ? 'All Caught Up! 🎉' : 'Mark All as Read'}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: CampusColors.paper,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    backgroundColor: CampusColors.card,
    borderBottomWidth: 1,
    borderBottomColor: CampusColors.line,
  },
  closeBtn: {
    padding: 6,
    marginRight: 8,
  },
  headerTitleWrap: {
    flex: 1,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 2,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#B4561A',
    letterSpacing: 0.8,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: CampusColors.ink,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: 16,
    gap: 12,
    paddingBottom: 36,
  },
  summaryIntro: {
    fontSize: 13,
    color: CampusColors.muted,
    lineHeight: 18,
    marginBottom: 4,
  },
  stateWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 56,
    paddingHorizontal: 16,
    gap: 10,
  },
  stateEmoji: {
    fontSize: 40,
  },
  stateTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: CampusColors.ink,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: CampusColors.accent,
    paddingHorizontal: 18,
    height: 40,
    borderRadius: CampusLayout.radius.pill,
    marginTop: 6,
  },
  digestCard: {
    flexDirection: 'row',
    backgroundColor: CampusColors.card,
    borderRadius: CampusLayout.radius.card,
    padding: 14,
    borderWidth: 1,
    borderColor: CampusColors.line,
    gap: 12,
  },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardContent: {
    flex: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  sourceText: {
    fontSize: 12,
    fontWeight: '800',
    color: CampusColors.muted,
    letterSpacing: 0.5,
  },
  timeText: {
    fontSize: 12,
    color: CampusColors.muted,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: CampusColors.ink,
    marginBottom: 4,
  },
  cardBody: {
    fontSize: 12,
    color: CampusColors.ink,
    lineHeight: 17,
  },
  footer: {
    padding: 16,
    backgroundColor: CampusColors.card,
    borderTopWidth: 1,
    borderTopColor: CampusColors.line,
  },
  caughtUpBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: CampusColors.accent,
    height: 48,
    borderRadius: CampusLayout.radius.pill,
    gap: 8,
  },
  caughtUpBtnDone: {
    backgroundColor: '#059669',
  },
  caughtUpBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
