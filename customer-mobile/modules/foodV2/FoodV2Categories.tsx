/**
 * Food & groceries v2: all categories ("Shop by category" > View all). The six main category tiles,
 * then every other aisle and shelf that has products, as a plain list. Each opens its listing.
 * Others → Food & groceries (modules/foodV2).
 */
import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { PressScale } from '../../modules/others/motion';
import { FOOD } from './foodV2Theme';
import { TILES, ESSENTIAL_AISLES, LIST_TITLES, chipLabel, shelfItems } from './FoodV2Data';
import { s } from './FoodV2Styles';
import { useFoodV2 } from './useFoodV2';
import { TILE_ART } from './FoodV2Art';
import { Icon } from './FoodV2Icons';
import { useFoodScale } from './FoodV2Scale';

/** Other shelves shown under the tiles (key -> label), only when they have products. */
const MORE: { key: string; label: string }[] = [
  { key: 'All Groceries', label: 'Everything in the campus store' },
  { key: 'Deals', label: 'Best deals' },
  { key: 'Organic', label: 'Organic' },
  { key: 'Monsoon Wellness Picks', label: LIST_TITLES['Monsoon Wellness Picks'] },
  { key: 'Seeds', label: 'Seeds' },
  { key: 'Toys', label: LIST_TITLES.Toys },
  { key: 'Electronics', label: 'Chargers and gadgets' },
];

export default function FoodV2Categories() {
  const { isDark, topPad, pageW, c, shadow, pop, catalogue, shopCount, openListing } = useFoodV2();
  const sc = useFoodScale();
  const cols = sc.tileCols;
  // the white inset sits 8 px in from each side (s.inset)
  const w = Math.floor((pageW - 16 - 32 - 10 * (cols - 1)) / cols);
  const tiles = TILES.filter(t => shelfItems(t.key, catalogue).length > 0);
  const more = [
    ...MORE.map(m => ({ ...m, n: shelfItems(m.key, catalogue).length })),
    ...ESSENTIAL_AISLES.map(a => ({ key: a, label: chipLabel(a), n: shelfItems(a, catalogue).length })),
  ].filter(m => m.n > 0);
  return (
    <View style={{ flex: 1, backgroundColor: FOOD.headerDeep[0] }}>
      <LinearGradient colors={FOOD.headerDeep} style={{ paddingTop: topPad }}>
        <View style={s.listHead}>
          <PressScale onPress={pop} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole="button" accessibilityLabel="Back" style={s.backBtn}>
            <Icon name="arrow-back" size={22} color="#FFFFFF" />
          </PressScale>
          <Text style={s.listTitle} numberOfLines={1} accessibilityRole="header">All categories</Text>
        </View>
        <View style={{ height: 6 }} />
      </LinearGradient>
      <View style={[s.inset, { backgroundColor: c.page }]}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: 16, paddingBottom: shopCount > 0 ? sc.barSpace : 32 + sc.insets.bottom }}>
          <View style={st.grid}>
            {tiles.map(t => {
              const art = TILE_ART[t.key];
              return (
                <PressScale key={t.key} onPress={() => openListing(t.key)} scaleTo={0.97} style={{ width: w }} accessibilityRole="button" accessibilityLabel={t.label}>
                  <View style={[st.tile, { backgroundColor: c.card }, shadow]}>
                    <View style={[st.plate, { backgroundColor: art ? art.tint[isDark ? 1 : 0] : c.tile }]}>
                      {art ? <Image source={art.art} style={st.cut} contentFit="contain" accessibilityElementsHidden /> : <Image source={{ uri: t.img }} style={StyleSheet.absoluteFill} contentFit="cover" />}
                    </View>
                    <Text style={[st.label, { color: isDark ? c.name : '#334651' }]} numberOfLines={2}>{t.label}</Text>
                  </View>
                </PressScale>
              );
            })}
          </View>
          {more.length > 0 && (
            <View style={{ marginTop: 22 }}>
              <Text style={[s.headTitle, { color: c.title, paddingHorizontal: 16, marginBottom: 8 }]} accessibilityRole="header">More aisles</Text>
              <View style={[st.list, { backgroundColor: c.card }, shadow]}>
                {more.map((m, i) => (
                  <PressScale key={m.key} onPress={() => openListing(m.key)} style={[st.row, i > 0 && { borderTopWidth: 1, borderTopColor: c.line }]} accessibilityRole="button" accessibilityLabel={`${m.label}, ${m.n} item${m.n === 1 ? '' : 's'}`}>
                    <Text style={[st.rowText, { color: c.name }]} numberOfLines={1}>{m.label}</Text>
                    <Text style={[st.rowCount, { color: c.slate }]}>{m.n}</Text>
                    <Icon name="chevron-forward" size={16} color={c.slate} />
                  </PressScale>
                ))}
              </View>
            </View>
          )}
        </ScrollView>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 16 },
  tile: { borderRadius: 12, paddingBottom: 12 },
  plate: { height: 84, margin: 6, marginBottom: 0, borderRadius: 10, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  cut: { width: '86%', height: '92%' },
  label: { fontSize: 12.5, fontWeight: '500', lineHeight: 16, minHeight: 32, marginTop: 8, paddingHorizontal: 8, textAlign: 'center' },
  list: { marginHorizontal: 16, borderRadius: 14, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingHorizontal: 16 },
  rowText: { flex: 1, fontSize: 14, fontWeight: '400' },
  rowCount: { fontSize: 12.5 },
});
