import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, Alert, Modal, KeyboardAvoidingView, Platform } from 'react-native';
import { connectSocket, refreshSocketAuth } from '../utils/socket';
import { useAuth } from '../context/AuthContext';
import { COLORS } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { apiFetch } from '../utils/auth';

export default function ZenvyAfterDarkLounge() {
  const { user, refreshUser } = useAuth();
  const { isDark } = useTheme();
  
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'dms' | 'rooms'>('dms');
  const [activeChat, setActiveChat] = useState<any | null>(null); // { type: 'friend' | 'room', id, name }
  const [messages, setMessages] = useState<any[]>([]);
  const [inputText, setInputText] = useState('');
  const [inCall, setInCall] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  
  // Data states
  const [friends, setFriends] = useState<any[]>([]);
  const [rooms, setRooms] = useState<any[]>([]);
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);
  const [callParticipants, setCallParticipants] = useState<any[]>([]);
  const [newFriendCode, setNewFriendCode] = useState('');
  const [newRoomCode, setNewRoomCode] = useState('');
  
  const socketRef = useRef<any>(null);
  const scrollViewRef = useRef<ScrollView>(null);
  
  const txt = isDark ? COLORS.textPrimary : COLORS.textDark;
  const txtSec = isDark ? COLORS.textSecondary : COLORS.textDarkSecondary;
  const cardBg = isDark ? '#1A1A1D' : '#F9FAFB';
  const border = isDark ? 'rgba(167, 139, 250, 0.3)' : 'rgba(139, 92, 246, 0.3)';

  useEffect(() => {
    if (isOpen && user) {
      refreshUser(); // Ensure fresh user data (like friendCode)
      fetchFriends();
      fetchRooms();
      fetchPendingRequests();
    }
  }, [isOpen]);

  useEffect(() => {
    // Force a fresh socket auth connection on mount to load the latest token
    refreshSocketAuth();
    
    socketRef.current = connectSocket();
    const socket = socketRef.current;

    setIsConnected(socket.connected);

    const handleConnect = () => {
      setIsConnected(true);
    };

    const handleDisconnect = () => {
      setIsConnected(false);
    };

    const handleConnectError = (err: any) => {
      console.warn('Socket connection error in Lounge:', err);
      setIsConnected(false);
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('connect_error', handleConnectError);

    socket.on('receive_after_dark_message', (msg: any) => {
      setMessages((prev) => [...prev, msg]);
      setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 100);
    });

    socket.on('call_participants_list', (data: any) => {
      setCallParticipants(data.participants || []);
    });

    socket.on('user_joined_call', (data: any) => {
      setCallParticipants((prev) => {
        // Prevent duplicate entries
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
    });

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('connect_error', handleConnectError);
      socket.off('receive_after_dark_message');
      socket.off('call_participants_list');
      socket.off('user_joined_call');
      socket.off('user_left_call');
      socket.off('call_error');
    };
  }, []);

  // Synchronize room membership with socket connection/reconnections and active chat selection
  useEffect(() => {
    if (isConnected && activeChat && socketRef.current) {
      console.log(`[SOCKET_SYNC] Joining room afterdark_${activeChat.id}`);
      socketRef.current.emit('join_after_dark_group', { groupId: activeChat.id });
      if (inCall) {
        console.log(`[SOCKET_SYNC] Rejoining call room for ${activeChat.id}`);
        socketRef.current.emit('join_after_dark_call', { groupId: activeChat.id, userName: user?.name || 'Anonymous' });
      }
    }
  }, [isConnected, activeChat?.id, inCall]);

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
        Alert.alert('Error', `Could not load messages (status ${res.status}).`);
      }
    } catch (e: any) {
      console.error(e);
      Alert.alert('Error', `Network error loading messages: ${e.message}`);
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
    socketRef.current?.emit('send_after_dark_message', {
      groupId: activeChat.id,
      text: inputText,
      senderName: user?.name || 'Anonymous'
    });
    setInputText('');
  };

  const toggleCall = () => {
    if (!activeChat) return;
    if (inCall) {
      socketRef.current?.emit('leave_after_dark_call', { groupId: activeChat.id });
      setInCall(false);
      setCallParticipants([]);
    } else {
      socketRef.current?.emit('join_after_dark_call', { groupId: activeChat.id, userName: user?.name || 'Anonymous' });
      setInCall(true);
    }
  };

  const handleBackToMain = () => {
    if (inCall && activeChat) {
      socketRef.current?.emit('leave_after_dark_call', { groupId: activeChat.id });
      setInCall(false);
      setCallParticipants([]);
    }
    setActiveChat(null);
  };

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
            <Text style={[s.headerSub, { color: '#8B5CF6' }]}>EPHEMERAL CHAT IS LIVE</Text>
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
                <Text style={s.codeBannerSub}>Share this code with your friends to connect securely!</Text>
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
                <View style={{ alignItems: 'center' }}>
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
                <TouchableOpacity 
                  style={[s.callBtn, { backgroundColor: inCall ? '#EF4444' : 'rgba(16,185,129,0.2)' }]}
                  onPress={toggleCall}
                >
                  <Text style={[s.callBtnText, { color: inCall ? '#FFF' : '#10B981' }]}>
                    {inCall ? '📞 LEAVE' : activeChat.type === 'friend' ? '📞 CALL' : '📞 JOIN (20)'}
                  </Text>
                </TouchableOpacity>
              </View>

              {inCall && (
                <View style={{ backgroundColor: isDark ? 'rgba(139, 92, 246, 0.1)' : 'rgba(139, 92, 246, 0.05)', borderBottomWidth: 1, borderBottomColor: border, padding: 12 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <Text style={{ color: '#8B5CF6', fontWeight: 'bold', fontSize: 11, letterSpacing: 1 }}>🎙️ ACTIVE VOICE CHANNEL</Text>
                    <Text style={{ color: txtSec, fontSize: 10 }}>{callParticipants.length} Connected</Text>
                  </View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                    {callParticipants.map((p, idx) => (
                      <View key={idx} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#FFF', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, borderWidth: 1, borderColor: border }}>
                        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#10B981', marginRight: 6 }} />
                        <Text style={{ color: txt, fontSize: 12, fontWeight: '500' }}>{p.userName || 'Anonymous'}</Text>
                      </View>
                    ))}
                    {callParticipants.length === 0 && (
                      <Text style={{ color: txtSec, fontSize: 12, fontStyle: 'italic' }}>Connecting to voice...</Text>
                    )}
                  </View>
                </View>
              )}

              <ScrollView ref={scrollViewRef} style={s.messagesArea} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
                {messages.map((msg, idx) => {
                  const isMe = msg.senderId === user?.id || msg.senderId === user?._id;
                  return (
                    <View key={idx} style={[s.messageWrap, isMe ? s.msgMe : s.msgOther]}>
                      {!isMe && activeChat.type === 'room' && <Text style={s.msgSender}>{msg.senderName}</Text>}
                      <View style={[s.messageBubble, isMe ? { backgroundColor: '#8B5CF6' } : { backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : '#E5E7EB' }]}>
                        <Text style={{ color: isMe ? '#FFF' : txt }}>{msg.text}</Text>
                      </View>
                    </View>
                  );
                })}
              </ScrollView>

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
  callBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16 },
  callBtnText: { fontSize: 10, fontWeight: '900' },
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
  smallActionBtnText: { color: '#FFF', fontWeight: 'bold', fontSize: 12 }
});
