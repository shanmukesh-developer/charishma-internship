// Logged-in shell: store bar + banners, the current tab, bottom nav, the full-screen new-order alert,
// and the Announcer (voice). Tabs stay mounted once visited so scroll positions survive tab switches.
import React, { useCallback, useEffect, useState } from 'react';
import { BackHandler, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { BottomNav, MainTab } from '../components/Nav';
import { NewOrderAlert } from '../components/NewOrderAlert';
import { ConnBanner, PushOffBanner, StoreBar, VoiceOffBanner } from '../components/StoreBar';
import { Announcer } from '../state/Announcer';
import { useStore } from '../state/StoreProvider';
import { color } from '../theme';
import type { Order } from '../types';
import MenuScreen from './MenuScreen';
import OrdersScreen from './OrdersScreen';
import SettingsScreen from './SettingsScreen';
import TodayScreen from './TodayScreen';

export type RootStack = { Main: undefined; OrderDetail: { orderId: string }; Payouts: undefined };

export default function MainScreen({ navigation }: NativeStackScreenProps<RootStack, 'Main'>) {
  const [tab, setTab] = useState<MainTab>('orders');
  const [visited, setVisited] = useState<Record<MainTab, boolean>>({ orders: true, menu: false, today: false, settings: false });
  const { orders } = useStore();
  const newCount = orders.filter((o) => o.stage === 'new').length;
  const openOrder = useCallback((o: Order) => navigation.navigate('OrderDetail', { orderId: o.id }), [navigation]);
  const go = useCallback((t: MainTab) => {
    setTab(t);
    setVisited((v) => (v[t] ? v : { ...v, [t]: true }));
  }, []);

  // Android back on another tab returns to Orders instead of leaving the app (only while Main is focused;
  // on the order detail screen the navigator handles back).
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!navigation.isFocused() || tab === 'orders') return false;
      setTab('orders');
      return true;
    });
    return () => sub.remove();
  }, [navigation, tab]);

  const pane = (key: MainTab, node: React.ReactNode) => (visited[key] ? (
    <View key={key} style={{ flex: 1, display: tab === key ? 'flex' : 'none' }}>{node}</View>
  ) : null);

  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <StoreBar />
      <ConnBanner />
      <VoiceOffBanner onFix={() => go('settings')} />
      <PushOffBanner />
      <View style={{ flex: 1 }}>
        {pane('orders', <OrdersScreen onOpenOrder={openOrder} />)}
        {pane('menu', <MenuScreen />)}
        {pane('today', <TodayScreen />)}
        {pane('settings', <SettingsScreen />)}
      </View>
      <BottomNav value={tab} onChange={go} badge={newCount} />
      <NewOrderAlert />
      <Announcer />
    </View>
  );
}
