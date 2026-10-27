import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, Platform, useWindowDimensions, Animated } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PressScale, BounceOnChange } from '../../modules/others/motion';
import { STATUS } from '../../modules/others/othersTheme';
import { FOOD } from './foodV2Theme';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { CachedImage as Image } from '../../components/SafeImage';
import { formatINR, isAmount, plural } from '../../utils/format';
import { useTopInset } from '../../utils/useTopInset';
import StatusBarScrim from '../../components/StatusBarScrim';
import FoodV2Gallery from './FoodV2Gallery';
import { demoGallery } from './demoGallery';
import { s, MAX_QTY, PRODUCT_FALLBACK_IMG, WISHLIST_KEY, NON_FOOD, specValue, sentence, tidy, discountOf } from './FoodV2ProductStyles';
import { Icon } from './FoodV2Icons';
import { fmtShortClock } from './FoodV2Data';
import { BUTTON_ROLE } from '../../utils/pressRole';
import { takesSlotOrders } from '../../utils/storeOpenNow';

/** The seller name used everywhere in Food & groceries (header, basket tab, saved items). */
const SELLER_LABEL = 'Campus store';

/**
 * Product page for Others → Food & groceries items (grocery, toys, seeds, electronics), after the
 * owner's reference v2 (23 Oct): the product photo on the green header band, round back / heart
 * buttons, name with a heart, real rating (or "New"), price with MRP and % off, a quantity stepper
 * next to "Add to basket", product details in a fixed order, "You may also like" and reviews.
 * Food dishes from Home keep their own layout in app/products/[id].tsx; this view only takes over
 * for shop items and gets all data and actions from that screen (same API calls and basket rules).
 */
type Props = {
  product: any;
  store: any;
  moreItems: any[];
  cart: any[];
  isDark: boolean;
  isSaved: boolean;
  averageRating: number;
  totalRatingCount: number;
  reviewsList: any[];
  canAdd: boolean;
  unavailableReason: string;
  customizable: boolean;
  onBack: () => void;
  onToggleSaved: () => void;
  onShare: () => void;
  onAdd: (payload: any) => void;
  onCustomize: () => void;
  onUpdateQuantity: (cartKey: string, qty: number) => void;
  onOpenProduct: (id: string) => void;
  onOpenStore: () => void;
  onOpenBasket: () => void;
  onRate: () => void;
  getImageUri: (uri?: string | null) => string | null;
};

