/**
 * PG list page parts (data: GET /api/pg/home, all admin-curated or computed from real listings):
 *  - FeaturedCarousel: promotions. Swipe, page dots, advances every 5 s and pauses while touched.
 *    Image promotions open the PG; video promotions show the YouTube thumbnail with a play mark and
 *    open the in-app player (nothing plays on its own, to save data). The label ("Featured" or
 *    "Sponsored") is shown as the admin set it.
 *  - ToursRail: room tour videos across PGs.
 *  - PgRail: a titled horizontal row of PG cards ("Near campus", "Verified", ...).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, FlatList, ScrollView, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { inr, plural, type PgListItem, type PgPromotion, type PgTour } from './pgApi';
import { usePgPalette, PgImage, Press, ICON, TYPE, IconPlay, IconChevronRight, s as ui } from './ui';
import { PgRailCard, RAIL_CARD_W } from './PgListCard';

const AUTO_MS = 5000;
const RESUME_MS = 6000;
const PROMO_RATIO = 9 / 16;

function PlayMark({ size = 48 }: { size?: number }) {
  return (
    <View style={[st.play, { width: size, height: size, borderRadius: size / 2 }]} pointerEvents="none">
      <IconPlay size={Math.round(size * 0.4)} color="#111" fill="#111" strokeWidth={2} />
    </View>
  );
}

export function FeaturedCarousel({ promos, onOpenPg, onPlay, onBookVisit }: {
  promos: PgPromotion[];
  onOpenPg: (pgId: string) => void;
  onPlay: (promo: PgPromotion) => void;
  onBookVisit: (promo: PgPromotion) => void;
}) {
  const p = usePgPalette();
  const { width } = useWindowDimensions();
  const cardW = width - 32;
  const step = cardW + 12;
  const imgH = Math.round(cardW * PROMO_RATIO);
  const ref = useRef<FlatList<PgPromotion>>(null);
  const [index, setIndex] = useState(0);
  const indexRef = useRef(0);
  const pausedUntil = useRef(0);

  const pause = () => { pausedUntil.current = Date.now() + RESUME_MS; };
  useEffect(() => {
    if (promos.length < 2) return;
    const t = setInterval(() => {
      if (Date.now() < pausedUntil.current) return;
      const next = (indexRef.current + 1) % promos.length;
      ref.current?.scrollToOffset({ offset: next * step, animated: true });
      indexRef.current = next;
      setIndex(next);
    }, AUTO_MS);
    return () => clearInterval(t);
  }, [promos.length, step]);
  useEffect(() => { if (index >= promos.length) { indexRef.current = 0; setIndex(0); } }, [promos.length, index]);

  const onEnd = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.max(0, Math.min(promos.length - 1, Math.round(e.nativeEvent.contentOffset.x / step)));
    indexRef.current = i;
    setIndex(i);
  }, [promos.length, step]);

  if (!promos.length) return null;
  const act = (x: PgPromotion) => {
    pause();
    if (x.cta === 'WATCH_TOUR' && x.video) onPlay(x);
    else if (x.cta === 'BOOK_VISIT') onBookVisit(x);
    else if (x.pg) onOpenPg(x.pg.id);
  };
  const tapCard = (x: PgPromotion) => {
    pause();
    if (x.type === 'VIDEO' && x.video) onPlay(x);
    else if (x.pg) onOpenPg(x.pg.id);
  };

  return (
    <View accessibilityLabel={`Featured, ${plural(promos.length, 'item')}`}>
      <FlatList
        ref={ref}
        data={promos}
        keyExtractor={(x) => x.id}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={step}
        decelerationRate="fast"
        disableIntervalMomentum
        contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
        onTouchStart={pause}
        onScrollBeginDrag={pause}
        onMomentumScrollEnd={onEnd}
        getItemLayout={(_, i) => ({ length: step, offset: step * i, index: i })}
        renderItem={({ item: x }) => (
          <View style={[st.promo, { width: cardW, borderColor: p.line, backgroundColor: p.card }]}>
            <Press onPress={() => tapCard(x)} accessibilityRole={x.type === 'VIDEO' ? 'button' : 'link'} accessibilityLabel={`${x.labelText}. ${x.headline}${x.pg ? `, ${x.pg.name}` : ''}. ${x.type === 'VIDEO' ? 'Plays the video' : 'Opens the PG'}`} style={{ width: cardW, height: imgH }}>
              <PgImage uri={x.imageUrl} style={{ width: cardW, height: imgH }} recyclingKey={`promo-${x.id}`} priority="high" />
              {x.type === 'VIDEO' ? <View style={[StyleSheet.absoluteFill, st.center]} pointerEvents="none"><PlayMark /></View> : null}
              <View style={st.label} pointerEvents="none"><Text style={st.labelText}>{x.labelText}</Text></View>
            </Press>
            <View style={st.promoBody}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[st.headline, { color: p.text }]} numberOfLines={1}>{x.headline}</Text>
                <Text style={[ui.small, { color: p.sub, marginTop: 4 }]} numberOfLines={1}>
                  {[x.subline || x.pg?.name, x.pg?.rentFrom ? `From ${inr(x.pg.rentFrom)}/month` : ''].filter(Boolean).join(' · ')}
                </Text>
              </View>
              <Press onPress={() => act(x)} accessibilityLabel={`${x.ctaLabel}${x.pg ? `, ${x.pg.name}` : ''}`} style={st.cta}>
                <Text style={[ui.body, { color: p.text, fontWeight: '600' }]}>{x.ctaLabel}</Text>
                <IconChevronRight size={16} color={p.text} strokeWidth={ICON.stroke} />
              </Press>
            </View>
          </View>
        )}
      />
      {promos.length > 1 ? (
        <View style={st.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {promos.map((x, i) => <View key={x.id} style={[st.dot, { backgroundColor: i === index ? p.text : p.line, width: i === index ? 16 : 6 }]} />)}
        </View>
      ) : null}
    </View>
  );
}

function RailHead({ title, detail }: { title: string; detail?: string }) {
  const p = usePgPalette();
  return (
    <View style={st.railHead}>
      <Text style={[st.railTitle, { color: p.text }]} accessibilityRole="header">{title}</Text>
      {detail ? <Text style={[ui.small, { color: p.muted }]}>{detail}</Text> : null}
    </View>
  );
}

const TOUR_W = 240;
export function ToursRail({ tours, onPlay }: { tours: PgTour[]; onPlay: (t: PgTour) => void }) {
  const p = usePgPalette();
  if (!tours.length) return null;
  const h = Math.round((TOUR_W * 9) / 16);
  return (
    <View style={st.rail}>
      <RailHead title="Room tours" detail={plural(tours.length, 'video')} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.railRow}>
        {tours.map((t) => (
          <Press key={`${t.pgId}-${t.video.id}`} onPress={() => onPlay(t)} accessibilityLabel={`Play ${t.video.title || 'room tour'} at ${t.pgName}`} style={{ width: TOUR_W }}>
            <View>
              <PgImage uri={t.video.thumbnailUrl} style={{ width: TOUR_W, height: h, borderRadius: 12 }} recyclingKey={`tour-${t.video.youtubeId}`} priority="low" />
              <View style={[StyleSheet.absoluteFill, st.center]} pointerEvents="none"><PlayMark size={40} /></View>
            </View>
            <Text style={[ui.body, { color: p.text, fontWeight: '600', marginTop: 8 }]} numberOfLines={1}>{t.pgName}</Text>
            <Text style={[ui.small, { color: p.sub, marginTop: 2 }]} numberOfLines={1}>{t.video.title || [t.area, t.rentFrom ? `From ${inr(t.rentFrom)}/month` : ''].filter(Boolean).join(' · ')}</Text>
          </Press>
        ))}
      </ScrollView>
    </View>
  );
}

export function PgRail({ title, items, onOpen }: { title: string; items: PgListItem[]; onOpen: (id: string) => void }) {
  if (!items.length) return null;
  return (
    <View style={st.rail}>
      <RailHead title={title} detail={plural(items.length, 'PG')} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.railRow} decelerationRate="fast" snapToInterval={RAIL_CARD_W + 12}>
        {items.map((x) => <PgRailCard key={x.id} pg={x} onPress={() => onOpen(x.id)} />)}
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  play: { backgroundColor: 'rgba(255,255,255,0.92)', alignItems: 'center', justifyContent: 'center', paddingLeft: 3 },
  promo: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  label: { position: 'absolute', left: 12, top: 12, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, backgroundColor: 'rgba(0,0,0,0.55)' },
  labelText: { color: '#fff', fontSize: TYPE.small, fontWeight: '500' },
  promoBody: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 16, paddingRight: 8, paddingVertical: 12 },
  headline: { fontSize: TYPE.heading, fontWeight: '600' },
  cta: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 8 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 12 },
  dot: { height: 6, borderRadius: 3 },
  rail: { marginTop: 32 },
  railHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 12 },
  railTitle: { fontSize: TYPE.heading, fontWeight: '700' },
  railRow: { paddingHorizontal: 16, gap: 12 },
});
