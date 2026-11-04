/**
 * /deals/spin: the spin page in the Deals v2 indigo look. The big real wheel (lit rim, gloss, Z hub) standing still on
 * a glowing podium (it turns only during a real spin); the real spins left; a Spin button that runs the real spin
 * (useSpin, server-picked prize) and opens the result sheet; the "no spins" state with the real rule and orders to
 * go; what you can win (the server's prize table); and how it works. Dev builds only: sample result previews.
 */
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useTopInset } from '../../utils/useTopInset';
import { DV, W } from './dealsV2Theme';
import { CTA, Press, usePageW } from './DealsV2Kit';
import { Coin, Podium } from './DealsV2Decor';
import { PrizeWheel } from './DealsV2Wheel';
import { Notice } from './DealsV2States';
import { IArrowLeft, IGift, IInfo, ITruck } from './DealsV2Icons';
import { ORDERS_PER_SPIN, stripEmoji, useDeals, type Prize } from './dealsV2Data';
import { useNav } from './dealsV2Nav';
import { useSpin } from './useSpin';
import { themedSheet } from '../../utils/themeNow';

/** Unique prizes for "What you can win" (the server's table, emoji stripped). */
const prizeChips = (prizes: Prize[]) => {
  const seen = new Set<string>();
  return prizes.map((p) => {
    const free = p.type === 'coupon' || /free/i.test(String(p.label));
    const pts = String(p.label).match(/(\d+)/);
    return { free, text: free ? 'Free delivery' : pts ? `${pts[1]} ZENV Points` : stripEmoji(p.display || p.label) };
  }).filter((c) => (seen.has(c.text) ? false : (seen.add(c.text), true)))
    .sort((a, b) => (a.free ? -1 : b.free ? 1 : (parseInt(a.text, 10) || 0) - (parseInt(b.text, 10) || 0)));
};

