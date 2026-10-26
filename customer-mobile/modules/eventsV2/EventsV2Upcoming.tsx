/**
 * "Upcoming events": title, a plain subtitle, the range dropdown ("This week") and the horizontally scrolling
 * photo cards; then the Clubs row (real clubs with events, plus the sample clubs while the demo layer is on).
 *
 * The range menu is an anchored popover in a transparent Modal (RangeMenu). It used to be an absolutely
 * positioned child of the section header, which opened BEHIND the cards: on web every react-native-web View is
 * `position: relative; z-index: 0`, so the menu's zIndex only counted inside the header and the later card row
 * painted over it; on Android the card row's elevation drew over it and touches outside the header's bounds never
 * reached the menu. A Modal sits above the whole screen on both, and a full-screen backdrop closes it on any
 * outside tap (Android back closes it too).
 */
import React, { useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { NIGHT, TILES, W, hexA, shadow } from './eventsV2Theme';
import { Press, SectionHead, usePageW, FadeInUp, SampleTag } from './EventsV2Kit';
import { EventCardV2 } from './EventsV2Cards';
import { StateBlock } from './EventsV2States';
import { IChevronDown, ICheck, IArrowRight, IBadgeCheck, ICalendar } from './EventsV2Icons';
import { useNav, type WhenKey } from './eventsV2Nav';
import { inNextDays, useEventsV2, type EvCard } from './eventsV2Data';

const RANGES: { key: WhenKey; label: string; days: number | null }[] = [
  { key: 'week', label: 'This week', days: 7 },
  { key: 'month', label: 'This month', days: 30 },
  { key: 'any', label: 'All upcoming', days: null },
];
const AVATAR: readonly string[] = TILES.map((t) => t.grad[0]);
const MENU_W = 176;
const MENU_ITEM_H = 44;

/** Anchored range popover: measures the button, then draws the menu just under it (or above it near the bottom). */
function RangeMenu({ value, onChange }: { value: WhenKey; onChange: (k: WhenKey) => void }) {
  const anchorRef = useRef<View>(null);
  const win = useWindowDimensions();
  const [at, setAt] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const cur = RANGES.find((x) => x.key === value)!;
  const open = () => anchorRef.current?.measureInWindow((x, y, w, h) => setAt({ x, y, w, h }));
  const close = () => setAt(null);
  const menuH = RANGES.length * MENU_ITEM_H + 12;
  const below = at ? at.y + at.h + 6 : 0;
  const top = at ? (below + menuH > win.height - 12 ? Math.max(12, at.y - 6 - menuH) : below) : 0;
  const right = at ? Math.max(12, win.width - (at.x + at.w)) : 0;
  return (
    <View ref={anchorRef} collapsable={false}>
      <Press onPress={open} label={`Showing ${cur.label.toLowerCase()}, change range`} style={[s.drop, at ? s.dropOn : null]} scaleTo={0.96}>
        <ICalendar size={14} color="#D9CCFF" strokeWidth={1.7} />
        <Text style={s.dropText}>{cur.label}</Text>
        <IChevronDown size={14} color="#D9CCFF" strokeWidth={1.8} />
      </Press>
      <Modal visible={!!at} transparent animationType="fade" onRequestClose={close} statusBarTranslucent navigationBarTranslucent>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close range menu" accessibilityRole="button" />
        {at ? (
          <View style={[s.menu, shadow(3), { top, right }]} accessibilityViewIsModal>
            {RANGES.map((x) => {
              const on = x.key === value;
              return (
                <Press key={x.key} onPress={() => { onChange(x.key); close(); }} label={`${x.label}${on ? ', selected' : ''}`} style={[s.menuItem, on ? s.menuItemOn : null]} scaleTo={0.98}>
                  <Text style={[s.menuText, on ? { color: '#FFFFFF', fontWeight: W.title } : null]}>{x.label}</Text>
                  {on ? <ICheck size={15} color={NIGHT.violet} strokeWidth={2} /> : null}
                </Press>
              );
            })}
          </View>
        ) : null}
      </Modal>
    </View>
  );
}

export function Upcoming() {
  const nav = useNav();
  const w = usePageW();
  const d = useEventsV2();
  const [range, setRange] = useState<WhenKey>('week');
  const r = RANGES.find((x) => x.key === range)!;
  const list = useMemo(() => d.all.filter((e) => r.days == null || inNextDays(e, r.days)).slice(0, 12), [d.all, r.days]);
  const cardW = Math.round(Math.min(310, w * 0.76));
  const openEv = (e: EvCard) => nav.push({ name: 'event', id: e.id });

  return (
    <View style={{ marginTop: 30 }}>
      <SectionHead title="Upcoming events" sub="What is on at SRM AP" right={<RangeMenu value={range} onChange={setRange} />} />
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
    <View style={{ marginTop: 30 }}>
      <SectionHead title="Clubs on campus" sub="Clubs with upcoming events" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}>
        {d.clubs.map((c, i) => {
          const g = AVATAR[i % AVATAR.length];
          const initials = c.name.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase();
          return (
            <FadeInUp key={c.id} index={i}>
              <Press onPress={() => nav.push({ name: 'explore', club: c.id })} label={`${c.name}, ${c.eventCount} event${c.eventCount === 1 ? '' : 's'}${c.isDemoContent ? ', sample' : ''}`} style={s.club} scaleTo={0.95}>
                <View style={[s.clubAvatar, { backgroundColor: hexA(g, 0.16), borderColor: hexA(g, 0.45) }]}>
                  <Text style={[s.clubInitials, { color: g }]}>{initials}</Text>
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
  drop: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 12, borderRadius: 18, backgroundColor: NIGHT.glass, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.24)' },
  dropOn: { backgroundColor: NIGHT.glass2, borderColor: 'rgba(167,139,250,0.6)' },
  dropText: { color: '#FFFFFF', fontSize: 12.5, fontWeight: W.label },
  menu: { position: 'absolute', width: MENU_W, borderRadius: 14, backgroundColor: '#25225E', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.2)', padding: 6 },
  menuItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, height: MENU_ITEM_H, borderRadius: 10 },
  menuItemOn: { backgroundColor: 'rgba(167,139,250,0.14)' },
  menuText: { color: 'rgba(232,230,255,0.86)', fontSize: 14 },
  all: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginHorizontal: 16, marginTop: 12, height: 46, borderRadius: 16, backgroundColor: NIGHT.glass, borderWidth: StyleSheet.hairlineWidth, borderColor: NIGHT.line },
  allText: { color: '#E4DBFF', fontSize: 14, fontWeight: W.label },
  club: { width: 96, alignItems: 'center', paddingVertical: 12, paddingHorizontal: 6, borderRadius: 20, backgroundColor: NIGHT.card, borderWidth: StyleSheet.hairlineWidth, borderColor: NIGHT.line },
  clubAvatar: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  clubInitials: { fontSize: 16, fontWeight: W.title, letterSpacing: 0.3 },
  clubName: { color: NIGHT.ink, fontSize: 12, lineHeight: 15, fontWeight: W.label, maxWidth: 72, textAlign: 'center', minHeight: 30, textAlignVertical: 'center' },
  clubSub: { color: NIGHT.faint, fontSize: 11, marginTop: 1 },
});
