/**
 * Screen 10 · Booking request: room type picker, check-in date (today to 90 days ahead, as the server
 * allows), the rent and deposit for the chosen type, and "Send Request" (POST /api/pg/:roomId/book).
 * Duration and a note are not stored by the backend yet, so they are not asked for (follow-up).
 * Success opens the "Request sent" sheet (PgV2SentSheet); errors show inline (Alert has no buttons on web).
 */
import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Modal, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { LucideIcon } from 'lucide-react-native';
import { PG2, R, GUTTER, W, shadow } from './pgV2Theme';
import { Header, Tap, PrimaryButton, EmptyState, Loading, k } from './PgV2Kit';
import { IBed, ICalendar, IClipboard, IChevronDown, ICheck, IInfo, IAlert, IBuilding, STROKE } from './PgV2Icons';
import { usePgDetail, roomTypeName, sendBookingRequest, type SendResult } from './pgV2Data';
import { useNav, usePgIdFor } from './pgV2Nav';
import { useAuth } from '../../context/AuthContext';
import { ZENVY_SUPPORT_WHATSAPP } from '../../constants/api';
import PgV2SentSheet from './PgV2SentSheet';
import { rentText } from './pgV2Data';
import { inr, type PgRoomType } from '../../modules/pg/pgApi';
import { themedSheet } from '../../utils/themeNow';

const istYmd = (offsetDays: number) => new Date(Date.now() + 330 * 60 * 1000 + offsetDays * 86400000).toISOString().slice(0, 10);
const fmtPart = (ymd: string, o: Intl.DateTimeFormatOptions) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-IN', { ...o, timeZone: 'UTC' });
/** "25 Oct 2026". */
const shortYmd = (ymd: string) => `${fmtPart(ymd, { day: 'numeric' })} ${fmtPart(ymd, { month: 'short' })} ${fmtPart(ymd, { year: 'numeric' })}`;
/** "Sun, 25 Oct 2026" (no stray comma before the year). */
const prettyYmd = (ymd: string) => `${fmtPart(ymd, { weekday: 'short' })}, ${shortYmd(ymd)}`;
const DATES = Array.from({ length: 61 }, (_, i) => istYmd(i));
const typeLabel = (t: PgRoomType) => `${roomTypeName(t.sharingType)} · ${t.hasAC ? 'AC' : 'Non-AC'}`;

