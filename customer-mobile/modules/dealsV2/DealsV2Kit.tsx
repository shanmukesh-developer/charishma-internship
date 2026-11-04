/**
 * Deals & spin v2 kit:
 *   Press        press-scale tappable (web-safe role)          PageHeader  violet inner-screen header (back, title, sub)
 *   SectionHead  title + optional "See all ›"                   CTA         glossy indigo button (or soft / white)
 *   SampleTag    small "Sample" label                          Card        white card with a layered violet shadow
 */
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { PressScale, FadeInUp } from '../others/motion';
import { BUTTON_ROLE } from '../../utils/pressRole';
import { useTopInset } from '../../utils/useTopInset';
import { DV, RADIUS, W, shadow } from './dealsV2Theme';
import { IArrowLeft, IChevronRight } from './DealsV2Icons';
import { useNav } from './dealsV2Nav';
import { themedSheet } from '../../utils/themeNow';

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

export function PageHeader({ title, sub, right, onBack, children }: { title: string; sub?: string; right?: React.ReactNode; onBack?: () => void; children?: React.ReactNode }) {
  const nav = useNav();
  const top = useTopInset(36, 44);
  return (
    <LinearGradient colors={[DV.header[0], DV.header[1], DV.header[2]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[st.head, { paddingTop: top }]}>
      <View style={st.headRow}>
        <Press onPress={onBack || nav.back} label="Back" style={st.headBtn} scaleTo={0.9}><IArrowLeft size={19} color="#FFFFFF" strokeWidth={1.8} /></Press>
        <View style={{ flex: 1, marginLeft: 12, minWidth: 0 }}>
          <Text style={st.headTitle} numberOfLines={1} accessibilityRole="header">{title}</Text>
          {sub ? <Text style={st.headSub} numberOfLines={1}>{sub}</Text> : null}
        </View>
        {right}
      </View>
      {children}
    </LinearGradient>
  );
}

export function SectionHead({ title, sub, onAll, allLabel = 'See all', style }: { title: string; sub?: string; onAll?: () => void; allLabel?: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[st.sec, style]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={st.secTitle} accessibilityRole="header">{title}</Text>
        {sub ? <Text style={st.secSub} numberOfLines={1}>{sub}</Text> : null}
      </View>
      {onAll ? (
        <Press onPress={onAll} label={`${allLabel}: ${title}`} style={st.all} scaleTo={0.94}>
          <Text style={st.allText}>{allLabel}</Text>
          <IChevronRight size={15} color={DV.violet} strokeWidth={1.8} />
        </Press>
      ) : null}
    </View>
  );
}

export function CTA({ label, onPress, sub, disabled, busy, style, tone = 'violet', icon }: { label: string; onPress: () => void; sub?: string; disabled?: boolean; busy?: boolean; style?: StyleProp<ViewStyle>; tone?: 'violet' | 'white' | 'soft'; icon?: React.ReactNode }) {
  const solid = tone === 'violet';
  const ink = solid ? '#FFFFFF' : DV.violetDeep;
  return (
    <Press onPress={disabled || busy ? undefined : onPress} label={label} disabled={disabled} style={[st.cta, tone === 'soft' ? st.ctaSoft : tone === 'white' ? [st.ctaWhite, shadow(2, '#120A3A')] : shadow(3, '#3A1C9E'), disabled ? { opacity: 0.5 } : null, style]}>
      {solid ? <LinearGradient colors={[DV.go[0], DV.go[1], DV.go[2]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} /> : null}
      {solid ? <LinearGradient colors={['rgba(255,255,255,0.24)', 'rgba(255,255,255,0)']} style={[StyleSheet.absoluteFill, { height: '52%' }]} /> : null}
      {busy ? <ActivityIndicator color={ink} /> : (
        <View style={{ alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {icon}
            <Text style={[st.ctaText, { color: ink }]} numberOfLines={1}>{label}</Text>
          </View>
          {sub ? <Text style={[st.ctaSub, { color: ink }]} numberOfLines={1}>{sub}</Text> : null}
        </View>
      )}
    </Press>
  );
}

export function SampleTag({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[st.sample, style]} accessibilityLabel="Sample deal">
      <Text style={st.sampleText}>Sample</Text>
    </View>
  );
}

export function Card({ children, style, index }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; index?: number }) {
  const body = <View style={[st.card, shadow(2), style]}>{children}</View>;
  return index === undefined ? body : <FadeInUp index={index}>{body}</FadeInUp>;
}

export const st = themedSheet(() => ({
  head: { paddingHorizontal: 16, paddingBottom: 16, overflow: 'hidden', borderBottomLeftRadius: 24, borderBottomRightRadius: 24 },
  headRow: { flexDirection: 'row', alignItems: 'center' },
  headBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.14)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center' },
  headTitle: { fontSize: 18, fontWeight: W.title, color: '#FFFFFF', letterSpacing: -0.2 },
  headSub: { fontSize: 12.5, color: 'rgba(235,230,255,0.8)', marginTop: 1 },
  sec: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 16, marginBottom: 12 },
  secTitle: { fontSize: 17.5, fontWeight: W.title, color: DV.ink, letterSpacing: -0.2 },
  secSub: { fontSize: 12.5, color: DV.sub, marginTop: 3 },
  all: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 36, paddingLeft: 10 },
  allText: { fontSize: 13.5, color: DV.violet, fontWeight: W.label },
  cta: { height: 54, borderRadius: 18, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', paddingHorizontal: 18 },
  ctaSoft: { backgroundColor: DV.violetSoft, borderWidth: 1, borderColor: DV.violetLine },
  ctaWhite: { backgroundColor: DV.card },
  ctaText: { fontSize: 16, fontWeight: W.title, letterSpacing: 0.1 },
  ctaSub: { fontSize: 11.5, marginTop: 1, opacity: 0.85 },
  sample: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, backgroundColor: DV.sampleSoft, borderWidth: StyleSheet.hairlineWidth, borderColor: '#EED9A4', alignSelf: 'flex-start' },
  sampleText: { fontSize: 10.5, color: DV.sample, fontWeight: W.label },
  card: { borderRadius: RADIUS.xl, backgroundColor: DV.card, borderWidth: StyleSheet.hairlineWidth, borderColor: DV.line, overflow: 'hidden' },
}));
