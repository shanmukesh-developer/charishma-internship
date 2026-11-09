/**
 * Home redesign (owner-approved prototype v63, 9 Nov 2026: docs/prototypes/home-campus-buddy-row-2026-11-09).
 * Home only: the Non-veg / Veg tabs recolour the whole Home screen (dark red / dark green), the services
 * bento, the Deals strip, section headings, the Restaurants opener with Restaurants / Fast food / Tiffins tabs,
 * the next-slot tag on restaurant cards and the closing caption. The bottom tab bar is untouched.
 */
import React from 'react';
import { View, Text, Pressable, Image, ScrollView, StyleSheet, useWindowDimensions, ImageSourcePropType } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

// ─── Theme ───────────────────────────────────────────────────────────────────
export type HomeTheme = {
  top: string; sel: string; sel2: string; un: string; // header strip, selected tab / panel, unselected tab
  acc: string; acc2: string; accDeep: string;          // accents (labels, strips)
  pageLight: string; lineLight: string;                // light-mode page tint and hairlines
  adBase: string; adAccent: string;                    // ads: dark base + highlight colour
};
export const HOME_THEMES: { nonveg: HomeTheme; veg: HomeTheme } = {
  nonveg: {
    top: '#6A0E1A', sel: '#931527', sel2: '#7C1020', un: '#4C0912',
    acc: '#C8143F', acc2: '#FF6A3D', accDeep: '#8B1220',
    pageLight: '#FBF2F3', lineLight: '#F2DDE0',
    adBase: '#2A0408', adAccent: '#FF6B7D',
  },
  veg: {
    top: '#0C4A28', sel: '#13693A', sel2: '#0F5A31', un: '#08351C',
    acc: '#15803D', acc2: '#4ADE80', accDeep: '#0B3D20',
    pageLight: '#EFF7F1', lineLight: '#D5EBDC',
    adBase: '#03190C', adAccent: '#5BE08F',
  },
};
export const homeTheme = (veg: boolean) => (veg ? HOME_THEMES.veg : HOME_THEMES.nonveg);

/** Concave corner so a selected tab flows into the panel below it (RN has no radial-gradient corners). */
export const FlareCorner = ({ side, size, fill, bg }: { side: 'left' | 'right'; size: number; fill: string; bg: string }) => (
  <View pointerEvents="none" style={{ position: 'absolute', bottom: 0, [side === 'left' ? 'left' : 'right']: -size, width: size, height: size, backgroundColor: fill }}>
    <View style={{ flex: 1, backgroundColor: bg, [side === 'left' ? 'borderBottomRightRadius' : 'borderBottomLeftRadius']: size }} />
  </View>
);

// ─── Non-veg / Veg tabs (inside the coloured header) ─────────────────────────
export function DietTabs({ veg, onChange, theme }: { veg: boolean; onChange: (veg: boolean) => void; theme: HomeTheme }) {
  const tab = (isVeg: boolean, label: string) => {
    const on = veg === isVeg;
    return (
      <Pressable
        key={label}
        onPress={() => onChange(isVeg)}
        accessibilityRole="tab"
        accessibilityState={{ selected: on }}
        accessibilityLabel={label}
        style={[st.dietTab, on ? { backgroundColor: theme.sel, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingVertical: 11 } : { backgroundColor: theme.un, borderRadius: 14, marginBottom: 7, paddingVertical: 9 }]}
      >
        {/* Outer side flares into the screen edge (14 px margin), inner side into the 12 px gap. */}
        {on ? <FlareCorner side="left" size={isVeg ? 12 : 14} fill={theme.sel} bg={theme.top} /> : null}
        {on ? <FlareCorner side="right" size={isVeg ? 14 : 12} fill={theme.sel} bg={theme.top} /> : null}
        <View style={st.dietLabelRow}>
          <FoodMark veg={isVeg} />
          <Text style={[st.dietLabel, { color: on ? '#fff' : 'rgba(255,255,255,0.75)' }]}>{label}</Text>
        </View>
      </Pressable>
    );
  };
  return <View style={st.dietTabs}>{tab(false, 'Non-veg')}{tab(true, 'Veg')}</View>;
}