function Picker<T extends string>({ open, title, options, value, onPick, onClose }: {
  open: boolean; title: string; options: { key: T; label: string; sub?: string }[]; value: T | null; onPick: (k: T) => void; onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={st.scrim} onPress={onClose} accessibilityLabel="Close" />
      <View style={[st.sheet, { paddingBottom: insets.bottom + 12 }]}>
        <Text style={st.sheetTitle}>{title}</Text>
        <ScrollView style={{ maxHeight: 420 }}>
          {options.map((o) => {
            const on = o.key === value;
            return (
              <Tap key={o.key} onPress={() => { onPick(o.key); onClose(); }} label={o.label} selected={on} style={[st.option, on && { backgroundColor: PG2.lavender }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[st.optionText, on && { color: PG2.primary }]}>{o.label}</Text>
                  {o.sub ? <Text style={k.small}>{o.sub}</Text> : null}
                </View>
                {on ? <ICheck size={18} color={PG2.primary} strokeWidth={2} /> : null}
              </Tap>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}

function Field({ icon: Icon, label, value, placeholder, onPress }: { icon: LucideIcon; label: string; value: string | null; placeholder: string; onPress: () => void }) {
  return (
    <View style={st.field}>
      <View style={st.fieldIcon}><Icon size={20} color="#475569" strokeWidth={1.6} /></View>
      <View style={{ flex: 1 }}>
        <Text style={st.fieldLabel}>{label}</Text>
        <Tap onPress={onPress} label={`${label}: ${value || placeholder}`} style={st.select}>
          <Text style={[st.selectText, !value && { color: PG2.faint }]} numberOfLines={1}>{value || placeholder}</Text>
          <IChevronDown size={17} color={PG2.muted} strokeWidth={STROKE} />
        </Tap>
      </View>
    </View>
  );
}

/** Housing desk chat without a prefilled message (fallback when the server sends no link). */
const DESK_URL = `https://wa.me/${ZENVY_SUPPORT_WHATSAPP.replace(/\D/g, '')}`;

export default function PgV2Booking() {
  const nav = useNav();
  const id = usePgIdFor();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth() as any;
  const { pg, state } = usePgDetail(id);
  const bookable = useMemo(() => (pg?.roomTypes || []).filter((t) => t.bookRoomId && t.availableBeds > 0), [pg]);
  const [typeKey, setTypeKey] = useState<string | null>(nav.route.roomKey || null);
  const [date, setDate] = useState<string | null>(null);
  const [picker, setPicker] = useState<'type' | 'date' | null>(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  if (state === 'loading') return <View style={st.page}><Header title="Booking Request" onBack={nav.back} /><Loading /></View>;
  if (!pg) return <View style={st.page}><Header title="Booking Request" onBack={nav.back} /><EmptyState icon={IBuilding} title="This PG isn't available" action="Back" onAction={nav.back} /></View>;

  const chosen = bookable.find((t) => t.key === typeKey) || (bookable.length === 1 ? bookable[0] : null);
  const deposit = chosen?.deposit ?? (pg.securityDeposit > 0 ? pg.securityDeposit : null);

  const send = async () => {
    if (!chosen?.bookRoomId || !date || sending) return;
    if (!user) { router.push('/login' as any); return; }
    setSending(true);
    setResult(null);
    const r = await sendBookingRequest(chosen.bookRoomId, date);
    setSending(false);
    setResult(r);
    if (r.ok) setSheetOpen(true);
  };

  return (
    <View style={st.page}>
      <Header title="Booking Request" onBack={nav.back} />
      <ScrollView contentContainerStyle={{ paddingBottom: 120 + insets.bottom }}>
        <View style={st.banner}>
          <IClipboard size={24} color="#475569" strokeWidth={1.6} />
          <View style={{ flex: 1 }}>
            <Text style={st.bannerTitle}>Send a booking request{'\n'}to the PG owner</Text>
            <Text style={st.bannerSub}>{pg.name} · We'll notify you when it's confirmed.</Text>
          </View>
        </View>
        {!bookable.length ? (
          <EmptyState icon={IBed} title="No beds free right now" body="Every room type here is full. Check back soon." />
        ) : (
          <View style={{ paddingHorizontal: GUTTER, gap: 18, marginTop: 6 }}>
            <Field icon={IBed} label="Select Room Type" value={chosen ? typeLabel(chosen) : null} placeholder="Choose a room type" onPress={() => setPicker('type')} />
            <Field icon={ICalendar} label="Check-in Date" value={date ? prettyYmd(date) : null} placeholder="Select date" onPress={() => setPicker('date')} />
            {chosen ? (
              <View style={[k.card, st.summary]}>
                <View style={st.sumRow}><Text style={k.body}>Rent per bed</Text><Text style={st.sumValue}>{rentText(chosen)}/month</Text></View>
                {deposit ? <View style={st.sumRow}><Text style={k.body}>Security deposit</Text><Text style={st.sumValue}>{inr(deposit)}</Text></View> : null}
                <View style={[k.row, { gap: 8, marginTop: 4 }]}>
                  <IInfo size={14} color={PG2.muted} strokeWidth={STROKE} />
                  <Text style={[k.small, { flex: 1 }]}>No payment is taken with this request.</Text>
                </View>
              </View>
            ) : null}
            {result && !result.ok ? (
              <View style={st.error}><IAlert size={16} color={PG2.red} strokeWidth={STROKE} /><Text style={[k.body, { color: PG2.red, flex: 1 }]}>{result.message}</Text></View>
            ) : null}
          </View>
        )}
      </ScrollView>
      {bookable.length ? (
        <View style={[st.bar, { paddingBottom: insets.bottom + 14 }]}>
          <PrimaryButton label={user ? 'Send Request' : 'Sign in to send'} onPress={send} busy={sending} disabled={!chosen || !date} />
        </View>
      ) : null}
      <Picker open={picker === 'type'} title="Room type" value={chosen?.key || null} onPick={setTypeKey} onClose={() => setPicker(null)}
        options={bookable.map((t) => ({ key: t.key, label: typeLabel(t), sub: `${rentText(t)}/month · ${t.availableBeds} bed${t.availableBeds === 1 ? '' : 's'} free` }))} />
      <Picker open={picker === 'date'} title="Check-in date" value={date} onPick={setDate} onClose={() => setPicker(null)}
        options={DATES.map((d, i) => ({ key: d, label: prettyYmd(d), sub: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : undefined }))} />
      <PgV2SentSheet
        open={sheetOpen && !!result?.ok}
        info={result?.ok ? { pgName: pg.name, roomType: chosen ? roomTypeName(chosen.sharingType) : 'Room', moveIn: date ? shortYmd(date) : '', deskUrl: result.whatsappUrl || DESK_URL } : null}
        onViewBookings={() => { setSheetOpen(false); nav.push({ name: 'bookings' }); }}
        onDone={() => { setSheetOpen(false); nav.back(); }}
      />
    </View>
  );
}

const st = themedSheet(() => ({
  page: { flex: 1, backgroundColor: PG2.page },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 14, marginHorizontal: GUTTER, marginTop: 6, marginBottom: 18, padding: 16, borderRadius: 14, backgroundColor: PG2.card, borderWidth: StyleSheet.hairlineWidth, borderColor: PG2.line },
  bannerTitle: { fontSize: 15, lineHeight: 22, fontWeight: W.label, color: PG2.ink },
  bannerSub: { marginTop: 4, fontSize: 12.5, color: PG2.muted },
  field: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  fieldIcon: { width: 24, alignItems: 'center', marginTop: 2 },
  fieldLabel: { fontSize: 14, fontWeight: W.label, color: PG2.ink, marginBottom: 8 },
  select: { height: 50, borderRadius: R.md, borderWidth: 1, borderColor: PG2.line, backgroundColor: PG2.card, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, gap: 8 },
  selectText: { flex: 1, fontSize: 14, color: PG2.ink },
  summary: { padding: 16, gap: 10, marginLeft: 36 },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sumValue: { fontSize: 14, fontWeight: W.title, color: PG2.ink },
  error: { flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: PG2.redSoft, borderRadius: R.md, padding: 12, marginLeft: 36 },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: GUTTER, paddingTop: 12, backgroundColor: 'rgba(250,250,254,0.97)', ...shadow(2) },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(20,16,60,0.35)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: PG2.card, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 18, paddingHorizontal: 12 },
  sheetTitle: { fontSize: 16, fontWeight: W.title, color: PG2.ink, paddingHorizontal: 8, marginBottom: 8 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingHorizontal: 12, borderRadius: R.md },
  optionText: { fontSize: 14.5, color: PG2.ink, fontWeight: W.label },
}));
