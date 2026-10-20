// Zenvy Campus Events: organizer event page. Review status + notes, actions (edit, submit for approval, withdraw,
// delete draft, cancel event), stats, slots editor (slot activities), registrations (filter, approve / reject,
// mark paid / refunded at the venue desk), registered teams, announcements to registrants, and check-in staff
// grants. Participants appear as name + code + statuses + answers only (no phones / emails), as the server sends.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, Alert, TouchableOpacity, TextInput, Modal } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { KeyboardAvoidingView } from '../../../components/KeyboardAvoidingView';
import {
  campusEventsApi, CampusEventsError, errorCopy, answerRows, fmtWhen, fmtRange, fmtClock, dayLabel, istDate, istYmd, inr, EVENT_STATUS_META, PAYMENT_STATUS_LABEL, REG_STATUS_META, TICKET_STATUS_META, fieldLabel, teamSizeLabel,
  type OrganizerEvent, type Participant, type Question, type Slot, type EventStats, type StaffGrant, type Announcement, type AnnouncementKind, type RegStatus,
} from '../../../modules/campusEvents/campusEventsApi';
import { EHeader, usePalette, Card, Btn, Field, Chips, ErrorState, StateView, Notice, Row, Pill, RegStatusPill, SectionTitle, Poster } from '../../../modules/campusEvents/ui';
import PeoplePicker from '../../../modules/campusEvents/PeoplePicker';
import { useCampusEventsLive } from '../../../modules/campusEvents/useCampusEventsLive';

type Tab = 'overview' | 'registrations' | 'slots' | 'updates' | 'staff';
type RegFilter = 'ALL' | RegStatus;

