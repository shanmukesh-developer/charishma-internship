/**
 * All events / category listing (app/campus-events?q&cat&when&price&club&focus). Diet look: a category
 * banner, the search field, and filter rows for category, date, price and club. Real events first, then the
 * matching samples. Old links keep working (?featured=1, ?section=, ?filters=1 open the plain listing).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams } from 'expo-router';
import { NIGHT, TILES, W, hexA, shadow, type TileKey } from './eventsV2Theme';
import { themedSheet } from '../../utils/themeNow';
import { ChipRow, NightHeader, Press } from './EventsV2Kit';
import { EventRowCard } from './EventsV2Cards';
import { Notice, StateBlock } from './EventsV2States';
import GlossyIcon from './EventsV2Glossy';
import { ICalendar, ISearch, IX } from './EventsV2Icons';
import { useNav, type PriceKey, type WhenKey } from './eventsV2Nav';
import { useEventsV2List } from './useEventsV2List';
import type { Filter } from './eventsV2Data';

const BLURB: Record<TileKey, string> = {
  all: 'Workshops, fests, sports, talks and club meet-ups',
  cultural: 'Fests, music, dance nights and open mics',
  sports: 'Matches, tournaments and floodlit games',
  workshops: 'Hands-on workshops, talks, quizzes and hackathons',
  clubs: 'Meet-ups, walks and jams by campus clubs',
};
const WHEN: { key: WhenKey; label: string }[] = [{ key: 'any', label: 'Any date' }, { key: 'today', label: 'Today' }, { key: 'week', label: 'This week' }, { key: 'month', label: 'This month' }];
const PRICE: { key: PriceKey; label: string }[] = [{ key: 'any', label: 'Free or paid' }, { key: 'free', label: 'Free' }, { key: 'paid', label: 'Paid' }];
const one = (v: unknown) => (Array.isArray(v) ? v[0] : v) as string | undefined;

function Banner({ tile, count }: { tile: TileKey; count: number | null }) {
  const t = TILES.find((x) => x.key === tile)!;
  return (
    <View style={[s.banner, shadow(2, NIGHT.violetDeep)]}>
      <LinearGradient colors={[NIGHT.go[0], NIGHT.violet, NIGHT.violetDeep]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <LinearGradient colors={['rgba(255,255,255,0.18)', 'rgba(255,255,255,0)']} style={[StyleSheet.absoluteFill, { height: '55%' }]} />
      <View style={{ flex: 1, paddingRight: 8 }}>
        <Text style={s.bannerTitle}>{tile === 'all' ? 'All events' : `${t.label} events`}</Text>
        <Text style={s.bannerSub} numberOfLines={2}>{BLURB[tile]}</Text>
        {count != null ? <Text style={s.bannerCount}>{count} event{count === 1 ? '' : 's'}</Text> : null}
      </View>
      <View>
        <GlossyIcon kind={tile} size={84} />
      </View>
      <View style={s.bannerRim} pointerEvents="none" />
    </View>
  );
}

export default function EventsV2Explore() {
  const p = useLocalSearchParams<Record<string, string>>();
  const nav = useNav();
  const [q, setQ] = useState(one(p.q) || '');
  const [qLive, setQLive] = useState(q);
  const [tile, setTile] = useState<TileKey>((TILES.some((t) => t.key === one(p.cat)) ? one(p.cat) : 'all') as TileKey);
  const [when, setWhen] = useState<WhenKey>((WHEN.some((x) => x.key === one(p.when)) ? one(p.when) : 'any') as WhenKey);
  const [price, setPrice] = useState<PriceKey>((PRICE.some((x) => x.key === one(p.price)) ? one(p.price) : 'any') as PriceKey);
  const [club, setClub] = useState<string>(one(p.club) || '');
  const input = useRef<TextInput>(null);
  useEffect(() => { const t = setTimeout(() => setQ(qLive), 350); return () => clearTimeout(t); }, [qLive]);
  useEffect(() => { if (one(p.focus) === '1') { const t = setTimeout(() => input.current?.focus(), 250); return () => clearTimeout(t); } return undefined; }, [p.focus]);

  const f: Filter = useMemo(() => ({ q, tile, when, price, club: club || undefined }), [q, tile, when, price, club]);
  const d = useEventsV2List(f);
  const clubItems = useMemo(() => [{ key: '', label: 'All clubs' }, ...d.clubs.map((c) => ({ key: c.id, label: c.name }))], [d.clubs]);

  const header = (
    <View>
      <View style={{ paddingHorizontal: 16 }}><Banner tile={tile} count={d.list ? d.list.length : null} /></View>
      <View style={s.search}>
        <ISearch size={17} color={NIGHT.sub} strokeWidth={1.8} />
        <TextInput ref={input} value={qLive} onChangeText={setQLive} placeholder="Search for events, venues, or clubs…" placeholderTextColor={NIGHT.faint}
          style={s.input} returnKeyType="search" onSubmitEditing={() => setQ(qLive)} accessibilityLabel="Search events" maxLength={60} />
        {qLive ? <Press onPress={() => { setQLive(''); setQ(''); }} label="Clear search" style={s.clear} scaleTo={0.9}><IX size={15} color={NIGHT.sub} strokeWidth={1.8} /></Press> : null}
      </View>
      <ChipRow items={TILES.map((t) => ({ key: t.key, label: t.key === 'all' ? 'All' : t.label }))} active={tile} onSelect={setTile} style={{ paddingBottom: 10 }} />
      <ChipRow items={WHEN} active={when} onSelect={setWhen} style={{ paddingBottom: 10 }} />
      <ChipRow items={PRICE} active={price} onSelect={setPrice} style={{ paddingBottom: 10 }} />
      {d.clubs.length ? <ChipRow items={clubItems} active={club} onSelect={setClub} style={{ paddingBottom: 12 }} /> : null}
      {d.off ? <View style={{ paddingHorizontal: 16 }}><Notice icon={<ICalendar size={16} color={NIGHT.violet} strokeWidth={1.8} />}>Events open soon. The events below are samples to show what is coming.</Notice></View> : null}
      {d.err && !d.off ? (
        <View style={{ paddingHorizontal: 16 }}>
          {d.err.status === 401
            ? <Notice>Sign in with your student account to see the real events on your campus. <Text style={{ color: NIGHT.violet }} onPress={() => nav.go('/login')}>Sign in</Text></Notice>
            : <Notice tone="warn">{d.err.isNetwork ? 'You seem to be offline.' : d.err.message} <Text style={{ color: NIGHT.violet }} onPress={d.reload}>Retry</Text></Notice>}
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      <NightHeader title={tile === 'all' ? 'All events' : TILES.find((t) => t.key === tile)!.label} sub="Campus events near you" />
      {!d.list ? (
        <View style={{ flex: 1 }}>{header}<StateBlock kind="loading" /></View>
      ) : (
        <FlatList
          data={d.list}
          keyExtractor={(e) => e.id}
          ListHeaderComponent={header}
          renderItem={({ item, index }) => <EventRowCard e={item} index={index} onPress={() => nav.push({ name: 'event', id: item.id })} />}
          ListEmptyComponent={<StateBlock kind="empty" title="No events match" body="Try another date, category or club." action="Clear filters" onAction={() => { setTile('all'); setWhen('any'); setPrice('any'); setClub(''); setQLive(''); setQ(''); }} />}
          ListFooterComponent={d.loadingMore ? <ActivityIndicator color={NIGHT.violet} style={{ marginVertical: 16 }} /> : <View style={{ height: 40 }} />}
          onEndReached={d.hasMore ? d.loadMore : undefined}
          onEndReachedThreshold={0.4}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const s = themedSheet(() => ({
  banner: { flexDirection: 'row', alignItems: 'center', borderRadius: 24, padding: 16, paddingRight: 10, overflow: 'hidden', minHeight: 116, marginBottom: 14 },
  bannerTitle: { color: NIGHT.onAcc, fontSize: 21, fontWeight: W.display, letterSpacing: -0.3 },
  bannerSub: { color: hexA(NIGHT.onAcc, 0.9), fontSize: 12.5, lineHeight: 17, marginTop: 4 },
  bannerCount: { color: NIGHT.onAcc, fontSize: 12, fontWeight: W.label, marginTop: 6, opacity: 0.9 },
  bannerRim: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderRadius: 24, borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 9, marginHorizontal: 16, marginBottom: 12, height: 48, borderRadius: 24, paddingLeft: 16, paddingRight: 6, backgroundColor: NIGHT.glass, borderWidth: StyleSheet.hairlineWidth, borderColor: NIGHT.border },
  input: { flex: 1, color: NIGHT.ink, fontSize: 14, paddingVertical: 8 },
  clear: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
}));
