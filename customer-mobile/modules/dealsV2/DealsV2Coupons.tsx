/**
 * /deals/coupons and /deals/coupon/:code in the Deals v2 look.
 *   Coupons       three tabs: Active (the real usable coupons, GET /api/rewards/coupons, with Apply), Used and
 *                 Expired (GET /api/rewards/coupons/history, last 90 days, greyed, no Apply); loading, empty and
 *                 offline states per tab
 *   CouponDetail  one coupon: a large ticket, the code with Copy, the real terms (minimum order, validity, store
 *                 limit, stall orders, one use) and Apply (checkout ?coupon=CODE)
 */
import React, { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Clipboard from '@react-native-clipboard/clipboard';
import * as Haptics from 'expo-haptics';
import { DV, W, shadow, shortDate } from './dealsV2Theme';
import { CTA, PageHeader, Press } from './DealsV2Kit';
import { Ticket, couponCondition, couponValidity } from './DealsV2Ticket';
import { Skeleton, StateBlock } from './DealsV2States';
import { IconPlate } from './DealsV2Decor';
import { ICheck, ICopy, IInfo, ITicketPercent, ITruck } from './DealsV2Icons';
import { useApplyCoupon } from './DealsV2Sheets';
import { couponMin, couponTitle, useCouponHistory, useDeals } from './dealsV2Data';
import { useNav } from './dealsV2Nav';
import { themedSheet } from '../../utils/themeNow';

type Tab = 'active' | 'used' | 'expired';

export function Coupons() {
  const d = useDeals();
  const nav = useNav();
  const apply = useApplyCoupon();
  const hist = useCouponHistory(d.uid);
  const [tab, setTab] = useState<Tab>('active');
  const [refreshing, setRefreshing] = useState(false);
  const n = d.coupons.length;
  const past = tab === 'used' ? hist.used : hist.expired;
  const tabs: [Tab, string][] = [['active', n ? `Active (${n})` : 'Active'], ['used', 'Used'], ['expired', 'Expired']];
  return (
    <View style={{ flex: 1 }}>
      <PageHeader title="Your coupons" sub={d.signedIn ? (n ? `${n} ready to use at checkout` : 'Coupons you win or claim show up here') : 'Sign in to see your coupons'} />
      {d.signedIn ? (
        <View style={s.tabs} accessibilityRole="tablist">
          {tabs.map(([k, label]) => {
            const on = k === tab;
            return (
              <Press key={k} onPress={() => setTab(k)} label={label} style={[s.tab, on ? s.tabOn : null]} scaleTo={0.96}>
                <Text style={[s.tabText, on ? s.tabTextOn : null]} numberOfLines={1}>{label}</Text>
              </Press>
            );
          })}
        </View>
      ) : null}
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 60, gap: 12 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await Promise.all([d.reload(), hist.reload()]); setRefreshing(false); }} tintColor={DV.violet} colors={[DV.violet]} />}
      >
        {!d.signedIn ? <StateBlock kind="signin" body="Your coupons are saved to your account." action="Sign in" onAction={() => nav.go('/login')} style={{ marginHorizontal: 0 }} /> : null}
        {d.signedIn && tab === 'active' ? (
          <>
            {d.status === 'loading' && n === 0 ? <Skeleton rows={3} style={{ paddingHorizontal: 0 }} /> : null}
            {(d.status === 'error' || d.status === 'offline') && n === 0 ? <StateBlock kind={d.status} action="Try again" onAction={() => d.reload()} style={{ marginHorizontal: 0 }} /> : null}
            {d.status === 'ready' && n === 0 ? (
              <StateBlock kind="empty" title="No coupons yet" body="Spin the wheel or claim one of today's deals and your coupons show up here." action="See the wheel" onAction={() => nav.push({ name: 'spin' })} style={{ marginHorizontal: 0 }} />
            ) : null}
            {d.coupons.map((c) => <Ticket key={c.code} coupon={c} onApply={() => apply(c)} onPress={() => nav.push({ name: 'coupon', code: c.code })} />)}
            {n > 0 ? <Text style={s.foot}>Each coupon works once. Used and expired ones move to their own tabs.</Text> : null}
          </>
        ) : null}
        {d.signedIn && tab !== 'active' ? (
          <>
            {(hist.status === 'loading' || hist.status === 'idle') && past.length === 0 ? <Skeleton rows={3} style={{ paddingHorizontal: 0 }} /> : null}
            {(hist.status === 'error' || hist.status === 'offline') && past.length === 0 ? <StateBlock kind={hist.status} action="Try again" onAction={() => hist.reload()} style={{ marginHorizontal: 0 }} /> : null}
            {hist.status === 'ready' && past.length === 0 ? (
              <StateBlock kind="empty" title={tab === 'used' ? 'No used coupons' : 'No expired coupons'} body={tab === 'used' ? 'Coupons you use at checkout in the last 90 days show up here.' : 'Coupons that ran out in the last 90 days show up here.'} style={{ marginHorizontal: 0 }} />
            ) : null}
            {past.map((c) => (
              <Ticket key={c.code} coupon={c} muted note={c.status === 'used' ? (c.usedAt ? `Used on ${shortDate(c.usedAt)}` : 'Used') : `Expired on ${shortDate(c.expiryDate)}`} />
            ))}
            {past.length > 0 ? <Text style={s.foot}>Showing the last 90 days.</Text> : null}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

export function CouponDetail({ code }: { code: string }) {
  const d = useDeals();
  const nav = useNav();
  const apply = useApplyCoupon();
  const [copied, setCopied] = useState(false);
  const c = d.coupons.find((x) => x.code === code);
  if (!c) {
    return (
      <View style={{ flex: 1 }}>
        <PageHeader title="Coupon" />
        <View style={{ paddingTop: 16 }}>
          {d.status === 'loading' || d.status === 'idle' ? <Skeleton rows={1} /> : (
            <StateBlock kind={d.status === 'offline' ? 'offline' : 'empty'} title={d.status === 'offline' ? undefined : 'This coupon is not available'} body={d.status === 'offline' ? undefined : 'It may have been used or it has expired.'} action="See my coupons" onAction={() => nav.push({ name: 'coupons' })} />
          )}
        </View>
      </View>
    );
  }
  const min = couponMin(c);
  const terms = [
    min > 0 ? `Works on an item total of ₹${min} or more.` : 'No minimum order.',
    c.expiryDate ? `Valid till ${shortDate(c.expiryDate)}, ${new Date(c.expiryDate).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })}.` : 'Does not expire.',
    c.type === 'FREEDEL' ? 'Takes the delivery fee off your order.' : Number(c.value) > 0 ? `Takes ₹${Math.round(Number(c.value))} off your item total.` : '20% off your item total, up to ₹50.',
    c.restaurantId || c.menuItemId ? 'Only works at the store (or on the item) of the deal it came from.' : null,
    "Not for stall orders (orders the stall delivers itself).",
    'One use. It is checked again at checkout, and the bill shows the saving.',
  ].filter(Boolean) as string[];
  const copy = () => {
    try { Clipboard.setString(c.code); } catch {}
    Haptics.selectionAsync().catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <View style={{ flex: 1 }}>
      <PageHeader title={couponTitle(c)} sub={couponCondition(c)} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <View style={[s.hero, shadow(3, '#3A1A9E')]}>
          <LinearGradient colors={[DV.hero[0], DV.hero[1], DV.hero[2]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, { borderRadius: 24 }]} />
          <LinearGradient colors={['rgba(255,255,255,0.22)', 'rgba(255,255,255,0)']} style={[StyleSheet.absoluteFill, { height: '45%', borderRadius: 24 }]} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.heroTitle}>{couponTitle(c)}</Text>
            <Text style={s.heroSub}>{couponValidity(c)}</Text>
          </View>
          <View>{c.type === 'FREEDEL' ? <IconPlate size={64} radius={20}><ITruck size={30} color="#FFFFFF" strokeWidth={1.5} /></IconPlate> : <IconPlate size={64} radius={20}><ITicketPercent size={30} color="#FFFFFF" strokeWidth={1.5} /></IconPlate>}</View>
        </View>
        <Press onPress={copy} label={copied ? 'Code copied' : `Copy code ${c.code}`} style={s.code}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.codeLabel}>Coupon code</Text>
            <Text style={s.codeText} numberOfLines={1} adjustsFontSizeToFit>{c.code}</Text>
          </View>
          {copied ? <ICheck size={18} color={DV.green} strokeWidth={2} /> : <ICopy size={18} color={DV.violet} strokeWidth={1.8} />}
          <Text style={[s.copy, copied ? { color: DV.green } : null]}>{copied ? 'Copied' : 'Copy'}</Text>
        </Press>
        <View style={[s.terms, shadow(1)]}>
          <Text style={s.termsTitle}>Terms</Text>
          {terms.map((t, i) => (
            <View key={i} style={s.term}>
              <View style={s.dot} />
              <Text style={s.termText}>{t}</Text>
            </View>
          ))}
        </View>
        <View style={s.note}>
          <IInfo size={15} color={DV.violet} strokeWidth={1.8} />
          <Text style={s.noteText}>Apply opens checkout with this code. If it does not fit your basket, checkout tells you why and removes it.</Text>
        </View>
        <CTA label="Apply at checkout" onPress={() => apply(c)} style={{ marginTop: 16 }} />
      </ScrollView>
    </View>
  );
}

