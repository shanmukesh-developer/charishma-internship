/**
 * PG v2 Home: what Others → PG stays shows.
 *  - `PgV2HomeBody`: the content under the Others header (the Others screen renders it inside its own
 *    header and scroll view). The header's search is the ONE search: it opens PG Buildings focused.
 *  - Hero: "Find your Perfect PG Stay" (fixed text, dots under it) beside a slider of three building
 *    cut-outs that overflow onto the filter card.
 *  - Filters: Boys / Girls / Co-ed cards with live counts, a budget row, then "Search PGs · N".
 *  - My bookings, then "Buildings near campus" of real listings.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, useWindowDimensions, Pressable } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { HeaderColors } from '../../modules/foodV2/FoodV2SectionHeader';
import { PressScale } from '../../modules/others/motion';
import { PG2, R, GUTTER, W, shadow, type GenderKey } from './pgV2Theme';
import { Tap, Photo, Rating, SectionTitle, EmptyState, Loading, PrimaryButton, k } from './PgV2Kit';
import { IUsers, IBuilding, ICalendarCheck, IChevronRight, ISearch, STROKE } from './PgV2Icons';
import IUserPlain from 'lucide-react-native/icons/user';
import IUserRoundPlain from 'lucide-react-native/icons/user-round';
import { heroSlides, buildingPhoto } from './pgV2Photos';
import { usePgV2, placeText, rentFromText, gKey, inBudget, BUDGETS } from './pgV2Data';
import { useNav, type BudgetKey } from './pgV2Nav';
import { useHeroSlider, HeroSlides, HeroDots } from './PgV2HeroSlider';
import type { PgListItem } from '../../modules/pg/pgApi';
import { BUTTON_ROLE } from '../../utils/pressRole';

/** One violet shared by the header's bottom edge and the hero: no seam where they meet. */
export const HERO_BASE = '#6352D8';
export const PG_HEADER: HeaderColors = { top: '#3D2DB4', bottom: HERO_BASE, pillOnBg: '#FFFFFF', pillOnInk: '#4A2FD9' };
export const PG_HINTS = ["Search 'girls PG'", "Search 'near Gate 1'", "Search 'single room'", "Search 'under ₹6,000'"];
const SLATE = '#475569';
const TILES: { g: GenderKey; label: string; icon: typeof IUsers }[] = [
  { g: 'Boys', label: 'Boys PG', icon: IUserPlain }, { g: 'Girls', label: 'Girls PG', icon: IUserRoundPlain }, { g: 'Co-ed', label: 'Co-ed PG', icon: IUsers },
];

function BuildingCard({ pg, width, onPress }: { pg: PgListItem; width: number; onPress: () => void }) {
  const rent = rentFromText(pg);
  return (
    <Tap onPress={onPress} label={pg.name} style={{ width }}>
      <Photo photo={buildingPhoto(pg)} style={{ width, height: Math.round(width * 0.82) }} radius={12} />
      <Text style={st.cardName} numberOfLines={2}>{pg.name}</Text>
      <Text style={st.cardPlace} numberOfLines={1}>{placeText(pg)}</Text>
      {pg.reviewSummary?.count ? <View style={{ marginTop: 4 }}><Rating summary={pg.reviewSummary} size={12} short /></View>
        : rent ? <Text style={st.cardRent} numberOfLines={1}>From {rent}</Text> : null}
    </Tap>
  );
}

const HERO_H = 218;
/** Building art box: wider than half the screen, sitting on the hero's bottom edge and overlapping the card a little. */
const artBox = (width: number) => { const w = Math.round(width * 0.72); return { w, h: Math.round(w * 0.86) }; };

function Hero({ width, index, onHold }: { width: number; index: number; onHold: (held: boolean) => void }) {
  return (
    <Pressable onPressIn={() => onHold(true)} onPressOut={() => onHold(false)} accessible={false} style={{ height: HERO_H }}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: HERO_BASE }]} />
      <LinearGradient colors={['rgba(99,82,216,0)', 'rgba(214,96,190,0.16)']} start={{ x: 0.2, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <View style={{ paddingHorizontal: GUTTER + 4, paddingTop: 14, width: Math.round(width * 0.56) }}>
        <Text style={st.h1Light}>Find your</Text>
        <Text style={st.h1}>Perfect PG{'\n'}Stay</Text>
        <Text style={st.tagline} numberOfLines={2}>Safe, comfortable and{'\n'}affordable stays</Text>
        <HeroDots count={3} index={index} />
      </View>
    </Pressable>
  );
}

