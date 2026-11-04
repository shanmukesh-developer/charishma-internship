/**
 * Shared pieces for PG v2: header, photo, chips, pills, badges, rating line, buttons,
 * segmented control, icon tiles, section titles and calm empty / loading states.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, type StyleProp, type ViewStyle, type TextStyle } from 'react-native';
import { Image } from 'expo-image';
import type { LucideIcon } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PG2, R, GUTTER, W, shadow, genderTone, type GenderKey } from './pgV2Theme';
import { IArrowLeft, IBadgeCheck, IStar, IBuilding, STROKE } from './PgV2Icons';
import type { V2Photo } from './pgV2Photos';
import { ratingText, type ReviewSummary } from '../../modules/pg/pgApi';
import { pressRole } from '../../utils/pressRole';
import { themedSheet } from '../../utils/themeNow';

/** Pressable with a quiet pressed state and a 44 px minimum target. */
export function Tap({ children, onPress, style, label, disabled, role = 'button', selected }: {
  children: React.ReactNode; onPress?: () => void; style?: StyleProp<ViewStyle>; label?: string; disabled?: boolean;
  role?: 'button' | 'tab' | 'link'; selected?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || !onPress}
      accessibilityRole={pressRole(role)}
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, selected }}
      style={({ pressed }) => [{ opacity: disabled ? 0.45 : pressed ? 0.72 : 1 }, style]}
    >
      {children}
    </Pressable>
  );
}

export function Header({ title, onBack, right }: { title: string; onBack?: () => void; right?: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[k.header, { paddingTop: insets.top }]}>
      {onBack ? (
        <Tap onPress={onBack} label="Back" style={k.headerBtn}><IArrowLeft size={22} color={PG2.ink} strokeWidth={STROKE} /></Tap>
      ) : null}
      <Text style={k.headerTitle} numberOfLines={1} accessibilityRole="header">{title}</Text>
      {right ? <View style={k.headerRight}>{right}</View> : null}
    </View>
  );
}

/** Round white button over photos (back / share / save). */
export function FloatBtn({ icon: Icon, onPress, label, color = PG2.ink, fill }: { icon: LucideIcon; onPress?: () => void; label: string; color?: string; fill?: string }) {
  return (
    <Tap onPress={onPress} label={label} style={[k.floatBtn, shadow(1)]}>
      <Icon size={18} color={color} strokeWidth={STROKE} fill={fill || 'transparent'} />
    </Tap>
  );
}

export function Photo({ photo, style, radius = R.md, priority }: { photo: V2Photo | null | undefined; style: StyleProp<ViewStyle>; radius?: number; priority?: 'low' | 'normal' | 'high' }) {
  return (
    <View style={[{ backgroundColor: PG2.lavender, borderRadius: radius, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }, style]}>
      {!photo || !photo.isRepresentativePhoto ? <IBuilding size={22} color={PG2.faint} strokeWidth={STROKE} /> : null}
      {photo ? (
        <Image source={photo.source as any} style={StyleSheet.absoluteFill} contentFit="cover" transition={photo.isRepresentativePhoto ? 0 : 160} cachePolicy="memory-disk" priority={priority} accessibilityLabel={photo.caption || undefined} />
      ) : null}
    </View>
  );
}

export function Chip({ label, on, onPress, icon: Icon, tone, outline }: {
  label: string; on: boolean; onPress: () => void; icon?: LucideIcon; tone?: { ink: string; soft: string; icon: string }; outline?: boolean;
}) {
  const ink = on ? (outline ? PG2.primary : '#FFFFFF') : tone ? tone.ink : PG2.ink2;
  const bg = on ? (outline ? PG2.card : PG2.primary) : tone ? tone.soft : PG2.card;
  return (
    <Tap onPress={onPress} label={label} role="tab" selected={on}
      style={[k.chip, { backgroundColor: bg, borderColor: on ? PG2.primary : tone ? 'transparent' : PG2.line }, outline && on && { borderWidth: 1.25 }]}>
      {Icon ? <Icon size={15} color={on ? ink : tone ? tone.icon : PG2.primary} strokeWidth={STROKE} /> : null}
      <Text style={[k.chipText, { color: ink }]}>{label}</Text>
    </Tap>
  );
}

export function GenderPill({ g, style }: { g: GenderKey; style?: StyleProp<ViewStyle> }) {
  const t = genderTone(g);
  return (
    <View style={[k.pill, { backgroundColor: t.soft }, style]}>
      <Text style={[k.pillText, { color: t.ink }]}>{g} PG</Text>
    </View>
  );
}

