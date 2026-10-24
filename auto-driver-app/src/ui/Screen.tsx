// Screen frame: big back button + title, offline banner, optional "only while stopped" reminder,
// pull-to-refresh scroll body. Plus small shared pieces (Field, Banner, StatBox, ListRow, SectionTitle).
import React from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, font, radius, space, touch } from '../theme';
import { IconButton, type IconName } from './kit';
import { KeyboardAwareScrollView } from './KeyboardAvoidingView';
import { useSession } from '../state/SessionProvider';
import { useSocket } from '../state/SocketProvider';

export function OfflineBanner() {
  const { netOk } = useSession();
  const { status, retry } = useSocket();
  const offline = !netOk || status === 'offline';
  if (!offline) return null;
  return (
    <Pressable onPress={retry} accessibilityRole="button" accessibilityLabel="No internet. Tap to retry." style={styles.offline}>
      <Ionicons name="cloud-offline" size={20} color={color.textInverse} />
      <Text style={[font.small, { color: color.textInverse, fontWeight: '800', flex: 1 }]}>
        No internet. Trip changes need a connection. Tap to retry.
      </Text>
    </Pressable>
  );
}

/** Shown on every screen with trip actions (spec §7: actions only while stationary). */
export function StationaryNote() {
  return (
    <View style={styles.stationary} accessibilityRole="alert">
      <Ionicons name="hand-left" size={22} color={color.brandDark} />
      <View style={{ flex: 1 }}>
        <Text style={[font.small, { color: color.brandDark, fontWeight: '800' }]}>Only use while the auto is stopped.</Text>
        <Text style={[font.small, { color: color.brandDark }]}>ఆటో ఆగి ఉన్నప్పుడు మాత్రమే వాడండి.</Text>
      </View>
    </View>
  );
}

export function Screen({
  title, onBack, children, right, refreshing, onRefresh, stationary, scroll = true, keyboard, footer,
}: {
  title: string;
  onBack?: () => void;
  children: React.ReactNode;
  right?: React.ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  stationary?: boolean;
  scroll?: boolean;
  /** forms: scroll the focused input above the keyboard */
  keyboard?: boolean;
  /** pinned at the bottom (one primary action) */
  footer?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const body = (
    <View style={{ gap: space.md }}>
      {stationary ? <StationaryNote /> : null}
      {children}
    </View>
  );
  const contentStyle = { padding: space.md, paddingBottom: (footer ? space.md : insets.bottom + space.xxl) };
  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <View style={[styles.head, { paddingTop: insets.top + space.xs }]}>
        {onBack ? <IconButton icon="arrow-back" label="Back" onPress={onBack} /> : null}
        <Text style={[font.h2, { color: color.text, flex: 1 }]} numberOfLines={1} accessibilityRole="header">{title}</Text>
        {right}
      </View>
      <OfflineBanner />
      {!scroll ? <View style={[{ flex: 1 }, contentStyle]}>{body}</View> : keyboard ? (
        <KeyboardAwareScrollView contentContainerStyle={contentStyle}>{body}</KeyboardAwareScrollView>
      ) : (
        <ScrollView
          contentContainerStyle={contentStyle}
          keyboardShouldPersistTaps="handled"
          refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} /> : undefined}
        >
          {body}
        </ScrollView>
      )}
      {footer ? <View style={[styles.footer, { paddingBottom: insets.bottom + space.sm }]}>{footer}</View> : null}
    </View>
  );
}

export function SectionTitle({ text }: { text: string }) {
  return <Text style={[font.label, { color: color.textMuted, marginTop: space.xs }]}>{text}</Text>;
}

export function Field({
  label, error, hint, style, prefix, ...rest
}: TextInputProps & { label: string; error?: string | null; hint?: string; prefix?: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ gap: space.xxs }, style]}>
      <Text style={[font.label, { color: color.textSecondary }]}>{label.toUpperCase()}</Text>
      <View style={[styles.inputRow, error ? { borderColor: color.alert } : null]}>
        {prefix ? <Text style={[font.h3, { color: color.textSecondary }]}>{prefix}</Text> : null}
        <TextInput
          placeholderTextColor={color.textMuted}
          style={[font.h3, { flex: 1, color: color.text, minHeight: 54 }]}
          accessibilityLabel={label}
          {...rest}
        />
      </View>
      {error ? <Text style={[font.small, { color: color.alertDark, fontWeight: '700' }]}>{error}</Text> : hint ? <Text style={[font.small, { color: color.textMuted }]}>{hint}</Text> : null}
    </View>
  );
}

