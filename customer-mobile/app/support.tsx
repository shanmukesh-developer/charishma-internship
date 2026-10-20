import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Alert, Platform, RefreshControl, Linking } from 'react-native';
import { KeyboardAvoidingView } from '../components/KeyboardAvoidingView';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { COLORS } from '../constants/theme';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { apiFetch, readJson } from '../utils/auth';
import { ENDPOINTS, ZENVY_SUPPORT_PHONE, ZENVY_SUPPORT_WHATSAPP } from '../constants/api';
import { connectSocket } from '../utils/socket';
import { Ionicons } from '@expo/vector-icons';
import { formatISTDateTime } from '../utils/format';

const SUBJECT_MAX = 120;
const DESCRIPTION_MAX = 2000;
const shortId = (id?: string | null) => (id ? String(id).slice(-6).toUpperCase() : '');
// Server 5xx bodies can be generic ("Internal Server Error"); only show messages meant for people.
const friendlyMessage = (res: Response, data: any, fallback: string) =>
  (res.status < 500 && typeof data?.message === 'string' && data.message) || fallback;
const formatWhen = (iso?: string) => (iso ? formatISTDateTime(iso) : '');
// Ticket status / priority as people read them; unknown statuses show as "Open".
const STATUS_LABELS: Record<string, string> = {
  open: 'Open', pending: 'Open', new: 'Open',
  'in progress': 'In progress', in_progress: 'In progress', inprogress: 'In progress',
  resolved: 'Resolved', closed: 'Closed',
};
const statusLabel = (status?: string | null) => STATUS_LABELS[String(status || '').trim().toLowerCase()] || 'Open';
const priorityLabel = (p?: string | null) => {
  const v = String(p || 'Medium').trim();
  return v ? v.charAt(0).toUpperCase() + v.slice(1).toLowerCase() : 'Medium';
};