export function Pill({ text, ink, soft, icon: Icon, style }: { text: string; ink: string; soft: string; icon?: LucideIcon; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[k.pill, { backgroundColor: soft, flexDirection: 'row', alignItems: 'center', gap: 5 }, style]}>
      {Icon ? <Icon size={13} color={ink} strokeWidth={2} /> : null}
      <Text style={[k.pillText, { color: ink }]}>{text}</Text>
    </View>
  );
}

/** Blue "Verified" badge; only rendered for PGs the housing team verified. */
export function Verified({ small }: { small?: boolean }) {
  return (
    <View style={[k.verified, small && { paddingVertical: 2, paddingHorizontal: 6 }]} accessibilityLabel="Verified by ZENV">
      <IBadgeCheck size={small ? 11 : 13} color="#FFFFFF" strokeWidth={2} />
      <Text style={[k.verifiedText, small && { fontSize: 10 }]}>Verified</Text>
    </View>
  );
}

/** "4.5 (32 reviews)". Nothing when the PG has no reviews (never a made-up rating). */
export function Rating({ summary, size = 13, short }: { summary?: ReviewSummary | null; size?: number; short?: boolean }) {
  if (!summary || !summary.count || summary.average === null) return null;
  return (
    <View style={k.row} accessibilityLabel={`Rated ${ratingText(summary.average)} from ${summary.count} reviews`}>
      <IStar size={size + 1} color={PG2.star} fill={PG2.star} strokeWidth={1.5} />
      <Text style={[k.ratingNum, { fontSize: size }]}>{ratingText(summary.average)}</Text>
      <Text style={[k.ratingCount, { fontSize: size - 1 }]}>{short ? `(${summary.count})` : `(${summary.count} review${summary.count === 1 ? '' : 's'})`}</Text>
    </View>
  );
}

export function PrimaryButton({ label, onPress, icon: Icon, trailing: Trail, busy, disabled, style }: {
  label: string; onPress: () => void; icon?: LucideIcon; trailing?: LucideIcon; busy?: boolean; disabled?: boolean; style?: StyleProp<ViewStyle>;
}) {
  return (
    <Tap onPress={onPress} label={label} disabled={disabled || busy} style={[k.primary, style]}>
      {busy ? <ActivityIndicator color="#FFFFFF" /> : (
        <>
          {Icon ? <Icon size={18} color="#FFFFFF" strokeWidth={STROKE} /> : null}
          <Text style={k.primaryText}>{label}</Text>
          {Trail ? <View style={k.primaryTrail}><Trail size={18} color="#FFFFFF" strokeWidth={STROKE} /></View> : null}
        </>
      )}
    </Tap>
  );
}

export function OutlineButton({ label, onPress, icon: Icon, color = PG2.primary, border = PG2.lavender2, style, textStyle }: {
  label: string; onPress: () => void; icon?: LucideIcon; color?: string; border?: string; style?: StyleProp<ViewStyle>; textStyle?: StyleProp<TextStyle>;
}) {
  return (
    <Tap onPress={onPress} label={label} style={[k.outline, { borderColor: border }, style]}>
      {Icon ? <Icon size={17} color={color} strokeWidth={STROKE} /> : null}
      <Text style={[k.outlineText, { color }, textStyle]}>{label}</Text>
    </Tap>
  );
}

/** Two-or-more option control; `variant="underline"` is the My Bookings style. */
export function Segmented<T extends string>({ options, value, onChange, variant = 'fill' }: {
  options: { key: T; label: string }[]; value: T; onChange: (k: T) => void; variant?: 'fill' | 'soft' | 'underline';
}) {
  return (
    <View style={[k.seg, variant === 'underline' && { padding: 0, gap: 0 }]} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.key === value;
        const fill = variant === 'fill' ? PG2.primary : variant === 'soft' ? '#8A6CF6' : 'transparent';
        return (
          <Tap key={o.key} onPress={() => onChange(o.key)} role="tab" selected={on} label={o.label}
            style={[k.segItem, on && variant !== 'underline' && { backgroundColor: fill }, variant === 'underline' && { borderRadius: 0 }]}>
            <Text style={[k.segText, { color: on ? (variant === 'underline' ? PG2.primary : '#FFFFFF') : PG2.ink2 }, on && { fontWeight: W.label }]}>{o.label}</Text>
            {variant === 'underline' && on ? <View style={k.segLine} /> : null}
          </Tap>
        );
      })}
    </View>
  );
}

