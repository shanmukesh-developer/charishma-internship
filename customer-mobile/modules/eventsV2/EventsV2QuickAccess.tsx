/**
 * "Quick access": four quiet cards in one accent (owner, 26 Oct 2026: official, not colourful glossy squares).
 * Each card: a violet-tinted icon square with a thin line icon, the title, one plain line, and a count pill when
 * there is something to see.
 *   My registrations (view and manage) · My tickets (your bookings)
 *   Check-in: staff scan entry tickets (server isStaff); everyone else opens their entry QR (My tickets).
 *   Create event: active organisers host their own; others "Request to host" (the organiser application).
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { NIGHT, W } from './eventsV2Theme';
import { FadeInUp, Press, SectionHead, usePageW } from './EventsV2Kit';
import { ICalendarPlus, IClipboard, IScan, ITicket } from './EventsV2Icons';
import { useNav } from './eventsV2Nav';
import { useEventsV2 } from './eventsV2Data';

export default function QuickAccess() {
  const nav = useNav();
  const router = useRouter();
  const w = usePageW();
  const d = useEventsV2();
  const need = (fn: () => void) => () => (d.signedIn ? fn() : router.push('/login' as any));
  const items = [
    { key: 'regs', title: 'Registrations', sub: 'View and manage', Icon: IClipboard, badge: d.my.registrations, on: need(() => nav.push({ name: 'mine' })) },
    { key: 'tickets', title: 'My tickets', sub: 'Your bookings', Icon: ITicket, badge: d.my.tickets, on: need(() => nav.push({ name: 'tickets' })) },
    { key: 'checkin', title: 'Check-in', sub: d.isStaff ? 'Scan entry tickets' : 'Show your entry QR', Icon: IScan, badge: 0, on: need(() => (d.isStaff ? nav.go('/campus-events/check-in') : nav.push({ name: 'tickets' }))) },
    { key: 'create', title: 'Create event', sub: d.isOrganizer ? 'Host your own' : 'Request to host', Icon: ICalendarPlus, badge: 0, on: need(() => nav.go('/campus-events/organizer')) },
  ];
  const cardW = Math.floor((w - 32 - 10) / 2);
  const narrow = w < 380;
  return (
    <View style={{ marginTop: 28 }}>
      <SectionHead title="Quick access" />
      <View style={s.grid}>
        {items.map((it, i) => (
          <FadeInUp key={it.key} index={i}>
            <Press onPress={it.on} label={`${it.title}, ${it.sub}${it.badge ? `, ${it.badge}` : ''}`} style={[s.card, { width: cardW }]} scaleTo={0.97}>
              <View style={[s.icon, narrow ? { width: 36, height: 36, borderRadius: 11 } : null]}>
                <it.Icon size={19} color="#D9CCFF" strokeWidth={1.7} />
              </View>
              <View style={{ flex: 1, marginLeft: narrow ? 9 : 11, minWidth: 0 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={s.title} numberOfLines={2}>{it.title}</Text>
                  {it.badge ? <View style={s.badge}><Text style={s.badgeText}>{it.badge > 99 ? '99+' : it.badge}</Text></View> : null}
                </View>
                <Text style={[s.sub, narrow ? { fontSize: 11.5 } : null]} numberOfLines={2}>{it.sub}</Text>
              </View>
            </Press>
          </FadeInUp>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 16 },
  card: { flexGrow: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 11, minHeight: 68, borderRadius: 16, backgroundColor: NIGHT.card, borderWidth: StyleSheet.hairlineWidth, borderColor: NIGHT.line },
  icon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(167,139,250,0.14)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(167,139,250,0.34)' },
  title: { color: NIGHT.ink, fontSize: 13.5, lineHeight: 18, fontWeight: W.title, flexShrink: 1 },
  sub: { color: NIGHT.faint, fontSize: 12, lineHeight: 16, marginTop: 1 },
  badge: { minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, backgroundColor: NIGHT.violetDeep, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#FFFFFF', fontSize: 10.5, fontWeight: W.title },
});
