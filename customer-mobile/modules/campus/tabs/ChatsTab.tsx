import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, TextInput } from 'react-native';
import { Sparkles, Users, ChevronRight, Search, UserPlus, MessageSquarePlus, X } from '../../../components/lucide';
import * as Haptics from 'expo-haptics';
import { CampusColors } from '../../../constants/campusTheme';
import { CampusChatListItem } from '../../../types/campus';
import { fetchChats } from '../campusApi';
import { connectCampusSocket } from '../campusSocketClient';
import { CatchMeUpModal } from '../components/CatchMeUpModal';
import { Avatar, EmptyState, ErrorState, SkeletonRows, Segmented, Button, T, S, R, ui } from '../ui';

interface ChatItem {
  id: string;
  name: string;
  avatarBg: string;
  lastMessage: string;
  time: string;
  unreadCount: number;
  type: string;
  isGroup: boolean;
  avatarUrl?: string | null;
}

interface ChatsTabProps {
  onSelectChat: (chatId: string, chatName: string) => void;
  onOpenNewChat: () => void;
  onOpenJoinGroup: () => void;
  onOpenGroups: () => void;
  onOpenRequests: () => void;
  incomingRequests: number;
  onUnreadChange?: (total: number) => void;
  /** Chat currently open in ChatDetailScreen: live updates for it must not count as unread. */
  activeChatId?: string | null;
  /** Bump to force a silent reload of the list (after a join, or when a chat closes). */
  refreshKey?: number;
}

type ChatFilter = 'all' | 'unread' | 'classes' | 'groups' | 'people';

const avatarBgFor = (type: string): string => {
  switch (type) {
    case 'class':
      return CampusColors.accentSoft;
    case 'club':
    case 'ride':
      return CampusColors.warmSoft;
    case 'study':
      return '#DCFCE7';
    case 'secret':
      return CampusColors.roseSoft;
    default:
      return CampusColors.placeholderFill;
  }
};

const formatChatTime = (value?: string | Date | null): string => {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { day: '2-digit', month: 'short' });
};

const mapServerChat = (c: CampusChatListItem): ChatItem => {
  const name = c.name || (c.isGroup ? 'Group' : 'Direct message');
  const body = c.lastMessage || (c.isGroup ? 'No messages yet' : 'Say hi 👋');
  const preview = c.isGroup && c.lastSender && c.lastMessage ? `${c.lastSender}: ${c.lastMessage}` : body;
  return {
    id: c.id,
    name,
    avatarBg: avatarBgFor(c.type),
    lastMessage: preview,
    time: formatChatTime(c.lastMessageAt),
    unreadCount: c.unreadCount || 0,
    type: c.type || (c.isGroup ? 'study' : 'dm'),
    isGroup: !!c.isGroup,
    avatarUrl: c.avatarUrl || null,
  };
};