type Tone = 'info' | 'warn' | 'error' | 'ok';
const TONES: Record<Tone, { bg: string; fg: string; icon: IconName }> = {
  info: { bg: color.infoTint, fg: color.info, icon: 'information-circle' },
  warn: { bg: color.warningTint, fg: color.warning, icon: 'warning' },
  error: { bg: color.alertTint, fg: color.alertDark, icon: 'alert-circle' },
  ok: { bg: color.openTint, fg: color.openDark, icon: 'checkmark-circle' },
};
export function Banner({ tone = 'info', text, title }: { tone?: Tone; text: string; title?: string }) {
  const t = TONES[tone];
  return (
    <View style={[styles.banner, { backgroundColor: t.bg }]} accessibilityRole={tone === 'error' ? 'alert' : undefined}>
      <Ionicons name={t.icon} size={22} color={t.fg} />
      <View style={{ flex: 1, gap: 2 }}>
        {title ? <Text style={[font.h3, { color: t.fg }]}>{title}</Text> : null}
        <Text style={[font.body, { color: t.fg, fontWeight: '600' }]}>{text}</Text>
      </View>
    </View>
  );
}

export function StatBox({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'ok' | 'warn' }) {
  return (
    <View style={[styles.stat, tone === 'ok' ? { backgroundColor: color.openTint } : tone === 'warn' ? { backgroundColor: color.warningTint } : null]}>
      <Text style={[font.label, { color: color.textMuted }]} numberOfLines={1}>{label.toUpperCase()}</Text>
      <Text style={[font.h1, { color: color.text }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      {sub ? <Text style={[font.small, { color: color.textSecondary }]} numberOfLines={2}>{sub}</Text> : null}
    </View>
  );
}

/** Big tappable row for menus. */
export function ListRow({ icon, title, sub, onPress, badge, tint }: { icon: IconName; title: string; sub?: string; onPress: () => void; badge?: string | number | null; tint?: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={sub ? `${title}. ${sub}` : title}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.75 }]}>
      <View style={[styles.rowIcon, tint ? { backgroundColor: tint } : null]}><Ionicons name={icon} size={24} color={color.text} /></View>
      <View style={{ flex: 1 }}>
        <Text style={[font.h3, { color: color.text }]}>{title}</Text>
        {sub ? <Text style={[font.small, { color: color.textSecondary }]} numberOfLines={2}>{sub}</Text> : null}
      </View>
      {badge ? <View style={styles.count}><Text style={[font.label, { color: color.textInverse }]}>{badge}</Text></View> : null}
      <Ionicons name="chevron-forward" size={22} color={color.textMuted} />
    </Pressable>
  );
}

export function KeyValue({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <View style={styles.kv}>
      <Text style={[font.body, { color: color.textSecondary, flex: 1 }]}>{k}</Text>
      <Text style={[strong ? font.h3 : font.body, { color: color.text, fontWeight: strong ? '800' : '700', flexShrink: 1, textAlign: 'right' }]}>{v}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingBottom: space.sm, backgroundColor: color.surface, borderBottomWidth: 1, borderBottomColor: color.border },
  offline: { flexDirection: 'row', alignItems: 'center', gap: space.xs, backgroundColor: color.alertDark, paddingHorizontal: space.md, paddingVertical: space.sm },
  stationary: { flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: color.brandTint, borderRadius: radius.md, padding: space.sm, borderWidth: 1, borderColor: color.brand },
  footer: { paddingHorizontal: space.md, paddingTop: space.sm, backgroundColor: color.surface, borderTopWidth: 1, borderTopColor: color.border, gap: space.xs },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 58, borderRadius: radius.md, borderWidth: 2, borderColor: color.border, backgroundColor: color.surface, paddingHorizontal: space.md },
  banner: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start', padding: space.md, borderRadius: radius.md },
  stat: { flex: 1, minWidth: 140, backgroundColor: color.surface, borderRadius: radius.lg, padding: space.md, borderWidth: 1, borderColor: color.border, gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: touch.primary + 8, backgroundColor: color.surface, borderRadius: radius.lg, paddingHorizontal: space.md, paddingVertical: space.sm, borderWidth: 1, borderColor: color.border },
  rowIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: color.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  count: { minWidth: 28, height: 28, borderRadius: 14, backgroundColor: color.alert, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  kv: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 6 },
});
