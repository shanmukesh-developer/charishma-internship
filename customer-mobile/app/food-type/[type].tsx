// Food-type page (owner, 13 Nov 2026; approved prototype v53): tap a round food icon on Home -> every real dish of
// that type from all restaurants. Top: one coloured panel of restaurant slides (whole shop photo, details below,
// back button on the photo), then sorting, the dish count and the list; a dish opens its product page.
// Reads the store list Home already loaded (cache), or fetches it.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Dimensions, FlatList, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { CachedImage } from '../../components/SafeImage';
import { FoodMark, homeTheme } from '../../components/home/HomeRedesign2026';
import { dishesFrom, foodTypeOf, type HomeDish } from '../../components/home/HomeNov2026';
import { useTheme } from '../../context/ThemeContext';
import { peekCache, readCache, RESTAURANTS_CACHE_KEY } from '../../utils/swrCache';
import { apiFetch } from '../../utils/auth';
import { ENDPOINTS } from '../../constants/api';
import { useTopInset } from '../../utils/useTopInset';

const W = Dimensions.get('window').width;
const rupees = (v: number) => `₹${Math.round(v)}`;
type Sort = 'offer' | 'low' | 'high';

export default function FoodTypePage() {
  const { type, veg } = useLocalSearchParams<{ type: string; veg?: string }>();
  const isVeg = veg === '1';
  const router = useRouter();
  const { isDark } = useTheme();
  const topPad = useTopInset();
  const ht = homeTheme(isVeg);
  const label = String(type || '');
  const ft = foodTypeOf(label, isVeg);
  const [stores, setStores] = useState<any[] | null>(() => peekCache<any[]>(RESTAURANTS_CACHE_KEY) || null);
  const [sort, setSort] = useState<Sort>('offer');
  const [slide, setSlide] = useState(0);
  const slider = useRef<ScrollView>(null);

  useEffect(() => {
    if (stores && stores.length) return;
    let alive = true;
    (async () => {
      const cached = await readCache<any[]>(RESTAURANTS_CACHE_KEY);
      if (alive && cached?.data?.length) { setStores(cached.data); return; }
      try {
        const res = await apiFetch(`${ENDPOINTS.restaurants}?fields=summary`);
        const data = await res.json().catch(() => null);
        if (alive) setStores(Array.isArray(data) ? data : []);
      } catch { if (alive) setStores([]); }
    })();
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const dishes = useMemo(() => {
    if (!stores || !ft) return [] as HomeDish[];
    const seen = new Set<string>();
    return dishesFrom(stores).filter((d) => d.veg === isVeg && ft.match(d)).filter((d) => {
      const k = `${d.storeId}|${d.name.toLowerCase()}`;
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });
  }, [stores, ft, isVeg]);

  const sorted = useMemo(() => dishes.slice().sort(
    sort === 'low' ? (a, b) => a.price - b.price : sort === 'high' ? (a, b) => b.price - a.price : (a, b) => b.off - a.off || a.price - b.price,
  ), [dishes, sort]);

  // Restaurant slides: who serves the most of this food first (owner: "not items, its restaurant").
  const places = useMemo(() => {
    const by = new Map<string, { id: string; name: string; n: number; min: number; off: number }>();
    for (const d of dishes) {
      const r = by.get(d.storeId) || { id: d.storeId, name: d.store, n: 0, min: Infinity, off: 0 };
      r.n += 1; r.min = Math.min(r.min, d.price); r.off = Math.max(r.off, d.off);
      by.set(d.storeId, r);
    }
    const info = new Map((stores || []).map((s: any) => [String(s.id || s._id), s]));
    return [...by.values()].sort((a, b) => b.n - a.n || b.off - a.off).map((r) => ({ ...r, store: info.get(r.id) }));
  }, [dishes, stores]);

  useEffect(() => {
    if (places.length < 2) return;
    const id = setInterval(() => {
      setSlide((k) => { const next = (k + 1) % places.length; slider.current?.scrollTo({ x: next * W, animated: true }); return next; });
    }, 3500);
    return () => clearInterval(id);
  }, [places.length]);

  const page = isDark ? '#0E0D0C' : ht.pageLight;
  const card = isDark ? '#1A1817' : '#FFFFFF';
  const line = isDark ? '#2A2725' : '#ECE7E3';
  const txt = isDark ? '#F4F1EE' : '#14110F';
  const sub = isDark ? '#A39A93' : '#7A716B';
  const food = label.toLowerCase();
  const storeCount = places.length;

  const header = (
    <View>
      <View style={[st.panel, { backgroundColor: ht.sel }]}>
        <ScrollView ref={slider} horizontal pagingEnabled showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) => setSlide(Math.round(e.nativeEvent.contentOffset.x / W))}>
          {places.map((p, k) => (
            <View key={p.id} style={{ width: W }}>
              <View style={st.photoWrap}>
                {p.store?.imageUrl ? <CachedImage source={{ uri: p.store.imageUrl }} style={st.photo} maxWidth={720} /> : <View style={[st.photo, { backgroundColor: ht.top }]} />}
                {p.off > 0 && <View style={[st.upTo, { backgroundColor: ht.acc }]}><Text style={st.upToTxt}>Up to {p.off}% off</Text></View>}
              </View>
              <View style={st.details}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={st.kicker}><Text style={st.kickerTxt}>{k === 0 ? `TOP PLACE FOR ${food.toUpperCase()}` : `ALSO SERVES ${food.toUpperCase()}`}</Text></View>
                  <Text style={st.placeName} numberOfLines={2}>{p.name}</Text>
                  <View style={st.placeMeta}>
                    {p.store?.logoUrl ? <CachedImage source={{ uri: p.store.logoUrl }} style={st.placeLogo} maxWidth={60} /> : null}
                    <Text style={st.placeMetaTxt} numberOfLines={1}>{p.n} {food} {p.n === 1 ? 'dish' : 'dishes'} · from {rupees(p.min)}</Text>
                  </View>
                  {p.store?.nextSlotLabel ? <Text style={st.placeSlot} numberOfLines={1}>Next delivery {p.store.nextSlotLabel}</Text> : null}
                </View>
                <Pressable onPress={() => router.push(`/restaurant/${p.id}` as any)} style={st.viewMenu} accessibilityRole="button" accessibilityLabel={`View ${p.name} menu`}>
                  <Text style={[st.viewMenuTxt, { color: ht.sel }]}>View menu</Text>
                  <View style={[st.viewMenuArrow, { backgroundColor: ht.sel }]}><Ionicons name="arrow-forward" size={14} color="#fff" /></View>
                </Pressable>
              </View>
            </View>
          ))}
        </ScrollView>
        {places.length > 1 && <View style={st.dots}>{places.map((p, k) => <View key={p.id} style={[st.dot, k === slide && st.dotOn]} />)}</View>}
      </View>
      <View style={st.sortRow}>
        {([['offer', 'Best offers'], ['low', 'Price: low to high'], ['high', 'Price: high to low']] as [Sort, string][]).map(([k, l]) => (
          <Pressable key={k} onPress={() => setSort(k)} style={[st.sortChip, { backgroundColor: sort === k ? ht.acc : card, borderColor: sort === k ? ht.acc : line }]} accessibilityRole="radio" accessibilityState={{ selected: sort === k }}>
            <Text style={[st.sortTxt, { color: sort === k ? '#fff' : sub }]}>{l}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={[st.count, { color: sub }]}>{dishes.length} {food} {dishes.length === 1 ? 'dish' : 'dishes'} from {storeCount} {storeCount === 1 ? 'restaurant' : 'restaurants'}</Text>
    </View>
  );

  return (
    <View style={[st.root, { backgroundColor: page }]}>
      {stores === null ? (
        <ActivityIndicator style={{ marginTop: 120 }} color={ht.acc} />
      ) : (
        <FlatList
          data={sorted}
          keyExtractor={(d) => d.id}
          ListHeaderComponent={header}
          contentContainerStyle={{ paddingBottom: 40 }}
          ListEmptyComponent={<Text style={[st.empty, { color: sub }]}>No {food} dishes right now.</Text>}
          renderItem={({ item: d }) => (
            <Pressable onPress={() => router.push(`/products/${d.id}` as any)} style={[st.row, { backgroundColor: card, borderColor: line }]} accessibilityRole="button" accessibilityLabel={`${d.name}, ${rupees(d.price)}, ${d.store}`}>
              <View style={st.rowImgWrap}>
                <CachedImage source={{ uri: d.img }} style={st.rowImg} maxWidth={220} />
                {d.off > 0 && <View style={[st.rowOff, { backgroundColor: ht.acc }]}><Text style={st.rowOffTxt}>-{d.off}%</Text></View>}
              </View>
              <View style={st.rowInfo}>
                <Text style={[st.rowName, { color: txt }]} numberOfLines={2}>{d.name}</Text>
                <View style={st.rowStore}><FoodMark veg={d.veg} size={11} /><Text style={[st.rowStoreTxt, { color: sub }]} numberOfLines={1}>{d.store}</Text></View>
                <View style={st.rowBottom}>
                  <Text style={[st.rowPrice, { color: txt }]}>{rupees(d.price)}{d.orig ? <Text style={[st.rowWas, { color: sub }]}>  {rupees(d.orig)}</Text> : null}</Text>
                  <View style={[st.rowAdd, { backgroundColor: ht.acc }]}><Ionicons name="add" size={18} color="#fff" /></View>
                </View>
              </View>
            </Pressable>
          )}
        />
      )}
      <Pressable onPress={() => router.back()} style={[st.back, { top: topPad + 8 }]} accessibilityRole="button" accessibilityLabel="Back">
        <Ionicons name="chevron-back" size={22} color="#fff" />
      </Pressable>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1 },
  panel: { borderBottomLeftRadius: 32, borderBottomRightRadius: 32, overflow: 'hidden', paddingBottom: 14 },
  photoWrap: { width: W, aspectRatio: 16 / 9 },
  photo: { width: '100%', height: '100%' },
  upTo: { position: 'absolute', right: 14, bottom: 14, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  upToTxt: { color: '#fff', fontSize: 11, fontWeight: '800' },
  details: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 12 },
  kicker: { alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.16)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' },
  kickerTxt: { color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 0.6 },
  placeName: { color: '#fff', fontSize: 19, fontWeight: '800', marginTop: 7, lineHeight: 23 },
  placeMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  placeLogo: { width: 18, height: 18, borderRadius: 5, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.8)' },
  placeMetaTxt: { color: 'rgba(255,255,255,0.85)', fontSize: 12, flexShrink: 1 },
  placeSlot: { color: 'rgba(255,255,255,0.75)', fontSize: 11, marginTop: 3 },
  viewMenu: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 36, paddingLeft: 14, paddingRight: 4, borderRadius: 18, backgroundColor: '#fff' },
  viewMenuTxt: { fontSize: 12.5, fontWeight: '800' },
  viewMenuArrow: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.3)' },
  dotOn: { width: 18, backgroundColor: '#fff' },
  sortRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 16, flexWrap: 'wrap' },
  sortChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 8 },
  sortTxt: { fontSize: 12, fontWeight: '700' },
  count: { fontSize: 12, fontWeight: '700', paddingHorizontal: 18, paddingTop: 10, paddingBottom: 6 },
  empty: { textAlign: 'center', paddingVertical: 40 },
  row: { flexDirection: 'row', gap: 12, marginHorizontal: 16, marginTop: 12, borderRadius: 20, borderWidth: 1, padding: 10 },
  rowImgWrap: { width: 96, height: 96, borderRadius: 16, overflow: 'hidden' },
  rowImg: { width: '100%', height: '100%' },
  rowOff: { position: 'absolute', left: 6, top: 6, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2 },
  rowOffTxt: { color: '#fff', fontSize: 10, fontWeight: '800' },
  rowInfo: { flex: 1, minWidth: 0 },
  rowName: { fontSize: 14.5, fontWeight: '700', lineHeight: 18 },
  rowStore: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  rowStoreTxt: { fontSize: 11.5, flexShrink: 1 },
  rowBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto' },
  rowPrice: { fontSize: 15, fontWeight: '800' },
  rowWas: { fontSize: 11, fontWeight: '500', textDecorationLine: 'line-through' },
  rowAdd: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  back: { position: 'absolute', left: 14, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.38)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)', alignItems: 'center', justifyContent: 'center' },
});
