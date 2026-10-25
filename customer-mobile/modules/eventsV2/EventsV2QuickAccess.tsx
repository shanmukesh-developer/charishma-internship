/**
 * "Quick Access" (reference): four dark glass cards with colourful glossy icon squares.
 *   My Registrations (view & manage) · My Tickets (your bookings)
 *   Check-in: staff scan entry tickets (server isStaff); everyone else opens their entry QR (My tickets).
 *   Create Event: active organisers host their own; others "Request to host" (the organiser application).
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { NIGHT, QUICK, W } from './eventsV2Theme';
import { Glass, IconSquare, Press, SectionHead, usePageW } from './EventsV2Kit';
import { ICalendarPlus, IClipboard, IScan, ITicket, IArrowRight } from './EventsV2Icons';
import { useNav } from './eventsV2Nav';
import { useEventsV2 } from './eventsV2Data';

export default function QuickAccess() {
  const nav = useNav();
  const router = useRouter();
  const w = usePageW();
  const d = useEventsV2();
  const need = (fn: () => void) => () => (d.signedIn ? fn() : router.push('/login' as any));
  const items = [
    { key: 'regs', title: 'My Registrations', sub: 'View & manage', colors: QUICK.regs, Icon: IClipboard, badge: d.my.registrations, on: need(() => nav.push({ name: 'mine' })) },
    { key: 'tickets', title: 'My Tickets', sub: 'Your bookings', colors: QUICK.tickets, Icon: ITicket, badge: d.my.tickets, on: need(() => nav.push({ name: 'tickets' })) },
    { key: 'checkin', title: 'Check-in', sub: d.isStaff ? 'Scan entry tickets' : 'Scan & get entry', colors: QUICK.checkin, Icon: IScan, badge: 0, on: need(() => (d.isStaff ? nav.go('/campus-events/check-in') : nav.push({ name: 'tickets' }))) },
    { key: 'create', title: 'Create Event', sub: d.isOrganizer ? 'Host your own' : 'Request to host', colors: QUICK.create, Icon: ICalendarPlus, badge: 0, on: need(() => nav.go('/campus-events/organizer')) },
  ];
  const cardW = Math.floor((w - 32 - 10) / 2);
  return (
    <View style={{ marginTop: 6 }}>
      <SectionHead
        title="Quick Access"
        right={(
          <Press onPress={need(() => nav.push({ name: 'mine' }))} label="View all registrations" style={s.viewAll}>
            <Text style={s.viewAllText}>View all</Text>
            <IArrowRight size={13} color={NIGHT.violet} strokeWidth={2} />
          </Press>
        )}
      />
      <View style={s.grid}>
        {items.map((it, i) => (
          <Press key={it.key} onPress={it.on} label={`${it.title}, ${it.sub}${it.badge ? `, ${it.badge}` : ''}`} style={{ width: cardW }} scaleTo={0.96}>
            <Glass index={i} style={s.card}>
              <IconSquare colors={it.colors} size={42}>
                <it.Icon size={20} color="#FFFFFF" strokeWidth={1.8} />
              </IconSquare>
              <View style={{ flex: 1, marginLeft: 10, minWidth: 0 }}>
                <Text style={s.title} numberOfLines={2}>{it.title}</Text>
                <Text style={s.sub} numberOfLines={2}>{it.sub}</Text>
              </View>
              {it.badge ? <View style={s.badge}><Text style={s.badgeText}>{it.badge > 99 ? '99+' : it.badge}</Text></View> : null}
            </Glass>
          </Press>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  viewAll: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 36, paddingLeft: 8 },
  viewAllText: { color: NIGHT.violet, fontSize: 13, fontWeight: W.label },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 16 },
  card: { flexDirection: 'row', alignItems: 'center', padding: 12, minHeight: 68, borderRadius: 20 },
  title: { color: NIGHT.ink, fontSize: 13.5, lineHeight: 17, fontWeight: W.title },
  sub: { color: NIGHT.sub, fontSize: 11.5, marginTop: 2 },
  badge: { position: 'absolute', top: 8, right: 8, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, backgroundColor: NIGHT.pink, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#FFFFFF', fontSize: 10.5, fontWeight: W.title },
});
