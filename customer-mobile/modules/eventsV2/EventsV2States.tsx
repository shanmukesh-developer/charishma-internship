/**
 * Designed states for Campus Events v2 (night look): loading skeletons, empty, offline, error, "Events open soon"
 * and sign-in, each with a glossy icon plate; plus the inline Notice banner used on the inner screens.
 */
import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { PulseBlock, FloatY } from '../foodV2/FoodV2Motion';
import { FadeInUp } from '../others/motion';
import { NIGHT, W, hexA, shadow } from './eventsV2Theme';
import { Press } from './EventsV2Kit';
import { ICloudOff, ISparkles, IWifiOff, ICalendar, IUser, IInfo } from './EventsV2Icons';
import { Sparkle } from './EventsV2Decor';

export type StateKind = 'loading' | 'empty' | 'offline' | 'error' | 'soon' | 'signin';

export function Skeleton({ rows = 3, style }: { rows?: number; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ paddingHorizontal: 16, gap: 12 }, style]} accessibilityLabel="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <View key={i} style={s.skel}>
          <PulseBlock width={92} height={84} borderRadius={14} color="rgba(255,255,255,0.08)" />
          <View style={{ flex: 1, gap: 9 }}>
            <PulseBlock width="72%" height={14} borderRadius={7} color="rgba(255,255,255,0.09)" />
            <PulseBlock width="48%" height={12} borderRadius={6} color="rgba(255,255,255,0.07)" />
            <PulseBlock width="34%" height={14} borderRadius={7} color="rgba(167,139,250,0.22)" />
          </View>
        </View>
      ))}
    </View>
  );
}

export function StateBlock({ kind, title, body, action, onAction, style }: { kind: StateKind; title?: string; body?: string; action?: string; onAction?: () => void; style?: StyleProp<ViewStyle> }) {
  if (kind === 'loading') return <Skeleton style={style} />;
  const Icon = kind === 'offline' ? IWifiOff : kind === 'error' ? ICloudOff : kind === 'soon' ? ICalendar : kind === 'signin' ? IUser : ISparkles;
  const t = title || (kind === 'offline' ? 'You are offline' : kind === 'error' ? 'Could not load events' : kind === 'soon' ? 'Events open soon' : kind === 'signin' ? 'Sign in to see your campus' : 'Nothing here yet');
  const b = body || (kind === 'offline' ? 'Check your internet and try again.' : kind === 'error' ? 'The server is busy. Please try again in a moment.' : '');
  return (
    <FadeInUp style={[s.state, shadow(2), style]}>
      <LinearGradient colors={['rgba(255,255,255,0.09)', 'rgba(255,255,255,0.02)']} style={StyleSheet.absoluteFill} />
      <FloatY distance={3} period={3600}>
        <View style={s.plate}>
          <LinearGradient colors={[NIGHT.go[0], NIGHT.go[1]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
          <LinearGradient colors={['rgba(255,255,255,0.35)', 'rgba(255,255,255,0)']} style={[StyleSheet.absoluteFill, { height: '50%' }]} />
          <View><Icon size={26} color="#FFFFFF" strokeWidth={1.6} /></View>
        </View>
        <Sparkle size={12} style={{ position: 'absolute', right: -10, top: -4 }} />
        <Sparkle size={8} color="#F0ABFC" style={{ position: 'absolute', left: -9, bottom: 4 }} />
      </FloatY>
      <Text style={s.title}>{t}</Text>
      {b ? <Text style={s.body}>{b}</Text> : null}
      {action && onAction ? (
        <Press onPress={onAction} label={action} style={s.btn}><Text style={s.btnText}>{action}</Text></Press>
      ) : null}
    </FadeInUp>
  );
}

export function Notice({ children, tone = 'info', icon, style }: { children: React.ReactNode; tone?: 'info' | 'warn' | 'danger' | 'success'; icon?: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = tone === 'warn' ? NIGHT.amber : tone === 'danger' ? NIGHT.red : tone === 'success' ? NIGHT.green : NIGHT.violet;
  return (
    <View style={[s.notice, { backgroundColor: hexA(c, 0.12), borderColor: hexA(c, 0.38) }, style]} accessibilityRole={tone === 'danger' || tone === 'warn' ? 'alert' : undefined}>
      <View style={{ marginTop: 1 }}>{icon || <IInfo size={16} color={c} strokeWidth={1.8} />}</View>
      <Text style={s.noticeText}>{children}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  skel: { flexDirection: 'row', gap: 12, padding: 12, borderRadius: 18, backgroundColor: NIGHT.card, alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: NIGHT.line },
  state: { marginHorizontal: 16, paddingVertical: 26, paddingHorizontal: 22, borderRadius: 24, backgroundColor: NIGHT.card, alignItems: 'center', overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: NIGHT.line },
  plate: { width: 60, height: 60, borderRadius: 20, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', marginBottom: 14 },
  title: { fontSize: 16.5, fontWeight: W.title, color: NIGHT.ink, textAlign: 'center' },
  body: { fontSize: 13, color: NIGHT.sub, textAlign: 'center', marginTop: 6, lineHeight: 19 },
  btn: { marginTop: 16, paddingHorizontal: 20, height: 42, borderRadius: 14, backgroundColor: 'rgba(167,139,250,0.18)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(167,139,250,0.5)', alignItems: 'center', justifyContent: 'center' },
  btnText: { fontSize: 13.5, color: '#E4DBFF', fontWeight: W.label },
  notice: { flexDirection: 'row', gap: 10, padding: 12, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, marginBottom: 12 },
  noticeText: { flex: 1, fontSize: 12.5, color: NIGHT.ink, lineHeight: 18 },
});
