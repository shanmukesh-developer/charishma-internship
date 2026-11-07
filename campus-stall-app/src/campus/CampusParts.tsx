// In-Campus Booking building blocks for the stall: status badge, booking card, timeline, header.
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, font, radius, space } from '../theme';
import { Badge, Card, IconButton } from '../ui/kit';
import { inr, timeIST, type CbStatus, type CbStep, type CbVendorBooking } from '../lib/campusApi';

/** The stall-side words for each status (never colour alone). */
export const STATUS_TEXT: Record<CbStatus, string> = {
  PAYMENT_PENDING: 'Awaiting payment',
  PAYMENT_REVIEW: 'Payment review',
  ACCEPTED: 'Accepted',
  PREPARING: 'Preparing',
  READY: 'Ready',
  COLLECTED: 'Collected',
  REJECTED: 'Payment rejected',
  CANCELLED: 'Cancelled',
};

export const statusText = (s: string): string => (STATUS_TEXT as Record<string, string>)[s] || String(s || '').replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());

export function StatusBadge({ status }: { status: CbStatus }) {
  const map: Record<CbStatus, { fg: string; bg: string }> = {
    PAYMENT_PENDING: { fg: color.textSecondary, bg: color.surfaceAlt },
    PAYMENT_REVIEW: { fg: color.warning, bg: color.warningTint },
    ACCEPTED: { fg: color.info, bg: color.infoTint },
    PREPARING: { fg: color.info, bg: color.infoTint },
    READY: { fg: color.openDark, bg: color.openTint },
    COLLECTED: { fg: color.openDark, bg: color.openTint },
    REJECTED: { fg: color.alertDark, bg: color.alertTint },
    CANCELLED: { fg: color.alertDark, bg: color.alertTint },
  };
  // A status this build does not know yet (the server added one): neutral badge with the raw word, never a crash.
  const t = map[status] || { fg: color.textSecondary, bg: color.surfaceAlt };
  return <Badge text={statusText(status)} fg={t.fg} bg={t.bg} />;
}

export const itemsLine = (b: CbVendorBooking) => b.items.map((i) => `${i.quantity} ${i.name}`).join(' · ');

export function BookingCard({ b, onPress }: { b: CbVendorBooking; onPress: () => void }) {
  const review = b.status === 'PAYMENT_REVIEW';
  const waiting = b.status === 'PAYMENT_PENDING' || b.status === 'REJECTED';
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`Booking ${b.ref}, ${statusText(b.status)}, ${inr(b.amount)}`} style={({ pressed }) => [pressed && { opacity: 0.85 }]}>
      <Card style={[{ gap: space.xs }, review && { borderColor: color.warning, borderWidth: 2 }, waiting && { opacity: 0.75 }]}>
        <View style={styles.row}>
          <Text style={[font.h3, { color: color.text, flex: 1, fontVariant: ['tabular-nums'] }]}>#{b.ref}</Text>
          <Text style={[font.h3, { color: color.text }]}>{inr(b.amount)}</Text>
        </View>
        <Text style={[font.body, { color: color.textSecondary }]} numberOfLines={2}>{itemsLine(b)}</Text>
        <View style={[styles.row, { marginTop: 2 }]}>
          <StatusBadge status={b.status} />
          <Text style={[font.small, { color: color.textMuted, marginLeft: space.xs, flex: 1 }]} numberOfLines={1}>
            {`${b.customer.firstName} · ${timeIST(b.proof.submittedAt || b.createdAt)}`}
          </Text>
          {review ? <Text style={[font.label, { color: color.warning }]}>Review</Text> : <Ionicons name="chevron-forward" size={20} color={color.textMuted} />}
        </View>
      </Card>
    </Pressable>
  );
}

export function Timeline({ steps }: { steps: CbStep[] }) {
  return (
    <View>
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        return (
          <View key={s.key} style={{ flexDirection: 'row' }}>
            <View style={{ alignItems: 'center', width: 28 }}>
              <View style={[styles.dot, s.done ? { backgroundColor: color.open, borderColor: color.open } : { backgroundColor: color.surface, borderColor: color.border }]}>
                {s.done ? <Ionicons name="checkmark" size={14} color={color.textInverse} /> : null}
              </View>
              {!last ? <View style={[styles.line, { backgroundColor: steps[i + 1].done ? color.open : color.border }]} /> : null}
            </View>
            <View style={{ flex: 1, paddingLeft: space.xs, paddingBottom: last ? 0 : space.md }}>
              <Text style={[font.body, { color: s.done ? color.text : color.textMuted, fontWeight: '700' }]}>{s.label}</Text>
              {s.at ? <Text style={[font.small, { color: color.textMuted }]}>{timeIST(s.at)}</Text> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

export function ScreenHeader({ title, sub, onBack, right }: { title: string; sub?: string; onBack?: () => void; right?: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { paddingTop: insets.top + space.xs }]}>
      {onBack ? <IconButton icon="arrow-back" label="Back" onPress={onBack} /> : null}
      <View style={{ flex: 1 }}>
        <Text style={[font.h2, { color: color.text }]} numberOfLines={1}>{title}</Text>
        {sub ? <Text style={[font.small, { color: color.textMuted }]} numberOfLines={1}>{sub}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export function Tile({ label, value, caption, tint }: { label: string; value: string; caption?: string; tint?: string }) {
  return (
    <Card style={{ flex: 1, gap: 2, paddingHorizontal: space.sm }}>
      <Text style={[font.small, { color: color.textMuted, fontWeight: '700' }]} numberOfLines={1}>{label}</Text>
      <Text style={[font.money, { color: tint || color.text }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      {caption ? <Text style={[font.small, { color: color.textSecondary }]} numberOfLines={1}>{caption}</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  dot: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  line: { width: 2, flex: 1, marginVertical: 2 },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingBottom: space.sm, backgroundColor: color.bg, borderBottomWidth: 1, borderBottomColor: color.border },
  pill: { borderRadius: radius.pill },
});
