import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  TextInput,
  Platform,
  Modal,
  Alert,
  ActivityIndicator,
  Image,
} from 'react-native';
import { KeyboardAvoidingView } from '../../../components/KeyboardAvoidingView';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  Phone,
  Video,
  Paperclip,
  Send,
  Check,
  CheckCheck,
  Clock,
  CornerUpLeft,
  Smile,
  X,
  Image as ImageIcon,
  Camera,
  BarChart2,
  Trash2,
  Flag,
  Ban,
  MoreVertical,
} from '../../../components/lucide';
import * as Haptics from 'expo-haptics';
import { pickImageAsset, prepareAndUploadImage, resolveMediaUrl, ImageUploadError } from '../../../utils/imageUpload';
import { CampusColors, CampusLayout } from '../../../constants/campusTheme';
import { CampusUserData } from '../../../types/campus';
import { fetchChatMessages, fetchChats, blockCampusUser } from '../campusApi';
import { ReportSheet, ReportTarget } from '../friends/shared/ReportSheet';
import { ActionMenu } from '../friends/shared/ActionMenu';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
import { useRetentionPolicy, daysLabel } from '../useRetentionPolicy';
import { PollsSheet } from './PollsSheet';
import {
  connectCampusSocket,
  joinCampusChat,
  leaveCampusChat,
  sendCampusMessage,
  sendCampusTyping,
  sendCampusReaction,
  markCampusMessagesRead,
  deleteCampusMessage,
  subscribeCampusConnection,
  getCampusConnectionState,
} from '../campusSocketClient';

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  type?: 'text' | 'image' | 'video' | 'audio' | 'doc' | 'poll' | 'system';
  mediaUrl?: string;
  replyTo?: {
    id: string;
    senderName: string;
    text: string;
  };
  reactions?: Record<string, string>; // emoji -> count or userId -> emoji
  isEdited?: boolean;
  isDeletedForEveryone?: boolean;
  deliveryStatus?: 'clock' | 'sent' | 'delivered' | 'read';
  createdAt: string | Date;
}

interface ChatDetailScreenProps {
  chatId: string;
  chatName: string;
  currentUser: CampusUserData | null;
  onBack: () => void;
  onStartCall?: (type: 'audio' | 'video') => void;
}

const QUICK_REACTIONS = ['❤️', '👍', '😂', '😮', '😢', '🙏'];

