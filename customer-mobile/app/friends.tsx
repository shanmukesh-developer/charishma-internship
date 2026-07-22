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
  Vibration,
  SafeAreaView
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, SHADOWS } from '../constants/theme';
import { ENDPOINTS, API_URL } from '../constants/api';
import { apiFetch } from '../utils/auth';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { connectSocket } from '../utils/socket';
import { FloatingPulse } from '../components/AnimatedSection';
import DopaminePressable from '../components/DopaminePressable';

const { width: SW, height: SH } = Dimensions.get('window');

// Visual styling constants
const GRAPHITE_BG = '#0E1116';
const VIOLET_ACCENT = '#6E5BFF';
const EMBER_ORANGE = '#FF7A59';

const ZENVY_STICKERS = [
  '⚡', '🔥', '🏆', '🎁', '🚀', '🤫', '💖', '💀', '🎉', '🍔', '🍕', '🍦'
];

const CHAT_THEMES = [
  { name: 'friendship', colors: ['#140D07', '#25170B', '#160E08'], accent: '#FF7A59' },
  { name: 'crazy', colors: ['#0F0C20', '#1C0B36', '#09151B'], accent: '#a855f7' },
  { name: 'love', colors: ['#1F080F', '#350A19', '#1C060E'], accent: '#ec4899' },
  { name: 'graphite', colors: ['#0E1116', '#171B22', '#0E1116'], accent: '#6E5BFF' }
];

// Helper to resolve profile image fallbacks using premium Unsplash avatars
const getAvatarUrl = (profileImage: string | null, id: string) => {
  if (profileImage && (profileImage.startsWith('http') || profileImage.startsWith('data:'))) {
    return profileImage;
  }
  if (profileImage) {
    return `${API_URL}${profileImage.startsWith('/') ? '' : '/'}${profileImage}`;
  }
  const placeholders = [
    'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=120&q=80',
    'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&q=80',
    'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=120&q=80',
    'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?w=120&q=80',
    'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=120&q=80'
  ];
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % placeholders.length;
  return placeholders[index];
};

// Reusable hook for orbit calculations in polar coordinates
function useOrbitLayout(
  center: { x: number; y: number },
  items: any[],
  minRadius: number,
  maxRadius: number,
  isPending: boolean = false
) {
  return React.useMemo(() => {
    if (!items || items.length === 0) return [];
    
    return items.map((item, idx) => {
      // Offset starting angle to make it look organic
      const baseAngle = -Math.PI / 2;
      const angle = baseAngle + (idx * 2 * Math.PI) / items.length;
      
      let radius = maxRadius;
      if (!isPending) {
        // Higher streaks = closer to center (smaller radius)
        const streak = item.streakCount || 0;
        const streakWeight = Math.min(streak / 20, 1);
        radius = maxRadius - (maxRadius - minRadius) * streakWeight;
      } else {
        // Pending items populate the outer orbit
        radius = maxRadius + 45;
      }
      
      const x = center.x + radius * Math.cos(angle);
      const y = center.y + radius * Math.sin(angle);
      
      return {
        ...item,
        x,
        y,
        angle,
        radius,
      };
    });
  }, [center.x, center.y, items, minRadius, maxRadius, isPending]);
}

