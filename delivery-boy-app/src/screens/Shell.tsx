// Logged-in shell: network banner, 4 tabs, full-screen delivery flow, overlays, cancel notice.
import React, { useEffect } from 'react';
import { BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { C, R, S, T, useInsets } from '../theme';
import { Btn } from '../ui/kit';
import { Sheet } from '../ui/Sheet';
import { useRider, type Tab } from '../state/RiderStore';
import { rupees } from '../services/format';
import { HomeScreen } from './Home';
import { EarningsScreen } from './Earnings';
import { HistoryScreen } from './History';
import { ProfileScreen } from './Profile';
import { DeliveryScreen } from './Delivery';
import { SupportScreen } from './Support';
import { VoiceSettingsScreen } from './VoiceSettings';
import { JobScreen } from './Jobs';
import { useJobs } from '../state/JobsStore';
import type { IconName } from '../ui/kit';

const TABS: { key: Tab; label: string; icon: IconName }[] = [
  { key: 'home', label: 'Home', icon: 'home-variant' },
  { key: 'earnings', label: 'Earnings', icon: 'wallet-outline' },
  { key: 'history', label: 'History', icon: 'history' },
  { key: 'profile', label: 'Profile', icon: 'account-circle-outline' },
];

export function Shell() {
  const r = useRider();
  const insets = useInsets();
  const { overlay, setOverlay, deliveryId, closeDelivery, tab, setTab } = r;
  const jobsState = useJobs();
  const { openJob, setOpenJob } = jobsState;

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (overlay) {
        setOverlay(null);
        return true;
      }
      if (openJob) {
        setOpenJob(null);
        return true;
      }
      if (deliveryId) {
        closeDelivery();
        return true;
      }
      if (tab !== 'home') {
        setTab('home');
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [overlay, setOverlay, deliveryId, closeDelivery, tab, setTab, openJob, setOpenJob]);

  const showOfferPill = r.offers.length > 0 && (tab !== 'home' || !!deliveryId) && !overlay;
  const top = r.offers[0];

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <NetBanner />
      {showOfferPill && top ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="New order waiting. Open home"
          onPress={() => {
            closeDelivery();
            setTab('home');
          }}
          style={styles.offerPill}
        >
          <MaterialCommunityIcons name="bell-ring" size={22} color={C.white} />
          <Text style={[T.body, { color: C.white, fontWeight: '800', flex: 1 }]} numberOfLines={1}>
            New order{top.earning !== null ? ` · +${rupees(top.earning)}` : ''}
            {top.restaurantName ? ` · ${top.restaurantName}` : ''}
          </Text>
          <Text style={[T.body, { color: C.white, fontWeight: '900' }]}>VIEW</Text>
        </Pressable>
      ) : null}

      <View style={{ flex: 1 }}>
        {tab === 'home' ? <HomeScreen /> : null}
        {tab === 'earnings' ? <EarningsScreen /> : null}
        {tab === 'history' ? <HistoryScreen /> : null}
        {tab === 'profile' ? <ProfileScreen /> : null}

        {deliveryId ? (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: C.bg }]}>
            <DeliveryScreen key={deliveryId} orderId={deliveryId} onClose={closeDelivery} />
          </View>
        ) : null}
        {openJob && !deliveryId ? (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: C.bg }]}>
            <JobScreen />
          </View>
        ) : null}
        {overlay?.kind === 'support' ? (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: C.bg }]}>
            <SupportScreen prefill={overlay.prefill} onBack={() => setOverlay(null)} />
          </View>
        ) : null}
        {overlay?.kind === 'voice' ? (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: C.bg }]}>
            <VoiceSettingsScreen onBack={() => setOverlay(null)} />
          </View>
        ) : null}
      </View>

      {!deliveryId && !overlay && !openJob ? (
        <View style={[styles.tabBar, { paddingBottom: insets.bottom }]} accessibilityRole="tablist">
          {TABS.map((t) => {
            const on = t.key === tab;
            const myJobs = jobsState.myBaskets.length + jobsState.myServices.length;
            const badge = t.key === 'home' && r.active.data.length + myJobs > 0 ? r.active.data.length + myJobs : 0;
            return (
              <Pressable
                key={t.key}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                accessibilityLabel={t.label}
                onPress={() => setTab(t.key)}
                style={styles.tab}
              >
                <View>
                  <MaterialCommunityIcons name={t.icon} size={28} color={on ? C.ink : C.muted} />
                  {badge ? (
                    <View style={styles.badge}>
                      <Text style={{ color: C.white, fontSize: 11, fontWeight: '900' }}>{badge}</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={[T.small, { color: on ? C.ink : C.muted, fontWeight: on ? '900' : '600' }]}>{t.label}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <Sheet visible={!!r.cancelNotice} onClose={r.clearCancelNotice} blocking>
        {r.cancelNotice ? (
          <View style={{ gap: S.lg, alignItems: 'center' }}>
            <View style={styles.cancelIcon}>
              <MaterialCommunityIcons name="cancel" size={44} color={C.red} />
            </View>
            <Text style={[T.h2, { color: C.ink, textAlign: 'center' }]}>Order {r.cancelNotice.orderCode} cancelled</Text>
            <Text style={[T.body, { color: C.ink2, textAlign: 'center' }]}>
              Do not pick it up. If you already have the food, return it to {r.cancelNotice.restaurantName ?? 'the store'} or ask support.
            </Text>
            <View style={{ alignSelf: 'stretch', gap: S.md }}>
              <Btn title="OK, got it" onPress={r.clearCancelNotice} />
              <Btn
                title="Contact support"
                icon="lifebuoy"
                variant="outline"
                size="mid"
                onPress={() => {
                  const code = r.cancelNotice?.orderCode;
                  r.clearCancelNotice();
                  setOverlay({ kind: 'support', prefill: `Order ${code}: order was cancelled while I had it. ` });
                }}
              />
            </View>
          </View>
        ) : null}
      </Sheet>
    </View>
  );
}

function NetBanner() {
  const r = useRider();
  let text: string | null = null;
  let tone: 'red' | 'amber' = 'amber';
  if (!r.connected) {
    text = r.queueCount ? `No internet · ${r.queueCount} update${r.queueCount === 1 ? '' : 's'} saved on phone` : 'No internet · showing saved data';
    tone = 'red';
  } else if (!r.serverReachable) {
    text = 'ZenWe is not responding. Retrying…';
  } else if (r.queueCount) {
    text = `Syncing ${r.queueCount} saved update${r.queueCount === 1 ? '' : 's'}…`;
  }
  if (!text) return null;
  return (
    <View style={[styles.net, { backgroundColor: tone === 'red' ? C.red : C.amber }]} accessibilityRole="alert">
      <MaterialCommunityIcons name={tone === 'red' ? 'wifi-off' : 'cloud-sync-outline'} size={20} color={C.white} />
      <Text style={[T.small, { color: C.white, fontWeight: '800', flex: 1 }]}>{text}</Text>
      {r.connected ? (
        <Pressable accessibilityRole="button" onPress={r.flushNow} hitSlop={10} style={styles.netBtn}>
          <Text style={[T.small, { color: C.white, fontWeight: '900' }]}>RETRY</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  net: { flexDirection: 'row', alignItems: 'center', gap: S.sm, paddingHorizontal: S.lg, paddingVertical: S.sm },
  netBtn: { paddingHorizontal: S.md, paddingVertical: 6, borderRadius: R.pill, borderWidth: 1.5, borderColor: C.white },
  offerPill: { flexDirection: 'row', alignItems: 'center', gap: S.sm, backgroundColor: C.green, paddingHorizontal: S.lg, minHeight: 52 },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: C.card,
    borderTopWidth: 1,
    borderTopColor: C.line,
    paddingTop: 6,
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 60, gap: 2 },
  badge: {
    position: 'absolute',
    top: -4,
    right: -10,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: C.green,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  cancelIcon: { width: 84, height: 84, borderRadius: 42, backgroundColor: C.redTint, alignItems: 'center', justifyContent: 'center' },
});
