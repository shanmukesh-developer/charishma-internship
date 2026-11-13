// Local tab (owner, 10 Nov 2026, from the approved replica docs/prototypes/local-tab-2026-11-10): only the folder-tab
// switch comes from Home; In-Campus | Local sit where Home has Non-veg | Veg. Very light colours that follow the diet
// picked on Home (components/local/dietLightTheme). In-Campus lists every campus counter (GET
// /api/campus-booking/stalls) as simple rows; Local shows the stalls near campus (components/CampusBitesSection, page
// layout). Real data only: no sample counters or stalls.
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Animated, Platform, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import TabBackButton from '../../components/TabBackButton';
import SafeImage from '../../components/SafeImage';
import CampusBitesSection, { type CampusBitesSectionHandle } from '../../components/CampusBitesSection';
import { FloatingBasketBar, FloatingBasketButton } from '../../components/FloatingBasket';
import { FlareCorner } from '../../components/home/HomeRedesign2026';
import { useDietLight } from '../../components/local/dietLightTheme';
import { useTheme } from '../../context/ThemeContext';
import { type BasketKind } from '../../context/CartContext';
import { cbApi, type CbStall } from '../../modules/campusBooking/cbApi';
import { hhmm12 } from '../../modules/campusBooking/cbTheme';
import { useCbSignIn } from '../../modules/campusBooking/cbKit';
import { resolveMediaUrl } from '../../utils/imageUpload';
import { peekCache, RESTAURANTS_CACHE_KEY } from '../../utils/swrCache';
import { useTopInset } from '../../utils/useTopInset';

const EMPTY: any[] = [];
const IMG_H = 84;
type LocalTabKey = 'campus' | 'local';
let counterMemo: CbStall[] | null = null;

