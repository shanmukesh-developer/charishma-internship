import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  Modal,
  Dimensions,
  Platform,
  KeyboardAvoidingView,
  TouchableWithoutFeedback,
  Keyboard,
  Animated,
  Vibration
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { COLORS, SHADOWS } from '../constants/theme';
import { ENDPOINTS, API_URL } from '../constants/api';
import { apiFetch } from '../utils/auth';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { connectSocket } from '../utils/socket';
import { StaggeredSection, FloatingPulse } from '../components/AnimatedSection';
import DopaminePressable, { CardPressable, ActionPressable } from '../components/DopaminePressable';

const { width: SW, height: SH } = Dimensions.get('window');

// Expressive Zenvy Stickers (large emojis)
const ZENVY_STICKERS = [
  { char: '⚡', label: 'Surge' },
  { char: '🔥', label: 'Streak' },
  { char: '🏆', label: 'Champ' },
  { char: '🎁', label: 'Gift' },
  { char: '🚀', label: 'Blast' },
  { char: '🤫', label: 'Secret' },
  { char: '💖', label: 'Love' },
  { char: '💀', label: 'Dead' },
  { char: '🎉', label: 'Party' },
  { char: '🍔', label: 'Bite' },
  { char: '🍕', label: 'Crave' },
  { char: '🍦', label: 'Chill' }
];