export default function FoodV2ProductView(p: Props) {
  const { product, isDark } = p;
  const topPad = useTopInset(36, Platform.OS === 'web' ? 12 : 44);
  const { width: winW } = useWindowDimensions();
  const pageW = Math.min(winW, 600);
  const [imgIndex, setImgIndex] = useState(0);
  const [pickQty, setPickQty] = useState(1);
  // The photos sit under the status bar; once they scroll away the page colour goes behind the clock.
  const scrollY = useRef(new Animated.Value(0)).current;
  const galleryH = Math.round(Math.min(340, Math.max(280, pageW * 0.82))) + topPad;

  const m = isDark ? 'dark' : 'light';
  const c = {
    bg: isDark ? FOOD.page.dark : '#FFFFFF',
    card: FOOD.card[m],
    plate: isDark ? FOOD.plate.dark : '#FFFFFF',
    title: FOOD.title[m],
    name: FOOD.name[m],
    price: FOOD.price[m],
    slate: FOOD.slate[m],
    was: FOOD.was[m],
    off: FOOD.off[m],
    line: FOOD.line[m],
    mint: FOOD.mint[m],
    mintInk: FOOD.mintInk[m],
    label: isDark ? '#A1A1AA' : '#748E99',
  };
  const shadow = isDark ? { borderWidth: 1, borderColor: FOOD.line.dark } : Platform.select<any>({
    web: { boxShadow: '0px 1px 2px rgba(16,40,30,0.05), 0px 4px 14px rgba(16,40,30,0.07)' },
    default: { shadowColor: '#0F2A1E', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.08, shadowRadius: 10, elevation: 2 },
  });
  const plateShadow = Platform.select<any>({
    web: { boxShadow: '0px 10px 30px rgba(0,0,0,0.28)' },
    default: { shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.25, shadowRadius: 18, elevation: 8 },
  });

  // ── Saved state for "You may also like" cards (same device list the Others tab uses) ──
  const [savedIds, setSavedIds] = useState<string[]>([]);
  useEffect(() => {
    AsyncStorage.getItem(WISHLIST_KEY).then(raw => {
      try {
        const list = raw ? JSON.parse(raw) : [];
        if (Array.isArray(list)) setSavedIds(list.map((f: any) => (typeof f === 'string' ? f : f?.id)).filter(Boolean));
      } catch {}
    }).catch(() => {});
  }, []);
  const toggleRelatedSaved = useCallback(async (rel: any, relId: string, relImg: string) => {
    Haptics.selectionAsync().catch(() => {});
    const on = !savedIds.includes(relId);
    setSavedIds(ids => (on ? [relId, ...ids] : ids.filter(x => x !== relId)));
    try {
      const raw = await AsyncStorage.getItem(WISHLIST_KEY);
      let list: any[] = [];
      try { list = raw ? JSON.parse(raw) : []; } catch { list = []; }
      if (!Array.isArray(list)) list = [];
      list = list.filter((f: any) => (typeof f === 'string' ? f : f?.id) !== relId);
      if (on) {
        list.unshift({
          id: relId,
          title: rel.name,
          subtitle: [p.store?.name || product.restaurantName, rel.weight].filter(Boolean).join(' • ') || 'Campus store',
          price: isAmount(rel.price) ? formatINR(rel.price) : '',
          image: relImg,
          targetRoute: `/products/${relId}`,
        });
      }
      await AsyncStorage.setItem(WISHLIST_KEY, JSON.stringify(list));
    } catch {
      setSavedIds(ids => (on ? ids.filter(x => x !== relId) : [relId, ...ids]));
    }
  }, [savedIds, p.store, product.restaurantName]);

  const inCart = p.cart.find((i: any) => i.cartKey === product.id)?.quantity || 0;
  const images: string[] = product.images.length > 0 ? product.images : [PRODUCT_FALLBACK_IMG];
  // TODO before the Play release: demoGallery is preview-only; stores / admin upload 2–5 real photos (specs.images).
  const gallery = demoGallery(images, String(product.name || ''));
  const bandH = Math.round(Math.min(pageW * 0.62, 300));
  const plateW = Math.round(Math.min(pageW * 0.56, 260));
  const storeName: string = p.store?.name || product.restaurantName || '';
  // The item's own flag follows the store's hours only; the store (GET /api/users/restaurants/:id) also
  // applies the campus night window. Either one closed = show "Opens 6 am" and block adding, unless the store
  // takes orders for its next delivery slot (server takesSlotOrders, as on the store page).
  const slotOrder = product.takesSlotOrders === true || takesSlotOrders(p.store);
  const slotLabel: string | null = product.nextSlotLabel || p.store?.nextSlotLabel || null;
  const storeShut = !!product.isAvailable && (p.store?.isOpen === false || product.storeIsOpen === false);
  const storeClosed = storeShut && !slotOrder;
  const opensAt = fmtShortClock(p.store?.opensAt);
  const closedText = opensAt ? `Opens ${opensAt}` : 'Closed now';
  const canAdd = p.canAdd && !storeClosed;
  const reason = storeClosed
    ? `The ${SELLER_LABEL.toLowerCase()} is closed now.${opensAt ? ` Opens ${opensAt}.` : ''} You can add this once it opens.`
    : p.unavailableReason;
  // You may also like: same category first, then the rest of the store.
  const related = useMemo(() => {
    const cat = String(product.category || '').toLowerCase();
    const same = (r: any) => (cat && String(r.category || '').toLowerCase() === cat ? 1 : 0);
    return [...p.moreItems].map((r, i) => ({ r, i })).sort((a, b) => same(b.r) - same(a.r) || a.i - b.i).map(x => x.r);
  }, [p.moreItems, product.category]);
  const isFood = String(product.vendorType || '').toUpperCase() === 'GROCERY' && !NON_FOOD.test(String(product.category || ''));
  const specs = product.specs && typeof product.specs === 'object' ? product.specs : {};

  // ── Product details: one fixed order, a row only when the data exists ──
  const brand = specValue(specs, ['brand', 'Brand', 'manufacturer']) || (product.brand ? String(product.brand) : null);
  const size = product.weight ? String(product.weight) : specValue(specs, ['weight', 'size', 'netQuantity', 'net_quantity', 'quantity', 'pack']);
  const category = product.category ? sentence(String(product.category)) : null;
  const diet = isFood && typeof product.isVegetarian === 'boolean' ? (product.isVegetarian ? 'Veg' : 'Non-veg') : null;
  const shelfLife = specValue(specs, ['shelfLife', 'shelf_life', 'shelflife', 'bestBefore', 'best_before']);
  const origin = specValue(specs, ['countryOfOrigin', 'country_of_origin', 'origin', 'madeIn', 'made_in']);
  const detailRows = useMemo(() => ([
    ['Brand', brand],
    ['Size / weight', size],
    ['Category', category],
    ['Veg / non-veg', diet],
    ['Shelf life', shelfLife],
    ['Country of origin', origin],
  ] as [string, string | null][]).filter((r): r is [string, string] => !!r[1]), [brand, size, category, diet, shelfLife, origin]);
  // Any other real spec rows (ingredients, storage...) follow under "More information".
  const TABLE_LABEL = /brand|manufacturer|weight|pack|size|quantity|shelf|best before|origin|made in|category|veg|emoji/i;
  const extraRows: { label: string; value: string }[] = Array.isArray(product.specRows)
    ? product.specRows.filter((r: any) => r && r.label && r.value && !TABLE_LABEL.test(String(r.label))).slice(0, 6)
    : [];

  // Description: the catalogue's own text, tidied; otherwise a short neutral line from real fields only.
  const description = useMemo(() => {
    if (product.description) return tidy(String(product.description));
    const name = String(product.name || '').trim();
    if (!name) return '';
    const byBrand = brand && !name.toLowerCase().includes(brand.toLowerCase()) ? ` by ${brand}` : '';
    const pack = size && !name.toLowerCase().includes(size.toLowerCase().replace(/\s+/g, '')) && !name.toLowerCase().includes(size.toLowerCase()) ? `, ${size} pack` : '';
    const from = ` Sold by the ${SELLER_LABEL.toLowerCase()} and delivered to your hostel.`;
    return `${name}${byBrand}${pack}.${from}`;
  }, [product.description, product.name, brand, size]);

  const qtyShown = inCart > 0 ? inCart : pickQty;
  const tap = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  const dec = () => {
    tap();
    if (inCart > 0) p.onUpdateQuantity(product.id, inCart - 1);
    else setPickQty(q => Math.max(1, q - 1));
  };
  const inc = () => {
    tap();
    if (inCart > 0) p.onUpdateQuantity(product.id, Math.min(MAX_QTY, inCart + 1));
    else setPickQty(q => Math.min(MAX_QTY, q + 1));
  };
  const payload = () => ({
    id: product.id,
    name: product.name,
    price: product.price,
    image: product.images[0] || '',
    restaurantId: product.restaurantId,
    restaurantName: product.restaurantName || p.store?.name || '',
  });
  const add = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    if (p.customizable) p.onCustomize();
    else p.onAdd({ ...payload(), quantity: pickQty });
  };

  const stock = !product.isAvailable
    ? { text: 'Sold out', color: isDark ? STATUS.dark.error : STATUS.light.error }
    : storeClosed
      ? { text: closedText, color: isDark ? STATUS.dark.warn : STATUS.light.warn }
      : canAdd
      ? { text: 'In stock', color: c.off }
      : null;
  const hasRating = p.totalRatingCount > 0 && p.averageRating > 0;
  const relCardW = Math.floor((pageW - 32 - 12) / 2.15);

  return (
    <View style={[s.root, { backgroundColor: c.bg }]}>
      <Animated.ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 48 }} scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: Platform.OS !== 'web' })}>
        {/* ── Gallery: 2–5 photos (own photo first; demo photos are preview-only, see demoGallery.ts) ── */}
        <FoodV2Gallery images={gallery} topPad={topPad} isSaved={p.isSaved} name={product.name} onBack={p.onBack} onShare={p.onShare} onToggleSaved={p.onToggleSaved} />

        {/* ── Name, rating / stock, price ── */}
        <View style={s.block}>
          {/* one save heart only: the one on the photo */}
          <View style={s.nameRow}>
            <Text style={[s.name, { color: c.title }]} accessibilityRole="header">{product.name}</Text>
          </View>

          <View style={s.metaRow}>
            {hasRating ? (
              <View style={s.metaItem} accessibilityLabel={`Rated ${p.averageRating.toFixed(1)} from ${plural(p.totalRatingCount, 'review')}`}>
                <Icon name="star" size={15} color={FOOD.primary} />
                <Text style={[s.metaText, { color: c.name }]}>{p.averageRating.toFixed(1)} <Text style={{ color: c.slate }}>({p.totalRatingCount})</Text></Text>
              </View>
            ) : (
              <View style={[s.newPill, { backgroundColor: c.mint }]} accessibilityLabel="New item, no reviews yet">
                <Text style={[s.newPillText, { color: c.mintInk }]}>New</Text>
              </View>
            )}
            {!!stock && <View style={[s.metaBar, { backgroundColor: c.line }]} />}
            {!!stock && <Text style={[s.metaText, { color: stock.color, fontWeight: '500' }]}>{stock.text}</Text>}
          </View>

          <View style={s.priceRow}>
            <Text style={[s.price, { color: c.price, fontSize: 26, fontWeight: '600' }]}>{formatINR(product.price)}</Text>
            {!!product.originalPrice && <Text style={[s.was, { color: c.was }]}>{formatINR(product.originalPrice, { paise: 'never' })}</Text>}
            {!!product.discountPercent && <Text style={[s.off, { color: c.off }]}>{product.discountPercent}% off</Text>}
          </View>

          <View style={[s.metaItem, { marginTop: 8 }]}>
            <Icon name="truck" size={14} color={c.slate} />
            <Text style={[s.deliver, { color: c.slate, flex: 1 }]}>{storeShut && slotOrder && slotLabel ? `Next delivery: ${slotLabel}` : p.store?.time ? `Delivered in about ${p.store.time}` : 'Delivered to your hostel'} · Cash or Wallet</Text>
          </View>
          {/* The fee is set on the server and can change with offers or Elite, so it is never guessed here. */}
          <Text style={[s.deliver, { color: c.slate, marginTop: 4, marginLeft: 19 }]}>Delivery fee shown in basket</Text>

          {!canAdd && (
            <View style={[s.notice, { backgroundColor: isDark ? STATUS.dark.warnTint : STATUS.light.warnTint }]}>
              <Icon name="time-outline" size={16} color={isDark ? STATUS.dark.warn : STATUS.light.warn} />
              <Text style={[s.noticeText, { color: c.title }]}>{reason}</Text>
            </View>
          )}

          {/* ── Quantity + Add to basket ── */}
          <View style={s.actionRow}>
            {canAdd && !p.customizable && (
              <View style={[s.stepper, { backgroundColor: c.mint }]}>
                <PressScale style={s.stepBtn} onPress={dec} disabled={inCart === 0 && pickQty <= 1} accessibilityRole={BUTTON_ROLE} accessibilityLabel={inCart > 0 ? 'Remove one' : 'One less'}>
                  <Icon name="remove" size={20} color={inCart === 0 && pickQty <= 1 ? c.was : c.mintInk} />
                </PressScale>
                <BounceOnChange value={qtyShown}><Text style={[s.stepQty, { color: c.title }]}>{qtyShown}</Text></BounceOnChange>
                <PressScale style={s.stepBtn} onPress={inc} disabled={qtyShown >= MAX_QTY} accessibilityRole={BUTTON_ROLE} accessibilityLabel={inCart > 0 ? 'Add one more' : 'One more'}>
                  <Icon name="add" size={20} color={qtyShown >= MAX_QTY ? c.was : c.mintInk} />
                </PressScale>
              </View>
            )}
            {!canAdd ? (
              <View style={[s.cta, { backgroundColor: isDark ? '#3F3F46' : '#D5DEDA' }]} accessibilityRole="text">
                <Text style={s.ctaText}>{!product.isAvailable ? 'Sold out' : storeClosed ? closedText : 'Unavailable'}</Text>
              </View>
            ) : inCart > 0 ? (
              <PressScale style={[s.cta, { backgroundColor: FOOD.cta }]} onPress={p.onOpenBasket} accessibilityRole={BUTTON_ROLE} accessibilityLabel={`View basket, ${plural(inCart, 'item')} of this product`}>
                <Text style={s.ctaText}>View basket</Text>
                <Icon name="arrow-forward" size={17} color="#FFFFFF" />
              </PressScale>
            ) : (
              <PressScale style={[s.cta, { backgroundColor: FOOD.cta }]} onPress={add} accessibilityRole={BUTTON_ROLE}>
                <Text style={s.ctaText}>{p.customizable ? 'Customise and add' : 'Add to basket'}</Text>
              </PressScale>
            )}
          </View>
        </View>

        {/* ── Product details ── */}
        <View style={[s.section, { borderTopColor: c.line }]}>
          <Text style={[s.secTitle, { color: c.title }]}>Product details</Text>
          {!!description && <Text style={[s.desc, { color: c.slate }]}>{description}</Text>}
          {detailRows.length > 0 && (
            <View style={[s.table, { borderTopColor: c.line }]}>
              {detailRows.map(([label, value]) => (
                <View key={label} style={s.tRow}>
                  <Text style={[s.tLabel, { color: c.label }]}>{label}</Text>
                  <Text style={[s.tValue, { color: c.name }]}>{value}</Text>
                </View>
              ))}
            </View>
          )}
          {!!storeName && (
            <PressScale style={s.soldBy} onPress={p.onOpenStore} disabled={!product.restaurantId} accessibilityRole={BUTTON_ROLE} accessibilityLabel={`Sold by the ${SELLER_LABEL}, packed by ${storeName}. Open the store`}>
              <Icon name="storefront-outline" size={15} color={FOOD.primary} />
              <Text style={[s.soldByText, { color: c.slate, flex: 1 }]} numberOfLines={2}>Sold by <Text style={{ color: c.name, fontWeight: '500' }}>{SELLER_LABEL}</Text>{storeName && storeName !== SELLER_LABEL ? ` · ${storeName}` : ''}</Text>
              <Icon name="chevron-forward" size={15} color={c.slate} />
            </PressScale>
          )}
        </View>

        {extraRows.length > 0 && (
          <View style={[s.section, { borderTopColor: c.line }]}>
            <Text style={[s.secTitle, { color: c.title }]}>More information</Text>
            {extraRows.map(r => (
              <View key={r.label} style={s.tRow}>
                <Text style={[s.tLabel, { color: c.label }]}>{r.label}</Text>
                <Text style={[s.tValue, { color: c.name }]}>{r.value}</Text>
              </View>
            ))}
          </View>
        )}

        {/* ── You may also like (same store) ── */}
        {related.length > 0 && (
          <View style={{ marginTop: 20 }}>
            <Text style={[s.secTitle, { color: c.title, paddingHorizontal: 20 }]}>You may also like</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.moreRail}>
              {related.map((rel: any) => {
                const relId = String(rel.id || rel._id);
                const relImg = p.getImageUri(rel.imageUrl || rel.image) || PRODUCT_FALLBACK_IMG;
                const relQty = p.cart.find((i: any) => i.cartKey === relId)?.quantity || 0;
                const relCanAdd = !!product.restaurantId && rel.orderable !== false && (p.store?.isOpen !== false || takesSlotOrders(p.store));
                const relOff = discountOf(Number(rel.price), Number(rel.originalPrice));
                const relSaved = savedIds.includes(relId);
                return (
                  <View key={relId} style={[s.moreCard, shadow, { width: relCardW, backgroundColor: c.card }]}>
                    <PressScale style={[s.morePlate, { backgroundColor: isDark ? FOOD.plate.dark : FOOD.plate.light }]} onPress={() => p.onOpenProduct(relId)} accessibilityRole={BUTTON_ROLE} accessibilityLabel={`${rel.name}. Open details`}>
                      <Image source={{ uri: relImg }} style={s.moreImg} resizeMode="contain" />
                    </PressScale>
                    <PressScale style={s.moreHeart} onPress={() => toggleRelatedSaved(rel, relId, relImg)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole={BUTTON_ROLE} accessibilityLabel={relSaved ? `Remove ${rel.name} from saved items` : `Save ${rel.name}`}>
                      <Icon name={relSaved ? 'heart' : 'heart-outline'} size={18} color={relSaved ? FOOD.primary : c.slate} />
                    </PressScale>
                    <Text style={[s.moreName, { color: c.name }]} numberOfLines={2}>{rel.name}</Text>
                    <View style={s.morePriceRow}>
                      {isAmount(rel.price) && <Text style={[s.morePrice, { color: c.price }]}>{formatINR(rel.price)}</Text>}
                      {relOff > 0 && <Text style={[s.moreOff, { color: c.off }]}>{relOff}% off</Text>}
                      <View style={{ flex: 1 }} />
                      {relCanAdd && (relQty > 0 ? (
                        <View style={[s.miniStepper, { backgroundColor: FOOD.primary }]}>
                          <PressScale style={s.miniBtn} onPress={() => { tap(); p.onUpdateQuantity(relId, relQty - 1); }} accessibilityRole={BUTTON_ROLE} accessibilityLabel={`Remove one ${rel.name}`}>
                            <Icon name="remove" size={14} color="#FFFFFF" />
                          </PressScale>
                          <Text style={s.miniQty}>{relQty}</Text>
                          <PressScale style={s.miniBtn} onPress={() => { tap(); p.onUpdateQuantity(relId, Math.min(MAX_QTY, relQty + 1)); }} accessibilityRole={BUTTON_ROLE} accessibilityLabel={`Add one more ${rel.name}`}>
                            <Icon name="add" size={14} color="#FFFFFF" />
                          </PressScale>
                        </View>
                      ) : (
                        <PressScale
                          style={[s.plus, { backgroundColor: FOOD.primary }]}
                          onPress={() => { tap(); p.onAdd({ id: relId, name: rel.name, price: Number(rel.price), image: p.getImageUri(rel.imageUrl || rel.image) || '', restaurantId: product.restaurantId, restaurantName: storeName }); }}
                          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                          accessibilityRole={BUTTON_ROLE}
                          accessibilityLabel={`Add ${rel.name} to basket`}
                        >
                          <Icon name="add" size={17} color="#FFFFFF" />
                        </PressScale>
                      ))}
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* ── Ratings and reviews (real reviews only: GET /api/users/products/:id/reviews) ──
            Hook: when the owner approves showing store reviews, they arrive through the same
            `reviewsList` / `averageRating` / `totalRatingCount` props; with none, the item shows "New". */}
        <View style={[s.section, { borderTopColor: c.line, marginTop: 20 }]}>
          <View style={s.revHead}>
            <View style={{ flex: 1 }}>
              <Text style={[s.secTitle, { color: c.title, marginBottom: 2 }]}>Ratings and reviews</Text>
              {hasRating ? (
                <View style={s.metaItem}>
                  <Icon name="star" size={14} color={FOOD.primary} />
                  <Text style={[s.metaText, { color: c.name }]}>{p.averageRating.toFixed(1)} <Text style={{ color: c.slate }}>from {plural(p.totalRatingCount, 'review')}</Text></Text>
                </View>
              ) : (
                <View style={s.metaItem}>
                  <View style={[s.newPill, { backgroundColor: c.mint }]}><Text style={[s.newPillText, { color: c.mintInk }]}>New</Text></View>
                  <Text style={[s.metaText, { color: c.slate }]}>No reviews yet</Text>
                </View>
              )}
            </View>
            <PressScale style={[s.rateBtn, { borderColor: FOOD.primary }]} onPress={p.onRate} accessibilityRole={BUTTON_ROLE}>
              <Text style={[s.rateBtnText, { color: isDark ? FOOD.off.dark : FOOD.primary }]}>Rate this item</Text>
            </PressScale>
          </View>
          {p.reviewsList.slice(0, 3).map((rev: any) => (
            <View key={rev.id} style={[s.review, { borderTopColor: c.line }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={[s.reviewName, { color: c.name }]} numberOfLines={1}>{rev.name || 'Customer'}</Text>
                <Icon name="star" size={12} color={FOOD.primary} />
                <Text style={[s.reviewName, { color: c.name }]}>{rev.rating}</Text>
              </View>
              {!!rev.comment && <Text style={[s.desc, { color: c.slate, marginTop: 4 }]}>{rev.comment}</Text>}
            </View>
          ))}
        </View>
      </Animated.ScrollView>
      <StatusBarScrim color={c.bg} scrollY={scrollY} from={galleryH - topPad - 48} to={galleryH - topPad} />
    </View>
  );
}

