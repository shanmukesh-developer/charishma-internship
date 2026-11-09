import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, LayoutChangeEvent, ScrollView, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Sparkles, Mic, MessagesSquare, ClipboardList, Heart } from '../../../../components/lucide';
import * as Haptics from 'expo-haptics';
import type { FriendsSubTab } from '../../../../types/campus';
import { FriendsColors, FriendsGradients, FMotion, FS, SectionTints, fui } from '../friendsTheme';
import { useReduceMotion } from './FriendsUi';

import { themedSheet } from '../../../../utils/themeNow';
export const SUB_TAB_META: Record<FriendsSubTab, { label: string; icon: typeof Sparkles; description: string }> = {
  pulse: { label: 'Pulse', icon: Sparkles, description: "What's happening on campus" },
  spaces: { label: 'Spaces', icon: Mic, description: 'Live audio rooms' },
  forum: { label: 'Forum', icon: MessagesSquare, description: 'Questions, guides and reviews' },
  tasks: { label: 'Tasks', icon: ClipboardList, description: 'Help each other out' },
  connect: { label: 'Connect', icon: Heart, description: 'Meet people (18+)' },
};

const BASE_W = 100;

/**
 * Scrollable tab strip listing only the sub-tabs the server says are on.
 * Active tab: ink label + section-tinted icon, with a gradient indicator that glides between tabs
 * (transform-only, native driver; jumps instantly when reduce-motion is on).
 */
export const SubTabBar: React.FC<{
  tabs: FriendsSubTab[];
  value: FriendsSubTab;
  onChange: (t: FriendsSubTab) => void;
  badges?: Partial<Record<FriendsSubTab, number>>;
}> = ({ tabs, value, onChange, badges }) => {
  const reduce = useReduceMotion();
  const scrollRef = useRef<ScrollView>(null);
  const [layouts, setLayouts] = useState<Partial<Record<FriendsSubTab, { x: number; w: number }>>>({});
  const tx = useRef(new Animated.Value(0)).current;
  const sx = useRef(new Animated.Value(0)).current;
  const placed = useRef(false);

  const active = layouts[value];
  useEffect(() => {
    if (!active) return;
    const inset = 14; // indicator is a little narrower than the tab
    const w = Math.max(16, active.w - inset * 2);
    const x = active.x + active.w / 2 - BASE_W / 2;
    if (reduce || !placed.current) {
      tx.setValue(x);
      sx.setValue(w / BASE_W);
      placed.current = true;
    } else {
      Animated.parallel([
        Animated.timing(tx, { toValue: x, duration: FMotion.base, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(sx, { toValue: w / BASE_W, duration: FMotion.base, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]).start();
    }
    scrollRef.current?.scrollTo({ x: Math.max(0, active.x - 48), animated: !reduce });
  }, [active?.x, active?.w, reduce, tx, sx]); // eslint-disable-line react-hooks/exhaustive-deps

  const onTabLayout = (t: FriendsSubTab) => (e: LayoutChangeEvent) => {
    const { x, width } = e.nativeEvent.layout;
    setLayouts((prev) => (prev[t]?.x === x && prev[t]?.w === width ? prev : { ...prev, [t]: { x, w: width } }));
  };

  const tint = SectionTints[value];

  return (
    <View style={styles.wrap}>
      <ScrollView ref={scrollRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} accessibilityRole="tablist">
        {tabs.map((t) => {
          const meta = SUB_TAB_META[t];
          const on = t === value;
          const Icon = meta.icon;
          const badge = badges?.[t] || 0;
          return (
            <TouchableOpacity
              key={t}
              onLayout={onTabLayout(t)}
              style={styles.tab}
              onPress={() => {
                if (on) return;
                Haptics.selectionAsync().catch(() => {});
                onChange(t);
              }}
              activeOpacity={0.7}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${meta.label}. ${meta.description}${badge ? `. ${badge} new` : ''}`}
            >
              <View style={[styles.iconWrap, on && { backgroundColor: SectionTints[t].soft }]}>
                <Icon size={16} color={on ? SectionTints[t].fg : FriendsColors.faint} strokeWidth={on ? 2.4 : 2} />
              </View>
              <Text style={[styles.label, on && styles.labelOn]}>{meta.label}</Text>
              {badge > 0 ? (
                <View style={fui.badge}>
                  <Text style={fui.badgeText}>{badge > 99 ? '99+' : badge}</Text>
                </View>
              ) : null}
            </TouchableOpacity>
          );
        })}
        {active ? (
          <Animated.View pointerEvents="none" style={[styles.indicator, { transform: [{ translateX: tx }, { scaleX: sx }] }]}>
            <LinearGradient colors={tint ? tint.gradient : FriendsGradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
          </Animated.View>
        ) : null}
      </ScrollView>
    </View>
  );
};

const styles = themedSheet(() => ({
  wrap: { borderBottomWidth: StyleSheet.hairlineWidth * 2, borderBottomColor: FriendsColors.line, backgroundColor: FriendsColors.bg },
  row: { paddingHorizontal: FS.sm, gap: 2 },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 50, paddingHorizontal: 12 },
  iconWrap: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 14, fontWeight: '700', color: FriendsColors.muted, letterSpacing: 0.1 },
  labelOn: { color: FriendsColors.ink, fontWeight: '800' },
  indicator: { position: 'absolute', left: 0, bottom: 0, width: BASE_W, height: 3, borderTopLeftRadius: 3, borderTopRightRadius: 3, overflow: 'hidden' },
}));
