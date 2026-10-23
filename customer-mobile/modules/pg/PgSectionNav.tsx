/**
 * Section navigation under the PG header: one text tab per section that has content, with a 2 px
 * underline on the active one. The detail screen keeps `active` in step with the scroll position
 * (scroll-spy) and scrolls to a section when a tab is tapped; this bar keeps the active tab in view.
 */
import React, { useEffect, useRef } from 'react';
import { View, Text, ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import { SECTION_LABEL, type SectionKey } from './pgApi';
import { usePgPalette, Press, TYPE } from './ui';

export const SECTION_NAV_H = 48;

export function PgSectionNav({ sections, active, onPress }: { sections: SectionKey[]; active: SectionKey; onPress: (key: SectionKey) => void }) {
  const p = usePgPalette();
  const { width } = useWindowDimensions();
  const ref = useRef<ScrollView>(null);
  const layout = useRef<Record<string, { x: number; w: number }>>({});

  useEffect(() => {
    const l = layout.current[active];
    if (!l || !ref.current) return;
    ref.current.scrollTo({ x: Math.max(0, l.x - (width - l.w) / 2), animated: true });
  }, [active, width]);

  return (
    <View style={[st.bar, { backgroundColor: p.bg, borderBottomColor: p.line }]}>
      <ScrollView ref={ref} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.row} accessibilityRole="tablist">
        {sections.map((k) => {
          const on = k === active;
          return (
            <View key={k} onLayout={(e) => { layout.current[k] = { x: e.nativeEvent.layout.x, w: e.nativeEvent.layout.width }; }}>
              <Press
                onPress={() => onPress(k)}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${SECTION_LABEL[k]} section`}
                style={st.tab}
              >
                <View style={st.tabInner}>
                  <Text style={[st.label, { color: on ? p.accent : p.sub, fontWeight: on ? '600' : '500' }]}>{SECTION_LABEL[k]}</Text>
                  <View style={[st.underline, { backgroundColor: on ? p.accentFill : 'transparent' }]} />
                </View>
              </Press>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  bar: { height: SECTION_NAV_H, borderBottomWidth: StyleSheet.hairlineWidth },
  row: { paddingHorizontal: 8 },
  tab: { height: SECTION_NAV_H, justifyContent: 'flex-end' },
  tabInner: { paddingHorizontal: 12, height: SECTION_NAV_H, justifyContent: 'flex-end' },
  label: { fontSize: TYPE.body, textAlign: 'center', marginBottom: 12 },
  underline: { height: 2, borderRadius: 1 },
});
