// Shared building blocks: buttons, chips, badges, cards, sheets, empty / error states, skeletons.
import React from 'react';
import {
  ActivityIndicator, Modal, Pressable, StyleProp, StyleSheet, Text, View, ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, font, radius, shadow, space, touch } from '../theme';
import { KeyboardAvoidingView } from './KeyboardAvoidingView';

export type IconName = keyof typeof Ionicons.glyphMap;
type Variant = 'accept' | 'reject' | 'rejectOutline' | 'primary' | 'secondary' | 'ghost' | 'onRed' | 'outlineOnRed';

const VARIANTS: Record<Variant, { bg: string; fg: string; border?: string }> = {
  accept: { bg: color.open, fg: color.textInverse },
  reject: { bg: color.alert, fg: color.textInverse },
  rejectOutline: { bg: color.surface, fg: color.alertDark, border: color.alert },
  primary: { bg: color.primary, fg: color.textInverse },
  secondary: { bg: color.surface, fg: color.text, border: color.border },
  ghost: { bg: 'transparent', fg: color.text },
  onRed: { bg: color.surface, fg: color.alertDark },
  outlineOnRed: { bg: 'transparent', fg: color.textInverse, border: color.textInverse },
};

export function Button({
  label, onPress, variant = 'primary', size = 'primary', loading, disabled, icon, style, a11y,
}: {
  label: string;
  onPress: () => void;
  variant?: Variant;
  size?: 'primary' | 'secondary' | 'huge';
  loading?: boolean;
  disabled?: boolean;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
  a11y?: string;
}) {
  const v = VARIANTS[variant];
  const off = disabled || loading;
  const minHeight = size === 'huge' ? 76 : size === 'primary' ? touch.primary : touch.secondary;
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
        v.border ? { borderWidth: 2, borderColor: v.border } : null,
        off && !loading ? { opacity: 0.45 } : null,
        pressed && !off ? { opacity: 0.8, transform: [{ scale: 0.99 }] } : null,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={v.fg} />
      ) : (
        <View style={styles.btnRow}>
          {icon ? <Ionicons name={icon} size={size === 'secondary' ? 20 : 24} color={v.fg} /> : null}
          <Text
            style={[font.button, { color: v.fg }, size === 'secondary' && { fontSize: 16 }, size === 'huge' && { fontSize: 22, lineHeight: 26 }]}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

export function IconButton({
  icon, onPress, label, tint = color.text, bg = color.surfaceAlt, size = touch.icon,
}: {
  icon: IconName; onPress: () => void; label: string; tint?: string; bg?: string; size?: number;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={({ pressed }) => [{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.7 }]}
    >
      <Ionicons name={icon} size={22} color={tint} />
    </Pressable>
  );
}

/** Big selectable chip (prep time, reject reason, filters). */
export function Chip({
  label, sub, selected, onPress, tone = 'dark', style, a11y,
}: {
  label: string; sub?: string; selected: boolean; onPress: () => void; tone?: 'dark' | 'green' | 'red'; style?: StyleProp<ViewStyle>; a11y?: string;
}) {
  const selBg = tone === 'green' ? color.open : tone === 'red' ? color.alert : color.text;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={a11y || label}
      style={({ pressed }) => [
        styles.chip,
        selected ? { backgroundColor: selBg, borderColor: selBg } : null,
        pressed ? { opacity: 0.8 } : null,
        style,
      ]}
    >
      <Text style={[font.h3, { color: selected ? color.textInverse : color.text, textAlign: 'center' }]} numberOfLines={2}>{label}</Text>
      {sub ? <Text style={[font.label, { color: selected ? color.textInverse : color.textMuted }]}>{sub}</Text> : null}
    </Pressable>
  );
}

export function Badge({ text, fg, bg, border, icon }: { text: string; fg: string; bg: string; border?: string; icon?: IconName }) {
  return (
    <View style={[styles.badge, { backgroundColor: bg }, border ? { borderWidth: 1, borderColor: border } : null]}>
      {icon ? <Ionicons name={icon} size={14} color={fg} /> : null}
      <Text style={[font.label, { color: fg }]}>{text}</Text>
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
      <Ionicons name={icon} size={52} color={color.textMuted} />
      <Text style={[font.h3, { color: color.text, textAlign: 'center' }]}>{title}</Text>
      {body ? <Text style={[font.body, { color: color.textSecondary, textAlign: 'center' }]}>{body}</Text> : null}
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
      <Button label="Retry" variant="secondary" size="secondary" onPress={onRetry} loading={busy} style={{ minHeight: 44, paddingHorizontal: space.sm }} />
    </View>
  );
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <View style={[styles.card, { gap: space.sm }]} accessibilityLabel="Loading">
      <View style={[styles.skel, { width: '40%', height: 22 }]} />
      {Array.from({ length: lines }).map((_, i) => (
        <View key={i} style={[styles.skel, { width: `${85 - i * 15}%` }]} />
      ))}
      <View style={[styles.skel, { height: 52, marginTop: space.xs }]} />
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

export const kit = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  divider: { height: 1, backgroundColor: color.surfaceAlt },
});

const styles = StyleSheet.create({
  btn: { borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.md },
  btnRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  chip: {
    minHeight: touch.secondary + 4, paddingHorizontal: space.sm, paddingVertical: space.xs, borderRadius: radius.md,
    borderWidth: 2, borderColor: color.border, backgroundColor: color.surface, alignItems: 'center', justifyContent: 'center',
  },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill },
  card: { backgroundColor: color.surface, borderRadius: radius.lg, padding: space.md, borderWidth: 1, borderColor: color.border, ...shadow.card },
  empty: { alignItems: 'center', gap: space.sm, paddingVertical: space.xxl, paddingHorizontal: space.xl },
  errStrip: { flexDirection: 'row', alignItems: 'center', gap: space.xs, backgroundColor: color.alertTint, borderRadius: radius.md, padding: space.xs, paddingLeft: space.sm },
  skel: { height: 16, borderRadius: radius.sm, backgroundColor: color.surfaceAlt },
  backdrop: { flex: 1, backgroundColor: 'rgba(11,13,18,0.55)' },
  sheet: { backgroundColor: color.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingHorizontal: space.md, paddingTop: space.xs, maxHeight: '92%' },
  grabber: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: color.border, marginBottom: space.xs },
  sheetHead: { flexDirection: 'row', alignItems: 'center', marginBottom: space.sm, gap: space.sm },
});