/** One counter as a simple row: photo with the logo on its corner, name, type, place, open state. */
function CounterRow({ s, onPress }: { s: CbStall; onPress: () => void }) {
  const d = useDietLight();
  const { colors } = useTheme();
  const img = resolveMediaUrl(s.imageUrl) || resolveMediaUrl(s.logoUrl);
  const logo = s.imageUrl ? resolveMediaUrl(s.logoUrl) : null;
  const opens = hhmm12(s.opensAt);
  const closes = hhmm12(s.closesAt);
  const status = s.isOpen ? (closes ? `Open · closes ${closes}` : 'Open now') : opens ? `Closed · opens ${opens}` : 'Closed now';
  const type = [s.categoryLabel, s.tags?.[0]].filter(Boolean).join(' · ');
  // Owner, 13 Nov 2026 ("image ki ratio petu"): the photo keeps its own shape instead of being cropped to a square
  // ("ESCAF"): the frame is 84 px tall and as wide as the photo's ratio allows (square up to 16:9).
  const [ratio, setRatio] = useState(1);
  const frameW = Math.round(IMG_H * ratio);
  const frame = { width: frameW, height: IMG_H };
  return (
    <TouchableOpacity activeOpacity={0.9} onPress={onPress} style={[st.row, { backgroundColor: d.isDark ? colors.card : '#FFFFFF', borderColor: d.line }]} accessibilityRole="button" accessibilityLabel={`${s.name}. ${status}`}>
      <View style={[st.rowImgWrap, frame]}>
        <View style={[st.rowImgFrame, frame, { borderColor: d.isDark ? 'rgba(255,255,255,0.12)' : d.line, backgroundColor: d.soft }]}>
          {img ? <SafeImage source={{ uri: img }} style={frame} contentFit="cover" maxWidth={320} placeholderIcon="storefront-outline"
            onLoad={(e: any) => { const w = e?.source?.width; const h = e?.source?.height; if (w > 0 && h > 0) setRatio(Math.min(16 / 9, Math.max(1, w / h))); }} /> : (
            <View style={[frame, { alignItems: 'center', justifyContent: 'center' }]}><Ionicons name="storefront-outline" size={28} color={d.acc} /></View>
          )}
        </View>
        {logo ? <SafeImage source={{ uri: logo }} style={[st.rowLogo, { borderColor: d.isDark ? colors.card : '#FFFFFF' }]} maxWidth={80} placeholderIcon="storefront-outline" /> : null}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[st.rowName, { color: colors.text }]} numberOfLines={1}>{s.name}</Text>
        {type ? <Text style={[st.rowMeta, { color: colors.textSecondary }]} numberOfLines={1}>{type}</Text> : null}
        {s.location ? <Text style={[st.rowMeta, { color: colors.textSecondary }]} numberOfLines={1}>{s.location}</Text> : null}
        <View style={st.pills}>
          {/* Owner, 10 Nov 2026: no green - open uses the diet accent, closed is plain grey. */}
          <View style={[st.pill, { backgroundColor: s.isOpen ? d.soft : (d.isDark ? 'rgba(255,255,255,0.06)' : '#F2F3F6') }]}><Text style={[st.pillText, { color: s.isOpen ? d.acc : colors.textSecondary }]}>{status}</Text></View>
          {s.itemCount === 0 ? <View style={[st.pill, { backgroundColor: d.isDark ? 'rgba(255,255,255,0.06)' : '#F2F3F6' }]}><Text style={[st.pillText, { color: colors.textSecondary }]}>Menu coming soon</Text></View> : null}
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default function LocalScreen() {
  const router = useRouter();
  const d = useDietLight();
  const { isDark, colors } = useTheme();
  const topPad = useTopInset();
  const { requireSignIn } = useCbSignIn();
  const [tab, setTab] = useState<LocalTabKey>('campus');
  const pop = useRef(new Animated.Value(1)).current;
  const [query, setQuery] = useState('');
  const [counters, setCounters] = useState<CbStall[] | null>(counterMemo);
  const [counterError, setCounterError] = useState<string | null>(null);
  const [seed] = useState<any[]>(() => peekCache<any[]>(RESTAURANTS_CACHE_KEY) || EMPTY);
  const stallsRef = useRef<CampusBitesSectionHandle>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadCounters = useCallback(async () => {
    try {
      const r = await cbApi.stalls();
      counterMemo = r.stalls || [];
      setCounters(counterMemo);
      setCounterError(null);
    } catch (e: any) {
      setCounterError(e?.message || 'Could not load the counters.');
    }
  }, []);
  const [focusedAt, setFocusedAt] = useState(() => Date.now());
  useFocusEffect(useCallback(() => { setFocusedAt(Date.now()); void loadCounters(); }, [loadCounters]));
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await Promise.all([loadCounters(), stallsRef.current?.refresh()]); } finally { setRefreshing(false); }
  }, [loadCounters]);
  const openBasket = useCallback((kind: BasketKind) => router.push(`/(tabs)/basket?basket=${kind}` as any), [router]);

  const switchTab = (t: LocalTabKey) => {
    if (t === tab) return;
    setTab(t);
    pop.setValue(0.95);
    Animated.spring(pop, { toValue: 1, friction: 4, tension: 160, useNativeDriver: true }).start();
  };

  const q = query.trim().toLowerCase();
  const shown = useMemo(() => (counters || []).filter((s) => !q || `${s.name} ${s.categoryLabel} ${(s.tags || []).join(' ')}`.toLowerCase().includes(q)), [counters, q]);
  const campusName = counters?.find((s) => s.location)?.location || null;
  const txt = colors.text;

  const tabBtn = (key: LocalTabKey, label: string, icon: React.ComponentProps<typeof Ionicons>['name'], count?: number) => {
    const on = tab === key;
    return (
      <Animated.View style={[{ flex: 1 }, on && { transform: [{ scale: pop }] }]}>
        <TouchableOpacity activeOpacity={0.9} onPress={() => switchTab(key)} accessibilityRole="tab" accessibilityState={{ selected: on }}
          style={[st.tab, on ? { backgroundColor: d.sel, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingVertical: 11 } : { backgroundColor: d.un, borderRadius: 14, marginBottom: 7, paddingVertical: 9 }]}>
          {on ? <FlareCorner side="left" size={key === 'campus' ? 14 : 12} fill={d.sel} bg={d.top} /> : null}
          {on ? <FlareCorner side="right" size={key === 'campus' ? 12 : 14} fill={d.sel} bg={d.top} /> : null}
          <View style={[st.tabIc, { backgroundColor: on ? d.acc : 'rgba(255,255,255,0.6)' }]}><Ionicons name={icon} size={13} color={on ? '#FFFFFF' : d.dk} /></View>
          <Text style={[st.tabText, { color: on ? d.dk : d.dk, opacity: on ? 1 : 0.6 }]}>{label}</Text>
          {count ? <View style={[st.tabCnt, { backgroundColor: on ? d.acc : 'rgba(255,255,255,0.6)' }]}><Text style={[st.tabCntText, { color: on ? '#FFFFFF' : d.dk }]}>{count}</Text></View> : null}
        </TouchableOpacity>
      </Animated.View>
    );
  };

  return (
    <View style={[st.container, { backgroundColor: d.page }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={d.acc} colors={[d.acc]} />}
      >
        <View style={[st.hero, { backgroundColor: d.top, paddingTop: topPad }]}>
          <View style={st.head}>
            <TabBackButton />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[st.title, { color: d.dk }]} accessibilityRole="header">Local</Text>
              {campusName ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                  <Ionicons name="location-outline" size={12} color={d.dk} style={{ opacity: 0.7 }} />
                  <Text style={[st.sub, { color: d.dk }]} numberOfLines={1}>{campusName}</Text>
                </View>
              ) : null}
            </View>
            <TouchableOpacity style={[st.mine, { backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : '#FFFFFF' }]} onPress={() => { if (requireSignIn('Sign in to see your bookings')) router.push('/campus-booking/bookings' as any); }} accessibilityRole="button" accessibilityLabel="Your bookings">
              <Ionicons name="receipt-outline" size={15} color={d.acc} />
              <Text style={[st.mineText, { color: txt }]}>Bookings</Text>
            </TouchableOpacity>
          </View>
          <View style={st.tabs} accessibilityRole="tablist">
            {tabBtn('campus', 'In-Campus', 'business-outline', counters?.length || undefined)}
            {tabBtn('local', 'Local', 'storefront-outline')}
          </View>
          <View style={[st.panel, { backgroundColor: d.sel }]}>
            {tab === 'campus' ? (
              <View style={[st.search, { backgroundColor: isDark ? colors.card : '#FFFFFF', borderColor: d.line }]}>
                <Ionicons name="search" size={16} color={colors.textSecondary} />
                <TextInput value={query} onChangeText={setQuery} placeholder="Search counters" placeholderTextColor={colors.textSecondary} style={[st.searchInput, { color: txt }]} returnKeyType="search" autoCorrect={false} accessibilityLabel="Search counters" />
                {query ? <TouchableOpacity onPress={() => setQuery('')} accessibilityLabel="Clear search"><Ionicons name="close-circle" size={17} color={colors.textSecondary} /></TouchableOpacity> : null}
              </View>
            ) : null}
            <View style={st.info}>
              {(tab === 'campus' ? ['Book ahead', 'Pick up at the counter'] : ['Stalls deliver themselves', 'Pay cash to the stall']).map((t) => (
                <View key={t} style={st.infoItem}><View style={[st.infoDot, { backgroundColor: d.acc }]} /><Text style={[st.infoText, { color: d.dk }]}>{t}</Text></View>
              ))}
            </View>
          </View>
        </View>

        {tab === 'campus' ? (
          <View>
            <View style={st.sh}>
              <Text style={[st.shTitle, { color: txt }]}>All counters</Text>
              {counters ? <Text style={[st.shCount, { color: d.acc }]}>{`${shown.length} ${shown.length === 1 ? 'counter' : 'counters'}`}</Text> : null}
            </View>
            <View style={st.list}>
              {!counters && !counterError ? <Text style={[st.note, { color: colors.textSecondary }]}>Loading counters…</Text> : null}
              {counterError && !counters ? (
                <TouchableOpacity onPress={loadCounters} style={[st.empty, { borderColor: d.acc }]}><Text style={[st.emptyTitle, { color: txt }]}>Couldn't load the counters</Text><Text style={[st.note, { color: d.acc }]}>Tap to try again</Text></TouchableOpacity>
              ) : null}
              {counters && !shown.length ? (
                <View style={[st.empty, { borderColor: d.acc }]}><Text style={[st.emptyTitle, { color: txt }]}>{q ? 'No matching counters' : 'No counters yet'}</Text><Text style={[st.note, { color: colors.textSecondary }]}>{q ? 'Try another word.' : 'Campus counters show here as soon as they join.'}</Text></View>
              ) : null}
              {shown.map((s) => <CounterRow key={s.id} s={s} onPress={() => router.push(`/campus-booking/stall/${s.id}` as any)} />)}
            </View>
          </View>
        ) : (
          <View style={{ paddingTop: 14 }}>
            <CampusBitesSection ref={stallsRef} restaurants={seed} variant="page" />
          </View>
        )}
      </ScrollView>

      <FloatingBasketBar isDark={isDark} txt={txt} onOpen={openBasket} focusedAt={focusedAt} />
      <FloatingBasketButton onPress={() => router.push('/(tabs)/basket' as any)} />
    </View>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, width: '100%', maxWidth: 600, alignSelf: 'center' },
  hero: { borderBottomLeftRadius: 28, borderBottomRightRadius: 28 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 14 },
  title: { fontSize: 22, fontWeight: '800', letterSpacing: -0.2 },
  sub: { fontSize: 11.5, fontWeight: '500', opacity: 0.75 },
  mine: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 12, borderRadius: 12, ...(Platform.OS === 'web' ? {} : { elevation: 2 }) },
  mineText: { fontSize: 12, fontWeight: '800' },
  tabs: { flexDirection: 'row', gap: 12, paddingHorizontal: 14, alignItems: 'flex-end' },
  tab: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  tabIc: { width: 22, height: 22, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  tabText: { fontSize: 13.5, fontWeight: '800', letterSpacing: 0.2 },
  tabCnt: { minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  tabCntText: { fontSize: 10.5, fontWeight: '800' },
  panel: { borderBottomLeftRadius: 28, borderBottomRightRadius: 28, paddingTop: 14, paddingBottom: 14 },
  search: { alignSelf: 'center', width: '90%', height: 44, borderRadius: 14, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, marginBottom: 12 },
  searchInput: { flex: 1, fontSize: 14, fontWeight: '500', paddingVertical: 0 },
  info: { flexDirection: 'row', justifyContent: 'center', gap: 14 },
  infoItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  infoDot: { width: 6, height: 6, borderRadius: 3 },
  infoText: { fontSize: 11.5, fontWeight: '700', opacity: 0.8 },
  sh: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 20 },
  shTitle: { fontSize: 16, fontWeight: '800' },
  shCount: { fontSize: 12, fontWeight: '700' },
  list: { paddingHorizontal: 14, paddingTop: 12, gap: 10 },
  row: { flexDirection: 'row', gap: 12, borderRadius: 18, padding: 10, borderWidth: 1 },
  rowImgWrap: { alignSelf: 'center' },
  rowImgFrame: { borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  rowLogo: { position: 'absolute', right: -6, bottom: -6, width: 30, height: 30, borderRadius: 9, borderWidth: 2 },
  rowName: { fontSize: 15, fontWeight: '800' },
  rowMeta: { fontSize: 12, fontWeight: '500', marginTop: 2 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  pill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  pillText: { fontSize: 11, fontWeight: '800' },
  note: { fontSize: 12.5, textAlign: 'center', paddingVertical: 4 },
  empty: { borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 18, padding: 18, alignItems: 'center', gap: 3 },
  emptyTitle: { fontSize: 14.5, fontWeight: '800' },
});
