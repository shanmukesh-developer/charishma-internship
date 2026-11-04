// Local tab (owner, 3 Nov 2026: "home, local, groceries, orders, services" in the bar; Profile opens from the avatar at
// the top of Home): the stalls and counters around campus in the food-app listing style (owner, 3 Nov: "zomato or
// swiggy things"). The page: title, a big stall / dish search with filter chips, the In-Campus Booking banner (book
// ahead, collect at the counter), then the stalls near campus that deliver themselves: the same section Home shows
// (components/CampusBitesSection) in its 'page' layout, which draws the search, chips and list around the banner.
import React, { useCallback, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, Platform } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import TabBackButton from '../../components/TabBackButton';
import AmbientBackground from '../../components/AmbientBackground';
import DopaminePressable from '../../components/DopaminePressable';
import { CachedImage as Image } from '../../components/SafeImage';
import CampusBitesSection, { type CampusBitesSectionHandle } from '../../components/CampusBitesSection';
import { FloatingBasketBar, FloatingBasketButton } from '../../components/FloatingBasket';
import { COLORS, surfaceLift } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';
import { type BasketKind } from '../../context/CartContext';
import { CB_COUNTER_PHOTO } from '../../modules/campusBooking/cbTheme';
import { peekCache, RESTAURANTS_CACHE_KEY } from '../../utils/swrCache';
import { useTopInset } from '../../utils/useTopInset';

const EMPTY: any[] = [];

/** In-Campus Booking as an image-forward banner: the counter photo, a bottom shade, white text and a small pill. */
function CampusBookingBanner({ onPress }: { onPress: () => void }) {
  const { isDark } = useTheme();
  return (
    <DopaminePressable
      style={[st.banner, { backgroundColor: isDark ? COLORS.bgCard : '#1F1F23' }, surfaceLift(isDark)]}
      onPress={onPress}
      sound="tabSwitch"
      activeScale={0.98}
      accessibilityRole="button"
      accessibilityLabel="In-Campus Booking. Book from campus stalls and collect at the counter. See stalls"
    >
      <View style={st.bannerClip}>
        <Image source={{ uri: CB_COUNTER_PHOTO }} style={st.bannerImg} placeholderIcon="storefront-outline" />
        <LinearGradient
          colors={['rgba(0,0,0,0.05)', 'rgba(0,0,0,0.38)', 'rgba(0,0,0,0.84)']}
          locations={[0, 0.42, 1]}
          style={StyleSheet.absoluteFill}
        />
        <View style={st.bannerBody}>
          <Text style={st.bannerTitle} numberOfLines={1}>In-Campus Booking</Text>
          <Text style={st.bannerSub} numberOfLines={2}>Book from campus stalls and collect at the counter</Text>
          <View style={st.bannerPill}>
            <Text style={st.bannerPillText}>See stalls</Text>
            <Ionicons name="chevron-forward" size={14} color={COLORS.textDark} />
          </View>
        </View>
      </View>
    </DopaminePressable>
  );
}

export default function LocalScreen() {
  const router = useRouter();
  const { isDark, colors } = useTheme();
  const topPad = useTopInset();
  const txt = colors.text;
  const txtSec = isDark ? COLORS.textSecondary : COLORS.textDarkSecondary;
  // Home's cached store list paints the stalls at once when their own list is not cached yet (kept for the visit: a
  // new array would refetch the stalls).
  const [seed] = useState<any[]>(() => peekCache<any[]>(RESTAURANTS_CACHE_KEY) || EMPTY);
  const stallsRef = useRef<CampusBitesSectionHandle>(null);
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await stallsRef.current?.refresh(); } finally { setRefreshing(false); }
  }, []);
  // When Local last came into focus: its "added" bar only counts adds made on Local after this moment.
  const [focusedAt, setFocusedAt] = useState(() => Date.now());
  useFocusEffect(useCallback(() => { setFocusedAt(Date.now()); }, []));
  const openBasket = useCallback((kind: BasketKind) => router.push(`/(tabs)/basket?basket=${kind}` as any), [router]);

  return (
    <View style={[st.container, { paddingTop: topPad, backgroundColor: colors.bg }]}>
      <AmbientBackground />
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={isDark ? COLORS.gold : COLORS.red} colors={[COLORS.red, COLORS.gold]} />}
      >
        <View style={st.header}>
          <TabBackButton />
          <View style={st.headerText}>
            <Text style={[st.pageTitle, { color: txt }]} accessibilityRole="header">Local</Text>
            <Text style={[st.pageSub, { color: txtSec }]} numberOfLines={1}>Stalls and counters around campus</Text>
          </View>
        </View>

        <CampusBitesSection
          ref={stallsRef}
          restaurants={seed}
          variant="page"
          banner={<CampusBookingBanner onPress={() => router.push('/campus-booking' as any)} />}
        />
      </ScrollView>

      <FloatingBasketBar isDark={isDark} txt={txt} onOpen={openBasket} focusedAt={focusedAt} />
      <FloatingBasketButton onPress={() => router.push('/(tabs)/basket' as any)} />
    </View>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, paddingTop: Platform.OS === 'android' ? 40 : 50, width: '100%', maxWidth: 600, alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 16 },
  headerText: { flex: 1, minWidth: 0 },
  pageTitle: { fontSize: 24, fontWeight: '700', letterSpacing: 0.3 },
  pageSub: { fontSize: 13, fontWeight: '500', marginTop: 1 },

  // Outer view carries the shadow, the inner one clips the photo to the corners.
  banner: { borderRadius: 18 },
  bannerClip: { borderRadius: 18, overflow: 'hidden', width: '100%', aspectRatio: 16 / 9, justifyContent: 'flex-end' },
  bannerImg: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' },
  bannerBody: { paddingHorizontal: 16, paddingBottom: 16 },
  bannerTitle: { color: '#FFFFFF', fontSize: 19, fontWeight: '700', letterSpacing: 0.1 },
  bannerSub: { color: 'rgba(255,255,255,0.9)', fontSize: 13, fontWeight: '500', lineHeight: 18, marginTop: 3 },
  bannerPill: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 2, height: 30, paddingLeft: 13, paddingRight: 9,
    borderRadius: 15, backgroundColor: '#FFFFFF', marginTop: 12,
  },
  bannerPillText: { color: COLORS.textDark, fontSize: 13, fontWeight: '700', letterSpacing: 0.1 },
});
