/**
 * Shared pieces for Co-Ride v2: pressable, screen header, section title, pills, chips, buttons, segmented
 * control, avatar, seat dots, cards and the bottom sheet. Thin line icons, hairlines, light weights.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Modal, ScrollView, useWindowDimensions, type StyleProp, type ViewStyle, type TextStyle } from 'react-native';
import { Image } from 'expo-image';
import type { LucideIcon } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CR, R, GUTTER, W, shadow, toneColors, type Tone } from './coRideV2Theme';
import { IArrowLeft, IArrowRight, IX, STROKE, ICON } from './CoRideV2Icons';
import { initialOf } from '../../modules/coride/coRideFormat';
import { pressRole } from '../../utils/pressRole';

export function Tap({ children, onPress, style, label, disabled, role = 'button', selected, hitSlop }: {
  children: React.ReactNode; onPress?: () => void; style?: StyleProp<ViewStyle>; label?: string; disabled?: boolean;
  role?: 'button' | 'tab' | 'link'; selected?: boolean; hitSlop?: number;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || !onPress}
      accessibilityRole={pressRole(role)}
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, selected }}
      hitSlop={hitSlop}
      style={({ pressed }) => [{ opacity: disabled ? 0.45 : pressed ? 0.72 : 1 }, style]}
    >
      {children}
    </Pressable>
  );
}

export function ScreenHeader({ title, sub, onBack, right }: { title: string; sub?: string; onBack?: () => void; right?: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[k.header, { paddingTop: insets.top + 4 }]}>
      {onBack ? <Tap onPress={onBack} label="Back" style={k.headerBtn}><IArrowLeft size={22} color={CR.ink} strokeWidth={STROKE} /></Tap> : null}
      <View style={{ flex: 1, minWidth: 0, paddingLeft: onBack ? 2 : 6 }}>
        <Text style={k.headerTitle} numberOfLines={1} accessibilityRole="header">{title}</Text>
        {sub ? <Text style={k.headerSub} numberOfLines={1}>{sub}</Text> : null}
      </View>
      {right ? <View style={k.row}>{right}</View> : null}
    </View>
  );
}

export function SectionTitle({ title, action, onAction, style }: { title: string; action?: string; onAction?: () => void; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[k.sectionRow, style]}>
      <Text style={k.sectionTitle} accessibilityRole="header">{title}</Text>
      {action && onAction ? (
        <Tap onPress={onAction} label={action} role="link" style={k.sectionLink}>
          <Text style={k.sectionAction}>{action}</Text>
          <IArrowRight size={15} color={CR.primary} strokeWidth={STROKE} />
        </Tap>
      ) : null}
    </View>
  );
}

export function Pill({ text, tone = 'neutral', icon: Icon, style }: { text: string; tone?: Tone; icon?: LucideIcon; style?: StyleProp<ViewStyle> }) {
  const c = toneColors(tone);
  return (
    <View style={[k.pill, { backgroundColor: c.bg }, style]}>
      {Icon ? <Icon size={13} color={c.fg} strokeWidth={1.8} /> : null}
      <Text style={[k.pillText, { color: c.fg }]} numberOfLines={1}>{text}</Text>
    </View>
  );
}

export function Chip({ label, on, onPress, icon: Icon }: { label: string; on: boolean; onPress: () => void; icon?: LucideIcon }) {
  return (
    <Tap onPress={onPress} label={label} role="tab" selected={on} style={[k.chip, on ? k.chipOn : null]}>
      {Icon ? <Icon size={15} color={on ? '#FFFFFF' : CR.ink2} strokeWidth={STROKE} /> : null}
      <Text style={[k.chipText, { color: on ? '#FFFFFF' : CR.ink2 }]}>{label}</Text>
    </Tap>
  );
}

export function PrimaryButton({ label, onPress, icon: Icon, busy, disabled, style, small }: {
  label: string; onPress: () => void; icon?: LucideIcon; busy?: boolean; disabled?: boolean; style?: StyleProp<ViewStyle>; small?: boolean;
}) {
  return (
    <Tap onPress={onPress} label={label} disabled={disabled || busy} style={[k.primary, small && k.small, style]}>
      {busy ? <ActivityIndicator color="#FFFFFF" /> : (
        <>
          {Icon ? <Icon size={small ? 16 : 18} color="#FFFFFF" strokeWidth={STROKE} /> : null}
          <Text style={[k.primaryText, small && { fontSize: 14 }]} numberOfLines={1}>{label}</Text>
        </>
      )}
    </Tap>
  );
}

export function OutlineButton({ label, onPress, icon: Icon, color = CR.primary, style, small, textStyle, disabled }: {
  label: string; onPress: () => void; icon?: LucideIcon; color?: string; style?: StyleProp<ViewStyle>; small?: boolean; textStyle?: StyleProp<TextStyle>; disabled?: boolean;
}) {
  return (
    <Tap onPress={onPress} label={label} disabled={disabled} style={[k.outline, small && k.small, style]}>
      {Icon ? <Icon size={small ? 16 : 17} color={color} strokeWidth={STROKE} /> : null}
      <Text style={[k.outlineText, { color }, small && { fontSize: 14 }, textStyle]} numberOfLines={1}>{label}</Text>
    </Tap>
  );
}

/** White track, the chosen option filled blue (reference: Find a lift / Give a lift / My rides). */
export function Segmented<T extends string>({ options, value, onChange, style, compact }: {
  options: { key: T; label: string; icon?: LucideIcon }[]; value: T; onChange: (k: T) => void; style?: StyleProp<ViewStyle>; compact?: boolean;
}) {
  return (
    <View style={[k.seg, shadow(1), style]} accessibilityRole="tablist">
      {options.map((o, i) => {
        const on = o.key === value;
        const Icon = o.icon;
        return (
          <React.Fragment key={o.key}>
            {i > 0 && !on && options[i - 1].key !== value ? <View style={k.segDivider} /> : null}
            <Tap onPress={() => onChange(o.key)} role="tab" selected={on} label={o.label} style={[k.segItem, compact && { height: 38 }, on && k.segOn]}>
              {Icon ? <Icon size={18} color={on ? '#FFFFFF' : CR.ink2} strokeWidth={STROKE} /> : null}
              <Text style={[k.segText, { color: on ? '#FFFFFF' : CR.ink2 }]} numberOfLines={1}>{o.label}</Text>
            </Tap>
          </React.Fragment>
        );
      })}
    </View>
  );
}

