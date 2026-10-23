/**
 * PG detail (clean white cards, blue accent). Top to bottom: photos (swipe, counter, category quick-jump),
 * a header card (name, "Verified" only when the PG is verified, rating from real reviews, distance,
 * "View on map", rent with "(incl. food)" when food is in the rent, share), room types as picture cards
 * (tap to choose the one to book), an amenities icon row, then the sticky section bar (Overview · Rooms ·
 * Mess · Rules · Policies · Safety · Location · FAQ · Reviews, only the sections this PG has) and the
 * sections. The bottom bar: Enquire (WhatsApp the Zenvy housing desk; no personal numbers are shown) and
 * Book now, which opens the booking summary: room type, move-in date, stay terms, price breakdown, how
 * payment works (at the PG; nothing is charged in the app), next steps and "Send booking request"
 * (POST /api/pg/:roomId/book; the housing team confirms it). Data: GET /api/pg/:id, live-synced on 'pg'.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, Linking, Alert, Modal, ActivityIndicator, useWindowDimensions, Animated, Share, Platform, type LayoutChangeEvent } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { API_URL, ENDPOINTS, ZENVY_SUPPORT_WHATSAPP } from '../../constants/api';
import { apiFetch, readJson } from '../../utils/auth';
import { useLiveSync } from '../../utils/useLiveSync';
import { useAuth } from '../../context/AuthContext';
import {
  distanceLabel, genderLabel, inr, mapsUrl, months, pgLink, plural, ratingText, sectionsOf,
  type MyPgBooking, type PgDetail, type PgPhoto, type PgReviewEligibility, type PgRoomType, type SectionKey,
} from '../../modules/pg/pgApi';
import {
  usePgPalette, PgHeader, Press, Divider, Skeleton, StateMessage, PgImage, PG_HOME, TYPE, amenityIcon, amenityLabel, cleanAmenities,
  IconMessage, IconAlert, IconShare, IconStar, IconMapPin, IconArrowLeft, IconCheck, IconBed, IconCalendarDays, IconWallet,
  IconClipboard, ICON, s as ui,
} from '../../modules/pg/ui';
import { PgHero, PgPhotoSection, PhotoViewer } from '../../modules/pg/PgGallery';
import { PgVideoSection } from '../../modules/pg/PgVideos';
import { PgMessSection } from '../../modules/pg/PgMess';
import { PgSectionNav, SECTION_NAV_H } from '../../modules/pg/PgSectionNav';
import { RoomsSection, roomTitle, roomFacts, rentText } from '../../modules/pg/PgRooms';
import { KeyFacts, Highlights, About, Amenities, RulesSection, PoliciesSection, SafetySection, LocationSection, FaqSection } from '../../modules/pg/PgSections';
import { ReviewsSection } from '../../modules/pg/PgReviews';
import { VerifiedTag } from '../../modules/pg/PgListCard';
import { formatISTDate } from '../../utils/format';

/** Local (device-time) YYYY-MM-DD, so the default is never "yesterday" before 5:30 AM IST. */
function toLocalYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** First move-in date to suggest: today until 6 PM, tomorrow after that (the housing team calls to
 * confirm the bed first, so a move-in "today" chosen late at night cannot happen). */
function defaultCheckInYmd(now = new Date()): string {
  if (now.getHours() < 18) return toLocalYmd(now);
  const t = new Date(now);
  t.setDate(t.getDate() + 1);
  return toLocalYmd(t);
}
/** Next 30 days, starting today, for the move-in date picker. */
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
  return new Date(y, m - 1, d, 12).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}
const deskUrl = (text: string) => `https://wa.me/${ZENVY_SUPPORT_WHATSAPP.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
const METHOD_LABEL: Record<string, string> = { cash: 'cash', upi: 'UPI', bank: 'bank transfer' };
const listText = (items: string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`);

