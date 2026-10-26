/**
 * Tech & repairs v2 kit: the shared pieces of every screen.
 *   Press        press-scale tappable (web-safe role)       TopBar      navy bar: back, title, line, actions
 *   SearchField  white search input (inner screens)          ChipRow     filter chips (no motion)
 *   HeroCard     navy card over a photo, with trust points   SectionHead title + optional link
 *   StateBlock   empty / offline / error / waking (static)   SkeletonRows still placeholders (no pulse)
 *   BookPill     the small "Book" / "Add" button              Stepper     − qty + for basket lines
 *   BasketBar    the campus store basket bar
 * Motion: only FadeIn (one-time fade and rise on mount) and the press scale. Nothing loops.
 */
import React from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions, type ImageSourcePropType, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PressScale, FadeInUp } from '../others/motion';
import { BUTTON_ROLE } from '../../utils/pressRole';
import { useTopInset } from '../../utils/useTopInset';
import { formatINR, plural } from '../../utils/format';
import { TV, RADIUS, W, shadow } from './servicesV2Theme';
import { IArrowLeft, ICash, IClipboard, ICloudOff, IHouse, IMinus, IPlus, IRuler, ISearch, ITag, IWifiOff, IX, IBag, IChevronRight, IClock } from './ServicesV2Icons';
import type { TrustIcon } from './servicesV2Data';

export const FadeIn = FadeInUp;

/** Responsive page width (360 / 390 / 430 phones; tablets centre a 560 column). */
export const usePageW = () => Math.min(useWindowDimensions().width, 560);

export function Press({ onPress, label, style, children, scaleTo = 0.97, disabled, hint }: { onPress?: () => void; label: string; style?: StyleProp<ViewStyle>; children: React.ReactNode; scaleTo?: number; disabled?: boolean; hint?: string }) {
  return (
    <PressScale onPress={onPress} accessibilityRole={BUTTON_ROLE} accessibilityLabel={label} accessibilityHint={hint} accessibilityState={disabled ? { disabled: true } : undefined} style={style} scaleTo={scaleTo} disabled={disabled}>
      {children}
    </PressScale>
  );
}

/** Back: history when there is some, otherwise the given fallback (the Tech & repairs home). */
export function useBack(fallback = '/(tabs)/others?tab=services') {
  const router = useRouter();
  return () => (router.canGoBack() ? router.back() : router.replace(fallback as any));
}

export function TopBar({ title, sub, right, onBack, children }: { title: string; sub?: string; right?: React.ReactNode; onBack?: () => void; children?: React.ReactNode }) {
  const top = useTopInset(36, 44);
  const back = useBack();
  return (
    <LinearGradient colors={[TV.header[0], TV.header[1], TV.header[2]]} start={{ x: 0, y: 0 }} end={{ x: 0.5, y: 1 }} style={{ paddingTop: top, paddingBottom: children ? 14 : 10 }}>
      <View style={k.barRow}>
        <Press onPress={onBack || back} label="Back" style={k.barBtn} scaleTo={0.9}>
          <IArrowLeft size={22} color="#FFFFFF" strokeWidth={1.7} />
        </Press>
        <View style={{ flex: 1, minWidth: 0, marginLeft: 2 }}>
          <Text style={k.barTitle} numberOfLines={1} accessibilityRole="header">{title}</Text>
          {sub ? <Text style={k.barSub} numberOfLines={1}>{sub}</Text> : null}
        </View>
        {right}
      </View>
      {children}
    </LinearGradient>
  );
}

export function BarIcon({ onPress, label, children }: { onPress: () => void; label: string; children: React.ReactNode }) {
  return <Press onPress={onPress} label={label} style={k.barBtn} scaleTo={0.9}>{children}</Press>;
}

export function SearchField({ value, onChange, placeholder, autoFocus, onClose, style }: { value: string; onChange: (v: string) => void; placeholder: string; autoFocus?: boolean; onClose?: () => void; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[k.search, style]}>
      <ISearch size={18} color={TV.sub} strokeWidth={1.7} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={TV.faint}
        autoFocus={autoFocus}
        returnKeyType="search"
        maxLength={60}
        style={k.searchInput}
        accessibilityLabel={placeholder}
      />
      {value || onClose ? (
        <Press onPress={() => (value ? onChange('') : onClose?.())} label={value ? 'Clear search' : 'Close search'} style={k.searchClear} scaleTo={0.9}>
          <IX size={17} color={TV.sub} strokeWidth={1.8} />
        </Press>
      ) : null}
    </View>
  );
}

