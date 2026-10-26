/**
 * Campus Events v2 kit (night look on every screen):
 *   Press        press-scale tappable (web-safe role)        NightHeader  back, title, sub, actions (glass)
 *   SectionHead  title + sub + right action                   ChipRow      glass chips, violet gradient when on
 *   CTA          glossy violet button with a shine sweep      IconSquare   glossy gradient square + thin icon
 *   Glass        dark glass card with a top highlight          Tag          small status pill (colour + words)
 */
import React from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { PressScale, FadeInUp } from '../others/motion';
import { BUTTON_ROLE } from '../../utils/pressRole';
import { useTopInset } from '../../utils/useTopInset';
import { NIGHT, RADIUS, W, hexA, shadow } from './eventsV2Theme';
import { IArrowLeft } from './EventsV2Icons';
import { useNav } from './eventsV2Nav';

export { FadeInUp };

export function Press({ onPress, label, style, children, scaleTo = 0.97, disabled, hint }: { onPress?: () => void; label: string; style?: StyleProp<ViewStyle>; children: React.ReactNode; scaleTo?: number; disabled?: boolean; hint?: string }) {
  return (
    <PressScale onPress={onPress} accessibilityRole={BUTTON_ROLE} accessibilityLabel={label} accessibilityHint={hint} accessibilityState={{ disabled: !!disabled }} style={style} scaleTo={scaleTo} disabled={disabled}>
      {children}
    </PressScale>
  );
}

/** Responsive page width (360 / 390 / 430 phones; tablets centre a 560 column). */
export const usePageW = () => Math.min(useWindowDimensions().width, 560);