/** FSSAI-style food mark: veg = green dot, non-veg = red-brown triangle. */
export function FoodMark({ veg, size = 11 }: { veg: boolean; size?: number }) {
  const c = veg ? '#16A34A' : '#C2410C';
  return (
    <View style={{ width: size, height: size, borderWidth: 1.3, borderColor: c, borderRadius: 2.5, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
      {veg ? (
        <View style={{ width: size * 0.45, height: size * 0.45, borderRadius: size, backgroundColor: c }} />
      ) : (
        <View style={{ width: 0, height: 0, borderLeftWidth: size * 0.27, borderRightWidth: size * 0.27, borderBottomWidth: size * 0.45, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: c }} />
      )}
    </View>
  );
}

// ─── Header buttons with 3D icons ─────────────────────────────────────────────
export function HeaderIconButton({ source, onPress, label, ring, children }: { source: ImageSourcePropType; onPress: () => void; label: string; ring?: boolean; children?: React.ReactNode }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [st.hdrBtn, ring && st.hdrBtnRing, pressed && { transform: [{ scale: 0.92 }] }]}>
      <Image source={source} style={{ width: 21, height: 21 }} resizeMode="contain" />
      {children}
    </Pressable>
  );
}

// ─── Section heading (small coloured kicker + bold title) ─────────────────────
export function SectionHeading({ kicker, title, color, titleColor, action }: { kicker: string; title: string; color: string; titleColor: string; action?: { label: string; onPress: () => void } }) {
  return (
    <View style={st.headRow}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[st.kicker, { color }]}>{kicker}</Text>
        <Text style={[st.headTitle, { color: titleColor }]} numberOfLines={1}>{title}</Text>
      </View>
      {action ? (
        <Pressable onPress={action.onPress} hitSlop={10} accessibilityRole="button">
          <Text style={[st.headAction, { color }]}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// ─── Services bento ───────────────────────────────────────────────────────────
export type ServiceKey = 'campusBooking' | 'groceries' | 'events' | 'rides' | 'rentals' | 'pg' | 'services' | 'promos';
const ART: Record<ServiceKey, ImageSourcePropType> = {
  campusBooking: require('../../assets/home-redesign-2026-11-09/home-tile-booking-campus-foods-gemini-2026-11-09.webp'),
  groceries: require('../../assets/home-redesign-2026-11-09/home-tile-groceries-bag-gemini-2026-11-09.webp'),
  events: require('../../assets/home-redesign-2026-11-09/home-tile-events-crowd-gemini-2026-11-09.webp'),
  rides: require('../../assets/home-redesign-2026-11-09/home-tile-coride-auto-gemini-2026-11-09.webp'),
  // Owner, 10 Nov 2026: premium Gemini art for the four tiles that still had stock photos (PG = a real building).
  rentals: require('../../assets/home-redesign-2026-11-09/home-tile-rentals-scooter-gemini-2026-11-10.webp'),
  pg: require('../../assets/home-redesign-2026-11-09/home-tile-pg-building-gemini-2026-11-10.webp'),
  services: require('../../assets/home-redesign-2026-11-09/home-tile-tech-repair-gemini-2026-11-10.webp'),
  promos: require('../../assets/home-redesign-2026-11-09/home-tile-deals-giftbox-gemini-2026-11-10.webp'),
};
const TILES: { key: ServiceKey; name: string; sub: string; c1: string; c2: string }[] = [
  { key: 'groceries', name: 'Groceries', sub: 'Snacks & daily needs', c1: '#E7F8F1', c2: '#C4EEDC' },
  { key: 'events', name: 'Campus events', sub: 'Fests & concerts', c1: '#F4ECFF', c2: '#E2D1FF' },
  { key: 'rides', name: 'Co-Ride', sub: 'Share an auto or bike', c1: '#EAF8EF', c2: '#CBEFD8' },
  { key: 'rentals', name: 'Rentals', sub: 'Bikes on rent', c1: '#E9F3FF', c2: '#CFE3FF' },
  { key: 'pg', name: 'PG stays', sub: 'Rooms near campus', c1: '#FFF7DD', c2: '#FCE7A2' },
  { key: 'services', name: 'Tech & Repairs', sub: 'Phone, laptop & more', c1: '#EFF2F6', c2: '#DAE1EA' },
];

export function ServicesBento({ hidden, onOpen }: { hidden: Set<ServiceKey>; onOpen: (k: ServiceKey) => void }) {
  const small = TILES.filter((t) => !hidden.has(t.key));
  const cols: (typeof TILES)[] = [];
  for (let i = 0; i < small.length; i += 2) cols.push(small.slice(i, i + 2));
  const showDeals = !hidden.has('promos');
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.svcRow} decelerationRate="fast">
      <Pressable onPress={() => onOpen('campusBooking')} accessibilityRole="button" accessibilityLabel="In-Campus Booking" style={({ pressed }) => [pressed && st.pressed]}>
        <LinearGradient colors={['#FFF3E6', '#FFDDBA']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[st.tile, st.tileBig]}>
          <Image source={ART.campusBooking} style={st.bigArt} resizeMode="contain" />
          <Text style={[st.tileName, { fontSize: 14.5 }]} numberOfLines={2}>In-Campus Booking</Text>
          <Text style={[st.tileSub, { fontSize: 11 }]} numberOfLines={2}>Order at campus counters</Text>
          <View style={st.bookBtn}><Text style={st.bookBtnText}>Book now ›</Text></View>
        </LinearGradient>
      </Pressable>
      {cols.map((col, ci) => (
        <View key={ci} style={{ gap: 10 }}>
          {col.map((t) => (
            <Pressable key={t.key} onPress={() => onOpen(t.key)} accessibilityRole="button" accessibilityLabel={t.name} style={({ pressed }) => [pressed && st.pressed]}>
              {/* A lone tile in the last column (odd number of live sections) fills the full column height: no empty gap. */}
              <LinearGradient colors={[t.c1, t.c2]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[st.tile, col.length === 1 && { height: 212 }]}>
                <Image source={ART[t.key]} style={col.length === 1 ? st.loneArt : st.smallArt} resizeMode="contain" />
                <Text style={st.tileName} numberOfLines={1}>{t.name}</Text>
                <Text style={st.tileSub} numberOfLines={1}>{t.sub}</Text>
              </LinearGradient>
            </Pressable>
          ))}
        </View>
      ))}
      {showDeals ? (
        <Pressable onPress={() => onOpen('promos')} accessibilityRole="button" accessibilityLabel="Deals and spin" style={({ pressed }) => [pressed && st.pressed]}>
          <LinearGradient colors={['#FFEAF0', '#FFCFDC']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[st.tile, st.tileBig]}>
            <Image source={ART.promos} style={st.bigArt} resizeMode="contain" />
            <Text style={[st.tileName, { fontSize: 14.5 }]}>Deals & spin</Text>
            <Text style={[st.tileSub, { fontSize: 11 }]} numberOfLines={2}>Coupons, rewards and the spin wheel</Text>
          </LinearGradient>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

// ─── Deals strip ──────────────────────────────────────────────────────────────
const BAGS = require('../../assets/home-redesign-2026-11-09/home-deals-strip-bags-gemini-2026-11-10.webp'); // owner, 10 Nov: the old stock bags looked broken
export function DealsStrip({ theme, onPress }: { theme: HomeTheme; onPress: () => void }) {
  const { width } = useWindowDimensions();
  const narrow = width < 370;
  const tiny = width < 340;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel="Deals: coupons and up to 90% off" style={({ pressed }) => [st.dealsWrap, pressed && st.pressed]}>
      <LinearGradient colors={[theme.accDeep, theme.acc, theme.acc2]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={[st.dealsBar, tiny && { paddingHorizontal: 10, gap: 8 }]}>
        <View style={[st.dealsBadge, tiny && { width: 32, height: 32 }]}><Text style={[st.dealsBadgeText, { color: theme.acc }]}>%</Text></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[st.dealsTitle, narrow && { fontSize: 16.5 }]}>DEALS</Text>
          <Text style={[st.dealsSub, narrow && { fontSize: 11.5 }]} numberOfLines={1}>{width < 400 ? 'Up to 90% off' : 'Coupons & up to 90% off'}</Text>
        </View>
        <Image source={BAGS} style={{ width: tiny ? 58 : narrow ? 70 : 82, height: 54, marginTop: -8, marginBottom: -8 }} resizeMode="contain" />
        <View style={st.dealsGo}><Text style={[st.dealsGoText, { color: theme.acc }]}>View ›</Text></View>
      </LinearGradient>
    </Pressable>
  );
}

// ─── Restaurants opener + Restaurants / Fast food / Tiffins tabs ─────────────
const THALI = require('../../assets/home-redesign-2026-11-09/home-restaurants-opener-thali-unsplash-2026-11-09.webp');
export function RestaurantsOpener({ theme, count, avatars }: { theme: HomeTheme; count: number; avatars: string[] }) {
  const shown = avatars.slice(0, 4);
  const extra = Math.max(0, count - shown.length);
  return (
    <View style={st.openerWrap}>
      <Image source={THALI} style={StyleSheet.absoluteFill} resizeMode="cover" />
      <LinearGradient colors={[theme.adBase, `${theme.accDeep}B3`, 'rgba(0,0,0,0)']} locations={[0, 0.45, 0.9]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <Text style={st.openerKick}>NOW SERVING</Text>
        <Text style={st.openerTitle}>Restaurants</Text>
        {count > 0 ? <Text style={st.openerSub}>{count} {count === 1 ? 'kitchen' : 'kitchens'} near campus</Text> : null}
      </View>
      {shown.length > 0 ? (
        <View style={st.avatars}>
          {shown.map((u, i) => (
            <Image key={u + i} source={{ uri: u }} style={[st.avatar, i > 0 && { marginLeft: -9 }]} />
          ))}
          {extra > 0 ? <View style={[st.avatar, st.avatarMore]}><Text style={[st.avatarMoreText, { color: theme.accDeep }]}>+{extra}</Text></View> : null}
        </View>
      ) : null}
    </View>
  );
}

// 'all' (owner, 10 Nov 2026: "add an All option after Restaurants, Fast food and Tiffins") shows every kitchen;
// restaurantKind() never returns it.
export type RestaurantKind = 'rest' | 'fast' | 'tiffin' | 'all';
const KIND_LABEL: Record<RestaurantKind, string> = { rest: 'Restaurants', fast: 'Fast food', tiffin: 'Tiffins', all: 'All' };
/** Until stores carry an admin-set type: read it from their cuisine tags. */
export function restaurantKind(r: any): RestaurantKind {
  const t = [r?.cuisine, ...(Array.isArray(r?.tags) ? r.tags : [])].map((x) => String(x || '').toLowerCase()).join(' ');
  if (/biryani|curr|meals|thali|dhaba|andhra|north indian/.test(t)) return 'rest';
  if (/dosa|idli|idly|tiffin|breakfast|upma|vada|pongal|uttapam/.test(t)) return 'tiffin';
  if (/burger|pizza|shawarma|fries|fast ?food|momos|fried chicken|sandwich|roll|pide/.test(t)) return 'fast';
  return 'rest';
}

export function RestaurantKindTabs({ value, counts, onChange, theme, isDark, pageBg }: { value: RestaurantKind; counts: Record<RestaurantKind, number>; onChange: (k: RestaurantKind) => void; theme: HomeTheme; isDark: boolean; pageBg: string }) {
  const kinds: RestaurantKind[] = ['rest', 'fast', 'tiffin', 'all'];
  const panel = isDark ? '#17171C' : '#FFFFFF';
  const unBg = isDark ? 'rgba(255,255,255,0.06)' : `${theme.acc}14`;
  return (
    <View style={st.kindTabs}>
      {kinds.map((k, i) => {
        const on = value === k;
        return (
          <Pressable
            key={k}
            onPress={() => onChange(k)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={[st.kindTab, k === 'all' && { flex: 0.55 }, on ? { backgroundColor: panel, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingVertical: 12 } : { backgroundColor: unBg, borderRadius: 14, marginBottom: 6, paddingVertical: 10, borderWidth: 1, borderColor: `${theme.acc}24` }]}
          >
            {on && i > 0 ? <FlareCorner side="left" size={8} fill={panel} bg={pageBg} /> : null}
            {on && i < kinds.length - 1 ? <FlareCorner side="right" size={8} fill={panel} bg={pageBg} /> : null}
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={[st.kindLabel, { color: on ? theme.accDeep : isDark ? 'rgba(255,255,255,0.75)' : '#2B2F38' }]}>
              {KIND_LABEL[k]} <Text style={{ color: theme.acc, fontSize: 10.5 }}>{counts[k]}</Text>
            </Text>
            {on ? <LinearGradient colors={[theme.acc, theme.acc2]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={st.kindUnderline} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

// ─── Next-slot tag on restaurant cards ────────────────────────────────────────
/** The white panel the kind tabs open into (first / last tab square that top corner). */
export function KindPanel({ value, isDark, children }: { value: RestaurantKind; isDark: boolean; children: React.ReactNode }) {
  return (
    <View style={[st.kindPanel, { backgroundColor: isDark ? '#17171C' : '#FFFFFF' }, value === 'rest' && { borderTopLeftRadius: 0 }, value === 'all' && { borderTopRightRadius: 0 }]}>
      {children}
    </View>
  );
}

export function SlotTag({ text, theme }: { text: string; theme: HomeTheme }) {
  return (
    <View style={[st.slotTag, { backgroundColor: `${theme.acc}1A`, borderColor: `${theme.acc}38` }]} accessibilityLabel={`Next delivery ${text}`}>
      <Ionicons name="time-outline" size={12} color={theme.accDeep} />
      <Text style={[st.slotTagText, { color: theme.accDeep }]} numberOfLines={1}>{text}</Text>
    </View>
  );
}

// ─── Closing caption ──────────────────────────────────────────────────────────
export function EndCaption({ theme, isDark }: { theme: HomeTheme; isDark: boolean }) {
  return (
    <View style={st.endcap}>
      <Text style={[st.endTitle, { color: isDark ? 'rgba(255,255,255,0.16)' : `${theme.accDeep}38` }]}>Campus life,{'\n'}sorted.</Text>
      <Text style={st.endSub}>Created with <Text style={{ color: theme.acc }}>❤</Text> by Team ZenWe</Text>
    </View>
  );
}

const st = StyleSheet.create({
  dietTabs: { flexDirection: 'row', gap: 12, paddingHorizontal: 14, alignItems: 'flex-end' },
  dietTab: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  dietLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  dietLabel: { fontSize: 13.5, fontWeight: '800', letterSpacing: 0.2 },

  hdrBtn: { width: 36, height: 36, borderRadius: 12.5, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  hdrBtnRing: { borderWidth: 1.5, borderColor: '#E8B54D' },

  headRow: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 16, marginBottom: 10 },
  kicker: { fontSize: 11.5, fontWeight: '700', letterSpacing: 0.1 },
  headTitle: { fontSize: 16, fontWeight: '700', marginTop: 1 },
  headAction: { fontSize: 12, fontWeight: '700', paddingBottom: 2 },

  svcRow: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 6, gap: 10 },
  tile: { width: 128, height: 101, borderRadius: 18, padding: 11, justifyContent: 'flex-end', overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.7)' },
  tileBig: { width: 150, height: 212 },
  smallArt: { position: 'absolute', top: 8, right: 8, width: 66, height: 52 },
  loneArt: { position: 'absolute', top: 14, left: 10, width: 108, height: 96 },
  bigArt: { position: 'absolute', top: 10, left: 12, width: 126, height: 80 },
  tileName: { fontSize: 13, fontWeight: '800', color: '#15161A' },
  tileSub: { fontSize: 10.5, color: '#4B5160', marginTop: 2 },
  bookBtn: { marginTop: 9, alignSelf: 'flex-start', backgroundColor: '#15161A', borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6 },
  bookBtnText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  pressed: { transform: [{ scale: 0.96 }] },

  dealsWrap: { marginHorizontal: 14, marginTop: 14 },
  dealsBar: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, paddingHorizontal: 12, height: 62, overflow: 'visible' },
  dealsBadge: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  dealsBadgeText: { fontSize: 17, fontWeight: '900' },
  dealsTitle: { color: '#fff', fontSize: 18, fontWeight: '900', fontStyle: 'italic', letterSpacing: 0.6 },
  dealsSub: { color: '#FFE7D6', fontSize: 12, fontWeight: '600', marginTop: 1 },
  dealsGlow: { position: 'absolute', right: 70, width: 84, height: 62, borderRadius: 42, backgroundColor: 'rgba(255,240,226,0.45)' },
  dealsGo: { backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6 },
  dealsGoText: { fontSize: 11.5, fontWeight: '800' },

  openerWrap: { height: 88, marginHorizontal: 14, borderRadius: 18, overflow: 'hidden', paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center' },
  openerKick: { color: '#FFD9A0', fontSize: 9.5, fontWeight: '900', letterSpacing: 1.4 },
  openerTitle: { color: '#fff', fontSize: 21, fontWeight: '900', letterSpacing: -0.3, marginTop: 2 },
  openerSub: { color: 'rgba(255,255,255,0.88)', fontSize: 11, marginTop: 3 },
  avatars: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', marginBottom: 12 },
  avatar: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: '#fff', backgroundColor: '#ddd' },
  avatarMore: { marginLeft: -9, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', minWidth: 30, paddingHorizontal: 4 },
  avatarMoreText: { fontSize: 11, fontWeight: '900' },

  kindTabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginTop: 16, alignItems: 'flex-end' },
  kindTab: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  kindLabel: { fontSize: 12.5, fontWeight: '800' },
  kindPanel: { marginHorizontal: 16, borderRadius: 20, padding: 12, shadowColor: '#1b1a17', shadowOpacity: 0.12, shadowRadius: 14, shadowOffset: { width: 0, height: 8 }, elevation: 3 },
  kindUnderline: { position: 'absolute', bottom: 5, width: 22, height: 3, borderRadius: 3 },

  slotTag: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 6, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 3, flexShrink: 1 },
  slotTagText: { fontSize: 11.5, fontWeight: '700' },

  endcap: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 6 },
  endTitle: { fontSize: 34, fontWeight: '900', lineHeight: 35, letterSpacing: -1 },
  endSub: { fontSize: 12, fontWeight: '600', color: '#9AA0AD', marginTop: 8 },
});
