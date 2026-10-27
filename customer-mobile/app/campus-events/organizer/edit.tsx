// Zenvy Campus Events: organizer create / edit form (?id= edits). Draft fields (plan §B): poster + gallery upload
// (purpose event_poster, public), title, category, description, venue + directions, schedule, registration window,
// format (individual / slot booking / team) with capacity, team settings and per-student limits, pricing FREE / PAID
// with extra charges and payment modes, eligibility, rules, organizer questions, equipment, contact, instructions,
// cancellation policy, entry window, waitlist + approval. Saves as a DRAFT; on a live event only changed fields are
// sent (cosmetic ones apply at once, material ones go to admin review). Slots are managed on the event page.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, Alert, TouchableOpacity, ActivityIndicator, BackHandler } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { KeyboardAvoidingView } from '../../../components/KeyboardAvoidingView';
import SafeImage from '../../../components/SafeImage';
import { pickAndUploadImage, alertUploadError } from '../../../utils/imageUpload';
import {
  campusEventsApi, CampusEventsError, errorCopy, CATEGORIES, CATEGORY_META, QUESTION_TYPE_LABEL, istDate, istYmd, dayLabel, fmtClock, EVENT_STATUS_META,
  type Category, type EventFormat, type EventInput, type OrganizerEvent, type PaymentMode, type QuestionType, type OrganizerMe,
} from '../../../modules/campusEvents/campusEventsApi';
import { EHeader, usePalette, Card, Btn, Field, Chips, Toggle, ErrorState, StateView, Notice, SectionTitle, Pill, useCampusEventsStatus } from '../../../modules/campusEvents/ui';

type When = { date: string; time: string };
type QDraft = { id: string; label: string; type: QuestionType; required: boolean; options: string; maxLength: string };
interface Form {
  posterPath: string | null; posterPreview: string | null; gallery: { path: string; preview: string }[];
  title: string; category: Category; description: string; tags: string;
  venue: string; venueDirections: string; start: When; end: When;
  regOpens: When | null; regCloses: When | null;
  format: EventFormat; capacity: string; maxTeams: string; teamMin: string; teamMax: string;
  captainRequired: boolean; allowSubstitutions: boolean; multiTeamAllowed: boolean; attendancePerMember: boolean;
  approvalRequired: boolean; waitlistEnabled: boolean; maxBookingsPerStudent: string; minParticipants: string;
  priceType: 'FREE' | 'PAID'; price: string; extraCharges: { label: string; amount: string }[]; paymentModes: PaymentMode[];
  years: number[]; branches: string; adultOnly: boolean;
  rules: string; questions: QDraft[]; equipment: string; contactText: string; instructions: string;
  cancelHours: string; refundPct: string; cancelText: string; entryOpensBeforeMin: string; entityId: string | null;
}

