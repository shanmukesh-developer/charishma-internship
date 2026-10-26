import React, { useEffect, useRef } from 'react';
import { LayoutChangeEvent, ScrollView, StyleSheet, Text, View, ViewStyle, StyleProp } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { PressScale } from './motion';
import { BUTTON_ROLE } from '../../utils/pressRole';

/**
 * The Others section pills, shared by every section header (Rentals, Events, Deals, …).
 * The active pill is always highlighted AND scrolled into view: sections later in the list (Rentals, Campus
 * events, Deals) used to sit off-screen on the right, so the page looked as if no section was selected.
 */
export type SectionPill = { key: string; label: string };

export default function SectionPillRail({ sections, active, onSection, side = 16, tone = 'dark', style }: {
  sections: SectionPill[];
  active: string;
  onSection: (key: string) => void;
  /** Page side padding, so the first pill lines up with the content. */
  side?: number;
  /** 'dark' = pills on a dark/colour header (white text); 'light' = pills on a light page. */
  tone?: 'dark' | 'light';
  style?: StyleProp<ViewStyle>;
}) {
  const railRef = useRef<ScrollView>(null);
  const railW = useRef(0);
  const pos = useRef<Record<string, { x: number; w: number }>>({});

  // Centre the active pill when it would be cut off (left edge stays put when everything fits).
  const reveal = (animated: boolean) => {
    const p = pos.current[active];
    if (!p || !railW.current) return;
    const end = p.x + p.w + side;
    if (end <= railW.current && p.x >= 0) return;
    const x = Math.max(0, p.x + p.w / 2 - railW.current / 2);
    railRef.current?.scrollTo({ x, animated });
  };
  useEffect(() => { reveal(true); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [active]);

  const onPillLayout = (k: string) => (e: LayoutChangeEvent) => {
    pos.current[k] = { x: e.nativeEvent.layout.x, w: e.nativeEvent.layout.width };
    if (k === active) reveal(false);
  };

  const dark = tone === 'dark';
  return (
    <View style={style} onLayout={(e) => { railW.current = e.nativeEvent.layout.width; reveal(false); }}>
      <ScrollView
        ref={railRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[st.rail, { paddingHorizontal: side }]}
      >
        {sections.map((t) => {
          const on = t.key === active;
          return (
            <View key={t.key} onLayout={onPillLayout(t.key)}>
              <PressScale
                onPress={() => { if (!on) onSection(t.key); }}
                accessibilityRole={BUTTON_ROLE}
                accessibilityState={{ selected: on }}
                accessibilityLabel={on ? `${t.label}, current section` : t.label}
                style={[st.pill, dark ? st.pillDark : st.pillLight, on && (dark ? st.pillOnDark : st.pillOnLight)]}
              >
                <Text
                  numberOfLines={1}
                  style={[st.text, { color: dark ? 'rgba(255,255,255,0.9)' : '#334155' }, on && { color: dark ? '#1E1B4B' : '#FFFFFF', fontWeight: '600' }]}
                >
                  {t.label}
                </Text>
              </PressScale>
            </View>
          );
        })}
      </ScrollView>
      {/* Soft fade on the right: the row scrolls. */}
      <LinearGradient
        pointerEvents="none"
        colors={dark ? ['rgba(0,0,0,0)', 'rgba(0,0,0,0.18)'] : ['rgba(255,255,255,0)', 'rgba(255,255,255,0.9)']}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={st.fade}
      />
    </View>
  );
}

const st = StyleSheet.create({
  rail: { gap: 8, alignItems: 'center' },
  pill: { height: 34, paddingHorizontal: 15, borderRadius: 17, justifyContent: 'center', borderWidth: 1 },
  pillDark: { backgroundColor: 'rgba(255,255,255,0.12)', borderColor: 'rgba(255,255,255,0.26)' },
  pillLight: { backgroundColor: '#FFFFFF', borderColor: '#E5E7EB' },
  pillOnDark: { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF' },
  pillOnLight: { backgroundColor: '#4F46E5', borderColor: '#4F46E5' },
  text: { fontSize: 13, fontWeight: '500' },
  fade: { position: 'absolute', right: 0, top: 0, bottom: 0, width: 28 },
});
