/**
 * Food & groceries v2: the shops of one category (owner, 28 Oct 2026: "after clicking any Pickles or groceries or
 * bakeries it has to go to the shop / vendor brand image, and after clicking that vendor it goes into the menu").
 * Category tile -> this list of shop cards (brand photo, logo, name, items in this category, open state) -> the
 * shop's own menu (app/restaurant/[id]). "See all products" still opens the category's product list.
 */
import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { CachedImage as Image } from '../../components/SafeImage';
import { PressScale } from '../../modules/others/motion';
import { FOOD } from './foodV2Theme';
import { TILES, LIST_TITLES, sentence, fmtShortClock, FALLBACK_IMG } from './FoodV2Data';
import { s } from './FoodV2Styles';
import { useFoodV2 } from './useFoodV2';
import { useFoodV2Ui } from './FoodV2Ui';
import { useFoodV2States } from './FoodV2States';
import { Icon } from './FoodV2Icons';
import { BUTTON_ROLE } from '../../utils/pressRole';

export default function FoodV2Shops({ shelf }: { shelf: string }) {
  const { router, isDark, topPad, c, pop, shopCount, shopsFor, openListing, fetchCatalogue, failKind, forcedFail, isLoading, isFailed } = useFoodV2();
  const { headerBtn, basketBar } = useFoodV2Ui();
  const { loadingCard, stateCard } = useFoodV2States();
  const title = TILES.find(t => t.key === shelf)?.label || LIST_TITLES[shelf] || sentence(shelf);
  const shops = shopsFor(shelf);

  return (
    <View style={{ flex: 1, backgroundColor: c.page }}>
      <LinearGradient colors={FOOD.headerDeep} style={{ paddingTop: topPad }}>
        <View style={st.bar}>
          <PressScale onPress={pop} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole={BUTTON_ROLE} accessibilityLabel="Back" style={s.backBtn}>
            <Icon name="arrow-back" size={22} color="#FFFFFF" />
          </PressScale>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={st.title} numberOfLines={1} accessibilityRole="header">{title}</Text>
            <Text style={st.sub} numberOfLines={1}>{isLoading ? 'Finding shops…' : `${shops.length} shop${shops.length === 1 ? '' : 's'}`}</Text>
          </View>
          {headerBtn('cart-outline', 'Basket', () => router.push('/(tabs)/basket?basket=store' as any), shopCount)}
        </View>
      </LinearGradient>

      {isLoading ? <View style={{ paddingTop: 12 }}>{loadingCard(3)}</View>
        : isFailed ? <View style={{ padding: 16 }}>{stateCard(forcedFail || failKind, fetchCatalogue)}</View>
          : (
            <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: shopCount > 0 ? 120 : 40, gap: 14 }} showsVerticalScrollIndicator={false}>
              {shops.length === 0 ? (
                <View style={[s.emptyCard, { backgroundColor: c.soft }]}>
                  <Icon name="storefront-outline" size={34} color={FOOD.primary} />
                  <Text style={[s.emptyTitle, { color: c.title }]}>No shops here yet</Text>
                  <Text style={[s.emptyText, { color: c.slate }]}>Shops for {title.toLowerCase()} are being added. Please check back soon.</Text>
                </View>
              ) : shops.map((shop) => {
                const open = shop.isOpen || shop.takesSlotOrders;
                const opens = fmtShortClock(shop.opensAt);
                const status = shop.isOpen ? 'Open now' : shop.takesSlotOrders ? (shop.nextSlotLabel ? `Next delivery ${shop.nextSlotLabel}` : 'Taking orders for the next slot') : (opens ? `Opens ${opens}` : 'Closed now');
                return (
                  <PressScale
                    key={shop.id}
                    onPress={() => router.push(`/restaurant/${shop.id}` as any)}
                    scaleTo={0.98}
                    accessibilityRole={BUTTON_ROLE}
                    accessibilityLabel={`${shop.name}, ${status}${shop.n ? `, ${shop.n} items in ${title}` : ''}. Open the shop`}
                    style={[st.card, { backgroundColor: c.card, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.06)' }]}
                  >
                    <View>
                      {shop.imageUrl || !shop.logoUrl ? (
                        <Image source={{ uri: shop.imageUrl || FALLBACK_IMG }} style={[st.cover, !open && { opacity: 0.55 }]} />
                      ) : (
                        // Only a logo: the brand mark large on a soft band instead of an empty cover.
                        <View style={[st.cover, st.logoBand, { backgroundColor: isDark ? 'rgba(76,193,122,0.10)' : '#EEF7F1' }, !open && { opacity: 0.55 }]}>
                          <Image source={{ uri: shop.logoUrl }} style={st.bandLogo} />
                        </View>
                      )}
                      {!!shop.logoUrl && shop.imageUrl && (
                        <View style={[st.logoWrap, { backgroundColor: c.card }]}>
                          <Image source={{ uri: shop.logoUrl }} style={st.logo} />
                        </View>
                      )}
                      {!open && <View style={st.closedPill}><Text style={st.closedText}>{status}</Text></View>}
                    </View>
                    <View style={[st.body, { paddingTop: shop.logoUrl && shop.imageUrl ? 28 : 14 }]}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={[st.name, { color: c.title }]} numberOfLines={1}>{shop.name}</Text>
                        <Text style={[st.meta, { color: c.slate }]} numberOfLines={1}>
                          {[shop.n ? `${shop.n} item${shop.n === 1 ? '' : 's'} in ${title.toLowerCase()}` : null, shop.deliveryTime || null].filter(Boolean).join(' · ') || 'Tap to see the menu'}
                        </Text>
                        {open && <Text style={[st.meta, { color: FOOD.primary, fontWeight: '600' }]} numberOfLines={1}>{status}</Text>}
                      </View>
                      {!!shop.rating && (
                        <View style={st.rating}>
                          <Icon name="star" size={12} color="#FFFFFF" />
                          <Text style={st.ratingText}>{shop.rating.toFixed(1)}</Text>
                        </View>
                      )}
                      <Icon name="chevron-forward" size={18} color={c.slate} />
                    </View>
                  </PressScale>
                );
              })}
              {shops.length > 0 && (
                <PressScale onPress={() => openListing(shelf)} accessibilityRole={BUTTON_ROLE} style={[st.allBtn, { borderColor: FOOD.primary }]}>
                  <Text style={[st.allText, { color: FOOD.primary }]}>See all {title.toLowerCase()} products</Text>
                  <Icon name="arrow-forward" size={16} color={FOOD.primary} />
                </PressScale>
              )}
            </ScrollView>
          )}
      {shopCount > 0 && basketBar()}
    </View>
  );
}