export default function SupportScreen() {
  const router = useRouter();
  const { isDark, colors } = useTheme();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ orderId?: string | string[] }>();
  const paramOrderId = (Array.isArray(params.orderId) ? params.orderId[0] : params.orderId) || '';

  const [tickets, setTickets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showNewForm, setShowNewForm] = useState(!!paramOrderId);

  // Form states (when opened from an order, the ticket is linked to it)
  const [linkedOrderId, setLinkedOrderId] = useState<string>(paramOrderId);
  const [subject, setSubject] = useState(paramOrderId ? `Help with order #${shortId(paramOrderId)}` : '');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('Medium');
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const fetchTickets = useCallback(async () => {
    try {
      const res = await apiFetch(ENDPOINTS.support);
      const data = await readJson(res);
      if (!mountedRef.current) return;
      if (res.ok) {
        setTickets(Array.isArray(data) ? data : []);
        setLoadError(null);
      } else {
        setLoadError(res.status === 401
          ? 'Please sign in again to see your tickets.'
          : friendlyMessage(res, data, "We couldn't load your tickets. Please try again."));
      }
    } catch (e) {
      console.error('Error fetching tickets:', e);
      if (mountedRef.current) setLoadError("Can't reach Zenvy right now. Check your internet and try again.");
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    if (user) {
      setLoading(true);
      fetchTickets();
    } else {
      setTickets([]);
      setLoading(false);
    }
  }, [user, fetchTickets]);

  // Live updates when the support team replies (the server emits 'ticket_updated' to the user's own room).
  useEffect(() => {
    if (!user) return;
    let socket: any;
    try { socket = connectSocket(); } catch { return; }
    const onTicketUpdated = (payload: any) => {
      if (!mountedRef.current) return;
      if (payload?.id) {
        setTickets(prev => prev.map(tk => (
          String(tk.id || tk._id) === String(payload.id)
            ? {
                ...tk,
                ...(payload.status ? { status: payload.status } : {}),
                ...(payload.adminResponse !== undefined ? { adminResponse: payload.adminResponse } : {}),
              }
            : tk
        )));
      } else {
        fetchTickets();
      }
    };
    socket.on('ticket_updated', onTicketUpdated);
    return () => { socket.off('ticket_updated', onTicketUpdated); };
  }, [user, fetchTickets]);

  const handleRefresh = () => {
    setRefreshing(true);
    if (user) {
      fetchTickets();
    } else {
      setRefreshing(false);
    }
  };

  const handleSubmit = async () => {
    if (!user) {
      Alert.alert(
        'Sign in required',
        'Please sign in so our team can link your ticket to your account.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Sign in', onPress: () => router.push('/login' as any) }
        ]
      );
      return;
    }

    if (!subject.trim() || !description.trim()) {
      Alert.alert('Almost there', 'Please add a short subject and tell us what went wrong.');
      return;
    }
    if (submittingRef.current) return;
    submittingRef.current = true;

    setSubmitting(true);
    try {
      const res = await apiFetch(ENDPOINTS.support, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: subject.trim().slice(0, SUBJECT_MAX),
          description: description.trim().slice(0, DESCRIPTION_MAX),
          priority,
          ...(linkedOrderId ? { orderId: linkedOrderId } : {}),
        }),
      });
      const data = await readJson(res);
      if (!mountedRef.current) return;

      if (res.ok) {
        Alert.alert('Ticket raised', "Our team will reply here, and we'll notify you as soon as they do.");
        setSubject('');
        setDescription('');
        setPriority('Medium');
        setLinkedOrderId('');
        setShowNewForm(false);
        fetchTickets();
      } else {
        Alert.alert("Couldn't raise your ticket", friendlyMessage(res, data, 'Please try again in a moment.'));
      }
    } catch (e) {
      if (mountedRef.current) Alert.alert('No connection', 'Please check your internet and try again.');
    } finally {
      submittingRef.current = false;
      if (mountedRef.current) setSubmitting(false);
    }
  };

  const openSupportLink = (url: string, fallback: string) => {
    Linking.openURL(url).catch(() => Alert.alert('Could not open', fallback));
  };

  const whatsappText = linkedOrderId
    ? `Hi Zenvy Support, I need help with order #${shortId(linkedOrderId)}`
    : 'Hi Zenvy Support, I need help';

  const txt = colors.text;
  const txtSec = colors.textSecondary;
  const bg = colors.bg;
  const cardBg = colors.card;
  const border = colors.border;
  const goldColor = isDark ? COLORS.gold : colors.gold;
  const activeBgColor = isDark ? 'rgba(201,168,76,0.1)' : 'rgba(239,79,95,0.08)';
  const activeTextColor = isDark ? COLORS.gold : COLORS.red;

  return (
    <KeyboardAvoidingView style={[s.container, { backgroundColor: bg }]} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      {/* Header */}
      <View style={[s.header, { borderBottomColor: border, backgroundColor: cardBg }]}>
        <TouchableOpacity
          style={[s.backBtn, { borderColor: border, backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#F3F4F6' }]}
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace('/(tabs)' as any);
            }
          }}
        >
          <Text style={{ fontSize: 16, color: txt }}>←</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[s.subText, { color: goldColor }]}>Help and support</Text>
          <Text style={[s.title, { color: txt }]}>Support centre</Text>
        </View>
        <TouchableOpacity
          style={[s.newBtn, { backgroundColor: showNewForm ? 'rgba(239,68,68,0.15)' : activeBgColor }] as any}
          onPress={() => setShowNewForm(!showNewForm)}
        >
          <Text style={[s.newBtnText, { color: showNewForm ? '#EF4444' : activeTextColor }]}>
            {showNewForm ? 'Cancel' : 'New ticket'}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[s.scrollContent, { paddingBottom: 240 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={goldColor} />}
      >
        {/* Helpline Card */}
        <View style={[s.formCard, { backgroundColor: cardBg, borderColor: border, marginBottom: 16 }]}>
          <Text style={[s.subText, { color: goldColor, marginBottom: 4 }]}>Zenvy helpline</Text>
          <Text style={{ fontSize: 13, fontWeight: '800', color: txt, marginBottom: 4 }}>Need urgent help with a live order?</Text>
          <Text style={{ fontSize: 11, color: txtSec, lineHeight: 16, marginBottom: 14 }}>
            For a delayed order or trouble meeting your rider, message or call our support team directly.
          </Text>

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <TouchableOpacity
              style={{
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                backgroundColor: 'rgba(34,197,94,0.12)',
                borderWidth: 1,
                borderColor: 'rgba(34,197,94,0.3)',
                paddingVertical: 10,
                borderRadius: 12
              }}
              onPress={() => openSupportLink(
                `https://wa.me/${ZENVY_SUPPORT_WHATSAPP}?text=${encodeURIComponent(whatsappText)}`,
                `WhatsApp us on +${ZENVY_SUPPORT_WHATSAPP}.`
              )}
            >
              <Ionicons name="logo-whatsapp" size={15} color="#22C55E" />
              <Text style={{ fontSize: 12, fontWeight: '800', color: '#22C55E' }}>WhatsApp</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={{
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                backgroundColor: 'rgba(59,130,246,0.12)',
                borderWidth: 1,
                borderColor: 'rgba(59,130,246,0.3)',
                paddingVertical: 10,
                borderRadius: 12
              }}
              onPress={() => openSupportLink(`tel:+${ZENVY_SUPPORT_PHONE}`, `Call us on +${ZENVY_SUPPORT_PHONE}.`)}
            >
              <Ionicons name="call-outline" size={15} color="#3B82F6" />
              <Text style={{ fontSize: 12, fontWeight: '800', color: '#3B82F6' }}>Call us</Text>
            </TouchableOpacity>
          </View>
        </View>

        {!user && (
          <View style={[s.formCard, { backgroundColor: 'rgba(201,168,76,0.06)', borderColor: 'rgba(201,168,76,0.3)', marginBottom: 20, alignItems: 'center' }]}>
            <Ionicons name="lock-closed-outline" size={24} color={goldColor} style={{ marginBottom: 6 }} />
            <Text style={{ fontSize: 13, fontWeight: '900', color: txt, marginBottom: 4 }}>
              Sign in to track tickets
            </Text>
            <Text style={{ fontSize: 10, color: txtSec, textAlign: 'center', lineHeight: 15, marginBottom: 12 }}>
              Sign in to raise tickets and get notified when our team replies.
            </Text>
            <TouchableOpacity
              style={{ backgroundColor: goldColor, paddingHorizontal: 20, paddingVertical: 8, borderRadius: 10 }}
              onPress={() => router.push('/login' as any)}
            >
              <Text style={{ color: isDark ? '#000' : '#fff', fontSize: 12, fontWeight: '900' }}>
                Sign in
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {showNewForm && (
          <View style={[s.formCard, { backgroundColor: cardBg, borderColor: goldColor }]}>
            <Text style={[s.formTitle, { color: goldColor }]}>New support request</Text>

            {!!linkedOrderId && (
              <View style={[s.linkedOrder, { borderColor: border, backgroundColor: activeBgColor }]}>
                <Text style={{ flex: 1, fontSize: 11, fontWeight: '800', color: txt }}>About order #{shortId(linkedOrderId)}</Text>
                <TouchableOpacity onPress={() => setLinkedOrderId('')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Text style={{ fontSize: 11, fontWeight: '800', color: txtSec }}>Remove</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Subject */}
            <Text style={[s.label, { color: txtSec }]}>Subject</Text>
            <TextInput
              style={[s.input, { color: txt, borderColor: border, backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)' }]}
              placeholder="e.g. Order delayed, item missing"
              placeholderTextColor={txtSec}
              value={subject}
              onChangeText={setSubject}
              maxLength={SUBJECT_MAX}
            />

            {/* Priority Selection */}
            <Text style={[s.label, { color: txtSec }]}>Priority</Text>
            <View style={s.priorityRow}>
              {['Low', 'Medium', 'High', 'Critical'].map(level => {
                const active = priority === level;
                return (
                  <TouchableOpacity
                    key={level}
                    style={[
                      s.chip,
                      { borderColor: border },
                      active && { borderColor: goldColor, backgroundColor: activeBgColor },
                    ] as any}
                    onPress={() => setPriority(level)}
                  >
                    <Text style={[s.chipText, active && { color: goldColor }]}>
                      {level}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Description */}
            <Text style={[s.label, { color: txtSec }]}>Describe the problem</Text>
            <TextInput
              style={[s.input, s.textarea, { color: txt, borderColor: border, backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)' }]}
              placeholder="Tell us what happened"
              placeholderTextColor={txtSec}
              multiline={true}
              numberOfLines={4}
              value={description}
              onChangeText={setDescription}
              maxLength={DESCRIPTION_MAX}
            />

            <TouchableOpacity
              style={[s.submitBtn, { backgroundColor: goldColor }, submitting && { opacity: 0.7 }]}
              onPress={handleSubmit}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator size="small" color={isDark ? '#000' : '#fff'} />
              ) : (
                <Text style={[s.submitText, { color: isDark ? '#000' : '#fff' }]}>Submit ticket</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {!!user && <Text style={[s.sectionTitle, { color: txt }]}>Your tickets</Text>}

        {!user ? null : loading ? (
          <View style={{ paddingVertical: 40 }}>
            <ActivityIndicator size="large" color={goldColor} />
          </View>
        ) : loadError && tickets.length === 0 ? (
          <View style={[s.emptyCard, { backgroundColor: cardBg, borderColor: border }]}>
            <Ionicons name="cloud-offline-outline" size={36} color={txtSec} style={{ marginBottom: 8 }} />
            <Text style={{ fontSize: 13, fontWeight: '900', color: txt, marginBottom: 4 }}>
              Couldn't load your tickets
            </Text>
            <Text style={{ fontSize: 10, color: txtSec, textAlign: 'center', lineHeight: 15, maxWidth: 260, marginBottom: 16 }}>
              {loadError}
            </Text>
            <TouchableOpacity
              style={{ backgroundColor: goldColor, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 12 }}
              onPress={() => { setLoading(true); fetchTickets(); }}
            >
              <Text style={{ color: isDark ? '#000' : '#fff', fontSize: 12, fontWeight: '900' }}>
                Try again
              </Text>
            </TouchableOpacity>
          </View>
        ) : tickets.length === 0 ? (
          <View style={[s.emptyCard, { backgroundColor: cardBg, borderColor: border }]}>
            <Ionicons name="chatbox-ellipses-outline" size={36} color={txtSec} style={{ marginBottom: 8 }} />
            <Text style={{ fontSize: 13, fontWeight: '900', color: txt, marginBottom: 4 }}>
              No tickets yet
            </Text>
            <Text style={{ fontSize: 10, color: txtSec, textAlign: 'center', lineHeight: 15, maxWidth: 260, marginBottom: 16 }}>
              Have an issue with an order, payment or delivery? Raise a ticket and our team will help you out.
            </Text>
            {!showNewForm && (
              <TouchableOpacity
                style={{ backgroundColor: goldColor, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 12 }}
                onPress={() => setShowNewForm(true)}
              >
                <Text style={{ color: isDark ? '#000' : '#fff', fontSize: 12, fontWeight: '900' }}>
                  New ticket
                </Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <View style={s.ticketList}>
            {loadError && (
              <TouchableOpacity onPress={() => fetchTickets()}>
                <Text style={{ fontSize: 10, fontWeight: '700', color: '#EF4444', textAlign: 'center', marginBottom: 4 }}>
                  Couldn't refresh your tickets. Tap to try again.
                </Text>
              </TouchableOpacity>
            )}
            {tickets.map((ticket, idx) => {
              const isClosed = ticket.status === 'Resolved' || ticket.status === 'Closed';
              const ticketOrderId = ticket.order?.id || ticket.orderId;
              return (
                <View key={ticket.id || ticket._id || String(idx)} style={[s.ticketCard, { backgroundColor: cardBg, borderColor: border }]}>
                  <View style={s.ticketHeader}>
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      <View style={[s.statusBadge, isClosed ? s.statusResolved : { backgroundColor: activeBgColor }] as any}>
                        <Text style={[s.statusText, { color: activeTextColor }, isClosed && { color: '#22C55E' }]}>{statusLabel(ticket.status)}</Text>
                      </View>
                      <View style={[s.prioBadge, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }]}>
                        <Text style={s.prioText}>{priorityLabel(ticket.priority)}</Text>
                      </View>
                    </View>
                    <Text style={s.ticketId}>#{shortId(ticket.id || ticket._id)}</Text>
                  </View>
                  <Text style={[s.ticketSubject, { color: txt }]}>{ticket.subject}</Text>
                  {!!ticketOrderId && (
                    <TouchableOpacity onPress={() => router.push(`/tracking/${ticketOrderId}` as any)}>
                      <Text style={{ fontSize: 10, fontWeight: '800', color: activeTextColor, marginBottom: 4 }}>
                        Order #{shortId(ticketOrderId)} ›
                      </Text>
                    </TouchableOpacity>
                  )}
                  <Text style={[s.ticketDesc, { color: txtSec }]}>{ticket.description}</Text>
                  {!!formatWhen(ticket.createdAt) && (
                    <Text style={{ fontSize: 9, fontWeight: '700', color: '#888', marginTop: 6 }}>Raised {formatWhen(ticket.createdAt)}</Text>
                  )}

                  {!!ticket.adminResponse && (
                    <View style={[s.responseBox, { backgroundColor: isDark ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.03)', borderColor: border }]}>
                      <Text style={s.responseLabel}>Reply from Zenvy Support</Text>
                      <Text style={[s.responseText, { color: txt }]}>{ticket.adminResponse}</Text>
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, paddingTop: Platform.OS === 'android' ? 40 : 50, maxWidth: 600, width: '100%', alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 16, borderBottomWidth: 1 },
  backBtn: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  backIcon: { fontSize: 32, fontWeight: '300' },
  subText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.3 },
  title: { fontSize: 18, fontWeight: '900' },
  newBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12 },
  newBtnText: { fontSize: 11, fontWeight: '800' },

  scrollContent: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 40 },
  formCard: { padding: 20, borderRadius: 24, borderWidth: 1, marginBottom: 20 },
  formTitle: { fontSize: 13, fontWeight: '900', letterSpacing: 0.2, marginBottom: 16 },
  linkedOrder: { flexDirection: 'row', alignItems: 'center', padding: 10, borderRadius: 12, borderWidth: 1, marginBottom: 14 },
  label: { fontSize: 11, fontWeight: '800', marginBottom: 6, marginLeft: 2 },
  input: { height: 48, borderRadius: 14, borderWidth: 1, paddingHorizontal: 16, fontSize: 13, marginBottom: 16 },
  textarea: { height: 100, paddingTop: 12, paddingBottom: 12, textAlignVertical: 'top' },

  priorityRow: { flexDirection: 'row', gap: 6, marginBottom: 16 },
  chip: { flex: 1, height: 36, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  chipActive: {},
  chipText: { fontSize: 11, fontWeight: '800', color: '#888' },
  chipTextActive: {},

  submitBtn: { height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  submitText: { fontSize: 13, fontWeight: '900', color: '#fff' },

  sectionTitle: { fontSize: 13, fontWeight: '900', letterSpacing: 0.2, marginBottom: 12, marginLeft: 4 },
  emptyCard: { paddingVertical: 40, alignItems: 'center', borderRadius: 24, borderWidth: 1 },
  ticketList: { gap: 12 },
  ticketCard: { padding: 16, borderRadius: 20, borderWidth: 1 },
  ticketHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  statusResolved: { backgroundColor: 'rgba(34,197,94,0.1)' },
  statusPending: {},
  statusText: { fontSize: 10, fontWeight: '800' },
  prioBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  prioText: { fontSize: 10, fontWeight: '800', color: '#AAA' },
  ticketId: { fontSize: 9, fontWeight: '600', color: '#888', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  ticketSubject: { fontSize: 14, fontWeight: '900', marginBottom: 4 },
  ticketDesc: { fontSize: 11, fontWeight: '700', lineHeight: 16 },

  responseBox: { marginTop: 12, padding: 12, borderRadius: 12, borderWidth: 1 },
  responseLabel: { fontSize: 10, fontWeight: '800', color: '#22c55e', marginBottom: 4 },
  responseText: { fontSize: 11, fontWeight: '700', fontStyle: 'italic' }
});
