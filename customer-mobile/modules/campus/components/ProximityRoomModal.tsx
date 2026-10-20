import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Platform,
  ActivityIndicator,
  Animated,
  Alert,
} from 'react-native';
import { KeyboardAvoidingView } from '../../../components/KeyboardAvoidingView';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  X,
  MapPin,
  Send,
  Radio,
  ShieldCheck,
  Wifi,
  WifiOff,
} from '../../../components/lucide';
import * as Haptics from 'expo-haptics';
import { CampusColors, CampusLayout } from '../../../constants/campusTheme';
import { CampusUserData } from '../../../types/campus';
import { fetchProximityRoomMessages, ProximityMessageItem } from '../campusApi';
import { connectCampusSocket } from '../campusSocketClient';
import { SPOT_ICON_MAP } from './LiveZones';
import { ActionMenu } from '../friends/shared/ActionMenu';


interface ProximityRoomModalProps {
  visible: boolean;
  onClose: () => void;
  roomSlug: string;
  currentUser: CampusUserData | null;
}

export const ProximityRoomModal: React.FC<ProximityRoomModalProps> = ({
  visible,
  onClose,
  roomSlug,
  currentUser,
}) => {
  const [messages, setMessages] = useState<ProximityMessageItem[]>([]);
  const [menuMsg, setMenuMsg] = useState<ProximityMessageItem | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(true);
  const [roomMeta, setRoomMeta] = useState<{
    name: string;
    subtitle: string;
    icon: string;
    emoji?: string | null;
    activeUserCount: number;
  } | null>(null);
  const [activeUsers, setActiveUsers] = useState(0);
  const [connected, setConnected] = useState(false);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const scrollRef = useRef<ScrollView>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const typingClearTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (typingTimeout.current) clearTimeout(typingTimeout.current);
      Object.values(typingClearTimers.current).forEach(clearTimeout);
      typingClearTimers.current = {};
    };
  }, []);

  // Pulse animation for live indicator
  useEffect(() => {
    if (!visible) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.4, duration: 1000, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [visible, pulseAnim]);

  // Load initial messages
  useEffect(() => {
    if (!visible || !roomSlug) return;
    setLoading(true);
    setLoadError(null);
    fetchProximityRoomMessages(roomSlug, 50)
      .then((data) => {
        if (!mountedRef.current) return;
        setRoomMeta(data.room);
        setMessages(data.messages);
        setActiveUsers(data.room.activeUserCount);
      })
      .catch((err: any) => {
        if (!mountedRef.current) return;
        setLoadError(
          typeof err?.message === 'string' && err.message && !/^Failed/i.test(err.message)
            ? err.message
            : "Couldn't load this room. Check your connection and try again."
        );
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false);
      });
  }, [visible, roomSlug, reloadKey]);

  // Socket connection for real-time
  useEffect(() => {
    if (!visible || !roomSlug) return;
    const socket = connectCampusSocket();

    socket.emit('proximity:join', { roomSlug }, (res: any) => {
      if (res?.status === 'joined') setConnected(true);
    });

    const onNewMessage = (msg: any) => {
      if (msg.roomSlug !== roomSlug) return;
      setMessages((prev) => {
        if (msg.id && prev.some((m) => m.id === msg.id)) return prev;
        // Our own broadcast: replace the matching optimistic bubble instead of duplicating it.
        if (msg.senderId && msg.senderId === currentUser?.id) {
          const idx = prev.findIndex((m) =>
            msg.clientMsgId ? m.id === msg.clientMsgId : String(m.id).startsWith('opt-') && m.text === msg.text
          );
          if (idx !== -1) {
            const next = [...prev];
            next[idx] = { ...next[idx], ...msg };
            return next;
          }
        }
        return [...prev, msg];
      });
    };

    const onPresence = (data: any) => {
      if (data.roomSlug !== roomSlug) return;
      setActiveUsers(data.activeUserCount);
    };

    const onTyping = (data: any) => {
      if (data.roomSlug !== roomSlug) return;
      if (data.userId === currentUser?.id) return;
      if (data.isTyping) {
        setTypingUsers((prev) =>
          prev.includes(data.userName) ? prev : [...prev, data.userName]
        );
        // Auto-clear after 3s
        const key = String(data.userName);
        if (typingClearTimers.current[key]) clearTimeout(typingClearTimers.current[key]);
        typingClearTimers.current[key] = setTimeout(() => {
          delete typingClearTimers.current[key];
          if (mountedRef.current) setTypingUsers((prev) => prev.filter((n) => n !== data.userName));
        }, 3000);
      } else {
        setTypingUsers((prev) => prev.filter((n) => n !== data.userName));
      }
    };

    socket.on('proximity:newMessage', onNewMessage);
    socket.on('proximity:presence', onPresence);
    socket.on('proximity:typing', onTyping);

    return () => {
      socket.emit('proximity:leave', { roomSlug });
      socket.off('proximity:newMessage', onNewMessage);
      socket.off('proximity:presence', onPresence);
      socket.off('proximity:typing', onTyping);
      setConnected(false);
    };
  }, [visible, roomSlug, currentUser?.id]);

  const handleSend = useCallback(() => {
    if (!inputText.trim() || !roomSlug) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const socket = connectCampusSocket();
    const text = inputText.trim();
    const optimisticId = `opt-${Date.now()}`;

    // Optimistic local add
    const optimisticMsg: ProximityMessageItem = {
      id: optimisticId,
      senderId: currentUser?.id || '',
      senderName: currentUser?.name || 'You',
      text,
      type: 'text',
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticMsg]);
    setInputText('');

    const fail = (reason?: string) => {
      if (!mountedRef.current) return;
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
      setInputText((cur) => cur || text);
      Alert.alert('Message not sent', reason || "We couldn't send your message. Please try again.");
    };

    socket.timeout(10000).emit(
      'proximity:message',
      { roomSlug, text, clientMsgId: optimisticId },
      (err: any, res: any) => {
        if (err) return fail();
        if (res?.error) return fail(typeof res.error === 'string' ? res.error : undefined);
        if (!mountedRef.current || !res?.id) return;
        setMessages((prev) => {
          // If the broadcast already replaced the bubble, nothing to do.
          if (prev.some((m) => m.id === res.id)) return prev.filter((m) => m.id !== optimisticId);
          return prev.map((m) => (m.id === optimisticId ? { ...m, id: res.id, createdAt: res.createdAt || m.createdAt } : m));
        });
      }
    );

    // Stop typing indicator
    socket.emit('proximity:typing', { roomSlug, isTyping: false });
  }, [inputText, roomSlug, currentUser]);

  const handleTextChange = useCallback(
    (text: string) => {
      setInputText(text);
      const socket = connectCampusSocket();
      if (text.trim()) {
        socket.emit('proximity:typing', { roomSlug, isTyping: true });
        if (typingTimeout.current) clearTimeout(typingTimeout.current);
        typingTimeout.current = setTimeout(() => {
          socket.emit('proximity:typing', { roomSlug, isTyping: false });
        }, 2000);
      } else {
        socket.emit('proximity:typing', { roomSlug, isTyping: false });
      }
    },
    [roomSlug]
  );

  const formatTime = (value?: string | Date | null): string => {
    if (!value) return '';
    const d = new Date(value);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const IconComponent = roomMeta ? SPOT_ICON_MAP[roomMeta.icon] || MapPin : MapPin;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <X size={22} color={CampusColors.ink} />
          </TouchableOpacity>
          <View style={styles.headerTitleWrap}>
            <View style={styles.headerTitleRow}>
              {roomMeta?.emoji ? <Text style={{ fontSize: 15 }}>{roomMeta.emoji}</Text> : <IconComponent size={16} color={CampusColors.accent} />}
              <Text style={styles.headerTitle}>
                {roomMeta?.name || roomSlug}
              </Text>
            </View>
            <Text style={styles.headerSubtitle}>
              {roomMeta?.subtitle || 'Open campus spot chat'}
            </Text>
            <Text style={styles.headerSubtitle}>Messages here disappear after 24 hours.</Text>
          </View>
          <View style={styles.liveBadge}>
            <Animated.View style={{ opacity: pulseAnim }}>
              <Radio size={10} color="#059669" />
            </Animated.View>
            <Text style={styles.liveText}>{activeUsers} here</Text>
          </View>
        </View>

        {/* Connection status */}
        <View
          style={[
            styles.statusBar,
            connected ? styles.statusConnected : styles.statusDisconnected,
          ]}
        >
          {connected ? (
            <>
              <Wifi size={12} color="#059669" />
              <Text style={styles.statusText}>Live • Messages expire in 24h</Text>
            </>
          ) : (
            <>
              <WifiOff size={12} color={CampusColors.sos} />
              <Text style={[styles.statusText, { color: CampusColors.sos }]}>
                Connecting...
              </Text>
            </>
          )}
        </View>

        {/* Geofence notice */}
        <View style={styles.geofenceBanner}>
          <ShieldCheck size={14} color={CampusColors.accentDeep} />
          <Text style={styles.geofenceText}>
            Open room for this campus spot. Anyone on Campus can read and post here, so keep it friendly and never share private details.
          </Text>
        </View>

        {/* Messages */}
        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color={CampusColors.accent} />
            <Text style={styles.loadingText}>Loading room...</Text>
          </View>
        ) : loadError ? (
          <View style={styles.loadingWrap}>
            <Text style={styles.emptyTitle}>Room unavailable</Text>
            <Text style={[styles.loadingText, { textAlign: 'center', paddingHorizontal: 32 }]}>{loadError}</Text>
            <TouchableOpacity
              style={styles.retryBtn}
              onPress={() => setReloadKey((k) => k + 1)}
            >
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView
            ref={scrollRef}
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
          >
            {messages.length === 0 && (
              <View style={styles.emptyWrap}>
                <MapPin size={32} color={CampusColors.muted} />
                <Text style={styles.emptyTitle}>No messages yet</Text>
                <Text style={styles.emptySubtitle}>
                  Be the first to say something here!
                </Text>
              </View>
            )}
            {messages.map((item) => {
              const isMe = item.senderId === currentUser?.id;
              return (
                <TouchableOpacity
                  key={item.id}
                  activeOpacity={0.85}
                  disabled={isMe || String(item.id).startsWith('opt-')}
                  onLongPress={() => {
                    // C2: long-press someone's message to Report it or Block them.
                    Haptics.selectionAsync().catch(() => {});
                    setMenuMsg(item);
                    setMenuOpen(true);
                  }}
                  delayLongPress={300}
                  accessibilityHint={isMe ? undefined : 'Long press for Report or Block'}
                  style={[styles.msgRow, isMe ? styles.msgRowMe : styles.msgRowOther]}
                >
                  <View
                    style={[
                      styles.bubble,
                      isMe ? styles.bubbleMe : styles.bubbleOther,
                    ]}
                  >
                    {!isMe && (
                      <Text style={styles.senderName}>{item.senderName}</Text>
                    )}
                    <Text
                      style={[styles.bubbleText, isMe && styles.bubbleTextMe]}
                    >
                      {item.text}
                    </Text>
                    <Text style={[styles.timeText, isMe && styles.timeTextMe]}>
                      {formatTime(item.createdAt)}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}

        <ActionMenu
          visible={menuOpen}
          onClose={() => setMenuOpen(false)}
          title="Message"
          report={menuMsg ? { type: 'proximity_message', id: menuMsg.id, label: `a message by ${menuMsg.senderName || 'a student'}` } : null}
          block={menuMsg && menuMsg.senderId ? { userId: String(menuMsg.senderId), name: menuMsg.senderName || 'this student' } : null}
          onReported={() => {
            const id = menuMsg?.id;
            if (id) setMessages((prev) => prev.filter((m) => m.id !== id));
          }}
          onBlocked={(uid) => setMessages((prev) => prev.filter((m) => String(m.senderId) !== String(uid)))}
        />

        {/* Typing indicator */}
        {typingUsers.length > 0 && (
          <View style={styles.typingBar}>
            <Text style={styles.typingText}>
              {typingUsers.length === 1
                ? `${typingUsers[0]} is typing...`
                : `${typingUsers.length} people typing...`}
            </Text>
          </View>
        )}

        {/* Input Bar */}
        <View style={styles.inputBar}>
          <TextInput
            style={styles.input}
            placeholder="Message this spot..."
            placeholderTextColor={CampusColors.muted}
            value={inputText}
            onChangeText={handleTextChange}
            onSubmitEditing={handleSend}
            multiline
            maxLength={500}
          />
          <TouchableOpacity
            style={[styles.sendBtn, !inputText.trim() && { opacity: 0.5 }]}
            onPress={handleSend}
            disabled={!inputText.trim()}
          >
            <Send size={16} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  retryBtn: {
    marginTop: 12,
    backgroundColor: CampusColors.accent,
    paddingHorizontal: 22,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
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
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: CampusColors.ink,
  },
  headerSubtitle: {
    fontSize: 12,
    color: CampusColors.muted,
    marginTop: 2,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: CampusLayout.radius.pill,
    gap: 4,
  },
  liveText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#166534',
  },
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 5,
    gap: 6,
  },
  statusConnected: {
    backgroundColor: '#F0FDF4',
  },
  statusDisconnected: {
    backgroundColor: '#FEF2F2',
  },
  statusText: {
    fontSize: 12,
    color: '#059669',
    fontWeight: '600',
  },
  geofenceBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CampusColors.accentSoft,
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 8,
  },
  geofenceText: {
    fontSize: 12,
    color: CampusColors.accentDeep,
    flex: 1,
    lineHeight: 15,
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: CampusColors.muted,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    gap: 10,
    flexGrow: 1,
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: CampusColors.ink,
  },
  emptySubtitle: {
    fontSize: 13,
    color: CampusColors.muted,
    textAlign: 'center',
  },
  msgRow: {
    flexDirection: 'row',
  },
  msgRowMe: {
    justifyContent: 'flex-end',
  },
  msgRowOther: {
    justifyContent: 'flex-start',
  },
  bubble: {
    maxWidth: '82%',
    padding: 12,
    borderRadius: 14,
  },
  bubbleOther: {
    backgroundColor: CampusColors.card,
    borderTopLeftRadius: 2,
    borderWidth: 1,
    borderColor: CampusColors.line,
  },
  bubbleMe: {
    backgroundColor: CampusColors.accent,
    borderTopRightRadius: 2,
  },
  senderName: {
    fontSize: 12,
    fontWeight: '700',
    color: CampusColors.accent,
    marginBottom: 4,
  },
  bubbleText: {
    fontSize: 14,
    color: CampusColors.ink,
    lineHeight: 20,
    marginBottom: 4,
  },
  bubbleTextMe: {
    color: '#FFFFFF',
  },
  timeText: {
    fontSize: 12,
    color: CampusColors.muted,
    alignSelf: 'flex-end',
  },
  timeTextMe: {
    color: 'rgba(255, 255, 255, 0.75)',
  },
  typingBar: {
    paddingHorizontal: 16,
    paddingVertical: 4,
    backgroundColor: CampusColors.card,
  },
  typingText: {
    fontSize: 12,
    color: CampusColors.accent,
    fontStyle: 'italic',
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: CampusColors.card,
    borderTopWidth: 1,
    borderTopColor: CampusColors.line,
    gap: 10,
  },
  input: {
    flex: 1,
    backgroundColor: CampusColors.paper,
    borderWidth: 1,
    borderColor: CampusColors.line,
    borderRadius: CampusLayout.radius.pill,
    paddingHorizontal: 16,
    paddingVertical: 10,
    maxHeight: 100,
    fontSize: 14,
    color: CampusColors.ink,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: CampusColors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
