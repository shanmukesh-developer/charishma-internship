/**
 * Food & groceries v2: product page helpers (detail rows, description) and styles.
 */
import { StyleSheet } from 'react-native';

export const MAX_QTY = 20;
export const PRODUCT_FALLBACK_IMG = 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=600&q=80';
export const WISHLIST_KEY = 'zenvy_wishlist';
export const NON_FOOD = /bath|body|hair|beauty|skin|detergent|clean|hygiene|health|electronic|toy|seed|stationer/i;

/** First non-empty string among the given spec keys (specs are admin/store entered). */
export const specValue = (specs: any, keys: string[]): string | null => {
  if (!specs || typeof specs !== 'object') return null;
  for (const k of keys) {
    const v = specs[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return null;
};

/** "rice & grains" -> "Rice & grains" (display only). */
export const sentence = (t: string) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);

/** Catalogue description, tidied: single spaces, capital first letter, ends with a full stop. */
export const tidy = (t: string) => {
  const one = t.replace(/\s+/g, ' ').trim();
  if (!one) return '';
  const cap = one.charAt(0).toUpperCase() + one.slice(1);
  return /[.!?]$/.test(cap) ? cap : `${cap}.`;
};

export const discountOf = (price: number, original: number) => (original > price && price >= 0 ? Math.round((1 - price / original) * 100) : 0);

export const s = StyleSheet.create({
  root: { flex: 1 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 6 },
  roundBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  roundBtnSm: { width: 36, height: 36, borderRadius: 18 },
  plate: { alignSelf: 'center', borderRadius: 22, overflow: 'hidden' },
  photoSlide: { height: '100%', alignItems: 'center', justifyContent: 'center' },
  photo: { width: '82%', height: '82%' },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 5, marginTop: 12 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  dotOn: { width: 16 },

  block: { paddingHorizontal: 20, paddingTop: 18 },
  nameRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  name: { flex: 1, fontSize: 20, fontWeight: '500', lineHeight: 27, letterSpacing: 0.1 },
  nameHeart: { paddingTop: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metaText: { fontSize: 14, fontWeight: '400' },
  metaBar: { width: 1, height: 16 },
  newPill: { height: 22, paddingHorizontal: 9, borderRadius: 11, justifyContent: 'center' },
  newPillText: { fontSize: 12, fontWeight: '500', letterSpacing: 0.2 },
  deliver: { fontSize: 12.5, fontWeight: '400' },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 12, marginTop: 12 },
  price: { fontSize: 24, fontWeight: '500' },
  was: { fontSize: 15, fontWeight: '400', textDecorationLine: 'line-through' },
  off: { fontSize: 15, fontWeight: '500' },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14, padding: 12, borderRadius: 12 },
  noticeText: { flex: 1, fontSize: 13, fontWeight: '500' },

  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 18, marginBottom: 4 },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 48, width: 124, borderRadius: 24, paddingHorizontal: 4 },
  stepBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  stepQty: { minWidth: 24, textAlign: 'center', fontSize: 16, fontWeight: '500' },
  cta: { flex: 1, height: 48, borderRadius: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  ctaText: { color: '#FFFFFF', fontSize: 15, fontWeight: '500', letterSpacing: 0.2 },

  section: { marginHorizontal: 20, marginTop: 18, paddingTop: 16, borderTopWidth: 1 },
  secTitle: { fontSize: 16, fontWeight: '500', marginBottom: 6 },
  desc: { fontSize: 13.5, fontWeight: '400', lineHeight: 20 },
  table: { marginTop: 14, paddingTop: 10, borderTopWidth: 1 },
  tRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 6 },
  tLabel: { width: '40%', fontSize: 13, fontWeight: '400' },
  tValue: { flex: 1, fontSize: 13, fontWeight: '400', lineHeight: 18 },
  soldBy: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, minHeight: 36 },
  soldByText: { flex: 1, fontSize: 13, fontWeight: '400' },

  moreRail: { paddingHorizontal: 16, gap: 12, paddingTop: 6, paddingBottom: 8 },
  moreCard: { padding: 10, borderRadius: 14 },
  morePlate: { width: '100%', aspectRatio: 1.25, borderRadius: 10, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  moreImg: { width: '70%', height: '84%' },
  moreHeart: { position: 'absolute', top: 14, right: 14, width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
  moreName: { fontSize: 13, fontWeight: '400', lineHeight: 17, height: 34, marginTop: 8 },
  morePriceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, minHeight: 28 },
  morePrice: { fontSize: 14, fontWeight: '500' },
  moreOff: { fontSize: 11.5, fontWeight: '500' },
  plus: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  miniStepper: { height: 28, minWidth: 72, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 3 },
  miniBtn: { width: 22, height: 26, alignItems: 'center', justifyContent: 'center' },
  miniQty: { color: '#FFFFFF', fontSize: 12, fontWeight: '500' },

  revHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rateBtn: { height: 34, paddingHorizontal: 14, borderRadius: 17, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  rateBtnText: { fontSize: 12.5, fontWeight: '500' },
  review: { marginTop: 12, paddingTop: 12, borderTopWidth: 1 },
  reviewName: { fontSize: 13, fontWeight: '500' },
});
