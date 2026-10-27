/**
 * Others → Deals & spin (v2 home, owner reference): the indigo header, the violet "Spin. Win. Save." hero with the
 * real wheel on a podium, the ZenPoints and wallet cards, the "Spin & win" row, today's deals (real first, then
 * labelled samples), your coupons as perforated tickets and the invite card. Real data only for anything money-like.
 */
import React, { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { DV, W, shadow } from './dealsV2Theme';
import { Press, SectionHead, usePageW } from './DealsV2Kit';
import { HomeTop } from './DealsV2HomeTop';
import { Hero } from './DealsV2Hero';
import { Balances, SignInCard, SpinRow } from './DealsV2Balances';
import { DealCard } from './DealsV2Deals';
import { Ticket } from './DealsV2Ticket';
import { Notice, Skeleton, StateBlock } from './DealsV2States';
import { IconPlate } from './DealsV2Decor';
import { IChevronRight, IUserPlus, IWifiOff } from './DealsV2Icons';
import { useApplyCoupon } from './DealsV2Sheets';
import { useDeals } from './dealsV2Data';
import { sampleDeals } from './dealsV2Demo';
import { useNav } from './dealsV2Nav';

export function DealsV2HomeBody({ sections }: { sections?: { key: string; label: string }[] }) {
  const d = useDeals();
  const nav = useNav();
  const router = useRouter();
  const w = usePageW();
  const apply = useApplyCoupon();
  const [refreshing, setRefreshing] = useState(false);
  const deals = [...d.deals, ...sampleDeals()];
  const cardW = Math.round(Math.min(188, (w - 32 - 12) / 2.15));
  const offline = d.status === 'offline' || d.vaultStatus === 'offline';
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: DV.page }}
      contentContainerStyle={{ paddingBottom: 120 }}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await d.reload(); setRefreshing(false); }} tintColor={DV.violet} colors={[DV.violet]} />}
    >
      <HomeTop sections={sections} />
      {offline ? (
        <View style={{ paddingHorizontal: 16, marginTop: 14 }}>
          <Notice tone="warn" icon={<IWifiOff size={16} color={DV.amber} strokeWidth={1.8} />}>
            You seem to be offline. <Text style={s.link} onPress={() => d.reload()} accessibilityRole="link">Retry</Text>
          </Notice>
        </View>
      ) : null}

      <Hero prizes={d.prizes} spinsLeft={d.spinsLeft} signedIn={d.signedIn} onWheel={() => nav.push({ name: 'spin' })} />

      {d.signedIn ? (
        <Balances zenPoints={d.zenPoints} wallet={d.wallet} onPoints={() => nav.push({ name: 'points' })} onWallet={() => nav.go('/wallet-history')} />
      ) : (
        <SignInCard onSignIn={() => router.push('/login' as any)} />
      )}

      <SpinRow prizes={d.prizes} signedIn={d.signedIn} spinsLeft={d.spinsLeft} nextIn={d.nextIn} onPress={() => nav.push({ name: 'spin' })} />

      {/* Today's deals */}
      {deals.length > 0 ? (
        <View style={{ marginTop: 26 }}>
          <SectionHead
            title="Today's deals"
            sub={d.signedIn ? `Your order streak: ${d.streak} day${d.streak === 1 ? '' : 's'} · codes work till midnight` : 'Claim one and use the code before midnight'}
            onAll={() => nav.push({ name: 'today' })}
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 12, paddingBottom: 8 }}>
            {deals.map((it: any) => <DealCard key={String(it.id)} deal={it} width={cardW} myStreak={d.streak} signedIn={d.signedIn} />)}
          </ScrollView>
        </View>
      ) : d.vaultStatus === 'loading' ? <Skeleton rows={1} style={{ marginTop: 26 }} /> : null}

      {/* Your coupons */}
      {d.signedIn ? (
        <View style={{ marginTop: 24 }}>
          <SectionHead
            title="Your coupons"
            sub={d.coupons.length ? `${d.coupons.length} ready to use at checkout` : undefined}
            onAll={d.coupons.length ? () => nav.push({ name: 'coupons' }) : undefined}
          />
          <View style={{ paddingHorizontal: 16, gap: 12 }}>
            {d.status === 'loading' && d.coupons.length === 0 ? <Skeleton rows={1} style={{ paddingHorizontal: 0 }} /> : null}
            {(d.status === 'error' || d.status === 'offline') && d.coupons.length === 0 ? (
              <StateBlock kind={d.status} title="Your coupons did not load" action="Try again" onAction={() => d.reload()} style={{ marginHorizontal: 0 }} />
            ) : null}
            {d.status === 'ready' && d.coupons.length === 0 ? (
              <StateBlock kind="empty" title="No coupons yet" body="Spin the wheel or claim one of today's deals and your coupons show up here." style={{ marginHorizontal: 0 }} />
            ) : null}
            {d.coupons.slice(0, 2).map((c) => (
              <Ticket key={c.code} coupon={c} onApply={() => apply(c)} onPress={() => nav.push({ name: 'coupon', code: c.code })} />
            ))}
          </View>
        </View>
      ) : null}

      {/* Invite friends (real referral code) */}
      {d.signedIn && d.referralCode ? (
        <Press onPress={() => nav.push({ name: 'refer' })} label="Invite friends, earn ZCS Points" style={[s.refer, shadow(2)]}>
          <LinearGradient colors={['#FFFFFF', '#F1ECFF']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
          <IconPlate size={46}><IUserPlus size={21} color="#FFFFFF" strokeWidth={1.6} /></IconPlate>
          <View style={{ flex: 1, minWidth: 0, marginLeft: 10 }}>
            <Text style={s.referTitle}>Invite friends, earn ZCS Points</Text>
            <Text style={s.referSub}>You and your friend each get 50 ZCS Points when they sign up with your code.</Text>
          </View>
          <IChevronRight size={18} color={DV.violet} strokeWidth={1.8} />
        </Press>
      ) : null}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  link: { color: DV.violet, fontWeight: W.title },
  refer: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginTop: 24, padding: 14, borderRadius: 22, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: DV.line },
  referTitle: { fontSize: 15, fontWeight: W.title, color: DV.ink },
  referSub: { fontSize: 12.5, color: DV.sub, marginTop: 2, lineHeight: 17 },
});
