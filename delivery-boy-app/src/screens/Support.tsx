// Rider support: raise a ticket (POST /delivery/support), see replies, or call / WhatsApp Zenvy.
import React, { useCallback, useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { C, R, S, T, useInsets } from '../theme';
import { Badge, Btn, Card, EmptyState, ErrorState, Label, ScreenHeader, Skeleton } from '../ui/kit';
import { useRider } from '../state/RiderStore';
import * as api from '../services/deliveryApi';
import * as links from '../services/links';
import { errorMessage } from '../services/apiClient';
import { dayLabel, istDayKey, timeIST } from '../services/format';
import { SUPPORT_PHONE } from '../config';
import type { SupportTicket } from '../types';

const TOPICS = ['Order issue', 'Payment / earnings', 'App problem', 'Other'];

export function SupportScreen({ prefill, onBack }: { prefill?: string; onBack: () => void }) {
  const r = useRider();
  const insets = useInsets();
  const [topic, setTopic] = useState(prefill ? 'Order issue' : '');
  const [text, setText] = useState(prefill ?? '');
  const [formError, setFormError] = useState<string | null>(null);
  const [tickets, setTickets] = useState<SupportTicket[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setTickets(await api.fetchTickets());
      setListError(null);
    } catch (e) {
      setListError(errorMessage(e));
    }
  }, []);

  // Also reloads when support answers a ticket while this screen is open (socket ticket_updated).
  useEffect(() => {
    load();
  }, [load, r.ticketNonce]);

  const canSend = !!topic && text.trim().length >= 5;

  const submit = async () => {
    if (!canSend) return;
    setFormError(null);
    try {
      const urgent = /PIN locked|cancel/i.test(text);
      await api.createTicket(topic, text.trim(), urgent ? 'High' : 'Medium');
      r.showToast('Sent. ZCS support will reply here.', 'success');
      setText('');
      setTopic('');
      load();
    } catch (e) {
      setFormError(errorMessage(e));
    }
  };

  const phone10 = SUPPORT_PHONE.slice(-10);

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, backgroundColor: C.bg }}>
      <ScreenHeader title="Help" onBack={onBack} />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + S.xxl }]}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              try {
                await load();
              } finally {
                setRefreshing(false);
              }
            }}
          />
        }
      >
        <View style={{ flexDirection: 'row', gap: S.md }}>
          <Btn title="Call" icon="phone" size="mid" onPress={() => links.callNumber(`+${SUPPORT_PHONE}`)} style={{ flex: 1 }} />
          <Btn
            title="WhatsApp"
            icon="whatsapp"
            variant="green"
            size="mid"
            onPress={() => links.whatsapp(phone10, `Hi ZCS, I'm rider ${r.profile?.name ?? ''}. ${text.trim()}`.trim())}
            style={{ flex: 1 }}
          />
        </View>

        <Card style={{ gap: S.md }}>
          <Label>WRITE TO SUPPORT</Label>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm }}>
            {TOPICS.map((t) => (
              <Btn key={t} title={t} size="small" variant={topic === t ? 'dark' : 'outline'} onPress={() => setTopic(t)} />
            ))}
          </View>
          <TextInput
            value={text}
            onChangeText={(v) => {
              setText(v);
              setFormError(null);
            }}
            placeholder="What happened?"
            placeholderTextColor={C.muted}
            multiline
            maxLength={1000}
            style={[T.body, styles.input]}
            accessibilityLabel="Describe the problem"
          />
          {formError ? <Text style={[T.body, { color: C.red, fontWeight: '700' }]}>{formError}</Text> : null}
          <Btn title="Send" icon="send" onPress={submit} disabled={!canSend || !r.connected} />
          {!r.connected ? <Text style={[T.small, { color: C.amber }]}>No internet. Call support instead.</Text> : null}
        </Card>

        <Text style={[T.h3, { color: C.ink }]}>Your tickets</Text>
        {tickets === null && !listError ? (
          <Skeleton height={80} />
        ) : listError && !tickets ? (
          <ErrorState message={listError} onRetry={load} />
        ) : !tickets || tickets.length === 0 ? (
          <EmptyState icon="ticket-outline" title="No tickets yet" />
        ) : (
          tickets.map((t) => (
            <Card key={t.id} style={{ gap: S.sm }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
                <Text style={[T.body, { color: C.ink, fontWeight: '800', flex: 1 }]} numberOfLines={1}>
                  {t.subject || 'Ticket'}
                </Text>
                <Badge tone={/resolv|clos/i.test(t.status) ? 'green' : 'amber'} label={t.status} />
              </View>
              <Text style={[T.small, { color: C.ink2 }]} numberOfLines={3}>
                {t.description}
              </Text>
              {t.adminResponse ? (
                <View style={styles.reply}>
                  <Label color={C.blue}>ZCS REPLIED</Label>
                  <Text style={[T.body, { color: C.ink }]}>{t.adminResponse}</Text>
                </View>
              ) : null}
              {t.createdAt ? (
                <Text style={[T.small, { color: C.muted }]}>
                  {dayLabel(istDayKey(t.createdAt))}, {timeIST(t.createdAt)}
                </Text>
              ) : null}
            </Card>
          ))
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: S.lg, gap: S.lg },
  input: {
    minHeight: 110,
    textAlignVertical: 'top',
    borderRadius: R.md,
    borderWidth: 2,
    borderColor: C.line,
    padding: S.md,
    color: C.ink,
    backgroundColor: C.card,
  },
  reply: { backgroundColor: C.blueTint, borderRadius: R.md, padding: S.md, gap: 4 },
});
