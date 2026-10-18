/**
 * PG detail. Order: photos, name / place / key facts, room types, about, photos by category, room tour
 * videos, amenities, mess timings, timings, house rules, contact. A bar at the bottom keeps the rent and
 * the two actions in reach: Enquire (WhatsApp the PG or the Zenvy housing desk) and Request a bed (the
 * existing booking request: POST /api/pg/:roomId/book; nothing is charged in the app).
 * Data: GET /api/pg/:id (backend/utils/pgContent.publicPg); live-synced on 'pg' events.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, Linking, Alert, Modal, ActivityIndicator, useWindowDimensions, Platform, Animated } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { API_URL, ENDPOINTS, ZENVY_SUPPORT_WHATSAPP } from '../../constants/api';
import { apiFetch, readJson } from '../../utils/auth';
import { useLiveSync } from '../../utils/useLiveSync';
import { useAuth } from '../../context/AuthContext';
import {
  distanceLabel, genderLabel, inr, mapsUrl, sharingLabel,
  type MyPgBooking, type PgDetail, type PgPhoto, type PgRoomType,
} from '../../modules/pg/pgApi';
import {
  usePgPalette, PgHeader, Press, SectionHeading, Divider, PgImage, Skeleton, StateMessage, amenityIcon, amenityLabel, PG_HOME,
  IconBadgeCheck, IconMapPin, IconPhone, IconMessage, IconAlert, IconCheck, ICON, s as ui,
} from '../../modules/pg/ui';
import { PgHero, PgPhotoSection, PhotoViewer } from '../../modules/pg/PgGallery';
import { PgVideoSection } from '../../modules/pg/PgVideos';
import { PgMessSection, PgTimingsSection } from '../../modules/pg/PgMess';

/** Local (device-time) YYYY-MM-DD, so the default is never "yesterday" before 5:30 AM IST. */
function toLocalYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** Next 30 days, starting today, for the check-in date picker. */
function buildCheckInOptions(): { ymd: string; top: string; bottom: string }[] {
  const out: { ymd: string; top: string; bottom: string }[] = [];
  const base = new Date();
  base.setHours(12, 0, 0, 0);
  for (let i = 0; i < 30; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    out.push({
      ymd: toLocalYmd(d),
      top: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.toLocaleDateString('en-IN', { weekday: 'short' }),
      bottom: d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
    });
  }
  return out;
}
function prettyDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  return new Date(y, m - 1, d, 12).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}
const rentText = (t: PgRoomType) => (t.rentFrom === null ? '' : t.rentTo !== null && t.rentTo !== t.rentFrom ? `${inr(t.rentFrom)}–${inr(t.rentTo).slice(1)}` : inr(t.rentFrom));
const roomFacts = (t: PgRoomType) => [
  t.hasAC ? 'AC' : 'Non-AC',
  t.hasAttachedBathroom ? 'Attached bath' : 'Shared bath',
  t.hasBalcony ? 'Balcony' : '',
  t.furnishing ? t.furnishing.charAt(0).toUpperCase() + t.furnishing.slice(1).toLowerCase() : '',
].filter(Boolean).join(' · ');
const roomTitle = (t: PgRoomType) => (t.label && !/^\d+-sharing( AC)?$/.test(t.label) ? t.label : sharingLabel(t.sharingType));