/** Lavender circle with a line icon and a label underneath (amenity grids). */
export function IconTile({ icon: Icon, label, width, size = 52 }: { icon: LucideIcon; label: string; width: number; size?: number }) {
  return (
    <View style={{ width, alignItems: 'center' }} accessible accessibilityLabel={label}>
      <View style={[k.iconCircle, { width: size, height: size, borderRadius: size / 2 }]}>
        <Icon size={Math.round(size * 0.42)} color={PG2.ink} strokeWidth={STROKE} />
      </View>
      <Text style={k.iconLabel} numberOfLines={2}>{label}</Text>
    </View>
  );
}

export function SectionTitle({ title, action, onAction, style }: { title: string; action?: string; onAction?: () => void; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[k.sectionRow, style]}>
      <Text style={k.sectionTitle} accessibilityRole="header">{title}</Text>
      {action && onAction ? <Tap onPress={onAction} label={action} role="link" style={{ minHeight: 32, justifyContent: 'center' }}><Text style={k.sectionAction}>{action}</Text></Tap> : null}
    </View>
  );
}

export function EmptyState({ icon: Icon, title, body, action, onAction }: { icon: LucideIcon; title: string; body?: string; action?: string; onAction?: () => void }) {
  return (
    <View style={k.empty}>
      <View style={k.emptyIcon}><Icon size={24} color="#475569" strokeWidth={1.6} /></View>
      <Text style={k.emptyTitle}>{title}</Text>
      {body ? <Text style={k.emptyBody}>{body}</Text> : null}
      {action && onAction ? <OutlineButton label={action} onPress={onAction} style={{ marginTop: 16, paddingHorizontal: 22 }} /> : null}
    </View>
  );
}

export function Loading() {
  return <View style={{ paddingVertical: 60, alignItems: 'center' }}><ActivityIndicator color={PG2.primary} /></View>;
}

export const k = themedSheet(() => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: GUTTER - 4, minHeight: 56, gap: 6, backgroundColor: PG2.page },
  headerBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: W.title, color: PG2.ink, letterSpacing: -0.2, paddingLeft: 4 },
  headerRight: { flexDirection: 'row', alignItems: 'center' },
  floatBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: PG2.card, alignItems: 'center', justifyContent: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 38, paddingHorizontal: 16, borderRadius: R.pill, borderWidth: 1 },
  chipText: { fontSize: 13.5, fontWeight: W.label },
  pill: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  pillText: { fontSize: 11.5, fontWeight: W.label },
  verified: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: PG2.verified, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, alignSelf: 'flex-start' },
  verifiedText: { color: '#FFFFFF', fontSize: 11, fontWeight: W.label },
  ratingNum: { color: PG2.ink2, fontWeight: W.label, marginLeft: 2 },
  ratingCount: { color: PG2.muted },
  primary: { height: 54, borderRadius: R.lg, backgroundColor: PG2.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 20 },
  primaryText: { color: '#FFFFFF', fontSize: 15.5, fontWeight: W.label, letterSpacing: 0.1 },
  primaryTrail: { position: 'absolute', right: 20 },
  outline: { height: 50, borderRadius: R.lg, borderWidth: 1.25, backgroundColor: PG2.card, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  outlineText: { fontSize: 15, fontWeight: W.label },
  seg: { flexDirection: 'row', backgroundColor: PG2.lavender, borderRadius: R.md, padding: 4, gap: 4 },
  segItem: { flex: 1, height: 40, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  segText: { fontSize: 14, fontWeight: W.body },
  segLine: { position: 'absolute', left: 8, right: 8, bottom: 0, height: 2.5, borderRadius: 2, backgroundColor: PG2.primary },
  iconCircle: { backgroundColor: PG2.lavender, alignItems: 'center', justifyContent: 'center' },
  iconLabel: { marginTop: 8, fontSize: 12, color: PG2.ink2, textAlign: 'center', lineHeight: 16 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sectionTitle: { fontSize: 16.5, fontWeight: W.title, color: PG2.ink, letterSpacing: -0.2 },
  sectionAction: { fontSize: 13.5, fontWeight: W.label, color: PG2.primary },
  empty: { alignItems: 'center', paddingVertical: 40, paddingHorizontal: 28 },
  emptyIcon: { width: 56, height: 56, borderRadius: 28, borderWidth: StyleSheet.hairlineWidth, borderColor: PG2.line, backgroundColor: PG2.card, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  emptyTitle: { fontSize: 16, fontWeight: W.title, color: PG2.ink, textAlign: 'center' },
  emptyBody: { marginTop: 6, fontSize: 13.5, color: PG2.muted, textAlign: 'center', lineHeight: 20 },
  card: { backgroundColor: PG2.card, borderRadius: R.lg, ...shadow(1) },
  body: { fontSize: 13.5, color: PG2.ink2, lineHeight: 20 },
  small: { fontSize: 12, color: PG2.muted },
}));
