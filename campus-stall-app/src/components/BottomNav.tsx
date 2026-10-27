// Bottom navigation (same look as ZCS Vendor: plain state, big targets, a bar over the selected tab).
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, font, space } from '../theme';
import type { IconName } from '../ui/kit';
import type { MainTab } from '../nav';

const NAV: { key: MainTab; label: string; icon: IconName; iconSel: IconName }[] = [
  { key: 'bookings', label: 'Bookings', icon: 'bag-check-outline', iconSel: 'bag-check' },
  { key: 'menu', label: 'Menu', icon: 'fast-food-outline', iconSel: 'fast-food' },
  { key: 'earnings', label: 'Earnings', icon: 'wallet-outline', iconSel: 'wallet' },
  { key: 'settings', label: 'Settings', icon: 'settings-outline', iconSel: 'settings' },
];

export function BottomNav({ value, onChange, badges }: { value: MainTab; onChange: (t: MainTab) => void; badges?: Partial<Record<MainTab, number>> }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.nav, { paddingBottom: Math.max(insets.bottom, space.xs) }]} accessibilityRole="tablist">
      {NAV.map((n) => {
        const sel = n.key === value;
        const count = (badges && badges[n.key]) || 0;
        return (
          <Pressable
            key={n.key}
            onPress={() => onChange(n.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: sel }}
            accessibilityLabel={count ? `${n.label}, ${count} to review` : n.label}
            style={styles.navItem}
          >
            <View>
              <Ionicons name={sel ? n.iconSel : n.icon} size={26} color={sel ? color.text : color.textMuted} />
              {count ? (
                <View style={styles.navBadge}><Text style={[font.label, { color: color.textInverse, fontSize: 11 }]}>{count > 99 ? '99+' : count}</Text></View>
              ) : null}
            </View>
            <Text style={[font.label, { color: sel ? color.text : color.textMuted }]}>{n.label}</Text>
            {sel ? <View style={styles.navBar} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  nav: { flexDirection: 'row', backgroundColor: color.surface, borderTopWidth: 1, borderTopColor: color.border, paddingTop: space.xs },
  navItem: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 58, gap: 2 },
  navBar: { position: 'absolute', top: -space.xs, width: 36, height: 3, borderRadius: 2, backgroundColor: color.text },
  navBadge: { position: 'absolute', top: -4, right: -12, minWidth: 20, height: 20, borderRadius: 10, backgroundColor: color.warning, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
});
