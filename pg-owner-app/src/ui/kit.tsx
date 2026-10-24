// Shared building blocks: buttons, chips, badges, cards, sheets, steppers, segmented tabs, empty / error states,
// skeletons. Indigo theme (src/theme.ts); 44 px+ touch targets.
import React from 'react';
import {
  ActivityIndicator, Modal, Pressable, StyleProp, StyleSheet, Text, View, ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, font, radius, shadow, space, touch } from '../theme';
import { KeyboardAvoidingView } from './KeyboardAvoidingView';

export type IconName = keyof typeof Ionicons.glyphMap;
type Variant = 'primary' | 'secondary' | 'success' | 'danger' | 'dangerOutline' | 'ghost';

const VARIANTS: Record<Variant, { bg: string; fg: string; border?: string }> = {
  primary: { bg: color.primary, fg: color.textInverse },
  secondary: { bg: color.surface, fg: color.text, border: color.borderStrong },
  success: { bg: color.ok, fg: color.textInverse },
  danger: { bg: color.alert, fg: color.textInverse },
  dangerOutline: { bg: color.surface, fg: color.alertDark, border: color.alert },
  ghost: { bg: 'transparent', fg: color.primary },
};

export function Button({
  label, onPress, variant = 'primary', size = 'primary', loading, disabled, icon, style, a11y,
}: {
  label: string;
  onPress: () => void;
  variant?: Variant;
  size?: 'primary' | 'secondary';
  loading?: boolean;
  disabled?: boolean;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
  a11y?: string;
}) {
  const v = VARIANTS[variant];
  const off = disabled || loading;
  const minHeight = size === 'primary' ? touch.primary : touch.secondary;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={a11y || label}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      style={({ pressed }) => [
        styles.btn,
        { minHeight, backgroundColor: v.bg },
        v.border ? { borderWidth: 1.5, borderColor: v.border } : null,
        off && !loading ? { opacity: 0.45 } : null,
        pressed && !off ? { opacity: 0.85, transform: [{ scale: 0.99 }] } : null,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={v.fg} />
      ) : (
        <View style={styles.btnRow}>
          {icon ? <Ionicons name={icon} size={size === 'secondary' ? 18 : 20} color={v.fg} /> : null}
          <Text style={[font.button, { color: v.fg }, size === 'secondary' && { fontSize: 15 }]} numberOfLines={1} adjustsFontSizeToFit>
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

export function IconButton({
  icon, onPress, label, tint = color.text, bg = color.surfaceAlt, size = touch.icon, disabled,
}: {
  icon: IconName; onPress: () => void; label: string; tint?: string; bg?: string; size?: number; disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      hitSlop={6}
      style={({ pressed }) => [{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }, disabled && { opacity: 0.35 }, pressed && { opacity: 0.7 }]}
    >
      <Ionicons name={icon} size={20} color={tint} />
    </Pressable>
  );
}

/** Selectable pill (filters, categories, meal tags). */
export function Chip({ label, selected, onPress, icon, tone = 'primary', style }: {
  label: string; selected: boolean; onPress: () => void; icon?: IconName; tone?: 'primary' | 'veg' | 'nonveg' | 'egg'; style?: StyleProp<ViewStyle>;
}) {
  const sel = tone === 'veg' ? color.veg : tone === 'nonveg' ? color.nonveg : tone === 'egg' ? color.egg : color.primary;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      style={({ pressed }) => [styles.chip, selected ? { backgroundColor: sel, borderColor: sel } : null, pressed ? { opacity: 0.8 } : null, style]}
    >
      {icon ? <Ionicons name={icon} size={15} color={selected ? color.textInverse : color.textSecondary} /> : null}
      <Text style={[font.small, { fontWeight: '700', color: selected ? color.textInverse : color.textSecondary }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

export function Badge({ text, fg, bg, icon }: { text: string; fg: string; bg: string; icon?: IconName }) {
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      {icon ? <Ionicons name={icon} size={13} color={fg} /> : null}
      <Text style={[font.label, { color: fg }]} numberOfLines={1}>{text}</Text>
    </View>
  );
}

/** Small round count (bottom tabs, menu rows). */
export function CountDot({ n }: { n: number }) {
  if (!n) return null;
  return (
    <View style={styles.count} accessibilityLabel={`${n} new`}>
      <Text style={[font.label, { color: color.textInverse, fontSize: 11 }]}>{n > 99 ? '99+' : n}</Text>
    </View>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function EmptyState({ icon, title, body, action }: {
  icon: IconName; title: string; body?: string; action?: { label: string; onPress: () => void; loading?: boolean };
}) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}><Ionicons name={icon} size={30} color={color.primary} /></View>
      <Text style={[font.h3, { color: color.text, textAlign: 'center' }]}>{title}</Text>
      {body ? <Text style={[font.body, { color: color.textMuted, textAlign: 'center' }]}>{body}</Text> : null}
      {action ? (
        <Button label={action.label} onPress={action.onPress} loading={action.loading} variant="secondary" size="secondary" icon="refresh" style={{ alignSelf: 'stretch', marginTop: space.xs }} />
      ) : null}
    </View>
  );
}

/** Inline error strip with a retry button. */
export function ErrorStrip({ text, onRetry, busy }: { text: string; onRetry: () => void; busy?: boolean }) {
  return (
    <View style={styles.errStrip} accessibilityLiveRegion="polite">
      <Ionicons name="alert-circle" size={20} color={color.alert} />
      <Text style={[font.small, { color: color.alertDark, flex: 1, fontWeight: '700' }]}>{text}</Text>
      <Button label="Retry" variant="secondary" size="secondary" onPress={onRetry} loading={busy} style={{ minHeight: 38, paddingHorizontal: space.sm }} />
    </View>
  );
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <View style={[styles.card, { gap: space.sm }]} accessibilityLabel="Loading">
      <View style={[styles.skel, { width: '40%', height: 20 }]} />
      {Array.from({ length: lines }).map((_, i) => (
        <View key={i} style={[styles.skel, { width: `${85 - i * 15}%` }]} />
      ))}
    </View>
  );
}

/** Bottom sheet on a dimmed backdrop. */
export function Sheet({ visible, onClose, title, children }: {
  visible: boolean; onClose: () => void; title: string; children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView style={{ flex: 1 }}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + space.md }]}>
          <View style={styles.grabber} />
          <View style={styles.sheetHead}>
            <Text style={[font.h2, { color: color.text, flex: 1 }]} numberOfLines={2}>{title}</Text>
            <IconButton icon="close" label="Close" onPress={onClose} />
          </View>
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** − n + stepper (free beds). */
export function Stepper({ value, min = 0, max, onChange, label }: { value: number; min?: number; max: number; onChange: (n: number) => void; label: string }) {
  return (
    <View style={styles.stepper} accessibilityLabel={`${label}: ${value}`}>
      <IconButton icon="remove" label={`Fewer ${label}`} onPress={() => onChange(Math.max(min, value - 1))} disabled={value <= min} bg={color.surface} tint={color.primary} size={38} />
      <Text style={[font.num, { color: color.text, minWidth: 34, textAlign: 'center' }]}>{value}</Text>
      <IconButton icon="add" label={`More ${label}`} onPress={() => onChange(Math.min(max, value + 1))} disabled={value >= max} bg={color.surface} tint={color.primary} size={38} />
    </View>
  );
}

/** Two to four equal tabs inside a screen (Pending / Accepted / Closed). */
export function Segmented<K extends string>({ value, options, onChange }: { value: K; options: { key: K; label: string; count?: number }[]; onChange: (k: K) => void }) {
  return (
    <View style={styles.seg} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable key={o.key} onPress={() => onChange(o.key)} accessibilityRole="tab" accessibilityState={{ selected: on }}
            style={[styles.segItem, on && styles.segOn]}>
            <Text style={[font.small, { fontWeight: '700', color: on ? color.primaryDark : color.textMuted }]} numberOfLines={1}>{o.label}</Text>
            {o.count ? <CountDot n={o.count} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

export const kit = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  divider: { height: 1, backgroundColor: color.border },
});

const styles = StyleSheet.create({
  btn: { borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.md },
  btnRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  chip: {
    minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.sm, borderRadius: radius.pill,
    borderWidth: 1, borderColor: color.borderStrong, backgroundColor: color.surface,
  },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.pill, alignSelf: 'flex-start' },
  count: { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: color.alert, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  card: { backgroundColor: color.surface, borderRadius: radius.lg, padding: space.md, borderWidth: 1, borderColor: color.border, ...shadow.card },
  empty: { alignItems: 'center', gap: space.xs, paddingVertical: space.xxl, paddingHorizontal: space.xl },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: color.primaryTint, alignItems: 'center', justifyContent: 'center', marginBottom: space.xs },
  errStrip: { flexDirection: 'row', alignItems: 'center', gap: space.xs, backgroundColor: color.alertTint, borderRadius: radius.md, padding: space.xs, paddingLeft: space.sm },
  skel: { height: 14, borderRadius: radius.sm, backgroundColor: color.surfaceAlt },
  backdrop: { flex: 1, backgroundColor: 'rgba(27,24,70,0.45)' },
  sheet: { backgroundColor: color.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingHorizontal: space.md, paddingTop: space.xs, maxHeight: '92%' },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: color.borderStrong, marginBottom: space.xs },
  sheetHead: { flexDirection: 'row', alignItems: 'center', marginBottom: space.sm, gap: space.sm },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space.xs, backgroundColor: color.primaryTint, borderRadius: radius.pill, padding: 3 },
  seg: { flexDirection: 'row', backgroundColor: color.surfaceAlt, borderRadius: radius.md, padding: 3, gap: 3 },
  segItem: { flex: 1, minHeight: 38, borderRadius: radius.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 6 },
  segOn: { backgroundColor: color.surface, ...shadow.card },
});
