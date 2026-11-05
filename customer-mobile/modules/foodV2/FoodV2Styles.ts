/**
 * Food & groceries v2: shared styles.
 * Others → Food & groceries (modules/foodV2).
 */
import { StyleSheet, Platform } from 'react-native';
import { FOOD } from './foodV2Theme';

export const s = StyleSheet.create({
  root: { flex: 1, width: '100%', maxWidth: 600, alignSelf: 'center' },
  /** Horizontal rails keep their own height (RN web otherwise lets them grow inside a vertical list). */
  hScroll: { flexGrow: 0, flexShrink: 0 },

  // header
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingTop: 16 },
  brandLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandWord: { color: '#FFFFFF', fontSize: 22, fontWeight: '700', letterSpacing: 0.2, lineHeight: 26 },
  brandSub: { color: 'rgba(255,255,255,0.72)', fontSize: 12.5, fontWeight: '400', marginTop: 1, letterSpacing: 0.2 },
  hdrBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  hdrBadge: { position: 'absolute', top: 5, right: 3, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 4, backgroundColor: '#D4AF37', alignItems: 'center', justifyContent: 'center' },
  hdrDot: { position: 'absolute', top: 10, right: 11, width: 10, height: 10, borderRadius: 5, backgroundColor: '#D4AF37', borderWidth: 1.5, borderColor: '#0B3D24' },
  hdrBadgeText: { color: '#0B3D24', fontSize: 10, fontWeight: '600' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 48, marginHorizontal: 16, marginTop: 16, paddingHorizontal: 16, borderRadius: 24, backgroundColor: '#FFFFFF' },
  searchHint: { flex: 1, fontSize: 15, fontWeight: '400', color: '#7E909B' },
  pillRail: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 14, gap: 8 },
  pill: { height: 36, paddingHorizontal: 15, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  pillOn: { backgroundColor: '#E6F6EA', borderWidth: 1, borderColor: '#E6F6EA' },
  pillOff: { backgroundColor: 'transparent', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)' },
  pillText: { fontSize: 13 },

  // home top
  notice: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginTop: 8, paddingHorizontal: 16, paddingVertical: 11, borderRadius: 18 },
  noticeTitle: { fontSize: 14, fontWeight: '500', lineHeight: 19 },
  noticeText: { fontSize: 12.5, fontWeight: '400', lineHeight: 17, marginTop: 1 },
  heroCard: { marginHorizontal: 16, marginTop: 12, borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: FOOD.heroLine },
  heroImgWrap: { position: 'absolute', top: 0, bottom: 0, right: 0, width: '58%' },
  heroText: { width: '64%', paddingLeft: 18, paddingTop: 20, paddingRight: 6, flex: 1 },
  heroTitle: { color: '#FFFFFF', fontSize: 21, fontWeight: '500', lineHeight: 26, letterSpacing: 0.1 },
  heroSub: { color: '#9FE3B4', fontSize: 12, fontWeight: '400', lineHeight: 18, marginTop: 8 },
  brightWrapSm: { alignSelf: 'flex-start', marginTop: 14, borderRadius: 20, overflow: 'hidden' },
  heroBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 40, paddingHorizontal: 18, borderRadius: 20 },
  heroBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '500' },

  // sections
  sec: { marginTop: 22 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, marginBottom: 12 },
  headTitle: { fontSize: 17, fontWeight: '500', letterSpacing: 0.1 },
  headSub: { fontSize: 12.5, fontWeight: '500', marginTop: 3 },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, minHeight: 32 },
  link: { fontSize: 13, fontWeight: '500' },
  tileRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, marginBottom: 10 },
  tile: { borderRadius: 14, borderWidth: 1, overflow: 'hidden', paddingBottom: 10, minHeight: 128 },
  tileImg: { height: 78, margin: 6, marginBottom: 0, borderRadius: 10, overflow: 'hidden' },
  tileLabel: { fontSize: 12.5, fontWeight: '500', lineHeight: 16, marginTop: 8, paddingHorizontal: 10 },
  tileWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 16 },
  tileRail: { paddingHorizontal: 16, gap: 10, paddingBottom: 6 },
  mini: { borderRadius: 14, padding: 6, paddingBottom: 10 },
  miniImg: { height: 84, borderRadius: 10, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  miniImgContain: { width: '78%', height: '86%' },
  miniLabel: { fontSize: 12.5, fontWeight: '500', lineHeight: 16, minHeight: 32, marginTop: 8, paddingHorizontal: 4 },
  miniSub: { fontSize: 11.5, fontWeight: '500', marginTop: 3, paddingHorizontal: 4 },
  brandRail: { paddingHorizontal: 16, gap: 14, paddingBottom: 6 },
  brand: { width: 64, alignItems: 'center' },
  brandCircle: { width: 60, height: 60, borderRadius: 30, overflow: 'hidden', padding: 3 },
  brandImg: { width: '100%', height: '100%', borderRadius: 27 },
  brandName: { fontSize: 11.5, fontWeight: '400', marginTop: 6 },
  banner: { marginHorizontal: 16, height: 118, borderRadius: 14, overflow: 'hidden' },

  // chips, fields
  chipRail: { paddingHorizontal: 16, gap: 8, paddingBottom: 2, alignItems: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 36, paddingHorizontal: 16, borderRadius: 18 },
  chipText: { fontSize: 13 },
  chipDot: { position: 'absolute', top: -2, right: -2, width: 9, height: 9, borderRadius: 5, backgroundColor: '#3BC671', borderWidth: 1.5, borderColor: '#012218' },
  field: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 44, marginHorizontal: 16, marginTop: 14, marginBottom: 14, paddingHorizontal: 16, borderRadius: 22, borderWidth: 1 },
  fieldInput: { flex: 1, fontSize: 14, fontWeight: '400', padding: 0, ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null) },

  // listing header and hero
  listHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingTop: 6, paddingBottom: 10 },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  listTitle: { flex: 1, color: '#FFFFFF', fontSize: 19, fontWeight: '500', letterSpacing: 0.1 },
  lHero: { marginHorizontal: 16, height: 110, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },
  lHeroCut: { position: 'absolute', right: 6, top: 6, bottom: 4, width: '44%' },
  lHeroImg: { position: 'absolute', top: 0, bottom: 0, right: 0, width: '56%' },
  lHeroText: { flex: 1, justifyContent: 'center', paddingLeft: 16, width: '58%' },
  lHeroTitle: { color: '#FFFFFF', fontSize: 20, fontWeight: '500', lineHeight: 26 },
  lHeroSub: { color: '#A7E3B9', fontSize: 11.5, fontWeight: '400', marginTop: 8 },
  srchHead: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 6, paddingRight: 16, paddingTop: 8 },
  srchField: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, height: 48, paddingHorizontal: 16, borderRadius: 24, backgroundColor: '#FFFFFF' },
  srchInput: { flex: 1, fontSize: 15, color: FOOD.title.light, padding: 0, ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null) },
  srchCount: { color: '#9FD9B3', fontSize: 13, fontWeight: '400', paddingHorizontal: 18, marginTop: 14, marginBottom: 12 },
  inset: { flex: 1, marginHorizontal: 8, marginBottom: 8, borderRadius: 18, overflow: 'hidden' },
  innerSurface: { marginHorizontal: 8, borderRadius: 18, overflow: 'hidden', minHeight: 520 },

  // sidebar
  side: { width: 98, borderTopRightRadius: 14, borderBottomRightRadius: 14, paddingVertical: 4, alignSelf: 'flex-start' },
  sideItem: { minHeight: 52, justifyContent: 'center', paddingLeft: 12, paddingRight: 4 },
  sideSel: { position: 'absolute', left: 4, right: 4, top: 4, bottom: 4, borderRadius: 10 },
  sideText: { fontSize: 12, lineHeight: 16 },

  // product row and card
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 12, borderRadius: 14 },
  rowPlate: { borderRadius: 12, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', padding: 6 },
  rowImg: { width: '100%', height: '100%' },
  rowBody: { flex: 1, minWidth: 0, paddingRight: 22, paddingBottom: 2, alignSelf: 'stretch', justifyContent: 'center' },
  rowName: { fontSize: 14, fontWeight: '500', lineHeight: 19 },
  rowMeta: { fontSize: 12, fontWeight: '400', marginTop: 2, color: '#8A9BA6' },
  rowHeart: { position: 'absolute', top: 10, right: 10, width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
  rowCtl: { position: 'absolute', right: 10, bottom: 10 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 8, flexWrap: 'wrap' },
  price: { fontSize: 15.5, fontWeight: '500' },
  priceBig: { fontSize: 18, fontWeight: '500' },
  was: { fontSize: 11.5, fontWeight: '400', textDecorationLine: 'line-through' },
  off: { fontSize: 11.5, fontWeight: '500' },
  plus: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepBtn: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  stepQty: { fontSize: 13, fontWeight: '500' },
  closedWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  closedPill: { height: 26, paddingHorizontal: 10, borderRadius: 13, borderWidth: 1, justifyContent: 'center' },
  closedText: { fontSize: 11.5, fontWeight: '500' },
  soldText: { fontSize: 12, fontWeight: '500' },
  card: { borderRadius: 14, padding: 8, paddingBottom: 10 },
  cardPlate: { width: '100%', aspectRatio: 1.25, borderRadius: 12, overflow: 'hidden', padding: 8 },
  cardPlateTouch: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  cardImg: { width: '100%', height: '100%' },
  cardHeart: { position: 'absolute', top: 6, right: 6, width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
  cardName: { fontSize: 13, fontWeight: '400', lineHeight: 17, minHeight: 34, marginTop: 8, paddingHorizontal: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },

  // basket bar
  barWrap: { position: 'absolute', left: 12, right: 12, bottom: Platform.OS === 'ios' ? 24 : 12 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 16, paddingRight: 8, paddingVertical: 8, borderRadius: 20 },
  barCount: { color: 'rgba(255,255,255,0.75)', fontSize: 12, fontWeight: '400' },
  barTotal: { color: '#FFFFFF', fontSize: 17, fontWeight: '500', marginTop: 1 },
  barPill: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 48, borderRadius: 24, paddingLeft: 4, paddingRight: 20 },
  barIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.18)', alignItems: 'center', justifyContent: 'center' },
  barCta: { flex: 1, textAlign: 'center', color: '#FFFFFF', fontSize: 15, fontWeight: '500' },
  wave: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  /** Covers the photo's left edge so the banner fade has no visible line. */
  seam: { position: 'absolute', left: -2, top: 0, bottom: 0, width: 5 },

  // states
  loadCard: { margin: 8, borderRadius: 18, padding: 10, paddingBottom: 28 },
  skRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, borderWidth: 1, marginBottom: 8 },
  loadText: { textAlign: 'center', fontSize: 14, fontWeight: '400', marginTop: 22, marginBottom: 14 },
  stateCard: { alignItems: 'center', borderRadius: 18, paddingVertical: 40, paddingHorizontal: 24 },
  stateTitle: { fontSize: 17, fontWeight: '500', marginTop: 18, textAlign: 'center' },
  stateText: { fontSize: 13, fontWeight: '400', lineHeight: 19, marginTop: 6, textAlign: 'center', maxWidth: 260 },
  stateBtn: { marginTop: 22, height: 46, minWidth: 200, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  stateBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '500' },
  stock: { borderRadius: 20, alignItems: 'center', paddingTop: 36, paddingBottom: 32, paddingHorizontal: 24, minHeight: 540, justifyContent: 'center' },
  stockTitle: { color: '#FFFFFF', fontSize: 19, fontWeight: '500', marginTop: 22, textAlign: 'center' },
  stockText: { color: 'rgba(255,255,255,0.82)', fontSize: 13, fontWeight: '400', lineHeight: 20, marginTop: 10, textAlign: 'center', maxWidth: 290 },
  emptyCard: { alignItems: 'center', borderRadius: 16, padding: 24, marginTop: 6 },
  emptyTitle: { fontSize: 15, fontWeight: '500', marginTop: 10, textAlign: 'center' },
  emptyText: { fontSize: 12.5, fontWeight: '400', lineHeight: 18, marginTop: 4, textAlign: 'center', maxWidth: 250 },
  emptyBtn: { marginTop: 16, height: 42, paddingHorizontal: 22, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  emptyBtnText: { color: '#FFFFFF', fontSize: 13.5, fontWeight: '500' },

  // saved sheet
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: '82%', minHeight: '45%', width: '100%', maxWidth: 600, alignSelf: 'center' },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 18, paddingBottom: 12 },
  sheetTitle: { fontSize: 17, fontWeight: '500' },

  // dev strip
  dev: { backgroundColor: '#111113' },
  devRail: { gap: 6, paddingHorizontal: 8, paddingVertical: 5, alignItems: 'center' },
  devTag: { color: '#FDE68A', fontSize: 10, fontWeight: '500', letterSpacing: 0.4, marginRight: 2 },
  devChip: { height: 22, paddingHorizontal: 8, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.12)', justifyContent: 'center' },
  devChipText: { color: '#FFFFFF', fontSize: 10.5, fontWeight: '500' },
});

