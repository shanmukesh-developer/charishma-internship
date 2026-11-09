import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
// expo-image (memory + disk cache, downsampled CDN URLs) in place of react-native's Image
import { CachedImage as Image } from './SafeImage';
import ShimmerLoader from './ShimmerLoader';
import { COLORS, surfaceLift } from '../constants/theme';
import { dietNow } from '../utils/themeNow';
import { useTheme } from '../context/ThemeContext';
import { useCartState } from '../context/CartContext';

/**
 * The stall list's parts (CampusBitesSection, on Home and the Local tab), in the food-app listing pattern:
 * a full-width photo with the offer on it, the Featured / New tag and the open / closed status on it, then the
 * name with the rating, one meta line and a small facts row. Dishes show inside a card only while a search
 * matches them. Every value comes in from the real stall list (CampusBitesSection); nothing here invents data.
 * The card's tap area and the dish rows' buttons are siblings, never nested: react-native-web renders role
 * "button" as a real <button>, and a <button> inside a <button> is invalid HTML.
 */

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/** The stall list's colours: neutral theme surfaces, ONE accent (the app's red in light, gold in dark) for actions. */
export const stallPalette = (isDark: boolean) => ({
  cardBg: isDark ? COLORS.bgCard : '#FFFFFF',
  txt: isDark ? COLORS.textPrimary : COLORS.textDark,
  txtSec: isDark ? COLORS.textSecondary : COLORS.textDarkSecondary,
  border: isDark ? COLORS.borderDark : COLORS.borderLight,
  // Owner, 10 Nov 2026: the diet accent (red Non-veg / green Veg), light and dark - no more red/gold split.
  accent: dietNow().acc,
  /** Text on a filled accent. */
  onAccent: dietNow().onAcc,
  /** Photo well behind a missing photo, and its storefront icon. */
  photoBg: isDark ? '#232327' : '#EDEDF0',
  photoIcon: isDark ? '#71717A' : '#A1A1AA',
  /** Soft neutral circle behind an empty-state icon: on a card, and straight on the (off-white) page. */
  soft: isDark ? 'rgba(255,255,255,0.06)' : '#F1F1F3',
  softOnPage: isDark ? 'rgba(255,255,255,0.07)' : '#E7E8EC',
});

/** Dish categories that are not food: no veg / non-veg mark. */
const NON_FOOD_CATEGORY = /stationery|xerox|print|toiletr|laundry|household|electronic/i;
type Diet = 'veg' | 'nonveg' | 'egg';
const dietOf = (m: any): Diet | null => {
  if (NON_FOOD_CATEGORY.test(String(m?.category || ''))) return null; // stored as veg, but not food
  if (m?.dietType === 'nonveg') return 'nonveg';
  if (m?.dietType === 'egg') return 'egg';
  return m?.dietType === 'veg' || m?.isVegetarian === true ? 'veg' : null;
};
const DIET_COLOR: Record<Diet, string> = { veg: '#1E8E3E', nonveg: '#C0392B', egg: '#B7791F' };
const DIET_LABEL: Record<Diet, string> = { veg: 'Veg', nonveg: 'Non-veg', egg: 'Contains egg' };

const idOf = (x: any) => String(x?._id || x?.id || '');

/** The Add button's label: the only part of the list that re-renders when the basket changes. */
const StallAddLabel = React.memo(function StallAddLabel({ itemId, justAdded, color, addedColor }: { itemId: string; justAdded: boolean; color: string; addedColor: string }) {
  const { quantityOf } = useCartState();
  const inBasket = quantityOf(itemId);
  return (
    <Text style={[st.addText, { color: justAdded ? addedColor : color }]}>
      {justAdded ? 'Added' : inBasket > 0 ? `Add · ${inBasket}` : 'Add'}
    </Text>
  );
});

export interface StallCardProps {
  name: string;
  /** The stall's own photo; null shows the neutral storefront placeholder. */
  photo: string | null;
  tag: 'Featured' | 'New' | null;
  isOpen: boolean;
  /** Takes orders right now (open, or closed but taking orders for its next delivery slot). */
  orderable: boolean;
  /** Bottom-left of the photo: the stall's offer while open; "Closed · opens 7:00 AM" (or its next slot) while closed. */
  photoNote: string | null;
  /** Real rating, only when the stall has ratings. */
  rating: number | null;
  /** Categories · campus (when stalls span campuses) · landmark. */
  meta: string;
  /** Today's hours ("10 am–9 pm"). */
  hours: string | null;
  /** Lowest price among the dishes on sale now. */
  fromPrice: number | null;
  /** Instead of the price when nothing is on sale: "Menu coming soon" / "Sold out right now". */
  menuNote: string | null;
  /** Dishes the search matched (empty outside a search). */
  dishes: any[];
  /** How many dishes matched in all (dishes holds the first few). */
  dishMatches: number;
  /** The dish whose Add was just tapped (brief "Added" state). */
  addedId: string | null;
  accessibilityLabel: string;
  onPress: () => void;
  onAdd: (dish: any) => void;
}