const IST = 330 * 60 * 1000;
const toWhen = (iso?: string | null): When | null => {
  if (!iso) return null;
  const d = new Date(new Date(iso).getTime() + IST);
  return { date: istYmd(iso), time: `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}` };
};
const toIso = (w: When | null) => (w ? new Date(`${w.date}T${w.time}:00+05:30`).toISOString() : null);
const n = (s: string) => (s.trim() === '' ? null : Number(s));
const TIMES: string[] = (() => { const o: string[] = []; for (let h = 6; h < 24; h++) for (const m of [0, 30]) o.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`); return o; })();

const blank = (): Form => ({
  posterPath: null, posterPreview: null, gallery: [], title: '', category: 'WORKSHOP', description: '', tags: '', venue: '', venueDirections: '',
  start: { date: istDate(7), time: '10:00' }, end: { date: istDate(7), time: '12:00' }, regOpens: null, regCloses: null,
  format: 'INDIVIDUAL', capacity: '50', maxTeams: '8', teamMin: '2', teamMax: '5', captainRequired: true, allowSubstitutions: false, multiTeamAllowed: false, attendancePerMember: false,
  approvalRequired: false, waitlistEnabled: true, maxBookingsPerStudent: '1', minParticipants: '',
  priceType: 'FREE', price: '', extraCharges: [], paymentModes: ['VENUE'], years: [], branches: '', adultOnly: false,
  rules: '', questions: [], equipment: '', contactText: '', instructions: '', cancelHours: '24', refundPct: '100', cancelText: '', entryOpensBeforeMin: '60', entityId: null,
});

const fromEvent = (e: OrganizerEvent): Form => ({
  posterPath: e.posterPath || null, posterPreview: e.posterUrl, gallery: (e.galleryPaths || []).map((g, i) => ({ path: g, preview: e.gallery[i] || g })),
  title: e.title || '', category: e.category, description: e.description || '', tags: (e.tags || []).join(', '), venue: e.venue || '', venueDirections: e.venueDirections || '',
  start: toWhen(e.startAt) || blank().start, end: toWhen(e.endAt) || blank().end, regOpens: toWhen(e.regOpensAt), regCloses: toWhen(e.regClosesAt),
  format: e.format, capacity: e.capacityRaw != null ? String(e.capacityRaw) : '', maxTeams: e.team?.maxTeams != null ? String(e.team.maxTeams) : '', teamMin: e.team?.min != null ? String(e.team.min) : '', teamMax: e.team?.max != null ? String(e.team.max) : '',
  captainRequired: e.team ? e.team.captainRequired : true, allowSubstitutions: !!e.team?.allowSubstitutions, multiTeamAllowed: !!e.team?.multiTeamAllowed, attendancePerMember: !!e.team?.attendancePerMember,
  approvalRequired: e.approvalRequired, waitlistEnabled: e.waitlistEnabled, maxBookingsPerStudent: String(e.maxBookingsPerStudent || 1), minParticipants: '',
  priceType: e.price.priceType, price: e.rawPrice ? String(e.rawPrice) : '', extraCharges: (e.price.extraCharges || []).map((c) => ({ label: c.label, amount: String(c.amount) })),
  paymentModes: e.paymentModesConfigured?.length ? e.paymentModesConfigured : ['VENUE'],
  years: e.eligibility?.years || [], branches: (e.eligibility?.branches || []).join(', '), adultOnly: !!e.eligibility?.adultOnly,
  rules: e.rules || '', questions: (e.questions || []).map((q) => ({ id: q.id, label: q.label, type: q.type, required: q.required, options: (q.options || []).join(', '), maxLength: q.maxLength ? String(q.maxLength) : '' })),
  equipment: e.equipment || '', contactText: e.contactText || '', instructions: e.instructions || '',
  cancelHours: e.cancellationPolicy?.userCancelUntilHours != null ? String(e.cancellationPolicy.userCancelUntilHours) : '', refundPct: e.cancellationPolicy?.refundPct != null ? String(e.cancellationPolicy.refundPct) : '',
  cancelText: e.cancellationPolicy?.text || '', entryOpensBeforeMin: String(e.entryOpensBeforeMin ?? 60), entityId: e.organizer?.club?.id || null,
});

/** Form -> API body (every field; the edit path sends only what changed). */
const toBody = (f: Form): EventInput => ({
  title: f.title.trim(), category: f.category, description: f.description.trim(), tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean),
  venue: f.venue.trim(), venueDirections: f.venueDirections.trim(), startAt: toIso(f.start)!, endAt: toIso(f.end)!, regOpensAt: toIso(f.regOpens), regClosesAt: toIso(f.regCloses),
  format: f.format,
  ...(f.format === 'INDIVIDUAL' ? { capacity: n(f.capacity) } : {}),
  ...(f.format === 'TEAM' ? { maxTeams: n(f.maxTeams), teamMin: n(f.teamMin), teamMax: n(f.teamMax), captainRequired: f.captainRequired, allowSubstitutions: f.allowSubstitutions, multiTeamAllowed: f.multiTeamAllowed, attendancePerMember: f.attendancePerMember } : {}),
  ...(f.format === 'SLOT' ? { maxBookingsPerStudent: n(f.maxBookingsPerStudent) || 1 } : {}),
  approvalRequired: f.approvalRequired, waitlistEnabled: f.waitlistEnabled,
  priceType: f.priceType, price: f.priceType === 'PAID' ? Number(f.price) || 0 : 0,
  extraCharges: f.priceType === 'PAID' ? f.extraCharges.filter((c) => c.label.trim() || c.amount.trim()).map((c) => ({ label: c.label.trim(), amount: Number(c.amount) || 0 })) : [],
  ...(f.priceType === 'PAID' ? { paymentModes: f.paymentModes } : {}),
  eligibility: { years: f.years, branches: f.branches.split(',').map((b) => b.trim().toUpperCase()).filter(Boolean), adultOnly: f.adultOnly },
  rules: f.rules.trim(),
  questions: f.questions.filter((q) => q.label.trim()).map((q) => ({
    id: q.id, label: q.label.trim(), type: q.type, required: q.required,
    ...(q.type === 'CHOICE' || q.type === 'MULTI_CHOICE' ? { options: q.options.split(',').map((o) => o.trim()).filter(Boolean) } : {}),
    ...((q.type === 'TEXT' || q.type === 'LONG_TEXT') && q.maxLength.trim() ? { maxLength: Number(q.maxLength) } : {}),
  })),
  equipment: f.equipment.trim(), contactText: f.contactText.trim(), instructions: f.instructions.trim(),
  cancellationPolicy: { userCancelUntilHours: n(f.cancelHours), refundPct: n(f.refundPct), text: f.cancelText.trim() },
  entryOpensBeforeMin: n(f.entryOpensBeforeMin) ?? 60,
  posterPath: f.posterPath, gallery: f.gallery.map((g) => g.path),
});
const diff = (a: EventInput, b: EventInput): EventInput => {
  const out: any = {};
  for (const k of Object.keys(b) as (keyof EventInput)[]) if (JSON.stringify((a as any)[k] ?? null) !== JSON.stringify((b as any)[k] ?? null)) out[k] = (b as any)[k];
  return out;
};

export default function OrganizerEventForm() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = params.id ? String(params.id) : '';
  const router = useRouter();
  const p = usePalette();
  const [form, setForm] = useState<Form | null>(id ? null : blank());
  const [initial, setInitial] = useState<EventInput | null>(null);
  const [ev, setEv] = useState<OrganizerEvent | null>(null);
  const [me, setMe] = useState<OrganizerMe | null>(null);
  const [error, setError] = useState<CampusEventsError | null>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<'poster' | 'gallery' | null>(null);
  // Online pay is offered to organizers only while the server switch is on (off in production for now).
  const onlinePayOn = !!useCampusEventsStatus()?.onlinePayEnabled;
  const dirty = useRef(false);

  const load = useCallback(async () => {
    try {
      const m = await campusEventsApi.organizerMe();
      setMe(m);
      if (id) {
        const r = await campusEventsApi.orgEvent(id);
        const f = fromEvent(r.event);
        setEv(r.event);
        setForm(f);
        setInitial(toBody(f));
      }
      setError(null);
    } catch (e: any) {
      setError(e instanceof CampusEventsError ? e : new CampusEventsError(e?.message || 'Could not load.'));
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => { dirty.current = true; setForm((f) => (f ? { ...f, [k]: v } : f)); setErrs((e) => ({ ...e, [k]: '' })); };

  const leave = useCallback(() => {
    if (!dirty.current) { router.back(); return; }
    Alert.alert('Discard changes?', 'Your unsaved changes will be lost.', [{ text: 'Keep editing', style: 'cancel' }, { text: 'Discard', style: 'destructive', onPress: () => router.back() }]);
  }, [router]);
  useFocusEffect(useCallback(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { leave(); return true; });
    return () => sub.remove();
  }, [leave]));

  const upload = async (kind: 'poster' | 'gallery') => {
    setUploading(kind);
    try {
      const up = await pickAndUploadImage('event_poster', { maxEdge: 1600 });
      if (!up) return;
      if (kind === 'poster') { set('posterPath', up.url); set('posterPreview', up.localUri || up.absoluteUrl); }
      else setForm((f) => (f ? { ...f, gallery: [...f.gallery, { path: up.url, preview: up.localUri || up.absoluteUrl }].slice(0, 6) } : f));
      dirty.current = true;
    } catch (e) {
      alertUploadError(e, () => upload(kind));
    } finally {
      setUploading(null);
    }
  };

  const save = async () => {
    if (!form) return;
    const e: Record<string, string> = {};
    if (form.title.trim().length < 3) e.title = 'Give the event a title (3+ characters).';
    if (toIso(form.end)! <= toIso(form.start)!) e.end = 'The event must end after it starts.';
    if (form.regOpens && form.regCloses && toIso(form.regCloses)! <= toIso(form.regOpens)!) e.regCloses = 'Registration must close after it opens.';
    if (form.format === 'TEAM' && Number(form.teamMin) > Number(form.teamMax)) e.teamMin = 'Minimum cannot be more than maximum.';
    if (form.priceType === 'PAID' && !(Number(form.price) > 0)) e.price = 'Enter a price above ₹0, or make it free.';
    if (form.priceType === 'PAID' && !form.paymentModes.length) e.paymentModes = 'Choose at least one way to pay.';
    form.questions.forEach((q, i) => { if ((q.type === 'CHOICE' || q.type === 'MULTI_CHOICE') && q.options.split(',').filter((x) => x.trim()).length < 2) e[`q${i}`] = 'Add at least 2 options, separated by commas.'; });
    setErrs(e);
    if (Object.values(e).some(Boolean)) { Alert.alert('Check the form', Object.values(e).filter(Boolean)[0]); return; }
    const body = toBody(form);
    setBusy(true);
    try {
      if (!id) {
        const r = await campusEventsApi.orgCreate({ ...body, entityId: form.entityId });
        dirty.current = false;
        router.replace(`/campus-events/organizer/${r.event.id}?created=1` as any);
      } else {
        const changes = initial ? diff(initial, body) : body;
        if (!Object.keys(changes).length) { dirty.current = false; router.back(); return; }
        const r = await campusEventsApi.orgUpdate(id, changes);
        dirty.current = false;
        if (r.pendingReview.length) Alert.alert('Sent for review', 'These changes affect registrants, so the ZCS team reviews them before they go live. Other edits are live now.', [{ text: 'OK', onPress: () => router.back() }]);
        else router.back();
      }
    } catch (err: any) {
      const f = (err as CampusEventsError)?.field;
      if (f) {
        const key = f.startsWith('questions[') ? `q${f.slice(10, -1)}` : f === 'startAt' ? 'start' : f === 'endAt' ? 'end' : f === 'regClosesAt' ? 'regCloses' : f.startsWith('cancellationPolicy') ? 'cancelHours' : f;
        setErrs((x) => ({ ...x, [key]: err.message }));
      }
      const c = errorCopy(err);
      Alert.alert(c.title, c.message);
    } finally {
      setBusy(false);
    }
  };

  if (!form || !me) {
    return (
      <View style={{ flex: 1, backgroundColor: p.bg }}>
        <EHeader title={id ? 'Edit event' : 'New event'} />
        {error ? <ErrorState error={error} onRetry={load} onNotFound={() => router.back()} /> : <StateView kind="loading" />}
      </View>
    );
  }
  if (me.organizer?.status !== 'ACTIVE') {
    return (
      <View style={{ flex: 1, backgroundColor: p.bg }}>
        <EHeader title="New event" />
        <StateView kind="empty" icon="megaphone-outline" title="Organizers only" message="Apply as an organizer first. The ZCS team approves verified clubs and student organizers." actionLabel="Apply" onAction={() => router.replace('/campus-events/organizer' as any)} />
      </View>
    );
  }
  const live = !!ev && ['APPROVED', 'PUBLISHED', 'UNPUBLISHED'].includes(ev.status);
  const locked = !!ev && ['SUBMITTED', 'CANCELLED', 'COMPLETED'].includes(ev.status);

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <EHeader title={id ? 'Edit event' : 'New event'} subtitle={ev ? EVENT_STATUS_META[ev.status].label : 'Saved as a draft'} onBack={leave} />
      <KeyboardAvoidingView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
          {locked ? <Notice tone="warn" icon="lock-closed-outline">{ev?.status === 'SUBMITTED' ? 'This event is in review. Withdraw it from the event page to edit.' : 'This event can no longer be edited.'}</Notice> : null}
          {live ? <Notice icon="information-circle-outline">The event is live. Poster, description, equipment, contact and instructions update at once; other changes go to the ZCS team for review first.</Notice> : null}

          <SectionTitle kicker="Step 1">Poster & basics</SectionTitle>
          <TouchableOpacity onPress={() => upload('poster')} disabled={!!uploading} accessibilityRole="button" accessibilityLabel={form.posterPath ? 'Change poster' : 'Upload poster'}
            style={{ height: 180, borderRadius: 18, borderWidth: 1.5, borderStyle: 'dashed', borderColor: p.accent, backgroundColor: p.accentSoft, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>
            {uploading === 'poster' ? <ActivityIndicator color={p.accent} /> : form.posterPreview ? (
              <SafeImage source={{ uri: form.posterPreview }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
            ) : <><Ionicons name="image-outline" size={34} color={p.accent} /><Text style={{ color: p.accent, fontWeight: '900', marginTop: 6 }}>Upload poster</Text><Text style={{ color: p.sub, fontSize: 12 }}>Portrait or landscape, clear text</Text></>}
          </TouchableOpacity>
          {form.posterPath ? <Btn label="Remove poster" small kind="ghost" onPress={() => { set('posterPath', null); set('posterPreview', null); }} style={{ alignSelf: 'flex-start', marginBottom: 8 }} /> : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
            {form.gallery.map((g, i) => (
              <TouchableOpacity key={`${g.path}-${i}`} onPress={() => setForm((f) => (f ? { ...f, gallery: f.gallery.filter((_, j) => j !== i) } : f))} accessibilityRole="button" accessibilityLabel={`Remove gallery image ${i + 1}`}>
                <SafeImage source={{ uri: g.preview }} style={{ width: 72, height: 72, borderRadius: 12 }} contentFit="cover" />
                <Ionicons name="close-circle" size={20} color="#fff" style={{ position: 'absolute', top: 2, right: 2, textShadowColor: '#000', textShadowRadius: 3 }} />
              </TouchableOpacity>
            ))}
            {form.gallery.length < 6 ? (
              <TouchableOpacity onPress={() => upload('gallery')} disabled={!!uploading} accessibilityRole="button" accessibilityLabel="Add gallery image"
                style={{ width: 72, height: 72, borderRadius: 12, borderWidth: 1, borderColor: p.border, backgroundColor: p.card2, alignItems: 'center', justifyContent: 'center' }}>
                {uploading === 'gallery' ? <ActivityIndicator color={p.accent} /> : <Ionicons name="add" size={24} color={p.sub} />}
              </TouchableOpacity>
            ) : null}
          </View>
          <Field label="Title" required value={form.title} onChangeText={(v) => set('title', v)} maxLength={120} error={errs.title} placeholder="e.g. Drone Soccer League – Practice" />
          <Text style={labelStyle(p)}>Category</Text>
          <Chips<Category> value={form.category} onChange={(v: Category) => set('category', v)} options={CATEGORIES.map((c) => ({ key: c, label: CATEGORY_META[c].label }))} />
          <View style={{ height: 14 }} />
          <Field label="Description" required value={form.description} onChangeText={(v) => set('description', v)} multiline maxLength={5000} error={errs.description} placeholder="What happens, who it is for, what students get" />
          <Field label="Tags (comma separated)" value={form.tags} onChangeText={(v) => set('tags', v)} maxLength={200} placeholder="robotics, beginners" />
          {me.managedClubs.length && !id ? (
            <>
              <Text style={labelStyle(p)}>Publish as club</Text>
              <Chips value={form.entityId || 'none'} onChange={(v: string) => set('entityId', v === 'none' ? null : v)} options={[{ key: 'none', label: me.organizer?.displayName || 'Me' }, ...me.managedClubs.map((c) => ({ key: c.id, label: c.name }))]} />
              <View style={{ height: 14 }} />
            </>
          ) : null}

          <SectionTitle kicker="Step 2">Where & when</SectionTitle>
          <Field label="Venue" required value={form.venue} onChangeText={(v) => set('venue', v)} maxLength={160} error={errs.venue} placeholder="e.g. Main Ground, Block A Lab 204" />
          <Field label="Directions (optional)" value={form.venueDirections} onChangeText={(v) => set('venueDirections', v)} multiline maxLength={500} placeholder="Landmarks, gate number" />
          <WhenPick label="Starts" value={form.start} onChange={(v) => { set('start', v); if (form.end.date < v.date) set('end', { ...form.end, date: v.date }); }} error={errs.start} />
          <WhenPick label="Ends" value={form.end} onChange={(v) => set('end', v)} error={errs.end} />
          <Toggle label="Registration opens later" hint="Off: opens as soon as the event is published" value={!!form.regOpens} onChange={(on) => set('regOpens', on ? { date: istDate(1), time: '09:00' } : null)} />
          {form.regOpens ? <WhenPick label="Registration opens" value={form.regOpens} onChange={(v) => set('regOpens', v)} /> : null}
          <Toggle label="Registration deadline" hint="Off: open until the event starts" value={!!form.regCloses} onChange={(on) => set('regCloses', on ? { date: form.start.date, time: '08:00' } : null)} />
          {form.regCloses ? <WhenPick label="Registration closes" value={form.regCloses} onChange={(v) => set('regCloses', v)} error={errs.regCloses} /> : null}

          <SectionTitle kicker="Step 3">Format & capacity</SectionTitle>
          <Chips<EventFormat> value={form.format} onChange={(v: EventFormat) => set('format', v)}
            options={[{ key: 'INDIVIDUAL', label: 'Individual', hint: 'Workshops, talks' }, { key: 'SLOT', label: 'Slot booking', hint: 'Practice, facilities' }, { key: 'TEAM', label: 'Team', hint: 'Tournaments' }]} />
          <View style={{ height: 14 }} />
          {form.format === 'INDIVIDUAL' ? <Field label="Capacity (seats)" required value={form.capacity} onChangeText={(v) => set('capacity', v.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={5} error={errs.capacity} /> : null}
          {form.format === 'SLOT' ? (
            <>
              <Field label="Max bookings per student" value={form.maxBookingsPerStudent} onChangeText={(v) => set('maxBookingsPerStudent', v.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={2} error={errs.maxBookingsPerStudent} />
              <Notice icon="calendar-outline">{id ? 'Add and edit time slots (capacity and price per slot) on the event page.' : 'After saving the draft, add the time slots on the event page.'}</Notice>
            </>
          ) : null}
          {form.format === 'TEAM' ? (
            <>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Field style={{ flex: 1 }} label="Teams" required value={form.maxTeams} onChangeText={(v) => set('maxTeams', v.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={4} error={errs.maxTeams} />
                <Field style={{ flex: 1 }} label="Min players" required value={form.teamMin} onChangeText={(v) => set('teamMin', v.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={2} error={errs.teamMin} />
                <Field style={{ flex: 1 }} label="Max players" required value={form.teamMax} onChangeText={(v) => set('teamMax', v.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={2} error={errs.teamMax} />
              </View>
              <Toggle label="Captain required" value={form.captainRequired} onChange={(v) => set('captainRequired', v)} />
              <Toggle label="Allow substitutions after registering" value={form.allowSubstitutions} onChange={(v) => set('allowSubstitutions', v)} />
              <Toggle label="A student may join more than one team" value={form.multiTeamAllowed} onChange={(v) => set('multiTeamAllowed', v)} />
              <Toggle label="Check in each player separately" hint="Issues a ticket per player instead of one team ticket" value={form.attendancePerMember} onChange={(v) => set('attendancePerMember', v)} />
            </>
          ) : null}
          <Toggle label="I approve each registration" hint="Registrations wait for your approval before a ticket is issued" value={form.approvalRequired} onChange={(v) => set('approvalRequired', v)} />
          <Toggle label="Waitlist when full" value={form.waitlistEnabled} onChange={(v) => set('waitlistEnabled', v)} />

          <SectionTitle kicker="Step 4">Pricing</SectionTitle>
          <Chips value={form.priceType} onChange={(v: 'FREE' | 'PAID') => set('priceType', v)} options={[{ key: 'FREE', label: 'Free' }, { key: 'PAID', label: 'Paid' }]} />
          <View style={{ height: 14 }} />
          {form.priceType === 'PAID' ? (
            <>
              <Field label={form.format === 'TEAM' ? 'Team fee (₹)' : 'Fee (₹)'} required value={form.price} onChangeText={(v) => set('price', v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" maxLength={7} error={errs.price} />
              {form.extraCharges.map((c, i) => (
                <View key={i} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
                  <Field style={{ flex: 2 }} label={`Extra charge ${i + 1}`} value={c.label} maxLength={60} placeholder="e.g. Kit" onChangeText={(v) => set('extraCharges', form.extraCharges.map((x, j) => (j === i ? { ...x, label: v } : x)))} />
                  <Field style={{ flex: 1 }} label="₹" value={c.amount} keyboardType="decimal-pad" maxLength={6} onChangeText={(v) => set('extraCharges', form.extraCharges.map((x, j) => (j === i ? { ...x, amount: v.replace(/[^0-9.]/g, '') } : x)))} />
                  <TouchableOpacity onPress={() => set('extraCharges', form.extraCharges.filter((_, j) => j !== i))} accessibilityRole="button" accessibilityLabel={`Remove extra charge ${i + 1}`} style={{ width: 44, height: 44, marginTop: 22, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="close" size={20} color={p.danger} />
                  </TouchableOpacity>
                </View>
              ))}
              {form.extraCharges.length < 5 ? <Btn label="Add extra charge" small kind="ghost" onPress={() => set('extraCharges', [...form.extraCharges, { label: '', amount: '' }])} style={{ alignSelf: 'flex-start', marginBottom: 12 }} /> : null}
              <Text style={labelStyle(p)}>How students pay</Text>
              <Chips<PaymentMode> multi value={form.paymentModes} onChange={(v: PaymentMode[]) => set('paymentModes', v)}
                options={[
                  { key: 'VENUE', label: 'Pay at venue', hint: 'Collected at entry' },
                  { key: 'WALLET', label: 'ZCS Wallet', hint: 'Only when ZCS enables it' },
                  // Online shows only while the server switch is on; an older event that already has it keeps the chip so it can be removed.
                  ...(onlinePayOn ? [{ key: 'ONLINE' as PaymentMode, label: 'Pay online', hint: 'UPI / card by Razorpay' }]
                    : form.paymentModes.includes('ONLINE') ? [{ key: 'ONLINE' as PaymentMode, label: 'Pay online', hint: 'Not available yet. Tap to remove' }] : []),
                ]} />
              {errs.paymentModes ? <Text style={{ color: p.danger, fontSize: 12, marginTop: 4 }}>{errs.paymentModes}</Text> : null}
              <View style={{ height: 14 }} />
            </>
          ) : null}

          <SectionTitle kicker="Step 5">Who can join</SectionTitle>
          <Text style={labelStyle(p)}>Years (leave empty for all)</Text>
          <Chips multi value={form.years.map(String)} onChange={(v: string[]) => set('years', v.map(Number).sort())} options={[1, 2, 3, 4, 5].map((y) => ({ key: String(y), label: `Year ${y}` }))} />
          <View style={{ height: 14 }} />
          <Field label="Branches (comma separated, empty = all)" value={form.branches} onChangeText={(v) => set('branches', v)} autoCapitalize="characters" maxLength={200} placeholder="CSE, ECE" />
          <Toggle label="18+ only" value={form.adultOnly} onChange={(v) => set('adultOnly', v)} />

          <SectionTitle kicker="Step 6">Rules & questions</SectionTitle>
          <Field label="Rules" value={form.rules} onChangeText={(v) => set('rules', v)} multiline maxLength={5000} placeholder="Students must accept these to register" />
          {form.questions.map((q, i) => (
            <Card key={q.id}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                <Text style={{ flex: 1, fontWeight: '900', color: p.text }}>Question {i + 1}</Text>
                <TouchableOpacity onPress={() => set('questions', form.questions.filter((_, j) => j !== i))} accessibilityRole="button" accessibilityLabel={`Delete question ${i + 1}`} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: p.danger, fontWeight: '900' }}>Delete</Text>
                </TouchableOpacity>
              </View>
              <Field label="Question" value={q.label} maxLength={200} error={errs[`q${i}`]} onChangeText={(v) => set('questions', form.questions.map((x, j) => (j === i ? { ...x, label: v } : x)))} hint="Never ask for phone numbers, ID or bank details." />
              <Chips<QuestionType> value={q.type} onChange={(v: QuestionType) => set('questions', form.questions.map((x, j) => (j === i ? { ...x, type: v } : x)))}
                options={(Object.keys(QUESTION_TYPE_LABEL) as QuestionType[]).map((t) => ({ key: t, label: QUESTION_TYPE_LABEL[t] }))} />
              <View style={{ height: 10 }} />
              {q.type === 'CHOICE' || q.type === 'MULTI_CHOICE' ? <Field label="Options (comma separated)" value={q.options} maxLength={600} onChangeText={(v) => set('questions', form.questions.map((x, j) => (j === i ? { ...x, options: v } : x)))} placeholder="S, M, L" /> : null}
              {q.type === 'TEXT' || q.type === 'LONG_TEXT' ? <Field label="Max characters (optional)" value={q.maxLength} keyboardType="number-pad" maxLength={4} onChangeText={(v) => set('questions', form.questions.map((x, j) => (j === i ? { ...x, maxLength: v.replace(/\D/g, '') } : x)))} /> : null}
              <Toggle label="Required" value={q.required} onChange={(v) => set('questions', form.questions.map((x, j) => (j === i ? { ...x, required: v } : x)))} />
            </Card>
          ))}
          {form.questions.length < 10 ? <Btn label="Add a question" small kind="ghost" onPress={() => set('questions', [...form.questions, { id: `q${Date.now().toString(36)}`, label: '', type: 'TEXT', required: true, options: '', maxLength: '' }])} style={{ alignSelf: 'flex-start', marginBottom: 12 }} /> : null}

          <SectionTitle kicker="Step 7">Details for attendees</SectionTitle>
          <Field label="What to bring" value={form.equipment} onChangeText={(v) => set('equipment', v)} multiline maxLength={1000} />
          <Field label="Entry instructions" value={form.instructions} onChangeText={(v) => set('instructions', v)} multiline maxLength={1000} placeholder="Shown on the ticket" />
          <Field label="Contact (club email / desk)" value={form.contactText} onChangeText={(v) => set('contactText', v)} maxLength={300} hint="Shown to students. Avoid personal phone numbers." />
          <Field label="Entry opens (minutes before start)" value={form.entryOpensBeforeMin} onChangeText={(v) => set('entryOpensBeforeMin', v.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={4} />

          <SectionTitle kicker="Step 8">Cancellation policy</SectionTitle>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Field style={{ flex: 1 }} label="Cancel until (hours before)" value={form.cancelHours} onChangeText={(v) => set('cancelHours', v.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={3} error={errs.cancelHours} />
            {form.priceType === 'PAID' ? <Field style={{ flex: 1 }} label="Refund %" value={form.refundPct} onChangeText={(v) => set('refundPct', v.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={3} /> : null}
          </View>
          <Field label="Policy note (optional)" value={form.cancelText} onChangeText={(v) => set('cancelText', v)} multiline maxLength={500} />

          <Btn label={id ? 'Save changes' : 'Save draft'} onPress={save} loading={busy} disabled={locked} style={{ marginTop: 8 }} />
          {!id ? <Text style={{ color: p.sub, fontSize: 12, textAlign: 'center', marginTop: 8 }}>Drafts are private. Submit for review from the event page when ready.</Text> : null}
          {ev?.pendingChanges ? <View style={{ marginTop: 12 }}><Pill label="Earlier edits are waiting for review" color="#D97706" /></View> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const labelStyle = (p: ReturnType<typeof usePalette>) => ({ fontSize: 12, fontWeight: '800' as const, letterSpacing: 0.2, marginBottom: 6, color: p.sub });

/** Date chips (next 120 days, IST) + time chips (30-minute steps). */
function WhenPick({ label, value, onChange, error }: { label: string; value: When; onChange: (v: When) => void; error?: string }) {
  const p = usePalette();
  const dates = useMemo(() => {
    const list = Array.from({ length: 120 }, (_, i) => istDate(i));
    return list.includes(value.date) ? list : [value.date, ...list];
  }, [value.date]);
  const times = TIMES.includes(value.time) ? TIMES : [value.time, ...TIMES];
  const dRef = useRef<ScrollView>(null);
  const tRef = useRef<ScrollView>(null);
  useEffect(() => {
    const di = dates.indexOf(value.date);
    const ti = times.indexOf(value.time);
    setTimeout(() => { dRef.current?.scrollTo({ x: Math.max(0, di * 104 - 60), animated: false }); tRef.current?.scrollTo({ x: Math.max(0, ti * 82 - 60), animated: false }); }, 60);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={labelStyle(p)}>{label} · {dayLabel(value.date)} {fmtClock(new Date(`${value.date}T${value.time}:00+05:30`).toISOString())}</Text>
      <ScrollView ref={dRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 16 }}>
        {dates.map((d) => {
          const on = d === value.date;
          return (
            <TouchableOpacity key={d} onPress={() => onChange({ ...value, date: d })} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={`${label} date ${dayLabel(d)}`}
              style={{ width: 96, minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: on ? p.accent : p.border, backgroundColor: on ? p.accent : p.card2, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 12, fontWeight: '900', color: on ? '#fff' : p.text }}>{dayLabel(d)}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
      <ScrollView ref={tRef} horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }} contentContainerStyle={{ gap: 6, paddingRight: 16 }}>
        {times.map((t) => {
          const on = t === value.time;
          return (
            <TouchableOpacity key={t} onPress={() => onChange({ ...value, time: t })} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={`${label} time ${fmtClock(new Date(`2026-01-01T${t}:00+05:30`).toISOString())}`}
              style={{ width: 76, minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: on ? p.accent : p.border, backgroundColor: on ? p.accentSoft : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 12, fontWeight: '800', color: on ? p.accent : p.sub }}>{fmtClock(new Date(`2026-01-01T${t}:00+05:30`).toISOString())}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
      {error ? <Text style={{ color: p.danger, fontSize: 12, marginTop: 4 }}>{error}</Text> : null}
    </View>
  );
}
