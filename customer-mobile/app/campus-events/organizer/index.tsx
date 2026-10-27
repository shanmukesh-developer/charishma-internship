// Zenvy Campus Events: organizer home. Ordinary students see the application form (verified clubs and authorised
// student organizers only publish; Zenvy admins approve). ACTIVE organizers see their events by review status
// and can create a new draft. Organizer status comes from GET /organizer/me (server-side RBAC).
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, Alert, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { KeyboardAvoidingView } from '../../../components/KeyboardAvoidingView';
import { campusEventsApi, CampusEventsError, errorCopy, fmtWhen, EVENT_STATUS_META, type OrganizerMe, type OrganizerEvent, type EventStatus } from '../../../modules/campusEvents/campusEventsApi';
import { EHeader, usePalette, Card, Btn, Field, Chips, ErrorState, StateView, Notice, Pill, Poster, refreshCampusEventsStatus, CE_HOME } from '../../../modules/campusEvents/ui';
import { useCampusEventsLive } from '../../../modules/campusEvents/useCampusEventsLive';

type Filter = 'all' | 'review' | 'live' | 'drafts' | 'past';
const BUCKET: Record<Filter, EventStatus[] | null> = {
  all: null,
  drafts: ['DRAFT', 'CHANGES_REQUESTED', 'REJECTED'],
  review: ['SUBMITTED'],
  live: ['APPROVED', 'PUBLISHED', 'UNPUBLISHED'],
  past: ['COMPLETED', 'CANCELLED'],
};
const REASONS: Record<string, string> = {
  VERIFICATION_REQUIRED: 'Verify your college first.', CAMPUS_REQUIRED: 'Verify your college first.', ACCOUNT_SUSPENDED: 'Your account is suspended.',
};

