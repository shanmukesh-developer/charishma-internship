/**
 * Others > Campus Events (the single entry point; the chip exists only while GET /status says enabled).
 * Landing: search, quick links (My Registrations, My Tickets, invitations, check-in for staff, organizer),
 * Featured, Upcoming and the category sections from GET /sections, each opening the full list. Real data
 * only: an empty campus shows an empty state, never sample events.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Dimensions, TextInput } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../context/AuthContext';
import { readCache, writeCache } from '../../utils/swrCache';
import { campusEventsApi, CampusEventsError, type SectionsResponse, type EventCard as EventCardT } from './campusEventsApi';
import { Ionicons } from '@expo/vector-icons';
import { usePalette, EventCard, CardSkeleton, Hero, Btn, Notice, SectionTitle, useCampusEventsStatus, type CeIconName } from './ui';
import { useCampusEventsLive } from './useCampusEventsLive';

const { width: SW } = Dimensions.get('window');
const CARD_W = Math.min(260, SW * 0.68);

export default function CampusEventsSection() {
  const router = useRouter();
  const p = usePalette();
  const { user } = useAuth();
  const uid = String((user as any)?._id || (user as any)?.id || '');
  const status = useCampusEventsStatus(!!uid);
  const cacheKey = uid ? `campusevents:sections:${uid}` : '';
  const [data, setData] = useState<SectionsResponse | null>(null);
  const [error, setError] = useState<CampusEventsError | null>(null);
  const [extras, setExtras] = useState<{ invitations: number; checkIn: number }>({ invitations: 0, checkIn: 0 });
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    if (!uid) return;
    try {
      const r = await campusEventsApi.sections();
      setData(r);
      setError(null);
      if (cacheKey) writeCache(cacheKey, r);
    } catch (e: any) {
      setError(e instanceof CampusEventsError ? e : new CampusEventsError(e?.message || 'Could not load events.'));
    }
    // Check-in shortcut: GET /status isStaff. Only an older server (no isStaff) needs the event list call.
    const needList = !status || typeof status.isStaff !== 'boolean';
    const [inv, chk] = await Promise.allSettled([campusEventsApi.invitations(), needList ? campusEventsApi.checkInEvents() : Promise.resolve(null)]);
    setExtras({
      invitations: inv.status === 'fulfilled' ? inv.value.invitations.length : 0,
      checkIn: chk.status === 'fulfilled' && chk.value ? chk.value.events.length : 0,
    });
  }, [uid, cacheKey, status]);

  useEffect(() => {
    let cancelled = false;
    if (cacheKey) readCache<SectionsResponse>(cacheKey).then((c) => { if (!cancelled && c && c.data && Array.isArray(c.data.upcoming)) setData((cur) => cur || c.data); });
    load();
    return () => { cancelled = true; };
  }, [cacheKey, load]);
  useCampusEventsLive(() => load(), !!uid);

  const open = (e: EventCardT) => router.push(`/campus-events/${e.id}` as any);
  const search = () => router.push(`/campus-events${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}` as any);

  if (!uid) {
    return (
      <View style={{ paddingHorizontal: 16 }}>
        <Hero title="Campus Events" subtitle="Workshops, tournaments, club activities and slot bookings at your college, with QR tickets." />
        <View style={{ alignItems: 'center', paddingVertical: 24 }}>
          <Text style={{ color: p.sub, fontSize: 13, textAlign: 'center' }}>Sign in with your student account to see events on your campus.</Text>
          <Btn label="Sign in" small onPress={() => router.push('/login' as any)} style={{ marginTop: 12 }} />
        </View>
      </View>
    );
  }

  const organizerActive = typeof status?.isOrganizer === 'boolean' ? status.isOrganizer : status?.organizer?.status === 'ACTIVE';
  const showCheckIn = typeof status?.isStaff === 'boolean' ? status.isStaff : extras.checkIn > 0;
  const quick: { icon: CeIconName; label: string; badge?: number; href: string; a11y: string }[] = [
    { icon: 'receipt-outline' as CeIconName, label: 'My registrations', badge: data?.my.registrations, href: '/campus-events/my', a11y: 'My registrations' },
    { icon: 'ticket-outline' as CeIconName, label: 'My tickets', badge: data?.my.tickets, href: '/campus-events/tickets', a11y: 'My tickets' },
    ...(extras.invitations ? [{ icon: 'mail-outline' as CeIconName, label: 'Team invites', badge: extras.invitations, href: '/campus-events/invitations', a11y: `${extras.invitations} team invitations` }] : []),
    ...(showCheckIn ? [{ icon: 'shield-checkmark-outline' as CeIconName, label: 'Check-in', href: '/campus-events/check-in', a11y: 'Entry check-in for staff' }] : []),
    { icon: (organizerActive ? 'folder-open-outline' : 'megaphone-outline') as CeIconName, label: organizerActive ? 'My events' : 'Host an event', href: '/campus-events/organizer', a11y: organizerActive ? 'Organizer dashboard' : 'Host an event as a club or organizer' },
  ];

  const carousel = (list: EventCardT[]) => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingRight: 16 }}>
      {list.map((e) => <EventCard key={e.id} e={e} compact width={CARD_W} onPress={() => open(e)} />)}
    </ScrollView>
  );
  const seeAll = (href: string, label: string) => (
    <TouchableOpacity onPress={() => router.push(href as any)} accessibilityRole="button" accessibilityLabel={`See all ${label}`} hitSlop={10} style={{ minHeight: 44, justifyContent: 'center' }}>
      <Text style={{ color: p.accent, fontWeight: '900', fontSize: 12.5 }}>See all ›</Text>
    </TouchableOpacity>
  );

  const empty = data && !data.featured.length && !data.upcoming.length;

  return (
    <View style={{ paddingHorizontal: 16 }}>
      <Hero title="Campus Events" subtitle="Register, book slots, build teams and get QR tickets for events on your campus." />

      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, minHeight: 46, borderRadius: 14, borderWidth: 1, borderColor: p.border, backgroundColor: p.card2 }}>
          <Ionicons name="search-outline" size={17} color={p.muted} />
          <TextInput value={q} onChangeText={setQ} onSubmitEditing={search} returnKeyType="search" placeholder="Search events, venues" placeholderTextColor={p.muted}
            accessibilityLabel="Search campus events" style={{ flex: 1, color: p.text, fontSize: 14, paddingVertical: 8 }} maxLength={60} />
        </View>
        <TouchableOpacity onPress={() => router.push('/campus-events?filters=1' as any)} accessibilityRole="button" accessibilityLabel="Filter and sort events"
          style={{ width: 46, height: 46, borderRadius: 14, borderWidth: 1, borderColor: p.border, backgroundColor: p.card2, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="options-outline" size={19} color={p.text} />
        </TouchableOpacity>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 16, marginBottom: 6 }}>
        {quick.map((x) => (
          <TouchableOpacity key={x.href} onPress={() => router.push(x.href as any)} accessibilityRole="button" accessibilityLabel={x.badge ? `${x.a11y}, ${x.badge}` : x.a11y}
            style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, borderRadius: 14, borderWidth: 1, borderColor: p.border, backgroundColor: p.card }}>
            <Ionicons name={x.icon} size={17} color={p.accent} />
            <Text style={{ fontSize: 12.5, fontWeight: '800', color: p.text }}>{x.label}</Text>
            {x.badge ? <View style={{ minWidth: 20, paddingHorizontal: 5, height: 20, borderRadius: 10, backgroundColor: p.accent, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#fff', fontSize: 10.5, fontWeight: '900' }}>{x.badge}</Text></View> : null}
          </TouchableOpacity>
        ))}
      </ScrollView>

      {data?.reason === 'CAMPUS_REQUIRED' ? (
        <TouchableOpacity onPress={() => router.push('/friends?screen=verification' as any)} accessibilityRole="button" style={{ marginTop: 10 }}>
          <Notice tone="warn" icon="school-outline">Verify your college to see and join events on your campus. <Text style={{ color: p.accent, fontWeight: '900' }}>Verify now ›</Text></Notice>
        </TouchableOpacity>
      ) : null}

      {!data && !error ? (
        <View style={{ marginTop: 10 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
            {[0, 1].map((i) => <CardSkeleton key={i} width={CARD_W} height={250} />)}
          </ScrollView>
        </View>
      ) : error && !data ? (
        <TouchableOpacity onPress={load} accessibilityRole="button" accessibilityLabel={`${error.message}. Retry`} style={{ marginTop: 10, padding: 16, borderRadius: 16, borderWidth: 1, borderColor: p.border, minHeight: 56 }}>
          <Text style={{ color: p.sub, fontSize: 13 }}><Ionicons name={error.isNetwork ? 'cloud-offline-outline' : 'alert-circle-outline'} size={14} color={p.sub} /> {error.message} <Text style={{ color: p.accent, fontWeight: '900' }}>Retry</Text></Text>
        </TouchableOpacity>
      ) : empty ? (
        data?.reason === 'CAMPUS_REQUIRED' ? null : (
          <View style={{ marginTop: 10, padding: 20, borderRadius: 18, borderWidth: 1, borderColor: p.border, alignItems: 'center' }}>
            <Ionicons name="ticket-outline" size={36} color={p.accent} />
            <Text style={{ color: p.text, fontWeight: '900', marginTop: 6, fontSize: 15 }}>No upcoming events yet</Text>
            <Text style={{ color: p.sub, fontSize: 12.5, textAlign: 'center', marginTop: 4, lineHeight: 18 }}>When clubs and organizers publish events on your campus, they appear here. Running a club? Host one.</Text>
            <Btn label="Host an event" small kind="ghost" onPress={() => router.push('/campus-events/organizer' as any)} style={{ marginTop: 12 }} />
          </View>
        )
      ) : data ? (
        <>
          {error ? <Notice tone="warn" icon="cloud-offline-outline">Showing saved events. {error.message}</Notice> : null}
          {data.featured.length ? (
            <>
              <SectionTitle kicker="Picked by Zenvy" right={seeAll('/campus-events?featured=1', 'featured events')}>Featured</SectionTitle>
              {carousel(data.featured)}
            </>
          ) : null}
          <SectionTitle kicker="Coming up" right={seeAll('/campus-events', 'upcoming events')}>Upcoming</SectionTitle>
          {carousel(data.upcoming)}
          {data.sections.map((sec) => (
            <View key={sec.key}>
              <SectionTitle right={seeAll(`/campus-events?section=${sec.key}`, sec.label)}>{sec.label}</SectionTitle>
              {carousel(sec.events)}
            </View>
          ))}
          <Btn label="Browse all events" icon="calendar-outline" kind="secondary" onPress={() => router.push('/campus-events' as any)} style={{ marginTop: 16 }} />
        </>
      ) : null}
      <View style={{ height: 24 }} />
    </View>
  );
}