export default function OrganizerEventScreen() {
  const params = useLocalSearchParams<{ id: string | string[]; created?: string }>();
  const id = String(Array.isArray(params.id) ? params.id[0] : params.id || '');
  const router = useRouter();
  const p = usePalette();
  const [ev, setEv] = useState<OrganizerEvent | null>(null);
  const [error, setError] = useState<CampusEventsError | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [stats, setStats] = useState<EventStats | null>(null);
  const [regs, setRegs] = useState<{ list: Participant[]; questions: Question[] } | null>(null);
  const [regFilter, setRegFilter] = useState<RegFilter>('ALL');
  const [teams, setTeams] = useState<{ id: string; name: string; members: { id: string; role: string; name: string }[] }[]>([]);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [news, setNews] = useState<Announcement[] | null>(null);
  const [staff, setStaff] = useState<StaffGrant[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [picker, setPicker] = useState(false);
  const [ann, setAnn] = useState({ title: '', body: '', kind: 'UPDATE' as AnnouncementKind });
  const [slotForm, setSlotForm] = useState<{ open: boolean; date: string; time: string; minutes: string; capacity: string; price: string; label: string }>({ open: false, date: istDate(1), time: '10:00', minutes: '60', capacity: '10', price: '', label: '' });
  const [reject, setReject] = useState<{ reg: Participant; reason: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await campusEventsApi.orgEvent(id);
      setEv(r.event);
      setError(null);
      const live = ['APPROVED', 'PUBLISHED', 'UNPUBLISHED', 'COMPLETED', 'CANCELLED'].includes(r.event.status);
      if (live) campusEventsApi.orgStats(id).then((s) => setStats(s.stats)).catch(() => {});
    } catch (e: any) {
      setError(e instanceof CampusEventsError ? e : new CampusEventsError(e?.message || 'Could not load this event.'));
    }
  }, [id]);
  const loadTab = useCallback(async (t: Tab) => {
    try {
      if (t === 'registrations') {
        const r = await campusEventsApi.orgRegistrations(id, regFilter === 'ALL' ? null : regFilter);
        setRegs({ list: r.registrations, questions: r.questions });
        campusEventsApi.orgTeams(id).then((x) => setTeams(x.teams)).catch(() => {});
      } else if (t === 'slots') setSlots((await campusEventsApi.orgSlots(id)).slots);
      else if (t === 'updates') setNews((await campusEventsApi.orgAnnouncements(id)).announcements);
      else if (t === 'staff') setStaff((await campusEventsApi.orgStaff(id)).staff);
    } catch (e: any) {
      const c = errorCopy(e);
      Alert.alert(c.title, c.message);
    }
  }, [id, regFilter]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (tab !== 'overview') loadTab(tab); }, [tab, loadTab]);
  useCampusEventsLive((e) => { if (!e.id || e.id === id || e.kind === 'reconnect') { load(); if (tab !== 'overview') loadTab(tab); } });

  const run = async (tag: string, fn: () => Promise<any>, after?: (r: any) => void) => {
    setBusy(tag);
    try {
      const r = await fn();
      if (r?.event) setEv(r.event);
      after?.(r);
      load();
      if (tab !== 'overview') loadTab(tab);
    } catch (e: any) {
      const c = errorCopy(e);
      const fl = fieldLabel(e?.field);
      Alert.alert(c.title, fl ? `${c.message}\nCheck: ${fl}` : c.message, e?.code === 'INCOMPLETE' ? [{ text: 'Later', style: 'cancel' }, { text: 'Edit event', onPress: () => router.push(`/campus-events/organizer/edit?id=${id}` as any) }] : undefined);
    } finally {
      setBusy(null);
    }
  };

  if (!ev) {
    return (
      <View style={{ flex: 1, backgroundColor: p.bg }}>
        <EHeader title="Event" />
        {error ? <ErrorState error={error} onRetry={load} notFoundTitle="Event not found" notFoundLabel="My events" onNotFound={() => router.replace('/campus-events/organizer' as any)} /> : <StateView kind="loading" />}
      </View>
    );
  }

  const m = EVENT_STATUS_META[ev.status];
  const editable = ['DRAFT', 'CHANGES_REQUESTED', 'REJECTED'].includes(ev.status);
  const live = ['APPROVED', 'PUBLISHED', 'UNPUBLISHED'].includes(ev.status);
  const capText = ev.format === 'SLOT'
    ? 'Slot booking'
    : ev.format === 'TEAM'
      ? ev.team?.maxTeams ? `${ev.team.maxTeams} team${ev.team.maxTeams === 1 ? '' : 's'} · ${teamSizeLabel(ev.team.min, ev.team.max)}` : 'Capacity not set'
      : ev.capacityRaw ? `${ev.capacityRaw} seat${ev.capacityRaw === 1 ? '' : 's'}` : 'Capacity not set';
  const pendingFields = [...new Set(Object.keys(ev.pendingChanges?.fields || {}).map((k) => fieldLabel(k)).filter(Boolean))].join(', ');
  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    ...(ev.format === 'SLOT' ? [{ key: 'slots' as Tab, label: 'Slots' }] : []),
    ...(ev.status !== 'DRAFT' ? [{ key: 'registrations' as Tab, label: `Registrations${stats ? ` ${stats.total}` : ''}` }, { key: 'updates' as Tab, label: 'Updates' }, { key: 'staff' as Tab, label: 'Check-in staff' }] : []),
  ];

  const submit = () => Alert.alert('Submit for approval?', 'The Zenvy team reviews the event before students can see it. You cannot edit while it is in review (you can withdraw it).', [
    { text: 'Not yet', style: 'cancel' }, { text: 'Submit', onPress: () => run('submit', () => campusEventsApi.orgSubmit(id), () => Alert.alert('Submitted', 'You will be notified when it is reviewed.')) },
  ]);
  const cancelEvent = () => setReject({ reg: { id: '__event__' } as Participant, reason: '' });
  const del = () => Alert.alert('Delete this draft?', 'This cannot be undone.', [{ text: 'Keep', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => run('delete', () => campusEventsApi.orgDelete(id), () => router.replace('/campus-events/organizer' as any)) }]);

  const addSlot = () => {
    const start = new Date(`${slotForm.date}T${slotForm.time}:00+05:30`);
    const minutes = Number(slotForm.minutes);
    const capacity = Number(slotForm.capacity);
    if (!/^\d{2}:\d{2}$/.test(slotForm.time) || Number.isNaN(start.getTime())) { Alert.alert('Check the time', 'Use HH:MM, for example 16:30.'); return; }
    if (!(minutes > 0) || !(capacity > 0)) { Alert.alert('Check the slot', 'Duration and capacity must be above 0.'); return; }
    run('slot', () => campusEventsApi.orgCreateSlots(id, [{
      startAt: start.toISOString(), endAt: new Date(start.getTime() + minutes * 60000).toISOString(), capacity,
      ...(slotForm.label.trim() ? { label: slotForm.label.trim() } : {}), ...(slotForm.price.trim() ? { price: Number(slotForm.price) } : {}),
    }]), () => setSlotForm((f) => ({ ...f, open: false, label: '' })));
  };

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <EHeader title={ev.title} subtitle={`${m.label}${ev.startAt ? ` · ${fmtWhen(ev.startAt)}` : ''}`} right={<Pill label={m.label} color={m.color} />} />
      <View style={{ paddingHorizontal: 16, paddingTop: 10 }}>
        <Chips<Tab> wrap={false} value={tab} onChange={setTab} options={tabs} accessibilityLabel="Event sections" />
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); if (tab !== 'overview') await loadTab(tab); setRefreshing(false); }} tintColor={p.accent} />}>
          {tab === 'overview' ? (
            <>
              {params.created === '1' && ev.status === 'DRAFT' ? <Notice tone="success" icon="checkmark-circle-outline">Draft saved.{ev.format === 'SLOT' ? ' Add time slots, then submit it for approval.' : ' Submit it for approval when ready.'}</Notice> : null}
              {ev.status === 'SUBMITTED' ? <Notice tone="warn" icon="time-outline">In review by the Zenvy team since {fmtWhen(ev.submittedAt)}.</Notice> : null}
              {ev.status === 'CHANGES_REQUESTED' ? <Notice tone="warn" icon="create-outline">Changes requested{ev.reviewNote ? `: ${ev.reviewNote}` : ''}. Edit and submit again.</Notice> : null}
              {ev.status === 'REJECTED' ? <Notice tone="danger" icon="close-circle-outline">Rejected{ev.rejectionReason ? `: ${ev.rejectionReason}` : ''}. You can edit and resubmit.</Notice> : null}
              {ev.status === 'APPROVED' ? <Notice icon="alarm-outline">Approved. Publishes {ev.publishAt ? fmtWhen(ev.publishAt) : 'soon'}.</Notice> : null}
              {ev.status === 'CANCELLED' ? <Notice tone="danger" icon="close-circle-outline">Cancelled{ev.cancelReason ? `: ${ev.cancelReason}` : ''}.</Notice> : null}
              {ev.pendingChanges ? <Notice tone="warn" icon="time-outline">{pendingFields ? `Edits waiting for review: ${pendingFields}.` : 'Edits waiting for review.'}</Notice> : null}

              <Card style={{ padding: 0, overflow: 'hidden' }}>
                <Poster uri={ev.posterUrl} category={ev.category} height={150} radius={0} />
                <View style={{ padding: 14 }}>
                  <Text style={{ fontSize: 16, fontWeight: '900', color: p.text }}>{ev.title}</Text>
                  <Text style={{ fontSize: 12.5, color: p.sub, marginTop: 4 }}><Ionicons name="calendar-outline" size={13} color={p.sub} /> {fmtRange(ev.startAt, ev.endAt)}</Text>
                  <Text style={{ fontSize: 12.5, color: p.sub, marginTop: 2 }}><Ionicons name="location-outline" size={13} color={p.sub} /> {ev.venue || 'Venue not set'}</Text>
                  <Text style={{ fontSize: 12.5, color: p.sub, marginTop: 2 }}>{ev.price.isFree ? 'Free' : inr(ev.price.total)} · {capText}</Text>
                </View>
              </Card>

              {stats ? (
                <Card>
                  <Text style={{ fontWeight: '900', color: p.text, marginBottom: 6 }}>Numbers</Text>
                  <Row label="Confirmed" value={String(stats.confirmed)} strong />
                  <Row label="Checked in" value={String(stats.checkedIn)} />
                  {stats.teams !== undefined ? <Row label="Teams" value={String(stats.teams)} /> : null}
                  {Object.entries(stats.byStatus).filter(([k]) => k !== 'CONFIRMED').map(([k, v]) => <Row key={k} label={REG_STATUS_META[k as RegStatus]?.label || 'Other'} value={String(v)} />)}
                  {stats.collected.VENUE || stats.dueAtVenue ? <Row label="Collected at venue" value={`${inr(stats.collected.VENUE)} · due ${inr(stats.dueAtVenue)}`} /> : null}
                  {stats.collected.WALLET ? <Row label="Wallet" value={inr(stats.collected.WALLET)} /> : null}
                  {stats.collected.ONLINE ? <Row label="Online" value={inr(stats.collected.ONLINE)} /> : null}
                  {stats.refunded ? <Row label="Refunded" value={inr(stats.refunded)} /> : null}
                </Card>
              ) : null}

              <View style={{ gap: 10 }}>
                {editable || live ? <Btn label="Edit event" icon="create-outline" kind="secondary" onPress={() => router.push(`/campus-events/organizer/edit?id=${id}` as any)} /> : null}
                {editable ? <Btn label="Submit for approval" onPress={submit} loading={busy === 'submit'} /> : null}
                {ev.status === 'SUBMITTED' ? <Btn label="Withdraw from review" kind="secondary" loading={busy === 'withdraw'} onPress={() => run('withdraw', () => campusEventsApi.orgWithdraw(id))} /> : null}
                {ev.status === 'PUBLISHED' ? <Btn label="View as a student" kind="ghost" onPress={() => router.push(`/campus-events/${id}` as any)} /> : null}
                {ev.status === 'PUBLISHED' ? <Btn label="Entry check-in" icon="shield-checkmark-outline" kind="secondary" onPress={() => router.push(`/campus-events/check-in?eventId=${id}` as any)} /> : null}
                {ev.status === 'DRAFT' ? <Btn label="Delete draft" kind="danger" loading={busy === 'delete'} onPress={del} /> : null}
                {live || ev.status === 'SUBMITTED' ? <Btn label="Cancel event" kind="danger" loading={busy === 'cancel'} onPress={cancelEvent} /> : null}
              </View>
            </>
          ) : null}

          {tab === 'slots' ? (
            <>
              {!slots ? <StateView kind="loading" /> : !slots.length ? <StateView kind="empty" icon="calendar-outline" title="No slots yet" message="Add the time slots students can book." /> : null}
              {(slots || []).map((s) => (
                <Card key={s.id}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontWeight: '900', color: p.text }}>{dayLabel(istYmd(s.startAt))} · {fmtClock(s.startAt)}–{fmtClock(s.endAt)}</Text>
                      <Text style={{ fontSize: 12, color: p.sub, marginTop: 2 }}>{s.label ? `${s.label} · ` : ''}{s.capacity - s.remaining}/{s.capacity} booked · {s.price.isFree ? 'Free' : s.price.label}{s.waitlistCount ? ` · ${s.waitlistCount} waiting` : ''}</Text>
                    </View>
                    {(s.status || 'OPEN') === 'OPEN' ? (
                      <Btn label="Cancel" small kind="secondary" loading={busy === `cs-${s.id}`} onPress={() => Alert.alert('Cancel this slot?', 'Students booked in it are notified and their bookings cancelled.', [
                        { text: 'Keep', style: 'cancel' }, { text: 'Cancel slot', style: 'destructive', onPress: () => run(`cs-${s.id}`, () => campusEventsApi.orgCancelSlot(id, s.id)) },
                      ])} />
                    ) : <Pill label="Cancelled" color="#64748B" />}
                  </View>
                </Card>
              ))}
              {slotForm.open ? (
                <Card>
                  <Text style={{ fontWeight: '900', color: p.text, marginBottom: 8 }}>New slot</Text>
                  <Chips wrap={false} value={slotForm.date} onChange={(d: string) => setSlotForm((f) => ({ ...f, date: d }))}
                    options={Array.from({ length: 60 }, (_, i) => istDate(i)).filter((d) => (!ev.startAt || d >= istYmd(ev.startAt)) && (!ev.endAt || d <= istYmd(ev.endAt))).map((d) => ({ key: d, label: dayLabel(d) }))} />
                  <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                    <Field style={{ flex: 1 }} label="Start (HH:MM)" value={slotForm.time} maxLength={5} keyboardType="numbers-and-punctuation" onChangeText={(v) => setSlotForm((f) => ({ ...f, time: v }))} />
                    <Field style={{ flex: 1 }} label="Minutes" value={slotForm.minutes} maxLength={4} keyboardType="number-pad" onChangeText={(v) => setSlotForm((f) => ({ ...f, minutes: v.replace(/\D/g, '') }))} />
                  </View>
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <Field style={{ flex: 1 }} label="Capacity" value={slotForm.capacity} maxLength={4} keyboardType="number-pad" onChangeText={(v) => setSlotForm((f) => ({ ...f, capacity: v.replace(/\D/g, '') }))} />
                    <Field style={{ flex: 1 }} label="Price ₹ (blank = event price)" value={slotForm.price} maxLength={6} keyboardType="decimal-pad" onChangeText={(v) => setSlotForm((f) => ({ ...f, price: v.replace(/[^0-9.]/g, '') }))} />
                  </View>
                  <Field label="Label (optional)" value={slotForm.label} maxLength={60} onChangeText={(v) => setSlotForm((f) => ({ ...f, label: v }))} placeholder="e.g. Beginners" />
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <Btn label="Close" kind="secondary" onPress={() => setSlotForm((f) => ({ ...f, open: false }))} style={{ flex: 1 }} />
                    <Btn label="Add slot" onPress={addSlot} loading={busy === 'slot'} style={{ flex: 2 }} />
                  </View>
                </Card>
              ) : ['CANCELLED', 'COMPLETED'].includes(ev.status) ? null : <Btn label="Add a slot" icon="add" onPress={() => setSlotForm((f) => ({ ...f, open: true, date: ev.startAt && istYmd(ev.startAt) > istDate(0) ? istYmd(ev.startAt) : f.date }))} />}
            </>
          ) : null}

          {tab === 'registrations' ? (
            <>
              <Chips<RegFilter> wrap={false} value={regFilter} onChange={setRegFilter}
                options={[{ key: 'ALL', label: 'All' }, { key: 'PENDING_APPROVAL', label: 'To approve' }, { key: 'CONFIRMED', label: 'Confirmed' }, { key: 'WAITLISTED', label: 'Waitlist' }, { key: 'CANCELLED', label: 'Cancelled' }]} />
              <View style={{ height: 12 }} />
              {!regs ? <StateView kind="loading" /> : !regs.list.length ? <StateView kind="empty" icon="receipt-outline" title="No registrations here" /> : regs.list.map((r) => (
                <Card key={r.id}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontWeight: '900', color: p.text }}>{r.team ? `Team: ${r.team.name}` : r.name}</Text>
                      <Text style={{ fontSize: 11.5, color: p.sub, marginTop: 2 }}>{r.code}{r.team ? ` · Captain: ${r.name}` : ''} · {fmtWhen(r.createdAt)}</Text>
                    </View>
                    <RegStatusPill status={r.status} />
                  </View>
                  {r.paymentStatus !== 'NONE' ? <Text style={{ fontSize: 12, color: p.text, marginTop: 6 }}>{inr(r.total)} · {PAYMENT_STATUS_LABEL[r.paymentStatus]}</Text> : null}
                  {r.ticket ? <Text style={{ fontSize: 11.5, color: p.sub, marginTop: 2 }}>Ticket {r.ticket.ticketCode} · {(TICKET_STATUS_META[r.ticket.status]?.label || 'Not valid').toLowerCase()}</Text> : null}
                  {answerRows(r, regs.questions).length ? (
                    <View style={{ marginTop: 6 }}>
                      {answerRows(r, regs.questions).map((a) => (
                        <Text key={a.id} style={{ fontSize: 12, color: p.sub }}>• {a.label}: <Text style={{ color: p.text }}>{a.text}</Text></Text>
                      ))}
                    </View>
                  ) : null}
                  {r.team ? <Text style={{ fontSize: 12, color: p.sub, marginTop: 4 }}>{(teams.find((t) => t.id === r.team!.id)?.members || []).map((mm) => `${mm.name}${mm.role === 'CAPTAIN' ? ' (captain)' : ''}`).join(', ')}</Text> : null}
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                    {r.status === 'PENDING_APPROVAL' ? <Btn label="Approve" small kind="success" loading={busy === `ap-${r.id}`} onPress={() => run(`ap-${r.id}`, () => campusEventsApi.orgApprove(id, r.id))} /> : null}
                    {r.status === 'PENDING_APPROVAL' ? <Btn label="Reject" small kind="secondary" onPress={() => setReject({ reg: r, reason: '' })} /> : null}
                    {r.paymentStatus === 'DUE_AT_VENUE' && r.status === 'CONFIRMED' ? <Btn label={`Mark ${inr(r.total)} paid`} small kind="secondary" loading={busy === `mp-${r.id}`} onPress={() => Alert.alert('Mark as paid?', `Confirm you collected ${inr(r.total)} from ${r.name}. This is recorded with your name.`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Mark paid', onPress: () => run(`mp-${r.id}`, () => campusEventsApi.orgMarkPaid(id, r.id)) }])} /> : null}
                    {r.paymentStatus === 'REFUND_PENDING' && r.paymentMode === 'VENUE' ? <Btn label="Mark refunded" small kind="secondary" loading={busy === `mr-${r.id}`} onPress={() => run(`mr-${r.id}`, () => campusEventsApi.orgMarkRefunded(id, r.id))} /> : null}
                  </View>
                </Card>
              ))}
            </>
          ) : null}

          {tab === 'updates' ? (
            <>
              {['PUBLISHED', 'UNPUBLISHED', 'COMPLETED'].includes(ev.status) ? (
                <Card>
                  <Text style={{ fontWeight: '900', color: p.text, marginBottom: 8 }}>Send an update to registrants</Text>
                  <Chips<AnnouncementKind> value={ann.kind} onChange={(k: AnnouncementKind) => setAnn((a) => ({ ...a, kind: k }))}
                    options={[{ key: 'UPDATE', label: 'Update' }, { key: 'VENUE_CHANGE', label: 'Venue change' }, { key: 'SCHEDULE_CHANGE', label: 'Schedule change' }]} />
                  <View style={{ height: 10 }} />
                  <Field label="Title" value={ann.title} maxLength={120} onChangeText={(v) => setAnn((a) => ({ ...a, title: v }))} />
                  <Field label="Message" value={ann.body} maxLength={1500} multiline onChangeText={(v) => setAnn((a) => ({ ...a, body: v }))} hint="Up to 5 updates per day. Registrants get a notification." />
                  <Btn label="Send update" loading={busy === 'ann'} disabled={ann.title.trim().length < 3 || ann.body.trim().length < 3}
                    onPress={() => run('ann', () => campusEventsApi.orgAnnounce(id, { title: ann.title.trim(), body: ann.body.trim(), kind: ann.kind }), () => { setAnn({ title: '', body: '', kind: 'UPDATE' }); Alert.alert('Sent', 'Registrants were notified.'); })} />
                </Card>
              ) : <Notice icon="information-circle-outline">Updates can be sent once the event is published.</Notice>}
              {!news ? <StateView kind="loading" /> : news.map((a) => (
                <Card key={a.id}>
                  <Text style={{ fontWeight: '900', color: p.text }}>{a.title}</Text>
                  <Text style={{ color: p.sub, fontSize: 12.5, marginTop: 4 }}>{a.body}</Text>
                  <Text style={{ color: p.muted, fontSize: 10.5, marginTop: 6 }}>{fmtWhen(a.createdAt)}</Text>
                </Card>
              ))}
            </>
          ) : null}

          {tab === 'staff' ? (
            <>
              <Notice icon="shield-checkmark-outline">Check-in staff can validate tickets and admit attendees for this event only. They see first name + initial, team, ticket code and slot. Never phones or payments.</Notice>
              {!staff ? <StateView kind="loading" /> : !staff.length ? <Text style={{ color: p.sub, textAlign: 'center', marginVertical: 12 }}>No staff yet. You can always check in yourself.</Text> : staff.map((s) => (
                <Card key={s.id} style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={{ flex: 1, fontWeight: '800', color: p.text }}>{s.name}</Text>
                  <Btn label="Revoke" small kind="secondary" loading={busy === `rs-${s.id}`} onPress={() => run(`rs-${s.id}`, () => campusEventsApi.orgRevokeStaff(id, s.id))} />
                </Card>
              ))}
              <Btn label="Add check-in staff" icon="add" onPress={() => setPicker(true)} style={{ marginTop: 6 }} />
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      <PeoplePicker visible={picker} title="Add check-in staff" actionLabel="Add" onClose={() => setPicker(false)} busyId={busy?.startsWith('st-') ? busy.slice(3) : null}
        onPick={(person) => run(`st-${person.userId}`, () => campusEventsApi.orgAddStaff(id, person.userId), () => { setPicker(false); Alert.alert('Staff added', `${person.name} can now check in attendees.`); })} />

      <Modal visible={!!reject} transparent animationType="fade" onRequestClose={() => setReject(null)}>
        <KeyboardAvoidingView style={{ flex: 1 }}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 }}>
            <View style={{ backgroundColor: p.bg, borderRadius: 20, padding: 18 }}>
              <Text style={{ fontSize: 17, fontWeight: '900', color: p.text, marginBottom: 8 }}>{reject?.reg.id === '__event__' ? 'Cancel this event' : `Reject ${reject?.reg.name || ''}`}</Text>
              <Text style={{ color: p.sub, fontSize: 12.5, marginBottom: 10 }}>{reject?.reg.id === '__event__' ? 'Everyone registered is notified; tickets are voided and refunds follow the policy.' : 'The student sees this reason.'}</Text>
              <TextInput value={reject?.reason || ''} onChangeText={(v) => setReject((r) => (r ? { ...r, reason: v } : r))} multiline maxLength={500} placeholder="Reason" placeholderTextColor={p.muted} accessibilityLabel="Reason"
                style={{ minHeight: 90, borderRadius: 12, borderWidth: 1, borderColor: p.inputBorder, backgroundColor: p.input, color: p.text, padding: 12, textAlignVertical: 'top' }} />
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
                <Btn label="Back" kind="secondary" onPress={() => setReject(null)} style={{ flex: 1 }} />
                <Btn label={reject?.reg.id === '__event__' ? 'Cancel event' : 'Reject'} kind="danger" style={{ flex: 1 }} disabled={(reject?.reason.trim().length || 0) < 3}
                  onPress={() => {
                    const r = reject!;
                    setReject(null);
                    if (r.reg.id === '__event__') run('cancel', () => campusEventsApi.orgCancel(id, r.reason.trim()));
                    else run(`rj-${r.reg.id}`, () => campusEventsApi.orgReject(id, r.reg.id, r.reason.trim()));
                  }} />
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}
