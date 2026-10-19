/**
 * PG detail. Top to bottom: photos (with category quick-jump), name and key place facts, a sticky
 * section bar (Overview · Rooms · Mess · Rules · Policies · Safety · Location · FAQ · Reviews, only the
 * sections this PG has; it follows the scroll and jumps on tap), then the sections themselves.
 * A bar at the bottom keeps the rent and two actions in reach: Enquire (WhatsApp the Zenvy housing desk;
 * no personal numbers are shown) and Request a bed (POST /api/pg/:roomId/book; nothing is charged in
 * the app). Data: GET /api/pg/:id (backend/utils/pgContent.publicPg); live-synced on 'pg' events.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, Linking, Alert, Modal, ActivityIndicator, useWindowDimensions, Platform, Animated, Share, type LayoutChangeEvent } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { API_URL, ENDPOINTS, ZENVY_SUPPORT_WHATSAPP } from '../../constants/api';
import { apiFetch, readJson } from '../../utils/auth';
import { useLiveSync } from '../../utils/useLiveSync';
import { useAuth } from '../../context/AuthContext';
import {
  distanceLabel, genderLabel, inr, mapsUrl, pgLink, plural, ratingText, sectionsOf,
  type MyPgBooking, type PgDetail, type PgPhoto, type PgReviewEligibility, type SectionKey,
} from '../../modules/pg/pgApi';
import {
  usePgPalette, PgHeader, Press, Divider, Skeleton, StateMessage, PG_HOME, TYPE,
  IconBadgeCheck, IconMessage, IconAlert, IconShare, IconStar, IconMapPin, ICON, s as ui,
} from '../../modules/pg/ui';
import { PgHero, PgPhotoSection, PhotoViewer } from '../../modules/pg/PgGallery';
import { PgVideoSection } from '../../modules/pg/PgVideos';
import { PgMessSection } from '../../modules/pg/PgMess';
import { PgSectionNav, SECTION_NAV_H } from '../../modules/pg/PgSectionNav';
import { RoomsSection, roomTitle } from '../../modules/pg/PgRooms';
import { KeyFacts, Highlights, About, Amenities, RulesSection, PoliciesSection, SafetySection, LocationSection, FaqSection } from '../../modules/pg/PgSections';
import { ReviewsSection } from '../../modules/pg/PgReviews';

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
const deskUrl = (text: string) => `https://wa.me/${ZENVY_SUPPORT_WHATSAPP.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;

export default function PGDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
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
  const [sheetOpen, setSheetOpen] = useState(false);
  const [checkInOptions] = useState(buildCheckInOptions);
  const [checkInDate, setCheckInDate] = useState(() => toLocalYmd(new Date()));
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
      if (res.ok && data && data.id) { setPg(data); setLoadError(null); }
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

  const promptLogin = (why = 'Log in to send a booking request.') => Alert.alert('Log in to continue', why, [
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
        if (data?.code === 'BOOKING_EXISTS') { loadMine(); setSheetOpen(false); }
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
    return (
      <View style={{ flex: 1, backgroundColor: p.bg }}>
        <PgHeader />
        <View accessibilityLabel="Loading PG" accessibilityRole="progressbar">
          <Skeleton style={{ width, height: heroH, borderRadius: 0 }} />
          <View style={{ padding: 16 }}>
            <Skeleton style={{ width: '70%', height: 24 }} />
            <Skeleton style={{ width: '50%', height: 14, marginTop: 12 }} />
            <Skeleton style={{ width: '100%', height: 40, marginTop: 24, borderRadius: 8 }} />
            <Skeleton style={{ width: '100%', height: 72, marginTop: 24, borderRadius: 12 }} />
            <Skeleton style={{ width: '60%', height: 14, marginTop: 24 }} />
            <Skeleton style={{ width: '80%', height: 14, marginTop: 12 }} />
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
  const barRent = selected?.rentFrom ?? rentFrom;
  const myOpen = myBooking && (myBooking.status === 'Pending' || myBooking.status === 'Confirmed') ? myBooking : null;
  const hasRooms = roomTypes.length > 0;
  const bottomBarH = 72 + insets.bottom;
  const summary = pg.reviewSummary || { average: null, count: 0 };
  const showLocation = sections.includes('location');
  const maps = mapsUrl(pg);
  const meta = [genderLabel(pg.genderType), pg.area, distanceLabel(pg.distanceFromCollege)].filter(Boolean).join(' · ');

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
            <Amenities items={pg.amenities} />
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
            onLoginNeeded={() => promptLogin('Log in to report a review.')}
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
        {/* 0: photos */}
        <PgHero photos={heroPhotos} topInset={0} onOpen={(list, index) => setViewer({ list, index })} />

        {/* 1: name, place, rating, my request */}
        <View style={st.pad}>
          <Text style={[st.title, { color: p.text }]} accessibilityRole="header">{pg.name}</Text>
          <View style={st.metaRow}>
            {pg.isVerified ? (
              <View style={st.verified} accessibilityLabel="Verified by the Zenvy housing team">
                <IconBadgeCheck size={14} color={p.success} strokeWidth={2} />
                <Text style={[ui.small, { color: p.success, fontWeight: '600' }]}>Verified</Text>
              </View>
            ) : null}
            <Text style={[ui.small, { color: p.sub, flexShrink: 1 }]} numberOfLines={2}>{meta}</Text>
          </View>
          {summary.count > 0 ? (
            <Press onPress={() => goTo('reviews')} accessibilityLabel={`Rated ${ratingText(summary.average)} out of 5 from ${plural(summary.count, 'review')}. Opens reviews`} style={st.ratingRow}>
              <IconStar size={14} color={p.text} fill={p.text} strokeWidth={1.5} />
              <Text style={[ui.body, { color: p.text, fontWeight: '600' }]}>{ratingText(summary.average)}</Text>
              <Text style={[ui.body, { color: p.sub, textDecorationLine: 'underline' }]}>{plural(summary.count, 'review')}</Text>
            </Press>
          ) : null}
          {!showLocation && pg.address ? (
            <View style={st.addressRow}>
              <IconMapPin size={16} color={p.sub} strokeWidth={ICON.stroke} style={{ marginTop: 2 }} />
              <Text style={[ui.body, { color: p.text, flex: 1 }]}>{pg.address}</Text>
              {maps ? (
                <Press onPress={() => Linking.openURL(maps).catch(() => Alert.alert('Could not open Maps'))} accessibilityRole="link" accessibilityLabel="Open in Maps" style={st.textBtn}>
                  <Text style={[ui.small, { color: p.text, fontWeight: '600' }]}>Open in Maps</Text>
                </Press>
              ) : null}
            </View>
          ) : null}

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

        {/* 2: sticky section bar */}
        {sections.length > 1 ? <PgSectionNav sections={sections} active={active} onPress={goTo} /> : <View />}

        {/* 3+: sections */}
        {sections.map((k, i) => render(k, i))}
      </Animated.ScrollView>

      {/* Bottom bar */}
      <View style={[st.bar, { paddingBottom: insets.bottom + 12, backgroundColor: p.bg, borderTopColor: p.line }]}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[ui.small, { color: p.sub }]} numberOfLines={1}>{selected ? roomTitle(selected) : 'Rent from'}</Text>
          <Text style={[st.barPrice, { color: p.text }]} numberOfLines={1}>{barRent ? inr(barRent) : '—'}<Text style={[ui.small, { color: p.sub, fontWeight: '400' }]}>/month</Text></Text>
        </View>
        <Press onPress={enquire} accessibilityLabel="Enquire with the Zenvy housing desk on WhatsApp" style={[st.barBtn, { borderColor: p.line, borderWidth: 1 }]}>
          <IconMessage size={16} color={p.text} strokeWidth={ICON.stroke} />
          <Text style={[ui.btnLabel, { color: p.text }]}>Enquire</Text>
        </Press>
        {myOpen ? (
          <View style={[st.barBtn, { backgroundColor: p.sunken }]} accessibilityLabel={myOpen.status === 'Confirmed' ? 'Booked' : 'Request sent'}>
            <Text style={[ui.btnLabel, { color: p.sub }]}>{myOpen.status === 'Confirmed' ? 'Booked' : 'Requested'}</Text>
          </View>
        ) : (
          <Press onPress={openRequest} disabled={!selected} accessibilityLabel={selected ? 'Request a bed' : hasRooms ? 'No beds free' : 'Rooms not listed yet'} style={[st.barBtn, { backgroundColor: p.accentFill }]}>
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
            <Text style={[ui.small, { color: p.sub, marginTop: 4 }]} numberOfLines={1}>{pg.name}</Text>

            {bookable.length > 1 ? (
              <>
                <Text style={[st.sheetLabel, { color: p.sub }]}>Room</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                  {bookable.map((t) => {
                    const on = selected?.key === t.key;
                    return (
                      <Press key={t.key} onPress={() => setSelectedType(t.key)} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`${roomTitle(t)}, ${inr(t.rentFrom)} a month`}
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
            <Text style={[ui.small, { color: p.muted, marginTop: 12 }]}>Nothing is charged in the app. The Zenvy housing team will call you to confirm, and you pay at the PG.</Text>

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

function SummaryRow({ label, value }: { label: string; value: string }) {
  const p = usePgPalette();
  return (
    <View style={st.summaryRow}>
      <Text style={[ui.small, { color: p.muted, width: 84 }]}>{label}</Text>
      <Text style={[ui.body, { color: p.text, flex: 1, textAlign: 'right' }]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  headerBtn: { width: 44, height: 48, alignItems: 'center', justifyContent: 'center' },
  pad: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 16 },
  section: { marginHorizontal: 16, paddingTop: 32 },
  title: { fontSize: TYPE.title, fontWeight: '700', letterSpacing: -0.2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  verified: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  addressRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 8 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, paddingLeft: 16, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, marginTop: 16 },
  textBtn: { paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' },
  table: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, minHeight: 44, paddingVertical: 10 },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  barPrice: { fontSize: TYPE.heading, fontWeight: '700', marginTop: 2 },
  barBtn: { minHeight: 48, paddingHorizontal: 16, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingHorizontal: 16, paddingTop: 8, ...(Platform.OS === 'android' ? { elevation: 12 } : {}) },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, marginBottom: 12 },
  sheetTitle: { fontSize: TYPE.heading, fontWeight: '700' },
  sheetLabel: { fontSize: TYPE.small, fontWeight: '600', marginTop: 16, marginBottom: 8 },
  option: { minHeight: 52, minWidth: 104, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, justifyContent: 'center' },
  dateChip: { width: 76, minHeight: 52, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  primary: { minHeight: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 16 },
});
