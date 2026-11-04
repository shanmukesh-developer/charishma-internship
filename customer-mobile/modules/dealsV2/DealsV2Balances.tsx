/**
 * Deals & spin v2: the two balance cards (real values only) and the "Spin & win" row.
 *   ZenPoints  cream card, glossy gold Z coin, the real balance, opens /deals/points
 *   Wallet     lavender card, glossy violet wallet plate, the real balance, opens /wallet-history
 *   SpinRow    small real wheel (still), the live spin line, an indigo "View wheel" pill
 *   SignInCard shown instead of the balances while signed out
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { DV, W, rupees, shadow } from './dealsV2Theme';
import { Press } from './DealsV2Kit';
import { Coin, IconPlate } from './DealsV2Decor';
import { PrizeWheel } from './DealsV2Wheel';
import { IArrowRight, IChevronRight, IUser, IWallet } from './DealsV2Icons';
import { ORDERS_PER_SPIN, type Prize } from './dealsV2Data';

export function Balances({ zenPoints, wallet, onPoints, onWallet }: { zenPoints: number; wallet: number; onPoints: () => void; onWallet: () => void }) {
  return (
    <View style={s.row}>
      <Press onPress={onPoints} label={`ZENV Points ${zenPoints}. Open your points`} style={[s.cardWrap, shadow(2, '#B57A0E')]}>
        <View style={[s.card, { borderColor: DV.creamLine }]}>
          <LinearGradient colors={[DV.cream[0], DV.cream[1]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
          <LinearGradient colors={['rgba(255,255,255,0.7)', 'rgba(255,255,255,0)']} style={[StyleSheet.absoluteFill, { height: '45%' }]} />
          <View style={s.top}>
            <Coin size={38} />
            <Text style={[s.label, { color: DV.creamInk }]}>ZENV Points</Text>
          </View>
          <View style={s.valueRow}>
            <Text style={[s.value, { color: '#5A3600' }]} numberOfLines={1} adjustsFontSizeToFit>{zenPoints.toLocaleString('en-IN')}</Text>
            <IChevronRight size={18} color={DV.creamInk} strokeWidth={1.8} />
          </View>
          <Text style={[s.sub, { color: '#8A6420' }]} numberOfLines={2}>Earned from spins, ratings and invites</Text>
        </View>
      </Press>
      <Press onPress={onWallet} label={`Wallet ${rupees(wallet)}. Open wallet history`} style={[s.cardWrap, shadow(2)]}>
        <View style={[s.card, { borderColor: DV.lavenderLine }]}>
          <LinearGradient colors={[DV.lavender[0], DV.lavender[1]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
          <LinearGradient colors={['rgba(255,255,255,0.7)', 'rgba(255,255,255,0)']} style={[StyleSheet.absoluteFill, { height: '45%' }]} />
          <View style={s.top}>
            <IconPlate size={38}><IWallet size={19} color="#FFFFFF" strokeWidth={1.7} /></IconPlate>
            <Text style={[s.label, { color: DV.violetDeep }]}>Wallet</Text>
          </View>
          <View style={s.valueRow}>
            <Text style={[s.value, { color: DV.ink }]} numberOfLines={1} adjustsFontSizeToFit>{rupees(wallet)}</Text>
            <IChevronRight size={18} color={DV.violetDeep} strokeWidth={1.8} />
          </View>
          <Text style={[s.sub, { color: DV.sub }]} numberOfLines={2}>Quick & easy payments</Text>
        </View>
      </Press>
    </View>
  );
}

export function SignInCard({ onSignIn }: { onSignIn: () => void }) {
  return (
    <View style={[s.signin, shadow(2)]}>
      <IconPlate size={38}><IUser size={19} color="#FFFFFF" strokeWidth={1.7} /></IconPlate>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.rowTitle}>Sign in for your rewards</Text>
        <Text style={s.rowSub}>See your spins, ZENV Points, coupons and wallet.</Text>
      </View>
      <Press onPress={onSignIn} label="Sign in" style={s.smallPill} scaleTo={0.94}>
        <LinearGradient colors={[DV.go[0], DV.go[2]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        <Text style={s.smallPillText}>Sign in</Text>
      </Press>
    </View>
  );
}

export function SpinRow({ prizes, signedIn, spinsLeft, nextIn, onPress }: { prizes: Prize[]; signedIn: boolean; spinsLeft: number; nextIn: number | null; onPress: () => void }) {
  const line = !signedIn
    ? `Earn a spin for every ${ORDERS_PER_SPIN} delivered orders`
    : spinsLeft > 0
      ? `You have ${spinsLeft} spin${spinsLeft === 1 ? '' : 's'} ready`
      : nextIn
        ? `${nextIn} more delivered order${nextIn === 1 ? '' : 's'} to your next spin`
        : `Earn a spin for every ${ORDERS_PER_SPIN} delivered orders`;
  return (
    <Press onPress={onPress} label={`Spin and win. ${line}`} style={[s.spin, shadow(2)]}>
      <LinearGradient colors={['#FFFFFF', '#F6F2FF']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, { borderRadius: 22 }]} />
      <PrizeWheel prizes={prizes} size={58} labels={false} />
      <View style={{ flex: 1, minWidth: 0, marginLeft: 12 }}>
        <Text style={s.rowTitle}>Spin & win</Text>
        <Text style={s.rowSub} numberOfLines={2}>{line}</Text>
      </View>
      <View style={[s.smallPill, { flexDirection: 'row', gap: 5 }]}>
        <LinearGradient colors={[DV.go[0], DV.go[2]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        <Text style={s.smallPillText}>{signedIn && spinsLeft > 0 ? 'Spin now' : 'View wheel'}</Text>
        <View><IArrowRight size={14} color="#FFFFFF" strokeWidth={2} /></View>
      </View>
    </Press>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12, marginHorizontal: 16, marginTop: 16 },
  cardWrap: { flex: 1, borderRadius: 22 },
  card: { flexGrow: 1, borderRadius: 22, overflow: 'hidden', padding: 14, borderWidth: 1, minHeight: 138 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  label: { fontSize: 13.5, fontWeight: W.label },
  valueRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  value: { fontSize: 26, fontWeight: W.display, letterSpacing: -0.5, flexShrink: 1 },
  sub: { fontSize: 12, lineHeight: 16, marginTop: 4 },
  plate: { width: 38, height: 38, borderRadius: 13, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  signin: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginTop: 16, padding: 14, borderRadius: 22, backgroundColor: '#FFFFFF', borderWidth: StyleSheet.hairlineWidth, borderColor: DV.line },
  spin: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginTop: 14, padding: 12, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, borderColor: DV.line, backgroundColor: '#FFFFFF' },
  rowTitle: { fontSize: 15.5, fontWeight: W.title, color: DV.ink },
  rowSub: { fontSize: 12.5, color: DV.sub, marginTop: 2, lineHeight: 17 },
  smallPill: { height: 36, paddingHorizontal: 14, borderRadius: 18, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  smallPillText: { color: '#FFFFFF', fontSize: 13, fontWeight: W.title },
});