export default function PGDetailScreen() {
  const { id, pgSummary } = useLocalSearchParams<{ id: string; pgSummary?: string }>();
  const pgId = (Array.isArray(id) ? id[0] : id || '').trim();
  const router = useRouter();
  const p = usePgPalette();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { user } = useAuth();

  const scrollY = useRef(new Animated.Value(0)).current;
  const scrollRef = useRef<ScrollView>(null);
  const heroH = Math.round(width * 0.75);
  // The name in the header fades in once the on-page name has scrolled under it.
  const titleOpacity = scrollY.interpolate({ inputRange: [heroH + 24, heroH + 72], outputRange: [0, 1], extrapolate: 'clamp' });
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const [pg, setPg] = useState<PgDetail | null>(null);
  const pgRef = useRef<PgDetail | null>(null);
  pgRef.current = pg;
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<'notfound' | 'error' | null>(null);
  const [myBooking, setMyBooking] = useState<MyPgBooking | null>(null);
  const [eligibility, setEligibility] = useState<PgReviewEligibility | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [viewer, setViewer] = useState<{ list: PgPhoto[]; index: number } | null>(null);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [checkInOptions] = useState(buildCheckInOptions);
  const [checkInDate, setCheckInDate] = useState(() => defaultCheckInYmd());
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);

  const userKey = (user as any)?.id || (user as any)?._id || null;

  const loadMine = useCallback(async () => {
    if (!pgId) return;
    try {
      const res = await apiFetch(`${API_URL}/api/pg/bookings/mine`);
      if (res.ok) {
        const list = await readJson(res);
        if (mounted.current && Array.isArray(list)) {
          const open = list.find((b: MyPgBooking) => (b.hostel?.id === pgId || b.hostelId === pgId) && (b.status === 'Pending' || b.status === 'Confirmed'));
          setMyBooking(open || null);
        }
      }
    } catch { /* non-critical: no status card */ }
    try {
      const res = await apiFetch(`${API_URL}/api/pg/${pgId}/reviews/eligibility`);
      const body = res.ok ? await readJson(res) : null;
      if (mounted.current) setEligibility(body && typeof body.canReview === 'boolean' ? body : null);
    } catch { /* non-critical: no review prompt */ }
  }, [pgId]);

  const load = useCallback(async (mode: 'initial' | 'refresh' | 'silent' = 'initial') => {
    if (!pgId) { setLoading(false); setLoadError('notfound'); return; }
    if (mode === 'initial') setLoading(true);
    if (mode === 'refresh') setRefreshing(true);
    try {
      const res = await apiFetch(ENDPOINTS.pgDetail(pgId));
      const data = await readJson(res);
      if (!mounted.current) return;
      if (res.ok && data && data.id) { setPg({ ...data, amenities: cleanAmenities(data.amenities) }); setLoadError(null); }
      else if (res.status === 404) { setPg(null); setLoadError('notfound'); }
      else if (!pgRef.current) setLoadError('error');
    } catch {
      if (mounted.current && !pgRef.current) setLoadError('error');
    } finally {
      if (mounted.current) { setLoading(false); setRefreshing(false); }
    }
    if (userKey) loadMine();
  }, [pgId, loadMine, userKey]);

  useEffect(() => { load('initial'); }, [load]);
  useLiveSync({ types: ['pg'], filter: (e) => e.id == null || String(e.id) === String(pgId), onChange: () => { load('silent'); } });
  useEffect(() => { if (!userKey) { setMyBooking(null); setEligibility(null); } }, [userKey]);

  // ── Sections + scroll-spy ──────────────────────────────────────────────────────────────────────
  const sections = useMemo<SectionKey[]>(() => {
    if (!pg) return [];
    const list = sectionsOf(pg);
    // A student who stayed here can write the first review even before any exist.
    return eligibility?.canReview && !list.includes('reviews') ? [...list, 'reviews'] : list;
  }, [pg, eligibility?.canReview]);
  const sectionY = useRef<Partial<Record<SectionKey, number>>>({});
  const viewport = useRef({ h: 0, content: 0 });
  const [active, setActive] = useState<SectionKey>('overview');
  const activeRef = useRef<SectionKey>('overview');
  const spyLockUntil = useRef(0);
  const setActiveIfChanged = (k: SectionKey) => { if (activeRef.current !== k) { activeRef.current = k; setActive(k); } };

  const onScrollJS = useCallback((y: number) => {
    if (Date.now() < spyLockUntil.current) return;
    const { h, content } = viewport.current;
    if (h && content && y + h >= content - 8 && sections.length) { setActiveIfChanged(sections[sections.length - 1]); return; }
    let cur: SectionKey = sections[0] || 'overview';
    for (const k of sections) {
      const top = sectionY.current[k];
      if (top !== undefined && top - SECTION_NAV_H - 32 <= y) cur = k;
    }
    setActiveIfChanged(cur);
  }, [sections]);

  const goTo = (k: SectionKey) => {
    const y = sectionY.current[k];
    if (y === undefined) return;
    Haptics.selectionAsync().catch(() => {});
    setActiveIfChanged(k);
    spyLockUntil.current = Date.now() + 700; // let the smooth scroll finish before the spy takes over again
    scrollRef.current?.scrollTo({ y: Math.max(0, y - SECTION_NAV_H), animated: true });
  };
  const onSectionLayout = (k: SectionKey) => (e: LayoutChangeEvent) => { sectionY.current[k] = e.nativeEvent.layout.y; };

  // ── Rooms / booking ────────────────────────────────────────────────────────────────────────────
  const roomTypes = pg?.roomTypes || [];
  const bookable = roomTypes.filter((t) => t.bookRoomId);
  // Keep a valid selection: the chosen type while it has a free bed, else the cheapest one that does.
  const selected = roomTypes.find((t) => t.key === selectedType && t.bookRoomId) || bookable[0] || null;
  const roomTypeLabels = useMemo(() => Object.fromEntries(roomTypes.map((t) => [t.key, `${roomTitle(t)} · ${t.hasAC ? 'AC' : 'Non-AC'}`])), [roomTypes]);
  const heroPhotos = useMemo(() => {
    const list = pg?.photos || [];
    const cover = list.find((x) => x.isCover);
    return cover ? [cover, ...list.filter((x) => x !== cover)] : list;
  }, [pg?.photos]);
  const photosByType = useMemo(() => {
    const m: Record<string, PgPhoto[]> = {};
    (pg?.photos || []).forEach((ph) => { if (ph.roomType) (m[ph.roomType] = m[ph.roomType] || []).push(ph); });
    return m;
  }, [pg?.photos]);

  const promptLogin = (why = 'Sign in to send a booking request.') => Alert.alert('Sign in to continue', why, [
    { text: 'Not now', style: 'cancel' },
    { text: 'Sign in', onPress: () => router.push('/login' as any) },
  ]);

  // Dev web preview only: `?pgSummary=1` opens the booking summary for screenshots (sending still needs sign-in).
  const devSummary = __DEV__ && Platform.OS === 'web' && pgSummary === '1';
  useEffect(() => { if (devSummary && selected) setSummaryOpen(true); }, [devSummary, !!selected]); // eslint-disable-line react-hooks/exhaustive-deps

  const openSummary = () => {
    if (!pg) return;
    if (!user) { promptLogin(); return; }
    if (!selected) return;
    Haptics.selectionAsync().catch(() => {});
    setSummaryOpen(true);
  };

  const sendRequest = async () => {
    if (!pg || !selected?.bookRoomId || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    try {
      const res = await apiFetch(ENDPOINTS.pgBook(selected.bookRoomId), { method: 'POST', body: JSON.stringify({ checkInDate }) });
      const data = await readJson(res);
      if (!mounted.current) return;
      if (res.status === 401) { setSummaryOpen(false); promptLogin(); return; }
      if (!res.ok) {
        if (data?.code === 'BOOKING_EXISTS') { loadMine(); setSummaryOpen(false); }
        Alert.alert(data?.code === 'BOOKING_EXISTS' ? 'Request already sent' : 'Could not send the request', data?.message || 'Please try again.');
        if (res.status === 400) load('silent'); // e.g. the last bed went meanwhile
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setSummaryOpen(false);
      load('silent');
      const buttons: any[] = [{ text: 'Done', style: 'cancel' }];
      if (data?.whatsappUrl) buttons.unshift({ text: 'Message housing desk', onPress: () => Linking.openURL(data.whatsappUrl).catch(() => {}) });
      Alert.alert('Request sent', `${data?.message || 'The Zenvy housing team will confirm it with you.'}\n\n${roomTitle(selected)} · move-in ${prettyDate(checkInDate)}`, buttons);
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
    return (
      <View style={{ flex: 1, backgroundColor: p.bg }}>
        <PgHeader />
        <View accessibilityLabel="Loading PG" accessibilityRole="progressbar">
          <Skeleton style={{ width, height: heroH, borderRadius: 0 }} />
          <View style={{ padding: 16 }}>
            <Skeleton style={{ width: '70%', height: 24 }} />
            <Skeleton style={{ width: '50%', height: 14, marginTop: 12 }} />
            <Skeleton style={{ width: '40%', height: 28, marginTop: 16 }} />
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 24 }}>
              {[0, 1, 2].map((i) => <Skeleton key={i} style={{ flex: 1, height: 120, borderRadius: 12 }} />)}
            </View>
            <Skeleton style={{ width: '100%', height: 64, marginTop: 24, borderRadius: 12 }} />
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
  const rentFrom = pg.rentFrom ?? pg.baseRent;
  const shownRent = selected?.rentFrom ?? rentFrom;
  const myOpen = myBooking && (myBooking.status === 'Pending' || myBooking.status === 'Confirmed') ? myBooking : null;
  const hasRooms = roomTypes.length > 0;
  const bottomBarH = 76 + insets.bottom;
  const summary = pg.reviewSummary || { average: null, count: 0 };
  const maps = mapsUrl(pg);
  const foodIncluded = !!pg.policies?.included?.includes('food');
  const dist = distanceLabel(pg.distanceFromCollege);
  const amenityList = pg.amenities.map((a) => ({ raw: a, label: amenityLabel(a) })).filter((a) => a.label);
  const amenitySlots = Math.max(4, Math.min(6, Math.floor((width - 32) / 68)));
  const amenityShown = amenityList.length > amenitySlots ? amenityList.slice(0, amenitySlots - 1) : amenityList;
  const amenityMore = amenityList.length - amenityShown.length;
  const roomCardW = Math.max(104, Math.floor((width - 32 - 16) / 3));

  const enquire = () => {
    Linking.openURL(deskUrl(`Hi, I found ${pg.name} on Zenvy. Could you share current availability and a time to visit?`))
      .catch(() => Alert.alert('WhatsApp is not available', 'Please try again later.'));
  };
  const contactWarden = () => {
    Linking.openURL(deskUrl(`Hi, I have a question for the warden at ${pg.name}.`)).catch(() => Alert.alert('WhatsApp is not available', 'Please try again later.'));
  };
  const share = () => {
    Share.share({ message: `${pg.name}${pg.area ? `, ${pg.area}` : ''} on Zenvy\n${pgLink(pg.id)}` }).catch(() => {});
  };
  const openMaps = () => { if (maps) Linking.openURL(maps).catch(() => Alert.alert('Could not open Maps')); };

  const block = (k: SectionKey, i: number, children: React.ReactNode) => (
    <View key={k} onLayout={onSectionLayout(k)} style={[st.section, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: p.line, marginTop: 32 }]}>
      {children}
    </View>
  );
  const render = (k: SectionKey, i: number) => {
    switch (k) {
      case 'overview':
        return block(k, i, (
          <View>
            <KeyFacts pg={pg} />
            <Highlights items={pg.highlights || []} />
            <About text={pg.description} />
            {/* The icon row above already shows the amenities; the full list only when some did not fit there. */}
            {amenityMore > 0 ? <Amenities items={pg.amenities} /> : null}
            {pg.photos.length > 1 ? <PgPhotoSection sub photos={pg.photos} onOpen={(list, index) => setViewer({ list, index })} /> : null}
            {!hasRooms && pg.videos.length ? <View style={{ marginTop: 24 }}><PgVideoSection videos={pg.videos} roomTypeLabels={roomTypeLabels} /></View> : null}
          </View>
        ));
      case 'rooms':
        return block(k, i, <RoomsSection pg={pg} selectedKey={selected?.key || null} onSelect={setSelectedType} onOpenPhotos={(list, index) => setViewer({ list, index })} roomTypeLabels={roomTypeLabels} />);
      case 'mess':
        return block(k, i, <PgMessSection timetable={pg.messTimetable} />);
      case 'rules':
        return block(k, i, <RulesSection groups={pg.houseRules || []} timings={pg.timings} />);
      case 'policies':
        return block(k, i, <PoliciesSection policies={pg.policies || null} moveIn={pg.moveIn || null} pgDeposit={pg.securityDeposit} />);
      case 'safety':
        return pg.safety ? block(k, i, <SafetySection safety={pg.safety} onContactDesk={contactWarden} />) : null;
      case 'location':
        return block(k, i, <LocationSection pg={pg} guide={pg.locationGuide || null} />);
      case 'faq':
        return block(k, i, <FaqSection items={pg.faq || []} />);
      case 'reviews':
        return block(k, i, (
          <ReviewsSection
            pgId={pg.id}
            summary={summary}
            eligibility={eligibility}
            signedIn={!!user}
            onLoginNeeded={() => promptLogin('Sign in to report a review.')}
            onReviewed={() => load('silent')}
          />
        ));
      default:
        return null;
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <PgHeader
        title={pg.name}
        titleOpacity={titleOpacity}
        right={(
          <Press onPress={share} accessibilityLabel={`Share ${pg.name}`} style={st.headerBtn}>
            <IconShare size={20} color={p.text} strokeWidth={ICON.stroke} />
          </Press>
        )}
      />
      <Animated.ScrollView
        ref={scrollRef as any}
        contentContainerStyle={{ paddingBottom: bottomBarH + 32 }}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        stickyHeaderIndices={[2]}
        onLayout={(e) => { viewport.current.h = e.nativeEvent.layout.height; }}
        onContentSizeChange={(_, h) => { viewport.current.content = h; }}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true, listener: (e: any) => onScrollJS(e.nativeEvent.contentOffset.y) })}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} tintColor={p.sub} colors={[p.accentFill]} />}
      >
        {/* 0: photos (swipe, counter, category quick-jump) */}
        <PgHero photos={heroPhotos} topInset={0} onOpen={(list, index) => setViewer({ list, index })} />

        {/* 1: header card, room type cards, amenities row, my request */}
        <View style={st.pad}>
          <View style={[st.headCard, { backgroundColor: p.card }, p.shadow]}>
            <View style={st.nameRow}>
              <Text style={[st.title, { color: p.text }]} accessibilityRole="header">{pg.name}</Text>
              {pg.isVerified ? <VerifiedTag /> : null}
            </View>
            <View style={st.metaRow}>
              {summary.count > 0 ? (
                <Press onPress={() => goTo('reviews')} accessibilityLabel={`Rated ${ratingText(summary.average)} out of 5 from ${plural(summary.count, 'review')}. Opens reviews`} style={st.ratingBtn}>
                  <IconStar size={14} color={p.star} fill={p.star} strokeWidth={1.5} />
                  <Text style={[ui.small, { color: p.text, fontWeight: '600' }]}>{ratingText(summary.average)}</Text>
                  <Text style={[ui.small, { color: p.sub }]}>({summary.count})</Text>
                </Press>
              ) : null}
              <Text style={[ui.small, { color: p.sub, flexShrink: 1 }]} numberOfLines={1}>{[dist, genderLabel(pg.genderType)].filter(Boolean).join(' · ')}</Text>
            </View>
            {pg.area || pg.address ? (
              <View style={st.addressRow}>
                <IconMapPin size={14} color={p.muted} strokeWidth={2} style={{ marginTop: 2 }} />
                <Text style={[ui.small, { color: p.sub, flex: 1 }]} numberOfLines={2}>{pg.area ? `${pg.area}${pg.address && !pg.address.includes(pg.area) ? ` · ${pg.address}` : ''}` : pg.address}</Text>
                {maps ? (
                  <Press onPress={openMaps} accessibilityRole="link" accessibilityLabel="View on map" style={st.linkBtn}>
                    <Text style={[ui.small, { color: p.accent, fontWeight: '600' }]}>View on map</Text>
                  </Press>
                ) : null}
              </View>
            ) : null}
            <View style={[st.priceRow, { borderTopColor: p.line }]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[st.bigPrice, { color: p.text }]} numberOfLines={1}>
                  {shownRent ? inr(shownRent) : '—'}<Text style={[ui.body, { color: p.sub, fontWeight: '400' }]}> /month</Text>
                </Text>
                <Text style={[ui.small, { color: p.muted }]} numberOfLines={1}>
                  {[selected ? roomTitle(selected) : hasRooms ? 'Rent from' : '', foodIncluded ? 'incl. food' : ''].filter(Boolean).join(' · ') || 'per bed'}
                </Text>
              </View>
            </View>
          </View>

          {myOpen ? (
            <View style={[st.notice, { backgroundColor: myOpen.status === 'Confirmed' ? p.successSoft : p.accentSoft }]} accessibilityLiveRegion="polite">
              <View style={{ flex: 1 }}>
                <Text style={[ui.body, { color: p.text, fontWeight: '600' }]}>{myOpen.status === 'Confirmed' ? 'Your bed is confirmed' : 'Booking request sent'}</Text>
                <Text style={[ui.small, { color: p.sub, marginTop: 2 }]}>
                  {[myOpen.room?.roomNumber ? `Room ${myOpen.room.roomNumber}` : '', myOpen.checkInDate && formatISTDate(myOpen.checkInDate) ? `Move-in ${formatISTDate(myOpen.checkInDate)}` : '', myOpen.status === 'Pending' ? 'The housing team will call you' : ''].filter(Boolean).join(' · ')}
                </Text>
              </View>
              {myOpen.status === 'Pending' ? (
                <Press onPress={cancelMyBooking} disabled={cancelling} accessibilityLabel="Cancel request" style={st.linkBtn}>
                  {cancelling ? <ActivityIndicator color={p.sub} /> : <Text style={[ui.small, { color: p.accent, fontWeight: '600' }]}>Cancel</Text>}
                </Press>
              ) : null}
            </View>
          ) : null}

          {/* Room types as picture cards */}
          {hasRooms ? (
            <View style={{ marginTop: 24 }}>
              <View style={st.blockHead}>
                <Text style={[st.heading, { color: p.text }]} accessibilityRole="header">Room types</Text>
                <Text style={[ui.small, { color: p.muted }]}>Rent per bed</Text>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.roomRow}>
                {roomTypes.map((t) => (
                  <RoomTypeCard key={t.key} t={t} w={roomCardW} photo={photosByType[t.key]?.[0]?.url || null} on={selected?.key === t.key} onPress={() => setSelectedType(t.key)} />
                ))}
              </ScrollView>
            </View>
          ) : null}

          {/* Amenities icon row */}
          {amenityList.length ? (
            <View style={{ marginTop: 24 }}>
              <Text style={[st.heading, { color: p.text, marginBottom: 12 }]} accessibilityRole="header">Amenities</Text>
              <View style={st.amenityRow}>
                {amenityShown.map((a) => {
                  const Icon = amenityIcon(a.raw);
                  return (
                    <View key={a.raw} style={st.amenity} accessible accessibilityLabel={a.label}>
                      <View style={[st.amenityIcon, { backgroundColor: p.accentSoft }]}>
                        <Icon size={18} color={p.accent} strokeWidth={ICON.stroke} />
                      </View>
                      <Text style={[st.amenityText, { color: p.sub }]} numberOfLines={2}>{a.label}</Text>
                    </View>
                  );
                })}
                {amenityMore > 0 ? (
                  <Press onPress={() => goTo('overview')} accessibilityLabel={`See all ${amenityList.length} amenities`} style={st.amenity}>
                    <View style={[st.amenityIcon, { backgroundColor: p.sunken }]}>
                      <Text style={[ui.small, { color: p.text, fontWeight: '700' }]}>+{amenityMore}</Text>
                    </View>
                    <Text style={[st.amenityText, { color: p.sub }]}>More</Text>
                  </Press>
                ) : null}
              </View>
            </View>
          ) : null}
        </View>

        {/* 2: sticky section bar */}
        {sections.length > 1 ? <PgSectionNav sections={sections} active={active} onPress={goTo} /> : <View />}

        {/* 3+: sections */}
        {sections.map((k, i) => render(k, i))}
      </Animated.ScrollView>

      {/* Bottom bar: Enquire + Book now */}
      <View style={[st.bar, { paddingBottom: insets.bottom + 12, backgroundColor: p.card, borderTopColor: p.line }]}>
        <Press onPress={enquire} accessibilityLabel="Enquire with the Zenvy housing desk on WhatsApp" style={[st.barBtn, { borderColor: p.accentFill, borderWidth: 1.5 }]}>
          <IconMessage size={16} color={p.accent} strokeWidth={ICON.stroke} />
          <Text style={[ui.btnLabel, { color: p.accent }]}>Enquire</Text>
        </Press>
        {myOpen ? (
          <View style={[st.barBtn, { backgroundColor: p.sunken }]} accessibilityLabel={myOpen.status === 'Confirmed' ? 'Booked' : 'Request sent'}>
            <Text style={[ui.btnLabel, { color: p.sub }]}>{myOpen.status === 'Confirmed' ? 'Booked' : 'Request sent'}</Text>
          </View>
        ) : (
          <Press onPress={openSummary} disabled={!selected} accessibilityLabel={selected ? `Book now, ${roomTitle(selected)}` : hasRooms ? 'No beds available' : 'Rooms not listed yet'} style={[st.barBtn, { backgroundColor: p.accentFill }]}>
            <Text style={[ui.btnLabel, { color: '#fff' }]}>{selected ? 'Book now' : hasRooms ? 'Full' : 'Rooms not listed yet'}</Text>
          </Press>
        )}
      </View>

      {summaryOpen && selected ? (
        <BookingSummary
          pg={pg}
          bookable={bookable}
          selected={selected}
          onSelect={setSelectedType}
          cover={heroPhotos[0]?.url || null}
          photosByType={photosByType}
          checkInOptions={checkInOptions}
          checkInDate={checkInDate}
          onDate={setCheckInDate}
          sending={sending}
          onSend={sendRequest}
          onClose={() => !sending && setSummaryOpen(false)}
        />
      ) : null}

      {viewer ? <PhotoViewer photos={viewer.list} index={viewer.index} onClose={() => setViewer(null)} /> : null}
    </View>
  );
}