export const ChatsTab: React.FC<ChatsTabProps> = ({
  onSelectChat,
  onOpenNewChat,
  onOpenJoinGroup,
  onOpenGroups,
  onOpenRequests,
  incomingRequests,
  onUnreadChange,
  activeChatId,
  refreshKey,
}) => {
  const [filter, setFilter] = useState<ChatFilter>('all');
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [chats, setChats] = useState<ChatItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [catchMeUpOpen, setCatchMeUpOpen] = useState(false);
  const mountedRef = useRef(true);
  const activeChatIdRef = useRef<string | null | undefined>(activeChatId);
  activeChatIdRef.current = activeChatId;
  const chatsRef = useRef<ChatItem[]>([]);
  chatsRef.current = chats;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadChats = useCallback(async () => {
    try {
      const data = await fetchChats();
      if (!mountedRef.current) return;
      const mapped = data.map(mapServerChat);
      const openId = activeChatIdRef.current;
      setChats(openId ? mapped.map((c) => (c.id === openId ? { ...c, unreadCount: 0 } : c)) : mapped);
      setError(null);
    } catch (e: any) {
      if (mountedRef.current) setError(e?.message || "Couldn't load your chats.");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadChats();
  }, [loadChats]);

  const firstRefreshKey = useRef(refreshKey);
  useEffect(() => {
    if (refreshKey === firstRefreshKey.current) return;
    loadChats();
  }, [refreshKey, loadChats]);

  // Live updates from the /campus socket namespace.
  useEffect(() => {
    const socket = connectCampusSocket();
    const onChatUpdated = (data: any) => {
      if (!data || !data.chatId) return;
      if (!chatsRef.current.some((c) => c.id === data.chatId)) {
        loadChats();
        return;
      }
      setChats((prev) => {
        const idx = prev.findIndex((c) => c.id === data.chatId);
        if (idx === -1) return prev;
        const current = prev[idx];
        const isOpen = activeChatIdRef.current === data.chatId;
        const updated: ChatItem = {
          ...current,
          lastMessage:
            current.isGroup && data.lastSender ? `${data.lastSender}: ${data.lastMessage || ''}` : data.lastMessage || current.lastMessage,
          time: formatChatTime(data.time || new Date()),
          unreadCount: isOpen ? 0 : current.unreadCount + 1,
        };
        const next = [...prev];
        next.splice(idx, 1);
        return [updated, ...next];
      });
    };
    // My own message (sent from this or another device): move the chat to the top, no unread bump.
    const onChatSelfUpdated = (data: any) => {
      if (!data || !data.chatId) return;
      if (!chatsRef.current.some((c) => c.id === data.chatId)) {
        loadChats();
        return;
      }
      setChats((prev) => {
        const idx = prev.findIndex((c) => c.id === data.chatId);
        if (idx === -1) return prev;
        const current = prev[idx];
        const text = typeof data.lastMessage === 'string' && data.lastMessage ? data.lastMessage : current.lastMessage;
        const updated: ChatItem = {
          ...current,
          lastMessage: current.isGroup ? `You: ${text || ''}` : text,
          time: formatChatTime(data.time || new Date()),
        };
        const next = [...prev];
        next.splice(idx, 1);
        return [updated, ...next];
      });
    };
    socket.on('chat:updated', onChatUpdated);
    socket.on('chat:self_updated', onChatSelfUpdated);
    return () => {
      socket.off('chat:updated', onChatUpdated);
      socket.off('chat:self_updated', onChatSelfUpdated);
    };
  }, [loadChats]);

  useEffect(() => {
    if (onUnreadChange && !loading) onUnreadChange(chats.reduce((sum, c) => sum + (c.unreadCount || 0), 0));
  }, [chats, loading, onUnreadChange]);

  const handleSelect = (id: string, name: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setChats((prev) => prev.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c)));
    onSelectChat(id, name);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadChats();
    if (mountedRef.current) setRefreshing(false);
  };

  const term = query.trim().toLowerCase();
  const filtered = chats.filter((c) => {
    if (term && !c.name.toLowerCase().includes(term)) return false;
    if (filter === 'unread') return c.unreadCount > 0;
    if (filter === 'classes') return c.type === 'class';
    if (filter === 'groups') return c.isGroup;
    if (filter === 'people') return !c.isGroup;
    return true;
  });
  const totalUnread = chats.reduce((sum, c) => sum + (c.unreadCount || 0), 0);
  const unreadChats = chats.filter((c) => c.unreadCount > 0);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: CampusColors.paper }}
      contentContainerStyle={{ padding: S.lg, paddingBottom: 96 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={CampusColors.accent} />}
      keyboardShouldPersistTaps="handled"
    >
      {/* Search existing chats (new chats start from the header +) */}
      <View style={{ flexDirection: 'row', gap: S.sm }}>
        <View style={styles.searchWrap}>
          <Search size={16} color={CampusColors.muted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search your chats"
            placeholderTextColor={CampusColors.muted}
            value={query}
            onChangeText={setQuery}
            returnKeyType="search"
          />
          {!!query && (
            <TouchableOpacity onPress={() => setQuery('')} hitSlop={8}>
              <X size={16} color={CampusColors.muted} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Friend requests (only when there are some) */}
      {incomingRequests > 0 && (
        <TouchableOpacity style={styles.slimRow} onPress={onOpenRequests} activeOpacity={0.85}>
          <UserPlus size={16} color={CampusColors.accentDeep} />
          <Text style={[styles.slimText, { color: CampusColors.accentDeep }]}>
            {incomingRequests} friend request{incomingRequests === 1 ? '' : 's'}
          </Text>
          <ChevronRight size={16} color={CampusColors.accentDeep} />
        </TouchableOpacity>
      )}

      {/* Catch me up: slim banner, only when there is something to catch up on */}
      {totalUnread > 0 && (
        <TouchableOpacity style={[styles.slimRow, { backgroundColor: CampusColors.inkCard }]} onPress={() => setCatchMeUpOpen(true)} activeOpacity={0.85}>
          <Sparkles size={16} color={CampusColors.amberOnDark} />
          <Text style={[styles.slimText, { color: '#F4F1EA' }]} numberOfLines={1}>
            {totalUnread} unread in {unreadChats.length} chat{unreadChats.length === 1 ? '' : 's'} · Catch me up
          </Text>
          <ChevronRight size={16} color={CampusColors.inkMuted} />
        </TouchableOpacity>
      )}

      <TouchableOpacity style={[styles.slimRow, { backgroundColor: CampusColors.card, borderWidth: 1, borderColor: CampusColors.line }]} onPress={onOpenGroups} activeOpacity={0.85}>
        <Users size={16} color={CampusColors.ink} />
        <Text style={[styles.slimText, { color: CampusColors.ink }]}>My groups & classrooms</Text>
        <ChevronRight size={16} color={CampusColors.muted} />
      </TouchableOpacity>

      <Segmented
        style={{ marginTop: S.md, marginBottom: S.md }}
        value={filter}
        onChange={(k) => {
          Haptics.selectionAsync();
          setFilter(k);
        }}
        options={[
          { key: 'all', label: 'All' },
          { key: 'unread', label: 'Unread', badge: unreadChats.length || undefined },
          { key: 'classes', label: 'Classes' },
          { key: 'groups', label: 'Groups' },
          { key: 'people', label: 'People' },
        ]}
      />

      {loading ? (
        <SkeletonRows rows={5} />
      ) : error && chats.length === 0 ? (
        <View style={ui.card}>
          <ErrorState
            message={error}
            onRetry={() => {
              setLoading(true);
              loadChats();
            }}
          />
        </View>
      ) : filtered.length === 0 ? (
        <View style={ui.card}>
          {chats.length === 0 ? (
            <EmptyState
              icon={<MessageSquarePlus size={22} color={CampusColors.accent} />}
              title="No chats yet"
              subtitle="Message a classmate, or join your class or club with its code."
              actionLabel="Start a chat"
              onAction={onOpenNewChat}
            />
          ) : (
            <EmptyState
              compact
              title={term ? `No chats match "${query.trim()}"` : filter === 'unread' ? "You're all caught up" : 'Nothing here yet'}
              subtitle={term ? 'Looking for someone new? Start a new chat.' : undefined}
              actionLabel={term ? 'New chat' : undefined}
              onAction={term ? onOpenNewChat : undefined}
            />
          )}
          {chats.length === 0 && (
            <View style={{ alignItems: 'center', marginTop: -S.xl, marginBottom: S.xl }}>
              <Button small variant="ghost" label="Join with a code" onPress={onOpenJoinGroup} />
            </View>
          )}
        </View>
      ) : (
        <View style={ui.card}>
          {filtered.map((item, idx) => (
            <TouchableOpacity
              key={item.id}
              style={[styles.chatRow, idx === filtered.length - 1 && { borderBottomWidth: 0 }]}
              onPress={() => handleSelect(item.id, item.name)}
              activeOpacity={0.7}
            >
              <Avatar name={item.name} uri={item.avatarUrl} size={48} rounded={!item.isGroup} bg={item.avatarBg} />
              <View style={{ flex: 1 }}>
                <View style={styles.rowTop}>
                  <Text style={[T.h3, { flex: 1, marginRight: 8 }]} numberOfLines={1}>{item.name}</Text>
                  <Text style={[T.small, item.unreadCount > 0 && { color: CampusColors.accent, fontWeight: '700' }]}>{item.time}</Text>
                </View>
                <View style={styles.rowTop}>
                  <Text style={[T.muted, { flex: 1, marginRight: 8 }, item.unreadCount > 0 && { color: CampusColors.ink, fontWeight: '600' }]} numberOfLines={1}>
                    {item.lastMessage}
                  </Text>
                  {item.unreadCount > 0 && (
                    <View style={styles.unread}>
                      <Text style={styles.unreadText}>{item.unreadCount > 99 ? '99+' : item.unreadCount}</Text>
                    </View>
                  )}
                </View>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <CatchMeUpModal
        visible={catchMeUpOpen}
        onClose={() => {
          setCatchMeUpOpen(false);
          loadChats();
        }}
        onMarkAllRead={() => {
          setChats((prev) => prev.map((c) => ({ ...c, unreadCount: 0 })));
          setTimeout(() => {
            if (mountedRef.current) loadChats();
          }, 1500);
        }}
      />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  searchWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.sm,
    height: 44,
    paddingHorizontal: 14,
    borderRadius: R.pill,
    backgroundColor: CampusColors.card,
    borderWidth: 1,
    borderColor: CampusColors.line,
  },
  searchInput: { flex: 1, fontSize: 14, color: CampusColors.ink, paddingVertical: 0 },
  newChatBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: CampusColors.accent, alignItems: 'center', justifyContent: 'center' },
  slimRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.sm,
    backgroundColor: CampusColors.accentSoft,
    borderRadius: R.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: S.md,
  },
  slimText: { flex: 1, fontSize: 14, fontWeight: '700' },
  chatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: CampusColors.line,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 },
  unread: { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: CampusColors.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  unreadText: { fontSize: 12, fontWeight: '800', color: '#FFFFFF' },
});
