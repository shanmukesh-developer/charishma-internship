/**
 * Deals & spin v2 sheets (one bottom sheet host per screen):
 *   sample  polite "sample deal" note (never claims anything)       deal    real deal detail + claim (DealsV2DealSheet)
 *   result  spin result (DealsV2Result)                             apply   empty basket: copy the code, go shopping
 *   nospin  no spins yet: the real rule and how many orders to go
 * Also `useApplyCoupon`: Apply opens checkout with ?coupon=CODE (the existing apply flow: checkout puts it on the
 * server quote, which drops it with the server's reason if it does not fit the basket).
 */
import React, { useCallback, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Clipboard from '@react-native-clipboard/clipboard';
import { useCart } from '../../context/CartContext';
import { DV, W, shadow } from './dealsV2Theme';
import { CTA, Press } from './DealsV2Kit';
import { IconPlate } from './DealsV2Decor';
import { PrizeWheel } from './DealsV2Wheel';
import { IBasket, ICheck, ICopy, IInfo } from './DealsV2Icons';
import { ResultBody, ResultWash } from './DealsV2Result';
import { DealSheetBody } from './DealsV2DealSheet';
import { ORDERS_PER_SPIN, couponTitle, useDeals, type Coupon } from './dealsV2Data';
import { useNav } from './dealsV2Nav';
import { themedSheet } from '../../utils/themeNow';

export function useApplyCoupon() {
  const { totalItems, basketCounts, lastAddedBasket } = useCart() as any;
  const nav = useNav();
  return useCallback((c: Coupon) => {
    if ((Number(totalItems) || 0) > 0) {
      // Name the basket that has items (the one added to last, else the first non-empty): checkout opens the
      // active basket otherwise, which is Restaurants on every launch, and said "Your basket is empty".
      const counts = (basketCounts || {}) as Record<string, number>;
      const kind = lastAddedBasket && counts[lastAddedBasket] > 0 ? lastAddedBasket : Object.keys(counts).find((k) => counts[k] > 0);
      nav.go(`/checkout?coupon=${encodeURIComponent(c.code)}${kind ? `&basket=${kind}` : ''}`);
    } else nav.openSheet({ kind: 'apply', coupon: c });
  }, [totalItems, basketCounts, lastAddedBasket, nav]);
}

function ApplyBody({ coupon, onShop }: { coupon: Coupon; onShop: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <View style={{ alignItems: 'center' }}>
      <IconPlate size={64} radius={20} style={{ marginTop: 6 }}><IBasket size={28} color="#FFFFFF" strokeWidth={1.5} /></IconPlate>
      <Text style={s.title}>Your basket is empty</Text>
      <Text style={s.body}>{`Add something to your basket, then "${couponTitle(coupon)}" goes on at checkout. You can also copy the code and enter it there.`}</Text>
      <Press onPress={() => { try { Clipboard.setString(coupon.code); } catch {} setCopied(true); }} label={copied ? 'Code copied' : `Copy code ${coupon.code}`} style={s.code}>
        <Text style={s.codeText} numberOfLines={1}>{coupon.code}</Text>
        <View>{copied ? <ICheck size={18} color={DV.green} strokeWidth={2} /> : <ICopy size={18} color={DV.violet} strokeWidth={1.8} />}</View>
      </Press>
      <CTA label="Shop the campus store" onPress={onShop} style={{ alignSelf: 'stretch', marginTop: 16 }} />
    </View>
  );
}

export default function DealsV2Sheets() {
  const nav = useNav();
  const d = useDeals();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const sh = nav.sheet;
  const shop = () => { nav.closeSheet(); if (nav.onSection) nav.onSection('food'); else router.push('/(tabs)/others?tab=food' as any); };
  return (
    <Modal visible={!!sh} transparent animationType="slide" onRequestClose={nav.closeSheet} statusBarTranslucent>
      <Pressable style={s.backdrop} onPress={nav.closeSheet} accessibilityLabel="Close" />
      {sh ? (
        <View style={[s.sheet, shadow(3), { paddingBottom: Math.max(insets.bottom, 12) + 14, maxHeight: height * 0.92 }]} accessibilityViewIsModal>
          <LinearGradient colors={[DV.card, DV.page]} style={StyleSheet.absoluteFill} />
          {sh.kind === 'result' ? <ResultWash /> : null}
          <View style={s.grab} />
          {sh.kind === 'sample' ? (
            <View style={{ alignItems: 'center' }}>
              <IconPlate size={64} radius={20} style={{ marginTop: 6 }}><IInfo size={28} color="#FFFFFF" strokeWidth={1.5} /></IconPlate>
              <Text style={s.title} accessibilityRole="header">This is a sample deal</Text>
              <Text style={s.body}>{`"${sh.deal.name}" shows how today's deals look. Real deals appear here as campus stores publish them, and claiming one gives you your own coupon code. Nothing was claimed.`}</Text>
              <CTA label="Got it" onPress={nav.closeSheet} style={{ alignSelf: 'stretch', marginTop: 18 }} />
            </View>
          ) : null}
          {sh.kind === 'deal' ? <DealSheetBody item={sh.item} onClose={nav.closeSheet} /> : null}
          {sh.kind === 'apply' ? <ApplyBody coupon={sh.coupon} onShop={shop} /> : null}
          {sh.kind === 'result' ? (
            <ResultBody
              result={sh.result}
              spinsLeft={sh.result.sample ? d.spinsLeft : Number(sh.result.spinsAvailable ?? d.spinsLeft)}
              onAgain={nav.closeSheet}
              onDone={() => { nav.closeSheet(); if (!nav.isHome) nav.back(); }}
              onCoupons={() => { nav.closeSheet(); nav.push({ name: 'coupons' }); }}
            />
          ) : null}
          {sh.kind === 'nospin' ? (
            <View style={{ alignItems: 'center' }}>
              <View style={{ marginTop: 6 }}><PrizeWheel prizes={d.prizes} size={110} labels={false} /></View>
              <Text style={s.title} accessibilityRole="header">No spins yet</Text>
              <Text style={s.body}>
                {`You earn a spin for every ${ORDERS_PER_SPIN} delivered orders.${sh.nextIn ? ` ${sh.nextIn} more delivered order${sh.nextIn === 1 ? '' : 's'} to your next one.` : ''}`}
              </Text>
              <CTA label="Shop the campus store" onPress={shop} style={{ alignSelf: 'stretch', marginTop: 18 }} />
              <Press onPress={nav.closeSheet} label="Not now" style={s.link}><Text style={s.linkText}>Not now</Text></Press>
            </View>
          ) : null}
        </View>
      ) : null}
    </Modal>
  );
}

const s = themedSheet(() => ({
  backdrop: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(16,8,48,0.55)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingTop: 10, overflow: 'hidden', maxWidth: 560, alignSelf: 'center', width: '100%' },
  grab: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(26,19,64,0.18)', marginBottom: 10 },
  title: { color: DV.ink, fontSize: 19, fontWeight: W.title, textAlign: 'center', marginTop: 10 },
  body: { color: DV.sub, fontSize: 13.5, lineHeight: 20, textAlign: 'center', marginTop: 8 },
  code: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: 10, height: 52, marginTop: 14, paddingHorizontal: 16, borderRadius: 16, borderWidth: 1.2, borderStyle: 'dashed', borderColor: DV.violetLine, backgroundColor: DV.violetSoft },
  codeText: { flex: 1, fontSize: 15.5, fontWeight: W.title, color: DV.ink, letterSpacing: 0.5 },
  link: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, marginTop: 2 },
  linkText: { color: DV.violet, fontSize: 14, fontWeight: W.label },
}));