function RoomTypeCard({ t, w, photo, on, onPress }: { t: PgRoomType; w: number; photo: string | null; on: boolean; onPress: () => void }) {
  const p = usePgPalette();
  const full = !t.bookRoomId;
  const h = Math.round(w * 0.72);
  return (
    <Press
      onPress={full ? undefined : onPress}
      disabled={full}
      accessibilityRole="button"
      accessibilityState={{ selected: on, disabled: full }}
      accessibilityLabel={`${roomTitle(t)}, ${rentText(t)} a month${full ? ', full' : ''}`}
      style={[st.roomCard, { width: w, backgroundColor: p.card, borderColor: on ? p.accentFill : 'transparent' }, p.shadow, full && { opacity: 0.55 }]}
    >
      <View>
        {photo ? (
          <PgImage uri={photo} style={{ width: w - 4, height: h, borderTopLeftRadius: 12, borderTopRightRadius: 12 }} recyclingKey={`rtc-${t.key}`} priority="low" />
        ) : (
          // No photo for this room type: a quiet bed mark (never another room's photo).
          <View style={{ width: w - 4, height: h, borderTopLeftRadius: 12, borderTopRightRadius: 12, backgroundColor: p.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
            <IconBed size={26} color={p.accent} strokeWidth={ICON.stroke} />
            <Text style={[ui.small, { color: p.accent, marginTop: 4 }]}>{t.sharingType === 1 ? '1 bed' : `${t.sharingType} beds`} / room</Text>
          </View>
        )}
        {on ? (
          <View style={[st.roomCheck, { backgroundColor: p.accentFill }]}>
            <IconCheck size={12} color="#fff" strokeWidth={3} />
          </View>
        ) : null}
      </View>
      <View style={{ padding: 8 }}>
        <Text style={[ui.small, { color: p.text, fontWeight: '600' }]} numberOfLines={1}>{roomTitle(t)}</Text>
        <Text style={[ui.small, { color: on ? p.accent : p.sub, fontWeight: on ? '600' : '400' }]} numberOfLines={1}>{full ? 'Full' : `${rentText(t)}/mo`}</Text>
      </View>
    </Press>
  );
}

// ── Booking summary (full screen; Android back closes it) ─────────────────────────────────────────
function BookingSummary({ pg, bookable, selected, onSelect, cover, photosByType, checkInOptions, checkInDate, onDate, sending, onSend, onClose }: {
  pg: PgDetail; bookable: PgRoomType[]; selected: PgRoomType; onSelect: (k: string) => void; cover: string | null;
  photosByType: Record<string, PgPhoto[]>; checkInOptions: { ymd: string; top: string; bottom: string }[];
  checkInDate: string; onDate: (ymd: string) => void; sending: boolean; onSend: () => void; onClose: () => void;
}) {
  const p = usePgPalette();
  const insets = useSafeAreaInsets();
  const pol = pg.policies || null;
  const rent = Number(selected.rentFrom) || 0;
  const deposit = Number(selected.deposit ?? pol?.deposit?.amount ?? pg.securityDeposit) || 0;
  const token = Number(pol?.booking?.tokenAmount) || 0;
  const foodIncluded = !!pol?.included?.includes('food');
  const refundable = typeof pol?.deposit?.refundDays === 'number';
  const methods = (pol?.rent?.methods || []).map((m) => METHOD_LABEL[m]).filter(Boolean);
  const lockIn = pol?.stay?.lockInMonths;
  const notice = pol?.stay?.noticeMonths;
  const summary = pg.reviewSummary || { average: null, count: 0 };
  const rangeRent = selected.rentTo !== null && selected.rentTo !== selected.rentFrom;

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} statusBarTranslucent presentationStyle="fullScreen">
      <View style={{ flex: 1, backgroundColor: p.bg, paddingTop: insets.top }}>
        <View style={[st.sumHead, { backgroundColor: p.card, borderBottomColor: p.line }]}>
          <Press onPress={onClose} disabled={sending} accessibilityLabel="Back to the PG" style={st.headerBtn}>
            <IconArrowLeft size={22} color={p.text} strokeWidth={ICON.stroke} />
          </Press>
          <Text style={[st.heading, { color: p.text, flex: 1 }]} accessibilityRole="header">Booking summary</Text>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 + insets.bottom }} showsVerticalScrollIndicator={false}>
          {/* PG */}
          <View style={[st.sumCard, st.pgRow, { backgroundColor: p.card }, p.shadow]}>
            <PgImage uri={cover} style={{ width: 72, height: 72, borderRadius: 12 }} recyclingKey={`sum-${pg.id}`} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[ui.body, { color: p.text, fontWeight: '700' }]} numberOfLines={1}>{pg.name}</Text>
              {pg.area || pg.address ? <Text style={[ui.small, { color: p.sub, marginTop: 2 }]} numberOfLines={1}>{pg.area || pg.address}</Text> : null}
              <View style={[st.metaRow, { marginTop: 4 }]}>
                {summary.count > 0 ? (
                  <>
                    <IconStar size={12} color={p.star} fill={p.star} strokeWidth={1.5} />
                    <Text style={[ui.small, { color: p.text, fontWeight: '600' }]}>{ratingText(summary.average)}</Text>
                    <Text style={[ui.small, { color: p.muted }]}>({summary.count})</Text>
                  </>
                ) : null}
                <Text style={[ui.small, { color: p.sub }]}>{genderLabel(pg.genderType)}</Text>
              </View>
            </View>
          </View>

          {/* Room type */}
          <Label text="Room type" icon={IconBed} />
          <View style={[st.sumCard, { backgroundColor: p.card, paddingVertical: 4 }, p.shadow]}>
            {bookable.map((t, i) => {
              const on = t.key === selected.key;
              return (
                <Press key={t.key} onPress={() => onSelect(t.key)} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`${roomTitle(t)}, ${rentText(t)} a month`}
                  style={[st.optRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: p.line }]}>
                  <View style={[st.radio, { borderColor: on ? p.accentFill : p.line }]}>
                    {on ? <View style={[st.radioDot, { backgroundColor: p.accentFill }]} /> : null}
                  </View>
                  {photosByType[t.key]?.[0] ? <PgImage uri={photosByType[t.key][0].url} style={{ width: 40, height: 40, borderRadius: 8 }} recyclingKey={`sumr-${t.key}`} priority="low" /> : null}
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[ui.body, { color: p.text, fontWeight: on ? '600' : '400' }]} numberOfLines={1}>{roomTitle(t)}</Text>
                    <Text style={[ui.small, { color: p.muted }]} numberOfLines={2}>{roomFacts(t)}</Text>
                  </View>
                  <Text style={[ui.body, { color: on ? p.accent : p.text, fontWeight: '600' }]}>{rentText(t)}</Text>
                </Press>
              );
            })}
          </View>

          {/* Move-in date */}
          <Label text="Move-in date" icon={IconCalendarDays} detail={prettyDate(checkInDate)} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
            {checkInOptions.map((o) => {
              const on = o.ymd === checkInDate;
              return (
                <Press key={o.ymd} onPress={() => onDate(o.ymd)} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`${o.top}, ${o.bottom}`}
                  style={[st.dateChip, { backgroundColor: on ? p.accentFill : p.card }, !on && p.shadow]}>
                  <Text style={[ui.small, { color: on ? 'rgba(255,255,255,0.85)' : p.sub }]}>{o.top}</Text>
                  <Text style={[ui.small, { color: on ? '#fff' : p.text, fontWeight: '700', marginTop: 2 }]}>{o.bottom}</Text>
                </Press>
              );
            })}
          </ScrollView>
          {typeof lockIn === 'number' || typeof notice === 'number' ? (
            <Text style={[ui.small, { color: p.sub, marginTop: 8 }]}>
              {[typeof lockIn === 'number' && lockIn > 0 ? `Minimum stay ${months(lockIn).toLowerCase()}` : '', typeof notice === 'number' && notice > 0 ? `${months(notice).toLowerCase()} notice to move out` : ''].filter(Boolean).join(' · ') || 'No minimum stay'}
            </Text>
          ) : null}

          {/* Price breakdown */}
          <Label text="Price breakdown" icon={IconClipboard} />
          <View style={[st.sumCard, { backgroundColor: p.card }, p.shadow]}>
            <Row label="Monthly rent" value={`${rangeRent ? rentText(selected) : inr(rent)}`} />
            {foodIncluded ? <Row label="Food" value="Included in rent" /> : null}
            <Row label={refundable ? 'Security deposit (refundable)' : 'Security deposit'} value={deposit > 0 ? inr(deposit) : 'None'} />
            {token > 0 ? <Row label="Token to hold the bed" value={`${inr(token)}`} detail="Adjusted against your first payment" /> : null}
            <Divider />
            <Row label="First payment at move-in" value={rangeRent ? `from ${inr(rent + deposit)}` : inr(rent + deposit)} strong detail="First month's rent plus the deposit" />
          </View>

          {/* Payment */}
          <Label text="Payment" icon={IconWallet} />
          <View style={[st.sumCard, { backgroundColor: p.card }, p.shadow]}>
            <Text style={[ui.body, { color: p.text, fontWeight: '600' }]}>Pay at the PG</Text>
            <Text style={[ui.small, { color: p.sub, marginTop: 4 }]}>
              {methods.length ? `Pay rent and the deposit at the PG by ${listText(methods)}. ` : 'Pay rent and the deposit at the PG. '}Nothing is charged in the app.
            </Text>
          </View>

          {/* What happens next */}
          <Label text="What happens next" />
          <View style={[st.sumCard, { backgroundColor: p.card, gap: 12 }, p.shadow]}>
            {[
              'Send your booking request.',
              pol?.booking?.confirmation || 'The Zenvy housing team calls you to confirm the bed and your move-in date.',
              'Move in on your date and pay at the PG.',
            ].map((t, i) => (
              <View key={i} style={st.stepRow}>
                <View style={[st.stepNum, { backgroundColor: p.accentSoft }]}><Text style={[ui.small, { color: p.accent, fontWeight: '700' }]}>{i + 1}</Text></View>
                <Text style={[ui.body, { color: p.text, flex: 1 }]}>{t}</Text>
              </View>
            ))}
          </View>
        </ScrollView>

        <View style={[st.sumBar, { paddingBottom: insets.bottom + 12, backgroundColor: p.card, borderTopColor: p.line }]}>
          <Press onPress={onSend} disabled={sending} accessibilityLabel="Send booking request" accessibilityState={{ busy: sending }} style={[st.sumCta, { backgroundColor: p.accentFill }]}>
            {sending ? <ActivityIndicator color="#fff" /> : <Text style={[ui.btnLabel, { color: '#fff' }]}>Send booking request</Text>}
          </Press>
        </View>
      </View>
    </Modal>
  );
}

