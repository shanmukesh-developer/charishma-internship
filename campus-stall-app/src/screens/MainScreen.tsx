// Logged-in shell: connection banner, the current tab, bottom nav. Tabs stay mounted once visited so scroll
// positions survive tab switches. Payments waiting for review show as a badge on Bookings and a toast; a tapped
// booking push opens that booking.
import React, { useCallback, useEffect, useState } from 'react';
import { BackHandler, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BottomNav } from '../components/BottomNav';
import CampusScreen from '../campus/CampusScreen';
import CampusEarningsScreen from '../campus/CampusEarningsScreen';
import { useCampusLive } from '../campus/useCampusLive';
import { campusApi, type CbSummary } from '../lib/campusApi';
import { onPushTokenChange, onStallPush, registerStallPush, type PushState } from '../lib/push';
import { useSession } from '../state/SessionProvider';
import { useSocket } from '../state/SocketProvider';
import { color, font, space } from '../theme';
import { useToast } from '../ui/Toast';
import type { MainTab, ScreenProps } from '../nav';
import MenuScreen from './MenuScreen';
import StallSettingsScreen from './StallSettingsScreen';

export default function MainScreen({ navigation, route }: ScreenProps<'Main'>) {
  const [tab, setTab] = useState<MainTab>(route.params?.tab || 'bookings');
  const [visited, setVisited] = useState<Record<MainTab, boolean>>({ bookings: true, menu: false, earnings: false, settings: false });
  const { restaurant } = useSession();
  const { status } = useSocket();
  const toast = useToast();
  const [review, setReview] = useState(0);
  const [pushState, setPushState] = useState<PushState>('unknown');

  const go = useCallback((t: MainTab) => {
    setTab(t);
    setVisited((v) => (v[t] ? v : { ...v, [t]: true }));
  }, []);
  useEffect(() => { if (route.params?.tab) go(route.params.tab); }, [route.params?.tab, go]);

  const onSummary = useCallback((s: CbSummary) => setReview(s.pendingReview), []);
  const refreshReview = useCallback(() => { campusApi.summary().then(onSummary).catch(() => {}); }, [onSummary]);
  useEffect(() => { refreshReview(); }, [refreshReview]);
  useCampusLive((e) => {
    refreshReview();
    if (e.status === 'PAYMENT_REVIEW') toast.show('New booking: a payment to review.', 'info');
  });

  // Closed-app alerts (optional: a build without Firebase still works fully while open).
  useEffect(() => {
    if (!restaurant) return undefined;
    registerStallPush(restaurant.id).then(setPushState).catch(() => setPushState('unknown'));
    const offToken = onPushTokenChange(restaurant.id);
    const offPush = onStallPush((data, tapped) => {
      refreshReview();
      if (!tapped || data.type !== 'CAMPUS_BOOKING' || typeof data.bookingId !== 'string' || !/^[0-9a-f-]{36}$/i.test(data.bookingId)) return;
      go('bookings');
      navigation.navigate('CampusOrder', { bookingId: data.bookingId });
    });
    return () => { offToken(); offPush(); };
  }, [restaurant, refreshReview, navigation, go]);

  // Android back on another tab returns to Bookings instead of leaving the app.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!navigation.isFocused() || tab === 'bookings') return false;
      setTab('bookings');
      return true;
    });
    return () => sub.remove();
  }, [navigation, tab]);

  const pane = (key: MainTab, node: React.ReactNode) => (visited[key] ? (
    <View key={key} style={{ flex: 1, display: tab === key ? 'flex' : 'none' }}>{node}</View>
  ) : null);

  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      {status === 'offline' || status === 'reconnecting' ? (
        <View style={[styles.conn, status === 'offline' && { backgroundColor: color.alertTint }]} accessibilityLiveRegion="polite">
          <Ionicons name="cloud-offline-outline" size={18} color={status === 'offline' ? color.alertDark : color.warning} />
          <Text style={[font.small, { color: status === 'offline' ? color.alertDark : color.warning, fontWeight: '700', flex: 1 }]}>
            {status === 'offline' ? 'Offline. New bookings show when the internet is back.' : 'Reconnecting…'}
          </Text>
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        {pane('bookings', <CampusScreen onSummary={onSummary} onOpenTab={go} />)}
        {pane('menu', <MenuScreen />)}
        {pane('earnings', <CampusEarningsScreen onOpen={(id) => navigation.navigate('CampusOrder', { bookingId: id })} />)}
        {pane('settings', <StallSettingsScreen pushState={pushState} />)}
      </View>
      <BottomNav value={tab} onChange={go} badges={{ bookings: review }} />
    </View>
  );
}

const styles = StyleSheet.create({
  conn: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.md, paddingVertical: space.xs, backgroundColor: color.warningTint, paddingTop: space.xl },
});
