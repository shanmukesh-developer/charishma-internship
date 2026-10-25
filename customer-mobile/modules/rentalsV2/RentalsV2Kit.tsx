/**
 * Rentals v2 kit: the shared pieces of the inner (day) screens and a few used on the night home.
 *   Press        press-scale tappable (web-safe role)        DayHeader   back, title, pin line, actions
 *   Heart        saved toggle (light / glass)                 SampleTag   small "Sample" tag on demo items
 *   ChipRow      sliding-free violet chips                     Segmented   Daily / Weekly / Monthly
 *   CTA          full-width violet button with a shine sweep   Rating      star + "4.8 (120 reviews)"
 *   StateBlock   loading / empty / offline / error / coming soon (designed, with an icon plate)
 */
import React from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, Ellipse, RadialGradient, Stop } from 'react-native-svg';
import { PressScale, FadeInUp } from '../others/motion';
import { ShineSweep, PulseBlock } from '../foodV2/FoodV2Motion';
import { BUTTON_ROLE } from '../../utils/pressRole';
import { useTopInset } from '../../utils/useTopInset';
import { DAY, NIGHT, RADIUS, W, shadow } from './rentalsV2Theme';
import { IArrowLeft, IHeart, IPin, IStar, IWifiOff, ICloudOff, ISparkles, ISearch, IChevronDown } from './RentalsV2Icons';
import { useNav } from './rentalsV2Nav';
import { useRentalsV2 } from './rentalsV2Data';

export { FadeInUp };

export function Press({ onPress, label, style, children, scaleTo = 0.97, disabled }: { onPress?: () => void; label: string; style?: StyleProp<ViewStyle>; children: React.ReactNode; scaleTo?: number; disabled?: boolean }) {
  return (
    <PressScale onPress={onPress} accessibilityRole={BUTTON_ROLE} accessibilityLabel={label} style={style} scaleTo={scaleTo} disabled={disabled}>
      {children}
    </PressScale>
  );
}

/** Responsive page width (360 / 390 / 430 phones; tablets centre a 560 column). */
export const usePageW = () => Math.min(useWindowDimensions().width, 560);

export function DayHeader({ title, sub, right, onBack }: { title: string; sub?: string; right?: React.ReactNode; onBack?: () => void }) {
  const nav = useNav();
  const top = useTopInset(36, 44);
  return (
    <View style={[st.head, { paddingTop: top }]}>
      <Press onPress={onBack || nav.back} label="Back" style={st.headBtn}><IArrowLeft size={20} color={DAY.ink} strokeWidth={1.7} /></Press>
      <View style={{ flex: 1, marginLeft: 10 }}>
        <Text style={st.headTitle} numberOfLines={1} accessibilityRole="header">{title}</Text>
        {sub ? (
          <View style={st.headSub}>
            <IPin size={12} color={DAY.accent} strokeWidth={1.8} />
            <Text style={st.headSubText} numberOfLines={1}>{sub}</Text>
            <IChevronDown size={12} color={DAY.muted} strokeWidth={1.8} />
          </View>
        ) : null}
      </View>
      {right}
    </View>
  );
}

export function HeaderIcon({ onPress, label, children }: { onPress: () => void; label: string; children: React.ReactNode }) {
  return <Press onPress={onPress} label={label} style={st.headBtn}>{children}</Press>;
}

export function Heart({ id, tone = 'light', size = 30 }: { id: string; tone?: 'light' | 'glass' | 'plain'; size?: number }) {
  const { saved, toggleSaved } = useRentalsV2();
  const on = saved.has(id);
  const bg = tone === 'glass' ? 'rgba(20,18,50,0.32)' : tone === 'plain' ? 'transparent' : '#FFFFFF';
  const ink = on ? '#F0457A' : tone === 'glass' ? '#FFFFFF' : DAY.muted;
  return (
    <Press onPress={() => toggleSaved(id)} label={on ? 'Remove from saved' : 'Save'} scaleTo={0.88}
      style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }, tone === 'light' ? shadow(1) : null]}>
      <IHeart size={Math.round(size * 0.52)} color={ink} fill={on ? '#F0457A' : 'transparent'} strokeWidth={1.7} />
    </Press>
  );
}

export function SampleTag({ dark }: { dark?: boolean }) {
  return (
    <View style={[st.sample, dark ? { backgroundColor: 'rgba(255,246,223,0.92)' } : null]} accessibilityLabel="Sample listing">
      <Text style={st.sampleText}>Sample</Text>
    </View>
  );
}

