/**
 * Designed states for Deals & spin v2: loading skeletons, empty, offline, error and sign-in, each with a glossy
 * indigo icon plate; plus the inline Notice banner. Still (a one-time fade-in only).
 */
import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { PulseBlock } from '../foodV2/FoodV2Motion';
import { FadeInUp } from '../others/motion';
import { DV, W, hexA, shadow } from './dealsV2Theme';
import { Press } from './DealsV2Kit';
import { ICloudOff, IInfo, ITicketPercent, IUser, IWifiOff } from './DealsV2Icons';
import { IconPlate } from './DealsV2Decor';

export type StateKind = 'loading' | 'empty' | 'offline' | 'error' | 'signin';

export function Skeleton({ rows = 2, height = 92, style }: { rows?: number; height?: number; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ paddingHorizontal: 16, gap: 12 }, style]} accessibilityLabel="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <View key={i} style={[s.skel, { height }]}>
          <PulseBlock width={52} height={52} borderRadius={16} color="rgba(109,63,230,0.12)" />
          <View style={{ flex: 1, gap: 9 }}>
            <PulseBlock width="62%" height={14} borderRadius={7} color="rgba(26,19,64,0.08)" />
            <PulseBlock width="44%" height={12} borderRadius={6} color="rgba(26,19,64,0.06)" />
          </View>
          <PulseBlock width={64} height={32} borderRadius={16} color="rgba(109,63,230,0.12)" />
        </View>
      ))}
    </View>
  );
}

export function StateBlock({ kind, title, body, action, onAction, icon, style }: { kind: StateKind; title?: string; body?: string; action?: string; onAction?: () => void; icon?: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  if (kind === 'loading') return <Skeleton style={style} />;
  const Icon = kind === 'offline' ? IWifiOff : kind === 'error' ? ICloudOff : kind === 'signin' ? IUser : ITicketPercent;
  const t = title || (kind === 'offline' ? 'You are offline' : kind === 'error' ? 'Could not load your rewards' : kind === 'signin' ? 'Sign in for your rewards' : 'Nothing here yet');
  const b = body || (kind === 'offline' ? 'Check your internet and try again.' : kind === 'error' ? 'The server is busy. Please try again in a moment.' : '');
  return (
    <FadeInUp style={[s.state, shadow(2), style]}>
      <LinearGradient colors={['#FFFFFF', '#F7F3FF']} style={StyleSheet.absoluteFill} />
      <IconPlate size={60} radius={20} style={{ marginBottom: 14 }}>{icon || <Icon size={26} color="#FFFFFF" strokeWidth={1.6} />}</IconPlate>
      <Text style={s.title}>{t}</Text>
      {b ? <Text style={s.body}>{b}</Text> : null}
      {action && onAction ? (
        <Press onPress={onAction} label={action} style={s.btn}><Text style={s.btnText}>{action}</Text></Press>
      ) : null}
    </FadeInUp>
  );
}

export function Notice({ children, tone = 'info', icon, style }: { children: React.ReactNode; tone?: 'info' | 'warn' | 'success'; icon?: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = tone === 'warn' ? DV.amber : tone === 'success' ? DV.green : DV.violet;
  return (
    <View style={[s.notice, { backgroundColor: hexA(c, 0.08), borderColor: hexA(c, 0.26) }, style]} accessibilityRole={tone === 'warn' ? 'alert' : undefined}>
      <View style={{ marginTop: 1 }}>{icon || <IInfo size={16} color={c} strokeWidth={1.8} />}</View>
      <Text style={s.noticeText}>{children}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  skel: { flexDirection: 'row', gap: 12, paddingHorizontal: 14, borderRadius: 20, backgroundColor: DV.card, alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: DV.line },
  state: { marginHorizontal: 16, paddingVertical: 26, paddingHorizontal: 22, borderRadius: 24, alignItems: 'center', overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: DV.line },
  plate: { width: 60, height: 60, borderRadius: 20, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', marginBottom: 14 },
  title: { fontSize: 16.5, fontWeight: W.title, color: DV.ink, textAlign: 'center' },
  body: { fontSize: 13, color: DV.sub, textAlign: 'center', marginTop: 6, lineHeight: 19 },
  btn: { marginTop: 16, paddingHorizontal: 20, height: 42, borderRadius: 14, backgroundColor: DV.violetSoft, borderWidth: 1, borderColor: DV.violetLine, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontSize: 13.5, color: DV.violetDeep, fontWeight: W.label },
  notice: { flexDirection: 'row', gap: 10, padding: 12, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, marginBottom: 12 },
  noticeText: { flex: 1, fontSize: 12.5, color: DV.ink, lineHeight: 18 },
});