export default function PGDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const pgId = (Array.isArray(id) ? id[0] : id || '').trim();
  const router = useRouter();
  const p = usePgPalette();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { user } = useAuth();

  const scrollY = useRef(new Animated.Value(0)).current;
  const heroH = Math.round(width * 0.75);
  // The name in the header fades in once the on-page name has scrolled under it.
  const titleOpacity = scrollY.interpolate({ inputRange: [heroH + 8, heroH + 48], outputRange: [0, 1], extrapolate: 'clamp' });
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const [pg, setPg] = useState<PgDetail | null>(null);
  const pgRef = useRef<PgDetail | null>(null);
  pgRef.current = pg;
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<'notfound' | 'error' | null>(null);
  const [myBooking, setMyBooking] = useState<MyPgBooking | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [viewer, setViewer] = useState<{ list: PgPhoto[]; index: number } | null>(null);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [checkInOptions] = useState(buildCheckInOptions);
  const [checkInDate, setCheckInDate] = useState(() => toLocalYmd(new Date()));
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);

  const loadMyBooking = useCallback(async () => {
    if (!pgId) return;
    try {
      const res = await apiFetch(`${API_URL}/api/pg/bookings/mine`);
      if (!res.ok) return; // guests / errors: no status card
      const list = await readJson(res);
      if (!mounted.current || !Array.isArray(list)) return;
      const open = list.find((b: MyPgBooking) => (b.hostel?.id === pgId || b.hostelId === pgId) && (b.status === 'Pending' || b.status === 'Confirmed'));
      setMyBooking(open || null);
    } catch { /* non-critical */ }
  }, [pgId]);

  const load = useCallback(async (mode: 'initial' | 'refresh' | 'silent' = 'initial') => {
    if (!pgId) { setLoading(false); setLoadError('notfound'); return; }
    if (mode === 'initial') setLoading(true);
    if (mode === 'refresh') setRefreshing(true);
    try {
      const res = await apiFetch(ENDPOINTS.pgDetail(pgId));
      const data = await readJson(res);
      if (!mounted.current) return;
      if (res.ok && data && data.id) { setPg(data); setLoadError(null); }
      else if (res.status === 404) { setPg(null); setLoadError('notfound'); }
      else if (!pgRef.current) setLoadError('error');
    } catch {
      if (mounted.current && !pgRef.current) setLoadError('error');
    } finally {
      if (mounted.current) { setLoading(false); setRefreshing(false); }
    }
    loadMyBooking();
  }, [pgId, loadMyBooking]);

  useEffect(() => { load('initial'); }, [load]);
  useLiveSync({ types: ['pg'], filter: (e) => e.id == null || String(e.id) === String(pgId), onChange: () => { load('silent'); } });
  const userKey = (user as any)?.id || (user as any)?._id || null;
  useEffect(() => { if (userKey) loadMyBooking(); else setMyBooking(null); }, [userKey, loadMyBooking]);

  const roomTypes = pg?.roomTypes || [];
  const bookable = roomTypes.filter((t) => t.bookRoomId);
  // Keep a valid selection: the chosen type while it has a free bed, else the cheapest one that does.
  const selected = roomTypes.find((t) => t.key === selectedType && t.bookRoomId) || bookable[0] || null;
  const roomTypeLabels = useMemo(() => Object.fromEntries(roomTypes.map((t) => [t.key, `${roomTitle(t)} · ${t.hasAC ? 'AC' : 'Non-AC'}`])), [roomTypes]);
  const photosByType = useMemo(() => {
    const m: Record<string, PgPhoto[]> = {};
    (pg?.photos || []).forEach((ph) => { if (ph.roomType) (m[ph.roomType] = m[ph.roomType] || []).push(ph); });
    return m;
  }, [pg?.photos]);
  const heroPhotos = useMemo(() => {
    const list = pg?.photos || [];
    const cover = list.find((x) => x.isCover);
    return cover ? [cover, ...list.filter((x) => x !== cover)] : list;
  }, [pg?.photos]);

  const promptLogin = () => Alert.alert('Log in to continue', 'Log in to send a booking request.', [
    { text: 'Not now', style: 'cancel' },
    { text: 'Log in', onPress: () => router.push('/login' as any) },
  ]);

  const openRequest = () => {
    if (!pg) return;
    if (!user) { promptLogin(); return; }
    if (!selected) return;
    Haptics.selectionAsync().catch(() => {});
    setSheetOpen(true);
  };

  const sendRequest = async () => {
    if (!pg || !selected?.bookRoomId || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    try {
      const res = await apiFetch(ENDPOINTS.pgBook(selected.bookRoomId), { method: 'POST', body: JSON.stringify({ checkInDate }) });
      const data = await readJson(res);
      if (!mounted.current) return;
      if (res.status === 401) { setSheetOpen(false); promptLogin(); return; }
      if (!res.ok) {
        if (data?.code === 'BOOKING_EXISTS') { loadMyBooking(); setSheetOpen(false); }
        Alert.alert(data?.code === 'BOOKING_EXISTS' ? 'Request already sent' : 'Could not send the request', data?.message || 'Please try again.');
        if (res.status === 400) load('silent'); // e.g. the last bed went meanwhile
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setSheetOpen(false);
      load('silent');
      const buttons: any[] = [{ text: 'Done', style: 'cancel' }];
      if (data?.whatsappUrl) buttons.unshift({ text: 'Message housing desk', onPress: () => Linking.openURL(data.whatsappUrl).catch(() => {}) });
      Alert.alert('Request sent', `${data?.message || 'The Zenvy housing team will confirm it with you.'}\n\n${roomTitle(selected)} · check-in ${prettyDate(checkInDate)}`, buttons);
    } catch {
      if (mounted.current) Alert.alert('No connection', 'Check your internet and try again.');
    } finally {
      sendingRef.current = false;
      if (mounted.current) setSending(false);
    }
  };

  const cancelMyBooking = () => {
    if (!myBooking || cancelling) return;
    Alert.alert('Cancel your request?', 'Your booking request for this PG will be withdrawn.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Cancel request', style: 'destructive', onPress: async () => {
          setCancelling(true);
          try {
            const res = await apiFetch(`${API_URL}/api/pg/bookings/${myBooking.id}/cancel`, { method: 'PUT' });
            const data = await readJson(res);
            if (!mounted.current) return;
            if (res.ok) { setMyBooking(null); load('silent'); } else Alert.alert('Could not cancel', data?.message || 'Please try again.');
          } catch {
            if (mounted.current) Alert.alert('No connection', 'Check your internet and try again.');
          } finally {
            if (mounted.current) setCancelling(false);
          }
        },
      },
    ]);
  };

  // ── Loading / error ────────────────────────────────────────────────────────────────────────────
  if (loading && !pg) {
    const h = Math.round(width * 0.75);
    return (
      <View style={{ flex: 1, backgroundColor: p.bg }}>
        <PgHeader />
        <View accessibilityLabel="Loading PG" accessibilityRole="progressbar">
          <Skeleton style={{ width, height: h, borderRadius: 0 }} />
          <View style={{ padding: 16 }}>
            <Skeleton style={{ width: '70%', height: 24 }} />
            <Skeleton style={{ width: '50%', height: 14, marginTop: 10 }} />
            <Skeleton style={{ width: '100%', height: 64, marginTop: 20, borderRadius: 12 }} />
            <Skeleton style={{ width: '40%', height: 18, marginTop: 28 }} />
            <Skeleton style={{ width: '100%', height: 96, marginTop: 12, borderRadius: 12 }} />
          </View>
        </View>
      </View>
    );
  }
  if (!pg) {
    const network = loadError === 'error';
    return (
      <View style={{ flex: 1, backgroundColor: p.bg }}>
        <PgHeader />
        <StateMessage
          icon={<IconAlert size={28} color={p.muted} strokeWidth={ICON.stroke} />}
          title={network ? "Couldn't load this PG" : 'PG not found'}
          body={network ? 'Check your connection and try again.' : 'It may have been removed or is not taking requests right now.'}
          actionLabel={network ? 'Try again' : 'See all PGs'}
          onAction={network ? () => load('initial') : () => router.replace(PG_HOME as any)}
        />
      </View>
    );
  }

  // ── Detail ─────────────────────────────────────────────────────────────────────────────────────
  const contact = pg.contactInfo || {};
  const phone = (contact.phone || '').trim();
  const maps = mapsUrl(pg);
  const amenities = pg.amenities.map((a) => ({ raw: a, label: amenityLabel(a) })).filter((a) => a.label);
  const rentFrom = pg.rentFrom ?? pg.baseRent;
  const barRent = selected?.rentFrom ?? rentFrom;
  const myOpen = myBooking && (myBooking.status === 'Pending' || myBooking.status === 'Confirmed') ? myBooking : null;
  const hasRooms = roomTypes.length > 0;
  const bottomBarH = 72 + insets.bottom;
  const deposit = pg.securityDeposit;

  const enquire = () => {
    let to = (phone || ZENVY_SUPPORT_WHATSAPP).replace(/\D/g, '');
    if (to.length === 10) to = `91${to}`;
    const msg = `Hi, I found ${pg.name} on Zenvy. Could you share current availability and a time to visit?`;
    Linking.openURL(`https://wa.me/${to}?text=${encodeURIComponent(msg)}`).catch(() => Alert.alert('WhatsApp is not available', phone ? `You can call ${phone} instead.` : 'Please try again later.'));
  };

  const contactRows = [
    contact.ownerName ? { label: 'Owner', value: contact.ownerName } : null,
    contact.wardenName ? { label: 'Warden', value: contact.wardenName } : null,
    phone ? { label: 'Phone', value: phone } : null,
    contact.emergencyContact ? { label: 'Emergency', value: contact.emergencyContact } : null,
  ].filter(Boolean) as { label: string; value: string }[];

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <PgHeader title={pg.name} titleOpacity={titleOpacity} />
      <Animated.ScrollView
        contentContainerStyle={{ paddingBottom: bottomBarH + 24 }}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} tintColor={p.sub} colors={[p.accentFill]} />}
      >
        <PgHero photos={heroPhotos} topInset={0} onOpen={(list, index) => setViewer({ list, index })} />

        {/* Name, place, key facts */}
        <View style={st.pad}>
          <View style={st.titleRow}>
            <Text style={[st.title, { color: p.text }]} accessibilityRole="header">{pg.name}</Text>
          </View>
          <View style={st.metaRow}>
            {pg.isVerified ? (
              <View style={st.verified} accessibilityLabel="Verified by Zenvy">
                <IconBadgeCheck size={14} color={p.success} strokeWidth={2} />
                <Text style={[ui.small, { color: p.success, fontWeight: '600' }]}>Verified</Text>
              </View>
            ) : null}
            <Text style={[ui.small, { color: p.sub }]}>{genderLabel(pg.genderType)}</Text>
            {pg.area ? <Text style={[ui.small, { color: p.sub }]}>· {pg.area}</Text> : null}
          </View>
          {pg.address ? (
            <View style={st.addressRow}>
              <IconMapPin size={16} color={p.sub} strokeWidth={ICON.stroke} style={{ marginTop: 2 }} />
              <View style={{ flex: 1 }}>
                <Text style={[ui.body, { color: p.text }]}>{pg.address}</Text>
                {distanceLabel(pg.distanceFromCollege) ? <Text style={[ui.small, { color: p.muted, marginTop: 2 }]}>{distanceLabel(pg.distanceFromCollege)}</Text> : null}
              </View>
              {maps ? (
                <Press onPress={() => Linking.openURL(maps).catch(() => Alert.alert('Could not open Maps'))} accessibilityRole="link" accessibilityLabel="Open in Maps" style={[st.smallBtn, { borderColor: p.line }]}>
                  <Text style={[ui.small, { color: p.text, fontWeight: '600' }]}>Open in Maps</Text>
                </Press>
              ) : null}
            </View>
          ) : null}

          <View style={[st.facts, { borderColor: p.line, backgroundColor: p.card }]}>
            <Fact label="Rent from" value={rentFrom ? inr(rentFrom) : '—'} sub="per month" />
            <View style={[st.factSep, { backgroundColor: p.line }]} />
            <Fact label="Deposit" value={Number(deposit) > 0 ? inr(deposit) : 'None'} sub={roomTypes.some((t) => t.deposit !== null && t.deposit !== deposit) ? 'varies by room' : Number(deposit) > 0 ? 'one time' : ' '} />
            <View style={[st.factSep, { backgroundColor: p.line }]} />
            <Fact label="Beds free" value={hasRooms ? String(pg.bedsAvailable) : '—'} sub={hasRooms ? `${roomTypes.length} room type${roomTypes.length === 1 ? '' : 's'}` : 'no rooms listed'} />
          </View>

          {myOpen ? (
            <View style={[st.notice, { borderColor: myOpen.status === 'Confirmed' ? p.success : p.line, backgroundColor: myOpen.status === 'Confirmed' ? p.successSoft : p.sunken }]} accessibilityLiveRegion="polite">
              <View style={{ flex: 1 }}>
                <Text style={[ui.body, { color: p.text, fontWeight: '600' }]}>{myOpen.status === 'Confirmed' ? 'Your bed is confirmed' : 'Request sent'}</Text>
                <Text style={[ui.small, { color: p.sub, marginTop: 2 }]}>
                  {[myOpen.room?.roomNumber ? `Room ${myOpen.room.roomNumber}` : '', myOpen.checkInDate ? `check-in ${new Date(myOpen.checkInDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : '', myOpen.status === 'Pending' ? 'the housing team will call you' : ''].filter(Boolean).join(' · ')}
                </Text>
              </View>
              {myOpen.status === 'Pending' ? (
                <Press onPress={cancelMyBooking} disabled={cancelling} accessibilityLabel="Cancel request" style={st.textBtn}>
                  {cancelling ? <ActivityIndicator color={p.sub} /> : <Text style={[ui.small, { color: p.accent, fontWeight: '600' }]}>Cancel</Text>}
                </Press>
              ) : null}
            </View>
          ) : null}
        </View>

        {/* Room types */}
        <View style={st.section}>
          <SectionHeading title="Rooms" detail={hasRooms ? 'Rent per bed' : undefined} />
          {hasRooms ? roomTypes.map((t) => {
            const on = selected?.key === t.key;
            const full = !t.bookRoomId;
            const photos = photosByType[t.key] || [];
            return (
              <Press
                key={t.key}
                onPress={full ? undefined : () => setSelectedType(t.key)}
                disabled={full}
                accessibilityRole="button"
                accessibilityState={{ selected: on, disabled: full }}
                accessibilityLabel={`${roomTitle(t)}. ${roomFacts(t)}. ${rentText(t)} a month. ${full ? 'Full' : `${t.availableBeds} bed${t.availableBeds === 1 ? '' : 's'} free`}`}
                style={[st.roomCard, { backgroundColor: p.card, borderColor: on ? p.text : p.line, borderWidth: on ? 1.5 : StyleSheet.hairlineWidth }, full && { opacity: 0.6 }]}
              >
                <View style={st.roomTop}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[st.roomTitle, { color: p.text }]} numberOfLines={1}>{roomTitle(t)}</Text>
                    <Text style={[ui.small, { color: p.sub, marginTop: 2 }]} numberOfLines={2}>{roomFacts(t)}</Text>
                  </View>
                  <View style={[st.radio, { borderColor: on ? p.text : p.line, backgroundColor: on ? p.text : 'transparent' }]}>
                    {on ? <IconCheck size={14} color={p.bg} strokeWidth={2.5} /> : null}
                  </View>
                </View>
                {photos.length ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} style={{ marginTop: 12 }}>
                    {photos.slice(0, 8).map((ph, i) => (
                      <Press key={ph.id} onPress={() => setViewer({ list: photos, index: i })} accessibilityRole="imagebutton" accessibilityLabel={`${roomTitle(t)} photo ${i + 1}`} style={{ width: 72, height: 54 }}>
                        <PgImage uri={ph.url} style={{ width: 72, height: 54, borderRadius: 6 }} recyclingKey={`rt-${ph.id}`} priority="low" />
                      </Press>
                    ))}
                  </ScrollView>
                ) : null}
                <View style={st.roomBottom}>
                  <Text style={[st.roomPrice, { color: p.text }]}>{rentText(t)}<Text style={[ui.small, { color: p.sub, fontWeight: '400' }]}>/month</Text></Text>
                  <Text style={[ui.small, { color: full ? p.muted : p.success, fontWeight: '600' }]}>
                    {full ? 'Full' : `${t.availableBeds} of ${t.totalBeds} bed${t.totalBeds === 1 ? '' : 's'} free`}
                  </Text>
                </View>
                {t.deposit && t.deposit !== pg.securityDeposit ? <Text style={[ui.small, { color: p.muted, marginTop: 2 }]}>Deposit {inr(t.deposit)}</Text> : null}
              </Press>
            );
          }) : (
            <Text style={[ui.body, { color: p.sub }]}>No rooms are listed yet. Use Enquire to ask the housing team about availability.</Text>
          )}
        </View>

        {pg.description ? (
          <View style={st.section}>
            <SectionHeading title="About" />
            <Text style={[ui.body, { color: p.text }]}>{pg.description}</Text>
          </View>
        ) : null}

        {pg.photos.length > 1 ? <View style={st.section}><PgPhotoSection photos={pg.photos} onOpen={(list, index) => setViewer({ list, index })} /></View> : null}

        {pg.videos.length ? <View style={st.section}><PgVideoSection videos={pg.videos} roomTypeLabels={roomTypeLabels} /></View> : null}

        {amenities.length ? (
          <View style={st.section}>
            <SectionHeading title="Amenities" />
            <View style={st.amenities}>
              {amenities.map((a) => {
                const Icon = amenityIcon(a.raw);
                return (
                  <View key={a.raw} style={[st.amenity, { width: (width - 32 - 8) / 2 }]} accessibilityLabel={a.label}>
                    <Icon size={ICON.size} color={p.sub} strokeWidth={ICON.stroke} />
                    <Text style={[ui.body, { color: p.text, flex: 1 }]} numberOfLines={2}>{a.label}</Text>
                  </View>
                );
              })}
            </View>
          </View>
        ) : null}

        <View style={st.section}><PgMessSection timetable={pg.messTimetable} /></View>

        {pg.timings ? <View style={st.section}><PgTimingsSection timings={pg.timings} /></View> : null}

        {pg.rules.length ? (
          <View style={st.section}>
            <SectionHeading title="House rules" />
            {pg.rules.map((r, i) => (
              <View key={`${i}-${r}`} style={st.ruleRow}>
                <Text style={[ui.body, { color: p.muted, width: 20 }]}>{i + 1}.</Text>
                <Text style={[ui.body, { color: p.text, flex: 1 }]}>{r}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <View style={st.section}>
          <SectionHeading title="Contact" />
          {contactRows.length ? (
            <View style={[st.table, { borderColor: p.line, backgroundColor: p.card }]}>
              {contactRows.map((r, i) => (
                <View key={r.label}>
                  {i > 0 ? <Divider /> : null}
                  <View style={st.contactRow}>
                    <Text style={[ui.small, { color: p.muted, width: 84 }]}>{r.label}</Text>
                    <Text style={[ui.body, { color: p.text, flex: 1 }]} numberOfLines={1} selectable>{r.value}</Text>
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <Text style={[ui.body, { color: p.sub }]}>The Zenvy housing desk handles visits and requests for this PG.</Text>
          )}
          {phone ? (
            <Press onPress={() => Linking.openURL(`tel:${phone.replace(/[^\d+]/g, '')}`).catch(() => {})} accessibilityLabel={`Call ${phone}`} style={[ui.secondaryBtn, st.callBtn, { borderColor: p.line }]}>
              <IconPhone size={16} color={p.text} strokeWidth={ICON.stroke} />
              <Text style={[ui.btnLabel, { color: p.text }]}>Call</Text>
            </Press>
          ) : null}
        </View>
      </Animated.ScrollView>

      {/* Bottom bar */}
      <View style={[st.bar, { paddingBottom: insets.bottom + 12, backgroundColor: p.bg, borderTopColor: p.line }]}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[ui.small, { color: p.sub }]} numberOfLines={1}>{selected ? roomTitle(selected) : 'Rent from'}</Text>
          <Text style={[st.barPrice, { color: p.text }]} numberOfLines={1}>{barRent ? inr(barRent) : '—'}<Text style={[ui.small, { color: p.sub, fontWeight: '400' }]}>/month</Text></Text>
        </View>
        <Press onPress={enquire} accessibilityLabel={phone ? 'Enquire on WhatsApp' : 'Enquire with the Zenvy housing desk on WhatsApp'} style={[st.barBtn, { borderColor: p.line, borderWidth: 1 }]}>
          <IconMessage size={16} color={p.text} strokeWidth={ICON.stroke} />
          <Text style={[ui.btnLabel, { color: p.text }]}>Enquire</Text>
        </Press>
        {myOpen ? (
          <View style={[st.barBtn, { backgroundColor: p.sunken }]} accessibilityLabel={myOpen.status === 'Confirmed' ? 'Booked' : 'Request sent'}>
            <Text style={[ui.btnLabel, { color: p.sub }]}>{myOpen.status === 'Confirmed' ? 'Booked' : 'Requested'}</Text>
          </View>
        ) : (
          <Press onPress={openRequest} disabled={!selected} accessibilityLabel={selected ? 'Request a bed' : 'No beds free'} style={[st.barBtn, { backgroundColor: p.accentFill }]}>
            <Text style={[ui.btnLabel, { color: '#fff' }]}>{selected ? 'Request a bed' : hasRooms ? 'Full' : 'Request a bed'}</Text>
          </Press>
        )}
      </View>

      {/* Request sheet: room type + check-in date + summary (the existing booking request) */}
      <Modal visible={sheetOpen} transparent animationType="slide" onRequestClose={() => !sending && setSheetOpen(false)} statusBarTranslucent>
        <View style={st.sheetBackdrop}>
          <Press onPress={() => !sending && setSheetOpen(false)} accessibilityLabel="Close" style={{ flex: 1 }}><View /></Press>
          <View style={[st.sheet, { backgroundColor: p.bg, paddingBottom: insets.bottom + 16 }]}>
            <View style={[st.grabber, { backgroundColor: p.line }]} />
            <Text style={[st.sheetTitle, { color: p.text }]} accessibilityRole="header">Request a bed</Text>
            <Text style={[ui.small, { color: p.sub, marginTop: 2 }]} numberOfLines={1}>{pg.name}</Text>

            {bookable.length > 1 ? (
              <>
                <Text style={[st.sheetLabel, { color: p.sub }]}>Room</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                  {bookable.map((t) => {
                    const on = selected?.key === t.key;
                    return (
                      <Press key={t.key} onPress={() => setSelectedType(t.key)} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`${roomTitle(t)}, ${rentText(t)} a month`}
                        style={[st.option, { borderColor: on ? p.text : p.line, backgroundColor: on ? p.text : 'transparent' }]}>
                        <Text style={[ui.small, { color: on ? p.bg : p.text, fontWeight: '600' }]} numberOfLines={1}>{roomTitle(t)}</Text>
                        <Text style={[ui.small, { color: on ? p.bg : p.sub }]}>{inr(t.rentFrom)}</Text>
                      </Press>
                    );
                  })}
                </ScrollView>
              </>
            ) : null}

            <Text style={[st.sheetLabel, { color: p.sub }]}>Check-in</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {checkInOptions.map((o) => {
                const on = o.ymd === checkInDate;
                return (
                  <Press key={o.ymd} onPress={() => setCheckInDate(o.ymd)} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`${o.top}, ${o.bottom}`}
                    style={[st.dateChip, { borderColor: on ? p.text : p.line, backgroundColor: on ? p.text : 'transparent' }]}>
                    <Text style={[ui.small, { color: on ? p.bg : p.sub }]}>{o.top}</Text>
                    <Text style={[ui.small, { color: on ? p.bg : p.text, fontWeight: '600', marginTop: 2 }]}>{o.bottom}</Text>
                  </Press>
                );
              })}
            </ScrollView>

            {selected ? (
              <View style={[st.table, { borderColor: p.line, marginTop: 16 }]}>
                <SummaryRow label="Room" value={`${roomTitle(selected)} · ${selected.hasAC ? 'AC' : 'Non-AC'}`} />
                <Divider />
                <SummaryRow label="Rent" value={`${inr(selected.rentFrom)}/month`} />
                <Divider />
                <SummaryRow label="Deposit" value={Number(selected.deposit) > 0 ? inr(selected.deposit) : 'None'} />
                <Divider />
                <SummaryRow label="Check-in" value={prettyDate(checkInDate)} />
              </View>
            ) : null}
            <Text style={[ui.small, { color: p.muted, marginTop: 12 }]}>Nothing is charged in the app. The Zenvy housing team will call you to confirm and arrange payment at the PG.</Text>

            <Press onPress={sendRequest} disabled={sending || !selected} accessibilityLabel="Send request" accessibilityState={{ busy: sending }} style={[st.primary, { backgroundColor: p.accentFill }]}>
              {sending ? <ActivityIndicator color="#fff" /> : <Text style={[ui.btnLabel, { color: '#fff' }]}>Send request</Text>}
            </Press>
          </View>
        </View>
      </Modal>

      {viewer ? <PhotoViewer photos={viewer.list} index={viewer.index} onClose={() => setViewer(null)} /> : null}
    </View>
  );
}

function Fact({ label, value, sub }: { label: string; value: string; sub: string }) {
  const p = usePgPalette();
  return (
    <View style={{ flex: 1, paddingHorizontal: 12, paddingVertical: 12 }} accessible accessibilityLabel={`${label} ${value} ${sub}`}>
      <Text style={[ui.small, { color: p.muted }]} numberOfLines={1}>{label}</Text>
      <Text style={{ fontSize: 17, fontWeight: '700', color: p.text, marginTop: 2 }} numberOfLines={1}>{value}</Text>
      <Text style={[ui.small, { color: p.muted }]} numberOfLines={1}>{sub}</Text>
    </View>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  const p = usePgPalette();
  return (
    <View style={st.contactRow}>
      <Text style={[ui.small, { color: p.muted, width: 84 }]}>{label}</Text>
      <Text style={[ui.body, { color: p.text, flex: 1, textAlign: 'right' }]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  pad: { paddingHorizontal: 16, paddingTop: 16 },
  section: { paddingHorizontal: 16, marginTop: 32 },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  title: { fontSize: 22, fontWeight: '700', letterSpacing: -0.3, flex: 1 },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  verified: { flexDirection: 'row', alignItems: 'center', gap: 4, marginRight: 4 },
  addressRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 12 },
  smallBtn: { minHeight: 36, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  facts: { flexDirection: 'row', borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, marginTop: 16 },
  factSep: { width: StyleSheet.hairlineWidth, marginVertical: 12 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, paddingLeft: 16, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, marginTop: 16 },
  textBtn: { paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' },
  roomCard: { borderRadius: 12, padding: 16, marginBottom: 12 },
  roomTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  roomTitle: { fontSize: 16, fontWeight: '600' },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  roomBottom: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 12 },
  roomPrice: { fontSize: 17, fontWeight: '700' },
  amenities: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 8, rowGap: 12 },
  amenity: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  ruleRow: { flexDirection: 'row', gap: 4, marginBottom: 8 },
  table: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, minHeight: 44, paddingVertical: 10 },
  callBtn: { flexDirection: 'row', gap: 8, marginTop: 12 },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  barPrice: { fontSize: 18, fontWeight: '700', marginTop: 1 },
  barBtn: { minHeight: 48, paddingHorizontal: 16, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingHorizontal: 16, paddingTop: 8, ...(Platform.OS === 'android' ? { elevation: 12 } : {}) },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, marginBottom: 12 },
  sheetTitle: { fontSize: 18, fontWeight: '700' },
  sheetLabel: { fontSize: 12, fontWeight: '600', marginTop: 16, marginBottom: 8 },
  option: { minHeight: 52, minWidth: 104, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, justifyContent: 'center' },
  dateChip: { width: 76, minHeight: 52, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  primary: { minHeight: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 16 },
});
