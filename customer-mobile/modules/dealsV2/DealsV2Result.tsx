/**
 * Spin result sheet in the Deals v2 official look: a still ZenPoints coin (points) or an indigo ticket plate
 * (coupon), "You won" and the prize from the server, and for a coupon its real code with Copy and its real expiry.
 * A dev-only sample payload shows a "Sample" tag. No confetti, nothing moves.
 */
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Clipboard from '@react-native-clipboard/clipboard';
import * as Haptics from 'expo-haptics';
import { DV, W, shortDate } from './dealsV2Theme';
import { CTA, Press, SampleTag } from './DealsV2Kit';
import { Coin, IconPlate } from './DealsV2Decor';
import { ICheck, ICopy, ITruck } from './DealsV2Icons';
import { stripEmoji } from './dealsV2Data';
import type { SpinResult } from './dealsV2Nav';

export function ResultBody({ result, spinsLeft, onAgain, onDone, onCoupons }: { result: SpinResult; spinsLeft: number; onAgain: () => void; onDone: () => void; onCoupons: () => void }) {
  const [copied, setCopied] = useState(false);
  const coupon = result.coupon;
  // Sentence case (owner rule): the server says "Free Delivery".
  const prize = (stripEmoji(result.display) || 'A reward').replace(/free delivery/i, 'Free delivery');
  const copy = () => {
    if (!coupon) return;
    try { Clipboard.setString(coupon.code); } catch {}
    Haptics.selectionAsync().catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <View style={{ alignItems: 'center' }}>
      {result.sample ? <SampleTag style={{ alignSelf: 'center', marginBottom: 6 }} /> : null}
      <View style={s.art}>
        {coupon ? <IconPlate size={84} radius={26}><ITruck size={38} color="#FFFFFF" strokeWidth={1.5} /></IconPlate> : <Coin size={88} />}
      </View>
      <Text style={s.sub}>You won</Text>
      <Text style={s.title} accessibilityRole="header">{prize}</Text>
      <Text style={s.note}>{coupon ? 'The coupon is in Your coupons, ready for checkout.' : 'Added to your ZCS Points balance.'}</Text>
      {coupon ? (
        <Press onPress={copy} label={copied ? 'Code copied' : `Copy code ${coupon.code}`} style={s.code} scaleTo={0.97}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.codeLabel}>Code</Text>
            <Text style={s.codeText} numberOfLines={1}>{coupon.code}</Text>
          </View>
          <View>{copied ? <ICheck size={18} color={DV.green} strokeWidth={2} /> : <ICopy size={18} color={DV.violet} strokeWidth={1.8} />}</View>
          <Text style={[s.copy, copied ? { color: DV.green } : null]}>{copied ? 'Copied' : 'Copy'}</Text>
        </Press>
      ) : null}
      {coupon?.expiryDate ? <Text style={s.valid}>Valid till {shortDate(coupon.expiryDate)}</Text> : null}
      <View style={{ alignSelf: 'stretch', marginTop: 18, gap: 4 }}>
        {coupon ? <CTA label="See my coupons" onPress={onCoupons} /> : spinsLeft > 0 ? <CTA label={`Spin again (${spinsLeft} left)`} onPress={onAgain} /> : <CTA label="Back to deals" onPress={onDone} />}
        {coupon || spinsLeft > 0 ? (
          <Press onPress={onDone} label="Back to deals" style={s.link}><Text style={s.linkText}>Back to deals</Text></Press>
        ) : null}
      </View>
    </View>
  );
}

/** Soft gold wash behind the prize (ZenPoints colour), static. */
export function ResultWash() {
  return <LinearGradient colors={['#FFF6DD', '#FFFFFF', '#F7F4FF']} locations={[0, 0.5, 1]} style={StyleSheet.absoluteFill} pointerEvents="none" />;
}

const s = StyleSheet.create({
  art: { width: 120, height: 110, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  sub: { fontSize: 14, color: DV.sub, marginTop: 4 },
  title: { fontSize: 24, fontWeight: W.display, color: DV.ink, marginTop: 2, letterSpacing: -0.3, textAlign: 'center' },
  note: { fontSize: 13, color: DV.sub, marginTop: 6, textAlign: 'center' },
  code: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16, paddingHorizontal: 14, height: 56, borderRadius: 16, borderWidth: 1.2, borderStyle: 'dashed', borderColor: DV.violetLine, backgroundColor: DV.violetSoft },
  codeLabel: { fontSize: 11, color: DV.sub },
  codeText: { fontSize: 16, fontWeight: W.title, color: DV.ink, letterSpacing: 0.6 },
  copy: { fontSize: 13, fontWeight: W.label, color: DV.violet },
  valid: { fontSize: 12.5, color: DV.sub, marginTop: 8 },
  link: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: 12 },
  linkText: { color: DV.violet, fontSize: 14, fontWeight: W.label },
});
