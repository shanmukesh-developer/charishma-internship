import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, Animated } from 'react-native';
import { connectSocket } from '../utils/socket';
import { useAuth } from '../context/AuthContext';
import { COLORS, SHADOWS } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { PulseGlow, BounceIn } from './AnimatedSection';

const PREDEFINED_GROUPS = [
  { id: 'hostel_a_boys', name: 'Block A Boys' },
  { id: 'hostel_c_girls', name: 'Block C Girls' },
  { id: 'cse_study_group', name: 'CSE Coders' },
  { id: 'gaming_hub', name: 'Gaming Hub' }
];

export default function ZenvyAfterDarkLounge() {
  const { user } = useAuth();
  const { isDark } = useTheme();
  
  const [isOpen, setIsOpen] = useState(false);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [inputText, setInputText] = useState('');
  const [inCall, setInCall] = useState(false);
  const [isAfterDark, setIsAfterDark] = useState(true); // Temp unlocked
  const socketRef = useRef<any>(null);
  const scrollViewRef = useRef<ScrollView>(null);
  
  const txt = isDark ? COLORS.textPrimary : COLORS.textDark;
  const txtSec = isDark ? COLORS.textSecondary : COLORS.textDarkSecondary;
  const cardBg = isDark ? 'rgba(255, 255, 255, 0.08)' : COLORS.bgLightCard;
  const border = isDark ? 'rgba(167, 139, 250, 0.3)' : 'rgba(139, 92, 246, 0.2)';

  useEffect(() => {
    socketRef.current = connectSocket();
    const socket = socketRef.current;

    socket.on('receive_after_dark_message', (msg: any) => {
      setMessages((prev) => [...prev, msg]);
      setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 100);
    });

    socket.on('call_error', (data: any) => {
      alert(data.message);
      setInCall(false);
    });

    return () => {
      socket.off('receive_after_dark_message');
      socket.off('call_error');
    };
  }, []);

  const handleJoinGroup = (groupId: string) => {
    setActiveGroup(groupId);
    setMessages([]);
    socketRef.current?.emit('join_after_dark_group', { groupId });
  };

  const handleSendMessage = () => {
    if (!inputText.trim() || !activeGroup) return;

    socketRef.current?.emit('send_after_dark_message', {
      groupId: activeGroup,
      text: inputText,
      senderName: user?.name || 'Anonymous'
    });
    
    setInputText('');
  };

  const toggleCall = () => {
    if (!activeGroup) return;
    if (inCall) {
      socketRef.current?.emit('leave_after_dark_call', { groupId: activeGroup });
      setInCall(false);
    } else {
      socketRef.current?.emit('join_after_dark_call', { groupId: activeGroup });
      setInCall(true);
    }
  };

  if (!isAfterDark) {
    return (
      <View style={[s.sleepingContainer, { backgroundColor: cardBg, borderColor: border }]}>
        <PulseGlow size={50} color="#A78BFA">
          <Text style={{ fontSize: 32 }}>🌙</Text>
        </PulseGlow>
        <Text style={[s.sleepingTitle, { color: txt }]}>Zenvy After Dark</Text>
        <Text style={[s.sleepingSub, { color: txtSec }]}>The Campus Lounge opens exactly at 9:00 PM.</Text>
      </View>
    );
  }

  return (
    <View style={s.container}>
      <TouchableOpacity 
        style={[s.header, { backgroundColor: 'rgba(139, 92, 246, 0.1)', borderColor: border }]}
        activeOpacity={0.8}
        onPress={() => setIsOpen(!isOpen)}
      >
        <View style={s.headerLeft}>
          <Text style={{ fontSize: 24 }}>🌙</Text>
          <View>
            <Text style={[s.headerTitle, { color: txt }]}>ZENVY AFTER DARK</Text>
            <Text style={[s.headerSub, { color: '#A78BFA' }]}>CAMPUS LOUNGE IS LIVE</Text>
          </View>
        </View>
        <View style={[s.openBtn, { backgroundColor: '#8B5CF6' }]}>
          <Text style={s.openBtnText}>{isOpen ? 'CLOSE' : 'ENTER'}</Text>
        </View>
      </TouchableOpacity>

      {isOpen && (
        <View style={[s.chatContainer, { backgroundColor: cardBg, borderColor: border }]}>
          {!activeGroup ? (
            <View style={s.groupList}>
              <Text style={[s.sectionTitle, { color: txtSec }]}>ACTIVE HUBS</Text>
              {PREDEFINED_GROUPS.map(group => (
                <TouchableOpacity 
                  key={group.id} 
                  style={[s.groupItem, { backgroundColor: 'rgba(255,255,255,0.05)' }]}
                  onPress={() => handleJoinGroup(group.id)}
                >
                  <Text style={{ fontSize: 20 }}>👥</Text>
                  <Text style={[s.groupName, { color: txt }]}>{group.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : (
            <View style={s.activeChat}>
              <View style={[s.chatHeader, { borderBottomColor: 'rgba(255,255,255,0.1)' }]}>
                <TouchableOpacity onPress={() => setActiveGroup(null)}>
                  <Text style={{ color: '#A78BFA', fontWeight: 'bold' }}>← Back</Text>
                </TouchableOpacity>
                <Text style={[s.chatHeaderTitle, { color: txt }]}>
                  {PREDEFINED_GROUPS.find(g => g.id === activeGroup)?.name}
                </Text>
                <TouchableOpacity 
                  style={[s.callBtn, { backgroundColor: inCall ? '#EF4444' : 'rgba(16,185,129,0.2)' }]}
                  onPress={toggleCall}
                >
                  <Text style={[s.callBtnText, { color: inCall ? '#FFF' : '#10B981' }]}>
                    {inCall ? '📞 LEAVE' : '📞 JOIN (20)'}
                  </Text>
                </TouchableOpacity>
              </View>

              <ScrollView ref={scrollViewRef} style={s.messagesArea} contentContainerStyle={{ padding: 12 }}>
                {messages.map((msg, idx) => {
                  const isMe = msg.senderId === user?.id;
                  return (
                    <View key={idx} style={[s.messageWrap, isMe ? s.msgMe : s.msgOther]}>
                      {!isMe && <Text style={s.msgSender}>{msg.senderName}</Text>}
                      <View style={[s.messageBubble, isMe ? { backgroundColor: '#8B5CF6' } : { backgroundColor: 'rgba(255,255,255,0.1)' }]}>
                        <Text style={{ color: '#FFF' }}>{msg.text}</Text>
                      </View>
                    </View>
                  );
                })}
              </ScrollView>

              <View style={[s.inputArea, { borderTopColor: 'rgba(255,255,255,0.1)' }]}>
                <TextInput
                  style={[s.input, { color: txt, backgroundColor: 'rgba(255,255,255,0.05)' }]}
                  placeholder="Say something..."
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
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { marginHorizontal: 16, marginBottom: 20 },
  sleepingContainer: { padding: 24, borderRadius: 20, borderWidth: 1, alignItems: 'center', marginHorizontal: 16, marginBottom: 20 },
  sleepingTitle: { fontSize: 16, fontWeight: 'bold', marginTop: 12, marginBottom: 4 },
  sleepingSub: { fontSize: 11, textAlign: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderRadius: 20, borderWidth: 1 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerTitle: { fontSize: 14, fontWeight: '900', letterSpacing: 1 },
  headerSub: { fontSize: 9, fontWeight: '800', letterSpacing: 2 },
  openBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
  openBtnText: { color: '#FFF', fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  chatContainer: { marginTop: -10, paddingTop: 20, borderRadius: 20, borderWidth: 1, height: 400, borderTopLeftRadius: 0, borderTopRightRadius: 0, overflow: 'hidden' },
  groupList: { padding: 16 },
  sectionTitle: { fontSize: 10, fontWeight: '900', letterSpacing: 2, marginBottom: 12 },
  groupItem: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 12, marginBottom: 8 },
  groupName: { fontSize: 14, fontWeight: 'bold' },
  activeChat: { flex: 1, flexDirection: 'column' },
  chatHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, borderBottomWidth: 1 },
  chatHeaderTitle: { fontSize: 14, fontWeight: 'bold' },
  callBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12 },
  callBtnText: { fontSize: 10, fontWeight: '900' },
  messagesArea: { flex: 1 },
  messageWrap: { marginBottom: 12, maxWidth: '80%' },
  msgMe: { alignSelf: 'flex-end' },
  msgOther: { alignSelf: 'flex-start' },
  msgSender: { fontSize: 10, color: '#888', marginBottom: 4, marginLeft: 4 },
  messageBubble: { padding: 12, borderRadius: 16 },
  inputArea: { flexDirection: 'row', padding: 12, borderTopWidth: 1, gap: 8 },
  input: { flex: 1, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10 },
  sendBtn: { backgroundColor: '#8B5CF6', paddingHorizontal: 16, justifyContent: 'center', borderRadius: 20 }
});