export function PgV2HomeBody() {
  const nav = useNav();
  const { width } = useWindowDimensions();
  const { list, listState, reloadList } = usePgV2();
  const [gender, setGender] = useState<GenderKey | null>(null);
  const [budget, setBudget] = useState<BudgetKey>('any');
  const tileW = Math.floor((width - GUTTER * 4 - 20) / 3); // inside the filter card (margin + padding)
  const cardW = Math.floor((width - GUTTER * 2 - 24) / 3);
  const countFor = (g: GenderKey) => list.filter((p) => gKey(p.genderType) === g).length;
  const count = useMemo(() => list.filter((p) => (!gender || gKey(p.genderType) === gender) && inBudget(p, budget)).length, [list, gender, budget]);
  const near = useMemo(() => list.slice(0, 10), [list]);

  const slides = useMemo(() => heroSlides(), []);
  const [held, setHeld] = useState(false);
  const { index, fades } = useHeroSlider(slides.length, held);
  const art = artBox(width);
  return (
    <View style={{ backgroundColor: '#FFFFFF', paddingBottom: 32 }}>
      <Hero width={width} index={index} onHold={setHeld} />
      {/* Building cut-outs above the hero and the card's top edge (the card's top-right is empty). */}
      <HeroSlides slides={slides} fades={fades} style={{ position: 'absolute', zIndex: 3, right: -10, top: HERO_H + 14 - art.h, width: art.w, height: art.h }} />
      <View style={[st.sheet, shadow(2)]}>
        <Text style={st.filterLabel}>Who is it for?</Text>
        <View style={st.tiles}>
          {TILES.map((t) => {
            const on = gender === t.g;
            const n = countFor(t.g);
            return (
              <PressScale key={t.g} haptic scaleTo={0.97} onPress={() => setGender(on ? null : t.g)} accessibilityRole={BUTTON_ROLE} accessibilityState={{ selected: on }}
                accessibilityLabel={`${t.label}, ${n} PGs`} style={[st.tile, { width: tileW }, on && st.tileOn]}>
                <t.icon size={20} color={on ? PG2.primary : SLATE} strokeWidth={1.6} />
                <Text style={[st.tileText, on && { color: PG2.primary }]} numberOfLines={1}>{t.label}</Text>
                <Text style={st.tileCount}>{listState === 'ready' ? `${n} PG${n === 1 ? '' : 's'}` : ' '}</Text>
              </PressScale>
            );
          })}
        </View>
        <Text style={[st.filterLabel, { marginTop: 18 }]}>Monthly budget</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0, marginHorizontal: -GUTTER }} contentContainerStyle={{ paddingHorizontal: GUTTER, gap: 8 }}>
          {BUDGETS.map((b) => {
            const on = budget === b.key;
            return (
              <PressScale key={b.key} haptic onPress={() => setBudget(b.key)} accessibilityRole={BUTTON_ROLE} accessibilityState={{ selected: on }} accessibilityLabel={b.label} style={[st.budget, on && st.budgetOn]}>
                <Text style={[st.budgetText, on && { color: PG2.primary, fontWeight: W.label }]}>{b.label}</Text>
              </PressScale>
            );
          })}
        </ScrollView>
        <PrimaryButton label={listState === 'ready' ? `Search PGs · ${count}` : 'Search PGs'} icon={ISearch}
          onPress={() => nav.push({ name: 'list', gender: gender || undefined, budget })} style={{ marginTop: 18 }} />
      </View>

      <Tap onPress={() => nav.push({ name: 'bookings' })} label="My bookings" style={st.bookings}>
        <ICalendarCheck size={20} color={SLATE} strokeWidth={1.6} />
        <View style={{ flex: 1 }}>
          <Text style={st.bookingsTitle}>My bookings</Text>
          <Text style={k.small}>Requests you've sent and confirmed stays</Text>
        </View>
        <IChevronRight size={18} color={PG2.faint} strokeWidth={STROKE} />
      </Tap>

      {listState === 'loading' && !list.length ? <Loading /> : null}
      {listState === 'error' && !list.length ? <EmptyState icon={IBuilding} title="Couldn't load PGs" body="Check your internet and try again." action="Try again" onAction={reloadList} /> : null}
      {listState === 'ready' && !list.length ? <EmptyState icon={IBuilding} title="No PGs listed yet" body="New buildings near campus will show up here." /> : null}
      {near.length ? (
        <View style={{ marginTop: 24 }}>
          <SectionTitle title="Buildings near campus" action="View all" onAction={() => nav.push({ name: 'list' })} style={{ paddingHorizontal: GUTTER }} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: GUTTER, gap: 12 }}>
            {near.map((pg) => <BuildingCard key={pg.id} pg={pg} width={cardW} onPress={() => nav.push({ name: 'building', pgId: pg.id })} />)}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  h1Light: { color: '#FFFFFF', fontSize: 24, fontWeight: W.body, letterSpacing: -0.3 },
  h1: { color: '#FFFFFF', fontSize: 28, lineHeight: 34, fontWeight: W.title, letterSpacing: -0.4 },
  tagline: { color: 'rgba(255,255,255,0.9)', fontSize: 12.5, lineHeight: 17, fontWeight: W.label, marginTop: 8 },
  sheet: { marginTop: -22, marginHorizontal: GUTTER, backgroundColor: '#FFFFFF', borderRadius: R.xl, padding: GUTTER, zIndex: 1 },
  filterLabel: { fontSize: 13.5, fontWeight: W.label, color: PG2.ink, marginBottom: 10 },
  tiles: { flexDirection: 'row', gap: 10 },
  tile: { height: 76, borderRadius: 14, borderWidth: 1, borderColor: '#E6E3F5', backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  tileOn: { borderColor: PG2.primary, backgroundColor: '#F4F1FE' },
  tileText: { marginTop: 6, fontSize: 14, fontWeight: W.label, color: PG2.ink },
  tileCount: { marginTop: 1, fontSize: 12, color: PG2.muted },
  budget: { height: 38, paddingHorizontal: 14, borderRadius: R.pill, borderWidth: 1, borderColor: '#E6E3F5', backgroundColor: '#FFFFFF', justifyContent: 'center' },
  budgetOn: { borderColor: PG2.primary, backgroundColor: '#F4F1FE' },
  budgetText: { fontSize: 13, color: PG2.ink2 },
  bookings: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: GUTTER, marginTop: 16, paddingVertical: 14, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: '#E6E3F5', backgroundColor: '#FFFFFF' },
  bookingsTitle: { fontSize: 14, fontWeight: W.label, color: PG2.ink, marginBottom: 2 },
  cardName: { marginTop: 9, fontSize: 13.5, lineHeight: 18, minHeight: 36, fontWeight: W.label, color: PG2.ink },
  cardPlace: { marginTop: 2, fontSize: 12, color: PG2.muted },
  cardRent: { marginTop: 4, fontSize: 12, color: PG2.ink2, fontWeight: W.label },
});
