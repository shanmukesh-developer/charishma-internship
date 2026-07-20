import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, Alert, Modal, KeyboardAvoidingView, Platform, Animated } from 'react-native';
import { connectSocket, refreshSocketAuth } from '../utils/socket';
import { useAuth } from '../context/AuthContext';
import { COLORS, SHADOWS } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiFetch } from '../utils/auth';
import * as Notifications from 'expo-notifications';
import { WebView } from 'react-native-webview';

interface Participant {
  userId: string;
  socketId: string;
  userName: string;
  mute: boolean;
  video: boolean;
  isSpeaker: boolean;
  requestToSpeak: boolean;
}

// 🎙️ High-performance Animated Waveform for Speakers
function VoiceWaveform() {
  const anim1 = useRef(new Animated.Value(4)).current;
  const anim2 = useRef(new Animated.Value(4)).current;
  const anim3 = useRef(new Animated.Value(4)).current;

  useEffect(() => {
    const createAnim = (val: Animated.Value) => {
      return Animated.loop(
        Animated.sequence([
          Animated.timing(val, { toValue: 18, duration: 250 + Math.random() * 150, useNativeDriver: false }),
          Animated.timing(val, { toValue: 4, duration: 250 + Math.random() * 150, useNativeDriver: false })
        ])
      );
    };
    const a1 = createAnim(anim1);
    const a2 = createAnim(anim2);
    const a3 = createAnim(anim3);
    a1.start();
    a2.start();
    a3.start();
    return () => {
      a1.stop();
      a2.stop();
      a3.stop();
    };
  }, []);

  return (
    <View style={{ flexDirection: 'row', gap: 3, alignItems: 'center', height: 20, width: 20, justifyContent: 'center' }}>
      <Animated.View style={{ width: 3, height: anim1, backgroundColor: '#10B981', borderRadius: 1.5 }} />
      <Animated.View style={{ width: 3, height: anim2, backgroundColor: '#10B981', borderRadius: 1.5 }} />
      <Animated.View style={{ width: 3, height: anim3, backgroundColor: '#10B981', borderRadius: 1.5 }} />
    </View>
  );
}

// 📹 Simulated Mock Video Feed Component
function MockVideoFeed({ userName, isSelf }: { userName: string; isSelf: boolean }) {
  const rotationAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.timing(rotationAnim, {
        toValue: 1,
        duration: 8000,
        useNativeDriver: false
      })
    ).start();
  }, []);

  const spin = rotationAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg']
  });

  return (
    <View style={s.videoBox}>
      {/* Dynamic gradient mockup feed */}
      <Animated.View style={[s.videoGradient, { transform: [{ rotate: spin }] } as any]} />
      <View style={s.videoScanline} />
      <View style={s.videoOverlay}>
        <View style={s.videoAvatar}>
          <Text style={s.videoAvatarText}>{userName.substring(0, 2).toUpperCase()}</Text>
        </View>
        <Text style={s.videoLabel}>{userName.toUpperCase()} {isSelf ? '(YOU)' : ''}</Text>
        <View style={s.videoStatusPill}>
          <View style={s.videoLiveDot} />
          <Text style={s.videoLiveText}>RAW HD STREAM</Text>
        </View>
      </View>
    </View>
  );
}

// 🔊 WhatsApp Pulsing Avatar for Voice Calls
function PulsingAvatar({ name, isSpeaking = true }: { name: string; isSpeaking?: boolean }) {
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    let animation: Animated.CompositeAnimation | null = null;
    if (isSpeaking) {
      animation = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.3, duration: 1500, useNativeDriver: false }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 1500, useNativeDriver: false })
        ])
      );
      animation.start();
    } else {
      pulseAnim.setValue(1);
    }
    return () => {
      animation?.stop();
    };
  }, [isSpeaking]);

  return (
    <View style={s.pulseAvatarContainer}>
      <Animated.View style={[s.pulseRing, { transform: [{ scale: pulseAnim }], opacity: 0.18 } as any]} />
      <Animated.View style={[s.pulseRing, { transform: [{ scale: pulseAnim.interpolate({ inputRange: [1, 1.3], outputRange: [1, 1.5] }) }], opacity: 0.08 } as any]} />
      <View style={s.pulseAvatarCircle}>
        <Text style={s.pulseAvatarText}>{name.substring(0, 2).toUpperCase()}</Text>
      </View>
    </View>
  );
}