export function StallCard(p: StallCardProps) {
  const { isDark } = useTheme();
  const c = stallPalette(isDark);
  // Closed and not taking orders: the photo dims; a stall taking orders for its next slot stays bright.
  const dimmed = !p.isOpen && !p.orderable;
  const showFacts = !!p.hours || p.fromPrice != null || !!p.menuNote;
  return (
    <View style={[st.card, { backgroundColor: c.cardBg, borderColor: c.border }, surfaceLift(isDark)]}>
      <View style={st.clip}>
        <TouchableOpacity activeOpacity={0.9} onPress={p.onPress} accessibilityRole="button" accessibilityLabel={p.accessibilityLabel}>
          <View style={[st.photoBox, { backgroundColor: c.photoBg }]}>
            {p.photo ? (
              <Image source={{ uri: p.photo }} style={st.photo} placeholderIcon="storefront-outline" />
            ) : (
              <View style={[st.photo, st.center]}>
                <Ionicons name="storefront-outline" size={36} color={c.photoIcon} />
              </View>
            )}
            {/* Soft bottom shade so the offer / closed line reads on any photo */}
            {(!!p.photo || !!p.photoNote) && (
              <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.62)']} locations={[0.42, 1]} style={StyleSheet.absoluteFill} />
            )}
            {dimmed && <View style={[StyleSheet.absoluteFill, st.dim]} />}
            {!!p.tag && (
              <View style={[st.badge, st.badgeLeft]}>
                <Text style={st.badgeText}>{p.tag}</Text>
              </View>
            )}
            <View style={[st.badge, st.badgeRight]}>
              <View style={[st.dot, { backgroundColor: p.isOpen ? '#3CCB6C' : '#FF6B6B' }]} />
              <Text style={st.badgeText}>{p.isOpen ? 'Open now' : 'Closed'}</Text>
            </View>
            {!!p.photoNote && (
              <View style={st.photoNote}>
                <Ionicons name={p.isOpen ? 'pricetag' : 'time-outline'} size={13} color="#FFFFFF" />
                <Text style={st.photoNoteText} numberOfLines={1}>{p.photoNote}</Text>
              </View>
            )}
          </View>

          <View style={st.info}>
            <View style={st.nameRow}>
              <Text style={[st.name, { color: c.txt }]} numberOfLines={1}>{p.name}</Text>
              {p.rating != null && (
                <View style={st.rating}>
                  <Text style={st.ratingText}>{p.rating.toFixed(1)}</Text>
                  <Ionicons name="star" size={10} color="#FFFFFF" />
                </View>
              )}
            </View>
            {!!p.meta && <Text style={[st.meta, { color: c.txtSec }]} numberOfLines={1}>{p.meta}</Text>}
            {showFacts && (
              <View style={st.facts}>
                {!!p.hours && (
                  <>
                    <Ionicons name="time-outline" size={13} color={c.txtSec} />
                    <Text style={[st.factText, { color: c.txtSec }]} numberOfLines={1}>{p.hours}</Text>
                  </>
                )}
                {!!p.hours && (p.fromPrice != null || !!p.menuNote) && <Text style={[st.factText, { color: c.txtSec }]}>·</Text>}
                {p.fromPrice != null ? (
                  <Text style={[st.factText, { color: c.txtSec }]} numberOfLines={1}>from ₹{p.fromPrice}</Text>
                ) : !!p.menuNote && (
                  <Text style={[st.factText, { color: c.txtSec }]} numberOfLines={1}>{p.menuNote}</Text>
                )}
              </View>
            )}
          </View>
        </TouchableOpacity>

        {/* Search matched dishes: compact rows with Add (a stall not taking orders: dimmed, no Add) */}
        {p.dishes.length > 0 && (
          <View style={[st.dishes, { borderTopColor: c.border }]}>
            <Text style={[st.dishesLabel, { color: c.txtSec }]}>
              {p.dishMatches} matching {p.dishMatches === 1 ? 'dish' : 'dishes'}
            </Text>
            {p.dishes.map((m: any) => {
              const mId = idOf(m);
              const justAdded = p.addedId === mId;
              const diet = dietOf(m);
              const img = m.imageUrl || m.image || null;
              const price = Number(m.price) || 0;
              return (
                <View key={mId} style={st.dishRow}>
                  <TouchableOpacity
                    style={[st.dishMain, !p.orderable && st.dishOff]}
                    activeOpacity={0.85}
                    onPress={p.onPress}
                    accessibilityRole="button"
                    accessibilityLabel={`${m.name}, ₹${price}, at ${p.name}`}
                  >
                    <View style={[st.dishPhoto, { backgroundColor: c.photoBg }]}>
                      {img ? (
                        <Image source={{ uri: img }} style={st.dishPhotoImg} placeholderIcon="fast-food-outline" />
                      ) : (
                        <Ionicons name="fast-food-outline" size={18} color={c.photoIcon} />
                      )}
                    </View>
                    <View style={st.dishText}>
                      <View style={st.dishNameRow}>
                        {diet && (
                          <View style={[st.dietBox, { borderColor: DIET_COLOR[diet] }]} accessibilityLabel={DIET_LABEL[diet]}>
                            <View style={[st.dietDot, { backgroundColor: DIET_COLOR[diet] }]} />
                          </View>
                        )}
                        <Text style={[st.dishName, { color: c.txt }]} numberOfLines={1}>{m.name}</Text>
                      </View>
                      <Text style={[st.dishPrice, { color: c.txt }]}>₹{price}</Text>
                    </View>
                  </TouchableOpacity>
                  {p.orderable && (
                    <TouchableOpacity
                      style={[st.addBtn, { borderColor: c.accent, backgroundColor: justAdded ? c.accent : c.cardBg }]}
                      onPress={() => p.onAdd(m)}
                      accessibilityRole="button"
                      accessibilityLabel={`Add ${m.name} from ${p.name} to your basket`}
                      hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                    >
                      <StallAddLabel itemId={mId} justAdded={justAdded} color={c.accent} addedColor={c.onAccent} />
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
          </View>
        )}
      </View>
    </View>
  );
}

/**
 * Filter chip for the Local tab's stall list. Selected: solid ink (near-black in light, white in dark) with a
 * close mark, so the state reads at a glance without a tint. Tapping toggles.
 */
export function StallFilterChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const { isDark } = useTheme();
  const c = stallPalette(isDark);
  const selBg = isDark ? '#FFFFFF' : COLORS.textDark;
  const selInk = isDark ? '#09090B' : '#FFFFFF';
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={selected ? `${label}, on. Tap to turn off` : label}
      style={[
        st.chip,
        selected
          ? { backgroundColor: selBg, borderColor: selBg }
          : [{ backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#FFFFFF', borderColor: c.border }, surfaceLift(isDark, true)],
      ]}
    >
      <Text style={[st.chipText, { color: selected ? selInk : c.txt }]} numberOfLines={1}>{label}</Text>
      {selected && <Ionicons name="close" size={14} color={selInk} />}
    </TouchableOpacity>
  );
}

/** Loading placeholder in the card's own shape. */
export function StallCardSkeleton() {
  const { isDark } = useTheme();
  const c = stallPalette(isDark);
  return (
    <View style={[st.card, { backgroundColor: c.cardBg, borderColor: c.border }, surfaceLift(isDark)]}>
      <View style={st.clip}>
        <View style={st.photoBox}>
          <ShimmerLoader width="100%" height={0} borderRadius={0} style={{ height: '100%' }} />
        </View>
        <View style={[st.info, { gap: 8 }]}>
          <ShimmerLoader width="58%" height={16} borderRadius={6} />
          <ShimmerLoader width="82%" height={12} borderRadius={5} />
          <ShimmerLoader width="44%" height={12} borderRadius={5} />
        </View>
      </View>
    </View>
  );
}

/** Centred message (no stalls yet, could not load, nothing matches) with an optional outlined action. */
export function StallListMessage({ icon, title, sub, action, onAction, inCard = false }: {
  icon: IconName;
  title: string;
  sub?: string | null;
  action?: string;
  onAction?: () => void;
  /** Home: inside a card like the rest of the Home feed. The Local tab: straight on the page. */
  inCard?: boolean;
}) {
  const { isDark } = useTheme();
  const c = stallPalette(isDark);
  return (
    <View style={[st.msg, inCard && [st.msgCard, { backgroundColor: c.cardBg, borderColor: c.border }, surfaceLift(isDark)]]}>
      <View style={[st.msgIcon, { backgroundColor: inCard ? c.soft : c.softOnPage }]}>
        <Ionicons name={icon} size={26} color={c.txtSec} />
      </View>
      <Text style={[st.msgTitle, { color: c.txt }]}>{title}</Text>
      {!!sub && <Text style={[st.msgSub, { color: c.txtSec }]}>{sub}</Text>}
      {!!action && !!onAction && (
        <TouchableOpacity
          onPress={onAction}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={action}
          style={[st.msgBtn, { borderColor: c.accent }]}
        >
          <Text style={[st.msgBtnText, { color: c.accent }]}>{action}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const RADIUS = 18;

const st = StyleSheet.create({
  // Outer view carries the shadow; the inner one clips the photo to the rounded corners (a clipping view would
  // also clip its own shadow on iOS).
  card: { borderRadius: RADIUS, borderWidth: 1, marginBottom: 16 },
  clip: { borderRadius: RADIUS - 1, overflow: 'hidden' },
  center: { alignItems: 'center', justifyContent: 'center' },

  photoBox: { width: '100%', aspectRatio: 16 / 9, overflow: 'hidden' },
  photo: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' },
  dim: { backgroundColor: 'rgba(0,0,0,0.45)' },
  badge: {
    position: 'absolute', top: 10, flexDirection: 'row', alignItems: 'center', gap: 5,
    height: 24, paddingHorizontal: 9, borderRadius: 12, backgroundColor: 'rgba(12,12,14,0.62)',
  },
  badgeLeft: { left: 10 },
  badgeRight: { right: 10 },
  badgeText: { color: '#FFFFFF', fontSize: 11.5, fontWeight: '600', letterSpacing: 0.2 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  photoNote: { position: 'absolute', left: 12, right: 12, bottom: 10, flexDirection: 'row', alignItems: 'center', gap: 6 },
  photoNoteText: {
    flexShrink: 1, color: '#FFFFFF', fontSize: 14, fontWeight: '700', letterSpacing: 0.1,
    textShadowColor: 'rgba(0,0,0,0.35)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3,
  },

  info: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 14 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { flex: 1, minWidth: 0, fontSize: 17, fontWeight: '700', letterSpacing: 0.1 },
  rating: {
    flexDirection: 'row', alignItems: 'center', gap: 3, height: 22, paddingHorizontal: 7, borderRadius: 7,
    backgroundColor: COLORS.greenRating,
  },
  ratingText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  meta: { fontSize: 13, fontWeight: '400', marginTop: 4 },
  facts: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
  factText: { flexShrink: 1, fontSize: 12.5, fontWeight: '500' },

  dishes: { borderTopWidth: StyleSheet.hairlineWidth, marginHorizontal: 14, paddingTop: 10, paddingBottom: 6 },
  dishesLabel: { fontSize: 12, fontWeight: '600', letterSpacing: 0.2, marginBottom: 4 },
  dishRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  dishMain: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12 },
  dishOff: { opacity: 0.55 },
  dishPhoto: { width: 48, height: 48, borderRadius: 10, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  dishPhotoImg: { width: 48, height: 48 },
  dishText: { flex: 1, minWidth: 0, gap: 3 },
  dishNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dietBox: { width: 12, height: 12, borderRadius: 2, borderWidth: 1.2, alignItems: 'center', justifyContent: 'center' },
  dietDot: { width: 5, height: 5, borderRadius: 3 },
  dishName: { flexShrink: 1, fontSize: 14, fontWeight: '600' },
  dishPrice: { fontSize: 13, fontWeight: '600' },
  addBtn: { height: 32, minWidth: 68, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  addText: { fontSize: 13, fontWeight: '700', letterSpacing: 0.2 },

  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: 14, borderRadius: 17, borderWidth: 1, maxWidth: 220 },
  chipText: { flexShrink: 1, fontSize: 13, fontWeight: '600', letterSpacing: 0.1 },

  msg: { alignItems: 'center', paddingVertical: 32, paddingHorizontal: 24 },
  msgCard: { borderRadius: RADIUS, borderWidth: 1 },
  msgIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  msgTitle: { fontSize: 16, fontWeight: '700', letterSpacing: 0.1, marginTop: 14, textAlign: 'center' },
  msgSub: { fontSize: 13, fontWeight: '400', lineHeight: 19, marginTop: 4, textAlign: 'center', maxWidth: 290 },
  msgBtn: { marginTop: 16, height: 40, paddingHorizontal: 18, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  msgBtnText: { fontSize: 14, fontWeight: '600', letterSpacing: 0.2 },
});