const formatMsgTime = (value: string | Date | undefined): string => {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return typeof value === 'string' ? value : '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

export const ChatDetailScreen: React.FC<ChatDetailScreenProps> = ({
  chatId,
  chatName,
  currentUser,
  onBack,
  onStartCall,
}) => {
  const [inputText, setInputText] = useState('');
  const [typingUser, setTypingUser] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [selectedMsgForMenu, setSelectedMsgForMenu] = useState<ChatMessage | null>(null);
  const [attachmentMenuVisible, setAttachmentMenuVisible] = useState(false);
  const [pollsOpen, setPollsOpen] = useState(false);
  // C2: Report / Block (message long-press menu + header menu for the chat itself).
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
  const [chatMenuOpen, setChatMenuOpen] = useState(false);
  const [chatInfo, setChatInfo] = useState<{ isGroup: boolean; peerId: string | null; refType: string | null } | null>(null);
  const [sendingPhoto, setSendingPhoto] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const flatListRef = useRef<FlatList>(null);
  const retention = useRetentionPolicy();
  const typingTimeoutRef = useRef<any>(null);
  const isTypingRef = useRef(false);
  const loadingOlderRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      if (isTypingRef.current) sendCampusTyping(chatId, false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const currentUserIdRef = useRef<string>(currentUser?.id || 'me');
  currentUserIdRef.current = currentUser?.id || 'me';

  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const res = await fetchChatMessages(chatId);
      const mapped: ChatMessage[] = (res.messages || []).map((m) => ({
        id: m.id,
        senderId: m.senderId,
        senderName: m.senderName,
        text: m.text,
        type: m.type,
        mediaUrl: m.mediaUrl,
        replyTo: m.replyTo,
        reactions: m.reactions,
        isEdited: m.isEdited,
        isDeletedForEveryone: m.isDeletedForEveryone,
        deliveryStatus: m.deliveryStatus,
        createdAt: m.createdAt,
      }));
      if (!mountedRef.current) return;
      setMessages(mapped);
      setCursor(res.nextCursor ? String(res.nextCursor) : null);
      setHasMore(!!res.hasMore);

      // Mark everything from others as read (batched) — Section 4.1 read receipts.
      const unreadIds = mapped
        .filter((m) => m.senderId !== (currentUser?.id || 'me') && !m.isDeletedForEveryone)
        .map((m) => m.id);
      if (unreadIds.length) markCampusMessagesRead(chatId, unreadIds);
    } catch (e: any) {
      if (mountedRef.current) {
        setHistoryError(e?.message || "Couldn't load messages. Check your connection and try again.");
      }
    } finally {
      if (mountedRef.current) setHistoryLoading(false);
    }
  }, [chatId, currentUser?.id]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // After a reconnect (network drop, app back from background) pull in anything that arrived
  // while we were offline; live socket events only cover the time we were connected.
  useEffect(() => {
    let prev = getCampusConnectionState();
    const unsubscribe = subscribeCampusConnection((state) => {
      const wasDown = prev !== 'connected';
      prev = state;
      if (state !== 'connected' || !wasDown) return;
      fetchChatMessages(chatId)
        .then((res) => {
          if (!mountedRef.current) return;
          const latest: ChatMessage[] = (res.messages || []).map((m) => ({
            id: m.id,
            senderId: m.senderId,
            senderName: m.senderName,
            text: m.text,
            type: m.type,
            mediaUrl: m.mediaUrl,
            replyTo: m.replyTo,
            reactions: m.reactions,
            isEdited: m.isEdited,
            isDeletedForEveryone: m.isDeletedForEveryone,
            deliveryStatus: m.deliveryStatus,
            createdAt: m.createdAt,
          }));
          setMessages((cur) => {
            const known = new Set(cur.map((m) => m.id));
            const missed = latest.filter((m) => !known.has(m.id));
            if (!missed.length) return cur;
            const merged = [...cur, ...missed];
            merged.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
            return merged;
          });
          const unreadIds = latest
            .filter((m) => m.senderId !== currentUserIdRef.current && !m.isDeletedForEveryone)
            .map((m) => m.id);
          if (unreadIds.length) markCampusMessagesRead(chatId, unreadIds);
        })
        .catch(() => {
          // Best effort: the user can still pull history by reopening the chat.
        });
    });
    return unsubscribe;
  }, [chatId]);

  const loadOlder = async () => {
    if (!hasMore || !cursor || loadingMore) return;
    loadingOlderRef.current = true;
    setLoadingMore(true);
    try {
      const res = await fetchChatMessages(chatId, cursor);
      const older: ChatMessage[] = (res.messages || []).map((m) => ({
        id: m.id,
        senderId: m.senderId,
        senderName: m.senderName,
        text: m.text,
        type: m.type,
        mediaUrl: m.mediaUrl,
        replyTo: m.replyTo,
        reactions: m.reactions,
        isEdited: m.isEdited,
        isDeletedForEveryone: m.isDeletedForEveryone,
        deliveryStatus: m.deliveryStatus,
        createdAt: m.createdAt,
      }));
      if (!mountedRef.current) return;
      setMessages((prev) => {
        const existing = new Set(prev.map((m) => m.id));
        const fresh = older.filter((m) => !existing.has(m.id));
        return [...fresh, ...prev];
      });
      setCursor(res.nextCursor ? String(res.nextCursor) : null);
      setHasMore(!!res.hasMore);
    } catch (e) {
      // Older history is best-effort; the button stays so the user can tap again.
    } finally {
      if (mountedRef.current) setLoadingMore(false);
    }
  };

  // Connect socket and listen
  useEffect(() => {
    const socket = connectCampusSocket();
    joinCampusChat(chatId);

    const onNewMessage = (msg: any) => {
      if (msg.chatId !== chatId) return;

      const incoming: ChatMessage = {
        id: msg.id,
        senderId: msg.senderId,
        senderName: msg.senderName,
        text: msg.text,
        type: msg.type,
        mediaUrl: msg.mediaUrl,
        replyTo: msg.replyTo,
        reactions: msg.reactions,
        isEdited: msg.isEdited,
        isDeletedForEveryone: msg.isDeletedForEveryone,
        deliveryStatus: msg.deliveryStatus,
        createdAt: msg.createdAt,
      };

      setMessages((prev) => {
        // Reconcile our own optimistic send: match by clientMsgId, else by server id.
        const optimisticIdx = prev.findIndex(
          (m) =>
            (msg.clientMsgId && m.id === msg.clientMsgId) ||
            m.id === msg.id
        );
        if (optimisticIdx !== -1) {
          const next = [...prev];
          next[optimisticIdx] = { ...next[optimisticIdx], ...incoming };
          return next;
        }
        // Guard against a duplicate broadcast of an id we already have.
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, incoming];
      });

      const isOwn = msg.senderId === currentUserIdRef.current;
      if (!isOwn && msg.id) {
        markCampusMessagesRead(chatId, [msg.id]);
      }
    };

    // Auto-clear so a lost "stopped typing" event never leaves "X is typing..." stuck.
    let typingClearTimer: ReturnType<typeof setTimeout> | null = null;
    const onTyping = (data: any) => {
      if (data?.chatId !== chatId) return;
      if (typingClearTimer) clearTimeout(typingClearTimer);
      typingClearTimer = null;
      if (data.isTyping) {
        setTypingUser(data.userName || 'Someone');
        typingClearTimer = setTimeout(() => {
          if (mountedRef.current) setTypingUser(null);
        }, 6000);
      } else {
        setTypingUser(null);
      }
    };

    const onMessageUpdated = (data: any) => {
      if (data.chatId === chatId) {
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id === data.id) {
              return {
                ...m,
                text: data.text !== undefined ? data.text : m.text,
                reactions: data.reactions !== undefined ? data.reactions : m.reactions,
                isEdited: data.isEdited !== undefined ? data.isEdited : m.isEdited,
                isDeletedForEveryone: data.isDeletedForEveryone !== undefined ? data.isDeletedForEveryone : m.isDeletedForEveryone,
              };
            }
            return m;
          })
        );
      }
    };

    // Live blue ticks: someone else in this chat read our messages (same rule as the server's history).
    const onReceiptUpdate = (data: any) => {
      if (data?.chatId !== chatId || !Array.isArray(data.messageIds)) return;
      if (data.userId && data.userId === currentUserIdRef.current) return;
      const readIds = new Set(data.messageIds.map(String));
      setMessages((prev) =>
        prev.map((m) =>
          readIds.has(String(m.id)) && m.senderId === currentUserIdRef.current && m.deliveryStatus !== 'read'
            ? { ...m, deliveryStatus: 'read' }
            : m
        )
      );
    };

    socket.on('message:new', onNewMessage);
    socket.on('typing', onTyping);
    socket.on('message:updated', onMessageUpdated);
    socket.on('receipt:update', onReceiptUpdate);

    return () => {
      if (typingClearTimer) clearTimeout(typingClearTimer);
      leaveCampusChat(chatId);
      socket.off('message:new', onNewMessage);
      socket.off('typing', onTyping);
      socket.off('message:updated', onMessageUpdated);
      socket.off('receipt:update', onReceiptUpdate);
    };
  }, [chatId]);

  const handleTextChange = (text: string) => {
    setInputText(text);

    // Debounced typing indicator: emit "typing" once, then "stopped" after a pause.
    if (!isTypingRef.current && text.length > 0) {
      isTypingRef.current = true;
      sendCampusTyping(chatId, true);
    }
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      if (isTypingRef.current) {
        isTypingRef.current = false;
        sendCampusTyping(chatId, false);
      }
    }, 2500);
  };

  const handleSend = async () => {
    const textToSend = inputText.trim();
    if (!textToSend) return;

    setInputText('');
    const replyContext = replyingTo
      ? {
          id: replyingTo.id,
          senderName: replyingTo.senderName,
          text: replyingTo.text || (replyingTo.type === 'image' ? '📷 Photo' : ''),
        }
      : undefined;
    setReplyingTo(null);

    // Optimistic local add
    const clientMsgId = `client-${Date.now()}`;
    const optimisticMsg: ChatMessage = {
      id: clientMsgId,
      senderId: currentUser?.id || 'me',
      senderName: currentUser?.name || 'You',
      text: textToSend,
      type: 'text',
      replyTo: replyContext,
      deliveryStatus: 'clock',
      createdAt: new Date(),
    };

    setMessages((prev) => [...prev, optimisticMsg]);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    try {
      const res = await sendCampusMessage(chatId, {
        text: textToSend,
        type: 'text',
        replyTo: replyContext,
        clientMsgId,
      });

      // Update delivery status
      setMessages((prev) =>
        prev.map((m) =>
          m.id === clientMsgId
            ? { ...m, id: res.id, deliveryStatus: 'sent' }
            : m
        )
      );
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      if (isTypingRef.current) {
        isTypingRef.current = false;
        sendCampusTyping(chatId, false);
      }
    } catch (e) {
      if (!mountedRef.current) return;
      // Roll back the optimistic bubble and give the text back so nothing is lost.
      setMessages((prev) => prev.filter((m) => m.id !== clientMsgId));
      setInputText((current) => (current ? current : textToSend));
      if (replyContext) setReplyingTo((cur) => cur || ({ ...replyContext, senderId: '', createdAt: new Date() } as ChatMessage));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      const code = (e as any)?.code;
      if (code === 'CONTENT_BLOCKED') {
        Alert.alert('Please rephrase', (e as any)?.message || "That has words that aren't allowed on ZenWe. Please rephrase it and try again.");
      } else if (code === 'BLOCKED' || code === 'RATE_LIMITED' || code === 'CHAT_CLOSED') {
        Alert.alert('Message not sent', (e as any)?.message || "We couldn't send your message.");
      } else {
        Alert.alert('Message not sent', "We couldn't send your message. Check your connection and tap send again.");
      }
    }
  };

  /** Hides everything from a person I just blocked (the server leaves them out from now on). */
  const dropSender = (userId: string) => {
    setMessages((prev) => prev.filter((m) => String(m.senderId) !== String(userId)));
  };

  const confirmBlock = (userId: string, name: string) => {
    Alert.alert(
      `Block ${name}?`,
      "They won't be able to message or call you, and you won't see their messages in groups. They aren't told.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: async () => {
            try {
              await blockCampusUser(userId);
              if (!mountedRef.current) return;
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
              dropSender(userId);
            } catch (err: any) {
              Alert.alert("Couldn't block", err?.message || 'Please try again.');
            }
          },
        },
      ]
    );
  };

  const openChatMenu = async () => {
    if (!chatInfo) {
      try {
        const list = await fetchChats();
        const me = list.find((c: any) => c.id === chatId) as any;
        if (!mountedRef.current) return;
        setChatInfo({ isGroup: !!me?.isGroup, peerId: me?.peerId || null, refType: me?.refType || null });
      } catch {
        if (!mountedRef.current) return;
        Alert.alert("Couldn't load options", 'Please try again in a moment.');
        return;
      }
    }
    setChatMenuOpen(true);
  };

  // Pick -> compress (1280 px JPEG) -> upload to campus media -> send only the short URL over the socket.
  const sendPhotoAsset = async (asset: { uri: string; width?: number; height?: number }) => {
    const clientMsgId = `client-${Date.now()}`;
    const optimisticMsg: ChatMessage = {
      id: clientMsgId,
      senderId: currentUser?.id || 'me',
      senderName: currentUser?.name || 'You',
      text: '',
      type: 'image',
      mediaUrl: asset.uri,
      deliveryStatus: 'clock',
      createdAt: new Date(),
    };
    setSendingPhoto(true);
    setMessages((prev) => [...prev, optimisticMsg]);
    try {
      const uploaded = await prepareAndUploadImage(asset, 'chat');
      const res = await sendCampusMessage(chatId, {
        type: 'image',
        mediaUrl: uploaded.url,
        text: '',
        clientMsgId,
      });
      if (!mountedRef.current) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      // Keep showing the local file for our own bubble (already on the phone, no re-download).
      setMessages((prev) =>
        prev.map((m) => (m.id === clientMsgId ? { ...m, id: res.id, deliveryStatus: 'sent' } : m))
      );
    } catch (e: any) {
      if (!mountedRef.current) return;
      setMessages((prev) => prev.filter((m) => m.id !== clientMsgId));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      const message =
        e?.code === 'BLOCKED'
          ? "You can't send messages in this chat."
          : e?.message && String(e.message).length < 160
          ? e.message
          : "We couldn't send your photo. Check your connection and try again.";
      const canRetry = !(e instanceof ImageUploadError && !e.retryable) && e?.code !== 'BLOCKED' && e?.code !== 'BAD_MEDIA';
      Alert.alert(
        'Photo not sent',
        message,
        canRetry
          ? [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Retry', onPress: () => sendPhotoAsset(asset) },
            ]
          : undefined
      );
    } finally {
      if (mountedRef.current) setSendingPhoto(false);
    }
  };

  const pickAndSendPhoto = async (fromCamera: boolean) => {
    if (sendingPhoto) return;
    const asset = await pickImageAsset({ source: fromCamera ? 'camera' : 'library' });
    if (!asset || !mountedRef.current) return;
    await sendPhotoAsset(asset);
  };

  const handleAddReaction = (emoji: string) => {
    if (!selectedMsgForMenu) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    sendCampusReaction(selectedMsgForMenu.id, emoji);

    // Local update
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id === selectedMsgForMenu.id) {
          const reactions = { ...(m.reactions || {}) };
          reactions[currentUser?.id || 'me'] = emoji;
          return { ...m, reactions };
        }
        return m;
      })
    );
    setSelectedMsgForMenu(null);
  };

  const handleDeleteMessage = (forEveryone: boolean) => {
    if (!selectedMsgForMenu) return;
    const target = selectedMsgForMenu;
    setSelectedMsgForMenu(null);
    deleteCampusMessage(target.id, forEveryone)
      .then(() => {
        if (!mountedRef.current) return;
        setMessages((prev) =>
          forEveryone
            ? prev.map((m) =>
                m.id === target.id
                  ? { ...m, text: 'This message was deleted', mediaUrl: undefined, isDeletedForEveryone: true }
                  : m
              )
            : prev.filter((m) => m.id !== target.id)
        );
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      })
      .catch((e: any) => {
        if (!mountedRef.current) return;
        Alert.alert(
          "Couldn't delete message",
          typeof e?.message === 'string' && e.message ? e.message : 'Please try again.'
        );
      });
  };

  const renderDeliveryTick = (status?: string) => {
    if (status === 'read') return <CheckCheck size={14} color="#9DB4FF" strokeWidth={2.2} />;
    if (status === 'delivered') return <CheckCheck size={14} color="rgba(255,255,255,0.7)" strokeWidth={2} />;
    if (status === 'sent') return <Check size={14} color="rgba(255,255,255,0.7)" strokeWidth={2} />;
    return <Clock size={12} color="rgba(255,255,255,0.7)" />;
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      {/* 1. Header Bar */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={onBack}>
          <ArrowLeft size={22} color={CampusColors.ink} />
        </TouchableOpacity>

        <View style={styles.headerInfo}>
          <Text style={styles.headerTitle} numberOfLines={1}>{chatName}</Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {typingUser ? `${typingUser} is typing...` : 'Campus chat'}
          </Text>
        </View>

        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.headerActionBtn}
            onPress={() => onStartCall?.('audio')}
          >
            <Phone size={18} color={CampusColors.ink} strokeWidth={2} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.headerActionBtn}
            onPress={() => onStartCall?.('video')}
          >
            <Video size={19} color={CampusColors.ink} strokeWidth={2} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerActionBtn} onPress={openChatMenu} accessibilityRole="button" accessibilityLabel="Chat options">
            <MoreVertical size={18} color={CampusColors.ink} strokeWidth={2} />
          </TouchableOpacity>
        </View>
      </View>

      <KeyboardAvoidingView
        style={styles.keyboardContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 10 : 0}
      >
        {/* 2. Message List */}
        {historyLoading ? (
          <View style={styles.centerState}>
            <ActivityIndicator size="large" color={CampusColors.accent} />
            <Text style={styles.centerStateText}>Loading conversation…</Text>
          </View>
        ) : historyError ? (
          <View style={styles.centerState}>
            <Text style={styles.centerErrorTitle}>Couldn't load messages</Text>
            <Text style={styles.centerErrorSubtitle}>{historyError}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={loadHistory}>
              <Text style={styles.retryBtnText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.messageList}
          onContentSizeChange={() => {
            if (loadingOlderRef.current) {
              loadingOlderRef.current = false;
              return;
            }
            flatListRef.current?.scrollToEnd({ animated: true });
          }}
          ListHeaderComponent={
            <>
              {hasMore ? (
                <TouchableOpacity
                  style={styles.loadEarlierBtn}
                  onPress={loadOlder}
                  disabled={loadingMore}
                >
                  {loadingMore ? (
                    <ActivityIndicator size="small" color={CampusColors.accent} />
                  ) : (
                    <Text style={styles.loadEarlierText}>Load earlier messages</Text>
                  )}
                </TouchableOpacity>
              ) : null}
              <Text style={styles.retentionNote}>Messages disappear after {daysLabel(retention.chatDays)}.</Text>
            </>
          }
          renderItem={({ item }) => {
            const isMe = item.senderId === currentUser?.id || item.senderId === 'me';
            const reactionList = item.reactions ? Object.values(item.reactions) : [];

            return (
              <TouchableOpacity
                style={[
                  styles.messageRow,
                  isMe ? styles.messageRowMe : styles.messageRowOther,
                ]}
                onLongPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  setSelectedMsgForMenu(item);
                }}
                activeOpacity={0.9}
              >
                <View
                  style={[
                    styles.bubble,
                    isMe ? styles.bubbleMe : styles.bubbleOther,
                  ]}
                >
                  {/* Sender Name in Group */}
                  {!isMe && (
                    <Text style={styles.senderName}>{item.senderName}</Text>
                  )}

                  {/* Quoted / Reply Preview */}
                  {item.replyTo && (
                    <View style={[styles.quotedWrap, isMe ? styles.quotedMe : styles.quotedOther]}>
                      <Text style={styles.quotedSender}>{item.replyTo.senderName}</Text>
                      <Text style={styles.quotedText} numberOfLines={1}>{item.replyTo.text}</Text>
                    </View>
                  )}

                  {/* Photo */}
                  {item.type === 'image' && !!item.mediaUrl && !item.isDeletedForEveryone && (
                    <View>
                      <Image source={{ uri: resolveMediaUrl(item.mediaUrl) || undefined }} style={styles.photo} resizeMode="cover" />
                      {item.deliveryStatus === 'clock' && (
                        <View style={styles.photoUploading}>
                          <ActivityIndicator color="#FFFFFF" />
                        </View>
                      )}
                    </View>
                  )}

                  {/* Message Body */}
                  {(!!item.text || item.type !== 'image' || item.isDeletedForEveryone) && (
                    <Text
                      style={[
                        styles.messageText,
                        isMe ? styles.messageTextMe : styles.messageTextOther,
                        item.isDeletedForEveryone && styles.deletedText,
                      ]}
                    >
                      {item.text}
                    </Text>
                  )}

                  {/* Footer (Time, Edited, Ticks) */}
                  <View style={styles.bubbleFooter}>
                    {item.isEdited && (
                      <Text style={[styles.editedTag, isMe ? styles.metaMe : styles.metaOther]}>
                        Edited •
                      </Text>
                    )}
                    <Text style={[styles.timeText, isMe ? styles.metaMe : styles.metaOther]}>
                      {formatMsgTime(item.createdAt)}
                    </Text>
                    {isMe && <View style={styles.tickWrap}>{renderDeliveryTick(item.deliveryStatus)}</View>}
                  </View>

                  {/* Reactions Pill */}
                  {reactionList.length > 0 && (
                    <View style={styles.reactionPill}>
                      <Text style={styles.reactionPillText}>{reactionList.slice(0, 3).join('')}</Text>
                      {reactionList.length > 1 && (
                        <Text style={styles.reactionCountText}>{reactionList.length}</Text>
                      )}
                    </View>
                  )}
                </View>
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateText}>No messages yet. Say hello 👋</Text>
            </View>
          }
        />
        )}

        {/* 3. Reply Bar if active */}
        {replyingTo && (
          <View style={styles.replyBar}>
            <View style={styles.replyBarLeft}>
              <CornerUpLeft size={16} color={CampusColors.accent} />
              <View style={styles.replyBarTextWrap}>
                <Text style={styles.replyBarSender}>Replying to {replyingTo.senderName}</Text>
                <Text style={styles.replyBarSnippet} numberOfLines={1}>{replyingTo.text}</Text>
              </View>
            </View>
            <TouchableOpacity onPress={() => setReplyingTo(null)}>
              <X size={18} color={CampusColors.muted} />
            </TouchableOpacity>
          </View>
        )}

        {/* 4. Bottom Input Bar */}
        <View style={styles.inputContainer}>
          <TouchableOpacity
            style={styles.attachmentBtn}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setAttachmentMenuVisible(true);
            }}
          >
            <Paperclip size={20} color={CampusColors.ink} strokeWidth={1.8} />
          </TouchableOpacity>

          <TextInput
            style={styles.textInput}
            placeholder="Message..."
            placeholderTextColor={CampusColors.muted}
            value={inputText}
            onChangeText={handleTextChange}
            multiline
            maxLength={1000}
          />

          <TouchableOpacity
            style={[styles.sendBtn, inputText.trim().length === 0 && { opacity: 0.45 }]}
            onPress={handleSend}
            disabled={inputText.trim().length === 0}
            activeOpacity={0.8}
            accessibilityLabel="Send message"
          >
            <Send size={18} color="#FFFFFF" strokeWidth={2.2} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* 5. Message Long-Press Actions Modal */}
      <Modal visible={!!selectedMsgForMenu} transparent animationType="fade" onRequestClose={() => setSelectedMsgForMenu(null)}>
        <TouchableOpacity
          style={styles.actionModalOverlay}
          activeOpacity={1}
          onPress={() => setSelectedMsgForMenu(null)}
        >
          <View style={styles.actionSheet}>
            {/* Quick Emoji Reactions */}
            <View style={styles.quickReactionsRow}>
              {QUICK_REACTIONS.map((emoji) => (
                <TouchableOpacity
                  key={emoji}
                  style={styles.emojiBtn}
                  onPress={() => handleAddReaction(emoji)}
                >
                  <Text style={styles.emojiText}>{emoji}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Menu Options */}
            <View style={styles.menuOptionsCard}>
              <TouchableOpacity
                style={styles.menuOption}
                onPress={() => {
                  setReplyingTo(selectedMsgForMenu);
                  setSelectedMsgForMenu(null);
                }}
              >
                <CornerUpLeft size={18} color={CampusColors.ink} />
                <Text style={styles.menuOptionText}>Reply</Text>
              </TouchableOpacity>

              {selectedMsgForMenu?.senderId === (currentUser?.id || 'me') && (
                <TouchableOpacity
                  style={styles.menuOption}
                  onPress={() => {
                    handleDeleteMessage(true);
                  }}
                >
                  <Trash2 size={18} color="#A3321A" />
                  <Text style={[styles.menuOptionText, { color: '#A3321A' }]}>Delete for everyone</Text>
                </TouchableOpacity>
              )}

              {/* C2: Report the message / Block its sender (someone else's, already saved on the server). */}
              {selectedMsgForMenu && selectedMsgForMenu.senderId !== (currentUser?.id || 'me') && UUID_RE.test(String(selectedMsgForMenu.id)) && !selectedMsgForMenu.isDeletedForEveryone && (
                <TouchableOpacity
                  style={styles.menuOption}
                  onPress={() => {
                    const m = selectedMsgForMenu;
                    setSelectedMsgForMenu(null);
                    setTimeout(() => setReportTarget({ type: 'message', id: m.id, label: `a message from ${m.senderName || 'this person'}` }), Platform.OS === 'ios' ? 450 : 0);
                  }}
                >
                  <Flag size={18} color="#A3321A" />
                  <Text style={[styles.menuOptionText, { color: '#A3321A' }]}>Report message</Text>
                </TouchableOpacity>
              )}
              {selectedMsgForMenu && selectedMsgForMenu.senderId !== (currentUser?.id || 'me') && UUID_RE.test(String(selectedMsgForMenu.senderId)) && (
                <TouchableOpacity
                  style={styles.menuOption}
                  onPress={() => {
                    const m = selectedMsgForMenu;
                    setSelectedMsgForMenu(null);
                    confirmBlock(String(m.senderId), m.senderName || 'this person');
                  }}
                >
                  <Ban size={18} color="#A3321A" />
                  <Text style={[styles.menuOptionText, { color: '#A3321A' }]}>Block {selectedMsgForMenu.senderName || 'sender'}</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 6. Smart Attachment Tray Modal (Section 5) */}
      <Modal visible={attachmentMenuVisible} transparent animationType="slide" onRequestClose={() => setAttachmentMenuVisible(false)}>
        <TouchableOpacity
          style={styles.actionModalOverlay}
          activeOpacity={1}
          onPress={() => setAttachmentMenuVisible(false)}
        >
          <View style={styles.attachmentSheet}>
            <Text style={styles.attachmentSheetTitle}>Share with Campus</Text>
            <View style={styles.attachmentGrid}>
              <TouchableOpacity
                style={styles.attachmentGridItem}
                onPress={() => {
                  setAttachmentMenuVisible(false);
                  // iOS can't present the picker while the tray is still sliding away.
                  setTimeout(() => pickAndSendPhoto(false), Platform.OS === 'ios' ? 400 : 0);
                }}
              >
                <View style={[styles.attachmentCircle, { backgroundColor: CampusColors.accentSoft }]}>
                  <ImageIcon size={22} color={CampusColors.accentDeep} />
                </View>
                <Text style={styles.attachmentLabel}>Photos</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.attachmentGridItem}
                onPress={() => {
                  setAttachmentMenuVisible(false);
                  // iOS can't present the picker while the tray is still sliding away.
                  setTimeout(() => pickAndSendPhoto(true), Platform.OS === 'ios' ? 400 : 0);
                }}
              >
                <View style={[styles.attachmentCircle, { backgroundColor: CampusColors.warmSoft }]}>
                  <Camera size={22} color={CampusColors.warmDeep} />
                </View>
                <Text style={styles.attachmentLabel}>Camera</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.attachmentGridItem}
                onPress={() => {
                  setAttachmentMenuVisible(false);
                  setPollsOpen(true);
                }}
              >
                <View style={[styles.attachmentCircle, { backgroundColor: CampusColors.roseSoft }]}>
                  <BarChart2 size={22} color={CampusColors.roseDeep} />
                </View>
                <Text style={styles.attachmentLabel}>Poll</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Phase 4: Polls smart-tray sheet */}
      {pollsOpen && (
        <PollsSheet chatId={chatId} currentUser={currentUser} onClose={() => setPollsOpen(false)} />
      )}

      <ReportSheet
        visible={!!reportTarget}
        onClose={() => setReportTarget(null)}
        target={reportTarget}
        onReported={() => {
          // The reporter stops seeing the message right away; our team reviews it.
          const t = reportTarget;
          if (t && t.type === 'message') setMessages((prev) => prev.filter((m) => m.id !== t.id));
        }}
      />
      <ActionMenu
        visible={chatMenuOpen}
        onClose={() => setChatMenuOpen(false)}
        title={chatName}
        report={
          chatInfo
            ? chatInfo.isGroup
              ? { type: 'group', id: chatId, label: `the group "${chatName}"` }
              : chatInfo.peerId && UUID_RE.test(chatInfo.peerId) && !chatInfo.refType
              ? { type: 'profile', id: chatInfo.peerId, label: chatName }
              : null
            : null
        }
        block={chatInfo && !chatInfo.isGroup && !chatInfo.refType && chatInfo.peerId && UUID_RE.test(chatInfo.peerId) ? { userId: chatInfo.peerId, name: chatName } : null}
        onBlocked={(uid) => dropSender(uid)}
      />

    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: CampusColors.paper,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CampusColors.card,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: CampusColors.line,
  },
  backBtn: {
    padding: 6,
    marginRight: 6,
  },
  headerInfo: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: CampusColors.ink,
  },
  headerSubtitle: {
    fontSize: 12,
    color: CampusColors.accent,
    marginTop: 1,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerActionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: CampusColors.paper,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyboardContainer: {
    flex: 1,
  },
  messageList: {
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 8,
  },
  centerStateText: {
    fontSize: 13,
    color: CampusColors.muted,
    marginTop: 4,
  },
  centerErrorTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: CampusColors.ink,
    textAlign: 'center',
  },
  centerErrorSubtitle: {
    fontSize: 13,
    color: CampusColors.muted,
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: 8,
    backgroundColor: CampusColors.accent,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 20,
  },
  retryBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  loadEarlierBtn: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  retentionNote: { textAlign: 'center', fontSize: 12, color: CampusColors.muted, marginVertical: 8 },
  loadEarlierText: {
    fontSize: 13,
    fontWeight: '600',
    color: CampusColors.accent,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyStateText: {
    fontSize: 13,
    color: CampusColors.muted,
  },
  messageRow: {
    marginVertical: 4,
    flexDirection: 'row',
  },
  messageRowMe: {
    justifyContent: 'flex-end',
  },
  messageRowOther: {
    justifyContent: 'flex-start',
  },
  bubble: {
    maxWidth: '82%',
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 6,
    borderRadius: 18,
    position: 'relative',
  },
  bubbleMe: {
    backgroundColor: CampusColors.accent,
    borderBottomRightRadius: 4,
  },
  bubbleOther: {
    backgroundColor: CampusColors.card,
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: CampusColors.line,
  },
  senderName: {
    fontSize: 12,
    fontWeight: '700',
    color: CampusColors.accentDeep,
    marginBottom: 3,
  },
  quotedWrap: {
    borderLeftWidth: 3,
    paddingLeft: 8,
    paddingVertical: 2,
    marginBottom: 6,
    borderRadius: 4,
  },
  quotedMe: {
    borderLeftColor: '#FFFFFF',
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  quotedOther: {
    borderLeftColor: CampusColors.accent,
    backgroundColor: CampusColors.paper,
  },
  quotedSender: {
    fontSize: 12,
    fontWeight: '700',
    color: CampusColors.accent,
  },
  quotedText: {
    fontSize: 12,
    color: CampusColors.muted,
  },
  photo: {
    width: 220,
    height: 220,
    borderRadius: 12,
    marginBottom: 4,
    backgroundColor: 'rgba(0,0,0,0.08)',
  },
  photoUploading: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  messageText: {
    fontSize: 15,
    lineHeight: 21,
  },
  messageTextMe: {
    color: '#FFFFFF',
  },
  messageTextOther: {
    color: CampusColors.ink,
  },
  deletedText: {
    fontStyle: 'italic',
    opacity: 0.7,
  },
  bubbleFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 4,
    gap: 4,
  },
  editedTag: {
    fontSize: 12,
  },
  timeText: {
    fontSize: 12,
  },
  metaMe: {
    color: 'rgba(255,255,255,0.7)',
  },
  metaOther: {
    color: CampusColors.muted,
  },
  tickWrap: {
    marginLeft: 2,
  },
  reactionPill: {
    position: 'absolute',
    bottom: -10,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CampusColors.card,
    borderRadius: 12,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: CampusColors.line,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
    gap: 2,
  },
  reactionPillText: {
    fontSize: 12,
  },
  reactionCountText: {
    fontSize: 12,
    fontWeight: '700',
    color: CampusColors.ink,
  },
  replyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: CampusColors.card,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: CampusColors.line,
  },
  replyBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  replyBarTextWrap: {
    flex: 1,
  },
  replyBarSender: {
    fontSize: 12,
    fontWeight: '700',
    color: CampusColors.accent,
  },
  replyBarSnippet: {
    fontSize: 12,
    color: CampusColors.muted,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CampusColors.card,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: CampusColors.line,
    gap: 8,
  },
  attachmentBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: CampusColors.paper,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textInput: {
    flex: 1,
    backgroundColor: CampusColors.paper,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 15,
    color: CampusColors.ink,
    maxHeight: 100,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: CampusColors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: CampusColors.paper,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: 24,
  },
  actionSheet: {
    backgroundColor: 'transparent',
    alignItems: 'center',
  },
  quickReactionsRow: {
    flexDirection: 'row',
    backgroundColor: CampusColors.card,
    borderRadius: 30,
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: CampusColors.line,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 8,
  },
  emojiBtn: {
    padding: 4,
  },
  emojiText: {
    fontSize: 26,
  },
  menuOptionsCard: {
    width: '100%',
    backgroundColor: CampusColors.card,
    borderRadius: 16,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: CampusColors.line,
  },
  menuOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 12,
    gap: 12,
  },
  menuOptionText: {
    fontSize: 15,
    fontWeight: '600',
    color: CampusColors.ink,
  },
  attachmentSheet: {
    backgroundColor: CampusColors.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  attachmentSheetTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: CampusColors.ink,
    marginBottom: 16,
  },
  attachmentGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 8,
  },
  attachmentGridItem: {
    alignItems: 'center',
    gap: 8,
  },
  attachmentCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachmentLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: CampusColors.ink,
  },
});