export default function ZenvyAfterDarkLounge() {
  const { user, refreshUser } = useAuth();
  const { isDark } = useTheme();
  
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'dms' | 'rooms'>('dms');
  const [activeChat, setActiveChat] = useState<any | null>(null); // { type: 'friend' | 'room', id, name }
  const [messages, setMessages] = useState<any[]>([]);
  const [inputText, setInputText] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  
  // WhatsApp Chat Features States
  const [replyingTo, setReplyingTo] = useState<any | null>(null);
  const [activeReactionMsgId, setActiveReactionMsgId] = useState<string | null>(null);
  
  // Call State
  const [inCall, setInCall] = useState(false);
  const [callMode, setCallMode] = useState<'audio' | 'video'>('audio');
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOn, setIsVideoOn] = useState(false);
  const [isSpeaker, setIsSpeaker] = useState(true);
  const [hasRequestedToSpeak, setHasRequestedToSpeak] = useState(false);
  const [callParticipants, setCallParticipants] = useState<Participant[]>([]);
  const [speakingUsers, setSpeakingUsers] = useState<Record<string, boolean>>({});
  const [showCallScreen, setShowCallScreen] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [incomingCall, setIncomingCall] = useState<{ show: boolean; name: string; mode: 'audio' | 'video' }>({
    show: false,
    name: '',
    mode: 'audio'
  });

  useEffect(() => {
    let timer: any;
    if (inCall) {
      setCallDuration(0);
      timer = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
    } else {
      setCallDuration(0);
    }
    return () => clearInterval(timer);
  }, [inCall]);

  const formatDuration = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const secs = sec % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Speaking state is now driven by real call_participants_list from server
  // No mock simulation needed

  const simulateIncomingCall = (mode: 'audio' | 'video') => {
    const callerName = friends[0]?.name || "Alex (Developer)";
    setIncomingCall({
      show: true,
      name: callerName,
      mode
    });
  };

  const testBackgroundCallNotification = async (mode: 'audio' | 'video') => {
    const callerName = friends[0]?.name || "Alex (Developer)";
    Alert.alert(
      "WhatsApp Background Test",
      "We will trigger a call notification in 5 seconds. Lock your screen or press Home now to simulate the app being closed.",
      [
        {
          text: "Start 5s Delay",
          onPress: async () => {
            if (Platform.OS === 'web') {
              Alert.alert('Not Supported', 'Local call scheduling notifications are not supported in web browser previews.');
              return;
            }
            try {
              await Notifications.scheduleNotificationAsync({
                content: {
                  title: `📞 Incoming Zenvy Call`,
                  body: `${callerName} is calling you...`,
                  data: { type: 'call', callerName, mode },
                  sound: true,
                  priority: Notifications.AndroidNotificationPriority.MAX,
                  categoryIdentifier: 'incoming-call',
                },
                trigger: { seconds: 5 } as any,
              });
            } catch (err) {
              console.warn('Error scheduling push notification:', err);
            }
          }
        },
        { text: "Cancel", style: "cancel" }
      ]
    );
  };

  // Data states
  const [friends, setFriends] = useState<any[]>([]);
  const [rooms, setRooms] = useState<any[]>([]);
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);
  const [newFriendCode, setNewFriendCode] = useState('');
  const [newRoomCode, setNewRoomCode] = useState('');
  
  const socketRef = useRef<any>(null);
  const scrollViewRef = useRef<ScrollView>(null);
  
  const txt = isDark ? COLORS.textPrimary : COLORS.textDark;
  const txtSec = isDark ? COLORS.textSecondary : COLORS.textDarkSecondary;
  const cardBg = isDark ? '#1A1A1D' : '#F9FAFB';
  const border = isDark ? 'rgba(167, 139, 250, 0.3)' : 'rgba(139, 92, 246, 0.3)';

  useEffect(() => {
    const checkAutoAnswer = async () => {
      try {
        const stored = await AsyncStorage.getItem('zenvy_auto_answer_call');
        if (stored) {
          await AsyncStorage.removeItem('zenvy_auto_answer_call');
          const data = JSON.parse(stored);
          const chatId = data.groupId || data.callerName;
          setIsOpen(true);
          setActiveChat({ type: 'friend', id: chatId, name: data.callerName });
          setCallMode(data.mode);
          setInCall(true);
          setIsMuted(false);
          setIsVideoOn(data.mode === 'video');
          setIsSpeaker(true);
          setHasRequestedToSpeak(false);
          setShowCallScreen(true);
          
          // Join the real Jitsi call room via socket
          socketRef.current?.emit('join_after_dark_group', { groupId: chatId });
          socketRef.current?.emit('join_after_dark_call', { 
            groupId: chatId, 
            userName: user?.name || 'Anonymous',
            mute: false,
            video: data.mode === 'video',
            isSpeaker: true
          });
        }
      } catch (err) {
        console.warn('Error checking auto-answer:', err);
      }
    };
    checkAutoAnswer();

    if (isOpen && user) {
      refreshUser(); 
      fetchFriends();
      fetchRooms();
      fetchPendingRequests();
    }
  }, [isOpen]);

  useEffect(() => {
    refreshSocketAuth();
    socketRef.current = connectSocket();
    const socket = socketRef.current;
    setIsConnected(socket.connected);

    const handleConnect = () => setIsConnected(true);
    const handleDisconnect = () => setIsConnected(false);
    const handleConnectError = () => setIsConnected(false);

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('connect_error', handleConnectError);

    socket.on('receive_after_dark_message', (msg: any) => {
      setMessages((prev) => [...prev, msg]);
      setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 100);
    });

    socket.on('receive_message_reaction', (data: any) => {
      setMessages((prev) => prev.map(m => {
        const mId = m.id || m._id;
        if (mId === data.messageId) {
          return { ...m, reactions: JSON.stringify(data.reactions) };
        }
        return m;
      }));
    });

    socket.on('call_participants_list', (data: any) => {
      setCallParticipants(data.participants || []);
    });

    socket.on('user_joined_call', (data: any) => {
      setCallParticipants((prev) => {
        if (prev.some(p => p.socketId === data.socketId)) return prev;
        return [...prev, data];
      });
    });

    socket.on('user_left_call', (data: any) => {
      setCallParticipants((prev) => prev.filter(p => p.socketId !== data.socketId));
    });

    socket.on('call_error', (data: any) => {
      Alert.alert('Call Error', data.message);
      setInCall(false);
      setShowCallScreen(false);
    });

    socket.on('speaker_approved', () => {
      setIsSpeaker(true);
      setHasRequestedToSpeak(false);
      Alert.alert('Lounge Stage', 'The host has approved you to speak!');
    });

    socket.on('user_muted_by_host', () => {
      setIsMuted(true);
      Alert.alert('Muted', 'You have been muted by the host.');
      socket.emit('update_call_state', { groupId: activeChat?.id, mute: true });
    });

    // Real incoming call signal from a friend who started a call
    socket.on('incoming_call_signal', (data: any) => {
      setIncomingCall({
        show: true,
        name: data.callerName || 'Friend',
        mode: data.mode || 'audio'
      });
    });

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('connect_error', handleConnectError);
      socket.off('receive_after_dark_message');
      socket.off('receive_message_reaction');
      socket.off('call_participants_list');
      socket.off('user_joined_call');
      socket.off('user_left_call');
      socket.off('call_error');
      socket.off('speaker_approved');
      socket.off('user_muted_by_host');
      socket.off('incoming_call_signal');
    };
  }, [activeChat?.id]);

  // Synchronize room membership with socket connection/reconnections and active chat selection
  useEffect(() => {
    if (isConnected && activeChat && socketRef.current) {
      socketRef.current.emit('join_after_dark_group', { groupId: activeChat.id });
      if (inCall) {
        socketRef.current.emit('join_after_dark_call', { 
          groupId: activeChat.id, 
          userName: user?.name || 'Anonymous',
          mute: isMuted,
          video: isVideoOn,
          isSpeaker
        });
      }
    }
  }, [isConnected, activeChat?.id, inCall]);

  // Simulate Speaking states (Twitter Spaces audio visual feedback)
  useEffect(() => {
    if (!inCall) return;
    const interval = setInterval(() => {
      const speaking: Record<string, boolean> = {};
      callParticipants.forEach(p => {
        if (!p.mute && p.isSpeaker && Math.random() > 0.45) {
          speaking[p.socketId] = true;
        }
      });
      setSpeakingUsers(speaking);
    }, 1200);
    return () => clearInterval(interval);
  }, [inCall, callParticipants]);

  const fetchFriends = async () => {
    try {
      const res = await apiFetch('/api/friends/list');
      if (res.ok) {
        const data = await res.json();
        setFriends(data.friends || []);
      }
    } catch (e) { console.error(e); }
  };

  const fetchPendingRequests = async () => {
    try {
      const res = await apiFetch('/api/friends/pending');
      if (res.ok) {
        const data = await res.json();
        setPendingRequests(data.requests || []);
      }
    } catch (e) { console.error(e); }
  };

  const handleHandleRequest = async (requestId: string, action: 'accept' | 'reject') => {
    try {
      const res = await apiFetch('/api/friends/handle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, action })
      });
      const data = await res.json();
      if (res.ok) {
        Alert.alert('Success', `Friend request ${action}ed!`);
        fetchPendingRequests();
        fetchFriends();
      } else {
        Alert.alert('Error', data.message || `Failed to ${action} request`);
      }
    } catch (e) { Alert.alert('Error', 'Network request failed.'); }
  };

  const fetchRooms = async () => {
    try {
      const res = await apiFetch('/api/rooms/my-rooms');
      if (res.ok) {
        const data = await res.json();
        setRooms(data.rooms || []);
      }
    } catch (e) { console.error(e); }
  };

  const handleAddFriend = async () => {
    if (!newFriendCode.trim()) return;
    try {
      const res = await apiFetch('/api/friends/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ friendCode: newFriendCode.trim().toUpperCase() })
      });
      const data = await res.json();
      if (res.ok) {
        Alert.alert('Success', 'Friend request sent!');
        setNewFriendCode('');
      } else {
        Alert.alert('Error', data.message || 'Failed to add friend');
      }
    } catch (e) { Alert.alert('Error', 'Network request failed.'); }
  };

  const handleJoinRoom = async () => {
    if (!newRoomCode.trim()) return;
    try {
      const res = await apiFetch('/api/rooms/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ joinCode: newRoomCode.trim().toUpperCase() })
      });
      const data = await res.json();
      if (res.ok) {
        Alert.alert('Success', 'Joined room!');
        setNewRoomCode('');
        fetchRooms();
      } else {
        Alert.alert('Error', data.message || 'Failed to join room');
      }
    } catch (e) { Alert.alert('Error', 'Network request failed.'); }
  };

  const handleCreateRoom = async () => {
    try {
      const res = await apiFetch('/api/rooms/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: (user?.name || 'Anonymous') + "'s Room", ttlHours: 24 })
      });
      const data = await res.json();
      if (res.ok) {
        Alert.alert('Room Created!', `Share this code with your friends: ${data.room.joinCode}`);
        fetchRooms();
      } else {
        Alert.alert('Error', 'Failed to create room');
      }
    } catch (e) { Alert.alert('Error', 'Network request failed.'); }
  };

  const fetchMessages = async (chatId: string) => {
    try {
      const res = await apiFetch(`/api/chat/conversations/${chatId}/messages`);
      if (res.ok) {
        const data = await res.json();
        setMessages(data || []);
        setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 200);
      } else {
        const text = await res.text();
        console.warn(`Failed to fetch messages: status ${res.status}, body ${text}`);
      }
    } catch (e: any) {
      console.error(e);
    }
  };

  const openChat = (item: any, type: 'friend' | 'room') => {
    const chatId = type === 'friend' ? item.friendshipId : item.id;
    setActiveChat({ type, id: chatId, name: item.name });
    setMessages([]);
    fetchMessages(chatId);
    socketRef.current?.emit('join_after_dark_group', { groupId: chatId });
  };

  const handleSendMessage = () => {
    if (!inputText.trim() || !activeChat) return;
    const payload: any = {
      groupId: activeChat.id,
      text: inputText,
      senderName: user?.name || 'Anonymous'
    };
    if (replyingTo) {
      payload.replyTo = {
        text: replyingTo.text,
        senderName: replyingTo.senderName || 'Friend'
      };
    }
    socketRef.current?.emit('send_after_dark_message', payload);
    setInputText('');
    setReplyingTo(null);
  };

  // Call options operations — REAL WebRTC via Jitsi Meet
  const startCall = (mode: 'audio' | 'video') => {
    if (!activeChat) return;
    setCallMode(mode);
    setInCall(true);
    setIsMuted(false);
    setIsVideoOn(mode === 'video');
    setIsSpeaker(true);
    setHasRequestedToSpeak(false);
    setShowCallScreen(true);

    // Join the server-side call room (triggers FCM push to offline friends)
    socketRef.current?.emit('join_after_dark_call', { 
      groupId: activeChat.id, 
      userName: user?.name || 'Anonymous',
      mute: false,
      video: mode === 'video',
      isSpeaker: true
    });
  };

  const leaveCall = () => {
    if (!activeChat) return;
    socketRef.current?.emit('leave_after_dark_call', { groupId: activeChat.id });
    setInCall(false);
    setShowCallScreen(false);
    setCallParticipants([]);
    setIsVideoOn(false);
    setIsMuted(false);
  };

  const toggleMute = () => {
    const nextVal = !isMuted;
    setIsMuted(nextVal);
    socketRef.current?.emit('update_call_state', { groupId: activeChat?.id, mute: nextVal });
  };

  const toggleVideo = () => {
    const nextVal = !isVideoOn;
    setIsVideoOn(nextVal);
    socketRef.current?.emit('update_call_state', { groupId: activeChat?.id, video: nextVal });
  };

  const toggleSpeakRequest = () => {
    const nextVal = !hasRequestedToSpeak;
    setHasRequestedToSpeak(nextVal);
    socketRef.current?.emit('update_call_state', { groupId: activeChat?.id, requestToSpeak: nextVal });
  };

  const toggleSpeakerRole = () => {
    const nextVal = !isSpeaker;
    setIsSpeaker(nextVal);
    socketRef.current?.emit('update_call_state', { groupId: activeChat?.id, isSpeaker: nextVal });
  };

  const hostApproveSpeaker = (targetSocketId: string) => {
    socketRef.current?.emit('approve_speaker', { groupId: activeChat?.id, targetSocketId });
  };

  const hostMuteUser = (targetSocketId: string) => {
    socketRef.current?.emit('mute_user', { groupId: activeChat?.id, targetSocketId });
  };

  const handleBackToMain = () => {
    if (inCall && activeChat) {
      leaveCall();
    }
    setActiveChat(null);
  };

  // Determine if current user is the Call Host (first joiner in the participants list)
  const isHost = callParticipants[0]?.userId === user?.id || callParticipants[0]?.userId === user?._id;

  return (
    <View style={s.container}>
      {/* Launch Banner embedded in the feed */}
      <TouchableOpacity 
        style={[s.header, { backgroundColor: 'rgba(139, 92, 246, 0.15)', borderColor: border }]}
        activeOpacity={0.8}
        onPress={() => setIsOpen(true)}
      >
        <View style={s.headerLeft}>
          <Text style={{ fontSize: 24 }}>🌙</Text>
          <View>
            <Text style={[s.headerTitle, { color: txt }]}>ZENVY LOUNGE</Text>
            <Text style={[s.headerSub, { color: '#8B5CF6' }]}>EPHEMERAL VOICE & VIDEO</Text>
          </View>
        </View>
        <View style={[s.openBtn, { backgroundColor: '#8B5CF6' }]}>
          <Text style={s.openBtnText}>ENTER</Text>
        </View>
      </TouchableOpacity>

      {/* FULL SCREEN MODAL */}
      <Modal visible={isOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setIsOpen(false)}>
        <KeyboardAvoidingView 
          style={[s.modalContainer, { backgroundColor: cardBg }]} 
          behavior={Platform.OS === 'ios' ? 'padding' : 'padding'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 80}
        >
          
          {/* Main Navigation when not in a chat */}
          {!activeChat ? (
            <View style={{ flex: 1 }}>
              
              {/* Huge Profile Code Banner */}
              <View style={s.codeBanner}>
                <View style={s.modalHeaderRow}>
                  <Text style={s.codeBannerTitle}>YOUR FRIEND CODE</Text>
                  <TouchableOpacity onPress={() => setIsOpen(false)} style={s.closeModalBtn}>
                     <Text style={{ color: '#FFF', fontWeight: 'bold', fontSize: 18 }}>✕</Text>
                  </TouchableOpacity>
                </View>
                <Text style={s.codeBannerCode}>{user?.friendCode || 'Loading...'}</Text>
                <Text style={s.codeBannerSub}>Connect with campus peers securely & stream live!</Text>
              </View>

              {/* Tabs */}
              <View style={s.tabs}>
                <TouchableOpacity style={[s.tab, activeTab === 'dms' && s.activeTab]} onPress={() => setActiveTab('dms')}>
                  <Text style={[s.tabText, activeTab === 'dms' && { color: txt }]}>Direct Messages</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.tab, activeTab === 'rooms' && s.activeTab]} onPress={() => setActiveTab('rooms')}>
                  <Text style={[s.tabText, activeTab === 'rooms' && { color: txt }]}>Custom Rooms</Text>
                </TouchableOpacity>
              </View>

              <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
                {activeTab === 'dms' ? (
                  <View>
                    <View style={s.inputRow}>
                      <TextInput 
                        style={[s.smallInput, { color: txt, borderColor: border }]} 
                        placeholder="Enter Friend Code (ZNV-...)"
                        placeholderTextColor={txtSec}
                        value={newFriendCode}
                        onChangeText={setNewFriendCode}
                        autoCapitalize="characters"
                      />
                      <TouchableOpacity style={s.actionBtn} onPress={handleAddFriend}>
                        <Text style={s.actionBtnText}>Add</Text>
                      </TouchableOpacity>
                    </View>


                    
                    {pendingRequests.length > 0 && (
                      <View style={{ marginTop: 24 }}>
                        <Text style={[s.sectionTitle, { color: '#8B5CF6', marginBottom: 12 }]}>PENDING FRIEND REQUESTS ({pendingRequests.length})</Text>
                        {pendingRequests.map(r => (
                          <View key={r.friendshipId} style={[s.listItem, { borderColor: border, backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : '#FFF', justifyContent: 'space-between', flexDirection: 'row', alignItems: 'center' }]}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, flex: 1 }}>
                              <View style={s.avatarWrap}><Text style={{ fontSize: 20 }}>👤</Text></View>
                              <View style={{ flex: 1 }}>
                                <Text style={[s.listName, { color: txt }]} numberOfLines={1}>{r.name}</Text>
                                <Text style={{ color: txtSec, fontSize: 11 }}>Code: {r.friendCode}</Text>
                              </View>
                            </View>
                            <View style={{ flexDirection: 'row', gap: 8 }}>
                              <TouchableOpacity style={[s.smallActionBtn, { backgroundColor: '#10B981' }]} onPress={() => handleHandleRequest(r.friendshipId, 'accept')}>
                                <Text style={s.smallActionBtnText}>✓</Text>
                              </TouchableOpacity>
                              <TouchableOpacity style={[s.smallActionBtn, { backgroundColor: '#EF4444' }]} onPress={() => handleHandleRequest(r.friendshipId, 'reject')}>
                                <Text style={s.smallActionBtnText}>✕</Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                        ))}
                      </View>
                    )}
                    
                    <Text style={[s.sectionTitle, { color: txtSec, marginTop: 24 }]}>YOUR FRIENDS</Text>
                    {friends.length === 0 ? (
                      <View style={s.emptyState}>
                         <Text style={{ fontSize: 40, marginBottom: 10 }}>👥</Text>
                         <Text style={{ color: txtSec, textAlign: 'center', fontSize: 14 }}>No friends yet.{'\n'}Share your code above or add someone using theirs!</Text>
                      </View>
                    ) : (
                      friends.map(f => (
                        <TouchableOpacity key={f.id} style={[s.listItem, { borderColor: border, backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : '#FFF' }]} onPress={() => openChat(f, 'friend')}>
                          <View style={s.avatarWrap}><Text style={{ fontSize: 20 }}>👤</Text></View>
                          <Text style={[s.listName, { color: txt }]}>{f.name}</Text>
                        </TouchableOpacity>
                      ))
                    )}
                  </View>
                ) : (
                  <View>
                    <View style={s.inputRow}>
                      <TextInput 
                        style={[s.smallInput, { color: txt, borderColor: border }]} 
                        placeholder="Enter 8-Char Room Code"
                        placeholderTextColor={txtSec}
                        value={newRoomCode}
                        onChangeText={setNewRoomCode}
                        autoCapitalize="characters"
                      />
                      <TouchableOpacity style={s.actionBtn} onPress={handleJoinRoom}>
                        <Text style={s.actionBtnText}>Join</Text>
                      </TouchableOpacity>
                    </View>

                    <TouchableOpacity style={[s.actionBtn, { width: '100%', marginTop: 12, paddingVertical: 14 }]} onPress={handleCreateRoom}>
                      <Text style={[s.actionBtnText, { fontSize: 14 }]}>+ Create New Private Room</Text>
                    </TouchableOpacity>
                    
                    <Text style={[s.sectionTitle, { color: txtSec, marginTop: 24 }]}>YOUR ROOMS</Text>
                    {rooms.length === 0 ? (
                      <View style={s.emptyState}>
                         <Text style={{ fontSize: 40, marginBottom: 10 }}>🚪</Text>
                         <Text style={{ color: txtSec, textAlign: 'center', fontSize: 14 }}>You haven't joined any rooms.{'\n'}Create one to chat with up to 20 people.</Text>
                      </View>
                    ) : (
                      rooms.map(r => (
                        <TouchableOpacity key={r.id} style={[s.listItem, { borderColor: border, backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : '#FFF' }]} onPress={() => openChat(r, 'room')}>
                          <View style={s.avatarWrap}><Text style={{ fontSize: 20 }}>🚪</Text></View>
                          <View>
                            <Text style={[s.listName, { color: txt }]}>{r.name}</Text>
                            <Text style={{ color: txtSec, fontSize: 11, marginTop: 2 }}>Code: {r.joinCode}</Text>
                          </View>
                        </TouchableOpacity>
                      ))
                    )}
                  </View>
                )}
              </ScrollView>
            </View>
          ) : (
            
            // Active Chat Interface
            <View style={s.activeChat}>
              <View style={[s.chatHeader, { borderBottomColor: border, backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#FFF' }]}>
                <TouchableOpacity style={s.backBtn} onPress={handleBackToMain}>
                  <Text style={{ color: '#8B5CF6', fontWeight: 'bold', fontSize: 16 }}>← Back</Text>
                </TouchableOpacity>
                
                <View style={{ alignItems: 'center', flex: 1, marginHorizontal: 8 }}>
                  <Text style={[s.chatHeaderTitle, { color: txt }]} numberOfLines={1}>{activeChat.name}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                    <Text style={{ color: '#EF4444', fontSize: 10, fontWeight: 'bold' }}>⏳ Vanishes in 12h</Text>
                    <Text style={{ color: txtSec, fontSize: 8 }}>•</Text>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: isConnected ? '#10B981' : '#EF4444' }} />
                    <Text style={{ color: isConnected ? '#10B981' : '#EF4444', fontSize: 8, fontWeight: '900' }}>
                      {isConnected ? 'LIVE' : 'OFFLINE'}
                    </Text>
                  </View>
                </View>

                {/* Audio and Video Launch Call Buttons */}
                {!inCall ? (
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    <TouchableOpacity style={s.circleCallBtn} onPress={() => startCall('audio')}>
                      <Text style={{ fontSize: 16 }}>📞</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[s.circleCallBtn, { backgroundColor: '#8B5CF6' }]} onPress={() => startCall('video')}>
                      <Text style={{ fontSize: 16 }}>📹</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity style={s.ongoingCallBtn} onPress={() => setShowCallScreen(true)}>
                    <Text style={s.ongoingCallBtnText}>ONGOING 🟢</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Minimal persistent channel indicator if not in full Call Space View */}
              {inCall && !showCallScreen && (
                <TouchableOpacity 
                  style={s.miniChannelBar} 
                  onPress={() => setShowCallScreen(true)}
                  activeOpacity={0.9}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={{ fontSize: 14 }}>🎙️</Text>
                    <Text style={s.miniChannelText}>Connected to Call Room ({callParticipants.length} inside)</Text>
                  </View>
                  <Text style={s.miniChannelAction}>TAP TO EXPAND ↗</Text>
                </TouchableOpacity>
              )}

              {/* Chat Messages */}
              <ScrollView ref={scrollViewRef} style={s.messagesArea} contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
                {messages.map((msg, idx) => {
                  const isMe = msg.senderId === user?.id || msg.senderId === user?._id;
                  const mId = msg.id || msg._id || String(idx);
                  
                  // Parse replyTo data
                  let replyData = null;
                  if (msg.replyTo) {
                    try {
                      replyData = typeof msg.replyTo === 'string' ? JSON.parse(msg.replyTo) : msg.replyTo;
                    } catch (e) {}
                  }

                  // Parse reactions data
                  let reactionsList: any[] = [];
                  if (msg.reactions) {
                    try {
                      reactionsList = typeof msg.reactions === 'string' ? JSON.parse(msg.reactions) : msg.reactions;
                    } catch (e) {}
                  }

                  return (
                    <View key={mId} style={{ marginBottom: 16 }}>
                      {/* Reaction Popup overlay */}
                      {activeReactionMsgId === mId && (
                        <View style={[s.reactionToolbar, isMe ? { alignSelf: 'flex-end' } : { alignSelf: 'flex-start' }]}>
                          {['👍', '❤️', '😂', '😮', '😢', '🙏'].map(emoji => (
                            <TouchableOpacity
                              key={emoji}
                              style={s.reactionToolbarBtn}
                              onPress={() => {
                                socketRef.current?.emit('react_to_after_dark_message', {
                                  messageId: mId,
                                  emoji,
                                  groupId: activeChat.id
                                });
                                setActiveReactionMsgId(null);
                              }}
                            >
                              <Text style={{ fontSize: 20 }}>{emoji}</Text>
                            </TouchableOpacity>
                          ))}
                          <TouchableOpacity 
                            style={[s.reactionToolbarBtn, { backgroundColor: 'rgba(255,255,255,0.1)' }]} 
                            onPress={() => setActiveReactionMsgId(null)}
                          >
                            <Text style={{ color: '#EF4444', fontWeight: 'bold', fontSize: 12 }}>✕</Text>
                          </TouchableOpacity>
                        </View>
                      )}

                      <View style={[s.messageWrap, isMe ? s.msgMe : s.msgOther]}>
                        {/* Sender name above bubble (always shown) */}
                        <Text style={[s.msgSender, isMe ? { textAlign: 'right', color: '#C9A84C' } : { color: '#8B5CF6' }]}>
                          {isMe ? `YOU (${(user?.name || 'SHANMUKH').toUpperCase()})` : (msg.senderName || 'FRIEND').toUpperCase()}
                        </Text>

                        <TouchableOpacity 
                          activeOpacity={0.95}
                          onLongPress={() => setActiveReactionMsgId(mId)}
                          style={[
                            s.messageBubble, 
                            isMe ? { backgroundColor: '#8B5CF6' } : { backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : '#E5E7EB' },
                            { position: 'relative', paddingBottom: reactionsList.length > 0 ? 22 : 12 }
                          ]}
                        >
                          {/* Replied-To / Quoted Quote Display */}
                          {replyData && (
                            <View style={[s.replyBubbleHeader, { borderLeftColor: isMe ? '#FFF' : '#8B5CF6' }]}>
                              <Text style={[s.replyBubbleSender, { color: isMe ? '#C9A84C' : '#8B5CF6' }]}>
                                {replyData.senderName?.toUpperCase()}
                              </Text>
                              <Text style={{ fontSize: 11, color: isMe ? 'rgba(255,255,255,0.8)' : txtSec }} numberOfLines={2}>
                                {replyData.text}
                              </Text>
                            </View>
                          )}

                          <Text style={{ color: isMe ? '#FFF' : txt, fontSize: 14 }}>{msg.text}</Text>

                          {/* Reactions badges overlay inside bubble */}
                          {reactionsList.length > 0 && (
                            <View style={s.bubbleReactionsWrap}>
                              {reactionsList.slice(0, 3).map((r, rIdx) => (
                                <Text key={rIdx} style={{ fontSize: 12, marginRight: 2 }}>{r.emoji}</Text>
                              ))}
                              {reactionsList.length > 3 && <Text style={{ fontSize: 9, color: isMe ? '#FFF' : txtSec }}>+{reactionsList.length - 3}</Text>}
                            </View>
                          )}

                          {/* Time & Double Ticks details at the bottom of the bubble */}
                          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginTop: 4, gap: 4 }}>
                            <Text style={{ fontSize: 8, color: isMe ? 'rgba(255,255,255,0.6)' : txtSec }}>
                              {new Date(msg.createdAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </Text>
                            {isMe && (
                              <Text style={{ fontSize: 10, color: '#3B82F6', fontWeight: 'bold' }}>✓✓</Text>
                            )}
                          </View>
                        </TouchableOpacity>

                        {/* Action buttons (Reply & React toggle buttons) next to message */}
                        <View style={{ flexDirection: 'row', gap: 8, marginTop: 4, alignSelf: isMe ? 'flex-end' : 'flex-start' }}>
                          <TouchableOpacity onPress={() => setReplyingTo({ id: mId, text: msg.text, senderName: msg.senderName })}>
                            <Text style={{ fontSize: 10, color: '#8B5CF6', fontWeight: 'bold' }}>REPLY ↩</Text>
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => setActiveReactionMsgId(activeReactionMsgId === mId ? null : mId)}>
                            <Text style={{ fontSize: 10, color: txtSec, fontWeight: 'bold' }}>REACT 😊</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    </View>
                  );
                })}
              </ScrollView>

              {/* Replying-To bar display if message is quoted */}
              {replyingTo && (
                <View style={[s.replyInputBar, { backgroundColor: isDark ? '#26262B' : '#F3F4F6', borderTopColor: border }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.replyInputTitle, { color: '#8B5CF6' }]}>REPLYING TO {replyingTo.senderName?.toUpperCase()}</Text>
                    <Text style={{ color: txtSec, fontSize: 12 }} numberOfLines={1}>{replyingTo.text}</Text>
                  </View>
                  <TouchableOpacity onPress={() => setReplyingTo(null)} style={{ padding: 6 }}>
                    <Text style={{ color: '#EF4444', fontWeight: 'bold', fontSize: 16 }}>✕</Text>
                  </TouchableOpacity>
                </View>
              )}

              <View style={[s.inputArea, { borderTopColor: border, backgroundColor: isDark ? 'rgba(255,255,255,0.02)' : '#FFF' }]}>
                <TextInput
                  style={[s.input, { color: txt, backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }]}
                  placeholder="Say something ephemeral..."
                  placeholderTextColor={txtSec}
                  value={inputText}
                  onChangeText={setInputText}
                />
                <TouchableOpacity style={s.sendBtn} onPress={handleSendMessage}>
                  <Text style={{ color: '#FFF', fontWeight: 'bold' }}>SEND</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* 🎙️ / 📹 FULL SCREEN CALL SPACE VIEW (REAL-TIME WEBRTC CALLING VIA JITSI) */}
          <Modal visible={showCallScreen} animationType="slide" presentationStyle="overFullScreen" transparent={true}>
            <View style={[s.callScreenContainer, { backgroundColor: '#0b141a', flex: 1 }]}>
              
              {/* Header Bar */}
              <View style={{
                height: 60,
                backgroundColor: '#16161A',
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingHorizontal: 16,
                borderBottomWidth: 1,
                borderBottomColor: '#26262B',
                marginTop: Platform.OS === 'ios' ? 40 : 0
              }}>
                <TouchableOpacity 
                  style={{
                    backgroundColor: 'rgba(255, 255, 255, 0.08)',
                    paddingVertical: 6,
                    paddingHorizontal: 12,
                    borderRadius: 8
                  }} 
                  onPress={() => setShowCallScreen(false)}
                >
                  <Text style={{ color: '#FFF', fontWeight: 'bold', fontSize: 12 }}>🗕 MINIMIZE</Text>
                </TouchableOpacity>

                <View style={{ alignItems: 'center' }}>
                  <Text style={{ color: '#FFF', fontWeight: 'bold', fontSize: 14 }}>
                    {activeChat?.name?.toUpperCase() || 'LIVE CALL'}
                  </Text>
                  <Text style={{ color: '#10B981', fontSize: 10, fontWeight: '600', marginTop: 2 }}>
                    🟢 REAL-TIME WEBRTC ACTIVE
                  </Text>
                </View>

                <TouchableOpacity 
                  style={{
                    backgroundColor: '#EF4444',
                    paddingVertical: 6,
                    paddingHorizontal: 12,
                    borderRadius: 8
                  }} 
                  onPress={leaveCall}
                >
                  <Text style={{ color: '#FFF', fontWeight: 'bold', fontSize: 12 }}>🔴 HANG UP</Text>
                </TouchableOpacity>
              </View>

              {/* Jitsi WebRTC Container — Real video/audio call */}
              {showCallScreen && activeChat && (() => {
                const roomName = `ZenvyCall${activeChat.id.replace(/[^a-zA-Z0-9]/g, '')}`;
                const displayName = encodeURIComponent(user?.name || 'Zenvy User');
                const jitsiUrl = `https://meet.jit.si/${roomName}#config.prejoinPageEnabled=false&config.disableDeepLinking=true&config.startWithAudioMuted=${isMuted}&config.startWithVideoMuted=${!isVideoOn}&userInfo.displayName=${displayName}&config.toolbarButtons=["microphone","camera","hangup","tileview","chat"]`;
                return (
                  <WebView
                    key={roomName}
                    source={{ uri: jitsiUrl }}
                    style={{ flex: 1 }}
                    allowsInlineMediaPlayback={true}
                    mediaPlaybackRequiresUserAction={false}
                    domStorageEnabled={true}
                    javaScriptEnabled={true}
                    originWhitelist={['*']}
                    allowsFullscreenVideo={true}
                    injectedJavaScriptBeforeContentLoaded={`
                      window._jitsiDisplayName = "${user?.name || 'Zenvy User'}";
                      true;
                    `}
                    onNavigationStateChange={(navState) => {
                      if (
                        navState.url.includes('close.html') || 
                        navState.url.includes('/static/close') || 
                        (!navState.url.includes('meet.jit.si') && !navState.url.includes('about:blank'))
                      ) {
                        leaveCall();
                      }
                    }}
                  />
                );
              })()}
            </View>
          </Modal>

          {/* 📞 INBOUND CALL OVERLAY (WHATSAPP CALLING ANIMATION) */}
          <Modal visible={incomingCall.show} animationType="fade" presentationStyle="overFullScreen" transparent={true}>
            <View style={s.inboundCallOverlay}>
              <Text style={s.inboundCallType}>
                {incomingCall.mode === 'video' ? '📹 ZENVY VIDEO CALL' : '🎙️ ZENVY AUDIO CALL'}
              </Text>
              
              <Text style={s.inboundCallName}>{incomingCall.name}</Text>
              
              <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                <PulsingAvatar name={incomingCall.name} isSpeaking={true} />
              </View>

              <View style={s.inboundCallActions}>
                <TouchableOpacity 
                  style={[s.inboundCallBtn, { backgroundColor: '#EF4444' }]} 
                  onPress={() => {
                    setIncomingCall(prev => ({ ...prev, show: false }));
                    Alert.alert('Call Declined', 'You declined the call.');
                  }}
                >
                  <Text style={s.inboundCallBtnEmoji}>❌</Text>
                  <Text style={s.inboundCallBtnText}>DECLINE</Text>
                </TouchableOpacity>

                <TouchableOpacity 
                  style={[s.inboundCallBtn, { backgroundColor: '#10B981' }]} 
                  onPress={() => {
                    const name = incomingCall.name;
                    const mode = incomingCall.mode;
                    setIncomingCall(prev => ({ ...prev, show: false }));
                    
                    // Find the friend who is calling by matching their name
                    const callingFriend = friends.find(f => f.name === name);
                    const chatId = callingFriend?.friendshipId || activeChat?.id || name;
                    
                    // Set active chat to the caller's real conversation
                    if (!activeChat || activeChat.id !== chatId) {
                      setActiveChat({ type: 'friend', id: chatId, name });
                      fetchMessages(chatId);
                      socketRef.current?.emit('join_after_dark_group', { groupId: chatId });
                    }
                    
                    // Start the real call — joins Jitsi via the same room ID
                    setCallMode(mode);
                    setInCall(true);
                    setIsMuted(false);
                    setIsVideoOn(mode === 'video');
                    setIsSpeaker(true);
                    setHasRequestedToSpeak(false);
                    setShowCallScreen(true);
                    
                    // Join the server-side call room
                    socketRef.current?.emit('join_after_dark_call', { 
                      groupId: chatId, 
                      userName: user?.name || 'Anonymous',
                      mute: false,
                      video: mode === 'video',
                      isSpeaker: true
                    });
                  }}
                >
                  <Text style={s.inboundCallBtnEmoji}>📞</Text>
                  <Text style={s.inboundCallBtnText}>ANSWER</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>

        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  container: { marginHorizontal: 16, marginBottom: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderRadius: 20, borderWidth: 1 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerTitle: { fontSize: 14, fontWeight: '900', letterSpacing: 1 },
  headerSub: { fontSize: 9, fontWeight: '800', letterSpacing: 2 },
  openBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
  openBtnText: { color: '#FFF', fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  
  modalContainer: { flex: 1 },
  codeBanner: { backgroundColor: '#8B5CF6', paddingTop: 60, paddingBottom: 24, paddingHorizontal: 20, borderBottomLeftRadius: 30, borderBottomRightRadius: 30, elevation: 10 },
  modalHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  codeBannerTitle: { color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: '900', letterSpacing: 2 },
  closeModalBtn: { padding: 8, backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: 20 },
  codeBannerCode: { color: '#FFF', fontSize: 36, fontWeight: '900', letterSpacing: 4, textAlign: 'center' },
  codeBannerSub: { color: 'rgba(255,255,255,0.9)', fontSize: 12, textAlign: 'center', marginTop: 12 },
  
  tabs: { flexDirection: 'row', marginTop: 16, marginHorizontal: 16 },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  activeTab: { borderBottomColor: '#8B5CF6' },
  tabText: { fontSize: 14, fontWeight: 'bold', color: '#888' },
  
  inputRow: { flexDirection: 'row', gap: 10 },
  smallInput: { flex: 1, borderWidth: 1, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14, fontSize: 14 },
  actionBtn: { backgroundColor: '#8B5CF6', paddingHorizontal: 24, justifyContent: 'center', alignItems: 'center', borderRadius: 16 },
  actionBtnText: { color: '#FFF', fontWeight: 'bold', fontSize: 14 },
  
  sectionTitle: { fontSize: 11, fontWeight: '900', letterSpacing: 2, marginBottom: 12 },
  listItem: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 16, borderRadius: 16, marginBottom: 12, borderWidth: 1 },
  avatarWrap: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(139, 92, 246, 0.1)', justifyContent: 'center', alignItems: 'center' },
  listName: { fontSize: 16, fontWeight: 'bold' },
  emptyState: { alignItems: 'center', justifyContent: 'center', paddingVertical: 40 },
  
  activeChat: { flex: 1, flexDirection: 'column' },
  chatHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, paddingTop: 60, borderBottomWidth: 1 },
  backBtn: { padding: 8 },
  chatHeaderTitle: { fontSize: 16, fontWeight: 'bold' },
  circleCallBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(16,185,129,0.2)', alignItems: 'center', justifyContent: 'center' },
  ongoingCallBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, backgroundColor: 'rgba(16,185,129,0.2)', borderWidth: 1, borderColor: '#10B981' },
  ongoingCallBtnText: { color: '#10B981', fontSize: 10, fontWeight: '900', letterSpacing: 1 },

  miniChannelBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#8B5CF6', paddingHorizontal: 16, paddingVertical: 10 },
  miniChannelText: { color: '#FFF', fontSize: 11, fontWeight: '700' },
  miniChannelAction: { color: '#FFF', fontSize: 9, fontWeight: '900', textDecorationLine: 'underline' },

  messagesArea: { flex: 1 },
  messageWrap: { marginBottom: 16, maxWidth: '85%' },
  msgMe: { alignSelf: 'flex-end' },
  msgOther: { alignSelf: 'flex-start' },
  msgSender: { fontSize: 11, color: '#888', marginBottom: 4, marginLeft: 8 },
  messageBubble: { padding: 14, borderRadius: 20 },
  inputArea: { flexDirection: 'row', padding: 16, borderTopWidth: 1, gap: 12 },
  input: { flex: 1, borderRadius: 24, paddingHorizontal: 20, paddingVertical: 14, fontSize: 14 },
  sendBtn: { backgroundColor: '#8B5CF6', paddingHorizontal: 20, justifyContent: 'center', borderRadius: 24 },
  smallActionBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  smallActionBtnText: { color: '#FFF', fontWeight: 'bold', fontSize: 12 },

  // Call Screen Styles
  callScreenContainer: { flex: 1, paddingTop: 50 },
  callScreenHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 16, borderBottomWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  minimizeBtn: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.06)' },
  minimizeText: { color: '#AAA', fontSize: 8, fontWeight: '900', letterSpacing: 1 },
  callScreenTitle: { color: '#FFF', fontSize: 14, fontWeight: '900', letterSpacing: 2 },
  callScreenSubtitle: { color: '#8B5CF6', fontSize: 8, fontWeight: '900', letterSpacing: 3, marginTop: 2 },
  leaveCallHeaderBtn: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, backgroundColor: '#EF4444' },
  leaveCallHeaderText: { color: '#FFF', fontSize: 9, fontWeight: '900', letterSpacing: 1 },

  callTabs: { flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: 12, margin: 16, padding: 4 },
  callTab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 8 },
  activeCallTab: { backgroundColor: '#8B5CF6' },
  callTabText: { color: '#888', fontSize: 10, fontWeight: '900', letterSpacing: 2 },

  spacesContent: { padding: 16 },
  spacesSectionLabel: { color: '#8B5CF6', fontSize: 10, fontWeight: '900', letterSpacing: 2, marginBottom: 16 },
  spacesStageGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 20, justifyContent: 'space-evenly' },
  stageParticipant: { alignItems: 'center', width: 90 },
  stageAvatarOuter: { width: 70, height: 70, borderRadius: 35, borderWidth: 3, borderColor: 'transparent', padding: 3, position: 'relative', justifyContent: 'center', alignItems: 'center' },
  stageAvatar: { width: '100%', height: '100%', borderRadius: 32, backgroundColor: '#2D2D35', justifyContent: 'center', alignItems: 'center' },
  stageAvatarText: { color: '#FFF', fontSize: 18, fontWeight: '900' },
  stageMuteBadge: { position: 'absolute', bottom: -2, right: -2, width: 22, height: 22, borderRadius: 11, backgroundColor: '#EF4444', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#0F0F12' },
  stageWaveformBadge: { position: 'absolute', bottom: -2, left: -2, width: 24, height: 24, borderRadius: 12, backgroundColor: '#10B981', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#0F0F12' },
  stageName: { fontSize: 12, fontWeight: '700', marginTop: 8, textAlign: 'center' },
  stageRole: { fontSize: 8, fontWeight: '900', color: '#8B5CF6', letterSpacing: 1, marginTop: 2 },
  
  hostControlsRow: { marginTop: 6 },
  hostMiniBtn: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.06)' },
  hostMiniBtnText: { color: '#EF4444', fontSize: 8, fontWeight: '900' },

  listenersList: { gap: 12 },
  listenerCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
  listenerAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#2D2D35', justifyContent: 'center', alignItems: 'center' },
  listenerAvatarText: { color: '#FFF', fontSize: 12, fontWeight: '900' },
  listenerName: { fontSize: 13, fontWeight: '700' },
  listenerRequestTag: { color: '#10B981', fontSize: 9, fontWeight: '900', marginTop: 2 },
  approveSpeakBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: '#10B981' },
  approveSpeakBtnText: { color: '#FFF', fontSize: 8, fontWeight: '900', letterSpacing: 1 },
  noListenersText: { color: '#888', fontSize: 11, fontStyle: 'italic', textAlign: 'center', paddingVertical: 20 },

  // Video Grid layout
  videoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingBottom: 40 },
  videoCard: { width: '48%', aspectRatio: 3/4, backgroundColor: '#1E1E24', borderRadius: 16, overflow: 'hidden', position: 'relative', borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
  videoOffBox: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  videoAvatar: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#8B5CF6', justifyContent: 'center', alignItems: 'center' },
  videoAvatarText: { color: '#FFF', fontSize: 16, fontWeight: '900' },
  videoOffText: { color: '#EF4444', fontSize: 8, fontWeight: '900', letterSpacing: 2 },
  videoMutePill: { position: 'absolute', bottom: 8, left: 8, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: 'rgba(239, 68, 68, 0.7)' },
  
  // Simulated Feed Animation Styles
  videoBox: { flex: 1, overflow: 'hidden', position: 'relative' },
  videoGradient: { ...StyleSheet.absoluteFill, backgroundColor: '#8B5CF6', opacity: 0.8 },
  videoScanline: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.05)', borderBottomWidth: 1.5, borderColor: 'rgba(255,255,255,0.15)' },
  videoOverlay: { ...StyleSheet.absoluteFill, padding: 12, justifyContent: 'space-between', zIndex: 10 },
  videoLabel: { color: '#FFF', fontSize: 10, fontWeight: '900', letterSpacing: 1, textShadowColor: '#000', textShadowOffset: { width: 1, height: 1 }, textShadowRadius: 3 },
  videoStatusPill: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingHorizontal: 6, paddingVertical: 3, borderRadius: 4, backgroundColor: 'rgba(0,0,0,0.6)' },
  videoLiveDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#10B981' },
  videoLiveText: { color: '#FFF', fontSize: 7, fontWeight: '900', letterSpacing: 1 },

  // Call Controls Bar
  callControlsBar: { flexDirection: 'row', justifyContent: 'space-evenly', alignItems: 'center', paddingVertical: 18, borderTopWidth: 1, borderColor: 'rgba(255,255,255,0.05)', borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  controlBtn: { alignItems: 'center', gap: 4 },
  controlBtnActive: { opacity: 0.5 },
  controlBtnActiveVideo: { opacity: 0.5 },
  controlBtnHangup: { backgroundColor: '#EF4444', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 12 },
  controlBtnEmoji: { fontSize: 20 },
  controlBtnText: { fontSize: 8, fontWeight: '900', letterSpacing: 1 },

  // WhatsApp Layout Styles
  whatsappHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 60, paddingBottom: 10 },
  whatsappMinimizeBtn: { backgroundColor: 'rgba(255,255,255,0.08)', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12 },
  whatsappMinimizeText: { color: '#FFF', fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  whatsappSecureText: { color: '#888', fontSize: 9, fontWeight: '700', letterSpacing: 0.5, marginBottom: 4 },
  whatsappName: { color: '#FFF', fontSize: 20, fontWeight: '900', letterSpacing: 0.5 },
  whatsappStatus: { color: '#10B981', fontSize: 10, fontWeight: '900', letterSpacing: 1.5, marginTop: 4 },

  whatsappVideoOffBackground: { ...StyleSheet.absoluteFill, backgroundColor: '#0B141A', justifyContent: 'center', alignItems: 'center', gap: 16 },
  whatsappLargeAvatar: { width: 120, height: 120, borderRadius: 60, backgroundColor: '#8B5CF6', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: 'rgba(255,255,255,0.2)' },
  whatsappLargeAvatarText: { color: '#FFF', fontSize: 36, fontWeight: '900' },
  whatsappVideoOffText: { color: '#AAA', fontSize: 11, fontWeight: '700', letterSpacing: 1 },

  whatsappPIPContainer: { position: 'absolute', bottom: 120, right: 16, width: 110, height: 160, borderRadius: 16, overflow: 'hidden', borderWidth: 2, borderColor: 'rgba(255,255,255,0.15)', backgroundColor: '#000', elevation: 8 },
  whatsappPIPOff: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1A1A24' },

  whatsappFooter: { flexDirection: 'row', justifyContent: 'space-evenly', alignItems: 'center', paddingVertical: 20, paddingBottom: 40, backgroundColor: 'rgba(11,20,26,0.95)', borderTopWidth: 1, borderColor: 'rgba(255,255,255,0.05)', borderTopLeftRadius: 28, borderTopRightRadius: 28 },
  whatsappControlBtn: { alignItems: 'center', justifyContent: 'center', width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(255,255,255,0.08)' },
  whatsappControlBtnActive: { backgroundColor: '#EF4444' },
  whatsappControlBtnActiveVideo: { backgroundColor: '#8B5CF6' },
  whatsappControlBtnHangup: { backgroundColor: '#EF4444' },
  whatsappControlBtnEmoji: { fontSize: 22 },
  whatsappControlBtnText: { color: '#FFF', fontSize: 7, fontWeight: '900', letterSpacing: 0.5, marginTop: 4, position: 'absolute', bottom: -14 },

  pulseAvatarContainer: { justifyContent: 'center', alignItems: 'center', width: 220, height: 220, position: 'relative' },
  pulseRing: { position: 'absolute', width: 160, height: 160, borderRadius: 80, borderWidth: 4, borderColor: '#10B981', backgroundColor: 'transparent' },
  pulseAvatarCircle: { width: 130, height: 130, borderRadius: 65, backgroundColor: '#8B5CF6', justifyContent: 'center', alignItems: 'center', zIndex: 10, elevation: 12 },
  pulseAvatarText: { color: '#FFF', fontSize: 44, fontWeight: '900' },

  // Call Flow Simulator Card Styles
  simCard: { borderWidth: 1, padding: 16, borderRadius: 16, marginTop: 16 },
  simTitle: { fontSize: 12, fontWeight: '900', letterSpacing: 1 },
  simSubtitle: { fontSize: 10, marginTop: 4, lineHeight: 14 },
  simBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  simBtnText: { color: '#FFF', fontWeight: 'bold', fontSize: 12 },

  // Inbound Call Overlay Styles
  inboundCallOverlay: { ...StyleSheet.absoluteFill, backgroundColor: '#0B141A', paddingTop: 80, paddingBottom: 60, justifyContent: 'space-between', alignItems: 'center', zIndex: 99999 },
  inboundCallType: { color: '#10B981', fontSize: 10, fontWeight: '900', letterSpacing: 2 },
  inboundCallName: { color: '#FFF', fontSize: 28, fontWeight: 'bold', marginTop: 10, textAlign: 'center' },
  inboundCallActions: { flexDirection: 'row', justifyContent: 'space-around', width: '100%', paddingHorizontal: 40 },
  inboundCallBtn: { width: 76, height: 76, borderRadius: 38, justifyContent: 'center', alignItems: 'center', elevation: 6 },
  inboundCallBtnEmoji: { fontSize: 24 },
  inboundCallBtnText: { color: '#FFF', fontSize: 8, fontWeight: '900', marginTop: 6, position: 'absolute', bottom: -18 },
  
  replyBubbleHeader: { borderLeftWidth: 3, paddingLeft: 8, paddingVertical: 2, marginBottom: 8, backgroundColor: 'rgba(0,0,0,0.05)', borderRadius: 4 },
  replyBubbleSender: { fontSize: 10, fontWeight: 'bold', marginBottom: 2 },
  bubbleReactionsWrap: { position: 'absolute', bottom: -12, right: 12, flexDirection: 'row', backgroundColor: '#1F2937', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10, borderWidth: 1, borderColor: '#374151', alignItems: 'center' },
  replyInputBar: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 8, borderTopWidth: 1, alignItems: 'center', justifyContent: 'space-between' },
  replyInputTitle: { fontSize: 10, fontWeight: '900', letterSpacing: 1, marginBottom: 2 },
  reactionToolbar: { flexDirection: 'row', backgroundColor: '#1F2937', padding: 6, borderRadius: 20, marginBottom: 4, gap: 8, borderWidth: 1, borderColor: '#374151', elevation: 4 },
  reactionToolbarBtn: { padding: 4, borderRadius: 12, justifyContent: 'center', alignItems: 'center' }
});
