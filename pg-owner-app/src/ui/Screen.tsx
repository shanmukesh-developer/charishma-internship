// Screen frame: back button + title (+ optional PG switcher line), offline banner, pull-to-refresh scroll body,
// pinned footer. Plus small shared pieces (Field, Banner, StatTile, MenuRow, KeyValue, SectionTitle).
import React from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, font, radius, shadow, space, touch } from '../theme';
import { CountDot, IconButton, type IconName } from './kit';
import { KeyboardAwareScrollView } from './KeyboardAvoidingView';
import { useSession } from '../state/SessionProvider';

export function OfflineBanner() {
  const { netOk } = useSession();
  if (netOk) return null;
  return (
    <View accessibilityRole="alert" style={styles.offline}>
      <Ionicons name="cloud-offline" size={18} color={color.textInverse} />
      <Text style={[font.small, { color: color.textInverse, fontWeight: '700', flex: 1 }]}>
        No internet. Changes need a connection; pull down to retry.
      </Text>
    </View>
  );
}

export function Screen({
  title, subtitle, onBack, children, right, refreshing, onRefresh, scroll = true, keyboard, footer, tabBarSpace,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  children: React.ReactNode;
  right?: React.ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  scroll?: boolean;
  /** forms: scroll the focused input above the keyboard */
  keyboard?: boolean;
  /** pinned at the bottom (one primary action) */
  footer?: React.ReactNode;
  /** a tab screen: leave room for the bottom tab bar instead of the home indicator */
  tabBarSpace?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const body = <View style={{ gap: space.md }}>{children}</View>;
  const bottom = footer ? space.md : tabBarSpace ? space.xl : insets.bottom + space.xxl;
  const contentStyle = { padding: space.md, paddingBottom: bottom };
  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <View style={[styles.head, { paddingTop: insets.top + space.xs }]}>
        {onBack ? <IconButton icon="arrow-back" label="Back" onPress={onBack} bg={color.primaryTint} tint={color.primaryDark} /> : null}
        <View style={{ flex: 1 }}>
          <Text style={[font.h2, { color: color.text }]} numberOfLines={1} accessibilityRole="header">{title}</Text>
          {subtitle ? <Text style={[font.small, { color: color.textMuted }]} numberOfLines={1}>{subtitle}</Text> : null}
        </View>
        {right}
      </View>
      <OfflineBanner />
      {!scroll ? <View style={[{ flex: 1 }, contentStyle]}>{body}</View> : keyboard ? (
        <KeyboardAwareScrollView contentContainerStyle={contentStyle}>{body}</KeyboardAwareScrollView>
      ) : (
        <ScrollView
          contentContainerStyle={contentStyle}
          keyboardShouldPersistTaps="handled"
          refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={color.primary} colors={[color.primary]} /> : undefined}
        >
          {body}
        </ScrollView>
      )}
      {footer ? <View style={[styles.footer, { paddingBottom: (tabBarSpace ? 0 : insets.bottom) + space.sm }]}>{footer}</View> : null}
    </View>
  );
}

export function SectionTitle({ text, right }: { text: string; right?: React.ReactNode }) {
  return (
    <View style={[styles.sectionRow]}>
      <Text style={[font.label, { color: color.textMuted, flex: 1 }]}>{text.toUpperCase()}</Text>
      {right}
    </View>
  );
}

export function Field({
  label, error, hint, style, prefix, multiline, ...rest
}: TextInputProps & { label: string; error?: string | null; hint?: string; prefix?: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ gap: space.xxs }, style]}>
      <Text style={[font.label, { color: color.textSecondary }]}>{label.toUpperCase()}</Text>
      <View style={[styles.inputRow, multiline ? { alignItems: 'flex-start', paddingVertical: space.xs } : null, error ? { borderColor: color.alert } : null]}>
        {prefix ? <Text style={[font.h3, { color: color.textSecondary }]}>{prefix}</Text> : null}
        <TextInput
          placeholderTextColor={color.textMuted}
          style={[font.body, { flex: 1, color: color.text, minHeight: multiline ? 88 : 48 }, multiline ? { textAlignVertical: 'top' } : null]}
          accessibilityLabel={label}
          multiline={multiline}
          {...rest}
        />
      </View>
      {error ? <Text style={[font.small, { color: color.alertDark, fontWeight: '700' }]}>{error}</Text> : hint ? <Text style={[font.small, { color: color.textMuted }]}>{hint}</Text> : null}
    </View>
  );
}

