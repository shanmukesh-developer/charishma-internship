/**
 * /deals/points: ZenPoints in the Deals v2 look. The real balance on a glossy gold card with a big Z coin; the real
 * progress to the next spin (delivered orders, spins used and ready, from /api/rewards/spin-eligibility); and how to
 * earn, with the real amounts (spin prizes from the server table, +10 for rating a delivered order, +50 each for an
 * invite). The server keeps no per-entry points ledger, so there is no line-by-line history here (nothing invented).
 */
import React, { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { ProgressBar } from '../others/motion';
import { DV, W, shadow } from './dealsV2Theme';
import { PageHeader, Press } from './DealsV2Kit';
import { Coin, IconPlate } from './DealsV2Decor';
import { PrizeWheel } from './DealsV2Wheel';
import { Skeleton, StateBlock } from './DealsV2States';
import { IChevronRight, IStar, IUserPlus } from './DealsV2Icons';
import { ORDERS_PER_SPIN, useDeals } from './dealsV2Data';
import { useNav } from './dealsV2Nav';
import { themedSheet } from '../../utils/themeNow';

export default function DealsV2Points() {
  const d = useDeals();
  const nav = useNav();
  const [refreshing, setRefreshing] = useState(false);
  const pts = d.prizes.map((p) => Number(String(p.label).match(/(\d+)\s*ZEN/i)?.[1] || 0)).filter((n) => n > 0);
  const range = pts.length ? `${Math.min(...pts)} to ${Math.max(...pts)} ZenWe Points a spin` : 'ZenWe Points or free delivery';
  const e = d.elig;
  const done = e ? e.completedOrders % ORDERS_PER_SPIN : 0;
  const ways = [
    { key: 'spin', title: 'Spin the wheel', sub: `${range}, or a free-delivery coupon`, art: <PrizeWheel prizes={d.prizes} size={40} labels={false} />, go: () => nav.push({ name: 'spin' }) },
    { key: 'rate', title: 'Rate a delivered order', sub: '+10 ZenWe Points for each order you rate', art: <IconPlate size={40}><IStar size={19} color="#FFFFFF" strokeWidth={1.7} /></IconPlate>, go: () => nav.go('/(tabs)/orders') },
    { key: 'refer', title: 'Invite a friend', sub: '+50 ZenWe Points for you and 50 for your friend', art: <IconPlate size={40}><IUserPlus size={19} color="#FFFFFF" strokeWidth={1.7} /></IconPlate>, go: () => nav.push({ name: 'refer' }) },
  ];
  return (
    <View style={{ flex: 1 }}>
      <PageHeader title="ZenWe Points" sub="Your reward points" />
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 60 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await d.reload(); setRefreshing(false); }} tintColor={DV.violet} colors={[DV.violet]} />}
      >
        {!d.signedIn ? <StateBlock kind="signin" body="Your ZenWe Points are saved to your account." action="Sign in" onAction={() => nav.go('/login')} style={{ marginHorizontal: 0 }} /> : (
          <>
            <View style={[s.balance, shadow(3, '#B57A0E')]}>
              <LinearGradient colors={['#FFF4D2', '#FFE19A', '#F6C453']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
              <LinearGradient colors={['rgba(255,255,255,0.65)', 'rgba(255,255,255,0)']} style={[StyleSheet.absoluteFill, { height: '45%' }]} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.balLabel}>Your balance</Text>
                <Text style={s.balValue} numberOfLines={1} adjustsFontSizeToFit>{d.zenPoints.toLocaleString('en-IN')}</Text>
                <Text style={s.balSub}>ZenWe Points</Text>
              </View>
              <Coin size={88} />
            </View>

            <Text style={s.h2}>Your progress</Text>
            {!e && (d.status === 'loading' || d.status === 'idle') ? <Skeleton rows={1} style={{ paddingHorizontal: 0 }} /> : null}
            {!e && (d.status === 'error' || d.status === 'offline') ? <StateBlock kind={d.status} action="Try again" onAction={() => d.reload()} style={{ marginHorizontal: 0 }} /> : null}
            {e ? (
              <View style={[s.card, shadow(2)]}>
                <Text style={s.cardTitle}>{d.spinsLeft > 0 ? `${d.spinsLeft} spin${d.spinsLeft === 1 ? '' : 's'} ready to use` : `${d.nextIn ?? ORDERS_PER_SPIN} more delivered order${(d.nextIn ?? 2) === 1 ? '' : 's'} to your next spin`}</Text>
                <ProgressBar progress={done / ORDERS_PER_SPIN} color={DV.violet} track={DV.violetSoft} height={8} style={{ marginTop: 12, borderRadius: 4 }} />
                <Text style={s.cardSub}>{done} of {ORDERS_PER_SPIN} delivered orders toward the next spin</Text>
                <View style={s.stats}>
                  <View style={s.stat}><Text style={s.statValue}>{e.completedOrders}</Text><Text style={s.statLabel}>Delivered orders</Text></View>
                  <View style={s.stat}><Text style={s.statValue}>{e.spinsUsed}</Text><Text style={s.statLabel}>Spins used</Text></View>
                  <View style={s.stat}><Text style={s.statValue}>{d.spinsLeft}</Text><Text style={s.statLabel}>Spins ready</Text></View>
                </View>
              </View>
            ) : null}
          </>
        )}

        <Text style={s.h2}>How to earn</Text>
        <View style={{ gap: 10 }}>
          {ways.map((x) => (
            <Press key={x.key} onPress={x.go} label={`${x.title}. ${x.sub}`} style={[s.way, shadow(1)]}>
              {x.art}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.wayTitle}>{x.title}</Text>
                <Text style={s.waySub}>{x.sub}</Text>
              </View>
              <IChevronRight size={18} color={DV.faint} strokeWidth={1.8} />
            </Press>
          ))}
        </View>
        <Text style={s.foot}>ZenWe Points are promotional rewards with no cash value. They are added to your balance as soon as you earn them.</Text>
      </ScrollView>
    </View>
  );
}

