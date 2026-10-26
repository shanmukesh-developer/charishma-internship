/**
 * /deals/today: today's deals in the Deals v2 look. Real deals (GET /api/vault) first, then the labelled samples;
 * a streak strip with the student's real order streak; loading, empty and offline states. A tap opens the deal
 * sheet (real: how to avail + claim; sample: the polite sample note).
 */
import React, { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { DV, W, shadow } from './dealsV2Theme';
import { PageHeader } from './DealsV2Kit';
import { DealRow } from './DealsV2Deals';
import { Skeleton, StateBlock } from './DealsV2States';
import { IClock, IFlame } from './DealsV2Icons';
import { useDeals } from './dealsV2Data';
import { sampleDeals } from './dealsV2Demo';

export default function DealsV2Today() {
  const d = useDeals();
  const [refreshing, setRefreshing] = useState(false);
  const samples = sampleDeals();
  return (
    <View style={{ flex: 1 }}>
      <PageHeader title="Today's deals" sub="Claim a deal and use its code before midnight" />
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 60, gap: 12 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await d.reload(); setRefreshing(false); }} tintColor={DV.violet} colors={[DV.violet]} />}
      >
        <View style={[s.streak, shadow(1)]}>
          <LinearGradient colors={['#FFFFFF', '#F1ECFF']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
          <View style={s.flame}><IFlame size={20} color="#FFFFFF" strokeWidth={1.7} /></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.streakTitle}>{d.signedIn ? `${d.streak}-day order streak` : 'Order streaks unlock bigger deals'}</Text>
            <Text style={s.streakSub}>Order on consecutive days to unlock streak deals.</Text>
          </View>
        </View>
        <View style={s.when}><IClock size={13} color={DV.sub} strokeWidth={1.8} /><Text style={s.whenText}>Deals reset every day at midnight</Text></View>
        {d.vaultStatus === 'loading' && d.deals.length === 0 ? <Skeleton rows={2} height={110} style={{ paddingHorizontal: 0 }} /> : null}
        {(d.vaultStatus === 'offline' || d.vaultStatus === 'error') && d.deals.length === 0 ? (
          <StateBlock kind={d.vaultStatus} title={d.vaultStatus === 'error' ? 'Could not load deals' : undefined} action="Try again" onAction={() => d.reload()} style={{ marginHorizontal: 0 }} />
        ) : null}
        {d.vaultStatus === 'ready' && d.deals.length === 0 ? (
          <StateBlock kind="empty" title="No live deals right now" body={samples.length ? 'New deals appear as campus stores publish them. Below are samples of how they look.' : 'New deals appear as campus stores publish them.'} style={{ marginHorizontal: 0 }} />
        ) : null}
        {d.deals.map((it: any) => <DealRow key={String(it.id)} deal={it} myStreak={d.streak} signedIn={d.signedIn} />)}
        {samples.length ? <Text style={s.label}>Samples</Text> : null}
        {samples.map((it) => <DealRow key={it.id} deal={it} myStreak={d.streak} signedIn={d.signedIn} />)}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  streak: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 20, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: DV.line },
  flame: { width: 40, height: 40, borderRadius: 13, backgroundColor: DV.violet, alignItems: 'center', justifyContent: 'center' },
  streakTitle: { fontSize: 15, fontWeight: W.title, color: DV.ink },
  streakSub: { fontSize: 12.5, color: DV.sub, marginTop: 2 },
  when: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 2 },
  whenText: { fontSize: 12.5, color: DV.sub },
  label: { fontSize: 13, color: DV.faint, fontWeight: W.label, marginTop: 6 },
});
