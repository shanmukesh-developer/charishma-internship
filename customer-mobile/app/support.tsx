import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Alert, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { COLORS, SHADOWS, RADIUS } from '../constants/theme';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { apiFetch } from '../utils/auth';
import { ENDPOINTS } from '../constants/api';

export default function SupportScreen() {
  const router = useRouter();
  const { isDark } = useTheme();
  const { user } = useAuth();

  const [tickets, setTickets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewForm, setShowNewForm] = useState(false);

  // Form states
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('Medium');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchTickets();
  }, []);

  const fetchTickets = async () => {
    setLoading(true);
    try {
      const res = await apiFetch(ENDPOINTS.support);
      if (res.ok) {
        const data = await res.json();
        setTickets(data);
      }
    } catch (e) {
      console.error('Error fetching tickets:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!subject.trim() || !description.trim()) {
      Alert.alert('Validation Error', 'Please enter both a subject and description.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiFetch(ENDPOINTS.support, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, description, priority }),
      });

      if (res.ok) {
        Alert.alert('Success', 'Your support ticket has been registered.');
        setSubject('');
        setDescription('');
        setPriority('Medium');
        setShowNewForm(false);
        fetchTickets();
      } else {
        const err = await res.json();
        Alert.alert('Error', err.message || 'Failed to submit support ticket.');
      }
    } catch (e) {
      Alert.alert('Error', 'Failed to connect to support servers.');
    } finally {
      setSubmitting(false);
    }
  };

  const txt = isDark ? '#FFF' : '#111';
  const txtSec = isDark ? '#AAA' : '#666';
  const bg = isDark ? '#0A0A0C' : '#FAFAFA';
  const cardBg = isDark ? '#141416' : '#FFF';
  const border = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const goldColor = isDark ? COLORS.gold : COLORS.red;
  const activeBgColor = isDark ? 'rgba(201,168,76,0.1)' : 'rgba(239,79,95,0.08)';
  const activeTextColor = isDark ? COLORS.gold : COLORS.red;

  return (
    <View style={[s.container, { backgroundColor: bg }]}>
      {/* Header */}
      <View style={[s.header, { borderBottomColor: border, backgroundColor: bg }]}>
        <TouchableOpacity 
          style={[s.backBtn, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }]} 
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace('/(tabs)' as any);
            }
          }}
        >
          <Text style={[s.backIcon, { color: txt }]}>‹</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[s.subText, { color: goldColor }]}>STRATEGIC ASSISTANCE PROTOCOL</Text>
          <Text style={[s.title, { color: txt }]}>Support Center</Text>
        </View>
        <TouchableOpacity 
          style={[s.newBtn, { backgroundColor: showNewForm ? 'rgba(239,68,68,0.15)' : activeBgColor }] as any} 
          onPress={() => setShowNewForm(!showNewForm)}
        >
          <Text style={[s.newBtnText, { color: showNewForm ? '#EF4444' : activeTextColor }]}>
            {showNewForm ? 'CANCEL' : 'NEW TICKET'}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={s.scrollContent}>
        {showNewForm && (
          <View style={[s.formCard, { backgroundColor: cardBg, borderColor: goldColor }]}>
            <Text style={[s.formTitle, { color: goldColor }]}>FILE A SUPPORT REQUEST</Text>

            {/* Subject */}
            <Text style={s.label}>ISSUE SUBJECT</Text>
            <TextInput 
              style={[s.input, { color: txt, borderColor: border, backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)' }]} 
              placeholder="E.g., Order Delayed, Payment Failed"
              placeholderTextColor={txtSec}
              value={subject}
              onChangeText={setSubject}
            />

            {/* Priority Selection */}
            <Text style={s.label}>PRIORITY LEVEL</Text>
            <View style={s.priorityRow}>
              {['Low', 'Medium', 'High', 'Critical'].map(level => {
                const active = priority === level;
                return (
                  <TouchableOpacity 
                    key={level} 
                    style={[
                      s.chip, 
                      active && { borderColor: goldColor, backgroundColor: activeBgColor }, 
                      { borderColor: border }
                    ] as any}
                    onPress={() => setPriority(level)}
                  >
                    <Text style={[s.chipText, active && { color: goldColor }]}>
                      {level.toUpperCase()}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Description */}
            <Text style={s.label}>DETAILED DESCRIPTION</Text>
            <TextInput 
              style={[s.input, s.textarea, { color: txt, borderColor: border, backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)' }]} 
              placeholder="Describe the issue in detail..."
              placeholderTextColor={txtSec}
              multiline={true}
              numberOfLines={4}
              value={description}
              onChangeText={setDescription}
            />

            <TouchableOpacity 
              style={[s.submitBtn, { backgroundColor: goldColor }]} 
              onPress={handleSubmit}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator size="small" color={isDark ? '#000' : '#fff'} />
              ) : (
                <Text style={[s.submitText, { color: isDark ? '#000' : '#fff' }]}>SUBMIT TICKET</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        <Text style={[s.sectionTitle, { color: txt }]}>YOUR TICKETS</Text>

        {loading ? (
          <View style={{ paddingVertical: 40 }}>
            <ActivityIndicator size="large" color={goldColor} />
          </View>
        ) : tickets.length === 0 ? (
          <View style={[s.emptyCard, { backgroundColor: cardBg, borderColor: border }]}>
            <Text style={{ fontSize: 32, marginBottom: 8 }}>🎫</Text>
            <Text style={{ fontSize: 11, fontWeight: '900', color: txtSec, letterSpacing: 2 }}>
              NO SUPPORT TICKETS FOUND
            </Text>
          </View>
        ) : (
          <View style={s.ticketList}>
            {tickets.map((ticket, idx) => (
              <View key={ticket.id || ticket._id || String(idx)} style={[s.ticketCard, { backgroundColor: cardBg, borderColor: border }]}>
                <View style={s.ticketHeader}>
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    <View style={[s.statusBadge, ticket.status === 'Resolved' || ticket.status === 'Closed' ? s.statusResolved : { backgroundColor: activeBgColor }] as any}>
                      <Text style={[s.statusText, { color: activeTextColor }, (ticket.status === 'Resolved' || ticket.status === 'Closed') && { color: '#22C55E' }]}>{ticket.status.toUpperCase()}</Text>
                    </View>
                    <View style={[s.prioBadge, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }]}>
                      <Text style={s.prioText}>{ticket.priority.toUpperCase()}</Text>
                    </View>
                  </View>
                  <Text style={s.ticketId}>#{(ticket.id || ticket._id || '').slice(0, 8)}</Text>
                </View>
                <Text style={[s.ticketSubject, { color: txt }]}>{ticket.subject}</Text>
                <Text style={[s.ticketDesc, { color: txtSec }]}>{ticket.description}</Text>

                {ticket.adminResponse && (
                  <View style={[s.responseBox, { backgroundColor: isDark ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.03)', borderColor: border }]}>
                    <Text style={s.responseLabel}>ADMIN RESPONSE</Text>
                    <Text style={[s.responseText, { color: txt }]}>{ticket.adminResponse}</Text>
                  </View>
                )}
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, paddingTop: Platform.OS === 'android' ? 40 : 50 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 16, borderBottomWidth: 1 },
  backBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  backIcon: { fontSize: 32, fontWeight: '300' },
  subText: { fontSize: 8, fontWeight: '900', letterSpacing: 2 },
  title: { fontSize: 18, fontWeight: '900' },
  newBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12 },
  newBtnText: { fontSize: 8, fontWeight: '900', letterSpacing: 1 },

  scrollContent: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 40 },
  formCard: { padding: 20, borderRadius: 24, borderWidth: 1, marginBottom: 20 },
  formTitle: { fontSize: 10, fontWeight: '900', letterSpacing: 2, marginBottom: 16 },
  label: { fontSize: 8, fontWeight: '900', color: '#888', letterSpacing: 1, marginBottom: 6, marginLeft: 2 },
  input: { height: 48, borderRadius: 14, borderWidth: 1, paddingHorizontal: 16, fontSize: 13, marginBottom: 16 },
  textarea: { height: 100, paddingTop: 12, paddingBottom: 12, textAlignVertical: 'top' },

  priorityRow: { flexDirection: 'row', gap: 6, marginBottom: 16 },
  chip: { flex: 1, height: 36, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  chipActive: {},
  chipText: { fontSize: 7, fontWeight: '900', color: '#888' },
  chipTextActive: {},

  submitBtn: { height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  submitText: { fontSize: 10, fontWeight: '900', color: '#fff', letterSpacing: 1 },

  sectionTitle: { fontSize: 10, fontWeight: '900', letterSpacing: 2, marginBottom: 12, marginLeft: 4 },
  emptyCard: { paddingVertical: 40, alignItems: 'center', borderRadius: 24, borderWidth: 1 },
  ticketList: { gap: 12 },
  ticketCard: { padding: 16, borderRadius: 20, borderWidth: 1 },
  ticketHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  statusResolved: { backgroundColor: 'rgba(34,197,94,0.1)' },
  statusPending: {},
  statusText: { fontSize: 7, fontWeight: '900' },
  prioBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  prioText: { fontSize: 7, fontWeight: '900', color: '#AAA' },
  ticketId: { fontSize: 9, fontWeight: '600', color: '#888', fontFamily: 'monospace' },
  ticketSubject: { fontSize: 14, fontWeight: '900', marginBottom: 4 },
  ticketDesc: { fontSize: 11, fontWeight: '700', lineHeight: 16 },

  responseBox: { marginTop: 12, padding: 12, borderRadius: 12, borderWidth: 1 },
  responseLabel: { fontSize: 7, fontWeight: '900', color: '#22c55e', letterSpacing: 1, marginBottom: 4 },
  responseText: { fontSize: 11, fontWeight: '700', fontStyle: 'italic' }
});
