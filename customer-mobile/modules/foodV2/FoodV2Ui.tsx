/**
 * Food & groceries v2: building blocks (header button, chips, section head, add control, product row and card, tiles, basket bar).
 * Others → Food & groceries (modules/foodV2).
 */
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Platform, Alert, Modal, useWindowDimensions, BackHandler, type ImageSourcePropType } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import Svg, { Path } from 'react-native-svg';
import { useRouter, useFocusEffect } from 'expo-router';
import { CachedImage as Image } from '../../components/SafeImage';
import ShimmerLoader from '../../components/ShimmerLoader';
import { PressScale, BounceOnChange, FadeInUp, SlowLoadHint } from '../../modules/others/motion';
import { useCart, isCustomRequest } from '../../context/CartContext';
import { apiFetch, readJson } from '../../utils/auth';
import { API_URL } from '../../constants/api';
import { readCache } from '../../utils/swrCache';
import { useConnectionState } from '../../utils/offlineStatus';
import { useTopInset } from '../../utils/useTopInset';
import { FOOD } from './foodV2Theme';
import { FOOD_IMG, StorefrontArt, WaveArt, LoadingDots } from './FoodV2Kit';
import { IonName, Item, SHOP_TYPES, CATALOGUE_CACHE_KEY, FALLBACK_IMG, MEGA_BASKET_VENDOR, WISHLIST_KEY, toItem, toList, groupIN, fmt, fmtMrp, sentence, offLabel, fmtShortClock, squash, Shelf, SHELVES, shelfItems, SEARCH, SEARCH_HINTS, TILES, Hero, HEROES, LIST_TITLES, AISLES, aisleOf, SHORT_CHIP, chipLabel, FRESH_CATS, GROUP_ORDER, groupOf, BRANDS, TOY_TILES, HEALTH_TILES, ESSENTIAL_AISLES, HERO_BG, LHERO_BG, Route, DemoState, Saved } from './FoodV2Data';
import { s } from './FoodV2Styles';
import { useFoodV2, type FoodV2RowActions } from './useFoodV2';
import { useScreenActive } from '../../utils/useAppActive';
import { Icon } from './FoodV2Icons';
import Thumb from './FoodV2Thumb';
import FoodV2BasketBar from './FoodV2BasketBar';
import { BUTTON_ROLE } from '../../utils/pressRole';

const st = StyleSheet.create({
  rowCol: { flex: 1, minWidth: 0, alignSelf: 'stretch', justifyContent: 'space-between' },
  rowText: { paddingRight: 22 },
  rowName: { lineHeight: 18, maxHeight: 36 },
  rowMeta: { height: 16, lineHeight: 16 },
  priceLine: { height: 22, lineHeight: 22, marginTop: 6 },
  rowCtl: { height: 30, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' },
  sample: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 7, backgroundColor: '#FFF6DF', borderWidth: StyleSheet.hairlineWidth, borderColor: '#EED9A4', alignSelf: 'flex-start' },
  sampleText: { fontSize: 11, lineHeight: 14, color: '#8A6A1E', fontWeight: '500' },
});

/** Listing rows have one fixed height (FlatList getItemLayout): name (2 lines), size, price line, then the
 *  "+" / stepper on its own line, so the stepper never covers the price or the % off. */
export const ROW_H = 134;
/** Gap below each listing row (part of the row's FlatList slot). */
export const ROW_GAP = 10;

type RowColors = { card: string; line: string; slate: string; mint: string; mintInk: string; title: string; name: string; price: string; was: string; off: string };

/** Soft amber "Sample" tag (same tones as the Rentals / Events sample tags). With onPress it is the row's
 *  control: a 44 px tap area that opens the sample sheet. */
export function SampleTag({ isDark, onPress, label }: { isDark: boolean; onPress?: () => void; label?: string }) {
  const tag = (
    <View style={[st.sample, isDark ? { backgroundColor: 'rgba(255,214,128,0.12)', borderColor: 'rgba(255,214,128,0.28)' } : null]}>
      <Text style={[st.sampleText, isDark ? { color: '#F3D38A' } : null]}>Sample</Text>
    </View>
  );
  if (!onPress) return <View accessibilityLabel="Sample">{tag}</View>;
  return (
    <PressScale onPress={onPress} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole={BUTTON_ROLE} accessibilityLabel={label || 'Sample. Opens a note'}>
      {tag}
    </PressScale>
  );
}

