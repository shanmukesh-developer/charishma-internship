// Complaints raised by tenants about the PG (POST /api/pg-tenant/complaints from the customer app). The owner
// replies and marks them in progress or resolved; the student gets a push + in-app notification.
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { color, font, radius, space } from '../theme';
import { Badge, Button, Card, EmptyState, ErrorStrip, Segmented, Sheet, SkeletonCard } from '../ui/kit';
import { Banner, Field, Screen } from '../ui/Screen';
import { ListingSwitcher } from '../ui/ListingSwitcher';
import { useListing } from '../state/ListingProvider';
import { useHome } from '../state/HomeProvider';
import { useToast } from '../ui/Toast';
import { ownerApi } from '../api/ownerApi';
import { errorMessage } from '../lib/http';
import { ago } from '../lib/format';
import { LIMITS } from '../config';
import type { Complaint, ComplaintStatus } from '../types';
import type { ScreenProps } from '../nav';

const CATEGORY: Record<string, string> = {
  room: 'Room', bathroom: 'Bathroom', food: 'Food / mess', water: 'Water', electricity: 'Electricity', wifi: 'Wi-Fi',
  cleaning: 'Cleaning', safety: 'Safety', staff: 'Staff', other: 'Other',
};
const STATUS: Record<ComplaintStatus, { text: string; fg: string; bg: string }> = {
  OPEN: { text: 'New', fg: color.alertDark, bg: color.alertTint },
  IN_PROGRESS: { text: 'In progress', fg: color.warn, bg: color.warnTint },
  RESOLVED: { text: 'Resolved', fg: color.ok, bg: color.okTint },
};

export default function ComplaintsScreen({ navigation }: ScreenProps<'Complaints'>) {
  const { current } = useListing();
  const { refresh: refreshHome } = useHome();
  const toast = useToast();
  const [tab, setTab] = useState<'open' | 'resolved'>('open');
  const [list, setList] = useState<Complaint[] | null>(null);
  const [open, setOpen] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [replying, setReplying] = useState<Complaint | null>(null);

  const load = useCallback(async () => {
    if (!current) return;
    setLoading(true);
    try {
      const r = await ownerApi.complaints(tab, current.id);
      setList(r.complaints);
      setOpen(r.counts.open);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [tab, current]);
  useEffect(() => { setList(null); load(); }, [load]);

  return (
    <Screen title="Complaints" subtitle={current?.name} onBack={() => navigation.goBack()} right={<ListingSwitcher />} refreshing={loading && !!list} onRefresh={load}>
      <Segmented value={tab} onChange={setTab} options={[{ key: 'open', label: 'Open', count: open }, { key: 'resolved', label: 'Resolved' }]} />
      {error && !list ? <ErrorStrip text={error} onRetry={load} busy={loading} /> : null}
      {!list && !error ? <SkeletonCard /> : null}
      {list && !list.length ? (
        <EmptyState icon="happy-outline" title={tab === 'open' ? 'No open complaints' : 'Nothing resolved yet'} body={tab === 'open' ? 'Tenants can raise a complaint about the PG from the ZCS app. You will be notified.' : undefined} />
      ) : null}
      {list?.map((c) => {
        const s = STATUS[c.status];
        return (
          <Card key={c.id} style={{ gap: space.xs }}>
            <View style={st.row}>
              <View style={{ flex: 1 }}>
                <Text style={[font.h3, { color: color.text }]}>{CATEGORY[c.category] || 'Other'}</Text>
                <Text style={[font.small, { color: color.textMuted }]}>{c.firstName} · {ago(c.createdAt)}</Text>
              </View>
              <Badge text={s.text} fg={s.fg} bg={s.bg} />
            </View>
            <Text style={[font.body, { color: color.textSecondary }]}>{c.text}</Text>
            {c.ownerReply ? (
              <View style={st.reply}>
                <Ionicons name="return-down-forward" size={16} color={color.primaryDark} />
                <Text style={[font.small, { color: color.primaryDark, flex: 1 }]}>You: {c.ownerReply}</Text>
              </View>
            ) : null}
            {c.status !== 'RESOLVED' ? <Button label={c.ownerReply ? 'Update reply' : 'Reply'} size="secondary" icon="chatbubble-outline" onPress={() => setReplying(c)} /> : null}
          </Card>
        );
      })}
      <ReplySheet complaint={replying} onClose={() => setReplying(null)} onDone={(msg) => { setReplying(null); toast.show(msg, 'success'); load(); refreshHome(); }} />
    </Screen>
  );
}

function ReplySheet({ complaint, onClose, onDone }: { complaint: Complaint | null; onClose: () => void; onDone: (msg: string) => void }) {
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState<null | 'IN_PROGRESS' | 'RESOLVED'>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (complaint) { setReply(complaint.ownerReply || ''); setError(null); } }, [complaint]);
  const ok = reply.trim().length >= 2;
  const send = async (status: 'IN_PROGRESS' | 'RESOLVED') => {
    if (!complaint || !ok || busy) return;
    setBusy(status);
    setError(null);
    try {
      const r = await ownerApi.reply(complaint.id, reply.trim(), status);
      onDone(r.message);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <Sheet visible={!!complaint} onClose={onClose} title={complaint ? `Reply to ${complaint.firstName}` : 'Reply'}>
      <View style={{ gap: space.md }}>
        {complaint ? <Text style={[font.body, { color: color.textSecondary }]} numberOfLines={4}>{complaint.text}</Text> : null}
        <Field label="Your reply" value={reply} onChangeText={(v) => setReply(v.slice(0, LIMITS.REPLY_MAX))} multiline placeholder="e.g. The plumber comes tomorrow at 10 am." />
        {error ? <Banner tone="error" text={error} /> : null}
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Button label="Working on it" variant="secondary" size="secondary" onPress={() => send('IN_PROGRESS')} loading={busy === 'IN_PROGRESS'} disabled={!ok || !!busy} style={{ flex: 1 }} />
          <Button label="Resolved" variant="success" size="secondary" icon="checkmark" onPress={() => send('RESOLVED')} loading={busy === 'RESOLVED'} disabled={!ok || !!busy} style={{ flex: 1 }} />
        </View>
      </View>
    </Sheet>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  reply: { flexDirection: 'row', gap: 6, backgroundColor: color.primaryTint, borderRadius: radius.md, padding: space.sm },
});
