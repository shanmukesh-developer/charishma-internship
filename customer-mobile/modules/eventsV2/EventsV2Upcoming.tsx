/**
 * "Upcoming Events" (reference): title, a plain subtitle, the "This Week ⌄"
 * dropdown and the horizontally scrolling photo cards; then the Clubs row (real clubs with events, plus the
 * sample clubs while the demo layer is on).
 */
import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { NIGHT, TILES, W, shadow } from './eventsV2Theme';
import { Press, SectionHead, usePageW, FadeInUp, SampleTag } from './EventsV2Kit';
import { EventCardV2 } from './EventsV2Cards';
import { StateBlock } from './EventsV2States';
import { IChevronDown, ICheck, IArrowRight, IBadgeCheck } from './EventsV2Icons';
import { useNav, type WhenKey } from './eventsV2Nav';
import { inNextDays, useEventsV2, type EvCard } from './eventsV2Data';

const RANGES: { key: WhenKey; label: string; days: number | null }[] = [
  { key: 'week', label: 'This week', days: 7 },
  { key: 'month', label: 'This month', days: 30 },
  { key: 'any', label: 'All upcoming', days: null },
];
const AVATAR: readonly [string, string][] = TILES.map((t) => [t.grad[0], t.grad[2]] as [string, string]);

export function Upcoming() {
  const nav = useNav();
  const w = usePageW();
  const d = useEventsV2();
  const [range, setRange] = useState<WhenKey>('week');
  const [open, setOpen] = useState(false);
  const r = RANGES.find((x) => x.key === range)!;
  const list = useMemo(() => d.all.filter((e) => r.days == null || inNextDays(e, r.days)).slice(0, 12), [d.all, r.days]);
  const cardW = Math.round(Math.min(310, w * 0.74));
  const openEv = (e: EvCard) => nav.push({ name: 'event', id: e.id });

  return (
    <View style={{ marginTop: 26, zIndex: 5 }}>
      <SectionHead
        title="Upcoming Events"
        sub="What is on at SRM AP"
        right={(
          <View>
            <Press onPress={() => setOpen((v) => !v)} label={`${r.label}, change range`} style={s.drop} scaleTo={0.95}>
              <Text style={s.dropText}>{r.label}</Text>
              <IChevronDown size={14} color="#FFFFFF" strokeWidth={1.8} />
            </Press>
            {open ? (
              <View style={[s.menu, shadow(3)]}>
                {RANGES.map((x) => (
                  <Press key={x.key} onPress={() => { setRange(x.key); setOpen(false); }} label={x.label} style={s.menuItem} scaleTo={0.98}>
                    <Text style={[s.menuText, x.key === range ? { color: '#FFFFFF' } : null]}>{x.label}</Text>
                    {x.key === range ? <ICheck size={14} color={NIGHT.violet} strokeWidth={2} /> : null}
                  </Press>
                ))}
              </View>
            ) : null}
          </View>
        )}
      />
      {d.mode === 'loading' && !list.length ? <StateBlock kind="loading" /> : list.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} decelerationRate="fast" snapToInterval={cardW + 12} contentContainerStyle={{ paddingHorizontal: 16, gap: 12, paddingBottom: 8 }}>
          {list.map((e, i) => <EventCardV2 key={e.id} e={e} width={cardW} index={i} onPress={() => openEv(e)} />)}
        </ScrollView>
      ) : (
        <StateBlock kind="empty" title={`Nothing ${r.key === 'week' ? 'this week' : 'coming up'} yet`} body="When clubs publish events on your campus, they appear here." action={r.key !== 'any' ? 'See all upcoming' : undefined} onAction={() => setRange('any')} />
      )}
      <Press onPress={() => nav.push({ name: 'explore' })} label="Browse all events" style={s.all}>
        <Text style={s.allText}>Browse all events</Text>
        <IArrowRight size={15} color={NIGHT.violet} strokeWidth={2} />
      </Press>
    </View>
  );
}

export function Clubs() {
  const nav = useNav();
  const d = useEventsV2();
  if (!d.clubs.length) return null;
  return (
    <View style={{ marginTop: 22 }}>
      <SectionHead title="Clubs on Campus" sub="Clubs with upcoming events" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}>
        {d.clubs.map((c, i) => {
          const g = AVATAR[i % AVATAR.length];
          const initials = c.name.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase();
          return (
            <FadeInUp key={c.id} index={i}>
              <Press onPress={() => nav.push({ name: 'explore', club: c.id })} label={`${c.name}, ${c.eventCount} event${c.eventCount === 1 ? '' : 's'}${c.isDemoContent ? ', sample' : ''}`} style={s.club} scaleTo={0.95}>
                <View style={[s.clubAvatar, shadow(1, g[1])]}>
                  <LinearGradient colors={[g[0], g[1]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
                  <LinearGradient colors={['rgba(255,255,255,0.4)', 'rgba(255,255,255,0)']} style={[StyleSheet.absoluteFill, { height: '50%' }]} />
                  <Text style={s.clubInitials}>{initials}</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 8 }}>
                  <Text style={s.clubName} numberOfLines={2}>{c.name}</Text>
                  {c.verified || c.isDemoContent ? <IBadgeCheck size={12} color={NIGHT.sky} strokeWidth={1.8} /> : null}
                </View>
                <Text style={s.clubSub}>{c.eventCount} event{c.eventCount === 1 ? '' : 's'}</Text>
                {c.isDemoContent ? <SampleTag style={{ marginTop: 5, alignSelf: 'center' }} /> : null}
              </Press>
            </FadeInUp>
          );
        })}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  drop: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 34, paddingHorizontal: 13, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.3)' },
  dropText: { color: '#FFFFFF', fontSize: 12.5, fontWeight: W.label },
  menu: { position: 'absolute', top: 40, right: 0, width: 160, borderRadius: 16, backgroundColor: '#24215C', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.2)', paddingVertical: 6, zIndex: 20 },
  menuItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, height: 40 },
  menuText: { color: NIGHT.sub, fontSize: 13.5 },
  all: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginHorizontal: 16, marginTop: 12, height: 46, borderRadius: 16, backgroundColor: NIGHT.glass, borderWidth: StyleSheet.hairlineWidth, borderColor: NIGHT.line },
  allText: { color: '#E4DBFF', fontSize: 14, fontWeight: W.label },
  club: { width: 96, alignItems: 'center', paddingVertical: 12, paddingHorizontal: 6, borderRadius: 20, backgroundColor: NIGHT.card, borderWidth: StyleSheet.hairlineWidth, borderColor: NIGHT.line },
  clubAvatar: { width: 54, height: 54, borderRadius: 27, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.5)' },
  clubInitials: { color: '#FFFFFF', fontSize: 17, fontWeight: W.title },
  clubName: { color: NIGHT.ink, fontSize: 12, lineHeight: 15, fontWeight: W.label, maxWidth: 72, textAlign: 'center', minHeight: 30, textAlignVertical: 'center' },
  clubSub: { color: NIGHT.faint, fontSize: 11, marginTop: 1 },
});