export function NightHeader({ title, sub, right, onBack, transparent }: { title?: string; sub?: string; right?: React.ReactNode; onBack?: () => void; transparent?: boolean }) {
  const nav = useNav();
  const top = useTopInset(36, 44);
  return (
    <View style={[st.head, { paddingTop: top }, transparent ? { backgroundColor: 'transparent' } : null]}>
      <Press onPress={onBack || nav.back} label="Back" style={st.headBtn} scaleTo={0.9}><IArrowLeft size={19} color="#FFFFFF" strokeWidth={1.8} /></Press>
      <View style={{ flex: 1, marginLeft: 12, minWidth: 0 }}>
        {title ? <Text style={st.headTitle} numberOfLines={1} accessibilityRole="header">{title}</Text> : null}
        {sub ? <Text style={st.headSub} numberOfLines={1}>{sub}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export function HeaderIcon({ onPress, label, children }: { onPress: () => void; label: string; children: React.ReactNode }) {
  return <Press onPress={onPress} label={label} style={[st.headBtn, { marginLeft: 8 }]} scaleTo={0.9}>{children}</Press>;
}

export function SectionHead({ title, sub, right, style }: { title: string; sub?: string; right?: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 16, marginBottom: 12 }, style]}>
      <View style={{ flex: 1 }}>
        <Text style={st.secTitle} accessibilityRole="header">{title}</Text>
        {sub ? <Text style={st.secSub}>{sub}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export function ChipRow<T extends string>({ items, active, onSelect, style }: { items: { key: T; label: string }[]; active: T; onSelect: (k: T) => void; style?: StyleProp<ViewStyle> }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0 }} contentContainerStyle={[{ paddingHorizontal: 16, gap: 8 }, style]}>
      {items.map((c) => {
        const on = c.key === active;
        return (
          <Press key={c.key} onPress={() => onSelect(c.key)} label={c.label} style={[st.chip, on ? st.chipOn : null]} scaleTo={0.94}>
            {on ? <LinearGradient colors={[NIGHT.go[0], NIGHT.go[1]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} /> : null}
            {on ? <LinearGradient colors={['rgba(255,255,255,0.28)', 'rgba(255,255,255,0)']} style={[StyleSheet.absoluteFill, { height: '55%' }]} /> : null}
            <Text style={[st.chipText, on ? { color: '#FFFFFF' } : null]}>{c.label}</Text>
          </Press>
        );
      })}
    </ScrollView>
  );
}

export function CTA({ label, onPress, sub, disabled, busy, style, tone = 'violet' }: { label: string; onPress: () => void; sub?: string; disabled?: boolean; busy?: boolean; style?: StyleProp<ViewStyle>; tone?: 'violet' | 'glass' }) {
  const w = usePageW();
  const glass = tone === 'glass';
  return (
    <Press onPress={disabled || busy ? undefined : onPress} label={label} disabled={disabled} style={[st.cta, glass ? st.ctaGlass : shadow(3, '#3A1C9E'), disabled ? { opacity: 0.5 } : null, style]}>
      {!glass ? <LinearGradient colors={['#A585FA', '#7C55EC', '#6233D8']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} /> : null}
      {!glass ? <LinearGradient colors={['rgba(255,255,255,0.26)', 'rgba(255,255,255,0)']} style={[StyleSheet.absoluteFill, { height: '52%' }]} /> : null}
      {busy ? <ActivityIndicator color="#FFFFFF" /> : (
        <View style={{ alignItems: 'center' }}>
          <Text style={st.ctaText} numberOfLines={1}>{label}</Text>
          {sub ? <Text style={st.ctaSub} numberOfLines={1}>{sub}</Text> : null}
        </View>
      )}
    </Press>
  );
}

/** Glossy gradient square with a thin white icon (quick access, info rows). */
export function IconSquare({ colors, size = 40, radius = 13, children }: { colors: readonly [string, string]; size?: number; radius?: number; children: React.ReactNode }) {
  return (
    <View style={[{ width: size, height: size, borderRadius: radius, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }, shadow(1, colors[1])]}>
      <LinearGradient colors={[colors[0], colors[1]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <LinearGradient colors={['rgba(255,255,255,0.38)', 'rgba(255,255,255,0)']} style={[StyleSheet.absoluteFill, { height: '50%', borderTopLeftRadius: radius, borderTopRightRadius: radius }]} />
      <View style={[StyleSheet.absoluteFill, { borderRadius: radius, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.4)' }]} />
      <View>{children}</View>
    </View>
  );
}

export function Glass({ children, style, index }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; index?: number }) {
  const body = (
    <View style={[st.glass, shadow(2), style]}>
      <LinearGradient colors={['rgba(255,255,255,0.10)', 'rgba(255,255,255,0.03)']} start={{ x: 0, y: 0 }} end={{ x: 0.6, y: 1 }} style={StyleSheet.absoluteFill} />
      {children}
    </View>
  );
  return index === undefined ? body : <FadeInUp index={index}>{body}</FadeInUp>;
}

export function Tag({ label, color, solid, icon }: { label: string; color: string; solid?: boolean; icon?: React.ReactNode }) {
  return (
    <View style={[st.tag, { backgroundColor: solid ? color : hexA(color, 0.16), borderColor: hexA(color, solid ? 1 : 0.42) }]} accessibilityLabel={label}>
      {icon}
      <Text style={[st.tagText, { color: solid ? '#FFFFFF' : color }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

export function SampleTag({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[st.sample, style]} accessibilityLabel="Sample event">
      <Text style={st.sampleText}>Sample</Text>
    </View>
  );
}

export const st = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12, backgroundColor: NIGHT.page },
  headBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.28)', alignItems: 'center', justifyContent: 'center' },
  headTitle: { fontSize: 18, fontWeight: W.title, color: NIGHT.ink, letterSpacing: -0.2 },
  headSub: { fontSize: 12.5, color: NIGHT.sub, marginTop: 1 },
  secTitle: { fontSize: 19, lineHeight: 24, fontWeight: W.title, color: NIGHT.ink, letterSpacing: -0.3 },
  secSub: { fontSize: 13, lineHeight: 18, color: NIGHT.faint, marginTop: 2 },
  chip: { height: 36, paddingHorizontal: 15, borderRadius: RADIUS.pill, backgroundColor: NIGHT.glass, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  chipOn: { borderColor: 'transparent' },
  chipText: { fontSize: 13, color: 'rgba(240,238,255,0.9)', fontWeight: W.label },
  cta: { height: 54, borderRadius: 18, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', paddingHorizontal: 18 },
  ctaGlass: { backgroundColor: NIGHT.glass2, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.28)' },
  ctaText: { color: '#FFFFFF', fontSize: 16, fontWeight: W.title, letterSpacing: 0.2 },
  ctaSub: { color: 'rgba(255,255,255,0.8)', fontSize: 11.5, marginTop: 1 },
  glass: { borderRadius: RADIUS.xl, backgroundColor: NIGHT.card, borderWidth: StyleSheet.hairlineWidth, borderColor: NIGHT.line, overflow: 'hidden' },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, height: 24, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, alignSelf: 'flex-start', maxWidth: '100%' },
  tagText: { fontSize: 11.5, fontWeight: W.label },
  sample: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, backgroundColor: NIGHT.sampleSoft, borderWidth: StyleSheet.hairlineWidth, borderColor: '#EED9A4', alignSelf: 'flex-start' },
  sampleText: { fontSize: 10.5, color: NIGHT.sample, fontWeight: W.label },
});