export default function OrganizerHome() {
  const router = useRouter();
  const p = usePalette();
  const [me, setMe] = useState<OrganizerMe | null>(null);
  const [events, setEvents] = useState<OrganizerEvent[] | null>(null);
  const [error, setError] = useState<CampusEventsError | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [form, setForm] = useState({ displayName: '', entityId: null as string | null, note: '', proofText: '' });
  const [formErr, setFormErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const m = await campusEventsApi.organizerMe();
      setMe(m);
      if (m.organizer?.status === 'ACTIVE') setEvents((await campusEventsApi.orgEvents()).events);
      setError(null);
    } catch (e: any) {
      setError(e instanceof CampusEventsError ? e : new CampusEventsError(e?.message || 'Could not load.'));
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  useCampusEventsLive((e) => { if (e.kind === 'event' || e.kind === 'reconnect') load(); });

  const apply = async () => {
    if (form.displayName.trim().length < 2) { setFormErr('Tell us the club or organizer name.'); return; }
    setBusy(true);
    try {
      await campusEventsApi.applyOrganizer({ displayName: form.displayName.trim(), entityId: form.entityId, note: form.note.trim(), proofText: form.proofText.trim() });
      refreshCampusEventsStatus().catch(() => {});
      Alert.alert('Application sent', 'The ZCS team reviews organizer applications. You will get a notification.');
      load();
    } catch (e: any) {
      if (e?.field === 'displayName') setFormErr(e.message);
      else { const c = errorCopy(e); Alert.alert(c.title, c.message); }
    } finally {
      setBusy(false);
    }
  };

  if (!me) {
    return (
      <View style={{ flex: 1, backgroundColor: p.bg }}>
        <EHeader title="Organizer" />
        {error ? <ErrorState error={error} onRetry={load} onNotFound={() => router.replace(CE_HOME as any)} /> : <StateView kind="loading" />}
      </View>
    );
  }

  const o = me.organizer;
  if (!o || o.status !== 'ACTIVE') {
    return (
      <View style={{ flex: 1, backgroundColor: p.bg }}>
        <EHeader title="Host an event" />
        <KeyboardAvoidingView style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
            <Notice icon="megaphone-outline">Verified clubs and authorised student organizers can publish events on ZCS. Every event is reviewed by the ZCS team before students can see it.</Notice>
            {o?.status === 'PENDING' ? <Notice tone="warn" icon="time-outline">Your application ({o.displayName}) is with the ZCS team. We will notify you.</Notice> : null}
            {o?.status === 'SUSPENDED' ? <Notice tone="danger" icon="ban-outline">Your organizer access is suspended.{o.reviewNote ? ` ${o.reviewNote}` : ''}</Notice> : null}
            {o?.status === 'REJECTED' || o?.status === 'REVOKED' ? <Notice tone="danger" icon="close-circle-outline">Your previous application was {o.status === 'REJECTED' ? 'not approved' : 'revoked'}.{o.reviewNote ? ` ${o.reviewNote}` : ''} You can apply again.</Notice> : null}
            {me.canApply ? (
              <Card>
                <Text style={{ fontSize: 16, fontWeight: '900', color: p.text, marginBottom: 12 }}>Apply as an organizer</Text>
                <Field label="Club / organizer name" required value={form.displayName} onChangeText={(v) => { setForm((f) => ({ ...f, displayName: v })); setFormErr(null); }} maxLength={80} error={formErr} placeholder="e.g. Robotics Club" />
                {me.managedClubs.length ? (
                  <View style={{ marginBottom: 14 }}>
                    <Text style={{ fontSize: 12, fontWeight: '800', color: p.sub, marginBottom: 6 }}>Verified club you manage (optional)</Text>
                    <Chips value={form.entityId || 'none'} onChange={(v: string) => setForm((f) => ({ ...f, entityId: v === 'none' ? null : v }))}
                      options={[{ key: 'none', label: 'None' }, ...me.managedClubs.map((c) => ({ key: c.id, label: c.name }))]} />
                  </View>
                ) : null}
                <Field label="What events will you run?" value={form.note} onChangeText={(v) => setForm((f) => ({ ...f, note: v }))} multiline maxLength={1000} placeholder="Tournaments, workshops, practice sessions…" />
                <Field label="Proof you represent the club (optional)" value={form.proofText} onChangeText={(v) => setForm((f) => ({ ...f, proofText: v }))} maxLength={500} hint="e.g. your role and the faculty coordinator's name. No ID numbers." />
                <Btn label="Send application" onPress={apply} loading={busy} />
              </Card>
            ) : !o ? (
              <Notice tone="warn" icon="school-outline">{[...new Set(me.eligibilityReasons.map((r) => REASONS[r]).filter(Boolean))].join(' ') || 'You cannot apply right now.'}</Notice>
            ) : null}
            {me.eligibilityReasons.some((r) => r === 'VERIFICATION_REQUIRED' || r === 'CAMPUS_REQUIRED') ? <Btn label="Verify my college" kind="secondary" onPress={() => router.push('/friends?screen=verification' as any)} /> : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    );
  }

  const shown = (events || []).filter((e) => !BUCKET[filter] || BUCKET[filter]!.includes(e.status));
  const count = (f: Filter) => (events || []).filter((e) => !BUCKET[f] || BUCKET[f]!.includes(e.status)).length;

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <EHeader title="My events" subtitle={`Organizer · ${o.displayName}`} right={
        <TouchableOpacity onPress={() => router.push('/campus-events/check-in' as any)} accessibilityRole="button" accessibilityLabel="Entry check-in" style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="shield-checkmark-outline" size={22} color={p.text} />
        </TouchableOpacity>
      } />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={p.accent} />}>
        <Btn label="Create a new event" icon="add" onPress={() => router.push('/campus-events/organizer/edit' as any)} style={{ marginBottom: 14 }} />
        <Chips<Filter> wrap={false} value={filter} onChange={setFilter} accessibilityLabel="Filter events"
          options={[{ key: 'all', label: `All ${count('all')}` }, { key: 'drafts', label: `Drafts ${count('drafts')}` }, { key: 'review', label: `In review ${count('review')}` }, { key: 'live', label: `Live ${count('live')}` }, { key: 'past', label: `Past ${count('past')}` }]} />
        <View style={{ height: 12 }} />
        {!events ? <StateView kind="loading" /> : !shown.length ? (
          <StateView kind="empty" icon="folder-open-outline" title={events.length ? 'Nothing here' : 'No events yet'} message={events.length ? 'Try another filter.' : 'Create a draft, add the details and submit it for review.'} />
        ) : shown.map((e) => {
          const m = EVENT_STATUS_META[e.status];
          return (
            <TouchableOpacity key={e.id} onPress={() => router.push(`/campus-events/organizer/${e.id}` as any)} accessibilityRole="button" accessibilityLabel={`${e.title}, ${m.label}`} activeOpacity={0.9}>
              <Card style={{ padding: 0, overflow: 'hidden' }}>
                <View style={{ flexDirection: 'row' }}>
                  <View style={{ width: 88 }}><Poster uri={e.posterUrl} category={e.category} height={110} radius={0} /></View>
                  <View style={{ flex: 1, padding: 12, gap: 4 }}>
                    <Text style={{ fontSize: 14.5, fontWeight: '900', color: p.text }} numberOfLines={2}>{e.title}</Text>
                    <Text style={{ fontSize: 12, color: p.sub }}>{e.startAt ? fmtWhen(e.startAt) : 'Date not set'}</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                      <Pill label={m.label} color={m.color} />
                      {e.pendingChanges ? <Pill label="Edits in review" color="#D97706" /> : null}
                      {['PUBLISHED', 'COMPLETED'].includes(e.status) ? <Pill label={`${e.counters.confirmed} confirmed`} color="#0EA5E9" /> : null}
                    </View>
                  </View>
                </View>
              </Card>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}
