/**
 * "Browse by category" (owner, 26 Oct 2026: the 3D emoji tiles looked unofficial). Portrait photo tiles: a real
 * category photo (eventsV2Art CATEGORY_PHOTO, Unsplash License), a dark indigo gradient at the foot, the label and
 * the number of upcoming events in that category (counted from the same list the home shows, samples included
 * while the demo layer is on). No glow, gloss or motion beyond the one-time fade-in and press feedback.
 * Tapping opens the listing filtered to that category.
 */
import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { NIGHT, TILES, TILE_CATEGORIES, W, hexA, shadow } from './eventsV2Theme';
import { themedSheet } from '../../utils/themeNow';
import { CATEGORY_PHOTO } from './eventsV2Art';
import { Press, FadeInUp, SectionHead, usePageW } from './EventsV2Kit';
import { useNav } from './eventsV2Nav';
import { useEventsV2 } from './eventsV2Data';

export default function CategoryTiles() {
  const nav = useNav();
  const w = usePageW();
  const d = useEventsV2();
  // ~2.6 tiles visible, so the row reads as scrollable at 360 / 390 / 430.
  const tileW = Math.round(Math.max(118, Math.min(150, (w - 32 - 20) / 2.6)));
  const tileH = Math.round(tileW * 1.25);
  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const t of TILES) {
      const cats = TILE_CATEGORIES[t.key];
      out[t.key] = cats ? d.all.filter((e) => cats.includes(e.category)).length : d.all.length;
    }
    return out;
  }, [d.all]);
  const loading = d.mode === 'loading' && !d.all.length;
  return (
    <View style={{ marginTop: 10 }}>
      <SectionHead title="Browse by category" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 4, gap: 10 }}>
        {TILES.map((t, i) => {
          const n = counts[t.key] || 0;
          const sub = loading ? ' ' : n ? `${n} event${n === 1 ? '' : 's'}` : 'None yet';
          return (
            <FadeInUp key={t.key} index={i}>
              <Press
                onPress={() => nav.push({ name: 'explore', tile: t.key })}
                label={`${t.label}${loading ? '' : `, ${sub}`}`}
                hint="Shows these events"
                style={[{ width: tileW, height: tileH }, s.tile, shadow(2)]}
                scaleTo={0.96}
              >
                <Image source={CATEGORY_PHOTO[t.key]} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} accessibilityIgnoresInvertColors />
                <LinearGradient
                  colors={[hexA(NIGHT.scrim, 0), hexA(NIGHT.scrim, 0.55), hexA(NIGHT.scrim, 0.94)]}
                  locations={[0.38, 0.66, 1]}
                  style={StyleSheet.absoluteFill}
                />
                <View style={s.foot}>
                  <Text style={s.label} numberOfLines={1}>{t.label}</Text>
                  <Text style={s.count} numberOfLines={1}>{sub}</Text>
                </View>
                <View style={s.rim} pointerEvents="none" />
              </Press>
            </FadeInUp>
          );
        })}
      </ScrollView>
    </View>
  );
}

const s = themedSheet(() => ({
  tile: { borderRadius: 18, overflow: 'hidden', backgroundColor: NIGHT.card },
  foot: { position: 'absolute', left: 12, right: 12, bottom: 12 },
  label: { color: '#FFFFFF', fontSize: 15, lineHeight: 19, fontWeight: W.title, letterSpacing: -0.1 },
  count: { color: 'rgba(255,255,255,0.82)', fontSize: 12, lineHeight: 16, marginTop: 2 },
  rim: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.16)' },
}));