export function Avatar({ name, image, size = 36, ring }: { name?: string; image?: string | null; size?: number; ring?: boolean }) {
  const uri = typeof image === 'string' && /^https?:/.test(image) ? image : null;
  return (
    <View style={[k.avatar, { width: size, height: size, borderRadius: size / 2 }, ring && k.avatarRing]}>
      <Text style={[k.avatarText, { fontSize: size * 0.4 }]}>{initialOf(name)}</Text>
      {uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" accessibilityLabel={name || 'Student'} /> : null}
    </View>
  );
}

/** Open seats as small seat dots (filled = taken, ring = open). Only the counts the server gives. */
export function SeatDots({ open, taken = 0, size = 10 }: { open: number; taken?: number; size?: number }) {
  const total = Math.min(6, open + taken);
  return (
    <View style={k.row} accessibilityLabel={`${open} seat${open === 1 ? '' : 's'} open`}>
      {Array.from({ length: total }).map((_, i) => (
        <View key={i} style={[{ width: size, height: size, borderRadius: size / 2, marginRight: 4 }, i < taken ? { backgroundColor: CR.faint } : { borderWidth: 1.5, borderColor: CR.green, backgroundColor: CR.greenSoft }]} />
      ))}
    </View>
  );
}

export function Card({ children, style, onPress, label }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; label?: string }) {
  if (onPress) return <Tap onPress={onPress} label={label} style={[k.card, style]}>{children}</Tap>;
  return <View style={[k.card, style]}>{children}</View>;
}

/** Round icon button (header heart / bell, card arrows). */
export function IconBtn({ icon: Icon, onPress, label, color = CR.ink, bg, size = 40, dot }: { icon: LucideIcon; onPress?: () => void; label: string; color?: string; bg?: string; size?: number; dot?: boolean }) {
  return (
    <Tap onPress={onPress} label={label} style={[k.iconBtn, { width: size, height: size, borderRadius: size / 2, backgroundColor: bg || 'transparent' }]}>
      <Icon size={ICON + 1} color={color} strokeWidth={STROKE} />
      {dot ? <View style={k.dot} /> : null}
    </Tap>
  );
}