export function ChipRow({ items, active, onSelect, style }: { items: { key: string; label: string }[]; active: string; onSelect: (k: string) => void; style?: StyleProp<ViewStyle> }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[{ paddingHorizontal: 16, gap: 8 }, style]}>
      {items.map((c) => {
        const on = c.key === active;
        return (
          <Press key={c.key} onPress={() => onSelect(c.key)} label={c.label} style={[st.chip, on ? st.chipOn : null]}>
            {on ? <LinearGradient colors={[DAY.hero[0], DAY.hero[2]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} /> : null}
            <Text style={[st.chipText, on ? { color: '#FFFFFF' } : null]}>{c.label}</Text>
          </Press>
        );
      })}
    </ScrollView>
  );
}

export function Segmented<T extends string>({ items, value, onChange }: { items: { key: T; label: string }[]; value: T; onChange: (k: T) => void }) {
  return (
    <View style={st.seg}>
      {items.map((it) => {
        const on = it.key === value;
        return (
          <Press key={it.key} onPress={() => onChange(it.key)} label={it.label} style={[st.segItem, on ? [st.segOn, shadow(1, DAY.accent)] : null]} scaleTo={0.96}>
            <Text style={[st.segText, on ? { color: '#FFFFFF' } : null]}>{it.label}</Text>
          </Press>
        );
      })}
    </View>
  );
}

export function CTA({ label, onPress, sub, disabled, busy, style }: { label: string; onPress: () => void; sub?: string; disabled?: boolean; busy?: boolean; style?: StyleProp<ViewStyle> }) {
  const w = usePageW();
  return (
    <Press onPress={disabled || busy ? undefined : onPress} label={label} style={[st.cta, shadow(3, DAY.accent), disabled ? { opacity: 0.5 } : null, style]}>
      <LinearGradient colors={[DAY.hero[0], DAY.hero[1], DAY.hero[2]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <LinearGradient colors={['rgba(255,255,255,0.22)', 'rgba(255,255,255,0)']} style={[StyleSheet.absoluteFill, { height: '55%' }]} />
      {!disabled && !busy ? <ShineSweep width={w} /> : null}
      {busy ? <ActivityIndicator color="#FFFFFF" /> : (
        <View style={{ alignItems: 'center' }}>
          <Text style={st.ctaText}>{label}</Text>
          {sub ? <Text style={st.ctaSub}>{sub}</Text> : null}
        </View>
      )}
    </Press>
  );
}

export function Rating({ value, count, dark, size = 12.5 }: { value: number | null; count: number; dark?: boolean; size?: number }) {
  if (!value || count <= 0) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <IStar size={size + 1} color={DAY.star} fill={DAY.star} strokeWidth={1.4} />
      <Text style={{ fontSize: size, color: dark ? NIGHT.ink : DAY.ink, fontWeight: W.label }}>{value.toFixed(1)}</Text>
      <Text style={{ fontSize: size, color: dark ? NIGHT.sub : DAY.muted }}>({count} review{count === 1 ? '' : 's'})</Text>
    </View>
  );
}

export function SpecChip({ label }: { label: string }) {
  return <View style={st.spec}><Text style={st.specText}>{label}</Text></View>;
}

export function SearchPill({ placeholder, onPress, right }: { placeholder: string; onPress: () => void; right?: React.ReactNode }) {
  return (
    <View style={[st.search, shadow(1)]}>
      <Press onPress={onPress} label={placeholder} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, height: '100%' }} scaleTo={0.99}>
        <ISearch size={18} color={DAY.muted} strokeWidth={1.7} />
        <Text style={st.searchText} numberOfLines={1}>{placeholder}</Text>
      </Press>
      {right}
    </View>
  );
}

