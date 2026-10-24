// The five bottom tabs of the reference (Home, Rooms, Mess, Payments, More) with a custom tab bar (no extra
// navigation package). Tabs stay mounted once opened so drafts (free beds, mess menu) survive a tab switch.
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, font, space } from '../theme';
import { CountDot } from '../ui/kit';
import { useHome } from '../state/HomeProvider';
import HomeTab, { type TabProps } from './Home';
import RoomsTab from './Rooms';
import MessTab from './Mess';
import PaymentsTab from './Payments';
import MoreTab from './More';
import type { ScreenProps, TabKey } from '../nav';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
const TABS: { key: TabKey; label: string; icon: IconName; iconOn: IconName; Comp: React.ComponentType<TabProps> }[] = [
  { key: 'home', label: 'Home', icon: 'home-outline', iconOn: 'home', Comp: HomeTab },
  { key: 'rooms', label: 'Rooms', icon: 'bed-outline', iconOn: 'bed', Comp: RoomsTab },
  { key: 'mess', label: 'Mess', icon: 'restaurant-outline', iconOn: 'restaurant', Comp: MessTab },
  { key: 'payments', label: 'Payments', icon: 'wallet-outline', iconOn: 'wallet', Comp: PaymentsTab },
  { key: 'more', label: 'More', icon: 'ellipsis-horizontal-circle-outline', iconOn: 'ellipsis-horizontal-circle', Comp: MoreTab },
];

export default function TabsScreen({ navigation, route }: ScreenProps<'Tabs'>) {
  const insets = useSafeAreaInsets();
  const { home } = useHome();
  const [tab, setTab] = useState<TabKey>(route.params?.tab || 'home');
  const [opened, setOpened] = useState<Set<TabKey>>(new Set([tab]));
  useEffect(() => { if (route.params?.tab) setTab(route.params.tab); }, [route.params?.tab]);
  useEffect(() => { setOpened((s) => (s.has(tab) ? s : new Set([...s, tab]))); }, [tab]);

  const props: TabProps = { open: (screen) => navigation.navigate(screen), go: setTab };
  const badge = (k: TabKey) => (k === 'home' ? home?.counts.pendingRequests || 0 : k === 'more' ? home?.counts.openComplaints || 0 : 0);

  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <View style={{ flex: 1 }}>
        {TABS.filter((t) => opened.has(t.key)).map(({ key, Comp }) => (
          <View key={key} style={[StyleSheet.absoluteFill, key !== tab && st.hidden]} pointerEvents={key === tab ? 'auto' : 'none'}
            importantForAccessibility={key === tab ? 'auto' : 'no-hide-descendants'} accessibilityElementsHidden={key !== tab}>
            <Comp {...props} />
          </View>
        ))}
      </View>
      <View style={[st.bar, { paddingBottom: Math.max(insets.bottom, space.xs) }]} accessibilityRole="tablist">
        {TABS.map((t) => {
          const on = t.key === tab;
          const n = badge(t.key);
          return (
            <Pressable key={t.key} onPress={() => setTab(t.key)} accessibilityRole="tab" accessibilityState={{ selected: on }}
              accessibilityLabel={`${t.label}${n ? `, ${n} new` : ''}`} style={st.item}>
              <View>
                <Ionicons name={on ? t.iconOn : t.icon} size={23} color={on ? color.primary : color.textMuted} />
                {n ? <View style={st.dot}><CountDot n={n} /></View> : null}
              </View>
              <Text style={[font.label, { color: on ? color.primary : color.textMuted, fontSize: 11 }]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  hidden: { opacity: 0 },
  bar: { flexDirection: 'row', backgroundColor: color.surface, borderTopWidth: 1, borderTopColor: color.border, paddingTop: 6 },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, minHeight: 48 },
  dot: { position: 'absolute', top: -6, right: -12 },
});