export function Sheet({ visible, onClose, title, children, footer }: { visible: boolean; onClose: () => void; title?: string; children: React.ReactNode; footer?: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={k.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View style={[k.sheet, { paddingBottom: insets.bottom + 12 }]}>
          <View style={k.grabber} />
          {title ? (
            <View style={k.sheetHead}>
              <Text style={k.sheetTitle} accessibilityRole="header">{title}</Text>
              <Tap onPress={onClose} label="Close" style={k.sheetClose}><IX size={20} color={CR.ink2} strokeWidth={STROKE} /></Tap>
            </View>
          ) : null}
          <ScrollView style={{ maxHeight: Math.max(240, Math.round(height * 0.92) - (title ? 64 : 24) - (footer ? 96 : 0) - insets.bottom - insets.top) }} contentContainerStyle={{ paddingHorizontal: GUTTER + 4, paddingBottom: 8 }} showsVerticalScrollIndicator={false}>
            {children}
          </ScrollView>
          {footer ? <View style={{ paddingHorizontal: GUTTER + 4, paddingTop: 8 }}>{footer}</View> : null}
        </View>
      </View>
    </Modal>
  );
}

export const k = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: GUTTER - 6, paddingBottom: 6, minHeight: 56, backgroundColor: CR.page },
  headerBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: W.title, color: CR.ink, letterSpacing: -0.2 },
  headerSub: { fontSize: 12.5, color: CR.muted, marginTop: 1 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  sectionTitle: { fontSize: 17, fontWeight: W.title, color: CR.ink, letterSpacing: -0.2 },
  sectionLink: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32 },
  sectionAction: { fontSize: 13.5, fontWeight: W.label, color: CR.primary },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 4, borderRadius: R.pill },
  pillText: { fontSize: 12, fontWeight: W.label },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 14, borderRadius: R.pill, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: CR.line, backgroundColor: CR.card },
  chipOn: { backgroundColor: CR.primary, borderColor: CR.primary },
  chipText: { fontSize: 13.5, fontWeight: W.label },
  primary: { height: 52, borderRadius: R.lg, backgroundColor: CR.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, paddingHorizontal: 18 },
  small: { height: 40, borderRadius: 12, paddingHorizontal: 14 },
  primaryText: { color: '#FFFFFF', fontSize: 15.5, fontWeight: W.label },
  outline: { height: 50, borderRadius: R.lg, borderWidth: 1.2, borderColor: CR.tint2, backgroundColor: CR.card, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 16 },
  outlineText: { fontSize: 15, fontWeight: W.label },
  seg: { flexDirection: 'row', alignItems: 'center', backgroundColor: CR.card, borderRadius: R.lg, padding: 4 },
  segItem: { flex: 1, height: 44, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 6 },
  segOn: { backgroundColor: CR.primary },
  segText: { fontSize: 14, fontWeight: W.label },
  segDivider: { width: StyleSheet.hairlineWidth * 2, height: 20, backgroundColor: CR.line },
  avatar: { backgroundColor: CR.tint, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarRing: { borderWidth: 2, borderColor: '#FFFFFF' },
  avatarText: { color: CR.tintInk, fontWeight: W.label },
  card: { backgroundColor: CR.card, borderRadius: R.lg, ...shadow(1) },
  iconBtn: { alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', top: 9, right: 10, width: 7, height: 7, borderRadius: 4, backgroundColor: '#E5484D', borderWidth: 1.5, borderColor: '#FFFFFF' },
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(11,26,74,0.38)' },
  sheet: { backgroundColor: CR.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 8, maxHeight: '92%' },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: CR.line, marginBottom: 6 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', paddingLeft: GUTTER + 4, paddingRight: GUTTER - 4, paddingVertical: 6 },
  sheetTitle: { flex: 1, fontSize: 18, fontWeight: W.title, color: CR.ink, letterSpacing: -0.2 },
  sheetClose: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  body: { fontSize: 13.5, color: CR.ink2, lineHeight: 20 },
  small2: { fontSize: 12, color: CR.muted },
});