type StateKind = 'loading' | 'empty' | 'offline' | 'error' | 'soon';
export function StateBlock({ kind, title, body, action, onAction, style }: { kind: StateKind; title?: string; body?: string; action?: string; onAction?: () => void; style?: StyleProp<ViewStyle> }) {
  if (kind === 'loading') {
    return (
      <View style={[{ paddingHorizontal: 16, gap: 12 }, style]} accessibilityLabel="Loading">
        {[0, 1, 2].map((i) => (
          <View key={i} style={[st.skel, shadow(1)]}>
            <PulseBlock width={96} height={84} borderRadius={14} color={DAY.lineSoft} />
            <View style={{ flex: 1, gap: 8 }}>
              <PulseBlock width="70%" height={14} borderRadius={7} color={DAY.lineSoft} />
              <PulseBlock width="45%" height={12} borderRadius={6} color={DAY.lineSoft} />
              <PulseBlock width="35%" height={14} borderRadius={7} color={DAY.accentSoft} />
            </View>
          </View>
        ))}
      </View>
    );
  }
  const Icon = kind === 'offline' ? IWifiOff : kind === 'error' ? ICloudOff : ISparkles;
  const t = title || (kind === 'offline' ? 'You are offline' : kind === 'error' ? 'Could not load rentals' : kind === 'soon' ? 'Coming soon' : 'Nothing here yet');
  const b = body || (kind === 'offline' ? 'Check your internet and try again.' : kind === 'error' ? 'The server is busy. Please try again in a moment.' : '');
  return (
    <FadeInUp style={[st.state, shadow(1), style]}>
      <LinearGradient colors={['#F3EFFF', '#E7E0FF']} style={st.statePlate}><Icon size={26} color={DAY.accent} strokeWidth={1.5} /></LinearGradient>
      <Text style={st.stateTitle}>{t}</Text>
      {b ? <Text style={st.stateBody}>{b}</Text> : null}
      {action && onAction ? (
        <Press onPress={onAction} label={action} style={st.stateBtn}><Text style={st.stateBtnText}>{action}</Text></Press>
      ) : null}
    </FadeInUp>
  );
}

/** Soft elliptical ground shadow (radial fade, no hard edge). */
export function GroundShadow({ width, height = 16, style, color = '#140A3C', opacity = 0.42 }: { width: number; height?: number; style?: any; color?: string; opacity?: number }) {
  const id = React.useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <Svg width={width} height={height} style={style} pointerEvents="none">
      <Defs>
        <RadialGradient id={`gs${id}`} cx="50%" cy="50%" rx="50%" ry="50%">
          <Stop offset="0" stopColor={color} stopOpacity={opacity} />
          <Stop offset="1" stopColor={color} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Ellipse cx={width / 2} cy={height / 2} rx={width / 2} ry={height / 2} fill={`url(#gs${id})`} />
    </Svg>
  );
}

export const st = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 10, backgroundColor: DAY.page },
  headBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', ...shadow(1) },
  headTitle: { fontSize: 18, fontWeight: W.title, color: DAY.ink, letterSpacing: -0.2 },
  headSub: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  headSubText: { fontSize: 12.5, color: DAY.muted, flexShrink: 1 },
  sample: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, backgroundColor: DAY.sampleSoft, borderWidth: StyleSheet.hairlineWidth, borderColor: '#EED9A4', alignSelf: 'flex-start' },
  sampleText: { fontSize: 10.5, color: DAY.sample, fontWeight: W.label },
  chip: { height: 36, paddingHorizontal: 16, borderRadius: RADIUS.pill, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: DAY.line, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  chipOn: { borderColor: 'transparent' },
  chipText: { fontSize: 13, color: DAY.ink2, fontWeight: W.label },
  seg: { flexDirection: 'row', backgroundColor: DAY.accentSoft, borderRadius: RADIUS.md, padding: 4, gap: 4 },
  segItem: { flex: 1, height: 40, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: DAY.accent },
  segText: { fontSize: 13.5, color: DAY.ink2, fontWeight: W.label },
  cta: { height: 54, borderRadius: 16, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  ctaText: { color: '#FFFFFF', fontSize: 16, fontWeight: W.title, letterSpacing: 0.2 },
  ctaSub: { color: 'rgba(255,255,255,0.8)', fontSize: 11.5, marginTop: 1 },
  spec: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 7, backgroundColor: DAY.lineSoft },
  specText: { fontSize: 11.5, color: DAY.ink2 },
  search: { height: 50, borderRadius: 16, backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', paddingLeft: 16, paddingRight: 6, gap: 8 },
  searchText: { fontSize: 14, color: DAY.muted, flex: 1 },
  skel: { flexDirection: 'row', gap: 12, padding: 12, borderRadius: 18, backgroundColor: '#FFFFFF', alignItems: 'center' },
  state: { marginHorizontal: 16, padding: 22, borderRadius: 22, backgroundColor: '#FFFFFF', alignItems: 'center' },
  statePlate: { width: 60, height: 60, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  stateTitle: { fontSize: 16, fontWeight: W.title, color: DAY.ink, textAlign: 'center' },
  stateBody: { fontSize: 13, color: DAY.muted, textAlign: 'center', marginTop: 6, lineHeight: 19 },
  stateBtn: { marginTop: 14, paddingHorizontal: 18, height: 40, borderRadius: 12, backgroundColor: DAY.accentSoft, alignItems: 'center', justifyContent: 'center' },
  stateBtnText: { fontSize: 13.5, color: DAY.accent, fontWeight: W.label },
});

export const isWeb = Platform.OS === 'web';