const s = themedSheet(() => ({
  foot: { fontSize: 12, color: DV.faint, textAlign: 'center', marginTop: 6 },
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 14 },
  tab: { flex: 1, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: DV.card, borderWidth: 1, borderColor: DV.line },
  tabOn: { backgroundColor: DV.violet, borderColor: DV.violet },
  tabText: { fontSize: 13.5, fontWeight: W.label, color: DV.sub },
  tabTextOn: { color: '#FFFFFF' },
  hero: { flexDirection: 'row', alignItems: 'center', padding: 20, borderRadius: 24, overflow: 'hidden', minHeight: 120 },
  heroTitle: { color: '#FFFFFF', fontSize: 24, fontWeight: W.display, letterSpacing: -0.3 },
  heroSub: { color: 'rgba(242,238,255,0.9)', fontSize: 13, marginTop: 4 },
  code: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14, height: 62, paddingHorizontal: 16, borderRadius: 18, borderWidth: 1.4, borderStyle: 'dashed', borderColor: DV.violetLine, backgroundColor: DV.card },
  codeLabel: { fontSize: 11.5, color: DV.sub },
  codeText: { fontSize: 18, fontWeight: W.title, color: DV.ink, letterSpacing: 0.8 },
  copy: { fontSize: 13.5, fontWeight: W.label, color: DV.violet },
  terms: { marginTop: 14, padding: 16, borderRadius: 20, backgroundColor: DV.card, borderWidth: StyleSheet.hairlineWidth, borderColor: DV.line },
  termsTitle: { fontSize: 15.5, fontWeight: W.title, color: DV.ink, marginBottom: 4 },
  term: { flexDirection: 'row', gap: 10, marginTop: 8, alignItems: 'flex-start' },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: DV.violet, marginTop: 7 },
  termText: { flex: 1, fontSize: 13.5, color: DV.ink, lineHeight: 19 },
  note: { flexDirection: 'row', gap: 8, marginTop: 14, paddingHorizontal: 4 },
  noteText: { flex: 1, fontSize: 12.5, color: DV.sub, lineHeight: 18 },
}));