const st = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingTop: 6, paddingBottom: 14 },
  title: { color: '#FFFFFF', fontSize: 19, fontWeight: '700' },
  sub: { color: 'rgba(255,255,255,0.8)', fontSize: 12.5, marginTop: 1 },
  card: { borderRadius: 20, borderWidth: 1, overflow: 'hidden' },
  cover: { width: '100%', height: 132 },
  logoWrap: { position: 'absolute', left: 14, bottom: -22, width: 52, height: 52, borderRadius: 14, padding: 3, elevation: 3, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  logo: { width: '100%', height: '100%', borderRadius: 11 },
  logoBand: { alignItems: 'center', justifyContent: 'center' },
  bandLogo: { width: 96, height: 96, borderRadius: 22 },
  closedPill: { position: 'absolute', top: 10, left: 10, backgroundColor: 'rgba(15,23,42,0.82)', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 },
  closedText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  body: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingTop: 28, paddingBottom: 14 },
  name: { fontSize: 16.5, fontWeight: '700' },
  meta: { fontSize: 12.5, marginTop: 2 },
  rating: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#1F9D55', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3 },
  ratingText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  allBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1.5, borderRadius: 14, paddingVertical: 13, marginTop: 4 },
  allText: { fontSize: 14, fontWeight: '600' },
});