export default function FriendsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { isDark } = useTheme();

  // Core list state
  const [friends, setFriends] = useState<any[]>([]);
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);
  const [syncedContacts, setSyncedContacts] = useState<any[]>([]);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  
  // Interactive nodes state
  const [activeChat, setActiveChat] = useState<any | null>(null);
  const [popoverPending, setPopoverPending] = useState<any | null>(null);
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const [draftMessage, setDraftMessage] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const [showStickers, setShowStickers] = useState(false);
  
  // Nickname Editing State
  const [isEditingNickname, setIsEditingNickname] = useState(false);
  const [nicknameInput, setNicknameInput] = useState('');
  
  // Real-Time Buddy Notifications Toast State
  const [activeToast, setActiveToast] = useState<{ title: string; text: string } | null>(null);

  const triggerToast = (title: string, text: string) => {
    setActiveToast({ title, text });
    setTimeout(() => setActiveToast(null), 4500);
  };
  
  // Theme state updates instantly
  const [chatTheme, setChatTheme] = useState<string>('graphite');
  const chatScrollRef = useRef<ScrollView>(null);

  // Orbit Center position configuration
  const centerPoint = { x: SW / 2, y: 220 };
  const MIN_RADIUS = 75;
  const MAX_RADIUS = 135;

  // Compute orbits using hook
  const friendNodes = useOrbitLayout(centerPoint, friends, MIN_RADIUS, MAX_RADIUS, false);
  const pendingNodes = useOrbitLayout(centerPoint, pendingRequests, MIN_RADIUS, MAX_RADIUS, true);

  // Load friends and pending requests on load
  useEffect(() => {
    loadFriendsData();
    const interval = setInterval(loadFriendsData, 8000);
    return () => clearInterval(interval);
  }, []);

  // Global user socket listener for real-time buddy notifications
  useEffect(() => {
    if (!user?.id) return;
    const socket = connectSocket();
    socket.emit('joinRoom', `user-${user.id}`);

    const onIncomingRequest = (data: any) => {
      Vibration.vibrate([0, 100, 50, 100]);
      triggerToast('⚡ FRIEND REQUEST', `${data.requester?.name || 'Someone'} requested to join your orbit!`);
      loadFriendsData();
    };

    const onRequestAccepted = (data: any) => {
      Vibration.vibrate([0, 80, 40, 80]);
      triggerToast('🤝 ORBIT LINKED', `${data.friendName || 'A friend'} accepted your request!`);
      loadFriendsData();
    };

    const onNudge = (data: any) => {
      Vibration.vibrate([0, 120, 60, 120]);
      triggerToast('⚡ ORBIT NUDGE', `${data.senderName || 'Your friend'} nudged your orbit flame! 🔥`);
      loadFriendsData();
    };

    socket.on('incoming_friend_request', onIncomingRequest);
    socket.on('friend_request_accepted', onRequestAccepted);
    socket.on('friend_nudge', onNudge);

    return () => {
      socket.off('incoming_friend_request', onIncomingRequest);
      socket.off('friend_request_accepted', onRequestAccepted);
      socket.off('friend_nudge', onNudge);
    };
  }, [user?.id]);

  // Socket listener for messaging integration
  const activeConversationId = activeChat?.conversationId;
  const activeFriendshipId = activeChat?.friendshipId;

  useEffect(() => {
    if (!activeConversationId) return;

    const socket = connectSocket();
    socket.emit('joinConversation', activeConversationId);

    const onNewMessage = (msg: any) => {
      if (msg.conversationId === activeConversationId) {
        setChatMessages(prev => {
          if (prev.some(m => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
        setTimeout(() => chatScrollRef.current?.scrollToEnd({ animated: true }), 100);
        if (msg.senderId !== user?.id) {
          Vibration.vibrate(80);
        }
      }
    };

    const onThemeUpdated = (data: any) => {
      if (data.friendshipId === activeFriendshipId) {
        setChatTheme(data.theme);
      }
    };

    socket.on('new_friend_message', onNewMessage);
    socket.on('friendship_theme_updated', onThemeUpdated);

    fetchChatHistory(activeConversationId);

    return () => {
      socket.off('new_friend_message', onNewMessage);
      socket.off('friendship_theme_updated', onThemeUpdated);
    };
  }, [activeConversationId, activeFriendshipId]);

  const loadFriendsData = async () => {
    try {
      const res = await apiFetch(ENDPOINTS.friendsList);
      if (res.ok) {
        let data = await res.json();
        if (data.length > 10) {
          data = data.slice(0, 10);
        }
        setFriends(data);
      }
      const resPending = await apiFetch(ENDPOINTS.friendsPending);
      if (resPending.ok) {
        const data = await resPending.json();
        setPendingRequests(data);
      }
    } catch (e) {
      console.error('[LOAD_DATA_ERROR]', e);
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
      console.error('[CHAT_HISTORY_ERROR]', e);
    }
  };

  const handleSaveNickname = async () => {
    if (!activeChat) return;
    const cleanNickname = nicknameInput.trim();
    const originalName = activeChat.originalName || activeChat.name;
    const finalDisplayName = cleanNickname || originalName;

    // Optimistically update current chat and friends list
    setActiveChat((prev: any) => prev ? { ...prev, name: finalDisplayName, nickname: cleanNickname || null } : null);
    setFriends(prev => prev.map(f =>
      f.friendshipId === activeChat.friendshipId
        ? { ...f, name: finalDisplayName, nickname: cleanNickname || null }
        : f
    ));
    setIsEditingNickname(false);
    Vibration.vibrate(50);

    try {
      await apiFetch(`${API_URL}/api/friends/${activeChat.friendshipId}/nickname`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: cleanNickname })
      });
    } catch (e) {
      console.error('[NICKNAME_SAVE_ERROR]', e);
    }
  };

  const handleSendNudge = async () => {
    if (!activeChat) return;
    Vibration.vibrate(100);
    try {
      const res = await apiFetch(`${API_URL}/api/friends/nudge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ friendshipId: activeChat.friendshipId })
      });
      if (res.ok) {
        const data = await res.json();
        Alert.alert('Nudge Transmitted! ⚡', `Streak maintained at ${data.streakCount} days!`);
        loadFriendsData();
      }
    } catch (e) {
      console.error('[NUDGE_ERROR]', e);
    }
  };

  const handleRemoveFriend = async () => {
    if (!activeChat) return;
    Alert.alert(
      'Remove Friend',
      `Are you sure you want to remove ${activeChat.name} from your orbit?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              const res = await apiFetch(`${API_URL}/api/friends/${activeChat.friendshipId}`, {
                method: 'DELETE'
              });
              if (res.ok) {
                setActiveChat(null);
                loadFriendsData();
                Alert.alert('Removed', 'Friend removed from your orbit.');
              }
            } catch (e) {
              console.error('[REMOVE_FRIEND_ERROR]', e);
            }
          }
        }
      ]
    );
  };

  // Optimistic UI interaction handlers
  const handleAcceptFriend = async (friendshipId: string, nodeItem: any) => {
    if (friends.length >= 10) {
      Alert.alert('Circle Limit Reached', 'You can only have up to 10 close friends in your orbit circle.');
      return;
    }
    setPopoverPending(null);
    Vibration.vibrate(100);

    // Optimistic state promote: remove from pending list and add to friends list
    const promotedRequester = nodeItem.requester;
    setPendingRequests(prev => prev.filter(p => p.friendshipId !== friendshipId));
    setFriends(prev => [
      ...prev,
      {
        friendshipId,
        friendId: promotedRequester.id,
        name: promotedRequester.name,
        originalName: promotedRequester.name,
        nickname: null,
        phone: promotedRequester.phone,
        profileImage: promotedRequester.profileImage,
        streakCount: 1, // Starts with a small streak
        lastInteractionAt: new Date().toISOString(),
        theme: 'graphite',
        conversationId: null
      }
    ].slice(0, 10));

    try {
      const res = await apiFetch(ENDPOINTS.friendsAccept, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ friendshipId })
      });
      if (!res.ok) {
        loadFriendsData(); // Fallback to server state if failed
      }
    } catch (e) {
      loadFriendsData();
    }
  };

  const handleDeclineFriend = (friendshipId: string) => {
    setPopoverPending(null);
    Vibration.vibrate(50);
    // Optimistic removal
    setPendingRequests(prev => prev.filter(p => p.friendshipId !== friendshipId));
  };

  const handleThemeDotPress = async (themeName: string) => {
    if (!activeChat) return;
    setChatTheme(themeName); // Optimistic UI theme update
    
    try {
      const res = await apiFetch(ENDPOINTS.friendsTheme(activeChat.friendshipId), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: themeName })
      });
      if (res.ok) {
        // Sync local object state
        setFriends(prev =>
          prev.map(f => f.friendshipId === activeChat.friendshipId ? { ...f, theme: themeName } : f)
        );
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleSendMessage = async (stickerText?: string) => {
    const text = stickerText || draftMessage;
    if (!text.trim() || !activeChat) return;

    const optimisticMsg = {
      id: `temp-${Date.now()}`,
      senderId: user?.id,
      senderName: user?.name,
      text: text.trim(),
      createdAt: new Date().toISOString()
    };

    setChatMessages(prev => [...prev, optimisticMsg]);
    if (!stickerText) setDraftMessage('');
    setShowStickers(false);
    setTimeout(() => chatScrollRef.current?.scrollToEnd({ animated: true }), 80);

    try {
      const res = await apiFetch(ENDPOINTS.friendsSendMessage, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: activeChat.conversationId,
          text: text.trim()
        })
      });
      if (!res.ok) {
        Alert.alert('Send Failed', 'Failed to send secure message.');
      }
    } catch (e) {
      Alert.alert('Error', 'Message transmission failed.');
    }
  };

  const handleContactsSync = async () => {
    setSyncing(true);
    try {
      const mockDeviceContacts = [
        '7788994455', '5544998877', '9988776655', '9876543210', '8899001122', '9000011223'
      ];
      const res = await apiFetch(ENDPOINTS.friendsContacts, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contacts: mockDeviceContacts })
      });
      if (res.ok) {
        const data = await res.json();
        setSyncedContacts(data);
        Vibration.vibrate([0, 80, 40, 80]);
      }
    } catch (e) {
      Alert.alert('Error', 'Could not sync contacts.');
    } finally {
      setSyncing(false);
    }
  };

  const handleAddFriend = async (friendId: string) => {
    if (friends.length >= 10) {
      Alert.alert('Circle Limit Reached', 'Your orbit is full (10 friends max). Remove someone before adding new friends.');
      return;
    }
    try {
      const res = await apiFetch(ENDPOINTS.friendsRequest, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipientId: friendId })
      });
      if (res.ok) {
        Alert.alert('Request Sent', 'Friend request sent!');
        setSyncedContacts(prev =>
          prev.map(c => c.id === friendId ? { ...c, friendshipStatus: 'pending' } : c)
        );
        loadFriendsData();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const getActiveThemeColors = () => {
    const current = CHAT_THEMES.find(t => t.name === chatTheme);
    return current ? current.colors : ['#0E1116', '#171B22', '#0E1116'];
  };

  const getActiveThemeAccent = () => {
    const current = CHAT_THEMES.find(t => t.name === chatTheme);
    return current ? current.accent : '#6E5BFF';
  };

  return (
    <SafeAreaView style={s.container}>
      <StatusBarBackground />
      
      {/* REAL-TIME BUDDY NOTIFICATION TOAST BANNER */}
      {activeToast && (
        <TouchableOpacity style={s.toastBannerContainer} onPress={() => setActiveToast(null)}>
          <View style={s.toastBannerGradient}>
            <Text style={s.toastTitleText}>{activeToast.title}</Text>
            <Text style={s.toastBodyText}>{activeToast.text}</Text>
          </View>
        </TouchableOpacity>
      )}

      {/* Top Header Navigation */}
      <View style={s.topHeader}>
        <TouchableOpacity style={s.backButton} onPress={() => router.back()}>
          <Text style={s.backText}>← CLOSE CIRCLE</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.syncButtonTrigger} onPress={() => setShowSyncModal(true)}>
          <Text style={s.syncButtonText}>➕ SCAN & ADD</Text>
        </TouchableOpacity>
      </View>

      {/* Orbit Canvas Container */}
      <TouchableWithoutFeedback onPress={() => setPopoverPending(null)}>
        <View style={s.canvasContainer}>
          {/* Circular Orbit Guidelines */}
          <View style={[s.guidelineRing, { width: MIN_RADIUS * 2, height: MIN_RADIUS * 2, borderRadius: MIN_RADIUS }]} />
          <View style={[s.guidelineRing, { width: MAX_RADIUS * 2, height: MAX_RADIUS * 2, borderRadius: MAX_RADIUS }]} />
          <View style={[s.guidelineRing, { width: (MAX_RADIUS + 45) * 2, height: (MAX_RADIUS + 45) * 2, borderRadius: MAX_RADIUS + 45, borderStyle: 'dashed', borderColor: 'rgba(110, 91, 255, 0.08)' }]} />

          {/* Center User Node ("You") */}
          <View style={[s.centerNodeContainer, { left: centerPoint.x - 38, top: centerPoint.y - 38 }]}>
            <LinearGradient
              colors={['#6E5BFF', '#FF7A59']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={s.centerNodeGradient}
            />
            <Image
              source={{ uri: getAvatarUrl(user?.profileImage || null, user?.id || 'self') }}
              style={s.centerNodeAvatar}
            />
            <View style={s.centerBadge}>
              <Text style={s.centerBadgeText}>YOU</Text>
            </View>
          </View>

          {/* Accepted Close Friends Nodes */}
          {friendNodes.map((node) => {
            const size = Math.min(48 + (node.streakCount || 0) * 1.5, 68);
            const halfSize = size / 2;

            return (
              <TouchableOpacity
                key={node.friendshipId}
                activeOpacity={0.8}
                style={[
                  s.nodeButton,
                  {
                    left: node.x - halfSize,
                    top: node.y - halfSize,
                    width: size,
                    height: size,
                    borderRadius: halfSize
                  }
                ]}
                onPress={() => {
                  setActiveChat(node);
                  setChatTheme(node.theme || 'graphite');
                }}
              >
                <Image
                  source={{ uri: getAvatarUrl(node.profileImage, node.friendId) }}
                  style={[s.nodeAvatar, { borderRadius: halfSize }]}
                />
                
                {/* Streak Count Indicator overlay */}
                {node.streakCount > 0 && (
                  <View style={s.streakIndicator}>
                    <Text style={s.streakIndicatorText}>🔥{node.streakCount}</Text>
                  </View>
                )}
                
                <Text style={s.nodeNameText} numberOfLines={1}>{node.name}</Text>
              </TouchableOpacity>
            );
          })}

          {/* Pending Incoming Requests outer nodes */}
          {pendingNodes.map((node) => {
            const size = 44;
            const halfSize = size / 2;

            return (
              <TouchableOpacity
                key={node.friendshipId}
                activeOpacity={0.8}
                style={[
                  s.nodeButton,
                  s.pendingNode,
                  {
                    left: node.x - halfSize,
                    top: node.y - halfSize,
                    width: size,
                    height: size,
                    borderRadius: halfSize
                  }
                ]}
                onPress={() => setPopoverPending(node)}
              >
                <FloatingPulse color="#6E5BFF" style={{ ...StyleSheet.absoluteFill, borderRadius: halfSize }}>
                  <Image
                    source={{ uri: getAvatarUrl(node.requester.profileImage, node.requester.id) }}
                    style={[s.nodeAvatar, s.pendingNodeAvatar, { borderRadius: halfSize }]}
                  />
                </FloatingPulse>
                <Text style={[s.nodeNameText, s.pendingNodeName]} numberOfLines={1}>
                  {node.requester.name}
                </Text>
                <View style={s.pendingBadge}>
                  <Text style={s.pendingBadgeText}>?</Text>
                </View>
              </TouchableOpacity>
            );
          })}

          {/* Inline Popover Anchored to Pending Node */}
          {popoverPending && (
            <View
              style={[
                s.pendingPopover,
                {
                  left: popoverPending.x - 70,
                  top: popoverPending.y - 75
                }
              ]}
            >
              <Text style={s.popoverTitle} numberOfLines={1}>
                {popoverPending.requester.name} request
              </Text>
              <View style={s.popoverActions}>
                <TouchableOpacity
                  style={s.popoverAcceptBtn}
                  onPress={() => handleAcceptFriend(popoverPending.friendshipId, popoverPending)}
                >
                  <Text style={s.popoverAcceptText}>Accept</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={s.popoverDeclineBtn}
                  onPress={() => handleDeclineFriend(popoverPending.friendshipId)}
                >
                  <Text style={s.popoverDeclineText}>Decline</Text>
                </TouchableOpacity>
              </View>
              <View style={s.popoverArrow} />
            </View>
          )}
        </View>
      </TouchableWithoutFeedback>

      {/* Clean instruction panel at the bottom */}
      <View style={s.instructionPanel}>
        <Text style={s.instructionTitle}>THE ORBIT RULES</Text>
        <Text style={s.instructionBody}>
          Closer nodes represent stronger streaks. Dimmed outer nodes indicate pending campus requests. Tap any node to link and converse.
        </Text>
      </View>

      {/* SLIDE-UP BOTTOM SHEET FOR SECURE CHATS */}
      {activeChat && (
        <Modal visible={!!activeChat} animationType="slide" transparent={true} onRequestClose={() => setActiveChat(null)}>
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          >
            <View style={s.modalContainer}>
              <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
                <View style={s.bottomSheetDimmer} />
              </TouchableWithoutFeedback>
              
              <View style={[s.bottomSheetContent, { backgroundColor: getActiveThemeColors()[0] }]}>
                {/* Top Grab Handle decor */}
                <View style={s.bottomSheetGrabHandle} />

                {/* Header bar */}
                <View style={s.chatHeader}>
                  <TouchableOpacity style={s.chatCloseBtn} onPress={() => { setActiveChat(null); setIsEditingNickname(false); loadFriendsData(); }}>
                    <Text style={s.chatCloseText}>✕ CLOSE</Text>
                  </TouchableOpacity>

                  {isEditingNickname ? (
                    <View style={s.chatHeaderTitleContainerInline}>
                      <TextInput
                        style={s.nicknameInputField}
                        value={nicknameInput}
                        onChangeText={setNicknameInput}
                        placeholder="Set nickname..."
                        placeholderTextColor="rgba(255,255,255,0.4)"
                        autoFocus
                      />
                      <TouchableOpacity style={s.nicknameSaveBtn} onPress={handleSaveNickname}>
                        <Text style={s.nicknameSaveBtnText}>Save</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={s.nicknameCancelBtn} onPress={() => setIsEditingNickname(false)}>
                        <Text style={s.nicknameCancelBtnText}>✕</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <View style={s.chatHeaderTitleContainer}>
                      <TouchableOpacity
                        style={s.nameEditRow}
                        onPress={() => {
                          setNicknameInput(activeChat.nickname || '');
                          setIsEditingNickname(true);
                        }}
                      >
                        <Text style={s.chatHeaderTitle}>{activeChat?.name}</Text>
                        <Text style={{ fontSize: 10, marginLeft: 4 }}>✏️</Text>
                      </TouchableOpacity>
                      <Text style={s.chatHeaderSubtitle}>
                        {activeChat?.nickname ? `REAL: ${activeChat?.originalName || activeChat?.name}` : 'SECURE END-TO-END LINK'}
                      </Text>
                    </View>
                  )}

                {/* Instant Theme dots selector & Actions */}
                <View style={s.themeDotsRow}>
                  {CHAT_THEMES.map(themeItem => (
                    <TouchableOpacity
                      key={themeItem.name}
                      style={[
                        s.themeDot,
                        { backgroundColor: themeItem.accent },
                        chatTheme === themeItem.name && s.activeThemeDot
                      ]}
                      onPress={() => handleThemeDotPress(themeItem.name)}
                    />
                  ))}
                  <TouchableOpacity style={s.nudgeActionBtn} onPress={handleSendNudge}>
                    <Text style={s.nudgeActionText}>⚡ NUDGE</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.removeActionBtn} onPress={handleRemoveFriend}>
                    <Text style={s.removeActionText}>🗑️</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Streak Banner */}
              <View style={[s.streakBanner, { borderBottomColor: 'rgba(255,255,255,0.06)' }]}>
                <Text style={s.streakBannerText}>
                  STREAK COUNT: <Text style={s.monoText}>🔥{activeChat?.streakCount || 0}</Text>
                </Text>
                <Text style={s.streakBannerSub}>🔒 AES-256 SECURED VAULT</Text>
              </View>

              {/* Message scroll views */}
              <ScrollView
                ref={chatScrollRef}
                style={s.messagesScrollView}
                contentContainerStyle={{ paddingVertical: 12, paddingHorizontal: 16 }}
                showsVerticalScrollIndicator={false}
              >
                {chatMessages.length === 0 ? (
                  <View style={s.messagesEmptyContainer}>
                    <Text style={s.emptySymbol}>🤫</Text>
                    <Text style={s.emptyInstruction}>No chats yet. Make the first move.</Text>
                  </View>
                ) : (
                  chatMessages.map((msg, index) => {
                    const isMe = msg.senderId === user?.id;
                    const isSticker = ZENVY_STICKERS.includes(msg.text);

                    return (
                      <View key={msg.id || index} style={[s.msgRow, isMe ? s.msgRowMe : s.msgRowThem]}>
                        {!isMe && (
                          <View style={s.msgAvatarCircle}>
                            <Text style={s.msgAvatarInitials}>
                              {msg.senderName?.charAt(0).toUpperCase() || activeChat?.name?.charAt(0).toUpperCase()}
                            </Text>
                          </View>
                        )}
                        {isSticker ? (
                          <View style={s.stickerMessageContainer}>
                            <Text style={s.stickerMessageChar}>{msg.text}</Text>
                          </View>
                        ) : (
                          <View
                            style={[
                              s.msgBubble,
                              isMe ? [s.msgBubbleMe, { backgroundColor: getActiveThemeAccent() }] : s.msgBubbleThem
                            ]}
                          >
                            <Text style={[s.msgBodyText, isMe ? s.msgBodyTextMe : s.msgBodyTextThem]}>
                              {msg.text}
                            </Text>
                          </View>
                        )}
                      </View>
                    );
                  })
                )}
              </ScrollView>

              {/* Expressive sticker drawer */}
              {showStickers && (
                <View style={s.stickerSelectionPanel}>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.stickerHorizontalScroll}>
                    {ZENVY_STICKERS.map(emoji => (
                      <TouchableOpacity
                        key={emoji}
                        style={s.stickerBubbleBtn}
                        onPress={() => handleSendMessage(emoji)}
                      >
                        <Text style={{ fontSize: 26 }}>{emoji}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}

              {/* Chat Input controls */}
              <View style={s.chatInputContainer}>
                <TouchableOpacity
                  style={[s.stickerTriggerButton, showStickers && s.stickerTriggerButtonActive]}
                  onPress={() => setShowStickers(!showStickers)}
                >
                  <Text style={{ fontSize: 20 }}>🎭</Text>
                </TouchableOpacity>

                <TextInput
                  style={s.chatTextInputField}
                  placeholder="Transmit encrypted message..."
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  value={draftMessage}
                  onChangeText={setDraftMessage}
                  onSubmitEditing={() => handleSendMessage()}
                />

                <TouchableOpacity
                  disabled={sendingMessage || !draftMessage.trim()}
                  style={[s.sendMessageBtn, { backgroundColor: getActiveThemeAccent() }]}
                  onPress={() => handleSendMessage()}
                >
                  {sendingMessage ? (
                    <ActivityIndicator size="small" color="#000" />
                  ) : (
                    <Text style={s.sendMessageBtnText}>SEND</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      )}

      {/* SYNC CONTACTS AND ADD FRIENDS DRAWER / MODAL */}
      <Modal visible={showSyncModal} animationType="slide" transparent={false}>
        <SafeAreaView style={[s.syncModalContainer, { backgroundColor: GRAPHITE_BG }]}>
          <View style={s.syncModalHeader}>
            <Text style={s.syncModalTitle}>ADD TO CIRCLE</Text>
            <TouchableOpacity style={s.syncModalCloseBtn} onPress={() => setShowSyncModal(false)}>
              <Text style={s.syncModalCloseText}>✕ CLOSE</Text>
            </TouchableOpacity>
          </View>

          <View style={s.syncPromptBox}>
            <Text style={s.syncPromptText}>
              Scan registered users using your local phone contacts list.
            </Text>
            <TouchableOpacity
              disabled={syncing}
              style={[s.primarySyncBtn, { backgroundColor: VIOLET_ACCENT }]}
              onPress={handleContactsSync}
            >
              {syncing ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={s.primarySyncBtnText}>🔄 SCAN REGISTERED CONTACTS</Text>
              )}
            </TouchableOpacity>
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
            {syncedContacts.length > 0 && (
              <View>
                <Text style={s.syncedContactsTitle}>SYNCED USERS FOUND</Text>
                {syncedContacts.map(c => (
                  <View key={c.id} style={s.contactItemRow}>
                    <View style={s.contactAvatarCircle}>
                      <Text style={s.contactAvatarInitials}>{c.name.charAt(0).toUpperCase()}</Text>
                    </View>
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={s.contactItemName}>{c.name}</Text>
                      <Text style={s.contactItemPhone}>{c.phone}</Text>
                    </View>
                    {c.friendshipStatus === 'none' && (
                      <TouchableOpacity style={s.contactAddBtn} onPress={() => handleAddFriend(c.id)}>
                        <Text style={s.contactAddBtnText}>+ ADD</Text>
                      </TouchableOpacity>
                    )}
                    {c.friendshipStatus === 'pending' && (
                      <Text style={s.contactPendingLabel}>PENDING</Text>
                    )}
                    {c.friendshipStatus === 'accepted' && (
                      <Text style={s.contactFriendLabel}>FRIEND</Text>
                    )}
                  </View>
                ))}
              </View>
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

// Custom StatusBarBackground to handle spacing on Android/iOS
function StatusBarBackground() {
  return (
    <View style={{ height: Platform.OS === 'ios' ? 44 : 0, backgroundColor: GRAPHITE_BG }} />
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: GRAPHITE_BG
  },
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 12 : 38,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)'
  },
  backButton: {
    paddingVertical: 6,
  },
  backText: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.2
  },
  syncButtonTrigger: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(110, 91, 255, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(110, 91, 255, 0.3)'
  },
  syncButtonText: {
    color: VIOLET_ACCENT,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1
  },
  canvasContainer: {
    width: SW,
    height: 420,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#07090C',
    overflow: 'hidden'
  },
  guidelineRing: {
    position: 'absolute',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.025)',
    pointerEvents: 'none'
  },
  centerNodeContainer: {
    position: 'absolute',
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: VIOLET_ACCENT,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8
  },
  centerNodeGradient: {
    ...StyleSheet.absoluteFill,
    borderRadius: 38,
    padding: 3
  },
  centerNodeAvatar: {
    width: 70,
    height: 70,
    borderRadius: 35,
    borderWidth: 2,
    borderColor: GRAPHITE_BG
  },
  centerBadge: {
    position: 'absolute',
    bottom: -6,
    backgroundColor: VIOLET_ACCENT,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6
  },
  centerBadgeText: {
    color: '#FFF',
    fontSize: 7,
    fontWeight: '900',
    letterSpacing: 0.5
  },
  nodeButton: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4
  },
  nodeAvatar: {
    width: '100%',
    height: '100%',
    borderWidth: 2,
    borderColor: '#FFF'
  },
  nodeNameText: {
    position: 'absolute',
    bottom: -15,
    color: '#FFF',
    fontSize: 9,
    fontWeight: '800',
    fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif',
    textAlign: 'center',
    width: 70
  },
  streakIndicator: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: EMBER_ORANGE,
    borderRadius: 8,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: GRAPHITE_BG
  },
  streakIndicatorText: {
    color: '#FFF',
    fontSize: 7,
    fontWeight: '900',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace'
  },
  pendingNode: {
    opacity: 0.7,
    shadowColor: VIOLET_ACCENT,
    shadowOpacity: 0.2
  },
  pendingNodeAvatar: {
    borderColor: VIOLET_ACCENT,
    opacity: 0.6
  },
  pendingNodeName: {
    color: '#AAA',
    fontSize: 8
  },
  pendingBadge: {
    position: 'absolute',
    bottom: -4,
    right: -4,
    backgroundColor: VIOLET_ACCENT,
    borderRadius: 8,
    width: 14,
    height: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: GRAPHITE_BG
  },
  pendingBadgeText: {
    color: '#FFF',
    fontSize: 8,
    fontWeight: '900'
  },
  pendingPopover: {
    position: 'absolute',
    width: 140,
    backgroundColor: '#171B22',
    borderWidth: 1,
    borderColor: 'rgba(110, 91, 255, 0.3)',
    borderRadius: 12,
    padding: 8,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 8,
    zIndex: 99
  },
  popoverTitle: {
    color: '#FFF',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.5,
    marginBottom: 6
  },
  popoverActions: {
    flexDirection: 'row',
    gap: 6
  },
  popoverAcceptBtn: {
    flex: 1,
    paddingVertical: 5,
    backgroundColor: VIOLET_ACCENT,
    borderRadius: 6,
    alignItems: 'center'
  },
  popoverAcceptText: {
    color: '#FFF',
    fontSize: 8,
    fontWeight: '900'
  },
  popoverDeclineBtn: {
    flex: 1,
    paddingVertical: 5,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 6,
    alignItems: 'center'
  },
  popoverDeclineText: {
    color: '#AAA',
    fontSize: 8,
    fontWeight: '800'
  },
  popoverArrow: {
    position: 'absolute',
    bottom: -6,
    alignSelf: 'center',
    width: 12,
    height: 12,
    backgroundColor: '#171B22',
    borderBottomWidth: 1,
    borderRightWidth: 1,
    borderColor: 'rgba(110, 91, 255, 0.3)',
    transform: [{ rotate: '45deg' }]
  },
  instructionPanel: {
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 16,
    borderRadius: 16,
    backgroundColor: '#13161C',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.03)'
  },
  instructionTitle: {
    color: VIOLET_ACCENT,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.5,
    marginBottom: 4
  },
  instructionBody: {
    color: '#8A94A6',
    fontSize: 10,
    lineHeight: 14,
    textAlign: 'center'
  },
  modalContainer: {
    flex: 1,
    justifyContent: 'flex-end'
  },
  bottomSheetDimmer: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 0, 0, 0.6)'
  },
  bottomSheetContent: {
    height: '84%',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 8,
    overflow: 'hidden'
  },
  bottomSheetGrabHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    alignSelf: 'center',
    marginBottom: 10
  },
  chatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)'
  },
  chatCloseBtn: {
    paddingVertical: 6,
    paddingHorizontal: 8
  },
  chatCloseText: {
    color: '#8A94A6',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.5
  },
  chatHeaderTitleContainer: {
    alignItems: 'center',
    flex: 1
  },
  chatHeaderTitleContainerInline: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 8,
    marginHorizontal: 8
  },
  nameEditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4
  },
  nicknameInputField: {
    flex: 1,
    height: 32,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 8,
    paddingHorizontal: 10,
    color: '#FFF',
    fontSize: 12,
    fontWeight: '700'
  },
  nicknameSaveBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: VIOLET_ACCENT,
    borderRadius: 6
  },
  nicknameSaveBtnText: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: '900'
  },
  nicknameCancelBtn: {
    padding: 6
  },
  nicknameCancelBtnText: {
    color: '#8A94A6',
    fontSize: 12,
    fontWeight: '900'
  },
  chatHeaderTitle: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '900',
    fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif',
    letterSpacing: 0.5
  },
  toastBannerContainer: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 50 : 44,
    left: 16,
    right: 16,
    zIndex: 999
  },
  toastBannerGradient: {
    backgroundColor: '#1C222D',
    borderWidth: 1,
    borderColor: VIOLET_ACCENT,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    shadowColor: VIOLET_ACCENT,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 10
  },
  toastTitleText: {
    color: VIOLET_ACCENT,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.2,
    marginBottom: 2
  },
  toastBodyText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '700'
  },
  nudgeActionBtn: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: 'rgba(255, 122, 89, 0.2)',
    borderWidth: 1,
    borderColor: EMBER_ORANGE,
    borderRadius: 6,
    marginLeft: 6
  },
  nudgeActionText: {
    color: EMBER_ORANGE,
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.5
  },
  removeActionBtn: {
    padding: 4,
    marginLeft: 4
  },
  removeActionText: {
    fontSize: 12
  },
  chatHeaderSubtitle: {
    color: '#8A94A6',
    fontSize: 7,
    fontWeight: '900',
    letterSpacing: 1.5,
    marginTop: 1
  },
  themeDotsRow: {
    flexDirection: 'row',
    gap: 4
  },
  themeDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    opacity: 0.5
  },
  activeThemeDot: {
    opacity: 1,
    borderWidth: 1,
    borderColor: '#FFF'
  },
  streakBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    backgroundColor: 'rgba(0,0,0,0.1)'
  },
  streakBannerText: {
    color: EMBER_ORANGE,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.5
  },
  streakBannerSub: {
    color: '#6E5BFF',
    fontSize: 7,
    fontWeight: '900',
    letterSpacing: 0.5
  },
  monoText: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontWeight: '900'
  },
  messagesScrollView: {
    flex: 1
  },
  messagesEmptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60
  },
  emptySymbol: {
    fontSize: 32,
    marginBottom: 8
  },
  emptyInstruction: {
    color: '#8A94A6',
    fontSize: 10,
    fontWeight: '800'
  },
  msgRow: {
    flexDirection: 'row',
    marginBottom: 12,
    alignItems: 'flex-end',
    maxWidth: '85%'
  },
  msgRowMe: {
    alignSelf: 'flex-end',
    flexDirection: 'row-reverse'
  },
  msgRowThem: {
    alignSelf: 'flex-start'
  },
  msgAvatarCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6
  },
  msgAvatarInitials: {
    color: '#FFF',
    fontSize: 8,
    fontWeight: '900'
  },
  msgBubble: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16
  },
  msgBubbleMe: {
    borderBottomRightRadius: 2
  },
  msgBubbleThem: {
    backgroundColor: '#1E222B',
    borderBottomLeftRadius: 2
  },
  msgBodyText: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600'
  },
  msgBodyTextMe: {
    color: '#FFF'
  },
  msgBodyTextThem: {
    color: '#E4E7EB'
  },
  stickerMessageContainer: {
    padding: 2
  },
  stickerMessageChar: {
    fontSize: 36
  },
  stickerSelectionPanel: {
    backgroundColor: 'rgba(0,0,0,0.15)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.04)',
    paddingVertical: 10
  },
  stickerHorizontalScroll: {
    paddingHorizontal: 16,
    gap: 12
  },
  stickerBubbleBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  chatInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 16 : 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.05)',
    backgroundColor: 'rgba(0,0,0,0.2)'
  },
  stickerTriggerButton: {
    padding: 6,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.04)',
    marginRight: 8
  },
  stickerTriggerButtonActive: {
    backgroundColor: 'rgba(110, 91, 255, 0.2)'
  },
  chatTextInputField: {
    flex: 1,
    height: 38,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    paddingHorizontal: 12,
    color: '#FFF',
    fontSize: 11,
    fontWeight: '700'
  },
  sendMessageBtn: {
    height: 38,
    paddingHorizontal: 14,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8
  },
  sendMessageBtnText: {
    color: '#000',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.5
  },
  syncModalContainer: {
    flex: 1
  },
  syncModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)'
  },
  syncModalTitle: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.5
  },
  syncModalCloseBtn: {
    padding: 6
  },
  syncModalCloseText: {
    color: '#8A94A6',
    fontSize: 9,
    fontWeight: '900'
  },
  syncPromptBox: {
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#13161C',
    margin: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.04)'
  },
  syncPromptText: {
    color: '#8A94A6',
    fontSize: 10,
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 14
  },
  primarySyncBtn: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center'
  },
  primarySyncBtnText: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1
  },
  syncedContactsTitle: {
    color: '#FFF',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.2,
    marginBottom: 12
  },
  contactItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.04)'
  },
  contactAvatarCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(110, 91, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(110, 91, 255, 0.2)'
  },
  contactAvatarInitials: {
    color: VIOLET_ACCENT,
    fontSize: 12,
    fontWeight: '900'
  },
  contactItemName: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '800'
  },
  contactItemPhone: {
    color: '#8A94A6',
    fontSize: 9,
    fontWeight: '600',
    marginTop: 2
  },
  contactAddBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: VIOLET_ACCENT
  },
  contactAddBtnText: {
    color: VIOLET_ACCENT,
    fontSize: 9,
    fontWeight: '900'
  },
  contactPendingLabel: {
    color: '#8A94A6',
    fontSize: 9,
    fontWeight: '900'
  },
  contactFriendLabel: {
    color: EMBER_ORANGE,
    fontSize: 9,
    fontWeight: '900'
  }
});