/** One line: price, struck MRP (whole rupees) and % off; never wraps under the add control. */
function PriceLine({ p, c, big = false }: { p: Item; c: RowColors; big?: boolean }) {
  const off = offLabel(p);
  return (
    <Text style={st.priceLine} numberOfLines={1}>
      <Text style={[big ? s.priceBig : s.price, { color: c.price }]}>{fmt(p.price)}</Text>
      {!!p.originalPrice && <Text style={[s.was, { color: c.was }]}>{'  '}{fmtMrp(p.originalPrice)}</Text>}
      {!!off && <Text style={[s.off, { color: c.off }]}>{'  '}{off}</Text>}
    </Text>
  );
}

/** "+", a mint − 1 + stepper once in the basket, or "Opens 9 am" while the shop is closed. */
function AddControlView({ p, q, closed, compact, isDark, c, greenGlow, actions }: {
  p: Item; q: number; closed: string | null; compact: boolean; isDark: boolean; c: RowColors; greenGlow: any; actions: FoodV2RowActions;
}) {
  // A sample (foodV2Demo.ts) shows its "Sample" tag here instead of "+"; the tap opens the sample sheet.
  if (p.isDemoContent) return <SampleTag isDark={isDark} onPress={() => actions.openProduct(p)} label={`${p.name} is a sample. Opens a note`} />;
  if (!p.isAvailable) return <Text style={[s.soldText, { color: c.slate }]}>Sold out</Text>;
  if (!p.orderable && q === 0) {
    const label = closed || 'Closed now';
    return (
      <View style={s.closedWrap}>
        <View style={[s.closedPill, { borderColor: c.line, backgroundColor: c.card }]} accessibilityLabel={label}>
          <Text style={[s.closedText, { color: c.slate }]} numberOfLines={1}>{label}</Text>
        </View>
        {!compact && (
          <PressScale style={[s.plus, { backgroundColor: isDark ? '#3F3F46' : '#C3CDCA' }]} onPress={() => actions.addProduct(p)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole={BUTTON_ROLE} accessibilityLabel={`${p.name}: ${label}`}>
            <Icon name="add" size={18} color="#FFFFFF" />
          </PressScale>
        )}
      </View>
    );
  }
  if (q > 0) {
    return (
      <View style={s.stepper}>
        <PressScale style={[s.stepBtn, { backgroundColor: c.mint }]} onPress={() => actions.decProduct(p.id)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 2 }} accessibilityRole={BUTTON_ROLE} accessibilityLabel={`Remove one ${p.name}. ${q} in basket`}>
          <Icon name="remove" size={15} color={c.mintInk} />
        </PressScale>
        <View style={[s.stepBtn, { backgroundColor: c.mint }]}><BounceOnChange value={q}><Text style={[s.stepQty, { color: c.title }]}>{q}</Text></BounceOnChange></View>
        <BounceOnChange value={q}>
          <PressScale style={[s.stepBtn, { backgroundColor: c.mint }]} onPress={() => actions.addProduct(p)} hitSlop={{ top: 6, bottom: 6, left: 2, right: 6 }} accessibilityRole={BUTTON_ROLE} accessibilityLabel={`Add one more ${p.name}. ${q} in basket`}>
            <Icon name="add" size={15} color={c.mintInk} />
          </PressScale>
        </BounceOnChange>
      </View>
    );
  }
  return (
    <PressScale style={[s.plus, { backgroundColor: FOOD.primary }, greenGlow]} onPress={() => actions.addProduct(p)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole={BUTTON_ROLE} accessibilityLabel={`Add ${p.name} to basket`}>
      <Icon name="add" size={18} color="#FFFFFF" />
    </PressScale>
  );
}

type ProductRowProps = {
  p: Item; q: number; isSaved: boolean; closed: string | null; plate: number; flat: boolean; isDark: boolean;
  c: RowColors; shadow: any; greenGlow: any; savedSample: boolean; actions: FoodV2RowActions; onOpen?: () => void;
};
/**
 * Product row (listings, search, saved sheet): photo, name, size, price line, heart, then "+" / stepper.
 * Memoized on what it shows (quantity, saved, closed label, theme): typing in search, a toast or a basket
 * change elsewhere used to re-render every visible row with its photo, icons and press animations.
 * onOpen is read from a ref (callers pass a fresh closure each render).
 */
const ProductRow = React.memo(function ProductRow({ p, q, isSaved, closed, plate, flat, isDark, c, shadow, greenGlow, savedSample, actions, onOpen }: ProductRowProps) {
  const openRef = useRef(onOpen);
  openRef.current = onOpen;
  const open = useCallback(() => { if (openRef.current) openRef.current(); else actions.openProduct(p); }, [actions, p]);
  return (
    <View style={[s.row, { backgroundColor: c.card, height: Math.max(ROW_H, plate + 24) }, flat ? { borderRadius: 0, borderBottomWidth: 1, borderBottomColor: c.line } : shadow]}>
      <PressScale onPress={open} accessibilityRole={BUTTON_ROLE} accessibilityLabel={p.isDemoContent ? `${p.name}${p.weight ? `, ${p.weight}` : ''}, sample, not for sale yet. Opens a note` : `${p.name}${p.weight ? `, ${p.weight}` : ''}, ${fmt(p.price)}${!p.isAvailable ? ', sold out' : ''}. Open details`}>
        <Thumb uri={p.image} art={p.art} size={plate} isDark={isDark} group={groupOf(p)} dim={!p.isAvailable} />
      </PressScale>
      <View style={st.rowCol}>
        <PressScale style={st.rowText} onPress={open} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Text style={[s.rowName, st.rowName, { color: c.name }]} numberOfLines={2}>{p.name}</Text>
          {/* size line always has its slot, so look-alike names still differ by size */}
          <Text style={[s.rowMeta, st.rowMeta, { color: c.slate }]} numberOfLines={1}>{p.weight || ' '}</Text>
          <PriceLine p={p} c={c} />
        </PressScale>
        <View style={st.rowCtl}><AddControlView p={p} q={q} closed={closed} compact={false} isDark={isDark} c={c} greenGlow={greenGlow} actions={actions} /></View>
      </View>
      {!p.isDemoContent && (
        <PressScale style={s.rowHeart} onPress={() => { if (!savedSample) actions.toggleSaved(p); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole={BUTTON_ROLE} accessibilityLabel={isSaved ? `Remove ${p.name} from saved items` : `Save ${p.name}`}>
          <Icon name={isSaved ? 'heart' : 'heart-outline'} size={16} strokeWidth={1.5} color={isSaved ? FOOD.primary : c.was} />
        </PressScale>
      )}
    </View>
  );
}, (a, b) => a.p === b.p && a.q === b.q && a.isSaved === b.isSaved && a.closed === b.closed && a.plate === b.plate
  && a.flat === b.flat && a.isDark === b.isDark && a.c === b.c && a.shadow === b.shadow && a.greenGlow === b.greenGlow
  && a.savedSample === b.savedSample && a.actions === b.actions && !a.onOpen === !b.onOpen);

export function useFoodV2Ui() {
  const { router, isDark, m, topPad, winW, pageW, conn, cart, addToCart, updateQuantity, clearCart, mounted, c, shadow, greenGlow, stack, setStack, route, push, pop, homeKey, setHomeKey, reset, demo, setDemo, savedSheet, setSavedSheet, savedSample, setSavedSample, catalogue, setCatalogue, status, setStatus, storeHours, setStoreHours, fromNet, fetchCatalogue, saved, setSaved, loadSaved, savedIds, persistSaved, toggleSaved, qtyOf, closedLabel, addProduct, decProduct, storeIds, shopLines, shopCount, shopTotal, cartCount, query, setQuery, chip, setChip, chipsOpen, setChipsOpen, aisle, setAisle, savedChip, setSavedChip, openListing, openProduct, inStock, closedShare, allClosed, someClosed, earliestOpen, hasShelf, dealShelf, topDeal, fromPrice, upTo, failKind, forcedFail, isLoading, isFailed, isEmpty, sampleSaved, savedResolved, savedGroup, savedCounts, savedChips, clean, forceDark, rowActions } = useFoodV2();
  /** Plain header icon (no circle): lucide 22 / 1.6 in a 44 px tap area; gold count pill or unread dot. */
  const headerBtn = (icon: IonName, label: string, onPress: () => void, badge = 0, dot = false) => (
    <PressScale style={s.hdrBtn} scaleTo={0.92} haptic onPress={onPress} accessibilityRole={BUTTON_ROLE} accessibilityLabel={badge ? `${label}, ${badge} item${badge === 1 ? '' : 's'}` : label}>
      <Icon name={icon} size={22} strokeWidth={1.6} color="rgba(255,255,255,0.95)" />
      {badge > 0 && <View style={s.hdrBadge}><Text style={s.hdrBadgeText}>{badge > 99 ? '99+' : badge}</Text></View>}
      {dot && badge === 0 && <View style={s.hdrDot} />}
    </PressScale>
  );

  const chipOnWhite = (key: string, label: string, active: boolean, onPress: () => void, more = false) => (
    <PressScale key={key} onPress={onPress} scaleTo={0.95} accessibilityRole="tab" accessibilityState={{ selected: active }} accessibilityLabel={label}
      style={[s.chip, { backgroundColor: active ? FOOD.primary : c.chip }, active && greenGlow]}>
      <Text style={[s.chipText, { color: active ? '#FFFFFF' : c.slate, fontWeight: active ? '500' : '400' }]}>{label}</Text>
      {more && <Icon name="chevron-forward" size={13} color={c.slate} />}
    </PressScale>
  );
  const chipOnGreen = (key: string, label: string, active: boolean, onPress: () => void) => (
    <PressScale key={key} onPress={onPress} scaleTo={0.95} accessibilityRole="tab" accessibilityState={{ selected: active }} accessibilityLabel={label}
      style={[s.chip, active ? { backgroundColor: FOOD.onGreenChipSel } : { backgroundColor: FOOD.onGreenChip, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }]}>
      <Text style={[s.chipText, { color: active ? FOOD.onGreenChipSelInk : '#FFFFFF', fontWeight: active ? '500' : '400' }]}>{label}</Text>
      {active && <View style={s.chipDot} />}
    </PressScale>
  );

  const head = (title: string, opts?: { sub?: string | null; onAll?: () => void; label?: string; arrow?: boolean }) => (
    <View style={s.head}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[s.headTitle, { color: c.title }]} accessibilityRole="header" numberOfLines={2}>{title}</Text>
        {!!opts?.sub && <Text style={[s.headSub, { color: c.off }]}>{opts.sub}</Text>}
      </View>
      {!!opts?.onAll && (
        <PressScale style={s.linkBtn} onPress={opts.onAll} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole={BUTTON_ROLE} accessibilityLabel={`${opts.label || 'View all'}: ${title}`}>
          <Text style={[s.link, { color: c.link }]}>{opts.label || 'View all'}</Text>
          <Icon name={opts.arrow ? 'arrow-forward' : 'chevron-forward'} size={15} color={c.link} />
        </PressScale>
      )}
    </View>
  );

  /** "+", a mint − 1 + stepper once in the basket, or "Opens 9 am" while the shop is closed. */
  const addControl = (p: Item, compact = false) => (
    <AddControlView p={p} q={qtyOf(p.id)} closed={closedLabel(p)} compact={compact} isDark={isDark} c={c} greenGlow={greenGlow} actions={rowActions} />
  );

  /** One line: price, struck MRP (whole rupees) and % off; never wraps under the add control. */
  const priceRow = (p: Item, big = false) => <PriceLine p={p} c={c} big={big} />;

  /** Product row (listings, search, saved sheet): the memoized ProductRow above. */
  const productRow = (p: Item, opts?: { plate?: number; flat?: boolean; onOpen?: () => void }) => (
    <ProductRow key={p.id} p={p} q={qtyOf(p.id)} isSaved={savedIds.has(p.id) || (savedSample && sampleSaved.some(f => f.id === p.id))}
      closed={closedLabel(p)} plate={opts?.plate || 76} flat={!!opts?.flat} isDark={isDark} c={c} shadow={shadow} greenGlow={greenGlow}
      savedSample={!!savedSample} actions={rowActions} onOpen={opts?.onOpen} />
  );

  /** Product card (saved grid): photo plate with a heart, name, price and % off, "+" on the plate. */
  const productCard = (p: Item, w: number) => {
    const isSaved = savedIds.has(p.id) || (savedSample && sampleSaved.some(f => f.id === p.id));
    const off = offLabel(p);
    return (
      <View key={p.id} style={[s.card, { width: w, backgroundColor: c.card }, shadow]}>
        <View>
          <PressScale onPress={() => openProduct(p)} accessibilityRole={BUTTON_ROLE} accessibilityLabel={`${p.name}, ${fmt(p.price)}. Open details`}>
            <Thumb uri={p.image} size="100%" isDark={isDark} group={groupOf(p)} dim={!p.isAvailable} />
          </PressScale>
          <PressScale style={s.cardHeart} onPress={() => { if (!savedSample) toggleSaved(p); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole={BUTTON_ROLE} accessibilityLabel={isSaved ? `Remove ${p.name} from saved items` : `Save ${p.name}`}>
            <Icon name={isSaved ? 'heart' : 'heart-outline'} size={16} strokeWidth={1.5} color={isSaved ? FOOD.primary : c.was} />
          </PressScale>
        </View>
        <PressScale onPress={() => openProduct(p)} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Text style={[s.cardName, { color: c.name }]} numberOfLines={2}>{p.name}</Text>
          <Text style={[s.rowMeta, { color: c.slate, paddingHorizontal: 2 }]} numberOfLines={1}>{p.weight || ' '}</Text>
          <View style={s.priceRow}>
            <Text style={[s.price, { color: c.price }]}>{fmt(p.price)}</Text>
            {!!off && <Text style={[s.off, { color: c.off, marginLeft: 6 }]}>{off}</Text>}
          </View>
        </PressScale>
      </View>
    );
  };

  /** White tile: photo on top, label (and an optional green line) below. `img` may be a bundled photo (samples);
   *  `sample` shows the "Sample" tag in place of the green line. */
  const miniTile = (key: string, label: string, sub: string | null, img: string | ImageSourcePropType, onPress: () => void, w: number, contain = false, sample = false) => (
    <PressScale key={key} onPress={onPress} style={{ width: w }} accessibilityRole={BUTTON_ROLE} accessibilityLabel={sample ? `${label}, sample, not for sale yet. Opens a note` : sub ? `${label}, ${sub}` : label}>
      <View style={[s.mini, { backgroundColor: c.card }, shadow]}>
        <View style={[s.miniImg, { backgroundColor: contain && !sample ? c.plate : c.tile }]}>
          <Image source={typeof img === 'string' ? { uri: img } : img} style={contain && !sample ? s.miniImgContain : StyleSheet.absoluteFill} resizeMode={contain && !sample ? 'contain' : 'cover'} />
        </View>
        <Text style={[s.miniLabel, { color: c.name }]} numberOfLines={2}>{label}</Text>
        {sample ? <View style={{ marginTop: 4 }}><SampleTag isDark={isDark} /></View> : !!sub && <Text style={[s.miniSub, { color: c.off }]} numberOfLines={1}>{sub}</Text>}
      </View>
    </PressScale>
  );

  /** Premium floating basket bar (FoodV2BasketBar); it positions itself above the safe area. */
  const basketBar = () => <FoodV2BasketBar />;

  return { headerBtn, chipOnWhite, chipOnGreen, head, addControl, priceRow, productRow, productCard, miniTile, basketBar };
}

/** Staggered entrance on phones; on web the JS-driven fade can leave rows unpainted, so they show at once. */
export function Enter({ index, children }: { index: number; children: React.ReactNode }) {
  if (Platform.OS === 'web') return <>{children}</>;
  return <FadeInUp index={index}>{children}</FadeInUp>;
}

/** Rotating search hint index (every 2.5 s, only while the screen is on view and the app is open). */
export function useHint() {
  const [i, setI] = useState(0);
  const on = useScreenActive();
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setI(v => v + 1), 2500);
    return () => clearInterval(t);
  }, [on]);
  return i;
}

