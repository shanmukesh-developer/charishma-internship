/**
 * Small building blocks shared by the PG detail sections, so every section reads the same: a bordered
 * card with 1 px dividers, icon + label + value rows, sub-headings, bullet and numbered lists, and a
 * yes / no checklist. PG-only.
 */
import React from 'react';
import { View, Text, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { usePgPalette, Divider, ICON, TYPE, IconCheck, IconCircleMinus, s as ui } from './ui';

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const p = usePgPalette();
  return <View style={[st.card, { borderColor: p.line, backgroundColor: p.card }, style]}>{children}</View>;
}

/** Card rows with dividers between them (null / false children are skipped). */
export function CardRows({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const rows = React.Children.toArray(children).filter(Boolean);
  if (!rows.length) return null;
  return (
    <Card style={style}>
      {rows.map((row, i) => (
        <View key={i}>
          {i > 0 ? <Divider /> : null}
          {row}
        </View>
      ))}
    </Card>
  );
}

/** Icon, small label, value (and optional detail line). */
export function InfoRow({ icon: Icon, label, value, detail }: { icon?: LucideIcon; label: string; value: string; detail?: string }) {
  const p = usePgPalette();
  return (
    <View style={st.row} accessible accessibilityLabel={`${label}: ${value}${detail ? `. ${detail}` : ''}`}>
      {Icon ? <Icon size={ICON.size} color={p.sub} strokeWidth={ICON.stroke} style={{ marginTop: 1 }} /> : null}
      <View style={{ flex: 1 }}>
        <Text style={[ui.small, { color: p.muted }]}>{label}</Text>
        <Text style={[ui.body, { color: p.text, marginTop: 2 }]}>{value}</Text>
        {detail ? <Text style={[ui.small, { color: p.sub, marginTop: 4 }]}>{detail}</Text> : null}
      </View>
    </View>
  );
}

export function SubHeading({ title, style }: { title: string; style?: StyleProp<ViewStyle> }) {
  const p = usePgPalette();
  return (
    <View style={[{ marginTop: 24, marginBottom: 8 }, style]}>
      <Text style={[st.sub, { color: p.text }]} accessibilityRole="header">{title}</Text>
    </View>
  );
}

export function Paragraph({ children, muted, style }: { children: React.ReactNode; muted?: boolean; style?: StyleProp<ViewStyle> }) {
  const p = usePgPalette();
  return <Text style={[ui.body, { color: muted ? p.sub : p.text }, style as any]}>{children}</Text>;
}

export function Bullets({ items, numbered }: { items: string[]; numbered?: boolean }) {
  const p = usePgPalette();
  return (
    <View style={{ gap: 8 }}>
      {items.map((t, i) => (
        <View key={`${i}-${t}`} style={st.bulletRow}>
          {numbered ? (
            <Text style={[ui.body, st.num, { color: p.muted }]}>{i + 1}.</Text>
          ) : (
            <View style={[st.dot, { backgroundColor: p.muted }]} />
          )}
          <Text style={[ui.body, { color: p.text, flex: 1 }]}>{t}</Text>
        </View>
      ))}
    </View>
  );
}

/** Checklist row: a check for included / available, a dash for not. */
export function CheckRow({ label, on, detail }: { label: string; on: boolean; detail?: string }) {
  const p = usePgPalette();
  const Icon = on ? IconCheck : IconCircleMinus;
  return (
    <View style={st.checkRow} accessible accessibilityLabel={`${label}: ${on ? 'yes' : 'no'}${detail ? `, ${detail}` : ''}`}>
      <Icon size={16} color={on ? p.success : p.muted} strokeWidth={on ? 2 : ICON.stroke} />
      <Text style={[ui.body, { color: on ? p.text : p.sub, flex: 1 }]}>{label}</Text>
      {detail ? <Text style={[ui.small, { color: p.sub }]}>{detail}</Text> : null}
    </View>
  );
}

const st = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  sub: { fontSize: TYPE.body, fontWeight: '600' },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  dot: { width: 4, height: 4, borderRadius: 2, marginTop: 8, marginHorizontal: 4 },
  num: { minWidth: 20 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, minHeight: 44 },
});
