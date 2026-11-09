/**
 * Services section switcher in Home's tab style (owner, 10 Nov 2026: "not pills but home screen", "design anything
 * but it must be perfect"): folder tabs at the bottom of the diet band. The selected tab is the page colour and
 * flows into the page under it with the same curved flares as Home's Non-veg / Veg tabs; the others are soft chips
 * on the band. Scrolls sideways (5 sections); the selected tab is kept in view.
 */
import React, { useEffect, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { FlareCorner } from '../../components/home/HomeRedesign2026';

export default function FolderTabRail({ tabs, active, onTab, band, page, ink, accent, side = 16 }: {
  tabs: [string, string][];
  active: string;
  onTab: (key: string) => void;
  /** The band the tabs sit on (flares are cut from it). */
  band: string;
  /** The page under the header (the selected tab's fill). */
  page: string;
  ink: string;
  accent: string;
  side?: number;
}) {
  const ref = useRef<ScrollView>(null);
  const xs = useRef<Record<string, { x: number; w: number }>>({});
  const viewW = useRef(0);
  const reveal = (animated: boolean) => {
    const p = xs.current[active];
    if (!p || !viewW.current) return;
    if (p.x + p.w > viewW.current - side || p.x < 0) ref.current?.scrollTo({ x: Math.max(0, p.x - side - 12), animated });
  };
  useEffect(() => { const t = setTimeout(() => reveal(true), 60); return () => clearTimeout(t); }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <ScrollView
      ref={ref}
      horizontal
      showsHorizontalScrollIndicator={false}
      style={st.scroll}
      contentContainerStyle={[st.row, { paddingHorizontal: side }]}
      onLayout={(e) => { viewW.current = e.nativeEvent.layout.width; reveal(false); }}
      accessibilityRole="tablist"
    >
      {tabs.map(([k, label]) => {
        const on = k === active;
        return (
          <Pressable
            key={k}
            onLayout={(e) => { xs.current[k] = { x: e.nativeEvent.layout.x, w: e.nativeEvent.layout.width }; if (on) reveal(false); }}
            onPress={() => { if (!on) onTab(k); }}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={label}
            style={({ pressed }) => [
              st.tab,
              on
                ? { backgroundColor: page, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingVertical: 12 }
                : { backgroundColor: 'rgba(255,255,255,0.62)', borderRadius: 14, marginBottom: 7, paddingVertical: 9, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(17,17,26,0.06)' },
              pressed && !on && { opacity: 0.7 },
            ]}
          >
            {on ? <FlareCorner side="left" size={12} fill={page} bg={band} /> : null}
            {on ? <FlareCorner side="right" size={12} fill={page} bg={band} /> : null}
            <Text style={[st.label, { color: on ? accent : ink, fontWeight: on ? '900' : '700' }]} numberOfLines={1} maxFontSizeMultiplier={1.2}>{label}</Text>
            {on ? <View style={[st.underline, { backgroundColor: accent }]} /> : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const st = StyleSheet.create({
  scroll: { flexGrow: 0, flexShrink: 0 },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingTop: 16 },
  tab: { paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 13.5, letterSpacing: 0.1 },
  underline: { width: 20, height: 3, borderRadius: 2, marginTop: 5 },
});