function Label({ text, icon: Icon, detail }: { text: string; icon?: React.ComponentType<any>; detail?: string }) {
  const p = usePgPalette();
  return (
    <View style={st.label}>
      {Icon ? <Icon size={16} color={p.accent} strokeWidth={ICON.stroke} /> : null}
      <Text style={[ui.body, { color: p.text, fontWeight: '700', flex: 1 }]} accessibilityRole="header">{text}</Text>
      {detail ? <Text style={[ui.small, { color: p.sub }]}>{detail}</Text> : null}
    </View>
  );
}

function Row({ label, value, strong, detail }: { label: string; value: string; strong?: boolean; detail?: string }) {
  const p = usePgPalette();
  return (
    <View style={st.sumRow} accessible accessibilityLabel={`${label}: ${value}${detail ? `. ${detail}` : ''}`}>
      <View style={{ flex: 1 }}>
        <Text style={[ui.body, { color: strong ? p.text : p.sub, fontWeight: strong ? '700' : '400' }]}>{label}</Text>
        {detail ? <Text style={[ui.small, { color: p.muted, marginTop: 2 }]}>{detail}</Text> : null}
      </View>
      <Text style={[strong ? st.total : ui.body, { color: p.text, fontWeight: strong ? '700' : '600' }]}>{value}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  headerBtn: { width: 44, height: 48, alignItems: 'center', justifyContent: 'center' },
  pad: { paddingHorizontal: 16, paddingBottom: 16 },
  section: { marginHorizontal: 16, paddingTop: 32 },
  title: { fontSize: TYPE.title, fontWeight: '700', letterSpacing: -0.2, flexShrink: 1 },
  heading: { fontSize: TYPE.heading, fontWeight: '700' },

  headCard: { borderRadius: 20, padding: 16, marginTop: 16 },
  nameRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  ratingBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 24, minWidth: 0 },
  addressRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 6 },
  linkBtn: { minHeight: 24, minWidth: 0, paddingHorizontal: 4, justifyContent: 'center' },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth },
  bigPrice: { fontSize: 24, fontWeight: '700', letterSpacing: -0.3 },
  shareBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, borderRadius: 18, paddingHorizontal: 14 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, paddingLeft: 16, borderRadius: 14, marginTop: 16 },

  blockHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 },
  roomRow: { gap: 8, paddingVertical: 6, paddingRight: 16 },
  roomCard: { borderRadius: 14, borderWidth: 2, overflow: 'hidden' },
  roomCheck: { position: 'absolute', top: 6, right: 6, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  amenityRow: { flexDirection: 'row', justifyContent: 'space-between' },
  amenity: { width: 60, alignItems: 'center', minHeight: 0 },
  amenityIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  amenityText: { fontSize: 11, textAlign: 'center', marginTop: 6, lineHeight: 14 },

  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  barBtn: { flex: 1, minHeight: 52, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },

  sumHead: { flexDirection: 'row', alignItems: 'center', paddingRight: 16, minHeight: 56, borderBottomWidth: StyleSheet.hairlineWidth },
  sumCard: { borderRadius: 16, padding: 14 },
  pgRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  label: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 24, marginBottom: 10 },
  optRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingVertical: 8 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  dateChip: { width: 72, minHeight: 56, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  sumRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  total: { fontSize: TYPE.heading },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  stepNum: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  sumBar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  sumCta: { minHeight: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
});