const s = themedSheet(() => ({
  balance: { flexDirection: 'row', alignItems: 'center', padding: 20, borderRadius: 24, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(181,122,14,0.3)' },
  balLabel: { fontSize: 13, color: '#7A4B00', fontWeight: W.label },
  balValue: { fontSize: 40, color: '#4A2A00', fontWeight: W.display, letterSpacing: -1, marginTop: 2 },
  balSub: { fontSize: 13, color: '#7A4B00' },
  h2: { fontSize: 17, fontWeight: W.title, color: DV.ink, marginTop: 24, marginBottom: 12 },
  card: { padding: 16, borderRadius: 20, backgroundColor: DV.card, borderWidth: StyleSheet.hairlineWidth, borderColor: DV.line },
  cardTitle: { fontSize: 15, fontWeight: W.title, color: DV.ink },
  cardSub: { fontSize: 12.5, color: DV.sub, marginTop: 8 },
  stats: { flexDirection: 'row', marginTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderColor: DV.line, paddingTop: 12 },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 19, fontWeight: W.title, color: DV.violetDeep },
  statLabel: { fontSize: 11.5, color: DV.sub, marginTop: 2, textAlign: 'center' },
  way: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 18, backgroundColor: DV.card, borderWidth: StyleSheet.hairlineWidth, borderColor: DV.line },
  plate: { width: 40, height: 40, borderRadius: 13, backgroundColor: DV.violet, alignItems: 'center', justifyContent: 'center' },
  wayTitle: { fontSize: 14.5, fontWeight: W.title, color: DV.ink },
  waySub: { fontSize: 12.5, color: DV.sub, marginTop: 2 },
  foot: { fontSize: 12, color: DV.faint, textAlign: 'center', marginTop: 18, lineHeight: 17 },
}));