type Tone = 'info' | 'warn' | 'error' | 'ok';
const TONES: Record<Tone, { bg: string; fg: string; icon: IconName }> = {
  info: { bg: color.primaryTint, fg: color.primaryDark, icon: 'information-circle' },
  warn: { bg: color.warnTint, fg: color.warn, icon: 'warning' },
  error: { bg: color.alertTint, fg: color.alertDark, icon: 'alert-circle' },
  ok: { bg: color.okTint, fg: color.ok, icon: 'checkmark-circle' },
};
export function Banner({ tone = 'info', text, title }: { tone?: Tone; text: string; title?: string }) {
  const t = TONES[tone];
  return (
    <View style={[styles.banner, { backgroundColor: t.bg }]} accessibilityRole={tone === 'error' ? 'alert' : undefined}>
      <Ionicons name={t.icon} size={20} color={t.fg} />
      <View style={{ flex: 1, gap: 2 }}>
        {title ? <Text style={[font.h3, { color: t.fg }]}>{title}</Text> : null}
        <Text style={[font.small, { color: t.fg, fontWeight: '600' }]}>{text}</Text>
      </View>
    </View>
  );
}

/** Dashboard tile (Total beds / Occupied / Vacant). */
export function StatTile({ label, value, icon, tint = color.primary }: { label: string; value: string; icon: IconName; tint?: string }) {
  return (
    <View style={styles.stat} accessibilityLabel={`${label}: ${value}`}>
      <Text style={[font.label, { color: color.textMuted }]} numberOfLines={1}>{label}</Text>
      <Text style={[font.big, { color: color.text }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      <Ionicons name={icon} size={16} color={tint} />
    </View>
  );
}

/** Menu row: icon, title, optional sub line and count badge, chevron. Rows sit inside one Card (MenuGroup). */
export function MenuRow({ icon, title, sub, onPress, badge, last, danger }: { icon: IconName; title: string; sub?: string; onPress: () => void; badge?: number; last?: boolean; danger?: boolean }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${title}${sub ? `. ${sub}` : ''}${badge ? `. ${badge} new` : ''}`}
      style={({ pressed }) => [styles.menuRow, !last && styles.menuDivider, pressed && { backgroundColor: color.primaryTint }]}>
      <View style={[styles.menuIcon, danger && { backgroundColor: color.alertTint }]}><Ionicons name={icon} size={19} color={danger ? color.alertDark : color.primaryDark} /></View>
      <View style={{ flex: 1 }}>
        <Text style={[font.h3, { color: danger ? color.alertDark : color.text, fontWeight: '600' }]}>{title}</Text>
        {sub ? <Text style={[font.small, { color: color.textMuted }]} numberOfLines={2}>{sub}</Text> : null}
      </View>
      {badge ? <CountDot n={badge} /> : null}
      <Ionicons name="chevron-forward" size={18} color={color.textMuted} />
    </Pressable>
  );
}
export function MenuGroup({ children }: { children: React.ReactNode }) {
  return <View style={styles.menuGroup}>{children}</View>;
}

export function KeyValue({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <View style={styles.kv}>
      <Text style={[font.body, { color: color.textMuted, flex: 1 }]}>{k}</Text>
      <Text style={[strong ? font.h3 : font.body, { color: color.text, fontWeight: strong ? '800' : '600', flexShrink: 1, textAlign: 'right' }]}>{v}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingBottom: space.sm, backgroundColor: color.surface, borderBottomWidth: 1, borderBottomColor: color.border },
  offline: { flexDirection: 'row', alignItems: 'center', gap: space.xs, backgroundColor: color.alertDark, paddingHorizontal: space.md, paddingVertical: space.xs },
  footer: { paddingHorizontal: space.md, paddingTop: space.sm, backgroundColor: color.surface, borderTopWidth: 1, borderTopColor: color.border, gap: space.xs },
  sectionRow: { flexDirection: 'row', alignItems: 'center', marginTop: space.xs },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 50, borderRadius: radius.md, borderWidth: 1.5, borderColor: color.border, backgroundColor: color.surface, paddingHorizontal: space.sm },
  banner: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start', padding: space.sm, borderRadius: radius.md },
  stat: { flex: 1, backgroundColor: color.surface, borderRadius: radius.lg, paddingVertical: space.sm, paddingHorizontal: space.sm, borderWidth: 1, borderColor: color.border, alignItems: 'center', gap: 2, ...shadow.card },
  menuGroup: { backgroundColor: color.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: color.border, overflow: 'hidden', ...shadow.card },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: touch.primary + 4, paddingHorizontal: space.md, paddingVertical: space.xs },
  menuDivider: { borderBottomWidth: 1, borderBottomColor: color.border },
  menuIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: color.primaryTint, alignItems: 'center', justifyContent: 'center' },
  kv: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 5 },
});