export default function DealsV2Spin() {
  const d = useDeals();
  const nav = useNav();
  const router = useRouter();
  const top = useTopInset(36, 44);
  const w = usePageW();
  const [err, setErr] = useState<string | null>(null);
  const { rot, spin, spinning } = useSpin(d, (r) => nav.openSheet({ kind: 'result', result: r }), setErr);
  const size = Math.min(w - 56, 330);
  const stageW = size + 40;
  const ready = d.signedIn && d.status === 'ready' && d.livePrizes;
  const failed = d.signedIn && (d.status === 'error' || d.status === 'offline');
  const onPress = () => {
    setErr(null);
    if (!d.signedIn) { router.push('/login' as any); return; }
    if (d.spinsLeft <= 0) { nav.openSheet({ kind: 'nospin', nextIn: d.nextIn }); return; }
    spin();
  };
  const status = !d.signedIn
    ? 'Sign in to see your spins'
    : failed ? 'Could not load your spins.'
      : d.spinsLeft > 0 ? `You have ${d.spinsLeft} spin${d.spinsLeft === 1 ? '' : 's'} ready`
        : d.nextIn ? `${d.nextIn} more delivered order${d.nextIn === 1 ? '' : 's'} to your next spin`
          : `Earn a spin for every ${ORDERS_PER_SPIN} delivered orders`;
  const label = !d.signedIn ? 'Sign in to spin' : spinning ? 'Spinning…' : d.spinsLeft > 0 ? 'Spin the wheel' : 'No spins yet';

  return (
    <View style={{ flex: 1 }}>
      <LinearGradient colors={[DV.night[0], DV.night[1], DV.night[2]]} start={{ x: 0, y: 0 }} end={{ x: 0.4, y: 1 }} style={StyleSheet.absoluteFill} />
      <View style={[s.head, { paddingTop: top }]}>
        <Press onPress={nav.back} label="Back" style={s.headBtn} scaleTo={0.9}><IArrowLeft size={19} color="#FFFFFF" strokeWidth={1.8} /></Press>
        <Text style={s.headTitle} accessibilityRole="header">Spin & win</Text>
        {d.signedIn ? (
          <View style={s.chip}><View><IGift size={13} color="#FFFFFF" strokeWidth={1.8} /></View><Text style={s.chipText}>{d.spinsLeft} spin{d.spinsLeft === 1 ? '' : 's'} left</Text></View>
        ) : null}
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: 48, alignItems: 'center' }} showsVerticalScrollIndicator={false}>
        <Text style={s.sub}>Win ZENV Points or a free-delivery coupon</Text>

        <View style={{ width: stageW, height: size + stageW * 0.2, marginTop: 18 }}>
          <Podium width={stageW} style={{ position: 'absolute', left: 0, bottom: -stageW * 0.08 }} />
          <View style={{ position: 'absolute', left: 20, top: 0 }}>
            <PrizeWheel prizes={d.prizes} size={size} rotate={rot} />
          </View>
        </View>

        <Text style={s.status} accessibilityLiveRegion="polite">{status}</Text>
        <View style={{ alignSelf: 'stretch', paddingHorizontal: 20, marginTop: 14 }}>
          {failed ? (
            <CTA label="Try again" tone="white" onPress={() => d.reload()} />
          ) : (
            <CTA label={label} tone={d.signedIn && d.spinsLeft <= 0 ? 'soft' : 'white'} onPress={onPress} busy={spinning} disabled={d.signedIn && !ready && !spinning} />
          )}
          {err ? <Notice tone="warn" style={{ marginTop: 12 }}>{err}</Notice> : null}
          {d.signedIn && ready && d.spinsLeft === 0 ? (
            <Press onPress={() => nav.go('/(tabs)/others?tab=food')} label="Shop the campus store to earn your next spin" style={s.earn}>
              <Text style={s.earnText}>Shop the campus store to earn your next spin</Text>
            </Press>
          ) : null}
        </View>

        <View style={s.panel}>
          <Text style={s.panelTitle}>What you can win</Text>
          <View style={s.prizes}>
            {prizeChips(d.prizes).map((c) => (
              <View key={c.text} style={[s.prize, c.free ? s.prizeFree : null]}>
                {c.free ? <View><ITruck size={14} color="#FFFFFF" strokeWidth={1.7} /></View> : <Coin size={16} />}
                <Text style={s.prizeText}>{c.text}</Text>
              </View>
            ))}
          </View>
          <View style={s.rule}>
            <View><IInfo size={16} color="#C4B5FD" strokeWidth={1.8} /></View>
            <Text style={s.ruleText}>
              {`You earn a spin for every ${ORDERS_PER_SPIN} delivered orders. ZENV picks the prize when you spin. ZENV Points are added to your balance at once; a free-delivery coupon goes to Your coupons and lasts 7 days.`}
            </Text>
          </View>
        </View>

        {__DEV__ ? (
          <View style={s.dev}>
            <Text style={s.devText}>Dev build only: preview the result sheet with a sample payload (no spin is used)</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
              <Press onPress={() => nav.openSheet({ kind: 'result', result: { display: '50 ZENV Points', type: 'points', coupon: null, sample: true } })} label="Preview a points result" style={s.devBtn}><Text style={s.devBtnText}>Points result</Text></Press>
              <Press onPress={() => nav.openSheet({ kind: 'result', result: { display: 'Free Delivery', type: 'coupon', coupon: { code: 'ZF-SAMPLE', type: 'FREEDEL', expiryDate: new Date(Date.now() + 7 * 86400000).toISOString() }, sample: true } })} label="Preview a coupon result" style={s.devBtn}><Text style={s.devBtnText}>Coupon result</Text></Press>
              <Press onPress={() => nav.openSheet({ kind: 'nospin', nextIn: 1 })} label="Preview no spins" style={s.devBtn}><Text style={s.devBtnText}>No spins</Text></Press>
            </View>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const s = themedSheet(() => ({
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 6, gap: 12 },
  headBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center' },
  headTitle: { flex: 1, color: '#FFFFFF', fontSize: 18, fontWeight: W.title },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 11, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.3)' },
  chipText: { color: '#FFFFFF', fontSize: 12.5, fontWeight: W.label },
  sub: { color: DV.nightSub, fontSize: 13.5, marginTop: 6 },
  status: { color: '#FFFFFF', fontSize: 15, fontWeight: W.label, marginTop: 26, textAlign: 'center', paddingHorizontal: 20 },
  earn: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, marginTop: 6 },
  earnText: { color: '#E4DBFF', fontSize: 13.5, fontWeight: W.label, textDecorationLine: 'underline' },
  panel: { alignSelf: 'stretch', marginHorizontal: 16, marginTop: 22, padding: 16, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.16)' },
  panelTitle: { color: '#FFFFFF', fontSize: 15.5, fontWeight: W.title },
  prizes: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  prize: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.22)' },
  prizeFree: { backgroundColor: 'rgba(109,63,230,0.55)', borderColor: 'rgba(196,181,253,0.6)' },
  prizeText: { color: '#FFFFFF', fontSize: 12.5, fontWeight: W.label },
  rule: { flexDirection: 'row', gap: 10, marginTop: 14 },
  ruleText: { flex: 1, color: DV.nightSub, fontSize: 12.5, lineHeight: 18 },
  dev: { alignSelf: 'stretch', marginHorizontal: 16, marginTop: 16, padding: 12, borderRadius: 16, borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.25)' },
  devText: { color: 'rgba(255,255,255,0.6)', fontSize: 11.5 },
  devBtn: { paddingHorizontal: 10, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.12)', justifyContent: 'center' },
  devBtnText: { color: '#FFFFFF', fontSize: 11.5, fontWeight: W.label },
}));
