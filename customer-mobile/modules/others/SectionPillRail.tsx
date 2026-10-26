import React, { useEffect, useRef, useState } from 'react';
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

/**
 * Where to scroll a pill rail so the active pill shows in full. The row always starts on a pill boundary, so no
 * half-cut pill sits at the left edge ("…Ride" before Rentals looked broken); 0 while the active pill already fits.
 */
export function pillRevealX(pos: Record<string, { x: number; w: number }>, active: string, railW: number, gap = 8, endRoom = 24) {
  const p = pos[active];
  if (!p || !railW) return null;
  const fits = (x: number) => p.x + p.w - x <= railW - endRoom;
  if (fits(0)) return 0;
  // A row starting `gap` before a pill shows none of the pill before it.
  const starts = Object.values(pos).filter(q => q.x <= p.x).map(q => Math.max(0, q.x - gap)).sort((a, b) => a - b);
  return starts.find(fits) ?? Math.max(0, p.x - gap);
}

/**
 * Pill-rail scrolling shared by every Others header. Near the end of the row a ScrollView cannot scroll far enough
 * to start on a whole pill (it stops at content end, mid-pill), so the row gets just enough extra room at its end.
 */
export function usePillReveal(active: string, side: number) {
  const railRef = useRef<ScrollView>(null);
  const railW = useRef(0);
  const pos = useRef<Record<string, { x: number; w: number }>>({});
  const [tail, setTail] = useState(0);
  const tailRef = useRef(0);

  const reveal = (animated: boolean) => {
    const x = pillRevealX(pos.current, active, railW.current);
    if (x == null) return;
    const contentEnd = Math.max(...Object.values(pos.current).map(q => q.x + q.w)) + side;
    const need = Math.max(0, Math.ceil(x - Math.max(0, contentEnd - railW.current)));
    // Grow the end room first; the effect below scrolls once it is laid out.
    if (need !== tailRef.current) { tailRef.current = need; setTail(need); return; }
    railRef.current?.scrollTo({ x, animated });
  };
  useEffect(() => { reveal(true); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [active]);
  useEffect(() => {
    if (!tail) return;
    const id = requestAnimationFrame(() => reveal(false));
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tail]);

  return {
    railRef,
    tail,
    onRailLayout: (e: LayoutChangeEvent) => { railW.current = e.nativeEvent.layout.width; reveal(false); },
    onPillLayout: (k: string) => (e: LayoutChangeEvent) => {
      pos.current[k] = { x: e.nativeEvent.layout.x, w: e.nativeEvent.layout.width };
      reveal(false);
    },
  };
}

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
  // Bring the active pill into view when it would be cut off, starting the row on a whole pill.
  const { railRef, tail, onRailLayout, onPillLayout } = usePillReveal(active, side);

  const dark = tone === 'dark';
  return (
    <View style={style} onLayout={onRailLayout}>
      <ScrollView
        ref={railRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[st.rail, { paddingLeft: side, paddingRight: side + tail }]}
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
