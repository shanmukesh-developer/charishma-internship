/**
 * Others → Campus events (v2 home, owner reference): hero top, glossy category tiles, Quick Access, Upcoming Events
 * and the Clubs row, with a clear note for each data mode (Events open soon / sign in / offline / verify college).
 * The app keeps its own tab bar (the reference's Home · Explore · calendar · Bookings · Profile bar is not added).
 */
import React, { useState } from 'react';
import { Animated, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { NIGHT, W } from './eventsV2Theme';
import { themedSheet } from '../../utils/themeNow';
import { HomeTop } from './EventsV2HomeTop';
import CategoryTiles from './EventsV2Categories';
import QuickAccess from './EventsV2QuickAccess';
import { Clubs, Upcoming } from './EventsV2Upcoming';
import { Notice } from './EventsV2States';
import { Press } from './EventsV2Kit';
import { ICalendar, IGraduation, IUser, IWifiOff } from './EventsV2Icons';
import { useEventsV2 } from './eventsV2Data';
import { EVENTS_V2_DEMO_CONTENT } from './eventsV2Demo';

function ModeNote() {
  const d = useEventsV2();
  const router = useRouter();
  const link = (label: string, go: () => void) => <Text style={s.link} onPress={go} accessibilityRole="link">{label}</Text>;
  if (d.mode === 'off') {
    return <Notice icon={<ICalendar size={16} color={NIGHT.violet} strokeWidth={1.8} />}>Events open soon. Clubs are getting their first events ready{EVENTS_V2_DEMO_CONTENT ? '; until then, the events below are samples to show what is coming.' : '.'}</Notice>;
  }
  if (d.mode === 'signedOut') {
    return <Notice icon={<IUser size={16} color={NIGHT.violet} strokeWidth={1.8} />}>Sign in with your student account to register and get tickets. {link('Sign in', () => router.push('/login' as any))}</Notice>;
  }
  if (d.mode === 'offline' || (d.errorMsg && d.mode === 'live')) {
    return <Notice tone="warn" icon={<IWifiOff size={16} color={NIGHT.amber} strokeWidth={1.8} />}>{d.mode === 'live' ? 'Showing saved events. ' : 'You seem to be offline. '}{link('Retry', () => { d.reload(); })}</Notice>;
  }
  if (d.mode === 'error') {
    return <Notice tone="warn">Could not load events right now. {link('Retry', () => { d.reload(); })}</Notice>;
  }
  if (d.needsCampus) {
    return <Notice tone="warn" icon={<IGraduation size={16} color={NIGHT.amber} strokeWidth={1.8} />}>Verify your college to see and join events on your campus. {link('Verify now', () => router.push('/friends?screen=verification' as any))}</Notice>;
  }
  return null;
}

export function EventsV2HomeBody({ sections, scrollY }: { sections?: { key: string; label: string }[]; scrollY?: Animated.Value }) {
  const d = useEventsV2();
  const [refreshing, setRefreshing] = useState(false);
  return (
    <Animated.ScrollView
      style={{ flex: 1, backgroundColor: NIGHT.page }}
      scrollEventThrottle={16}
      onScroll={scrollY ? Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true }) : undefined}
      contentContainerStyle={{ paddingBottom: 120 }}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await d.reload(); setRefreshing(false); }} tintColor={NIGHT.violet} colors={[NIGHT.violetDeep]} />}
    >
      <HomeTop sections={sections} />
      <View style={{ paddingHorizontal: 16 }}><ModeNote /></View>
      <CategoryTiles />
      <QuickAccess />
      <Upcoming />
      <Clubs />
      {!d.isOrganizer && d.signedIn ? <HostLine /> : null}
    </Animated.ScrollView>
  );
}

function HostLine() {
  const router = useRouter();
  return (
    <Press onPress={() => router.push('/campus-events/organizer' as any)} label="Run a club? Request to host events" style={s.host}>
      <Text style={s.hostText}>Run a club? <Text style={{ color: NIGHT.violet }}>Request to host events</Text></Text>
    </Press>
  );
}

const s = themedSheet(() => ({
  link: { color: NIGHT.violet, fontWeight: W.title },
  host: { alignSelf: 'center', marginTop: 22, minHeight: 44, justifyContent: 'center', paddingHorizontal: 16 },
  hostText: { color: NIGHT.sub, fontSize: 13 },
}));