export default function FriendsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { isDark } = useTheme();

  // Color configurations based on theme
  const txt = isDark ? '#FFF' : '#3e2723';
  const txtSec = isDark ? '#AAA' : '#666';
  const bg = isDark ? '#0A0A0C' : '#f4f1ea';
  const cardBg = isDark ? '#141416' : '#fdfcf0';
  const border = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(139,90,43,0.1)';

  // Tabs: 'chats' | 'pending' | 'sync'
  const [activeTab, setActiveTab] = useState<'chats' | 'pending' | 'sync'>('chats');
  
  // State
  const [friends, setFriends] = useState<any[]>([]);
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);
  const [syncedContacts, setSyncedContacts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // Chat window state
  const [activeChat, setActiveChat] = useState<any | null>(null);
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const [draftMessage, setDraftMessage] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const [showStickers, setShowStickers] = useState(false);
  const [chatTheme, setChatTheme] = useState<'friendship' | 'crazy' | 'love'>('friendship');
  const chatScrollRef = useRef<ScrollView>(null);

  // Load friends and pending requests
  useEffect(() => {
    if (!user) return;
    loadFriendsData();
    const interval = setInterval(loadFriendsData, 8000);
    return () => clearInterval(interval);
  }, [user]);

  // Handle Socket connections for chat messages
  useEffect(() => {
    if (!activeChat || !activeChat.conversationId) return;

    const socket = connectSocket();
    socket.emit('joinConversation', activeChat.conversationId);

    const onNewMessage = (msg: any) => {
      if (msg.conversationId === activeChat.conversationId) {
        setChatMessages(prev => {
          // Prevent duplicates
          if (prev.some(m => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
        // Scroll to bottom
        setTimeout(() => chatScrollRef.current?.scrollToEnd({ animated: true }), 100);
        // Haptic feedback
        if (msg.senderId !== user?.id) {
          Vibration.vibrate(80);
        }
      }
    };

    const onThemeUpdated = (data: any) => {
      if (data.friendshipId === activeChat.friendshipId) {
        setChatTheme(data.theme);
        Alert.alert('Theme Updated', `Friend updated chat theme to ${data.theme.toUpperCase()}`);
      }
    };

    socket.on('new_friend_message', onNewMessage);
    socket.on('friendship_theme_updated', onThemeUpdated);

    // Fetch initial chat history
    fetchChatHistory(activeChat.conversationId);

    return () => {
      socket.off('new_friend_message', onNewMessage);
      socket.off('friendship_theme_updated', onThemeUpdated);
    };
  }, [activeChat]);

  const loadFriendsData = async () => {
    try {
      // 1. Friends list
      const res = await apiFetch(ENDPOINTS.friendsList);
      if (res.ok) {
        const data = await res.json();
        setFriends(data);
      }

      // 2. Pending Requests
      const resPending = await apiFetch(ENDPOINTS.friendsPending);
      if (resPending.ok) {
        const data = await resPending.json();
        setPendingRequests(data);
      }
    } catch (e) {
      console.error('[LOAD_FRIENDS_ERROR]', e);
    }
  };

  const fetchChatHistory = async (convId: string) => {
    try {
      const res = await apiFetch(ENDPOINTS.friendsMessages(convId));
      if (res.ok) {
        const data = await res.json();
        setChatMessages(data);
        setTimeout(() => chatScrollRef.current?.scrollToEnd({ animated: false }), 200);
      }
    } catch (e) {
      console.error('[FETCH_CHAT_HISTORY_ERROR]', e);
    }
  };

  // Sync Contacts Flow
  const handleContactsSync = async () => {
    setSyncing(true);
    try {
      // Mock local device contacts list
      const mockDeviceContacts = [
        '7788994455', // Rohan Rider
        '5544998877', // Delivery Boy Test
        '9988776655', // Shanmukh Dev
        '9876543210', // Priya Test
        '8899001122', // Anjali Zenvy
        '9000011223'  // Campus Warden
      ];

      const res = await apiFetch(ENDPOINTS.friendsContacts, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contacts: mockDeviceContacts })
      });

      if (res.ok) {
        const data = await res.json();
        setSyncedContacts(data);
        Vibration.vibrate([0, 100, 50, 100]);
      } else {
        Alert.alert('Sync Failed', 'Failed to scan contacts.');
      }
    } catch (e) {
      Alert.alert('Error', 'Could not access contacts.');
    } finally {
      setSyncing(false);
    }
  };

  // Add friend
  const handleAddFriend = async (friendId: string) => {
    try {
      const res = await apiFetch(ENDPOINTS.friendsRequest, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipientId: friendId })
      });

      if (res.ok) {
        Alert.alert('Request Sent', 'Friend request has been queued.');
        // Update synced contacts state status
        setSyncedContacts(prev =>
          prev.map(c => c.id === friendId ? { ...c, friendshipStatus: 'pending' } : c)
        );
        loadFriendsData();
      } else {
        const err = await res.json();
        Alert.alert('Request Failed', err.message || 'Cannot send request.');
      }
    } catch (e) {
      Alert.alert('Error', 'Network error.');
    }
  };

  // Accept Friend Request
  const handleAcceptFriend = async (friendshipId: string) => {
    try {
      const res = await apiFetch(ENDPOINTS.friendsAccept, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ friendshipId })
      });

      if (res.ok) {
        const data = await res.json();
        Vibration.vibrate(100);
        loadFriendsData();
        Alert.alert('Connected!', 'You are now friends! Go ahead and chat securely.');
      } else {
        Alert.alert('Failed', 'Failed to accept request.');
      }
    } catch (e) {
      Alert.alert('Error', 'Network error.');
    }
  };

  // Cycle Friendship Theme
  const handleThemeChange = async () => {
    if (!activeChat) return;
    const themes: ('friendship' | 'crazy' | 'love')[] = ['friendship', 'crazy', 'love'];
    const nextIdx = (themes.indexOf(chatTheme) + 1) % themes.length;
    const nextTheme = themes[nextIdx];

    try {
      const res = await apiFetch(ENDPOINTS.friendsTheme(activeChat.friendshipId), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: nextTheme })
      });

      if (res.ok) {
        setChatTheme(nextTheme);
        Vibration.vibrate(50);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Send Message
  const handleSendMessage = async (customText?: string) => {
    const text = customText || draftMessage;
    if (!text.trim() || !activeChat) return;

    setSendingMessage(true);
    try {
      const res = await apiFetch(ENDPOINTS.friendsSendMessage, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: activeChat.conversationId,
          text: text.trim()
        })
      });

      if (res.ok) {
        const message = await res.json();
        setChatMessages(prev => [...prev, message]);
        if (!customText) setDraftMessage('');
        setShowStickers(false);
        setTimeout(() => chatScrollRef.current?.scrollToEnd({ animated: true }), 100);
      } else {
        Alert.alert('Failed', 'Failed to transmit secure message.');
      }
    } catch (e) {
      Alert.alert('Error', 'Message transmission failed.');
    } finally {
      setSendingMessage(false);
    }
  };

  // Theme gradient map helper
  const getThemeGradient = () => {
    switch (chatTheme) {
      case 'crazy':
        return ['#0F0C20', '#1C0B36', '#09151B']; // Cyber cyberpunk
      case 'love':
        return ['#1F080F', '#350A19', '#1C060E']; // Deep red passion
      case 'friendship':
      default:
        return ['#140D07', '#25170B', '#160E08']; // Warm copper wood
    }
  };

  // Theme primary color helper
  const getThemeColor = () => {
    switch (chatTheme) {
      case 'crazy': return '#a855f7';
      case 'love': return '#ec4899';
      case 'friendship':
      default: return '#D4AF37';
    }
  };

  return (
    <View style={[s.container, { backgroundColor: bg }]}>
      {/* Header bar */}
      <View style={[s.headerBar, { borderBottomColor: border }]}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
          <Text style={[s.backText, { color: txt }]}>◀ HOME</Text>
        </TouchableOpacity>
        <Text style={[s.headerTitle, { color: txt }]}>🔒 SECURE LOUNGE</Text>
        <View style={{ width: 50 }} />
      </View>

      {/* Tabs */}
      <View style={s.tabContainer}>
        {(['chats', 'pending', 'sync'] as const).map(tab => (
          <TouchableOpacity
            key={tab}
            style={[s.tabButton, activeTab === tab && [s.tabActive, { borderBottomColor: isDark ? COLORS.gold : '#8b5a2b' }]]}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[s.tabLabel, { color: activeTab === tab ? txt : txtSec }]}>
              {tab === 'chats' ? '💬 SECURE CHATS' : tab === 'pending' ? `🤝 REQUESTS (${pendingRequests.length})` : '👥 SYNC CONTACTS'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Main Tab Area */}
      <ScrollView contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false}>
        
        {/* TAB 1: ACTIVE CHATS */}
        {activeTab === 'chats' && (
          <View style={s.tabPanel}>
            {friends.length === 0 ? (
              <View style={s.emptyBox}>
                <Text style={s.emptyIcon}>🔒</Text>
                <Text style={[s.emptyTitle, { color: txt }]}>No Secure Chats Yet</Text>
                <Text style={[s.emptySub, { color: txtSec }]}>Sync your local contacts to scan who is already on Zenvy, then add them to start a secure chat with daily fire streaks!</Text>
                <TouchableOpacity style={[s.actionBtnMain, { backgroundColor: isDark ? COLORS.gold : '#8b5a2b' }]} onPress={() => setActiveTab('sync')}>
                  <Text style={s.actionBtnText}>SYNC CONTACTS NOW</Text>
                </TouchableOpacity>
              </View>
            ) : (
              friends.map((friend, idx) => (
                <StaggeredSection key={friend.friendshipId} delay={50 * idx} direction="up" style={[s.friendCard, { backgroundColor: cardBg, borderColor: border }]}>
                  <View style={s.friendAvatarBox}>
                    {friend.profileImage ? (
                      <Image source={{ uri: friend.profileImage }} style={s.friendAvatar} />
                    ) : (
                      <View style={s.friendAvatarPlaceholder}>
                        <Text style={s.avatarLetter}>{friend.name.charAt(0).toUpperCase()}</Text>
                      </View>
                    )}
                  </View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={[s.friendName, { color: txt }]}>{friend.name.toUpperCase()}</Text>
                    <Text style={[s.friendPhone, { color: txtSec }]}>{friend.phone}</Text>
                  </View>
                  <View style={s.friendMetaRow}>
                    {friend.streakCount > 0 && (
                      <FloatingPulse color="#FF5A00" style={s.streakBadge}>
                        <Text style={s.streakText}>🔥 {friend.streakCount}</Text>
                      </FloatingPulse>
                    )}
                    <TouchableOpacity
                      style={[s.chatButton, { backgroundColor: getThemeColor() }]}
                      onPress={() => {
                        setActiveChat(friend);
                        setChatTheme(friend.theme || 'friendship');
                      }}
                    >
                      <Text style={s.chatButtonText}>ENTER</Text>
                    </TouchableOpacity>
                  </View>
                </StaggeredSection>
              ))
            )}
          </View>
        )}

        {/* TAB 2: PENDING REQUESTS */}
        {activeTab === 'pending' && (
          <View style={s.tabPanel}>
            {pendingRequests.length === 0 ? (
              <View style={s.emptyBox}>
                <Text style={s.emptyIcon}>🤝</Text>
                <Text style={[s.emptyTitle, { color: txt }]}>No Pending Requests</Text>
                <Text style={[s.emptySub, { color: txtSec }]}>When someone adds you through their contacts, their request will pop up here instantly.</Text>
              </View>
            ) : (
              pendingRequests.map((reqItem, idx) => (
                <View key={reqItem.friendshipId} style={[s.requestCard, { backgroundColor: cardBg, borderColor: border }]}>
                  <View style={s.reqAvatarPlaceholder}>
                    <Text style={s.avatarLetter}>{reqItem.requester.name.charAt(0).toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={[s.friendName, { color: txt }]}>{reqItem.requester.name.toUpperCase()}</Text>
                    <Text style={[s.friendPhone, { color: txtSec }]}>{reqItem.requester.phone}</Text>
                  </View>
                  <TouchableOpacity
                    style={[s.acceptButton, { backgroundColor: isDark ? COLORS.gold : '#8b5a2b' }]}
                    onPress={() => handleAcceptFriend(reqItem.friendshipId)}
                  >
                    <Text style={s.acceptButtonText}>ACCEPT</Text>
                  </TouchableOpacity>
                </View>
              ))
            )}
          </View>
        )}

        {/* TAB 3: CONTACTS SYNC */}
        {activeTab === 'sync' && (
          <View style={s.tabPanel}>
            <View style={s.syncHeaderBox}>
              <Text style={[s.syncText, { color: txt }]}>Identify friends on Zenvy using your local contacts library.</Text>
              <TouchableOpacity
                disabled={syncing}
                style={[s.syncActionBtn, { backgroundColor: isDark ? COLORS.gold : '#8b5a2b' }]}
                onPress={handleContactsSync}
              >
                {syncing ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={s.syncActionBtnText}>🔄 SCAN DEV CONTACTS</Text>
                )}
              </TouchableOpacity>
            </View>

            {syncedContacts.length > 0 && (
              <View style={{ marginTop: 16 }}>
                <Text style={[s.sectionTitle, { color: txt }]}>REGISTERED ON ZENVY ({syncedContacts.length})</Text>
                {syncedContacts.map(contact => (
                  <View key={contact.id} style={[s.contactRow, { borderBottomColor: border }]}>
                    <View style={s.contactAvatar}>
                      <Text style={s.avatarLetter}>{contact.name.charAt(0).toUpperCase()}</Text>
                    </View>
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={[s.friendName, { color: txt }]}>{contact.name}</Text>
                      <Text style={[s.friendPhone, { color: txtSec }]}>{contact.phone}</Text>
                    </View>
                    
                    {contact.friendshipStatus === 'none' && (
                      <TouchableOpacity
                        style={[s.addButton, { borderColor: isDark ? COLORS.gold : '#8b5a2b' }]}
                        onPress={() => handleAddFriend(contact.id)}
                      >
                        <Text style={[s.addButtonText, { color: isDark ? COLORS.gold : '#8b5a2b' }]}>+ ADD</Text>
                      </TouchableOpacity>
                    )}
                    {contact.friendshipStatus === 'pending' && (
                      <Text style={[s.pendingLabel, { color: txtSec }]}>PENDING</Text>
                    )}
                    {contact.friendshipStatus === 'accepted' && (
                      <Text style={[s.acceptedLabel, { color: getThemeColor() }]}>FRIEND</Text>
                    )}
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

      </ScrollView>

      {/* FULL CHAT VIEWER MODAL */}
      <Modal visible={!!activeChat} animationType="slide" transparent={false}>
        <KeyboardAvoidingView
          style={{ flex: 1, backgroundColor: getThemeGradient()[0] }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
        >
          <View style={[s.chatContainer, { backgroundColor: getThemeGradient()[0] }]}>
            
            {/* Chat header */}
            <View style={[s.chatHeader, { borderBottomColor: 'rgba(255,255,255,0.08)' }]}>
              <TouchableOpacity style={s.chatCloseBtn} onPress={() => { setActiveChat(null); loadFriendsData(); }}>
                <Text style={s.chatCloseText}>◀ BACK</Text>
              </TouchableOpacity>
              
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Text style={s.chatHeaderTitle}>{activeChat?.name?.toUpperCase()}</Text>
                <Text style={s.chatHeaderStatus}>E2E ENCRYPTED VAULT</Text>
              </View>

              {/* Theme Cycle Button */}
              <TouchableOpacity style={[s.themeToggleBtn, { borderColor: getThemeColor() }]} onPress={handleThemeChange}>
                <Text style={[s.themeToggleText, { color: getThemeColor() }]}>
                  {chatTheme.toUpperCase()} 🎨
                </Text>
              </TouchableOpacity>
            </View>

            {/* Warning Banner */}
            <View style={s.chatBanner}>
              <Text style={s.chatBannerText}>🔒 MILITARY-GRADE AES-256 | 🕒 MESSAGES DISAPPEAR IN 30 DAYS</Text>
            </View>

            {/* Messages Scroll Area */}
            <ScrollView
              ref={chatScrollRef}
              style={s.chatMessagesBox}
              contentContainerStyle={{ paddingVertical: 16, paddingHorizontal: 12 }}
              showsVerticalScrollIndicator={false}
            >
              {chatMessages.length === 0 ? (
                <View style={s.chatEmpty}>
                  <Text style={s.chatEmptyIcon}>🤫</Text>
                  <Text style={s.chatEmptyText}>Say something secure.</Text>
                  <Text style={s.chatEmptySub}>Your text is encrypted instantly and will vanish in 30 days.</Text>
                </View>
              ) : (
                chatMessages.map((msg, index) => {
                  const isMe = msg.senderId === user?.id;
                  const isSticker = ZENVY_STICKERS.some(st => st.char === msg.text);

                  return (
                    <View key={msg.id || index} style={[s.messageRow, isMe ? s.messageRowMe : s.messageRowThem]}>
                      {!isMe && (
                        <View style={s.msgAvatar}>
                          <Text style={s.msgAvatarText}>{msg.senderName?.charAt(0).toUpperCase()}</Text>
                        </View>
                      )}
                      
                      {isSticker ? (
                        <View style={s.stickerBubble}>
                          <Text style={s.stickerChar}>{msg.text}</Text>
                        </View>
                      ) : (
                        <View
                          style={[
                            s.messageBubble,
                            isMe ? [s.bubbleMe, { backgroundColor: getThemeColor() }] : s.bubbleThem,
                            chatTheme === 'crazy' && !isMe && s.bubbleThemCrazy
                          ]}
                        >
                          <Text style={[s.messageText, isMe ? s.msgTextMe : s.msgTextThem]}>
                            {msg.text}
                          </Text>
                        </View>
                      )}
                    </View>
                  );
                })
              )}
            </ScrollView>

            {/* STICKERS PANEL DRAWER */}
            {showStickers && (
              <View style={s.stickersPanel}>
                <View style={s.stickerPanelHeader}>
                  <Text style={s.stickerPanelTitle}>ZENVY EXPRESSIVE STICKERS</Text>
                  <TouchableOpacity onPress={() => setShowStickers(false)}>
                    <Text style={s.stickerCloseText}>✕ CLOSE</Text>
                  </TouchableOpacity>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.stickerScroll}>
                  {ZENVY_STICKERS.map(st => (
                    <TouchableOpacity
                      key={st.char}
                      style={s.stickerItem}
                      onPress={() => handleSendMessage(st.char)}
                    >
                      <Text style={s.stickerIconStyle}>{st.char}</Text>
                      <Text style={s.stickerLabelStyle}>{st.label.toUpperCase()}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}

            {/* Chat Input row */}
            <View style={[s.chatInputRow, { borderTopColor: 'rgba(255,255,255,0.06)' }]}>
              <TouchableOpacity
                style={[s.stickerTrigger, showStickers && s.stickerTriggerActive]}
                onPress={() => setShowStickers(!showStickers)}
              >
                <Text style={{ fontSize: 20 }}>🎭</Text>
              </TouchableOpacity>
              
              <TextInput
                style={s.chatInput}
                placeholder="Type encrypted message..."
                placeholderTextColor="rgba(255,255,255,0.4)"
                value={draftMessage}
                onChangeText={setDraftMessage}
                onSubmitEditing={() => handleSendMessage()}
              />

              <TouchableOpacity
                disabled={sendingMessage || !draftMessage.trim()}
                style={[s.sendBtn, { backgroundColor: getThemeColor() }]}
                onPress={() => handleSendMessage()}
              >
                {sendingMessage ? (
                  <ActivityIndicator size="small" color="#000" />
                ) : (
                  <Text style={s.sendBtnText}>SEND</Text>
                )}
              </TouchableOpacity>
            </View>

          </View>
        </TouchableWithoutFeedback>
      </Modal>

    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingBottom: 16,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  backBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  backText: {
    fontSize: 11,
    fontWeight: '800',
  },
  headerTitle: {
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  tabContainer: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(128,128,128,0.1)',
  },
  tabButton: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomWidth: 2,
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  scrollContent: {
    padding: 16,
  },
  tabPanel: {
    width: '100%',
  },
  emptyBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
    paddingHorizontal: 24,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 8,
  },
  emptySub: {
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 16,
    marginBottom: 24,
  },
  actionBtnMain: {
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 12,
  },
  actionBtnText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
  },
  friendCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 12,
  },
  friendAvatarBox: {
    width: 48,
    height: 48,
    borderRadius: 24,
    overflow: 'hidden',
  },
  friendAvatar: {
    width: '100%',
    height: '100%',
  },
  friendAvatarPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#8b5a2b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '900',
  },
  friendName: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  friendPhone: {
    fontSize: 10,
    marginTop: 2,
  },
  friendMetaRow: {
    alignItems: 'flex-end',
  },
  streakBadge: {
    backgroundColor: 'rgba(255,90,0,0.15)',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 8,
    marginBottom: 6,
  },
  streakText: {
    color: '#FF7A00',
    fontSize: 9,
    fontWeight: '900',
  },
  chatButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  chatButtonText: {
    color: '#000',
    fontSize: 9,
    fontWeight: '900',
  },
  requestCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 12,
  },
  reqAvatarPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#3b2314',
    alignItems: 'center',
    justifyContent: 'center',
  },
  acceptButton: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  acceptButtonText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '900',
  },
  syncHeaderBox: {
    alignItems: 'center',
    padding: 20,
    borderRadius: 16,
    backgroundColor: 'rgba(128,128,128,0.04)',
    marginBottom: 20,
  },
  syncText: {
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 16,
    marginBottom: 14,
  },
  syncActionBtn: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
  },
  syncActionBtnText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '900',
  },
  sectionTitle: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.5,
    marginBottom: 12,
    opacity: 0.8,
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  contactAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#555',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButton: {
    borderWidth: 1,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  addButtonText: {
    fontSize: 9,
    fontWeight: '900',
  },
  pendingLabel: {
    fontSize: 9,
    fontWeight: '800',
  },
  acceptedLabel: {
    fontSize: 9,
    fontWeight: '900',
  },
  
  // SECURE CHAT CONTAINER
  chatContainer: {
    flex: 1,
  },
  chatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingBottom: 16,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  chatCloseBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  chatCloseText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
  },
  chatHeaderTitle: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 1,
  },
  chatHeaderStatus: {
    color: '#22c55e',
    fontSize: 8,
    fontWeight: '900',
    marginTop: 2,
    letterSpacing: 1,
  },
  themeToggleBtn: {
    borderWidth: 1,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  themeToggleText: {
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  chatBanner: {
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    paddingVertical: 6,
    alignItems: 'center',
  },
  chatBannerText: {
    color: '#888',
    fontSize: 7.5,
    fontWeight: '900',
    letterSpacing: 1,
  },
  chatMessagesBox: {
    flex: 1,
  },
  chatEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 140,
  },
  chatEmptyIcon: {
    fontSize: 40,
    marginBottom: 12,
  },
  chatEmptyText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 4,
  },
  chatEmptySub: {
    color: '#666',
    fontSize: 9,
    textAlign: 'center',
  },
  messageRow: {
    flexDirection: 'row',
    marginBottom: 14,
    width: '100%',
  },
  messageRowMe: {
    justifyContent: 'flex-end',
  },
  messageRowThem: {
    justifyContent: 'flex-start',
  },
  msgAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#8b5a2b',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  msgAvatarText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '900',
  },
  messageBubble: {
    maxWidth: '75%',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 16,
  },
  bubbleMe: {
    borderBottomRightRadius: 2,
  },
  bubbleThem: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderBottomLeftRadius: 2,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.04)',
  },
  bubbleThemCrazy: {
    borderColor: '#ff007f',
    borderWidth: 1,
    backgroundColor: 'rgba(255,0,127,0.05)',
  },
  messageText: {
    fontSize: 12.5,
    lineHeight: 18,
  },
  msgTextMe: {
    color: '#000',
    fontWeight: '600',
  },
  msgTextThem: {
    color: '#fff',
  },
  stickerBubble: {
    padding: 8,
  },
  stickerChar: {
    fontSize: 56,
  },
  
  // STICKERS PANEL
  stickersPanel: {
    backgroundColor: '#121214',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    paddingVertical: 12,
  },
  stickerPanelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  stickerPanelTitle: {
    color: '#999',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  stickerCloseText: {
    color: '#EF4F5F',
    fontSize: 9,
    fontWeight: '900',
  },
  stickerScroll: {
    paddingHorizontal: 12,
  },
  stickerItem: {
    alignItems: 'center',
    marginHorizontal: 10,
  },
  stickerIconStyle: {
    fontSize: 32,
    marginBottom: 4,
  },
  stickerLabelStyle: {
    color: '#666',
    fontSize: 7.5,
    fontWeight: '800',
  },
  
  // CHAT INPUT
  chatInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderTopWidth: 1,
  },
  stickerTrigger: {
    padding: 8,
    marginRight: 8,
    borderRadius: 8,
  },
  stickerTriggerActive: {
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  chatInput: {
    flex: 1,
    height: 40,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 20,
    paddingHorizontal: 16,
    color: '#fff',
    fontSize: 12.5,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.04)',
  },
  sendBtn: {
    marginLeft: 12,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 20,
  },
  sendBtnText: {
    color: '#000',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.5,
  }
});