export function ChipRow({ items, active, onSelect, style }: { items: { key: string; label: string }[]; active: string; onSelect: (k: string) => void; style?: StyleProp<ViewStyle> }) {
  if (items.length <= 1) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={style} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
      {items.map((c) => {
        const on = c.key === active;
        return (
          <Press key={c.key} onPress={() => onSelect(c.key)} label={on ? `${c.label}, selected` : c.label} style={[k.chip, on ? k.chipOn : null]} scaleTo={0.96}>
            <Text style={[k.chipText, on ? { color: '#FFFFFF', fontWeight: W.title } : null]} numberOfLines={1}>{c.label}</Text>
          </Press>
        );
      })}
    </ScrollView>
  );
}

const TRUST_ICON: Record<TrustIcon, React.ComponentType<any>> = { house: IHouse, tag: ITag, cash: ICash, ruler: IRuler, clipboard: IClipboard };

/** Navy hero over a photo (photo on the right, text on the left), with up to three trust points along the bottom. */
export function HeroCard({ photo, title, line, trust, cta, onCta, photoPosition = 'center', style }: {
  photo: ImageSourcePropType; title: string; line: string; trust?: { icon: TrustIcon; text: string }[];
  cta?: string; onCta?: () => void; photoPosition?: 'center' | 'left' | 'right'; style?: StyleProp<ViewStyle>;
}) {
  const w = usePageW();
  const compact = w < 380;
  return (
    <View style={[k.hero, trust ? null : { minHeight: 148 }, shadow(2, TV.heroInk), style]}>
      <View style={k.heroPhoto}>
        <Image source={photo} style={StyleSheet.absoluteFill} contentFit="cover" contentPosition={photoPosition} accessibilityIgnoresInvertColors />
      </View>
      <LinearGradient colors={[TV.heroInk, TV.heroInk, 'rgba(16,21,74,0.62)', 'rgba(16,21,74,0.12)', 'rgba(16,21,74,0)']} locations={[0, 0.37, 0.52, 0.76, 0.9]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
      {trust ? <LinearGradient colors={['rgba(16,21,74,0)', 'rgba(16,21,74,0.9)']} locations={[0.45, 0.92]} style={StyleSheet.absoluteFill} /> : null}
      <View style={{ padding: 16, paddingBottom: trust ? 10 : 16, maxWidth: compact ? '66%' : '62%' }}>
        <Text style={[k.heroTitle, compact ? { fontSize: 18, lineHeight: 23 } : null]} accessibilityRole="header">{title}</Text>
        <Text style={k.heroLine} numberOfLines={3}>{line}</Text>
        {cta && onCta ? (
          <Press onPress={onCta} label={cta} style={k.heroCta} scaleTo={0.95}>
            <Text style={k.heroCtaText} numberOfLines={1}>{cta}</Text>
            <IChevronRight size={15} color={TV.accentDeep} strokeWidth={2} />
          </Press>
        ) : null}
      </View>
      {trust ? (
        <View style={k.trustRow}>
          {trust.map((t, i) => {
            const Icon = TRUST_ICON[t.icon];
            return (
              <View key={t.text} style={[k.trustItem, i > 0 ? k.trustSep : null]}>
                <View style={k.trustIcon}><Icon size={15} color="#FFFFFF" strokeWidth={1.7} /></View>
                <Text style={k.trustText} numberOfLines={2}>{t.text}</Text>
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

export function SectionHead({ title, link, onLink, style }: { title: string; link?: string; onLink?: () => void; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[k.secHead, style]}>
      <Text style={k.secTitle} accessibilityRole="header" numberOfLines={1}>{title}</Text>
      {link && onLink ? (
        <Press onPress={onLink} label={link} style={k.secLink} scaleTo={0.95}>
          <Text style={k.secLinkText}>{link}</Text>
          <IChevronRight size={14} color={TV.accent} strokeWidth={2} />
        </Press>
      ) : null}
    </View>
  );
}

export function BookPill({ label, onPress, a11y, muted }: { label: string; onPress: () => void; a11y: string; muted?: boolean }) {
  return (
    <Press onPress={onPress} label={a11y} style={[k.pill, muted ? k.pillMuted : shadow(1, TV.accent)]} scaleTo={0.94}>
      {muted ? null : <LinearGradient colors={[TV.go[0], TV.go[2]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />}
      <Text style={[k.pillText, muted ? { color: TV.sub } : null]} numberOfLines={1}>{label}</Text>
    </Press>
  );
}

export function Stepper({ qty, name, onMinus, onPlus, atMax }: { qty: number; name: string; onMinus: () => void; onPlus: () => void; atMax?: boolean }) {
  return (
    <View style={k.stepper}>
      <Press onPress={onMinus} label={`Remove one ${name}`} style={k.stepBtn} scaleTo={0.9}><IMinus size={16} color="#FFFFFF" strokeWidth={2} /></Press>
      <Text style={k.stepQty} accessibilityLabel={`${qty} in basket`}>{qty}</Text>
      <Press onPress={atMax ? undefined : onPlus} disabled={atMax} label={`Add one more ${name}`} style={[k.stepBtn, atMax ? { opacity: 0.4 } : null]} scaleTo={0.9}><IPlus size={16} color="#FFFFFF" strokeWidth={2} /></Press>
    </View>
  );
}

export function BasketBar({ count, total, onPress }: { count: number; total: number; onPress: () => void }) {
  const insets = useSafeAreaInsets();
  if (count <= 0) return null;
  return (
    <View style={[k.basketWrap, { bottom: 12 + insets.bottom }]} pointerEvents="box-none">
      <Press onPress={onPress} label={`${plural(count, 'item')} in the campus store basket, ${formatINR(total)}. View basket.`} style={[k.basket, shadow(3, TV.heroInk)]} scaleTo={0.98}>
        <LinearGradient colors={[TV.header[1], TV.header[2]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        <View style={k.basketIcon}><IBag size={18} color="#FFFFFF" strokeWidth={1.7} /></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={k.basketCount} numberOfLines={1}>{plural(count, 'item')} · Campus store</Text>
          <Text style={k.basketTotal}>{formatINR(total)}</Text>
        </View>
        <View style={k.basketGo}><Text style={k.basketGoText}>View basket</Text><IChevronRight size={15} color={TV.accentDeep} strokeWidth={2} /></View>
      </Press>
    </View>
  );
}

type StateKind = 'empty' | 'offline' | 'error' | 'waking' | 'search';
export function StateBlock({ kind, title, body, action, onAction, icon: IconOverride, style }: { kind: StateKind; title?: string; body?: string; action?: string; onAction?: () => void; icon?: React.ComponentType<any>; style?: StyleProp<ViewStyle> }) {
  const Icon = IconOverride || (kind === 'offline' ? IWifiOff : kind === 'error' ? ICloudOff : kind === 'waking' ? IClock : ISearch);
  const t = title || (kind === 'offline' ? 'You are offline' : kind === 'error' ? 'Could not load this list' : kind === 'waking' ? 'Waking the server up' : 'Nothing here yet');
  const b = body || (kind === 'offline' ? 'Check your internet connection and try again.' : kind === 'error' ? 'The server is busy. Try again in a moment.' : kind === 'waking' ? 'This takes a few seconds the first time. Try again in a moment.' : '');
  return (
    <FadeIn style={[k.state, shadow(1), style]}>
      <View style={k.statePlate}><Icon size={24} color={TV.accent} strokeWidth={1.6} /></View>
      <Text style={k.stateTitle}>{t}</Text>
      {b ? <Text style={k.stateBody}>{b}</Text> : null}
      {action && onAction ? (
        <Press onPress={onAction} label={action} style={k.stateBtn}><Text style={k.stateBtnText}>{action}</Text></Press>
      ) : null}
    </FadeIn>
  );
}

/** Still placeholder rows while a list loads (no pulse: the owner wants nothing that loops). */
export function SkeletonRows({ count = 4 }: { count?: number }) {
  return (
    <View style={{ paddingHorizontal: 16, gap: 10 }} accessibilityLabel="Loading" accessibilityState={{ busy: true }}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={[k.skel, shadow(1)]}>
          <View style={[k.skelBlock, { width: 84, height: 72, borderRadius: 12 }]} />
          <View style={{ flex: 1, gap: 8 }}>
            <View style={[k.skelBlock, { width: '72%', height: 13 }]} />
            <View style={[k.skelBlock, { width: '48%', height: 11 }]} />
            <View style={[k.skelBlock, { width: '30%', height: 13, backgroundColor: TV.accentSoft }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

export const k = StyleSheet.create({
  barRow: { flexDirection: 'row', alignItems: 'center', paddingLeft: 6, paddingRight: 8, minHeight: 48 },
  barBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  barTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: W.title, letterSpacing: -0.1 },
  barSub: { color: TV.onDarkSub, fontSize: 12, marginTop: 1 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 9, height: 46, borderRadius: 23, backgroundColor: '#FFFFFF', paddingLeft: 15, paddingRight: 4, marginHorizontal: 16 },
  searchInput: { flex: 1, fontSize: 14.5, color: TV.ink, paddingVertical: 8, minWidth: 0 },
  searchClear: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  chip: { height: 36, paddingHorizontal: 16, borderRadius: RADIUS.pill, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: TV.line, alignItems: 'center', justifyContent: 'center' },
  chipOn: { backgroundColor: TV.accent, borderColor: TV.accent },
  chipText: { fontSize: 13, color: TV.ink2, fontWeight: W.label },
  hero: { marginHorizontal: 16, borderRadius: RADIUS.xl, overflow: 'hidden', backgroundColor: TV.heroInk, minHeight: 168 },
  heroPhoto: { position: 'absolute', top: 0, bottom: 0, right: 0, width: '64%' },
  heroTitle: { color: '#FFFFFF', fontSize: 19.5, lineHeight: 24, fontWeight: W.title, letterSpacing: -0.2 },
  heroLine: { color: TV.onDarkSub, fontSize: 12.5, lineHeight: 17.5, marginTop: 6 },
  heroCta: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', marginTop: 12, height: 36, paddingHorizontal: 14, borderRadius: 18, backgroundColor: '#FFFFFF' },
  heroCtaText: { color: TV.accentDeep, fontSize: 13, fontWeight: W.title },
  trustRow: { flexDirection: 'row', marginTop: 'auto', paddingHorizontal: 8, paddingBottom: 12, paddingTop: 4 },
  trustItem: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 5 },
  trustSep: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: 'rgba(255,255,255,0.28)' },
  trustIcon: { width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.14)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center' },
  trustText: { flex: 1, color: '#FFFFFF', fontSize: 11, lineHeight: 14, fontWeight: W.label },
  secHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 10 },
  secTitle: { flex: 1, fontSize: 17, fontWeight: W.title, color: TV.ink, letterSpacing: -0.2 },
  secLink: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 36, paddingLeft: 8 },
  secLinkText: { fontSize: 13, color: TV.accent, fontWeight: W.label },
  pill: { height: 34, minWidth: 72, paddingHorizontal: 14, borderRadius: 17, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  pillMuted: { backgroundColor: TV.lineSoft, borderWidth: 1, borderColor: TV.line },
  pillText: { color: '#FFFFFF', fontSize: 13, fontWeight: W.title },
  stepper: { flexDirection: 'row', alignItems: 'center', height: 34, borderRadius: 17, backgroundColor: TV.accent },
  stepBtn: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  stepQty: { color: '#FFFFFF', fontSize: 14, fontWeight: W.title, minWidth: 16, textAlign: 'center' },
  basketWrap: { position: 'absolute', left: 16, right: 16 },
  basket: { minHeight: 62, borderRadius: 18, overflow: 'hidden', flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10 },
  basketIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  basketCount: { color: TV.onDarkSub, fontSize: 12 },
  basketTotal: { color: '#FFFFFF', fontSize: 16, fontWeight: W.title, marginTop: 1 },
  basketGo: { flexDirection: 'row', alignItems: 'center', gap: 3, height: 36, paddingHorizontal: 12, borderRadius: 18, backgroundColor: '#FFFFFF' },
  basketGoText: { color: TV.accentDeep, fontSize: 13, fontWeight: W.title },
  state: { marginHorizontal: 16, padding: 22, borderRadius: RADIUS.lg, backgroundColor: '#FFFFFF', alignItems: 'center' },
  statePlate: { width: 56, height: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: 12, backgroundColor: TV.accentSoft },
  stateTitle: { fontSize: 16, fontWeight: W.title, color: TV.ink, textAlign: 'center' },
  stateBody: { fontSize: 13, color: TV.sub, textAlign: 'center', marginTop: 6, lineHeight: 19 },
  stateBtn: { marginTop: 14, paddingHorizontal: 18, height: 40, borderRadius: 12, backgroundColor: TV.accentSoft, alignItems: 'center', justifyContent: 'center' },
  stateBtnText: { fontSize: 13.5, color: TV.accent, fontWeight: W.label },
  skel: { flexDirection: 'row', gap: 12, padding: 12, borderRadius: RADIUS.lg, backgroundColor: '#FFFFFF', alignItems: 'center' },
  skelBlock: { borderRadius: 6, backgroundColor: TV.lineSoft },
});
